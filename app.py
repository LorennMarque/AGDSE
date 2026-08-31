import eventlet

eventlet.monkey_patch()

import csv
import io
import json
import secrets
import shutil
import socket
import subprocess
import time
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.utils import secure_filename

from notebook_core import (
    NotebookKernel,
    empty_notebook,
    ensure_kernel_venv,
    list_installed_packages,
    load_notebook_file,
    make_code_cell,
    make_markdown_cell,
    pip_install,
    save_notebook_file,
    snapshot,
)
from store import COLORS, Store

ROOT = Path(__file__).resolve().parent
DEFAULT_NOTEBOOK = "intro.ipynb"
ensure_kernel_venv(ROOT)  # warm kernel venv once at startup (can take a moment the first time)

app = Flask(__name__)
app.config["SECRET_KEY"] = "agdse-local-dev"
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
app.config["TEMPLATES_AUTO_RELOAD"] = True
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

store = Store(ROOT)

clients: dict[str, dict] = {}
docs: dict[str, dict] = {}
kernels: dict[str, NotebookKernel] = {}
chat_by_project: dict[str, list[dict]] = {}
canvas_by_project: dict[str, list[dict]] = {}

CANVAS_PATH = "__canvas__"
CANVAS_FILE = ".agdse-canvas.json"


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def seed_project_notebook(project_root: Path) -> None:
    path = project_root / DEFAULT_NOTEBOOK
    if path.exists():
        return
    nb = empty_notebook("Intro")
    nb["cells"] = [
        make_code_cell(
            "# Bienvenido a AGDSE\n"
            "# Notebook Jupyter compartido (.ipynb)\n\n"
            "nombre = 'mundo'\n"
            "print(f'Hola, {nombre}')\n"
        ),
        make_code_cell(
            "# Las variables persisten entre celdas\n"
            "print(nombre.upper())\n"
            "suma = sum(range(10))\n"
            "suma\n"
        ),
        make_code_cell(
            "# Explorá archivos del proyecto\n"
            "from pathlib import Path\n"
            "print([p.name for p in Path('.').iterdir()])\n"
        ),
    ]
    save_notebook_file(path, nb)
    sample = project_root / "sample.csv"
    if not sample.exists():
        sample.write_text(
            "name,score,city\n"
            "Ana,92,Montevideo\n"
            "Luis,78,Salto\n"
            "María,88,Paysandú\n"
            "Diego,95,Maldonado\n",
            encoding="utf-8",
        )


def seed_empty_project(project_root: Path) -> None:
    project_root.mkdir(parents=True, exist_ok=True)


def validate_git_url(url: str) -> str | None:
    u = (url or "").strip()
    if not u or len(u) > 400:
        return None
    lowered = u.lower()
    if any(x in lowered for x in ("file:", "..", " ", "\n", "\r", "`", "$", "|", ";", "&")):
        return None
    if lowered.startswith("https://") or lowered.startswith("http://"):
        return u
    if lowered.startswith("git@"):
        return u
    return None


