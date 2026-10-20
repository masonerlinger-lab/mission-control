# Mission Control

A lightweight local dashboard for monitoring a Windows AI workstation: GPU, CPU, RAM, disk, local AI services, and a long-running model-training job, all on one page.

Zero dependencies: plain Node.js (`node:http`) and one static HTML page.

## Features
- **Live hardware stats** every 2 s: GPU name, utilization, temperature, VRAM, power and fan (via `nvidia-smi`), CPU %, RAM, and free disk space.
- **Service health** for God's Eye View (port 4173), a GeoCLIP inference service (8765) and Ollama (11434), plus the Ollama models loaded and their VRAM.
- **One-click restarts** for GeoCLIP and Ollama (`POST /api/restart/:service`, accepted only from localhost).
- **Warnings** when the GPU passes 78 °C, VRAM passes 95%, RAM passes 90%, or a service goes down.
- **Freeze/stall detective**: keeps an hour of history and logs events (event-loop stalls, GPU temperature or utilization spikes, RAM pressure, GPU driver resets from the Windows event log) together with the top CPU, RAM and GPU processes at that moment.
- **Training panel** that reads a JSON status file from the training pipeline (progress, accuracy, median error in km).

## Tech stack
Node.js 18+ (ES modules), vanilla HTML/CSS/JS, PowerShell, and `nvidia-smi`. Windows only.

## Setup
```powershell
git clone https://github.com/masonerlinger-lab/mission-control
cd mission-control
node server.mjs          # then open http://localhost:4180
```
To run it hidden at login, point a scheduled task at `run-hidden.vbs`.

Optional environment variables (see `.env.example`): `MC_HOME` (where status files live, default: your home folder) and `GEV_REPO` (path to the God's Eye View checkout).

## API
| Endpoint | Description |
|---|---|
| `GET /api/status` | Full snapshot as JSON |
| `POST /api/restart/geoclip` and `POST /api/restart/ollama` | Restart a service |
