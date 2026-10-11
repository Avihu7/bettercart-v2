# BetterCart v2 — Local Run Guide

## Requirements

- Node.js 20.12+ (check: `node --version`)
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

1. Create `.env.local` in the project root (git-ignored; the server loads it):
   ```
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```
   The key is a server setting. Do not use a `VITE_` name for it: `VITE_`
   variables are built into the browser bundle.

2. Restart the API server (`npm run dev:full`).

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
| Receipt upload fails | Set `ANTHROPIC_API_KEY` in `.env.local` and restart the server, or use the demo receipt |
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
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | Integration tests against the running API |
