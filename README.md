# Umoor Sehhat – Sahebo Dashboard

A live, view-only dashboard of the monthly Jamaat follow-up tracker.
Coordinators fill in the Google Sheet; the dashboard on the website shows pending work by Jamiat and Jamaat.

```
Google Sheet ──► Express API (Node) ──► MongoDB (saved copy)
                      │
                      ▼  /api/dashboard  (only the fields the dashboard needs)
                 React app (website)
```

- The browser **never sees the Google Sheet link** — only the server knows it.
- The server re-reads the sheet every **2 minutes** (configurable) and keeps a copy in MongoDB, so the page loads instantly and keeps working if Google is slow.
- No personal data (names, mobile numbers, house counts) is ever sent to the browser.

## Tech stack (MERN)

| Part | Used for |
|---|---|
| **MongoDB** + Mongoose | latest synced snapshot + sync log (30 days) |
| **Express** | API, security headers (helmet), rate limits, serves the built React app |
| **React** + Vite | the dashboard UI |
| **Node.js** ≥ 20 | runtime, Google Sheets access (`googleapis`) |

## Project structure

```
client/                 React app
  src/components/       AppBar, PageHead, Kpis, MetricCard, SidePanel, ListDialog …
  src/hooks/            data loading/polling, theme, clock
  src/lib/              API calls and helpers
  public/               logo, favicon
server/
  src/dashboardConfig.js  WHAT the dashboard shows (cards, columns, statuses, colours)
  src/config.js           reads server/.env
  src/services/sheetReader.js  reads the Google Sheet (public link or service account)
  src/services/sync.js         scheduled sync + MongoDB persistence
  src/routes/api.js            /api/dashboard, /api/refresh, /api/health
  src/models/                  Snapshot, SyncLog
tools/make_dummy.py      fills an Excel copy with dummy dropdown values
```

## First-time setup (development)

Requirements: **Node.js 20+**, **MongoDB** (local) and **Git**.

```bash
npm run install:all                 # installs root, server and client packages
copy server\.env.example server\.env   # then edit server/.env (SHEET_ID etc.)
npm run dev                         # API on :5000 + React on http://localhost:5173
```

Open **http://localhost:5173**.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | server (auto-restart) + React dev server |
| `npm run build` | builds the React app into `client/dist` |
| `npm start` | runs the server; it also serves `client/dist` (production mode) |
| `npm run sync` | one manual sync from the sheet (prints counts) |

If MongoDB is not running, the server still works from memory and logs a warning.

## Settings (`server/.env`)

| Variable | Meaning |
|---|---|
| `SHEET_ID` | ID of the Google Sheet (between `/d/` and `/edit` in its URL) |
| `SHEET_ACCESS` | `public` (sheet shared "Anyone with the link") or `service-account` (private sheet) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` / `_JSON` | service-account key (only for `service-account`) |
| `MONGODB_URI` | MongoDB connection string |
| `SYNC_INTERVAL_SECONDS` | how often the sheet is re-read and the page refreshes (default 120) |
| `MANUAL_REFRESH_COOLDOWN_SECONDS` | minimum gap between Refresh-button syncs (default 15) |
| `PORT`, `NODE_ENV`, `CORS_ORIGIN` | server port, `production` in production, dev frontend URL |

To change the cards, statuses, colours or which sheet columns are read, edit
**`server/src/dashboardConfig.js`** — the React app picks it up automatically.

## Making the Google Sheet private (service account)

Today the sheet is shared "Anyone with the link". When you are ready to share it only with specific
coordinators:

1. Go to <https://console.cloud.google.com/> → create a project (e.g. *umoor-sehhat-dashboard*).
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account** → create it (no roles needed).
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
5. Save it as `server/secrets/service-account.json` (this folder is git-ignored — never commit it).
6. In the Google Sheet → **Share** → add the service account's email
   (looks like `name@project.iam.gserviceaccount.com`) as **Viewer**.
   Add your coordinators' Google accounts as **Editor** as usual.
7. Change General access from "Anyone with the link" to **Restricted**.
8. In `server/.env` set `SHEET_ACCESS=service-account` and restart the server.

On a hosting platform, instead of the file, put the whole JSON key into the
`GOOGLE_SERVICE_ACCOUNT_KEY_JSON` environment variable.

## Production (later)

1. `npm run install:all && npm run build`
2. Set `NODE_ENV=production`, `MONGODB_URI` (e.g. MongoDB Atlas) and the other variables on the host.
3. `npm start` — one Node process serves both the API and the website.
