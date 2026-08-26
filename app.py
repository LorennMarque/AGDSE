import eventlet

eventlet.monkey_patch()

import csv
import io
import shutil
import socket
import subprocess
import time
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.utils import secure_filename

from notebook_core import (
    NotebookKernel,
    empty_notebook,
    ensure_kernel_venv,
    list_installed_packages,
    load_notebook_file,
    make_code_cell,
    normalize_notebook,
    pip_install,
    save_notebook_file,
    snapshot,
)

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT / "workspace"
WORKSPACE.mkdir(exist_ok=True)
DEFAULT_PATH = "intro.agdnb"
ensure_kernel_venv(ROOT)

app = Flask(__name__)
app.config["SECRET_KEY"] = "agdse-local-dev"
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024
app.config["TEMPLATES_AUTO_RELOAD"] = True
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

clients: dict[str, dict] = {}
docs: dict[str, dict] = {}
kernels: dict[str, NotebookKernel] = {}
chat_history: list[dict] = []
COLORS = ["#e85d4c", "#3d9b8f", "#e8a838", "#5b7cfa", "#c45c9a", "#6bbf59"]


def local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def safe_workspace_path(rel: str) -> Path:
    rel = (rel or "").replace("\\", "/").lstrip("/")
    target = (WORKSPACE / rel).resolve()
    if not str(target).startswith(str(WORKSPACE.resolve())):
        raise ValueError("Ruta fuera del workspace")
    return target


def file_room(path: str) -> str:
    return f"file:{path}"


def ensure_default_notebook() -> None:
    path = WORKSPACE / DEFAULT_PATH
    if path.exists():
        docs[DEFAULT_PATH] = load_notebook_file(path)
    else:
        nb = empty_notebook("Intro")
        nb["cells"] = [
            make_code_cell(
                "# Bienvenido a AGDSE\n"
                "# Notebook compartido (.agdnb)\n\n"
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
                "# Explorá archivos del workspace\n"
                "from pathlib import Path\n"
                "print([p.name for p in Path('.').iterdir()])\n"
            ),
        ]
        save_notebook_file(path, nb)
        docs[DEFAULT_PATH] = nb

    sample_csv = WORKSPACE / "sample.csv"
    if not sample_csv.exists():
        sample_csv.write_text(
            "name,score,city\n"
            "Ana,92,Montevideo\n"
            "Luis,78,Salto\n"
            "María,88,Paysandú\n"
            "Diego,95,Maldonado\n",
            encoding="utf-8",
        )


def get_doc(rel: str) -> dict:
    if rel not in docs:
        path = safe_workspace_path(rel)
        docs[rel] = load_notebook_file(path)
    return docs[rel]


def persist_doc(rel: str) -> None:
    try:
        save_notebook_file(safe_workspace_path(rel), docs[rel])
    except Exception:
        pass


