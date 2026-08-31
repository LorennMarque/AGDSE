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


NBFORMAT = 4
NBFORMAT_MINOR = 5
PKG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]*(==[A-Za-z0-9._\-]+)?$")

DEFAULT_METADATA = {
    "kernelspec": {
        "display_name": "Python 3",
        "language": "python",
        "name": "python3",
    },
    "language_info": {
        "name": "python",
        "file_extension": ".py",
    },
}


def new_cell_id() -> str:
    return uuid.uuid4().hex[:12]


def _source_to_str(source: Any) -> str:
    if isinstance(source, list):
        return "".join(str(line) for line in source)
    return str(source or "")


def _source_to_lines(source: str) -> list[str]:
    text = source if source is not None else ""
    if text == "":
        return []
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n") and "\n" in text:
        # splitlines(keepends=True) already preserves newlines; last line may lack \n
        pass
    if text and not text.endswith("\n"):
        # Jupyter often stores without trailing newline on last line — keep as-is
        return text.splitlines(keepends=True) or [text]
    return text.splitlines(keepends=True)


def make_code_cell(source: str = "") -> dict[str, Any]:
    return {
        "id": new_cell_id(),
        "type": "code",
        "source": source,
        "outputs": [],
        "status": "idle",
        "execution_count": None,
    }


def make_markdown_cell(source: str = "") -> dict[str, Any]:
    return {
        "id": new_cell_id(),
        "type": "markdown",
        "source": source,
        "outputs": [],
        "status": "idle",
        "execution_count": None,
    }


def empty_notebook(title: str = "Sin título") -> dict[str, Any]:
    return {
        "nbformat": NBFORMAT,
        "nbformat_minor": NBFORMAT_MINOR,
        "metadata": {**deepcopy(DEFAULT_METADATA), "title": title},
        "title": title,
        "cells": [
            make_code_cell("# Notebook compartido AGDSE\nprint('hola')\n"),
        ],
    }


def _jupyter_outputs_to_simple(outputs: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    simple: list[dict[str, str]] = []
    for out in outputs or []:
        otype = out.get("output_type") or out.get("type")
        if otype == "stream" or (out.get("type") == "stream" and "text" in out and "output_type" not in out):
            text = _source_to_str(out.get("text") or "")
            if text:
                simple.append({"type": "stream", "text": text})
        elif otype == "error" or out.get("type") == "error":
            if "traceback" in out:
                text = "\n".join(str(line) for line in out.get("traceback") or [])
            else:
                text = _source_to_str(out.get("text") or "")
                if not text:
                    ename = out.get("ename") or ""
                    evalue = out.get("evalue") or ""
                    text = f"{ename}: {evalue}".strip(": ")
            if text:
                simple.append({"type": "error", "text": text})
        elif otype in ("execute_result", "display_data"):
            data = out.get("data") or {}
            text = _source_to_str(data.get("text/plain") or "")
            if text:
                simple.append({"type": "stream", "text": text if text.endswith("\n") else text + "\n"})
        elif out.get("type") in ("stream", "error") and "text" in out:
            # Already simplified (in-memory / legacy)
            text = _source_to_str(out.get("text") or "")
            if text or out.get("type") == "error":
                simple.append({"type": str(out["type"]), "text": text})
    return simple


def _simple_outputs_to_jupyter(outputs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    jout: list[dict[str, Any]] = []
    for out in outputs or []:
        # Pass through already-jupyter outputs
        if out.get("output_type"):
            jout.append(out)
            continue
        otype = out.get("type") or "stream"
        text = _source_to_str(out.get("text") or "")
        if otype == "error":
            jout.append(
                {
                    "output_type": "error",
                    "ename": "Error",
                    "evalue": text.split("\n")[-1][:200] if text else "",
                    "traceback": text.splitlines() or [text],
                }
            )
        elif text:
            jout.append(
                {
                    "output_type": "stream",
                    "name": "stdout",
                    "text": _source_to_lines(text) or [text],
                }
            )
    return jout


def _normalize_cell(raw: dict[str, Any]) -> dict[str, Any]:
    cell_type = str(raw.get("cell_type") or raw.get("type") or "code")
    if cell_type != "code":
        source = _source_to_str(raw.get("source") or "")
        return {
            "id": str(raw.get("id") or new_cell_id()),
            "type": cell_type if cell_type in ("markdown", "raw") else "markdown",
            "source": source,
            "outputs": [],
            "status": "idle",
            "execution_count": None,
            "metadata": dict(raw.get("metadata") or {}),
        }

    cell = make_code_cell(_source_to_str(raw.get("source") or ""))
    cell["id"] = str(raw.get("id") or cell["id"])
    cell["outputs"] = _jupyter_outputs_to_simple(raw.get("outputs"))
    cell["status"] = str(raw.get("status") or "idle")
    cell["execution_count"] = raw.get("execution_count")
    cell["metadata"] = dict(raw.get("metadata") or {})
    return cell


def normalize_notebook(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data:
        return empty_notebook()

    # Legacy .agdnb support on read
    title = str(
        data.get("title")
        or (data.get("metadata") or {}).get("title")
        or "Sin título"
    )
    meta = deepcopy(DEFAULT_METADATA)
    if isinstance(data.get("metadata"), dict):
        meta.update(data["metadata"])
    meta["title"] = title

    cells = [_normalize_cell(raw) for raw in (data.get("cells") or [])]
    # Filter: keep code + markdown; ensure at least one code cell for editing
    if not any(c["type"] == "code" for c in cells):
        cells.append(make_code_cell())
    if not cells:
        cells = [make_code_cell()]

    return {
        "nbformat": int(data.get("nbformat") or NBFORMAT),
        "nbformat_minor": int(data.get("nbformat_minor") or NBFORMAT_MINOR),
        "metadata": meta,
        "title": title,
        "cells": cells,
    }


def _cell_to_jupyter(cell: dict[str, Any]) -> dict[str, Any]:
    ctype = cell.get("type") or "code"
    base = {
        "id": str(cell.get("id") or new_cell_id()),
        "metadata": dict(cell.get("metadata") or {}),
        "source": _source_to_lines(_source_to_str(cell.get("source") or "")),
    }
    if ctype == "markdown":
        return {**base, "cell_type": "markdown"}
    if ctype == "raw":
        return {**base, "cell_type": "raw"}
    return {
        **base,
        "cell_type": "code",
        "execution_count": cell.get("execution_count"),
        "outputs": _simple_outputs_to_jupyter(cell.get("outputs")),
    }


def to_ipynb(notebook: dict[str, Any]) -> dict[str, Any]:
    nb = normalize_notebook(notebook)
    meta = dict(nb.get("metadata") or {})
    meta["title"] = nb.get("title") or meta.get("title") or "Sin título"
    return {
        "nbformat": NBFORMAT,
        "nbformat_minor": NBFORMAT_MINOR,
        "metadata": meta,
        "cells": [_cell_to_jupyter(c) for c in nb["cells"]],
    }


def load_notebook_file(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return normalize_notebook(raw)


def save_notebook_file(path: Path, notebook: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = to_ipynb(notebook)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


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
