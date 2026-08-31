# AGDSE — Notebook compartido

Editor colaborativo sobre notebooks Jupyter (`.ipynb`) con proyectos, cuentas, amigos e invitaciones por código.

## Arrancar

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

- Local: `http://127.0.0.1:5000`
- Red local: el link que imprime la consola (misma Wi‑Fi)

## Uso

1. Entrá como **Guest** (por defecto).
2. Unite a un proyecto con un **código de invitación**, o creá una **cuenta** (nombre, color, password).
3. Con cuenta: creá proyectos, agregá amigos e invitalos.
4. Al abrir un proyecto ves el editor de notebooks. La colaboración (cursores, chat, celdas) es solo dentro de ese proyecto.

Los archivos de cada proyecto viven en `projects/<id>/`. Cuentas y metadata en `data/`.

## Atajos

- `Ctrl/Cmd + Enter` en una celda: ejecutar
- Run / + / Eliminar en la barra de cada celda