def save_uploaded_files(base: Path, files) -> list[str]:
    saved = []
    for f in files:
        rel = f.filename or ""
        parts = [
            secure_filename(p)
            for p in rel.replace("\\", "/").split("/")
            if p and p not in (".", "..")
        ]
        if not parts:
            continue
        dest = base.joinpath(*parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        f.save(dest)
        saved.append("/".join(parts))
    return saved


def ensure_guest_session() -> dict:
    identity = session.get("identity")
    if identity and identity.get("type") in ("guest", "account"):
        if identity.get("type") == "account":
            user = store.get_user(identity.get("id"))
            if not user:
                identity = None
            else:
                identity = {
                    "type": "account",
                    "id": user["id"],
                    "name": user["name"],
                    "color": user["color"],
                }
                session["identity"] = identity
                return identity
        else:
            return identity

    identity = {
        "type": "guest",
        "id": f"guest-{secrets.token_hex(4)}",
        "name": "Guest",
        "color": COLORS[secrets.randbelow(len(COLORS))],
        "guest_projects": [],
    }
    session["identity"] = identity
    return identity


def current_identity() -> dict:
    return ensure_guest_session()


def set_identity(identity: dict) -> None:
    session["identity"] = identity


def active_project_id() -> str | None:
    return session.get("project_id")


def set_active_project(project_id: str | None) -> None:
    if project_id:
        session["project_id"] = project_id
    else:
        session.pop("project_id", None)


def require_project() -> tuple[dict | None, dict | None, str | None]:
    identity = current_identity()
    pid = active_project_id()
    project = store.get_project(pid)
    if not project or not store.can_access(project, identity):
        return identity, None, "Sin proyecto activo"
    return identity, project, None


def project_dir(project_id: str) -> Path:
    return store.project_root(project_id)


def safe_project_path(project_id: str, rel: str) -> Path:
    base = project_dir(project_id).resolve()
    rel = (rel or "").replace("\\", "/").lstrip("/")
    target = (base / rel).resolve() if rel else base
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ValueError("Ruta fuera del proyecto") from exc
    return target


def doc_key(project_id: str, rel: str) -> str:
    return f"{project_id}:{rel}"


def file_room(project_id: str, path: str) -> str:
    return f"file:{project_id}:{path}"


def project_room(project_id: str) -> str:
    return f"project:{project_id}"


def canvas_file(project_id: str) -> Path:
    return project_dir(project_id) / CANVAS_FILE


def load_canvas_strokes(project_id: str) -> list[dict]:
    if project_id in canvas_by_project:
        return canvas_by_project[project_id]
    strokes: list[dict] = []
    path = canvas_file(project_id)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            raw = data.get("strokes") if isinstance(data, dict) else data
            if isinstance(raw, list):
                strokes = [s for s in raw if isinstance(s, dict)]
        except (OSError, json.JSONDecodeError, TypeError):
            strokes = []
    canvas_by_project[project_id] = strokes
    return strokes


def save_canvas_strokes(project_id: str) -> None:
    strokes = canvas_by_project.get(project_id) or []
    path = canvas_file(project_id)
    try:
        path.write_text(json.dumps({"strokes": strokes[-500:]}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def leave_file_room(sid: str, peer: dict | None) -> None:
    if not peer:
        return
    pid = peer.get("project_id")
    old = peer.get("path")
    if pid and old and old != CANVAS_PATH:
        leave_room(file_room(pid, old), sid=sid)


TREE_SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "kernel_venv",
    "node_modules",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".tox",
    ".next",
    ".nuxt",
    ".cache",
    "dist",
    "build",
    "coverage",
    ".idea",
    ".vscode",
}
TREE_MAX_ENTRIES = 400


def build_tree(base: Path, rel: str = "", *, shallow: bool = True) -> list[dict]:
    """List directory entries. By default only one level (lazy children)."""
    items: list[dict] = []
    try:
        entries = sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        return items

    count = 0
    for entry in entries:
        name = entry.name
        if name.startswith("."):
            continue
        if entry.is_dir() and (name in TREE_SKIP_DIRS or name.endswith(".egg-info")):
            continue
        child_rel = f"{rel}/{name}".strip("/") if rel else name
        if entry.is_dir():
            node = {
                "name": name,
                "path": child_rel,
                "type": "dir",
                "lazy": True,
                "children": [],
            }
            if not shallow:
                node["children"] = build_tree(entry, child_rel, shallow=True)
                node["lazy"] = False
            items.append(node)
        else:
            items.append(
                {
                    "name": name,
                    "path": child_rel,
                    "type": "file",
                    "ext": entry.suffix.lower(),
                }
            )
        count += 1
        if count >= TREE_MAX_ENTRIES:
            remaining = len(entries) - count
            if remaining > 0:
                items.append(
                    {
                        "name": f"… +{remaining} more",
                        "path": rel,
                        "type": "truncated",
                    }
                )
            break
    return items


def get_doc(project_id: str, rel: str) -> dict:
    key = doc_key(project_id, rel)
    if key not in docs:
        docs[key] = load_notebook_file(safe_project_path(project_id, rel))
    return docs[key]


def persist_doc(project_id: str, rel: str) -> None:
    try:
        save_notebook_file(safe_project_path(project_id, rel), docs[doc_key(project_id, rel)])
    except Exception:
        pass


def find_cell(project_id: str, rel: str, cell_id: str) -> dict | None:
    for cell in get_doc(project_id, rel)["cells"]:
        if cell["id"] == cell_id:
            return cell
    return None


def public_peer(peer: dict) -> dict:
    return {
        "id": peer["id"],
        "sid": peer.get("sid"),
        "user_id": peer.get("user_id"),
        "name": peer["name"],
        "color": peer["color"],
        "x": peer.get("x", 0.5),
        "y": peer.get("y", 0.5),
        "path": peer.get("path"),
        "project_id": peer.get("project_id"),
        "type": peer.get("type", "guest"),
    }


def peers_in_project(project_id: str) -> list[dict]:
    return [public_peer(p) for p in clients.values() if p.get("project_id") == project_id]


def emit_to_project(project_id: str, event: str, payload: dict, skip_sid: str | None = None) -> None:
    socketio.emit(event, payload, room=project_room(project_id), skip_sid=skip_sid)


def emit_to_file(project_id: str, path: str, event: str, payload: dict, skip_sid: str | None = None) -> None:
    socketio.emit(event, payload, room=file_room(project_id, path), skip_sid=skip_sid)


def push_system_chat(project_id: str, text: str, *, skip_sid: str | None = None) -> None:
    msg = {
        "id": f"sys-{int(time.time() * 1000)}-{secrets.token_hex(3)}",
        "type": "system",
        "text": text,
        "at": time.time(),
        "reactions": {},
    }
    hist = chat_by_project.setdefault(project_id, [])
    hist.append(msg)
    if len(hist) > 200:
        del hist[:-200]
    emit_to_project(project_id, "chat", msg, skip_sid=skip_sid)


def leave_project_rooms(sid: str, peer: dict | None) -> None:
    if not peer:
        return
    pid = peer.get("project_id")
    path = peer.get("path")
    if path and pid:
        leave_room(file_room(pid, path), sid=sid)
    if pid:
        leave_room(project_room(pid), sid=sid)
        emit_to_project(pid, "leave", {"id": peer["id"]}, skip_sid=sid)


def open_notebook_for(sid: str, project_id: str, rel: str) -> dict | None:
    try:
        path = safe_project_path(project_id, rel)
    except ValueError:
        return None
    if not path.is_file() or path.suffix.lower() != ".ipynb":
        return None

    peer = clients.get(sid)
    if not peer or peer.get("project_id") != project_id:
        return None

    old = peer.get("path")
    if old and old != rel:
        leave_room(file_room(project_id, old), sid=sid)

    join_room(file_room(project_id, rel), sid=sid)
    peer["path"] = rel
    nb = get_doc(project_id, rel)
    kernels[sid] = NotebookKernel(project_dir(project_id), ROOT)
    return nb


def me_payload(identity: dict | None = None) -> dict:
    identity = identity or current_identity()
    pid = active_project_id()
    project = store.get_project(pid) if pid else None
    if project and not store.can_access(project, identity):
        project = None
        set_active_project(None)

    payload = {
        "identity": {
            "type": identity.get("type"),
            "id": identity.get("id"),
            "name": identity.get("name"),
            "color": identity.get("color"),
        },
        "project": None,
        "projects": [],
        "friends": [],
        "pending_in": [],
        "pending_out": [],
        "colors": COLORS,
    }

    if identity.get("type") == "account":
        payload["projects"] = store.list_projects_for(identity["id"])
        friends = store.friends_payload(identity["id"])
        payload.update(friends)
    elif identity.get("type") == "guest":
        # Guest may see projects they joined by code in this session
        guest_ids = identity.get("guest_projects") or []
        payload["projects"] = [
            store.public_project(p)
            for gid in guest_ids
            if (p := store.get_project(gid))
        ]

    if (project):
        # Invite code visible to anyone with access so they can share
        payload["project"] = store.public_project(project, include_code=True)

    return payload


def attach_socket_to_project(sid: str, project_id: str) -> dict | None:
    peer = clients.get(sid)
    identity = current_identity()
    project = store.get_project(project_id)
    if not peer or not project or not store.can_access(project, identity):
        return None

    old_pid = peer.get("project_id")
    fresh_join = old_pid != project_id
    if old_pid and old_pid != project_id:
        leave_project_rooms(sid, peer)

    peer["project_id"] = project_id
    peer["name"] = identity.get("name") or peer["name"]
    peer["color"] = identity.get("color") or peer["color"]
    peer["type"] = identity.get("type")
    peer["user_id"] = identity.get("id")
    peer["path"] = None
    join_room(project_room(project_id), sid=sid)
    set_active_project(project_id)

    # Prefer intro notebook if present
    root = project_dir(project_id)
    default_rel = DEFAULT_NOTEBOOK if (root / DEFAULT_NOTEBOOK).is_file() else None
    if default_rel is None:
        for p in sorted(root.glob("*.ipynb")):
            default_rel = p.name
            break

    nb = open_notebook_for(sid, project_id, default_rel) if default_rel else None
    emit("project_joined", {
        "project": store.public_project(project, include_code=True),
        "tree": build_tree(root),
        "peers": peers_in_project(project_id),
        "chat": {"messages": chat_by_project.get(project_id, [])[-100:]},
        "notebook": {"path": peer.get("path"), "notebook": snapshot(nb)} if nb else None,
    })
    emit_to_project(project_id, "join", public_peer(peer), skip_sid=sid)
    if fresh_join:
        name = (peer.get("name") or "Alguien").strip() or "Alguien"
        push_system_chat(project_id, f"{name} se unió a la sesión", skip_sid=sid)
    return peer


# --------------- HTTP routes ---------------


@app.route("/")
def index():
    ensure_guest_session()
    return render_template("index.html")


@app.get("/api/me")
def api_me():
    ensure_guest_session()
    return jsonify(me_payload())


@app.post("/api/auth/register")
def api_register():
    data = request.get_json(force=True, silent=True) or {}
    user, err = store.register(data.get("name") or "", data.get("color") or COLORS[0], data.get("password") or "")
    if err:
        return jsonify({"error": err}), 400
    set_identity({"type": "account", "id": user["id"], "name": user["name"], "color": user["color"]})
    set_active_project(None)
    return jsonify(me_payload())


@app.post("/api/auth/login")
def api_login():
    data = request.get_json(force=True, silent=True) or {}
    user, err = store.login(data.get("name") or "", data.get("password") or "")
    if err:
        return jsonify({"error": err}), 400
    set_identity({"type": "account", "id": user["id"], "name": user["name"], "color": user["color"]})
    set_active_project(None)
    return jsonify(me_payload())


@app.post("/api/auth/logout")
def api_logout():
    session.clear()
    ensure_guest_session()
    return jsonify(me_payload())


@app.post("/api/auth/guest")
def api_guest():
    session.clear()
    ensure_guest_session()
    return jsonify(me_payload())


@app.post("/api/auth/guest-name")
def api_guest_name():
    identity = current_identity()
    if identity.get("type") != "guest":
        return jsonify({"error": "Solo guests pueden renombrarse así"}), 400
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()[:24] or "Guest"
    identity = {**identity, "name": name}
    set_identity(identity)
    # Update connected sockets for this session user
    for peer in clients.values():
        if peer.get("user_id") == identity["id"]:
            peer["name"] = name
            if peer.get("project_id"):
                emit_to_project(peer["project_id"], "peer_update", public_peer(peer))
    return jsonify(me_payload())


@app.post("/api/friends/request")
def api_friend_request():
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Necesitás una cuenta"}), 401
    data = request.get_json(force=True, silent=True) or {}
    ok, msg = store.friend_request(identity["id"], data.get("name") or "")
    if not ok:
        return jsonify({"error": msg}), 400
    return jsonify({**me_payload(), "message": msg})


@app.post("/api/friends/respond")
def api_friend_respond():
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Necesitás una cuenta"}), 401
    data = request.get_json(force=True, silent=True) or {}
    ok, msg = store.friend_respond(identity["id"], str(data.get("id") or ""), bool(data.get("accept")))
    if not ok:
        return jsonify({"error": msg}), 400
    return jsonify({**me_payload(), "message": msg})


@app.delete("/api/friends/<friend_id>")
def api_friend_remove(friend_id: str):
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Necesitás una cuenta"}), 401
    ok, msg = store.friend_remove(identity["id"], friend_id)
    if not ok:
        return jsonify({"error": msg}), 400
    return jsonify({**me_payload(), "message": msg})


@app.get("/api/projects")
def api_projects_list():
    return jsonify(me_payload())


@app.post("/api/projects")
def api_projects_create():
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Creá una cuenta para hacer proyectos"}), 401
    data = request.get_json(force=True, silent=True) or {}
    project, err = store.create_project(identity["id"], data.get("name") or "Proyecto", seed_project_notebook)
    if err:
        return jsonify({"error": err}), 400
    set_active_project(project["id"])
    return jsonify({**me_payload(), "created": project})


@app.post("/api/projects/open-path")
def api_projects_open_path():
    return jsonify({"error": "Abrir carpeta local está deshabilitado por ahora. Usá New project."}), 400


@app.post("/api/projects/clone")
def api_projects_clone():
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Creá una cuenta para clonar"}), 401
    data = request.get_json(force=True, silent=True) or {}
    url = validate_git_url(data.get("url") or "")
    if not url:
        return jsonify({"error": "URL de git inválida (usá https://… o git@…)"}), 400

    name = (data.get("name") or "").strip()[:60]
    if not name:
        leaf = url.rstrip("/").split("/")[-1]
        if leaf.endswith(".git"):
            leaf = leaf[:-4]
        name = secure_filename(leaf) or "repo"

    project, err = store.create_project(identity["id"], name, seed_empty_project)
    if err:
        return jsonify({"error": err}), 400

    dest = project_dir(project["id"])
    # Clone into a temp sibling then move contents so project id folder is the repo root
    tmp = dest.parent / f".clone-{project['id']}"
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    try:
        proc = subprocess.run(
            ["git", "clone", "--depth", "1", url, str(tmp)],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if proc.returncode != 0:
            store.delete_project(project["id"], identity["id"])
            out = ((proc.stderr or "") + (proc.stdout or "")).strip() or "git clone falló"
            return jsonify({"error": out[:2000]}), 400
        # Move cloned contents into project dir
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        tmp.rename(dest)
    except subprocess.TimeoutExpired:
        store.delete_project(project["id"], identity["id"])
        shutil.rmtree(tmp, ignore_errors=True)
        return jsonify({"error": "Timeout clonando el repositorio"}), 408
    except Exception as exc:
        store.delete_project(project["id"], identity["id"])
        shutil.rmtree(tmp, ignore_errors=True)
        return jsonify({"error": str(exc)}), 500

    set_active_project(project["id"])
    return jsonify({**me_payload(), "created": project})


@app.post("/api/projects/join")
def api_projects_join():
    identity = current_identity()
    data = request.get_json(force=True, silent=True) or {}
    project, updated, err = store.join_by_code(data.get("code") or "", identity)
    if err:
        return jsonify({"error": err}), 400
    if updated:
        set_identity(updated)
        identity = updated
    set_active_project(project["id"])
    return jsonify({**me_payload(identity), "joined": project})


@app.post("/api/projects/<project_id>/open")
def api_project_open(project_id: str):
    identity = current_identity()
    project = store.get_project(project_id)
    if not project or not store.can_access(project, identity):
        return jsonify({"error": "Sin acceso"}), 403
    set_active_project(project_id)
    return jsonify(me_payload())


@app.post("/api/projects/<project_id>/leave")
def api_project_leave(project_id: str):
    if active_project_id() == project_id:
        set_active_project(None)
    return jsonify(me_payload())


@app.post("/api/projects/<project_id>/invite")
def api_project_invite(project_id: str):
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Necesitás una cuenta"}), 401
    data = request.get_json(force=True, silent=True) or {}
    project, err = store.invite_friend(project_id, identity["id"], str(data.get("friend_id") or ""))
    if err:
        return jsonify({"error": err}), 400
    return jsonify({**me_payload(), "project_updated": project})


@app.post("/api/projects/<project_id>/regen-code")
def api_project_regen(project_id: str):
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Necesitás una cuenta"}), 401
    project, err = store.regenerate_code(project_id, identity["id"])
    if err:
        return jsonify({"error": err}), 400
    return jsonify({**me_payload(), "project_updated": project})


@app.delete("/api/projects/<project_id>")
def api_project_delete(project_id: str):
    identity = current_identity()
    if identity.get("type") != "account":
        return jsonify({"error": "Necesitás una cuenta"}), 401
    ok, msg = store.delete_project(project_id, identity["id"])
    if not ok:
        return jsonify({"error": msg}), 400
    if active_project_id() == project_id:
        set_active_project(None)
    # Drop doc cache
    prefix = f"{project_id}:"
    for k in [k for k in docs if k.startswith(prefix)]:
        docs.pop(k, None)
    return jsonify({**me_payload(), "message": msg})


@app.get("/api/workspace/tree")
def api_tree():
    _, project, err = require_project()
    if err:
        return jsonify({"error": err}), 403
    rel = str(request.args.get("path") or "").replace("\\", "/").strip("/")
    try:
        base = safe_project_path(project["id"], rel) if rel else project_dir(project["id"])
    except ValueError:
        return jsonify({"error": "Ruta inválida"}), 400
    if not base.is_dir():
        return jsonify({"error": "No es una carpeta"}), 400
    # Refuse expanding known heavy directories
    if base.name in TREE_SKIP_DIRS:
        return jsonify({"root": project["id"], "path": rel, "tree": []})
    return jsonify({"root": project["id"], "path": rel, "tree": build_tree(base, rel)})


@app.post("/api/workspace/upload")
def api_upload_folder():
    identity, project, err = require_project()
    if err:
        return jsonify({"error": err}), 403
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No hay archivos"}), 400
    base = project_dir(project["id"])
    saved = save_uploaded_files(base, files)
    for joined in saved:
        docs.pop(doc_key(project["id"], joined), None)
    tree = build_tree(base)
    emit_to_project(project["id"], "workspace_tree", {"tree": tree})
    return jsonify({"ok": True, "saved": saved, "tree": tree})


@app.post("/api/notebook/new")
def api_new_notebook():
    _, project, err = require_project()
    if err:
        return jsonify({"error": err}), 403
    data = request.get_json(force=True, silent=True) or {}
    name = secure_filename(data.get("name") or "nuevo") or "nuevo"
    if not name.endswith(".ipynb"):
        name = f"{name}.ipynb"
    path = safe_project_path(project["id"], name)
    nb = empty_notebook(Path(name).stem)
    save_notebook_file(path, nb)
    docs[doc_key(project["id"], name)] = nb
    tree = build_tree(project_dir(project["id"]))
    emit_to_project(project["id"], "workspace_tree", {"tree": tree})
    return jsonify({"path": name, "notebook": snapshot(nb), "tree": tree})


@app.delete("/api/workspace/item")
def api_delete_item():
    _, project, err = require_project()
    if err:
        return jsonify({"error": err}), 403
    data = request.get_json(force=True, silent=True) or {}
    rel = str(data.get("path") or "").replace("\\", "/").strip("/")
    if not rel:
        return jsonify({"error": "Ruta inválida"}), 400
    try:
        target = safe_project_path(project["id"], rel)
    except ValueError:
        return jsonify({"error": "Ruta inválida"}), 400
    base = project_dir(project["id"]).resolve()
    if target == base or not target.exists():
        return jsonify({"error": "No se puede eliminar"}), 400

    pid = project["id"]
    if target.is_dir():
        shutil.rmtree(target)
        stale = [k for k in docs if k.startswith(f"{pid}:") and (k[len(pid) + 1 :] == rel or k[len(pid) + 1 :].startswith(rel + "/"))]
        for k in stale:
            docs.pop(k, None)
    else:
        target.unlink()
        docs.pop(doc_key(pid, rel), None)

    for sid, peer in list(clients.items()):
        if peer.get("project_id") != pid:
            continue
        peer_path = peer.get("path") or ""
        if peer_path == rel or peer_path.startswith(rel + "/"):
            nb = open_notebook_for(sid, pid, DEFAULT_NOTEBOOK)
            if nb is not None:
                socketio.emit(
                    "notebook",
                    {"path": peer["path"], "notebook": snapshot(nb)},
                    to=sid,
                )
            emit_to_project(pid, "peer_update", public_peer(peer))

    tree = build_tree(project_dir(pid))
    emit_to_project(pid, "workspace_tree", {"tree": tree})
    emit_to_project(pid, "path_deleted", {"path": rel})
    return jsonify({"ok": True, "tree": tree})


@app.get("/api/csv/<path:rel>")
def api_csv_preview(rel: str):
    _, project, err = require_project()
    if err:
        return jsonify({"error": err}), 403
    try:
        path = safe_project_path(project["id"], rel)
    except ValueError:
        return jsonify({"error": "Ruta inválida"}), 400
    if not path.is_file() or path.suffix.lower() != ".csv":
        return jsonify({"error": "CSV no encontrado"}), 404

    raw = path.read_bytes()
    text = raw[: 2_000_000].decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.reader(io.StringIO(text), dialect)
    rows = []
    for i, row in enumerate(reader):
        rows.append(row)
        if i >= 200:
            break

    headers = rows[0] if rows else []
    body = rows[1:] if len(rows) > 1 else []
    total_estimate = text.count("\n")
    return jsonify(
        {
            "path": rel,
            "headers": headers,
            "rows": body,
            "truncated": len(raw) > 2_000_000 or total_estimate > 201,
            "shown": len(body),
            "delimiter": getattr(dialect, "delimiter", ","),
        }
    )


@app.get("/api/files/<path:rel>")
def api_raw_file(rel: str):
    _, project, err = require_project()
    if err:
        return jsonify({"error": err}), 403
    path = safe_project_path(project["id"], rel)
    if not path.is_file():
        return jsonify({"error": "No encontrado"}), 404
    return send_from_directory(path.parent, path.name)


@app.get("/api/packages")
def api_packages():
    return jsonify({"packages": list_installed_packages(ROOT)})


@app.post("/api/packages/install")
def api_packages_install():
    data = request.get_json(force=True, silent=True) or {}
    spec = str(data.get("name") or data.get("spec") or "")
    try:
        result = pip_install(ROOT, spec)
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "output": "Timeout instalando el paquete"}), 408
    except Exception as exc:
        return jsonify({"ok": False, "output": str(exc)}), 500

    if result.get("ok"):
        for sid, peer in list(clients.items()):
            pid = peer.get("project_id")
            if pid:
                kernels[sid] = NotebookKernel(project_dir(pid), ROOT)
        socketio.emit("packages_updated", {"packages": list_installed_packages(ROOT)})
        socketio.emit("kernel_restarted", {"reason": "package_install"})
    return jsonify(result)


# --------------- SocketIO ---------------


@socketio.on("connect")
def on_connect():
    identity = current_identity()
    sid = request.sid
    peer = {
        "id": sid,
        "sid": sid,
        "user_id": identity.get("id"),
        "type": identity.get("type"),
        "name": identity.get("name") or "Guest",
        "color": identity.get("color") or COLORS[0],
        "x": 0.5,
        "y": 0.5,
        "path": None,
        "project_id": None,
    }
    clients[sid] = peer
    emit("you", public_peer(peer))
    emit("session", me_payload(identity))

    pid = active_project_id()
    project = store.get_project(pid) if pid else None
    if project and store.can_access(project, identity):
        attach_socket_to_project(sid, pid)


@socketio.on("join_project")
def on_join_project(data):
    sid = request.sid
    project_id = str((data or {}).get("project_id") or "")
    attach_socket_to_project(sid, project_id)


@socketio.on("leave_project")
def on_leave_project():
    sid = request.sid
    peer = clients.get(sid)
    if not peer:
        return
    leave_project_rooms(sid, peer)
    peer["project_id"] = None
    peer["path"] = None
    set_active_project(None)
    kernels.pop(sid, None)
    emit("project_left", {})


@socketio.on("cursor")
def on_cursor(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    peer["x"] = float(data.get("x", 0.5))
    peer["y"] = float(data.get("y", 0.5))
    emit_to_project(
        peer["project_id"],
        "cursor",
        {
            "id": sid,
            "x": peer["x"],
            "y": peer["y"],
            "name": peer["name"],
            "color": peer["color"],
            "path": peer.get("path"),
        },
        skip_sid=sid,
    )


@socketio.on("rename")
def on_rename(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer:
        return
    identity = current_identity()
    if identity.get("type") != "guest":
        return
    name = (data.get("name") or "").strip()[:24]
    if not name:
        return
    peer["name"] = name
    identity = {**identity, "name": name}
    set_identity(identity)
    if peer.get("project_id"):
        emit_to_project(peer["project_id"], "peer_update", public_peer(peer))
    else:
        emit("you", public_peer(peer))


@socketio.on("chat")
def on_chat(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    text = (data.get("text") or "").strip()
    if not text:
        return
    text = text[:500]
    pid = peer["project_id"]
    msg = {
        "id": f"{sid}-{int(time.time() * 1000)}",
        "text": text,
        "at": time.time(),
        "user": {
            "id": peer["id"],
            "name": peer["name"],
            "color": peer["color"],
        },
        "reactions": {},
    }
    hist = chat_by_project.setdefault(pid, [])
    hist.append(msg)
    if len(hist) > 200:
        del hist[:-200]
    emit_to_project(pid, "chat", msg)


CHAT_REACTION_EMOJIS = frozenset({"👍", "👎", "💩", "🤡"})


@socketio.on("chat_react")
def on_chat_react(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    pid = peer["project_id"]
    msg_id = str(data.get("id") or "")
    emoji = str(data.get("emoji") or "")
    if not msg_id or emoji not in CHAT_REACTION_EMOJIS:
        return
    hist = chat_by_project.get(pid) or []
    msg = next((m for m in hist if m.get("id") == msg_id), None)
    if not msg:
        return
    reactions = msg.setdefault("reactions", {})
    users = list(reactions.get(emoji) or [])
    uid = peer["id"]
    entry = {"id": uid, "name": peer["name"], "color": peer["color"]}
    existing = next((i for i, u in enumerate(users) if u.get("id") == uid), None)
    if existing is not None:
        users.pop(existing)
    else:
        users.append(entry)
    if users:
        reactions[emoji] = users
    else:
        reactions.pop(emoji, None)
    emit_to_project(pid, "chat_react", {"id": msg_id, "reactions": reactions})


@socketio.on("cell_source")
def on_cell_source(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    cell = find_cell(pid, rel, str(data.get("id") or ""))
    if not cell:
        return
    cell["source"] = str(data.get("source") or "")
    cell["status"] = "idle"
    emit_to_file(
        pid,
        rel,
        "cell_source",
        {"path": rel, "id": cell["id"], "source": cell["source"], "by": sid},
        skip_sid=sid,
    )
    persist_doc(pid, rel)


@socketio.on("cell_add")
def on_cell_add(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    after_id = data.get("after_id")
    ctype = str(data.get("type") or "code").lower()
    cell = make_markdown_cell() if ctype == "markdown" else make_code_cell()
    cells = get_doc(pid, rel)["cells"]
    idx = len(cells)
    if after_id:
        for i, c in enumerate(cells):
            if c["id"] == after_id:
                idx = i + 1
                break
    cells.insert(idx, cell)
    emit_to_file(pid, rel, "cell_add", {"path": rel, "index": idx, "cell": cell})
    persist_doc(pid, rel)


@socketio.on("cell_type")
def on_cell_type(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    cell_id = str(data.get("id") or "")
    ctype = str(data.get("type") or "").lower()
    if ctype not in ("code", "markdown"):
        return
    cell = find_cell(pid, rel, cell_id)
    if not cell:
        return
    cell["type"] = ctype
    if ctype == "markdown":
        cell["outputs"] = []
        cell["status"] = "idle"
        cell["execution_count"] = None
    elif ctype == "code":
        cell.setdefault("outputs", [])
        cell.setdefault("status", "idle")
    emit_to_file(pid, rel, "cell_type", {"path": rel, "id": cell_id, "type": ctype, "cell": cell})
    persist_doc(pid, rel)


@socketio.on("cell_delete")
def on_cell_delete(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    cell_id = str(data.get("id") or "")
    cells = get_doc(pid, rel)["cells"]
    if len(cells) <= 1:
        return
    docs[doc_key(pid, rel)]["cells"] = [c for c in cells if c["id"] != cell_id]
    emit_to_file(pid, rel, "cell_delete", {"path": rel, "id": cell_id})
    persist_doc(pid, rel)


@socketio.on("cell_move")
def on_cell_move(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    cell_id = str(data.get("id") or "")
    try:
        to_index = int(data.get("to_index"))
    except (TypeError, ValueError):
        return
    cells = get_doc(pid, rel)["cells"]
    from_idx = next((i for i, c in enumerate(cells) if c["id"] == cell_id), -1)
    if from_idx < 0:
        return
    to_index = max(0, min(to_index, len(cells) - 1))
    if from_idx == to_index:
        return
    cell = cells.pop(from_idx)
    cells.insert(to_index, cell)
    order = [c["id"] for c in cells]
    emit_to_file(
        pid,
        rel,
        "cell_move",
        {"path": rel, "id": cell_id, "from_index": from_idx, "to_index": to_index, "order": order},
    )
    persist_doc(pid, rel)


@socketio.on("cell_presence")
def on_cell_presence(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    cell_id = str(data.get("cell_id") or "") or None
    action = data.get("action")
    if action not in ("typing", "dragging", None, ""):
        return
    if action in ("", None):
        action = None
    emit_to_file(
        pid,
        rel,
        "cell_presence",
        {
            "path": rel,
            "cell_id": cell_id,
            "action": action,
            "user": {"id": peer["id"], "name": peer["name"], "color": peer["color"]},
        },
        skip_sid=sid,
    )


@socketio.on("open_canvas")
def on_open_canvas():
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    pid = peer["project_id"]
    leave_file_room(sid, peer)
    peer["path"] = CANVAS_PATH
    strokes = load_canvas_strokes(pid)
    emit("canvas", {"path": CANVAS_PATH, "strokes": strokes})
    emit_to_project(pid, "peer_update", public_peer(peer))


@socketio.on("canvas_stroke")
def on_canvas_stroke(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    pid = peer["project_id"]
    points = data.get("points") or []
    if not isinstance(points, list) or len(points) < 2:
        return
    clean_pts = []
    for pt in points[:2000]:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        try:
            x, y = float(pt[0]), float(pt[1])
        except (TypeError, ValueError):
            continue
        clean_pts.append([max(0.0, min(1.0, x)), max(0.0, min(1.0, y))])
    if len(clean_pts) < 2:
        return
    tool = str(data.get("tool") or "pen")
    if tool not in ("pen", "eraser"):
        tool = "pen"
    try:
        width = float(data.get("width") or (3 if tool == "pen" else 18))
    except (TypeError, ValueError):
        width = 3.0
    width = max(1.0, min(48.0, width))
    stroke = {
        "id": str(data.get("id") or f"{sid}-{int(time.time() * 1000)}-{secrets.token_hex(2)}"),
        "tool": tool,
        "width": width,
        "color": peer.get("color") or "#dadada",
        "points": clean_pts,
        "user": {"id": peer["id"], "name": peer["name"], "color": peer["color"]},
    }
    strokes = load_canvas_strokes(pid)
    strokes.append(stroke)
    if len(strokes) > 500:
        del strokes[:-500]
    save_canvas_strokes(pid)
    emit_to_project(pid, "canvas_stroke", {"path": CANVAS_PATH, "stroke": stroke})


@socketio.on("canvas_undo")
def on_canvas_undo():
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    pid = peer["project_id"]
    uid = peer["id"]
    strokes = load_canvas_strokes(pid)
    idx = next((i for i in range(len(strokes) - 1, -1, -1) if (strokes[i].get("user") or {}).get("id") == uid), -1)
    if idx < 0:
        return
    removed = strokes.pop(idx)
    save_canvas_strokes(pid)
    emit_to_project(pid, "canvas_undo", {"path": CANVAS_PATH, "id": removed["id"]})


@socketio.on("title")
def on_title(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    title = (data.get("title") or "").strip()[:80] or "Sin título"
    doc = get_doc(pid, rel)
    doc["title"] = title
    doc.setdefault("metadata", {})["title"] = title
    emit_to_file(pid, rel, "title", {"path": rel, "title": title}, skip_sid=sid)
    persist_doc(pid, rel)


@socketio.on("run_cell")
def on_run_cell(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id") or not peer.get("path"):
        return
    pid = peer["project_id"]
    rel = peer["path"]
    cell_id = str(data.get("id") or "")
    cell = find_cell(pid, rel, cell_id)
    if not cell or cell.get("type") != "code":
        return
    source = str(data.get("source") if data.get("source") is not None else cell["source"])
    cell["source"] = source
    cell["status"] = "running"
    cell["outputs"] = []
    cell["execution_count"] = (cell.get("execution_count") or 0) + 1
    emit_to_file(pid, rel, "cell_status", {"path": rel, "id": cell_id, "status": "running"})

    kernel = kernels.setdefault(sid, NotebookKernel(project_dir(pid), ROOT))

    def job():
        outputs = kernel.run(source)
        current = find_cell(pid, rel, cell_id)
        if not current:
            return
        current["outputs"] = outputs
        current["status"] = "idle"
        emit_to_file(
            pid,
            rel,
            "cell_output",
            {"path": rel, "id": cell_id, "outputs": outputs, "status": "idle"},
        )
        persist_doc(pid, rel)

    socketio.start_background_task(job)


@socketio.on("kernel_restart")
def on_kernel_restart():
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    kernels[sid] = NotebookKernel(project_dir(peer["project_id"]), ROOT)
    emit("kernel_restarted", {})


@socketio.on("open_path")
def on_open_path(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer or not peer.get("project_id"):
        return
    pid = peer["project_id"]
    rel = str(data.get("path") or "")
    try:
        path = safe_project_path(pid, rel)
    except ValueError:
        return
    if not path.exists():
        return

    suffix = path.suffix.lower()
    if suffix == ".ipynb" and path.is_file():
        nb = open_notebook_for(sid, pid, rel)
        if nb is None:
            return
        emit("notebook", {"path": peer["path"], "notebook": snapshot(nb)})
        emit_to_project(pid, "peer_update", public_peer(peer))
        return

    if suffix == ".csv" and path.is_file():
        old = peer.get("path")
        if old:
            leave_room(file_room(pid, old), sid=sid)
        peer["path"] = rel
        emit("preview", {"type": "csv", "path": rel})
        emit_to_project(pid, "peer_update", public_peer(peer))


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    peer = clients.pop(sid, None)
    kernels.pop(sid, None)
    leave_project_rooms(sid, peer)


if __name__ == "__main__":
    host = "0.0.0.0"
    port = 5000
    ip = local_ip()
    print("\n  AGDSE notebook listo", flush=True)
    print(f"  En esta máquina:  http://127.0.0.1:{port}", flush=True)
    print(f"  En la red local:  http://{ip}:{port}", flush=True)
    print("  Home → cuenta / join por código → proyecto\n", flush=True)
    socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=True)
