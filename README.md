# Umoor Sehhat – JC Portal & Sahebo Dashboard

Jamaat Coordinators (JCs) fill each Jamaat's monthly follow-up on the **JC portal**; Sahebo see the
results live on the **dashboard**. Everything is stored in MongoDB (there is no Excel / Google Sheet any more).

```
JC portal (/jc-portal) ──► Express API ──► MongoDB ──► Sahebo dashboard (/)
                                              ▲
        Super Admin portal (/admin: JC users, masters, Portal Fields)
```

### Roles

| Role | Signs in with | Opens |
|---|---|---|
| **Saheb** | Google (Gmail added by the Super Admin) | `/` Sahebo dashboard (only this role) |
| **Super Admin** | Google | `/admin/users` JC users · `/admin/masters` Jamiat/Jamaat masters · `/admin/fields` Portal Fields |
| **JC** | Google | `/jc-portal`, only the Jamiats / Jamaats assigned to them |

- **JC users**: Gmail + the **Jamiats and Jamaats** they look after (searchable pickers, "All" selected by default; saved as explicit lists in `users.jamiats` / `users.jamaats`). When a new Jamiat/Jamaat is added in Masters, the Super Admin is asked whether to give it to the JCs who had access to everything. Deleting a Jamiat/Jamaat removes it from every JC. Gmail only. Gmail ignores dots and `+…`, so `a.b+x@gmail.com` and `ab@gmail.com` count as the same person and can't be added twice.
- **Portal Fields**: the dropdown questions of the JC portal (collection `portalfields`). The Super Admin adds, renames, reorders,
  deactivates or deletes questions; sets each one's section heading, *required*, and *show a card on the dashboard*; and manages
  **each question's own answers**. Every answer has a **meaning** (Done / In progress / Pending / Not done / Not applicable) that
  sets its dashboard colour and whether it counts as done. Renaming an answer renames it in all saved forms; an answer in use
  can't be removed, and a question with saved answers can't be deleted (mark it inactive instead). The Mauze Type list is managed here too.
- Saheb and Super Admin accounts are created from the command line (below). On first start, old `admin`/`viewer` accounts become **Saheb**.

| Page | Who | What |
|---|---|---|
| `/jc-portal` | **JC** (signed in) | pick Month → Jamiat → Jamaat, fill the form, Submit |
| `/` | **Saheb** | dashboard for a chosen month; refreshes every 2 minutes |
| `/admin/...` | **Super Admin** | JC users, masters, Portal Fields |

## Data (MongoDB collections)

| Collection | Holds |
|---|---|
| `jamiats` | Jamiat master: `name` (unique, stored in capitals), `isActive` |
| `jamaats` | Jamaat master: `jamiat`, `name` (unique inside its Jamiat), `mauzeType`, `houseCount`, `children`, `isActive` |
| `portalfields` | the JC form questions and their answers (managed by the Super Admin) |
| `entries` | one per Jamaat per month (`month` = `"YYYY-MM"`): answers keyed by question + remarks. Submitting again updates it |
| `users`, `sessions`, `auditlogs` | sign-in and audit trail |

Rules that keep the masters clean:

- Names are saved in capitals with single spaces, so `Ahmedabad`, `AHMEDABAD ` and `ahmedabad` are the same name; duplicates are refused.
- A Jamiat that still has Jamaats, or a Jamaat that has monthly entries, **cannot be deleted** — mark it **inactive** instead.
  Inactive items disappear from the portal and the dashboard; their saved entries are kept.
- Entries point to the Jamaat by ID, so renaming or moving a Jamaat keeps its history.

