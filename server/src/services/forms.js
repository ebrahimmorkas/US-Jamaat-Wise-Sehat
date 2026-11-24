// Forms: the field types, checks on a form's settings and on the answers people send,
// personal links (signed, so the Gmail inside can't be changed) and upload checks.
const crypto = require("crypto");
const config = require("../config");
const { InputError } = require("../lib/validate");
const { parseGmail } = require("../lib/gmail");
const { parsePhoneNumberFromString } = require("libphonenumber-js/min");

// ---------- Field types ----------
// group: how the builder lists them · choice: has options · upload: a file picker · layout: not a question
const TYPES = {
  short_text: { label: "Short text", group: "Text" },
  long_text: { label: "Paragraph (text area)", group: "Text" },
  number: { label: "Number", group: "Text" },
  email: { label: "Email", group: "Text" },
  phone: { label: "Phone number", group: "Text" },
  date: { label: "Date", group: "Date & time" },
  time: { label: "Time", group: "Date & time" },
  datetime: { label: "Date & time", group: "Date & time" },
  select: { label: "Dropdown", group: "Choices", choice: true },
  multi_select: { label: "Dropdown (choose many)", group: "Choices", choice: true, many: true },
  radio: { label: "Radio buttons (choose one)", group: "Choices", choice: true },
  checkbox: { label: "Checkboxes (choose many)", group: "Choices", choice: true, many: true },
  yes_no: { label: "Yes / No", group: "Choices" },
  rating: { label: "Star rating", group: "Choices" },
  image: { label: "Image upload", group: "Uploads", upload: "image" },
  video: { label: "Video upload", group: "Uploads", upload: "video" },
  file: { label: "File upload (PDF, Word, Excel…)", group: "Uploads", upload: "file" },
  heading: { label: "Section heading", group: "Layout", layout: true },
  paragraph: { label: "Information text", group: "Layout", layout: true },
};
// Questions whose answer can show / hide other questions (an answer = one of its choices).
const CONDITION_SOURCES = ["select", "radio", "yes_no", "multi_select", "checkbox"];
const choicesOf = (f) => (f.type === "yes_no" ? ["Yes", "No"] : (f.options || []).map((o) => (typeof o === "string" ? o : o.label)));
/** The answer matches the condition: one of the chosen values (any of them, for choose-many questions). */
const conditionMet = (answer, values) => (Array.isArray(answer) ? answer.some((a) => values.includes(a)) : answer != null && values.includes(String(answer)));
/**
 * Shown questions for these answers: a question is shown when its section (heading) is shown, its own condition
 * is met, and the question its condition looks at is shown too. Conditions only look at earlier questions.
 */
function shownKeys(fields, answers) {
  const shown = new Set();
  let section = true;
  for (const f of fields) {
    if (f.hidden) continue;
    const own = !f.showIf || !f.showIf.field || (shown.has(f.showIf.field) && conditionMet(answers[f.showIf.field], f.showIf.values || []));
    if (f.type === "heading") section = own;
    if (section && own) shown.add(f.key);
  }
  return shown;
}
const LIMITS = { fields: 150, options: 200, reminders: 10, maxPerPerson: 1000, files: 10, hours: 24 * 366 };
const TEXT_MAX = { short_text: 500, long_text: 5000 };

const clean = (v, n) => String(v == null ? "" : v).replace(/\r\n/g, "\n").trim().slice(0, n);
const oneLine = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const newKey = () => "f_" + crypto.randomBytes(5).toString("hex");
const newOptionId = () => crypto.randomBytes(4).toString("hex");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v, what) => {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new InputError(`${what} must be a number.`);
  return n;
};

/** What the builder needs: field types and the server's upload limits. */
function meta() {
  return {
    types: Object.entries(TYPES).map(([key, t]) => ({ key, ...t })),
    maxMb: config.forms.maxMb,
    extensions: config.forms.extensions,
    limits: LIMITS,
  };
}

// ---------- The form's settings (Super Admin) ----------
function parseExtList(v, kind, what) {
  if (v == null || v === "") return undefined;
  const allowed = config.forms.extensions[kind];
  const list = [...new Set((Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim().toLowerCase().replace(/^\./, "")).filter(Boolean))];
  const bad = list.filter((x) => !allowed.includes(x));
  if (bad.length) throw new InputError(`${what}: ${bad.join(", ")} can't be allowed. Allowed: ${allowed.join(", ")}.`);
  return list.length ? list : undefined;
}
function parseSize(v, kind, what) {
  const n = numOrNull(v, what);
  if (n == null) return null;
  const cap = config.forms.maxMb[kind];
  if (n <= 0) throw new InputError(`${what} must be more than 0.`);
  if (n > cap) throw new InputError(`${what} can be at most ${cap} MB (the server's limit for ${kind === "file" ? "files" : kind + "s"}).`);
  return Math.round(n * 1000) / 1000;
}

