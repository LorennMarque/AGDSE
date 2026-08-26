from __future__ import annotations

import ast
import importlib
import io
import json
import os
import re
import subprocess
import sys
import traceback
import uuid
import venv
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from pathlib import Path
from typing import Any


FORMAT = "agdnb"
VERSION = 1
PKG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]*(==[A-Za-z0-9._\-]+)?$")


def new_cell_id() -> str:
    return uuid.uuid4().hex[:12]


def make_code_cell(source: str = "") -> dict[str, Any]:
    return {
        "id": new_cell_id(),
        "type": "code",
        "source": source,
        "outputs": [],
        "status": "idle",
    }


def empty_notebook(title: str = "Sin título") -> dict[str, Any]:
    return {
        "format": FORMAT,
        "version": VERSION,
        "title": title,
        "cells": [
            make_code_cell("# Notebook compartido AGDSE\nprint('hola')\n"),
        ],
    }


def normalize_notebook(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return empty_notebook()
    cells = []
    for raw in data.get("cells") or []:
        cell = make_code_cell(str(raw.get("source") or ""))
        cell["id"] = str(raw.get("id") or cell["id"])
        cell["type"] = "code"
        cell["outputs"] = list(raw.get("outputs") or [])
        cell["status"] = str(raw.get("status") or "idle")
        cells.append(cell)
    if not cells:
        cells = [make_code_cell()]
    return {
        "format": FORMAT,
        "version": VERSION,
        "title": str(data.get("title") or "Sin título"),
        "cells": cells,
    }


def load_notebook_file(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return normalize_notebook(raw)


def save_notebook_file(path: Path, notebook: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = normalize_notebook(notebook)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def kernel_venv_dir(root: Path) -> Path:
    return root / "kernel_venv"


def kernel_python(root: Path) -> Path:
    base = kernel_venv_dir(root)
    if sys.platform == "win32":
        return base / "Scripts" / "python.exe"
    return base / "bin" / "python"


def kernel_pip(root: Path) -> Path:
    base = kernel_venv_dir(root)
    if sys.platform == "win32":
        return base / "Scripts" / "pip"
    return base / "bin" / "pip"


def ensure_kernel_venv(root: Path) -> Path:
    venv_path = kernel_venv_dir(root)
    py = kernel_python(root)
    if not py.exists():
        venv.EnvBuilder(with_pip=True, clear=False).create(venv_path)
        # Ensure pip is up to date enough for modern wheels
        subprocess.run(
            [str(py), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
            check=False,
            capture_output=True,
            text=True,
        )
    return venv_path


def site_packages_dirs(root: Path) -> list[Path]:
    venv_path = kernel_venv_dir(root)
    if sys.platform == "win32":
        return [venv_path / "Lib" / "site-packages"]
    lib = venv_path / "lib"
    if not lib.exists():
        return []
    return sorted(lib.glob("python*/site-packages"))


def activate_kernel_site(root: Path) -> None:
    for sp in site_packages_dirs(root):
        sp_str = str(sp)
        if sp_str not in sys.path:
            sys.path.insert(0, sp_str)


def validate_package_spec(spec: str) -> str | None:
    name = (spec or "").strip()
    if not name or not PKG_RE.match(name):
        return None
    # Block path/url installs for safety on a shared LAN app
    lowered = name.lower()
    if any(x in lowered for x in ("://", "/", "\\", "..")):
        return None
    return name


def pip_install(root: Path, spec: str, timeout: int = 300) -> dict[str, Any]:
    ensure_kernel_venv(root)
    safe = validate_package_spec(spec)
    if not safe:
        return {"ok": False, "output": "Nombre de paquete inválido. Usá: nombre o nombre==1.2.3"}
    py = kernel_python(root)
    proc = subprocess.run(
        [str(py), "-m", "pip", "install", safe],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    return {"ok": proc.returncode == 0, "output": output.strip() or "(sin salida)", "spec": safe}


def list_installed_packages(root: Path) -> list[dict[str, str]]:
    ensure_kernel_venv(root)
    py = kernel_python(root)
    proc = subprocess.run(
        [str(py), "-m", "pip", "list", "--format=json"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        return []
    try:
        data = json.loads(proc.stdout or "[]")
    except json.JSONDecodeError:
        return []
    return [{"name": p.get("name", ""), "version": p.get("version", "")} for p in data if p.get("name")]


class NotebookKernel:
    """Python namespace backed by the shared kernel virtualenv site-packages."""

    def __init__(self, cwd: Path, root: Path) -> None:
        self.cwd = cwd
        self.root = root
        self.reset()

    def reset(self) -> None:
        ensure_kernel_venv(self.root)
        activate_kernel_site(self.root)
        # Drop cached imports so newly installed packages are visible after restart
        importlib.invalidate_caches()
        self.globals: dict[str, Any] = {"__name__": "__main__"}

    def run(self, source: str) -> list[dict[str, str]]:
        activate_kernel_site(self.root)
        stdout = io.StringIO()
        stderr = io.StringIO()
        outputs: list[dict[str, str]] = []
        result_repr = None
        try:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                prev = os.getcwd()
                try:
                    os.chdir(self.cwd)
                    tree = ast.parse(source, mode="exec")
                    body = tree.body
                    if body and isinstance(body[-1], ast.Expr):
                        pre = body[:-1]
                        if pre:
                            exec(
                                compile(ast.Module(body=pre, type_ignores=[]), "<cell>", "exec"),
                                self.globals,
                                self.globals,
                            )
                        value = eval(
                            compile(ast.Expression(body[-1].value), "<cell>", "eval"),
                            self.globals,
                            self.globals,
                        )
                        if value is not None:
                            result_repr = repr(value)
                    else:
                        exec(compile(tree, "<cell>", "exec"), self.globals, self.globals)
                finally:
                    os.chdir(prev)
        except Exception:
            err = stderr.getvalue() + traceback.format_exc()
            if err.strip():
                outputs.append({"type": "error", "text": err})
        out = stdout.getvalue()
        err_only = stderr.getvalue()
        if out:
            outputs.append({"type": "stream", "text": out})
        if result_repr is not None:
            outputs.append({"type": "stream", "text": result_repr + "\n"})
        if err_only and not any(o["type"] == "error" for o in outputs):
            outputs.append({"type": "error", "text": err_only})
        if not outputs:
            outputs.append({"type": "stream", "text": ""})
        return outputs


def snapshot(notebook: dict[str, Any]) -> dict[str, Any]:
    return deepcopy(normalize_notebook(notebook))