The JC form questions and their answers are managed in the Super Admin portal (**Portal Fields**);
`server/src/formConfig.js` only holds the starting set, the answer meanings/colours and the months setting.
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
  formConfig.js        starting questions, answer meanings, months setting
  config.js            reads server/.env
  models/              Jamiat, Jamaat, Entry, User, Session, AuditLog
  routes/portal.js     /api/portal/*   (public JC portal)
  routes/masters.js    /api/masters/*  (Super Admin)
  routes/users.js      /api/users/*    (Super Admin: JC Gmails)
  routes/fields.js     /api/fields/*   (Super Admin: Portal Fields)
  routes/settings.js   /api/settings/* (Super Admin: Mauze Type list)
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
| `GOOGLE_CLIENT_ID` | Google sign-in Client ID (see below) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | session secrets (required in production) |
| `DEV_LOGIN` | `true` = local test sign-in without Google (ignored in production) |
| `PORT`, `NODE_ENV`, `CORS_ORIGIN` | server port, `production` in production, website address(es) |

## Sign-in (Google only), users and audit log

- **Everyone signs in with Google** ("Sign in with Google" button). There are no usernames or passwords.
- **Only Gmail addresses added by a Super Admin can sign in** (Super Admin portal → Users, with a role:
  JC / Saheb / Super Admin). Any other Google account is refused. Deactivating a user signs them out at once.
- The server verifies Google's ID token (signature, our Client ID, expiry, verified email), then starts its own session:
  **JWT** access token (7 days) + refresh token (30 days) in **HttpOnly, SameSite=Lax** cookies (`Secure` in production),
  stored as a **session** in MongoDB; refresh tokens are rotated and re-use ends the session.
- A Super Admin can't deactivate, delete or change the role of their own account, and the last active Super Admin can't be removed.
- POST / PATCH / DELETE requests must come from the website itself (Origin check + `X-Requested-With` header) — CSRF protection.
- In production the website calls `/api/...` on its **own domain**; Vercel forwards it to Render (`vercel.json`).

**First Super Admin** (once per database; after that use the Users page). PowerShell, in `server/`:

```
npm run user:create -- --email name@gmail.com --role superadmin                      # local database
$env:ENV_FILE=".env.atlas"; npm run user:create -- --email name@gmail.com --role superadmin   # Atlas
```

**Google Client ID** (`GOOGLE_CLIENT_ID` in `server/.env` and on Render): Google Cloud Console → APIs & Services →
OAuth consent screen (External) → Credentials → Create credentials → OAuth client ID → *Web application* →
Authorized JavaScript origins: `http://localhost:5173`, `http://localhost:5000`, `https://us-jamaat-wise-sehhat.vercel.app`.

**Local testing without Google:** `DEV_LOGIN=true` in `server/.env` adds "Local testing only — Sign in as <Gmail>" to the
sign-in page (still only registered Gmails). It is ignored when `NODE_ENV=production`.
### Logs (Super Admin portal → Logs)

| Tab | What it shows |
|---|---|
| **All activity** | every action: who, when, IP / browser |
| **Changes (audit trail)** | every data change with **only the fields that changed**, their **previous** and **new** value (users, Jamiats/Jamaats, portal fields & answers, Mauze Type list, JC form saves, Jamaat details changed by a JC) |
| **Sign-ins** | successful and refused sign-ins (with the reason, e.g. "Gmail not registered"), sign-outs, stolen-session blocks |
| **Access denied** | a role opening a page or calling something it may not use, a JC opening a Jamaat not assigned to them, requests coming from another website |
| **Errors** | server errors and website crashes, with a **reference** (also shown to the user on the Error page), message, page, user and stack trace |

Stored in MongoDB: `auditlogs` (actions + `target` + `changes: [{ field, label, from, to }]`) and `errorlogs`; both kept 365 days
(`AUDIT_RETENTION_DAYS`). Filters: user, text (Jamaat, question, reference…), date range.

**Error page:** any server error or website crash sends the user to `/error` with the reference.
**Access denied page:** a signed-in user opening another role's page (`/admin/...`, `/jc-portal`) sees it, and the attempt is logged.
## Hosting: Vercel (website) + Render (API) + MongoDB Atlas (database)

```
Browser ──► Vercel (React website, /api forwarded) ──► Render (Express API) ──► MongoDB Atlas
```

- **Vercel** builds `client/` (`vercel.json`) and forwards `/api/*` to Render.
- **Render** runs `server/` (`render.yaml`). Secrets (`MONGODB_URI`, `CORS_ORIGIN`) are set in the Render dashboard.
- **Atlas** network access must allow `0.0.0.0/0` (Render has no fixed IP).

**Free Render plan:** the API sleeps after ~15 minutes without visitors. A monitor (UptimeRobot or the
GitHub Action in `.github/workflows/keep-alive.yml`) pinging `/api/health` every few minutes keeps it awake.