/** One field from the builder. `old` = the saved field with the same key (if any). */
function parseField(f, i, old) {
  if (!f || typeof f !== "object") throw new InputError(`Question ${i + 1} is not readable.`);
  const t = TYPES[f.type];
  if (!t) throw new InputError(`Question ${i + 1}: choose a field type.`);
  const label = clean(f.label, 300);
  const name = label ? `“${label.slice(0, 40)}”` : `Question ${i + 1}`;
  if (!label && f.type !== "paragraph") throw new InputError(`${name}: type the ${t.layout ? "heading" : "question"}.`);
  const out = {
    key: old ? old.key : newKey(),
    type: f.type,
    label,
    help: clean(f.help, 2000),
    placeholder: t.layout || t.upload ? "" : oneLine(f.placeholder, 150),
    required: !t.layout && !!f.required,
    min: null, max: null, hidden: false,
  };
  if (f.type === "paragraph" && !out.label && !out.help) throw new InputError(`Question ${i + 1}: type the information text.`);
  if (t.choice) {
    const seen = new Set();
    const prev = new Map(((old && old.options) || []).map((o) => [o.id, o]));
    out.options = (Array.isArray(f.options) ? f.options : []).map((o) => {
      const text = oneLine(o && typeof o === "object" ? o.label : o, 200);
      const id = o && typeof o === "object" && prev.has(o.id) ? o.id : newOptionId();
      return { id, label: text };
    }).filter((o) => o.label && !seen.has(o.label.toLowerCase()) && seen.add(o.label.toLowerCase()));
    if (out.options.length < (f.type === "checkbox" ? 1 : 2)) throw new InputError(`${name}: add at least ${f.type === "checkbox" ? "one choice" : "two choices"}.`);
    if (out.options.length > LIMITS.options) throw new InputError(`${name}: at most ${LIMITS.options} choices.`);
  }
  if (["number", "short_text", "long_text"].includes(f.type) || t.many) {
    out.min = numOrNull(f.min, `${name}: the lowest value`);
    out.max = numOrNull(f.max, `${name}: the highest value`);
    if (f.type !== "number") {
      for (const k of ["min", "max"]) if (out[k] != null && (!Number.isInteger(out[k]) || out[k] < 0)) throw new InputError(`${name}: the ${k === "min" ? "lowest" : "highest"} count must be a whole number.`);
      if (TEXT_MAX[f.type] && out.max != null && out.max > TEXT_MAX[f.type]) throw new InputError(`${name}: at most ${TEXT_MAX[f.type]} characters.`);
      if (t.many && out.max != null && out.max > out.options.length) out.max = out.options.length;
    }
    if (out.min != null && out.max != null && out.min > out.max) throw new InputError(`${name}: the lowest is more than the highest.`);
  }
  if (f.type === "rating") {
    const stars = numOrNull(f.max, `${name}: number of stars`) || 5;
    if (!Number.isInteger(stars) || stars < 3 || stars > 10) throw new InputError(`${name}: number of stars must be 3 to 10.`);
    out.max = stars;
  }
  if (t.upload) {
    out.accept = parseExtList(f.accept, t.upload, `${name}: allowed types`);
    out.maxSizeMb = parseSize(f.maxSizeMb, t.upload, `${name}: size limit`);
    const files = numOrNull(f.maxFiles, `${name}: number of files`) || 1;
    if (!Number.isInteger(files) || files < 1 || files > LIMITS.files) throw new InputError(`${name}: number of files must be 1 to ${LIMITS.files}.`);
    out.maxFiles = files;
  }
  return out;
}

/**
 * Emails & reminders: [{ key?, template, when: publish|before_close|at, hours?, at?, audience }].
 * A rule that is unchanged keeps what already happened (sent / skipped); a changed rule is sent again when due.
 * (That the templates exist is checked by the route.)
 */
