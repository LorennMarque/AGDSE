from __future__ import annotations

import json
import secrets
import string
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from werkzeug.security import check_password_hash, generate_password_hash

COLORS = ["#e85d4c", "#3d9b8f", "#e8a838", "#5b7cfa", "#c45c9a", "#6bbf59"]

_lock = threading.RLock()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _invite_code(n: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.data_dir = root / "data"
        self.projects_dir = root / "projects"
        self.users_path = self.data_dir / "users.json"
        self.projects_path = self.data_dir / "projects.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_files()

    def _ensure_files(self) -> None:
        if not self.users_path.exists():
            self._write_json(self.users_path, {"users": {}})
        if not self.projects_path.exists():
            self._write_json(self.projects_path, {"projects": {}})

    def _read_json(self, path: Path) -> dict[str, Any]:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)

    def _users(self) -> dict[str, Any]:
        data = self._read_json(self.users_path)
        if "users" not in data:
            data["users"] = {}
        return data

    def _projects(self) -> dict[str, Any]:
        data = self._read_json(self.projects_path)
        if "projects" not in data:
            data["projects"] = {}
        return data

    def _save_users(self, data: dict[str, Any]) -> None:
        self._write_json(self.users_path, data)

    def _save_projects(self, data: dict[str, Any]) -> None:
        self._write_json(self.projects_path, data)

    def project_root(self, project_id: str) -> Path:
        project = self.get_project(project_id)
        if project and project.get("external_path"):
            return Path(project["external_path"])
        return self.projects_dir / project_id

    def find_project_by_external_path(self, path: Path) -> dict[str, Any] | None:
        try:
            resolved = str(path.expanduser().resolve())
        except OSError:
            return None
        with _lock:
            for p in self._projects()["projects"].values():
                ext = p.get("external_path")
                if not ext:
                    continue
                try:
                    if str(Path(ext).resolve()) == resolved:
                        return p
                except OSError:
                    continue
        return None

    def public_user(self, user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": user["id"],
            "name": user["name"],
            "color": user["color"],
        }

    def get_user(self, user_id: str | None) -> dict[str, Any] | None:
        if not user_id:
            return None
        with _lock:
            return self._users()["users"].get(user_id)

    def find_user_by_name(self, name: str) -> dict[str, Any] | None:
        key = (name or "").strip().lower()
        if not key:
            return None
        with _lock:
            for user in self._users()["users"].values():
                if user["name"].lower() == key:
                    return user
        return None

    def register(self, name: str, color: str, password: str) -> tuple[dict[str, Any] | None, str | None]:
        name = (name or "").strip()[:24]
        password = password or ""
        if len(name) < 2:
            return None, "Nombre muy corto"
        if len(password) < 4:
            return None, "Password mínimo 4 caracteres"
        if color not in COLORS:
            color = COLORS[0]
        with _lock:
            data = self._users()
            for u in data["users"].values():
                if u["name"].lower() == name.lower():
                    return None, "Nombre ya registrado"
            user = {
                "id": _new_id(),
                "name": name,
                "color": color,
                "password_hash": generate_password_hash(password),
                "friends": [],
                "pending_in": [],
                "pending_out": [],
                "created_at": time.time(),
            }
            data["users"][user["id"]] = user
            self._save_users(data)
            return self.public_user(user), None

    def login(self, name: str, password: str) -> tuple[dict[str, Any] | None, str | None]:
        user = self.find_user_by_name(name)
        if not user or not check_password_hash(user.get("password_hash") or "", password or ""):
            return None, "Nombre o password incorrectos"
        return self.public_user(user), None

    def friend_request(self, from_id: str, to_name: str) -> tuple[bool, str]:
        to_name = (to_name or "").strip()
        target = self.find_user_by_name(to_name)
        if not target:
            return False, "Usuario no encontrado"
        if target["id"] == from_id:
            return False, "No podés agregarte a vos mismo"
        with _lock:
            data = self._users()
            me = data["users"].get(from_id)
            other = data["users"].get(target["id"])
            if not me or not other:
                return False, "Usuario no encontrado"
            if other["id"] in me.get("friends", []):
                return False, "Ya son amigos"
            if other["id"] in me.get("pending_out", []):
                return False, "Pedido ya enviado"
            if from_id in other.get("pending_out", []):
                # They already requested us — auto-accept
                me.setdefault("friends", []).append(other["id"])
                other.setdefault("friends", []).append(from_id)
                me["pending_in"] = [x for x in me.get("pending_in", []) if x != other["id"]]
                other["pending_out"] = [x for x in other.get("pending_out", []) if x != from_id]
                self._save_users(data)
                return True, "Amistad aceptada"
            me.setdefault("pending_out", []).append(other["id"])
            other.setdefault("pending_in", []).append(from_id)
            self._save_users(data)
            return True, "Pedido enviado"

    def friend_respond(self, user_id: str, from_id: str, accept: bool) -> tuple[bool, str]:
        with _lock:
            data = self._users()
            me = data["users"].get(user_id)
            other = data["users"].get(from_id)
            if not me or not other:
                return False, "Usuario no encontrado"
            if from_id not in me.get("pending_in", []):
                return False, "No hay pedido pendiente"
            me["pending_in"] = [x for x in me.get("pending_in", []) if x != from_id]
            other["pending_out"] = [x for x in other.get("pending_out", []) if x != user_id]
            if accept:
                if from_id not in me.setdefault("friends", []):
                    me["friends"].append(from_id)
                if user_id not in other.setdefault("friends", []):
                    other["friends"].append(user_id)
            self._save_users(data)
            return True, "Amistad aceptada" if accept else "Pedido rechazado"

    def friend_remove(self, user_id: str, friend_id: str) -> tuple[bool, str]:
        with _lock:
            data = self._users()
            me = data["users"].get(user_id)
            other = data["users"].get(friend_id)
            if not me:
                return False, "Usuario no encontrado"
            me["friends"] = [x for x in me.get("friends", []) if x != friend_id]
            me["pending_in"] = [x for x in me.get("pending_in", []) if x != friend_id]
            me["pending_out"] = [x for x in me.get("pending_out", []) if x != friend_id]
            if other:
                other["friends"] = [x for x in other.get("friends", []) if x != user_id]
                other["pending_in"] = [x for x in other.get("pending_in", []) if x != user_id]
                other["pending_out"] = [x for x in other.get("pending_out", []) if x != user_id]
            self._save_users(data)
            return True, "Eliminado"

    def friends_payload(self, user_id: str) -> dict[str, Any]:
        with _lock:
            data = self._users()
            me = data["users"].get(user_id)
            if not me:
                return {"friends": [], "pending_in": [], "pending_out": []}
            users = data["users"]

            def pub(uid: str) -> dict[str, Any] | None:
                u = users.get(uid)
                return self.public_user(u) if u else None

            return {
                "friends": [p for uid in me.get("friends", []) if (p := pub(uid))],
                "pending_in": [p for uid in me.get("pending_in", []) if (p := pub(uid))],
                "pending_out": [p for uid in me.get("pending_out", []) if (p := pub(uid))],
            }

    def get_project(self, project_id: str | None) -> dict[str, Any] | None:
        if not project_id:
            return None
        with _lock:
            return self._projects()["projects"].get(project_id)

    def find_project_by_code(self, code: str) -> dict[str, Any] | None:
        code = (code or "").strip().upper()
        if not code:
            return None
        with _lock:
            for p in self._projects()["projects"].values():
                if p.get("invite_code") == code:
                    return p
        return None

    def can_access(self, project: dict[str, Any] | None, identity: dict[str, Any] | None) -> bool:
        if not project or not identity:
            return False
        if identity.get("type") == "guest":
            return project["id"] in (identity.get("guest_projects") or [])
        uid = identity.get("id")
        if not uid:
            return False
        return uid == project.get("owner_id") or uid in (project.get("member_ids") or [])

    def public_project(self, project: dict[str, Any], include_code: bool = False) -> dict[str, Any]:
        out = {
            "id": project["id"],
            "name": project["name"],
            "owner_id": project["owner_id"],
            "member_ids": list(project.get("member_ids") or []),
            "created_at": project.get("created_at"),
            "external_path": project.get("external_path"),
        }
        if include_code:
            out["invite_code"] = project.get("invite_code")
        return out

    def list_projects_for(self, user_id: str) -> list[dict[str, Any]]:
        with _lock:
            projects = self._projects()["projects"]
            result = []
            for p in projects.values():
                if p.get("owner_id") == user_id or user_id in (p.get("member_ids") or []):
                    result.append(self.public_project(p, include_code=p.get("owner_id") == user_id))
            result.sort(key=lambda x: x.get("created_at") or 0, reverse=True)
            return result

    def create_project(
        self,
        owner_id: str,
        name: str,
        seed_notebook,
        external_path: str | Path | None = None,
    ) -> tuple[dict[str, Any] | None, str | None]:
        name = (name or "").strip()[:60] or "Proyecto"
        if not self.get_user(owner_id):
            return None, "Cuenta requerida"

        resolved_external: str | None = None
        if external_path:
            try:
                path = Path(str(external_path)).expanduser().resolve()
            except OSError:
                return None, "Ruta inválida"
            if not path.is_dir():
                return None, "La carpeta no existe en este equipo"
            # Safety: must stay under the user's home or the app root
            home = Path.home().resolve()
            root = self.root.resolve()
            path_str = str(path)
            if not (path_str.startswith(str(home)) or path_str.startswith(str(root))):
                return None, "Solo se permiten carpetas bajo tu home o el directorio de AGDSE"
            existing = self.find_project_by_external_path(path)
            if existing:
                if existing.get("owner_id") != owner_id and owner_id not in (
                    existing.get("member_ids") or []
                ):
                    return None, "Esa carpeta ya está vinculada a otro proyecto"
                return self.public_project(existing, include_code=existing.get("owner_id") == owner_id), None
            resolved_external = path_str
            name = name if name != "Proyecto" else path.name

        with _lock:
            data = self._projects()
            pid = _new_id()
            project = {
                "id": pid,
                "name": name,
                "owner_id": owner_id,
                "member_ids": [],
                "invite_code": _invite_code(),
                "created_at": time.time(),
            }
            if resolved_external:
                project["external_path"] = resolved_external
            data["projects"][pid] = project
            self._save_projects(data)

        if not resolved_external:
            root = self.projects_dir / pid
            root.mkdir(parents=True, exist_ok=True)
            seed_notebook(root)
        return self.public_project(project, include_code=True), None

    def join_by_code(
        self,
        code: str,
        identity: dict[str, Any],
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
        """Returns (project, updated_identity_or_None, error)."""
        project = self.find_project_by_code(code)
        if not project:
            return None, None, "Código inválido"

        if identity.get("type") == "account":
            uid = identity["id"]
            with _lock:
                data = self._projects()
                p = data["projects"].get(project["id"])
                if not p:
                    return None, None, "Proyecto no encontrado"
                if uid != p["owner_id"] and uid not in p.setdefault("member_ids", []):
                    p["member_ids"].append(uid)
                    self._save_projects(data)
                return self.public_project(p, include_code=uid == p["owner_id"]), None, None

        # Guest: track accessible projects on identity
        guest_projects = list(identity.get("guest_projects") or [])
        if project["id"] not in guest_projects:
            guest_projects.append(project["id"])
        updated = {**identity, "guest_projects": guest_projects}
        return self.public_project(project, include_code=False), updated, None

    def invite_friend(self, project_id: str, actor_id: str, friend_id: str) -> tuple[dict[str, Any] | None, str | None]:
        with _lock:
            users = self._users()
            me = users["users"].get(actor_id)
            friend = users["users"].get(friend_id)
            if not me or not friend:
                return None, "Usuario no encontrado"
            if friend_id not in me.get("friends", []):
                return None, "Solo podés invitar amigos"
            pdata = self._projects()
            project = pdata["projects"].get(project_id)
            if not project:
                return None, "Proyecto no encontrado"
            if actor_id != project["owner_id"] and actor_id not in (project.get("member_ids") or []):
                return None, "Sin acceso al proyecto"
            if friend_id == project["owner_id"] or friend_id in project.setdefault("member_ids", []):
                return self.public_project(project, include_code=actor_id == project["owner_id"]), None
            project["member_ids"].append(friend_id)
            self._save_projects(pdata)
            return self.public_project(project, include_code=actor_id == project["owner_id"]), None

    def regenerate_code(self, project_id: str, actor_id: str) -> tuple[dict[str, Any] | None, str | None]:
        with _lock:
            pdata = self._projects()
            project = pdata["projects"].get(project_id)
            if not project:
                return None, "Proyecto no encontrado"
            if project.get("owner_id") != actor_id:
                return None, "Solo el dueño puede regenerar el código"
            project["invite_code"] = _invite_code()
            self._save_projects(pdata)
            return self.public_project(project, include_code=True), None

    def delete_project(self, project_id: str, actor_id: str) -> tuple[bool, str]:
        with _lock:
            pdata = self._projects()
            project = pdata["projects"].get(project_id)
            if not project:
                return False, "Proyecto no encontrado"
            if project.get("owner_id") != actor_id:
                return False, "Solo el dueño puede eliminar"
            external = project.get("external_path")
            del pdata["projects"][project_id]
            self._save_projects(pdata)
        # Never delete an external/linked folder — only managed copies under projects/
        if not external:
            root = self.projects_dir / project_id
            if root.exists():
                import shutil

                shutil.rmtree(root, ignore_errors=True)
        return True, "Eliminado"
