// General questions over the stored data: "which <things> where <conditions>, show <fields>, sorted, top N,
// how many, per <field>". The AI only fills in the query; this file checks every part and runs it on rows that
// the person may see. Nothing is ever silently ignored: an unknown dataset, field or condition gets a clear reply.
//
// Who sees what (decided here, never by the AI):
//   jcs      Saheb + Super Admin (Gmail, active, last sign-in, Jamaat names: Super Admin only)
//   users    Super Admin
//   jamiats  everyone (a JC: only their Jamiats); JC names: Saheb + Super Admin
//   jamaats  everyone (a JC: only their Jamaats); JC names: Saheb + Super Admin
//   metrics  Saheb + Super Admin
//   stats    everyone (a JC: only their Jamiats)
//   data     the Data tab's Excel rows: JC (their rows) + Super Admin
const User = require("../../models/User");
const Jamiat = require("../../models/Jamiat");
const Jamaat = require("../../models/Jamaat");
const JcMetric = require("../../models/JcMetric");
const JcRating = require("../../models/JcRating");
const StatImage = require("../../models/StatImage");
const { DataRow, getConfig } = require("../../models/DataSheet");
const { notDeleted } = require("../../lib/softDelete");
const { monthLabel } = require("../../lib/month");

const ROLE_TEXT = { jc: "JC", saheb: "Saheb", superadmin: "Super Admin" };
const SAHEB_UP = ["saheb", "superadmin"];
const ADMIN = ["superadmin"];
const ALL = ["jc", "saheb", "superadmin"];
const OPS = ["is", "is_not", "contains", "not_contains", "starts_with", "ends_with", "gt", "gte", "lt", "lte", "empty", "not_empty"];
const OP_TEXT = { is: "is", is_not: "is not", contains: "contains", not_contains: "doesn't contain", starts_with: "starts with", ends_with: "ends with", gt: "more than", gte: "at least", lt: "less than", lte: "at most", empty: "is empty", not_empty: "is filled" };
const ROW_CAP = 200;

const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9@.]+/g, " ").trim();
const day = (d) => (d ? new Date(d) : null);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const starsText = (n) => (n ? `${"★".repeat(n)}${"☆".repeat(5 - n)} (${n})` : "Not rated");