function parseReminders(list, existing, form) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > LIMITS.reminders) throw new InputError(`At most ${LIMITS.reminders} emails / reminders.`);
  const old = new Map(((existing && existing.reminders) || []).map((r) => [r.key, r]));
  const seen = new Set();
  return arr.map((r, i) => {
    const n = `Email / reminder ${i + 1}`;
    const template = String((r && r.template) || "");
    if (!/^[a-f0-9]{24}$/i.test(template)) throw new InputError(`${n}: choose the email template.`);
    const when = ["publish", "before_close", "at"].includes(r.when) ? r.when : null;
    if (!when) throw new InputError(`${n}: choose when it is sent.`);
    const out = { key: /^r_[a-z0-9]{6,16}$/.test(r.key || "") && !seen.has(r.key) ? r.key : `r_${crypto.randomBytes(5).toString("hex")}`, template, when, hours: 0, at: null, audience: r.audience === "with_jc" ? "with_jc" : "coordinators" };
    seen.add(out.key);
    if (when === "before_close") {
      const h = Number(r.hours);
      if (!Number.isInteger(h) || h < 1 || h > LIMITS.hours) throw new InputError(`${n}: type how many hours before closing (a whole number, 1 or more).`);
      if (form.startAt && form.endAt && h >= (form.endAt - form.startAt) / 3600000) throw new InputError(`${n}: ${h} hours before closing is before the form opens.`);
      out.hours = h;
    }
    if (when === "at") {
      const d = r.at ? new Date(r.at) : null;
      if (!d || Number.isNaN(d.getTime())) throw new InputError(`${n}: choose the date and time.`);
      if (form.endAt && d >= form.endAt) throw new InputError(`${n}: the time is after the form closes.`);
      out.at = d;
    }
    const was = old.get(out.key);
    const same = was && String(was.template) === template && was.when === when && (was.hours || 0) === out.hours
      && String(was.at ? new Date(was.at).getTime() : "") === String(out.at ? out.at.getTime() : "") && (was.audience || "coordinators") === out.audience;
    if (same && was.state) out.state = was.state;
    return out;
  });
}

/**
 * The form's settings and fields from the builder. `existing` = the saved form; `answered` = keys of
 * fields that have answers (those are hidden instead of removed and can't change type).
 */
function parseForm(body, existing, answered = new Set()) {
  const b = body || {};
  const out = {};
  out.title = oneLine(b.title, 200);
  if (out.title.length < 3) throw new InputError("Type the form's title (at least 3 letters).");
  out.description = clean(b.description, 5000);
  const date = (v, what) => {
    if (v === "" || v == null) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new InputError(`Choose a valid ${what}.`);
    return d;
  };
  out.startAt = date(b.startAt, "start date and time");
  out.endAt = date(b.endAt, "end date and time");
  if (out.startAt && out.endAt && out.endAt <= out.startAt) throw new InputError("The end must be after the start.");
  out.access = ["signed_in", "personal_link", "anyone"].includes(b.access) ? b.access : "personal_link";
  if (b.maxPerPerson === "" || b.maxPerPerson == null) out.maxPerPerson = null;
  else {
    const n = Number(b.maxPerPerson);
    if (!Number.isInteger(n) || n < 1) throw new InputError("Times one person can fill it: leave empty for no limit, or 1 or more (0 is not allowed).");
    if (n > LIMITS.maxPerPerson) throw new InputError(`Times one person can fill it: at most ${LIMITS.maxPerPerson}.`);
    out.maxPerPerson = n;
  }
  out.allowEdit = !!b.allowEdit;
  out.sendCopy = !!b.sendCopy;
  out.reminders = parseReminders(b.reminders, existing, out);
  out.imageExt = parseExtList(b.imageExt, "image", "Allowed image types");
  out.imageMaxMb = parseSize(b.imageMaxMb, "image", "Image size limit");

  const list = Array.isArray(b.fields) ? b.fields : [];
  if (list.length > LIMITS.fields) throw new InputError(`A form can have at most ${LIMITS.fields} fields.`);
  const saved = new Map(((existing && existing.fields) || []).map((f) => [f.key, f]));
  const used = new Set();
  out.fields = list.map((f, i) => {
    const old = f && saved.get(f.key);
    if (old && used.has(old.key)) throw new InputError(`Question ${i + 1} appears twice.`);
    if (old && f.type !== old.type && answered.has(old.key)) {
      throw new InputError(`“${old.label.slice(0, 40)}” already has answers, so its type can't change. Add a new question instead.`);
    }
    const field = parseField(f, i, old);
    used.add(field.key);
    return field;
  });
  // Conditions ("show only if"): the browser names the earlier question by its key, or (new questions) its uid.
  const keyOf = new Map(list.map((f, i) => [String((f && (f.key || f.uid)) || ""), out.fields[i]]).filter(([k]) => k));
  out.fields.forEach((field, i) => {
    const c = list[i] && list[i].showIf;
    if (!c || !c.field) return;
    const name = field.label ? `“${field.label.slice(0, 40)}”` : `Question ${i + 1}`;
    const src = keyOf.get(String(c.field));
    if (!src) throw new InputError(`${name}: the question it depends on was removed. Choose another one or show it always.`);
    const at = out.fields.indexOf(src);
    if (at >= i) throw new InputError(`${name}: it depends on “${src.label.slice(0, 40)}”, which must come before it. Move it lower or change the condition.`);
    if (!CONDITION_SOURCES.includes(src.type)) throw new InputError(`${name}: only a choice question (dropdown, radio buttons, checkboxes, Yes / No) can show or hide it.`);
    const choices = choicesOf(src);
    const values = [...new Set((Array.isArray(c.values) ? c.values : []).map((v) => oneLine(v, 200)))].filter((v) => choices.includes(v));
    if (!values.length) throw new InputError(`${name}: tick which answer of “${src.label.slice(0, 40)}” shows it.`);
    field.showIf = { field: src.key, values };
  });
  // Removed fields that have answers stay (hidden) so their answers aren't lost.
  for (const f of saved.values()) {
    if (!used.has(f.key) && answered.has(f.key)) out.fields.push({ ...(f.toObject ? f.toObject() : f), hidden: true });
  }
  return out;
}

