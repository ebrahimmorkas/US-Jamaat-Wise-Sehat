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
  A question is either a **dropdown** or a **date picker** (chosen when it is created; date questions have no answers and no dashboard card).
  **Include comment box** (ticked by default for new questions) shows a free-text comment under the answers on the JC portal.
- **Delete = status "D"**: no Delete button erases anything (Jamiats, Jamaats, users, questions, answers, Mauze Type values).
  The record gets `status: "D"` with `deletedAt` / `deletedBy`, becomes inactive and disappears from the dashboards, the JC
  portal and the dropdowns; a deleted user is signed out and can't sign in. Tick **Show deleted** on the admin page to see them
  and **Restore** (back to `status: "A"` and the active/inactive state it had). Names / Gmails stay reserved: adding one that
  belongs to a deleted record asks you to restore it instead. The "in use" protections still apply (e.g. a Jamaat with monthly
  entries can't be deleted: mark it inactive). A deleted Jamiat / Jamaat is taken out of JC assignments (not given back on restore).
- **Jamaat details on the JC portal** (Mauze Type, House Count) are **read-only**; only the Super Admin changes them in Masters.
  If a request still tries to change them (e.g. the locked fields were re-enabled in the browser), nothing is saved and the attempt
  is logged under **Logs → Access denied** with the values that were tried.
- Saheb and Super Admin accounts are created from the command line (below). On first start, old `admin`/`viewer` accounts become **Saheb**.

| Page | Who | What |
|---|---|---|
| `/jc-portal` | **JC** (signed in) | **JC dashboard** for a month (only their own Jamaats, **live**): submitted / not submitted, completion rate, Jamaats needing follow-up, answers not done yet per question; *Fill* / *Update* opens the form for that Jamaat |
| `/jc-portal/form` | **JC** | pick Month → Jamiat → Jamaat, fill the form, Submit |
| `/` | **Saheb** | dashboard for a chosen month; **live**: updates the moment a JC saves |
| `/admin/...` | **Super Admin** | JC users, masters, Portal Fields |

## Data (MongoDB collections)

| Collection | Holds |
|---|---|
| `jamiats` | Jamiat master: `name` (unique, stored in capitals), `isActive` |
| `jamaats` | Jamaat master: `jamiat`, `name` (unique inside its Jamiat), `mauzeType`, `houseCount`, `children`, `isActive` |
| `portalfields` | the JC form questions and their answers (managed by the Super Admin) |
| `entries` | one per Jamaat per Hijri month (`month` = `"YYYY-MM"`, e.g. `"1448-06"`): answers keyed by question (`values`), comments (`comments`) + remarks. Submitting again updates it |
| `activities` | the monthly activities of questions with **Monthly activities** switched on (`field`, `month`, `name`, `order`) |
| `migrations` | one-time data changes already applied (so they never run twice) |
| `users`, `sessions`, `auditlogs` | sign-in and audit trail |

Rules that keep the masters clean:

- Names are saved in capitals with single spaces, so `Ahmedabad`, `AHMEDABAD ` and `ahmedabad` are the same name; duplicates are refused.
- A Jamiat that still has Jamaats, or a Jamaat that has monthly entries, **cannot be deleted** — mark it **inactive** instead.
  Inactive items disappear from the portal and the dashboard; their saved entries are kept.
- Entries point to the Jamaat by ID, so renaming or moving a Jamaat keeps its history.

The JC form questions and their answers are managed in the Super Admin portal (**Portal Fields**);
`server/src/formConfig.js` only holds the starting set, the answer meanings/colours and the months setting.
Entries are saved per **Hijri month** (`YYYY-MM`, no day), so whatever day a JC fills a month, it is found under that month.
**Comments** typed by JCs are not shown on the dashboards directly: the Sahebo dashboard and the JC dashboard only
show how many there are (a **Comments** button, a link on each card / Jamaat row). Opening it loads the text
(`GET /api/dashboard/comments`, `GET /api/portal/comments` — a JC only gets their own Jamaats) and logs `comments_viewed`.

Months are **Hijri months of the Misri (Fatemi) calendar** (calculated, as in Dawoodi Bohra calendars; see
`server/src/lib/month.js`), e.g. Jumadal Ukhra 1448 = 10 Nov – 8 Dec 2026. They are chosen with a **Hijri Month + Year**
picker (defaults to the current Hijri month; the English dates of the month are shown under it). JCs can fill any month
from `firstMonth` (default `1448-05`) up to the current month — never a future month. The Sahebo dashboard offers the
same range plus any older month that has entries. Month names are set in `formConfig.hijriMonthNames`.
(Forms saved under English months before the switch were removed; a copy is in the `entries_gregorian_backup` collection.)

**Monthly activities** (Tibb, Riyadah, Nazafat; any dropdown question can have them — Portal Fields → *Monthly
activities*): the Super Admin adds the activities of each Hijri month (next month can be prepared in advance; *Copy
from last month* repeats a list). On the JC form the JC picks the activity, then its status (and comment); every
activity keeps its own answer, saved as `values["<question key>:<activity id>"]`, so a JC can update week 1 now and
week 2 next week. Activity answers are optional. Each activity gets its own card on the Sahebo dashboard and its own
row on the JC dashboard. An activity already answered can be renamed but not deleted.

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
| `REALTIME_ENABLED` | `false` turns live updates off (default on) |
| `REALTIME_PUBLIC_URL` | address browsers open the live connection to; empty = the website's own address (local). On Render: the Render URL |
| `REALTIME_PATH`, `REALTIME_TICKET_SECONDS`, `REALTIME_PING_SECONDS` | live connection path (`/socket.io`), ticket lifetime (60 s), keep-alive (25 s) |
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
| **Changes (audit trail)** | every data change with **only the fields that changed**, their **previous** and **new** value (users, Jamiats/Jamaats, portal fields & answers, Mauze Type list, JC form saves) |
| **Sign-ins** | successful and refused sign-ins (with the reason, e.g. "Gmail not registered"), sign-outs, stolen-session blocks |
| **Access denied** | a role opening a page or calling something it may not use, a JC opening a Jamaat not assigned to them, requests coming from another website |
| **Errors** | server errors and website crashes, with a **reference** (also shown to the user on the Error page), message, page, user and stack trace |

Stored in MongoDB: `auditlogs` (actions + `target` + `changes: [{ field, label, from, to }]`) and `errorlogs`; both kept 365 days
(`AUDIT_RETENTION_DAYS`). Filters: user, text (Jamaat, question, reference…), date range.

**Error page:** any server error or website crash sends the user to `/error` with the reference.
**Access denied page:** a signed-in user opening another role's page (`/admin/...`, `/jc-portal`) sees it, and the attempt is logged.

## Live updates (Socket.IO)

There is no timed auto-refresh. When a JC saves an entry (or the Super Admin changes Jamiats/Jamaats, portal fields or
the Mauze Type list), the server sends `dashboard:changed` to every open dashboard, which reloads its data at once.
The message holds only *what* changed (`{ reason, month }`), never personal data; the page fetches the data through the
normal API, so all role/access checks still apply. After a dropped connection the dashboard reloads to catch up.
The top bar shows the state: *Live* / *Connecting* / *Paused · reconnecting*. The Refresh button still works.

It is built to be reused by any page:

| Where | What |
|---|---|
| `server/src/realtime/index.js` | `registerTopic(name, { roles, authorize })`, `publish(topic, event, data)`, `sendToUser`, `sendToRole`, `disconnectSession`, `disconnectUser`, `notifyOnSuccess(topic, event, data)` (Express middleware) |
| `server/src/realtime/topics.js` | the topics (`dashboard` → Saheb only) and event names |
| `client/src/lib/realtime.js` | one shared connection per tab: `subscribe(topic, event, handler)`, `onStatus`, `onReconnect`, `stop` |
| `client/src/hooks/useRealtime.js` | `useRealtime(topic, event, handler, { onReconnect })`, `useRealtimeStatus()` |

Adding a new live feature = register a topic in `topics.js`, `publish(...)` where the data changes, `useRealtime(...)` in the page.

Security: the browser first gets a 60-second **ticket** (`POST /api/realtime/ticket`, signed-in only, same-site), sent when
connecting; the server re-checks the session and account on every (re)connect, accepts only our website's origin, and
checks the role per topic. Sign-out, a role change, deactivation or deletion closes that user's live connections.
In production the browser connects **straight to Render** (`REALTIME_PUBLIC_URL`), because Vercel can't forward live
connections; Vercel's `connect-src` allows that address.
## Hosting: Vercel (website) + Render (API) + MongoDB Atlas (database)

```
Browser ──► Vercel (React website, /api forwarded) ──► Render (Express API) ──► MongoDB Atlas
```

- **Vercel** builds `client/` (`vercel.json`) and forwards `/api/*` to Render.
- **Render** runs `server/` (`render.yaml`). Secrets (`MONGODB_URI`, `CORS_ORIGIN`) are set in the Render dashboard.
- **Atlas** network access must allow `0.0.0.0/0` (Render has no fixed IP).

**Free Render plan:** the API sleeps after ~15 minutes without visitors. To stop that, the server **pings its own
public address** (`RENDER_EXTERNAL_URL/api/health`, set by Render) every 10 minutes (`server/src/services/keepAlive.js`;
`KEEP_ALIVE_MINUTES`, `KEEP_ALIVE_ENABLED=false` to turn off, does nothing locally). The request goes through Render's
edge like a visitor's, so the server never counts as idle. The GitHub Action in `.github/workflows/keep-alive.yml`
stays as a backup (GitHub runs scheduled jobs late or skips them, so it's not enough alone).
One always-on free service uses ~744 of the 750 free instance hours a month.