// ---------- the datasets ----------
// field: { label, type: text|number|date|bool|list|stars, roles (who may see it), show (cell text) }
const DATASETS = {
  jcs: {
    label: "JCs", one: "JC", roles: SAHEB_UP,
    about: "JCs (coordinators): who they are, what they are assigned, their metrics (permanent work) and star rating",
    defaults: ["name", "jamiats"],
    fields: {
      name: { label: "Name", type: "text" },
      email: { label: "Gmail", type: "text", roles: ADMIN },
      active: { label: "Active", type: "bool", roles: ADMIN },
      jamiats: { label: "Jamiats", type: "list" },
      jamiat_count: { label: "Jamiats assigned", type: "number" },
      jamaats: { label: "Jamaats", type: "list", roles: ADMIN, filter: SAHEB_UP },
      jamaat_count: { label: "Jamaats assigned", type: "number" },
      metrics: { label: "Metrics", type: "list" },
      metric_count: { label: "Metrics added", type: "number" },
      rating: { label: "Star rating", type: "stars" },
      all_jamiats: { label: "Has every Jamiat", type: "bool" },
      last_login: { label: "Last sign-in", type: "date", roles: ADMIN },
    },
  },
  users: {
    label: "Users", one: "user", roles: ADMIN,
    about: "everyone who can sign in (JCs, Sahebs, Super Admins)",
    defaults: ["name", "email", "role"],
    fields: {
      name: { label: "Name", type: "text" }, email: { label: "Gmail", type: "text" }, role: { label: "Role", type: "text" },
      active: { label: "Active", type: "bool" }, jamiats: { label: "Jamiats", type: "list" }, jamiat_count: { label: "Jamiats assigned", type: "number" },
      jamaats: { label: "Jamaats", type: "list" }, jamaat_count: { label: "Jamaats assigned", type: "number" },
      last_login: { label: "Last sign-in", type: "date" }, added: { label: "Added on", type: "date" },
    },
  },
  jamiats: {
    label: "Jamiats", one: "Jamiat", roles: ALL,
    about: "Jamiats (regions), with totals of their Jamaats, the JCs assigned, forms submitted in the month and their Stats image",
    defaults: ["name", "jamaat_count"],
    fields: {
      name: { label: "Jamiat", type: "text" },
      jamaat_count: { label: "Jamaats", type: "number" },
      houses: { label: "Total houses", type: "number" },
      children: { label: "Total children", type: "number" },
      jcs: { label: "JCs", type: "list", roles: SAHEB_UP },
      jc_count: { label: "JCs assigned", type: "number", roles: SAHEB_UP },
      submitted: { label: "Forms submitted", type: "number" },
      not_submitted: { label: "Forms not submitted", type: "number" },
      stats_image: { label: "Stats image uploaded", type: "date" },
      stats_count: { label: "Stats images", type: "number" },
    },
  },
  jamaats: {
    label: "Jamaats", one: "Jamaat", roles: ALL,
    about: "Jamaats (local places): Jamiat, Mauze Type, house count, children, JCs assigned, and whether the month's form was submitted",
    defaults: ["name", "jamiat"],
    fields: {
      name: { label: "Jamaat", type: "text" },
      jamiat: { label: "Jamiat", type: "text" },
      mauze_type: { label: "Mauze Type", type: "text" },
      houses: { label: "Houses", type: "number" },
      children: { label: "Children", type: "number" },
      jcs: { label: "JCs", type: "list", roles: SAHEB_UP },
      jc_count: { label: "JCs assigned", type: "number", roles: SAHEB_UP },
      submitted: { label: "Form submitted", type: "bool" },
      last_saved: { label: "Form last saved", type: "date" },
      remarks: { label: "Remarks", type: "text" },
    },
  },
  metrics: {
    label: "Metrics", one: "metric", roles: SAHEB_UP,
    about: "the metrics JCs entered (permanent work each JC handles, e.g. IT department)",
    defaults: ["text", "jc"],
    fields: {
      text: { label: "Metric", type: "text" },
      jc: { label: "JC", type: "text" },
      jc_jamiats: { label: "JC's Jamiats", type: "list" },
      added: { label: "Added on", type: "date" },
    },
  },
  stats: {
    label: "Stats images", one: "Stats image", roles: ALL,
    about: "the Stats images uploaded for each Jamiat (current one and history)",
    defaults: ["jamiat", "title", "uploaded"],
    fields: {
      jamiat: { label: "Jamiat", type: "text" },
      title: { label: "Title", type: "text" },
      uploaded: { label: "Uploaded on", type: "date" },
      current: { label: "Current", type: "bool" },
    },
  },
  data: {
    label: "Data rows", one: "row", roles: ["jc", "superadmin"],
    about: "the rows of the Excel sheet on the Data tab (one row per line of the sheet), with their columns and the statuses chosen in the dropdowns",
    defaults: null, // the sheet's own columns
    fields: null,   // built from the uploaded sheet
  },
};

/** The datasets (and fields) this role may ask about; `data` gets the sheet's columns. */
async function schemaFor(role, { withSheet = true } = {}) {
  const out = {};
  for (const [key, ds] of Object.entries(DATASETS)) {
    if (!ds.roles.includes(role)) continue;
    let fields = ds.fields;
    if (key === "data") {
      if (!withSheet) continue;
      const cfg = await getConfig();
      if (!cfg.version) continue;
      fields = sheetFields(cfg);
    }
    const visible = Object.fromEntries(Object.entries(fields).filter(([, f]) => !f.roles || f.roles.includes(role)));
    const filterOnly = Object.fromEntries(Object.entries(fields).filter(([k, f]) => !visible[k] && f.filter && f.filter.includes(role)));
    out[key] = { ...ds, fields: visible, filterOnly };
  }
  return out;
}
function sheetKey(name) { return norm(name).replace(/ /g, "_").slice(0, 60) || "column"; }
function sheetFields(cfg) {
  const f = { jamiat: { label: "Jamiat", type: "text" }, jamaat: { label: "Jamaat", type: "text" } };
  cfg.columns.forEach((c, i) => {
    if (i === cfg.jamiatCol || i === cfg.jamaatCol) return;
    let k = sheetKey(c.name);
    while (f[k]) k += "_";
    f[k] = { label: c.name, type: "text", col: i };
    if (c.dropdown) f[`${k}_status`] = { label: `${c.name} (status)`, type: "text", col: i, status: true };
  });
  return f;
}

/** A short description of the datasets for the AI (names and fields only, never data). */
function describeSchema(schema) {
  return Object.entries(schema).map(([k, ds]) => {
    const fields = Object.entries(ds.fields).map(([fk, f]) => `${fk}${f.type === "text" ? "" : `(${f.type})`}`);
    const label = k === "data" ? ` Columns: ${Object.entries(ds.fields).map(([fk, f]) => `${fk}="${f.label}"`).join(", ")}` : "";
    return `- ${k}: ${ds.about}. Fields: ${fields.join(", ")}.${label}`;
  }).join("\n");
}