/** Problems that stop a form from going to Testing or being published. */
function readyProblems(form) {
  const p = [];
  if (!form.startAt || !form.endAt) p.push("Set the start and end date and time.");
  else if (form.endAt <= new Date()) p.push("The end date and time is already past.");
  if (!form.fields.some((f) => !f.hidden && !TYPES[f.type].layout)) p.push("Add at least one question.");
  return p;
}

/** open | not_started | ended | closed | draft | testing (testing = open for testers only, ignoring the dates' start). */
function stateOf(form, now = new Date()) {
  if (form.stage === "draft") return "draft";
  if (form.stage === "closed") return "closed";
  if (form.endAt && now >= form.endAt) return "ended";
  if (form.stage === "testing") return "testing";
  if (form.startAt && now < form.startAt) return "not_started";
  return "open";
}

// ---------- Links ----------
// A form's address uses a random code (never the database id): /f/<code>.
// A personal link adds ?t=<token>: the form's code + the person's email, ENCRYPTED (AES-256-GCM) with a
// server-only key, so nobody can read the email or the form inside it, and any change makes it invalid.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // no look-alikes (0/O, 1/l/I)
function newCode(len = 10) {
  const bytes = crypto.randomBytes(len * 2);
  let out = "";
  for (let i = 0; out.length < len && i < bytes.length; i++) if (bytes[i] < 228) out += CODE_CHARS[bytes[i] % 57]; // 228 = 4*57: no bias
  return out.length === len ? out : newCode(len);
}
const isCode = (v) => typeof v === "string" && /^[A-Za-z0-9]{8,16}$/.test(v);
const linkSecret = () => config.forms.linkSecret || crypto.createHmac("sha256", config.jwtAccessSecret).update("forms-personal-link").digest("hex");
const tokenKey = () => crypto.createHash("sha256").update(`${linkSecret()}:token-encryption`).digest();
const simpleEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** The token for one person and one form (encrypted; see above). */
function personalToken(code, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!simpleEmail(e)) throw new InputError("Enter a valid email address.");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ c: String(code), e }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
/** The email inside a token, or "" if it was changed, can't be read, or belongs to another form. */
function readToken(code, token) {
  try {
    const buf = Buffer.from(String(token || ""), "base64url");
    if (buf.length < 30 || buf.length > 600) return "";
    const d = crypto.createDecipheriv("aes-256-gcm", tokenKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const j = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
    return j && j.c === String(code) && simpleEmail(j.e) ? j.e : "";
  } catch { return ""; }
}
/** A database id as an opaque string for the public form page (and back). "" when it was changed. */
function seal(id) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", tokenKey(), iv);
  const body = Buffer.concat([c.update(`id:${id}`, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
function unseal(v) {
  try {
    const buf = Buffer.from(String(v || ""), "base64url");
    if (buf.length < 30 || buf.length > 100) return "";
    const d = crypto.createDecipheriv("aes-256-gcm", tokenKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const s = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    return /^id:[a-f0-9]{24}$/.test(s) ? s.slice(3) : "";
  } catch { return ""; }
}
const siteUrl = () => config.forms.publicUrl || config.corsOrigins[0] || "";
const formLink = (code) => `${siteUrl()}/f/${code}`;
const personalLink = (code, email) => `${formLink(code)}?t=${personalToken(code, email)}`;

/** Same person however the address is written (Gmail ignores dots and "+…"). */
function emailKeyOf(email) {
  const e = String(email || "").trim().toLowerCase();
  const g = parseGmail(e);
  return g.error ? e : g.emailKey;
}

// ---------- Answers ----------
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const realDate = (s) => {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

/**
 * Checks the answers against the form. `files(field, list)` checks upload references and returns
 * the files to store. Returns { answers, problems: { <key>: message } }.
 */
async function checkAnswers(form, input, files, previous = {}) {
  const src = input && typeof input === "object" ? input : {};
  const answers = {};
  const problems = {};
  // shown / hidden by conditions, worked out as the answers are read (a condition looks at an earlier answer)
  const shown = new Set();
  let section = true;
  const own = (f) => !f.showIf || !f.showIf.field || (shown.has(f.showIf.field) && conditionMet(answers[f.showIf.field], f.showIf.values || []));
  for (const f of form.fields) {
    const t = TYPES[f.type];
    if (!t) continue;
    if (f.hidden) { if (f.key in previous) answers[f.key] = previous[f.key]; continue; }
    if (f.type === "heading") section = own(f);
    if (!(section && own(f))) continue; // not shown: no answer kept, not required
    shown.add(f.key);
    if (t.layout) continue;
    let v = src[f.key];
    const fail = (m) => { problems[f.key] = m; };
    if (typeof v === "string") v = f.type === "long_text" ? clean(v, 20000) : oneLine(v, 20000);
    if (isEmpty(v) || (f.type === "rating" && (v === 0 || v === "0"))) {
      if (f.required) fail("This question needs an answer.");
      continue;
    }
    switch (f.type) {
      case "short_text": case "long_text": {
        if (typeof v !== "string") { fail("Type an answer."); break; }
        const most = f.max != null ? f.max : TEXT_MAX[f.type];
        if (v.length > most) fail(`At most ${most} characters (now ${v.length}).`);
        else if (f.min != null && v.length < f.min) fail(`At least ${f.min} characters.`);
        else answers[f.key] = v;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
        if (!Number.isFinite(n)) fail("Enter a number.");
        else if (f.min != null && n < f.min) fail(`The lowest allowed is ${f.min}.`);
        else if (f.max != null && n > f.max) fail(`The highest allowed is ${f.max}.`);
        else answers[f.key] = n;
        break;
      }
      case "email":
        if (typeof v !== "string" || !simpleEmail(v) || v.length > 200) fail("Enter a valid email address.");
        else answers[f.key] = v.toLowerCase();
        break;
      case "phone": {
        // Checked with each country's real numbering rules (length, valid prefixes); saved as +<country code><number>.
        const ph = typeof v === "string" && v.length <= 30 ? parsePhoneNumberFromString(v.startsWith("+") ? v : `+${v}`) : null;
        if (!ph || !ph.isValid()) fail("Enter a valid phone number for the chosen country.");
        else answers[f.key] = ph.number; // e.g. +919876543210
        break;
      }
      case "date":
        if (typeof v !== "string" || !realDate(v)) fail("Choose a valid date.");
        else answers[f.key] = v;
        break;
      case "time":
        if (typeof v !== "string" || !TIME_RE.test(v)) fail("Choose a valid time.");
        else answers[f.key] = v;
        break;
      case "datetime": {
        // "YYYY-MM-DDTHH:MM" as the person saw it on their clock (worldwide forms: their own time).
        const m = typeof v === "string" && /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(v);
        if (!m || !realDate(m[1]) || !TIME_RE.test(m[2])) fail("Choose a valid date and time.");
        else answers[f.key] = v;
        break;
      }
      case "select": case "radio": {
        const hit = typeof v === "string" && f.options.find((o) => o.label === v);
        if (!hit) fail("Choose one of the choices.");
        else answers[f.key] = hit.label;
        break;
      }
      case "multi_select": case "checkbox": {
        const list = Array.isArray(v) ? [...new Set(v.map(String))] : null;
        const labels = f.options.map((o) => o.label);
        if (!list || list.some((x) => !labels.includes(x))) { fail("Choose from the choices."); break; }
        if (f.required && !list.length) { fail("Choose at least one."); break; }
        if (f.min != null && list.length < f.min) fail(`Choose at least ${f.min}.`);
        else if (f.max != null && list.length > f.max) fail(`Choose at most ${f.max}.`);
        else answers[f.key] = labels.filter((l) => list.includes(l)); // in the form's order
        break;
      }
      case "yes_no":
        if (v !== "Yes" && v !== "No") fail("Choose Yes or No.");
        else answers[f.key] = v;
        break;
      case "rating": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > (f.max || 5)) fail(`Choose 1 to ${f.max || 5} stars.`);
        else answers[f.key] = n;
        break;
      }
      case "image": case "video": case "file": {
        if (!Array.isArray(v)) { fail("Upload the file again."); break; }
        if (v.length > (f.maxFiles || 1)) { fail(`At most ${f.maxFiles || 1} file${(f.maxFiles || 1) > 1 ? "s" : ""}.`); break; }
        try { answers[f.key] = await files(f, v); } catch (err) { fail(err.message); }
        if (f.required && !(answers[f.key] || []).length) fail("Upload a file.");
        break;
      }
      default: break;
    }
  }
  return { answers, problems };
}

// ---------- Uploads ----------
/** Extensions and size limit (bytes) for an upload question. */
function uploadRules(form, field) {
  const kind = TYPES[field.type].upload;
  const all = config.forms.extensions[kind];
  let ext = field.accept && field.accept.length ? field.accept : kind === "image" && form.imageExt && form.imageExt.length ? form.imageExt : all;
  ext = ext.filter((e) => all.includes(e)); // a later .env change can only narrow it
  const mb = Math.min(field.maxSizeMb || (kind === "image" && form.imageMaxMb) || config.forms.maxMb[kind], config.forms.maxMb[kind]);
  return { kind, ext, maxBytes: Math.round(mb * 1024 * 1024), maxMb: mb };
}

// The file's first bytes must match its extension (a renamed file is refused).
const ftyp = (b) => (b.length > 12 && b.toString("ascii", 4, 8) === "ftyp" ? b.toString("ascii", 8, 12).toLowerCase() : "");
const zip = (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const ole = (b) => b.length > 8 && b.readUInt32BE(0) === 0xd0cf11e0;
const text = (b) => !b.subarray(0, 4096).includes(0);
const SIGNS = {
  jpg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG",
  webp: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  gif: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.toString("ascii", 0, 6)),
  heic: (b) => ["heic", "heix", "mif1", "msf1", "hevc", "heim", "heis"].includes(ftyp(b)),
  mp4: (b) => !!ftyp(b) && !["heic", "heix", "mif1", "msf1"].includes(ftyp(b)),
  webm: (b) => b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3,
  pdf: (b) => b.toString("ascii", 0, 5) === "%PDF-",
  docx: zip, xlsx: zip, pptx: zip, doc: ole, xls: ole, ppt: ole, csv: text, txt: text,
};
SIGNS.jpeg = SIGNS.jpg; SIGNS.mov = SIGNS.mp4; SIGNS.m4v = SIGNS.mp4; SIGNS["3gp"] = SIGNS.mp4;
const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", "3gp": "video/3gpp",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain",
};
/** Checks an uploaded file against the question's rules. Returns { ext, type }. */
function checkUpload(buffer, fileName, rules) {
  if (!buffer || !buffer.length) throw new InputError("The file is empty.");
  if (buffer.length > rules.maxBytes) throw new InputError(`The file is too large. The limit is ${rules.maxMb} MB.`);
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(String(fileName || "")) || [])[1];
  const e = ext ? ext.toLowerCase() : "";
  if (!e || !rules.ext.includes(e)) throw new InputError(`This type of file isn't allowed here. Allowed: ${rules.ext.join(", ")}.`);
  const check = SIGNS[e];
  if (check && !check(buffer)) throw new InputError(`This file isn't a real .${e} file. Choose another file.`);
  return { ext: e, type: MIME[e] || "application/octet-stream" };
}

const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const randomKey = () => crypto.randomBytes(24).toString("base64url");

module.exports = {
  TYPES, LIMITS, CONDITION_SOURCES, shownKeys, meta, parseForm, readyProblems, stateOf,
  personalToken, readToken, formLink, personalLink, emailKeyOf, simpleEmail, newCode, isCode, seal, unseal,
  checkAnswers, uploadRules, checkUpload, hash, randomKey,
};
