# BetterCart v2 — Local Run Guide

## Requirements

- Node.js 18+ (check: `node --version`)
- npm 9+ (check: `npm --version`)
- No external database or cloud service required

---

## Install

```bash
cd ~/Desktop/bettercart_v2
npm install
```

---

## Run (development)

### Frontend only (no AI, demo data)
```bash
npm run dev
```
Open: http://localhost:5173

### Full stack (frontend + backend API server)
```bash
npm run dev:full
```
- Frontend: http://localhost:5173
- API server: http://localhost:3001

### Backend server only
```bash
npm run dev:server
```

---

## Build (production)

```bash
npm run build
```

Output goes to `dist/`. Serve with:
```bash
npm run preview
```

---

## Enable AI Features (optional)

To use real Claude AI instead of demo data:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your Anthropic API key:
   ```
   VITE_ANTHROPIC_API_KEY=sk-ant-...
   VITE_API_URL=http://localhost:3001
   ```

3. Restart the dev server.

> **Without an API key:** The app runs fully in demo mode using pre-built responses. All UI flows work normally.

---

## Database

SQLite database is created automatically at `server/bettercart.db` on first run.  
To reset all data: delete `server/bettercart.db` and restart the server.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm run dev` shows blank page | Check that `node_modules` exists — run `npm install` |
| Shopping list or nutrition plan fails | Start the API server: `npm run dev:server` (port 3001 required) |
| "Failed to fetch" errors in browser | API server not running — run `npm run dev:full` |
| Receipt upload fails | Either set `VITE_ANTHROPIC_API_KEY` or use "Load Demo" button |
| Port 5173 already in use | Kill the other process or change port in `vite.config.js` |
| Port 3001 already in use | Change `PORT` env var when starting the server |

---

## npm Scripts Summary

| Script | What it does |
|--------|-------------|
| `npm run dev` | Vite dev server on port 5173 |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run server` | Express API server on port 3001 |
| `npm run dev:server` | Express with auto-reload (node --watch) |
| `npm run dev:full` | Frontend + backend concurrently |
| `npm run lint` | ESLint check |