// ---------- rows ----------
async function loadRows(dataset, schema, scope, user) {
  const role = user.role;
  const myJamiats = new Set(scope.jamiats.map((j) => String(j._id)));
  const myJamaats = new Set(scope.jamaats.map((j) => j.id));

  if (dataset === "jcs" || dataset === "users") {
    const filter = { ...notDeleted(), ...(dataset === "jcs" ? { role: "jc" } : {}), ...(role === "saheb" ? { isActive: true } : {}) };
    const [people, jts, jms, metrics, ratings] = await Promise.all([
      User.find(filter).select("name email username role isActive jamiats jamaats lastLoginAt createdAt").lean(),
      Jamiat.find(notDeleted()).select("name").lean(),
      Jamaat.find(notDeleted()).select("name").lean(),
      JcMetric.find({}).sort({ createdAt: 1 }).select("user text").lean(),
      JcRating.find({}).select("user stars").lean(),
    ]);
    const jt = new Map(jts.map((j) => [String(j._id), j.name]));
    const jm = new Map(jms.map((j) => [String(j._id), j.name]));
    const mets = new Map();
    for (const m of metrics) { const k = String(m.user); if (!mets.has(k)) mets.set(k, []); mets.get(k).push(m.text); }
    const stars = new Map(ratings.map((r) => [String(r.user), r.stars]));
    const allJ = jts.map((j) => String(j._id));
    return people.map((u) => {
      const jc = u.role === "jc";
      const jtIds = (u.jamiats || []).map(String);
      const names = (ids, map) => ids.map((id) => map.get(id)).filter(Boolean).sort();
      return {
        name: u.name || (role === "superadmin" ? u.email || u.username || "" : "JC (no name set)"),
        hasName: !!u.name,
        email: u.email || u.username || "",
        role: ROLE_TEXT[u.role] || u.role,
        active: u.isActive !== false,
        jamiats: jc ? names(jtIds, jt) : [],
        jamiat_count: jc ? names(jtIds, jt).length : 0,
        jamaats: jc ? names((u.jamaats || []).map(String), jm) : [],
        jamaat_count: jc ? names((u.jamaats || []).map(String), jm).length : 0,
        metrics: jc ? mets.get(String(u._id)) || [] : [],
        metric_count: jc ? (mets.get(String(u._id)) || []).length : 0,
        rating: jc ? stars.get(String(u._id)) || null : null,
        all_jamiats: jc && allJ.length > 0 && allJ.every((id) => jtIds.includes(id)),
        last_login: day(u.lastLoginAt),
        added: day(u.createdAt),
        _jc: jc,
        _jtIds: jtIds,
        _jmIds: (u.jamaats || []).map(String),
      };
    });
  }

  if (dataset === "jamiats" || dataset === "jamaats") {
    const jcs = SAHEB_UP.includes(role) ? await User.find({ role: "jc", isActive: true, ...notDeleted() }).select("name email jamiats jamaats").lean() : [];
    const jcName = (u) => u.name || (role === "superadmin" ? u.email : "JC (no name set)");
    if (dataset === "jamaats") {
      return scope.jamaats.map((x) => {
        const e = scope.entryOf.get(x.id);
        const who = jcs.filter((u) => (u.jamaats || []).map(String).includes(x.id) && (u.jamiats || []).map(String).includes(x.jamiatId));
        return {
          name: x.name, jamiat: x.jamiat, mauze_type: x.mauzeType || "", houses: x.houseCount, children: x.children == null ? null : x.children,
          jcs: who.map(jcName).sort(), jc_count: who.length,
          submitted: !!e, last_saved: e ? day(e.updatedAt) : null, remarks: (e && e.remarks) || "",
          _jamiatId: x.jamiatId, _id: x.id,
        };
      });
    }
    const imgs = await StatImage.find({ jamiat: { $in: [...myJamiats] } }).select("jamiat createdAt").sort({ createdAt: -1 }).lean();
    return scope.jamiats.map((j) => {
      const id = String(j._id);
      const pool = scope.jamaats.filter((x) => x.jamiatId === id);
      const sum = (k) => pool.reduce((n, x) => n + (Number(x[k]) || 0), 0);
      const done = pool.filter((x) => scope.entryOf.has(x.id)).length;
      const who = jcs.filter((u) => (u.jamiats || []).map(String).includes(id));
      const mine = imgs.filter((s) => String(s.jamiat) === id);
      return {
        name: j.name, jamaat_count: pool.length, houses: sum("houseCount"), children: sum("children"),
        jcs: who.map(jcName).sort(), jc_count: who.length,
        submitted: done, not_submitted: pool.length - done,
        stats_image: mine.length ? day(mine[0].createdAt) : null, stats_count: mine.length,
        _id: id,
      };
    });
  }

  if (dataset === "metrics") {
    const [metrics, users, jts] = await Promise.all([
      JcMetric.find({}).sort({ createdAt: 1 }).lean(),
      User.find({ role: "jc", ...notDeleted(), ...(role === "saheb" ? { isActive: true } : {}) }).select("name email jamiats").lean(),
      Jamiat.find(notDeleted()).select("name").lean(),
    ]);
    const by = new Map(users.map((u) => [String(u._id), u]));
    const jt = new Map(jts.map((j) => [String(j._id), j.name]));
    return metrics.filter((m) => by.has(String(m.user))).map((m) => {
      const u = by.get(String(m.user));
      return { text: m.text, jc: u.name || (role === "superadmin" ? u.email : "JC (no name set)"), jc_jamiats: (u.jamiats || []).map((id) => jt.get(String(id))).filter(Boolean).sort(), added: day(m.createdAt) };
    });
  }

  if (dataset === "stats") {
    const imgs = await StatImage.find({ jamiat: { $in: [...myJamiats] } }).select("jamiat title fileName createdAt").sort({ createdAt: -1 }).lean();
    const seen = new Set();
    const jName = new Map(scope.jamiats.map((j) => [String(j._id), j.name]));
    return imgs.map((s) => {
      const k = String(s.jamiat);
      const current = !seen.has(k);
      seen.add(k);
      return { jamiat: jName.get(k) || "", title: s.title || s.fileName || "", uploaded: day(s.createdAt), current };
    });
  }

  if (dataset === "data") {
    const cfg = await getConfig();
    if (!cfg.version) return [];
    const fields = schema.data.fields;
    const filter = { version: cfg.version, ...(role === "jc" ? { jamaat: { $in: [...myJamaats] }, jamiat: { $in: [...myJamiats] } } : {}) };
    const rows = await DataRow.find(filter).select("jamiat jamaat order cells picks").sort({ order: 1 }).lean();
    const [jts, jms] = await Promise.all([Jamiat.find({ _id: { $in: [...new Set(rows.map((r) => r.jamiat))] } }).select("name").lean(), Jamaat.find({ _id: { $in: [...new Set(rows.map((r) => r.jamaat))] } }).select("name").lean()]);
    const jt = new Map(jts.map((j) => [String(j._id), j.name]));
    const jm = new Map(jms.map((j) => [String(j._id), j.name]));
    return rows.map((r) => {
      const o = { jamiat: jt.get(String(r.jamiat)) || "", jamaat: jm.get(String(r.jamaat)) || "" };
      for (const [k, f] of Object.entries(fields)) if (f.col != null) o[k] = f.status ? (r.picks && r.picks[f.col]) || "" : (r.cells && r.cells[f.col]) || "";
      return o;
    });
  }
  return [];
}