def build_tree(base: Path, rel: str = "") -> list[dict]:
    items = []
    try:
        entries = sorted(base.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except OSError:
        return items
    for entry in entries:
        if entry.name.startswith("."):
            continue
        child_rel = f"{rel}/{entry.name}".strip("/") if rel else entry.name
        if entry.is_dir():
            items.append(
                {
                    "name": entry.name,
                    "path": child_rel,
                    "type": "dir",
                    "children": build_tree(entry, child_rel),
                }
            )
        else:
            items.append(
                {
                    "name": entry.name,
                    "path": child_rel,
                    "type": "file",
                    "ext": entry.suffix.lower(),
                }
            )
    return items


def find_cell(rel: str, cell_id: str) -> dict | None:
    for cell in get_doc(rel)["cells"]:
        if cell["id"] == cell_id:
            return cell
    return None


def client_path(sid: str) -> str | None:
    peer = clients.get(sid)
    return peer.get("path") if peer else None


def emit_to_file(path: str, event: str, payload: dict, skip_sid: str | None = None) -> None:
    socketio.emit(event, payload, room=file_room(path), skip_sid=skip_sid)


def open_notebook_for(sid: str, rel: str) -> dict | None:
    try:
        path = safe_workspace_path(rel)
    except ValueError:
        return None
    if not path.is_file() or path.suffix.lower() != ".agdnb":
        return None

    peer = clients.get(sid)
    if not peer:
        return None

    old = peer.get("path")
    if old and old != rel:
        leave_room(file_room(old), sid=sid)

    join_room(file_room(rel), sid=sid)
    peer["path"] = rel
    nb = get_doc(rel)
    kernels[sid] = NotebookKernel(WORKSPACE, ROOT)
    return nb


def public_peer(peer: dict) -> dict:
    return {
        "id": peer["id"],
        "name": peer["name"],
        "color": peer["color"],
        "x": peer.get("x", 0.5),
        "y": peer.get("y", 0.5),
        "path": peer.get("path"),
    }


ensure_default_notebook()


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/api/workspace/tree")
def api_tree():
    return jsonify({"root": "workspace", "tree": build_tree(WORKSPACE)})


@app.post("/api/workspace/upload")
def api_upload_folder():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No hay archivos"}), 400
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
        dest = WORKSPACE.joinpath(*parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        f.save(dest)
        saved.append("/".join(parts))
        # Drop cache so next open reloads from disk
        joined = "/".join(parts)
        if joined in docs:
            docs.pop(joined, None)
    tree = build_tree(WORKSPACE)
    socketio.emit("workspace_tree", {"tree": tree})
    return jsonify({"ok": True, "saved": saved, "tree": tree})


@app.post("/api/notebook/new")
def api_new_notebook():
    data = request.get_json(force=True, silent=True) or {}
    name = secure_filename(data.get("name") or "nuevo") or "nuevo"
    if not name.endswith(".agdnb"):
        name = f"{name}.agdnb"
    path = safe_workspace_path(name)
    nb = empty_notebook(Path(name).stem)
    save_notebook_file(path, nb)
    docs[name] = nb
    tree = build_tree(WORKSPACE)
    socketio.emit("workspace_tree", {"tree": tree})
    return jsonify({"path": name, "notebook": nb, "tree": tree})


@app.delete("/api/workspace/item")
def api_delete_item():
    data = request.get_json(force=True, silent=True) or {}
    rel = str(data.get("path") or "").replace("\\", "/").strip("/")
    if not rel:
        return jsonify({"error": "Ruta inválida"}), 400
    try:
        target = safe_workspace_path(rel)
    except ValueError:
        return jsonify({"error": "Ruta inválida"}), 400
    if target == WORKSPACE.resolve() or not target.exists():
        return jsonify({"error": "No se puede eliminar"}), 400
    if not str(target).startswith(str(WORKSPACE.resolve())):
        return jsonify({"error": "Ruta inválida"}), 400

    if target.is_dir():
        shutil.rmtree(target)
        stale = [k for k in docs if k == rel or k.startswith(rel + "/")]
        for k in stale:
            docs.pop(k, None)
    else:
        target.unlink()
        docs.pop(rel, None)

    for sid, peer in list(clients.items()):
        peer_path = peer.get("path") or ""
        if peer_path == rel or peer_path.startswith(rel + "/"):
            nb = open_notebook_for(sid, DEFAULT_PATH)
            if nb is not None:
                socketio.emit(
                    "notebook",
                    {"path": peer["path"], "notebook": snapshot(nb)},
                    to=sid,
                )
            socketio.emit("peer_update", public_peer(peer))

    tree = build_tree(WORKSPACE)
    socketio.emit("workspace_tree", {"tree": tree})
    socketio.emit("path_deleted", {"path": rel})
    return jsonify({"ok": True, "tree": tree})


@app.get("/api/csv/<path:rel>")
def api_csv_preview(rel: str):
    try:
        path = safe_workspace_path(rel)
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
    path = safe_workspace_path(rel)
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
        # Restart all kernels so imports see the new package
        for sid in list(kernels.keys()):
            kernels[sid] = NotebookKernel(WORKSPACE, ROOT)
        socketio.emit("packages_updated", {"packages": list_installed_packages(ROOT)})
        socketio.emit("kernel_restarted", {"reason": "package_install"})
    return jsonify(result)


@socketio.on("connect")
def on_connect():
    sid = request.sid
    color = COLORS[len(clients) % len(COLORS)]
    peer = {
        "id": sid,
        "name": f"User {len(clients) + 1}",
        "color": color,
        "x": 0.5,
        "y": 0.5,
        "path": None,
    }
    clients[sid] = peer
    nb = open_notebook_for(sid, DEFAULT_PATH)
    emit("you", public_peer(peer))
    emit("peers", [public_peer(p) for p in clients.values()])
    emit("chat_history", {"messages": chat_history[-100:]})
    emit("workspace_tree", {"tree": build_tree(WORKSPACE)})
    if nb is not None:
        emit("notebook", {"path": peer["path"], "notebook": snapshot(nb)})
    socketio.emit("join", public_peer(peer), skip_sid=sid)


@socketio.on("cursor")
def on_cursor(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer:
        return
    peer["x"] = float(data.get("x", 0.5))
    peer["y"] = float(data.get("y", 0.5))
    socketio.emit(
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
    name = (data.get("name") or "").strip()[:24]
    if not name:
        return
    peer["name"] = name
    socketio.emit("peer_update", public_peer(peer))


@socketio.on("chat")
def on_chat(data):
    sid = request.sid
    peer = clients.get(sid)
    if not peer:
        return
    text = (data.get("text") or "").strip()
    if not text:
        return
    text = text[:500]
    msg = {
        "id": f"{sid}-{int(time.time() * 1000)}",
        "text": text,
        "at": time.time(),
        "user": {
            "id": peer["id"],
            "name": peer["name"],
            "color": peer["color"],
        },
    }
    chat_history.append(msg)
    if len(chat_history) > 200:
        del chat_history[:-200]
    socketio.emit("chat", msg)


@socketio.on("cell_source")
def on_cell_source(data):
    sid = request.sid
    rel = client_path(sid)
    if not rel:
        return
    cell = find_cell(rel, str(data.get("id") or ""))
    if not cell:
        return
    cell["source"] = str(data.get("source") or "")
    cell["status"] = "idle"
    emit_to_file(
        rel,
        "cell_source",
        {"path": rel, "id": cell["id"], "source": cell["source"], "by": sid},
        skip_sid=sid,
    )
    persist_doc(rel)


@socketio.on("cell_add")
def on_cell_add(data):
    sid = request.sid
    rel = client_path(sid)
    if not rel:
        return
    after_id = data.get("after_id")
    cell = make_code_cell()
    cells = get_doc(rel)["cells"]
    idx = len(cells)
    if after_id:
        for i, c in enumerate(cells):
            if c["id"] == after_id:
                idx = i + 1
                break
    cells.insert(idx, cell)
    emit_to_file(rel, "cell_add", {"path": rel, "index": idx, "cell": cell})
    persist_doc(rel)


@socketio.on("cell_delete")
def on_cell_delete(data):
    sid = request.sid
    rel = client_path(sid)
    if not rel:
        return
    cell_id = str(data.get("id") or "")
    cells = get_doc(rel)["cells"]
    if len(cells) <= 1:
        return
    docs[rel]["cells"] = [c for c in cells if c["id"] != cell_id]
    emit_to_file(rel, "cell_delete", {"path": rel, "id": cell_id})
    persist_doc(rel)


@socketio.on("title")
def on_title(data):
    sid = request.sid
    rel = client_path(sid)
    if not rel:
        return
    title = (data.get("title") or "").strip()[:80] or "Sin título"
    get_doc(rel)["title"] = title
    emit_to_file(rel, "title", {"path": rel, "title": title}, skip_sid=sid)
    persist_doc(rel)


@socketio.on("run_cell")
def on_run_cell(data):
    sid = request.sid
    rel = client_path(sid)
    if not rel:
        return
    cell_id = str(data.get("id") or "")
    cell = find_cell(rel, cell_id)
    if not cell:
        return
    source = str(data.get("source") if data.get("source") is not None else cell["source"])
    cell["source"] = source
    cell["status"] = "running"
    cell["outputs"] = []
    emit_to_file(rel, "cell_status", {"path": rel, "id": cell_id, "status": "running"})

    kernel = kernels.setdefault(sid, NotebookKernel(WORKSPACE, ROOT))

    def job():
        outputs = kernel.run(source)
        current = find_cell(rel, cell_id)
        if not current:
            return
        current["outputs"] = outputs
        current["status"] = "idle"
        emit_to_file(
            rel,
            "cell_output",
            {"path": rel, "id": cell_id, "outputs": outputs, "status": "idle"},
        )
        persist_doc(rel)

    socketio.start_background_task(job)


@socketio.on("kernel_restart")
def on_kernel_restart():
    sid = request.sid
    kernels[sid] = NotebookKernel(WORKSPACE, ROOT)
    emit("kernel_restarted", {})


@socketio.on("open_path")
def on_open_path(data):
    sid = request.sid
    rel = str(data.get("path") or "")
    peer = clients.get(sid)
    if not peer:
        return
    try:
        path = safe_workspace_path(rel)
    except ValueError:
        return
    if not path.exists():
        return

    suffix = path.suffix.lower()
    if suffix == ".agdnb" and path.is_file():
        nb = open_notebook_for(sid, rel)
        if nb is None:
            return
        emit("notebook", {"path": peer["path"], "notebook": snapshot(nb)})
        socketio.emit("peer_update", public_peer(peer))
        return

    if suffix == ".csv" and path.is_file():
        old = peer.get("path")
        if old:
            leave_room(file_room(old), sid=sid)
        peer["path"] = rel
        emit("preview", {"type": "csv", "path": rel})
        socketio.emit("peer_update", public_peer(peer))


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    peer = clients.pop(sid, None)
    kernels.pop(sid, None)
    if peer and peer.get("path"):
        leave_room(file_room(peer["path"]), sid=sid)
    socketio.emit("leave", {"id": sid})


if __name__ == "__main__":
    host = "0.0.0.0"
    port = 5000
    ip = local_ip()
    print("\n  AGDSE notebook listo", flush=True)
    print(f"  En esta máquina:  http://127.0.0.1:{port}", flush=True)
    print(f"  En la red local:  http://{ip}:{port}", flush=True)
    print("  Compartí el link de red local con tu amigo (misma Wi‑Fi)\n", flush=True)
    socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=True)
