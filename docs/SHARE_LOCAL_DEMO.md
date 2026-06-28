# BetterCart v2 — Sharing a Local Demo via Public Tunnel

**Created:** 2026-06-21  
**Method:** Cloudflare Quick Tunnel (no account required)

---

## Current Live Session

| | URL |
|---|---|
| **Public share link** | `https://basis-perfect-packaging-ide.trycloudflare.com` |
| **Local frontend** | `http://localhost:5173` |
| **Local backend** | `http://localhost:3001` |

> The public URL is temporary and changes every time you restart the tunnel.

---

## How to Start the App

```bash
cd ~/Desktop/bettercart_v2
npm run dev:full
```

Both services start together:
- Vite frontend → port 5173
- Express + SQLite backend → port 3001

---

## How to Start the Tunnel (Cloudflare Quick Tunnel)

In a separate terminal:

```bash
cloudflared tunnel --url http://localhost:5173
```

Cloudflare prints a URL like:
```
https://some-random-words.trycloudflare.com
```

That URL is your share link. Send it to friends.

---

## What the Tunnel Does

The Vite dev server has a proxy configured (`vite.config.js`):

```
External user's browser
  → https://<tunnel>.trycloudflare.com/api/...
  → Vite dev server (port 5173)
  → proxied internally to Express (port 3001)
```

A single public URL covers both the React frontend and all API calls. Friends do not need to know about port 3001 — it is invisible to them.

---

## What Friends Should Test

1. **Landing page** — opens at `/`
2. **Onboarding** — fill in personal details, goals, budget (click "השלמת הפרופיל")
3. **Dashboard** — see the fitness score, stats, BMI card, weight update
4. **Receipt upload** — paste a Hebrew supermarket receipt (or click "הדגמה" for demo data)
5. **Receipt results** — approve/reject items for the menu
6. **Shopping list** — generate an AI-optimised list
7. **Nutrition plan** — generate a 7-day meal plan
8. **Final results** — before/after spending and health score comparison
9. **Print / PDF** — navigate to `/print` to see the printable summary

---

## Known Limitations

| Limitation | Details |
|---|---|
| **No real authentication** | All data is saved under a single demo user |
| **Tunnel is temporary** | Link dies when you close the terminal or put your Mac to sleep |
| **Local SQLite only** | All data lives on your Mac; friends share the same demo profile |
| **AI features need API key** | Without `VITE_ANTHROPIC_API_KEY`, the app uses built-in Hebrew demo data |
| **Prices are from May 2026** | Catalog data from Israeli price-transparency XML (point-in-time) |
| **No HTTPS for localhost** | Backend is HTTP-only; the Cloudflare tunnel provides HTTPS externally |

---

## Processes That Must Stay Running

While friends are testing, keep these alive on your Mac:

1. `npm run dev:full` (terminal 1) — frontend + backend
2. `cloudflared tunnel --url http://localhost:5173` (terminal 2) — the tunnel

If either process stops, the public link goes dead immediately.

---

## Restarting After a Break

```bash
# Terminal 1
cd ~/Desktop/bettercart_v2
npm run dev:full

# Terminal 2 (new URL each time)
cloudflared tunnel --url http://localhost:5173
```

---

## Technical Notes

- `vite.config.js` has `server.allowedHosts: true` and `server.proxy` configured
- `src/lib/serverDB.js` uses a relative base URL (`''`) so API calls work through any origin
- Set `VITE_API_URL=<backend-url>` in `.env` if you ever deploy frontend and backend separately