// ---------- conditions ----------
function toNumber(v) {
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && String(v).trim() !== "" ? n : NaN;
}
function toDate(v) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(String(v || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1))) : null;
}
function toBool(v) {
  if (v === true || v === false) return v;
  const s = norm(v);
  if (["true", "yes", "y", "1", "active", "submitted", "done", "current"].includes(s)) return true;
  if (["false", "no", "n", "0", "inactive", "not submitted", "old", "earlier"].includes(s)) return false;
  return null;
}
const textIs = (a, b) => norm(a) === norm(b) || norm(a).replace(/ /g, "") === norm(b).replace(/ /g, "");
const textHas = (a, b) => { const x = norm(a), y = norm(b); return !!y && (x === y || (` ${x} `).includes(` ${y} `) || (y.length >= 3 && x.includes(y))); };

const wordIn = (a, b) => { const y = norm(b); return !!y && (` ${norm(a)} `).includes(` ${y} `); };
/** The strictest way of matching v that finds something among all the values: exact, whole word, then part of a word. */
function matcher(pool, v, op = "is") {
  const y = norm(v);
  if (op === "starts_with") return (x) => !!y && norm(x).startsWith(y);
  if (op === "ends_with") return (x) => !!y && norm(x).endsWith(y);
  if ((op === "contains" || op === "not_contains") && y.length < 3) return (x) => !!y && norm(x).includes(y);
  if (pool.some((x) => textIs(x, v))) return (x) => textIs(x, v);
  if (pool.some((x) => wordIn(x, v))) return (x) => wordIn(x, v);
  return (x) => textHas(x, v);
}

