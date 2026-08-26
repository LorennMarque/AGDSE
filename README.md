# AGDSE — Notebook compartido

Editor tipo notebook (archivo custom `.agdnb`) con celdas Python, output en vivo, carga de carpetas y cursores compartidos por WebSocket.

## Arrancar

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

- Local: `http://127.0.0.1:5000`
- Red local: el link que imprime la consola (misma Wi‑Fi)

## Formato `.agdnb`

JSON propio del proyecto:

```json
{
  "format": "agdnb",
  "version": 1,
  "title": "Intro",
  "cells": [
    {
      "id": "abc123",
      "type": "code",
      "source": "print('hola')",
      "outputs": [],
      "status": "idle"
    }
  ]
}
```

Los notebooks viven en `workspace/`. Podés cargar una carpeta entera desde la UI.

## Atajos

- `Ctrl/Cmd + Enter` en una celda: ejecutar
- Run / + / Eliminar en la barra de cada celda
