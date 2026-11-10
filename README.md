# Umoor Sehhat – JC Portal & Sahebo Dashboard

Jamaat Coordinators (JCs) fill each Jamaat's monthly follow-up on the **JC portal**; Sahebo see the
results live on the **dashboard**. Everything is stored in MongoDB (there is no Excel / Google Sheet any more).

```
JC portal (/jc-portal) ──► Express API ──► MongoDB ──► Sahebo dashboard (/)
                                              ▲
                     Masters (/masters, admins: Jamiat & Jamaat lists)
```

| Page | Who | What |
|---|---|---|
| `/jc-portal` | anyone with the link (no sign-in for now) | pick Month → Jamiat → Jamaat, fill the form, Submit |
| `/` | signed-in users | dashboard for a chosen month; refreshes every 2 minutes |
| `/masters` | signed-in **admins** | add / rename / deactivate / delete Jamiats and Jamaats |

## Data (MongoDB collections)

| Collection | Holds |
|---|---|
| `jamiats` | Jamiat master: `name` (unique, stored in capitals), `isActive` |
| `jamaats` | Jamaat master: `jamiat`, `name` (unique inside its Jamiat), `mauzeType`, `houseCount`, `children`, `isActive` |
| `entries` | one per Jamaat per month (`month` = `"YYYY-MM"`): the 9 answers + remarks. Submitting again updates it |
| `users`, `sessions`, `auditlogs` | sign-in and audit trail |

Rules that keep the masters clean:

- Names are saved in capitals with single spaces, so `Ahmedabad`, `AHMEDABAD ` and `ahmedabad` are the same name; duplicates are refused.
- A Jamiat that still has Jamaats, or a Jamaat that has monthly entries, **cannot be deleted** — mark it **inactive** instead.
  Inactive items disappear from the portal and the dashboard; their saved entries are kept.
- Entries point to the Jamaat by ID, so renaming or moving a Jamaat keeps its history.

The JC form questions, answer choices, colours and dashboard cards are defined in
**`server/src/formConfig.js`** (the React app picks them up automatically).
JCs can fill the current month and the 2 months before it (`portalMonthsBack`).

## Tech stack (MERN)

| Part | Used for |
|---|---|
| **MongoDB** + Mongoose | masters, entries, users, sessions, audit log |
| **Express** | API, security headers (helmet), rate limits, serves the built React app |
| **React** + Vite | portal, dashboard and masters UI |
| **Node.js** ≥ 20 | runtime |

## Project structure

```
client/src/
  JcPortal.jsx  Dashboard.jsx  Masters.jsx   the three pages (App.jsx picks one by URL)
  components/   AppBar, PageHead, Kpis, MetricCard, SidePanel, ListDialog …
  hooks/        sign-in, dashboard loading/polling, theme, clock
  lib/          API calls, router, helpers
server/src/
  formConfig.js        form questions, answer sets, colours
  config.js            reads server/.env
  models/              Jamiat, Jamaat, Entry, User, Session, AuditLog
  routes/portal.js     /api/portal/*   (public JC portal)
  routes/masters.js    /api/masters/*  (admins)
  routes/api.js        /api/dashboard, /api/refresh, /api/health
  routes/auth.js       /api/auth/*  ·  routes/audit.js  /api/audit
  services/data.js     builds the dashboard from masters + entries
```

## First-time setup (development)

Requirements: **Node.js 20+**, **MongoDB** (local) and **Git**.

```bash
npm run install:all                     # installs root, server and client packages
copy server\.env.example server\.env    # then edit server/.env
npm run dev                             # API on :5000 + React on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | server (auto-restart) + React dev server |
| `npm run build` | builds the React app into `client/dist` |
| `npm start` | runs the server; it also serves `client/dist` (production mode) |

## Settings (`server/.env`)

| Variable | Meaning |
|---|---|
| `MONGODB_URI`, `MONGODB_DB_NAME` | MongoDB connection and database name |
| `DASHBOARD_REFRESH_SECONDS` | how often an open dashboard reloads (default 120) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | sign-in secrets (required in production) |
| `PORT`, `NODE_ENV`, `CORS_ORIGIN` | server port, `production` in production, website address(es) |

## Sign-in, users and audit log

- **JWT** access token (7 days) + refresh token (30 days), both in **HttpOnly, SameSite=Lax** cookies
  (`Secure` in production). JavaScript in the page can never read them.
- Every login is a **session** in MongoDB (`sessions`). Logout ends it immediately.
  The refresh token is **rotated** on every use; re-using an old one ends the session (theft protection).
- Passwords are stored as **bcrypt** hashes, never in plain text.
- 5 wrong passwords lock the account for 15 minutes; sign-in is also rate-limited per IP.
- POST / PATCH / DELETE requests must come from the website itself (Origin check + `X-Requested-With` header) — CSRF protection.
- In production the website calls `/api/...` on its **own domain**; Vercel forwards it to Render
  (`vercel.json`), so the cookies are first-party and work in Safari/iPhone too.

**Users** (`users` collection): `username`, `passwordHash`, `role` (`admin` | `viewer`), `isActive`.
Admins see the **Masters** page and can read the audit log.

To add a user or reset a password in **Atlas**, put the Atlas connection in `server/.env.atlas` (git-ignored):

```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=US-Jamaat-Wise-Data
```

then (PowerShell, in `server/`):

```
$env:ENV_FILE=".env.atlas"; npm run user:create -- --username ali --password "S3cret!" --role viewer
$env:ENV_FILE=".env.atlas"; npm run user:create -- --username ali --password "New-Pass" --reset
```

**Audit log** (`auditlogs` collection, kept 365 days) — who did what, when, from which IP/browser:

| action | when |
|---|---|
| `entry_submitted` | a JC saved a Jamaat's month on the portal (what changed, IP) |
| `master_created` / `master_updated` / `master_deleted` | Jamiat / Jamaat changes on the Masters page |
| `login_success` / `login_failed` / `login_blocked` / `account_locked` | sign-in attempts |
| `logout`, `token_refreshed`, `token_reuse_detected` | session events |
| `dashboard_opened`, `data_refresh`, `list_viewed` | dashboard use |
| `audit_viewed`, `user_created`, `user_password_reset` | admin actions |

Admins can read it at `GET /api/audit?limit=50&action=entry_submitted` (or in Atlas).

## Hosting: Vercel (website) + Render (API) + MongoDB Atlas (database)

```
Browser ──► Vercel (React website, /api forwarded) ──► Render (Express API) ──► MongoDB Atlas
```

- **Vercel** builds `client/` (`vercel.json`) and forwards `/api/*` to Render.
- **Render** runs `server/` (`render.yaml`). Secrets (`MONGODB_URI`, `CORS_ORIGIN`) are set in the Render dashboard.
- **Atlas** network access must allow `0.0.0.0/0` (Render has no fixed IP).

**Free Render plan:** the API sleeps after ~15 minutes without visitors. A monitor (UptimeRobot or the
GitHub Action in `.github/workflows/keep-alive.yml`) pinging `/api/health` every few minutes keeps it awake.