/** Checks one condition; returns { test, words } or { error }. `rows` = everything this person may see. */
function condition(c, ds, dsKey, rows = []) {
  const field = ds.fields[c.field] || (ds.filterOnly || {})[c.field];
  const pool = () => rows.flatMap((r) => (Array.isArray(r[c.field]) ? r[c.field] : [r[c.field]])).filter((x) => x != null && x !== "");
  if (!field) {
    return { error: `I can't check “${c.field}” for ${ds.label}. What I know about ${ds.label}: ${Object.values(ds.fields).map((f) => f.label).join(", ")}.` };
  }
  const op = OPS.includes(c.op) ? c.op : "is";
  const v = c.value;
  const words = (val) => `${field.label} ${OP_TEXT[op]}${val === undefined ? "" : ` ${val}`}`;
  if (op === "empty" || op === "not_empty") {
    const isEmpty = (x) => x == null || x === "" || (Array.isArray(x) && !x.length) || (field.type === "number" && x === 0 && /count/.test(c.field));
    const w = field.type === "stars" ? (op === "empty" ? "not rated yet" : "rated") : words();
    return { test: (row) => (op === "empty" ? isEmpty(row[c.field]) : !isEmpty(row[c.field])), words: w };
  }
  switch (field.type) {
    case "number":
    case "stars": {
      const n = toNumber(v);
      if (Number.isNaN(n)) return { error: `“${v}” is not a number for ${field.label}.` };
      if (field.type === "stars" && (n < 0 || n > 5)) return { error: "A star rating is from 1 to 5." };
      const cmp = { is: (x) => x === n, is_not: (x) => x !== n, gt: (x) => x > n, gte: (x) => x >= n, lt: (x) => x < n, lte: (x) => x <= n, contains: (x) => x === n, not_contains: (x) => x !== n, starts_with: (x) => x === n, ends_with: (x) => x === n }[op];
      // Not rated = no rating: it is never "more than 2 stars", and "less than 3" means rated 1 or 2.
      const get = (row) => (field.type === "stars" ? row[c.field] || 0 : Number(row[c.field]) || 0);
      const rated = (row) => field.type !== "stars" || !!row[c.field] || (n === 0 && ["is", "lte", "lt"].includes(op));
      return { test: (row) => rated(row) && cmp(get(row)), words: field.type === "stars" ? `rated ${{ is: "", is_not: "not ", gt: "more than ", gte: "at least ", lt: "less than ", lte: "at most " }[op] || ""}${n} star${n === 1 ? "" : "s"}` : op === "is" ? `${field.label}: ${n}` : words(n) };
    }
    case "date": {
      const d = toDate(v);
      if (!d) return { error: `“${v}” is not a date for ${field.label} (use a date like 2026-11-18).` };
      const dayOf = (x) => (x ? Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()) : null);
      const monthOnly = /^\d{4}-\d{2}$/.test(String(v));
      const t = d.getTime();
      const end = monthOnly ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 86400000 : t;
      const cmp = { is: (x) => x >= t && x <= end, is_not: (x) => x < t || x > end, gt: (x) => x > end, gte: (x) => x >= t, lt: (x) => x < t, lte: (x) => x <= end, contains: (x) => x >= t && x <= end, not_contains: (x) => x < t || x > end }[op] || ((x) => x >= t && x <= end);
      return { test: (row) => { const x = dayOf(row[c.field]); return x != null && cmp(x); }, words: `${field.label} ${{ gt: "after", gte: "on or after", lt: "before", lte: "on or before" }[op] || OP_TEXT[op]} ${monthOnly ? String(v) : fmtDate(d)}` };
    }
    case "bool": {
      const b = toBool(v === undefined ? true : v);
      if (b === null) return { error: `“${v}” should be yes or no for ${field.label}.` };
      const want = op === "is_not" ? !b : b;
      return { test: (row) => !!row[c.field] === want, words: `${field.label}: ${want ? "yes" : "no"}` };
    }
    case "list": {
      if (v == null || v === "") return { error: `Say which value ${field.label} should have.` };
      const vals = Array.isArray(v) ? v : [v];
      const all = pool();
      const fits = vals.map((val) => matcher(all, val, op));
      const any = (row) => fits.every((fit) => (row[c.field] || []).some(fit));
      const neg = op === "is_not" || op === "not_contains";
      const how = op === "starts_with" ? "starting with " : op === "ends_with" ? "ending with " : "";
      return { test: (row) => (neg ? !any(row) : any(row)), words: `${field.label} ${neg ? "don't include" : "include"} ${how}${vals.join(", ")}` };
    }
    default: { // text
      if (["gt", "gte", "lt", "lte"].includes(op)) {
        const n = toNumber(v);
        if (Number.isNaN(n)) return { error: `“${OP_TEXT[op]}” needs a number for ${field.label}.` };
        const cmp = { gt: (x) => x > n, gte: (x) => x >= n, lt: (x) => x < n, lte: (x) => x <= n }[op];
        return { test: (row) => { const x = toNumber(row[c.field]); return !Number.isNaN(x) && cmp(x); }, words: words(n) };
      }
      if (v == null || v === "") return { error: `Say what ${field.label} should be.` };
      const neg = op === "is_not" || op === "not_contains";
      // "Dhar" = DHAR (not DHARAMPURI); "Ebrahim" = every "Ebrahim …"; only if nothing fits that way, a part of a word.
      const fit = dsKey === "data" && (op === "is" || op === "is_not") ? (x) => textIs(x, v) : matcher(pool(), v, op);
      return { test: (row) => { const hit = fit(row[c.field]); return neg ? !hit : hit; }, words: words(`“${v}”`) };
    }
  }
}

// ---------- show ----------
function cell(row, key, field, full = false) {
  const v = row[key];
  switch (field.type) {
    case "list": {
      const n = v || [];
      return n.length > 6 && !full ? `${n.slice(0, 6).join(", ")} +${n.length - 6} more` : n.join(", ") || "—";
    }
    case "stars": return starsText(v);
    case "date": return v ? fmtDate(v) : "—";
    case "bool": return v ? "Yes" : "No";
    case "number": return v == null ? "Not set" : String(v);
    default: return v === "" || v == null ? "—" : String(v);
  }
}
const sortValue = (row, key, field) => {
  const v = row[key];
  if (field.type === "list") return (v || []).length;
  if (field.type === "date") return v ? v.getTime() : null;
  if (field.type === "bool") return v ? 1 : 0;
  if (field.type === "number" || field.type === "stars") return v == null || (field.type === "stars" && !v) ? null : Number(v);
  const n = toNumber(v);
  return Number.isNaN(n) ? norm(v) : n;
};

/** Runs a query intent for this person. Returns reply blocks. */
async function runQuery(q, scope, user) {
  const text = (t) => ({ type: "text", text: t });
  const schema = await schemaFor(user.role);
  const dsKey = q.dataset;
  if (!DATASETS[dsKey]) return [text(`I don't know about “${dsKey}”. I can answer about: ${Object.values(schema).map((d) => d.label).join(", ")}, and the JC form answers.`)];
  const ds = schema[dsKey];
  if (!ds) {
    if (dsKey === "data") {
      const cfg = await getConfig();
      if (DATASETS.data.roles.includes(user.role) && !cfg.version) return [text("No Excel data has been uploaded on the Data tab yet.")];
    }
    return [text(user.role === "jc" ? "That information is only available to the Saheb and the Super Admin." : `Details about ${DATASETS[dsKey].label} are only available to the ${DATASETS[dsKey].roles.map((r) => ROLE_TEXT[r]).join(" and ")}.`)];
  }

  // Close names for fields ("jcs"/"who" = name, "gmail" = email, "stars" = rating, "jamiat" on JCs = jamiats).
  const known = { ...ds.fields, ...(ds.filterOnly || {}) };
  const full = DATASETS[dsKey].fields || ds.fields; // hidden fields keep their name (and get "only shown to …")
  const alias = (f) => {
    if (!f || known[f] || full[f]) return f;
    const a = { gmail: "email", mail: "email", stars: "rating", star: "rating", ratings: "rating", jamiat: "jamiats", jamaat: "jamaats", metric: "metrics", houses_count: "houses", house_count: "houses", mauze: "mauze_type" }[f];
    if (a && known[a]) return a;
    if ((f === dsKey || f === ds.one.toLowerCase() || ["names", "jc", "jcs", "who", "person", "user", "users"].includes(f)) && known.name) return "name";
    if (known[`${f}s`]) return `${f}s`;
    if (known[f.replace(/s$/, "")]) return f.replace(/s$/, "");
    return f;
  };
  q = { ...q, fields: q.fields && [...new Set(q.fields.map(alias))], where: (q.where || []).map((c) => ({ ...c, field: alias(c.field) })), sort: q.sort && { ...q.sort, field: alias(q.sort.field) }, group_by: alias(q.group_by) };

  // A place name in the wrong field: "JC of Dhar" asked as Jamiats, but DHAR is a Jamaat (and the other way round).
  const isJamiat = (v) => scope.jamiats.some((j) => textIs(j.name, v) || wordIn(j.name, v));
  const isJamaat = (v) => scope.jamaats.some((j) => textIs(j.name, v) || wordIn(j.name, v));
  const swap = { jcs: { jamiats: "jamaats", jamaats: "jamiats" }, users: { jamiats: "jamaats", jamaats: "jamiats" }, jamaats: { jamiat: "name", name: "jamiat" }, data: { jamiat: "jamaat", jamaat: "jamiat" } }[dsKey] || {};
  q.where = q.where.map((c) => {
    const other = swap[c.field];
    if (!other || !known[other] || c.value == null || Array.isArray(c.value) || ["empty", "not_empty"].includes(c.op)) return c;
    const wantsJamiat = /jamiat/.test(c.field);
    const fits = wantsJamiat ? isJamiat(c.value) : isJamaat(c.value);
    const fitsOther = wantsJamiat ? isJamaat(c.value) : isJamiat(c.value);
    return !fits && fitsOther ? { ...c, field: other } : c;
  });

  // A place this person can't see (or that doesn't exist): say so, like the other answers do.
  const PLACE = { jamiats: "jamiat", jamaats: "jamaat", jamiat: "jamiat", jamaat: "jamaat" };
  for (const c of q.where) {
    const kind = PLACE[c.field] || (dsKey === "jamaats" && c.field === "name" ? "jamaat" : dsKey === "jamiats" && c.field === "name" ? "jamiat" : null);
    if (!kind || !["is", "contains"].includes(c.op || "is") || c.value == null || Array.isArray(c.value) || typeof c.value !== "string") continue;
    if (isJamiat(c.value) || isJamaat(c.value) || scope.jamiats.some((j) => textHas(j.name, c.value)) || scope.jamaats.some((j) => textHas(j.name, c.value))) continue;
    const mine = user.role === "jc";
    return [text(`I couldn't find a ${kind === "jamiat" ? "Jamiat" : "Jamaat"} called “${c.value}”${mine ? ` among your ${kind === "jamiat" ? "Jamiats" : "Jamaats"}` : ""}.${mine && kind === "jamiat" ? ` Your Jamiats are: ${scope.jamiats.map((j) => j.name).join(", ")}.` : ""}`)];
  }

  // Every condition must be understood; otherwise say so (never answer with everything).
  const allRows = await loadRows(dsKey, schema, scope, user);
  const conds = [];
  for (const c of q.where) {
    const r = condition(c, ds, dsKey, allRows);
    if (r.error) return [text(r.error)];
    conds.push(r);
  }
  // Fields asked for that this person can't see: say so.
  const hidden = (q.fields || []).filter((f) => DATASETS[dsKey].fields && DATASETS[dsKey].fields[f] && !ds.fields[f]);
  const unknown = (q.fields || []).filter((f) => !(DATASETS[dsKey].fields || ds.fields)[f] && !ds.fields[f]);
  if (unknown.length) return [text(`I don't have “${unknown.join("”, “")}” for ${ds.label}. What I know about ${ds.label}: ${Object.values(ds.fields).map((f) => f.label).join(", ")}.`)];
  const seers = (f) => (DATASETS[dsKey].fields[f].roles || []).map((r) => ROLE_TEXT[r]).join(" and ");
  const notes = hidden.length ? [text(`${hidden.map((f) => `${DATASETS[dsKey].fields[f].label}: only shown to the ${seers(f)}.`).join(" ")}`)] : [];

  let rows = allRows.filter((row) => conds.every((c) => c.test(row)));
  const what = conds.map((c) => c.words);
  const monthNote = ["jamiats", "jamaats"].includes(dsKey) && (q.where || []).concat(q.fields || [], q.sort ? [q.sort] : []).some((x) => /submitted|last_saved|remarks/.test(typeof x === "string" ? x : x.field)) ? ` · ${monthLabel(scope.month)}` : "";
  const title = `${ds.label}${what.length ? ` where ${what.join(" and ")}` : ""}${monthNote}`.replace(/ where (rated|not rated)/, " $1");

  // How many / per value
  if (q.group_by) {
    const f = ds.fields[q.group_by];
    if (!f) return [text(`I can't group ${ds.label} by “${q.group_by}”. What I know: ${Object.values(ds.fields).map((x) => x.label).join(", ")}.`)];
    const counts = new Map();
    for (const row of rows) {
      const vals = f.type === "list" ? (row[q.group_by] || []) : [cell(row, q.group_by, f)];
      for (const v of vals.length ? vals : ["—"]) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    return [...notes, text(`**${title}**, by ${f.label}: ${rows.length} in all.`), { type: "table", columns: [f.label, ds.label], rows: list.map(([k, n]) => [String(k), String(n)]) }];
  }
  if (q.count_only) return [...notes, text(`**${title}**: ${rows.length}.`)];

  // Sort / top N (ties at the cut are kept)
  let sortWords = "";
  if (q.sort && q.sort.field) {
    const f = ds.fields[q.sort.field];
    if (!f) return [text(`I can't sort ${ds.label} by “${q.sort.field}”. What I know: ${Object.values(ds.fields).map((x) => x.label).join(", ")}.`)];
    const dir = q.sort.dir === "asc" ? 1 : -1;
    rows = rows.map((r) => [r, sortValue(r, q.sort.field, f)]).sort((a, b) => {
      if (a[1] == null && b[1] == null) return 0;
      if (a[1] == null) return 1; // empty / not rated last
      if (b[1] == null) return -1;
      return (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) * dir;
    }).map((x) => x[0]);
    if (f.type === "stars") rows = rows.filter((r) => r[q.sort.field]); // "highest rated" = rated ones
    const lbl = f.label.toLowerCase().replace(/ (added|assigned)$/, "");
    sortWords = f.type === "date" ? `${dir === -1 ? "latest" : "earliest"} ${lbl}` : f.type === "number" || f.type === "list" ? `${dir === -1 ? "most" : "fewest"} ${f.type === "list" || /^(jamaats|jamiats|metrics|jcs)$/.test(lbl) ? f.label.replace(/ (added|assigned)$/, "") : lbl}` : `${dir === -1 ? "highest" : "lowest"} ${lbl}`;
  } else {
    const first = ds.fields.name ? "name" : ds.fields.jamiat ? "jamiat" : null;
    if (first && dsKey !== "data") rows = [...rows].sort((a, b) => String(a[first]).localeCompare(String(b[first])));
  }
  let limited = false;
  if (q.limit && rows.length > q.limit) {
    const f = q.sort && ds.fields[q.sort.field];
    const edge = f ? sortValue(rows[q.limit - 1], q.sort.field, f) : null;
    rows = rows.filter((r, i) => i < q.limit || (f && sortValue(r, q.sort.field, f) === edge));
    limited = true;
  }

  // Which columns: what was asked; else the defaults + what the question is about.
  const asked = (q.fields || []).filter((f) => ds.fields[f]);
  let cols = asked.length ? asked : [...(ds.defaults || Object.keys(ds.fields).slice(0, 6))];
  if (!asked.length) {
    for (const c of q.where || []) if (!cols.includes(c.field)) cols.push(c.field);
    if (q.sort && q.sort.field && !cols.includes(q.sort.field)) cols.push(q.sort.field);
  }
  cols = cols.filter((c) => ds.fields[c]);
  const headTitle = limited && sortWords
    ? `${rows.length === 1 ? ds.one : `Top ${rows.length} ${ds.label}`}${rows.length === 1 && what.length ? ` (${what.join(" and ")})` : rows.length > 1 && what.length ? ` where ${what.join(" and ")}` : ""} with the ${sortWords}`
    : `${title}${sortWords ? ` (${sortWords} first)` : ""}`;
  if (!rows.length) return [...notes, text(`**${headTitle}**: none.`)];
  const values = rows.map((r) => cols.map((c) => {
    if (c === "name" && (dsKey === "jcs" || dsKey === "users") && !r.hasName && cols.includes("email")) return "(no name set)";
    return cell(r, c, ds.fields[c]);
  }));
  // One thing, one value asked (the name/Gmail beside it don't count): answer in a sentence.
  const valueCols = cols.filter((c) => c !== "name" && !(c === "email" && cols.length > 1));
  if (asked.length && rows.length === 1 && (cols.length === 1 || (valueCols.length === 1 && !limited))) {
    // Say WHAT the number/value is and WHOSE it is ("Jamiats assigned to EBRAHIM MORKAS: 25"), not "JCs where …: 1".
    const c = cols.length === 1 ? cols[0] : valueCols[0], r = rows[0];
    values[0] = [cell(r, c, ds.fields[c], true)];
    const who = ds.fields.name && c !== "name" && r.name && (dsKey !== "jcs" && dsKey !== "users" || r.hasName) ? r.name : null;
    if (who) {
      const label = ds.fields[c].label;
      const link = /assigned$/i.test(label) ? "to" : "of";
      return [...notes, text(`**${label} ${link} ${who}**: ${values[0][0]}`)];
    }
    if (cols.length > 1) return [...notes, text(`**${ds.fields[c].label}** (the ${ds.one}${what.length ? ` where ${what.join(" and ")}` : ""}): ${values[0][0]}`)];
    return [...notes, text(`**${headTitle}**: ${values[0][0]}`)];
  }
  const capped = values.length > ROW_CAP;
  return [...notes, text(`**${headTitle}**${limited && sortWords ? ":" : `: ${rows.length}.`}`),
    { type: "table", columns: cols.map((c) => ds.fields[c].label), rows: values.slice(0, ROW_CAP), ...(capped ? { note: `Showing the first ${ROW_CAP} of ${values.length}.` } : {}) }];
}

module.exports = { runQuery, schemaFor, describeSchema, DATASETS, OPS };
