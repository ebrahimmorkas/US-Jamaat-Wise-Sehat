// Turns an English question into an "intent": a small, checked object the engine can run.
// The AI (Groq, free tier) only does this translation; it never sees the answers or the data rows.
// Only the question, the question/answer names and the Jamiat names this person may see are sent.
// Without a Groq key (or when Groq is busy) a simpler built-in reader is used instead.
const config = require("../../config");
const { activeFields, formFields } = require("../fields");
const { activeMasters } = require("../data");
const User = require("../../models/User");
const { currentMonth, monthLabel, rangeText, portalMonths } = require("../../lib/month");
const { hijriMonthNames } = require("../../formConfig");
const { norm, STATUS_WORDS } = require("./engine");

const INTENTS = ["list", "count", "submission", "jamaat_detail", "masters", "questions", "comments", "users", "help", "greeting", "off_topic", "unclear"];
const str = (v, n = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/** Keeps only known fields, with safe types and lengths. */
function cleanIntent(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const intent = INTENTS.includes(r.intent) ? r.intent : "unclear";
  const out = { intent };
  for (const k of ["question", "activity", "status", "jamiat", "jamaat", "person"]) { const v = str(r[k]); if (v) out[k] = v; }
  const month = str(r.month, 7);
  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) out.month = month;
  const d = str(r.english_date, 10);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) out.english_date = d;
  if (r.level === "jamiat" || r.level === "jamaat") out.level = r.level;
  if (r.submitted === true || r.submitted === false) out.submitted = r.submitted;
  if (["jc", "saheb", "superadmin"].includes(r.role_filter)) out.role_filter = r.role_filter;
  const c = str(r.clarify, 300);
  if (c && intent === "unclear") out.clarify = c;
  return out;
}

/** What the reader needs to know about this person's data (names only, no answers). */
async function catalog(user) {
  const month = currentMonth();
  const [parents, fields, masters] = await Promise.all([activeFields(), formFields(month), activeMasters()]);
  let jamiats = masters;
  if (user.role === "jc") {
    const u = await User.findById(user.id).select("jamiats jamaats").lean();
    const js = new Set(((u && u.jamiats) || []).map(String));
    const jm = new Set(((u && u.jamaats) || []).map(String));
    jamiats = masters.filter((j) => js.has(String(j._id))).map((j) => ({ ...j, jamaats: j.jamaats.filter((x) => jm.has(String(x._id))) })).filter((j) => j.jamaats.length);
  }
  const months = portalMonths();
  return {
    role: user.role,
    month,
    first: months[months.length - 1],
    parents,
    activities: fields.filter((f) => f.parentKey).map((f) => ({ parent: f.parentKey, name: f.activity.name })),
    jamiats: jamiats.map((j) => j.name),
    // Jamaat names stay on the server (too many to send); the JC's own few are sent to help with spelling.
    jamaats: user.role === "jc" ? jamiats.flatMap((j) => j.jamaats.map((x) => x.name)) : null,
    // All the Jamaat names this person may see, for the built-in reader only (never sent to the AI).
    allJamaats: jamiats.flatMap((j) => j.jamaats.map((x) => x.name)),
  };
}

const ROLE_TEXT = {
  jc: "a JC. They can only see the Jamaats assigned to them",
  saheb: "a Saheb. They can see every Jamiat and Jamaat",
  superadmin: "the Super Admin. They can see everything, including users and their assignments",
};

function systemPrompt(cat) {
  const qs = cat.parents.map((p) => {
    const answers = p.type === "date" ? "a date" : p.options.map((o) => `${o.value}=${o.meaning}`).join(", ");
    const acts = cat.activities.filter((a) => a.parent === p.key).map((a) => a.name);
    return `- ${p.key}: "${p.label}" [section ${p.section}] answers: ${answers}${p.hasActivities ? `; monthly activities this month: ${acts.length ? acts.join(", ") : "none yet"}` : ""}`;
  }).join("\n");
  return `You read questions typed into the Umoor Sehhat software and turn each into ONE JSON object. You never answer the question yourself.

THE SOFTWARE: Every month (Hijri, Misri calendar) a JC fills one form per Jamaat. Jamaats belong to Jamiats. The form has these questions:
${qs}
Answer meanings: done, progress (in progress), pending, notdone, na (not applicable).
Questions with monthly activities (e.g. Tibb) are answered once per activity (e.g. Tibb: Injection), and a done activity may have a "date done".
The current month is ${cat.month} = ${monthLabel(cat.month)} (${rangeText(cat.month)}). Data exists from ${cat.first} to ${cat.month}. Hijri month numbers: ${hijriMonthNames.map((n, i) => `${String(i + 1).padStart(2, "0")} ${n.split(" ")[0]}`).join(", ")}.
Jamiats this person can see: ${cat.jamiats.join(", ") || "none"}.${cat.jamaats ? `\nTheir Jamaats: ${cat.jamaats.join(", ")}.` : ""}
The person asking is ${ROLE_TEXT[cat.role] || "a user"}.

OUTPUT: only a JSON object with these keys (omit keys that don't apply):
{"intent": one of
   "list" (which Jamaats/Jamiats have an answer, e.g. "which jamaats completed injection", "which jamiat filled tibb"),
   "count" (how many / breakdown / status of a question, e.g. "how many pending for tibb", "tibb status in barwani"),
   "submission" (which Jamaats/Jamiats submitted or not the monthly form, no specific question),
   "jamaat_detail" (all answers of one Jamaat, e.g. "show dhar's form", "what did dhar answer"),
   "masters" (Jamiats, Jamaats in a Jamiat, a Jamaat's Mauze Type / House Count, how many Jamaats),
   "questions" (what questions / activities / answer options exist),
   "comments" (comments or remarks written by JCs),
   "users" (who the users / JCs are, who is assigned to a Jamaat or Jamiat, which Jamaats a person has),
   "help" (what can you do), "greeting" (hello/salaam/thanks only),
   "off_topic" (anything not about this software's data: general knowledge, weather, news, maths, coding, jokes, advice, other websites),
   "unclear" (about this data but too vague; then add "clarify": a short question back),
 "question": the question key from the list above (e.g. "tibb"),
 "activity": the activity name as listed (e.g. "Injection"),
 "status": the meaning: "done" | "pending" | "progress" | "notdone" | "na" | "answered" (filled/updated, any answer) | "not_answered" (not filled/empty) — map the user's words: complete/completed/finished/conducted/yes -> done; not yet/remaining/due -> pending; ongoing/started -> progress,
 "jamiat": Jamiat name as the user wrote it, "jamaat": Jamaat name as the user wrote it,
 "level": "jamiat" if they ask which/how many Jamiats, else "jamaat",
 "submitted": true (submitted/filled the form) or false (not submitted),
 "month": "YYYY-MM" Hijri month if they name one (year defaults to the latest one not after ${cat.month}), or
 "english_date": "YYYY-MM-15" if they name an English month (e.g. November 2026),
 "person": a user's name or Gmail (users intent), "role_filter": "jc" | "saheb" | "superadmin" (users intent)}
Use earlier turns to fill in what a follow-up leaves out (e.g. "and in Barwani?" keeps the previous question and status).
Questions about anything outside this software's data are "off_topic", even if they mention health or Jamaats in general.`;
}

/** Asks Groq for the intent. Throws on any failure (the caller falls back). */
async function aiIntent(cat, message, history) {
  if (!config.groqApiKey) throw new Error("no key");
  const messages = [{ role: "system", content: systemPrompt(cat) }];
  for (const h of history) {
    messages.push({ role: "user", content: h.q });
    messages.push({ role: "assistant", content: JSON.stringify(h.intent) });
  }
  messages.push({ role: "user", content: message });
  const body = {
    model: config.groqModel,
    messages,
    temperature: 0,
    max_completion_tokens: 1200,
    response_format: { type: "json_object" },
  };
  if (/gpt-oss/.test(config.groqModel)) body.reasoning_effort = "low";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return cleanIntent(JSON.parse(content));
  } finally {
    clearTimeout(timer);
  }
}

// ---------- built-in reader (no AI) ----------
const has = (t, words) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(t));
const DOMAIN = ["jamiat", "jamiats", "jamaat", "jamaats", "form", "forms", "submitted", "submit", "filled", "fill", "question", "questions", "activity", "activities",
  "status", "comment", "comments", "remarks", "jc", "jcs", "user", "users", "saheb", "admin", "month", "mauze", "house", "houses", "answer", "answers", "report"];

// Subjects that are never about this data, even next to a place name.
const OFF_WORDS = ["weather", "temperature", "rain", "news", "price", "prices", "cost", "recipe", "cricket", "match", "movie", "film", "song",
  "population", "capital", "history", "distance", "train", "flight", "hotel", "restaurant", "stock", "share", "gold", "time zone", "joke",
  "medicine for", "doctor", "hospital", "disease", "symptoms", "cure", "president", "prime minister", "election"];

/** Reads a question with keywords and names. Good for clear questions; says "unclear" otherwise. */
function basicIntent(cat, message, history) {
  const t = norm(message);
  const words = t.split(" ");
  const prev = history.length ? history[history.length - 1].intent : null;
  if (!t) return { intent: "unclear" };
  if (words.length <= 4 && has(t, ["hi", "hello", "salaam", "salam", "salaams", "thanks", "thank you", "shukran"])) return { intent: "greeting" };
  if (has(t, ["help", "what can you do", "how to use", "examples"])) return { intent: "help" };

  const out = {};
  // question / activity named?
  for (const p of cat.parents) if (t.includes(norm(p.label)) || has(t, [norm(p.key)])) { out.question = p.key; break; }
  for (const a of cat.activities) if (t.includes(norm(a.name))) { out.activity = a.name; out.question = out.question || a.parent; break; }
  // status words (longest phrases first)
  const phrases = STATUS_WORDS.flatMap(([m, ws]) => ws.map((w) => [m, w])).sort((a, b) => b[1].length - a[1].length);
  for (const [m, w] of phrases) {
    if (w.length > 1 && has(t, [w.replace(/[^a-z0-9 ]/g, "")])) { out.status = m; break; }
  }
  // Jamiat / Jamaat names
  for (const j of cat.jamiats) if (has(t, [norm(j)])) { out.jamiat = j; break; }
  // Jamaat names written in the question (longest first; a Jamaat named like its Jamiat counts as the Jamiat).
  const names = [...cat.allJamaats].sort((a, b) => norm(b).length - norm(a).length);
  for (const n of names) {
    const k = norm(n);
    if (k.length >= 3 && has(t, [k]) && !(out.jamiat && norm(out.jamiat) === k)) { out.jamaat = n; break; }
  }
  out.level = has(t, ["jamiat", "jamiats"]) && !has(t, ["jamaat", "jamaats"]) ? "jamiat" : "jamaat";

  // A short follow-up ("and in Barwani?", "what about pending?") keeps the previous question.
  const followable = prev && !["off_topic", "greeting", "help", "unclear"].includes(prev.intent);
  const looksLikeFollowUp = /^(and|also|same|what about|how about|then|now)\b/.test(t) || words.length <= 3;
  if (followable && looksLikeFollowUp && !out.question && (out.status || out.jamiat || out.jamaat || out.activity)) {
    const merged = { ...prev, ...out, level: prev.level };
    if (out.jamiat && !out.jamaat) delete merged.jamaat;
    if (out.jamaat && !out.jamiat) delete merged.jamiat;
    return cleanIntent(merged);
  }
  const dataWords = out.question || out.activity || out.status || words.some((w) => DOMAIN.includes(w));
  // Only a place name: about the place's data only when nothing points elsewhere ("weather in Mumbai" is not).
  if (!dataWords && (out.jamiat || out.jamaat) && has(t, OFF_WORDS)) return { intent: "off_topic" };
  if (!dataWords && !out.jamiat && !out.jamaat) return { intent: "off_topic" };
  if (has(t, ["user", "users", "jc", "jcs", "who is", "assigned", "saheb", "admin"]) && !out.question) {
    return cleanIntent({ intent: "users", jamiat: out.jamiat, jamaat: out.jamaat, role_filter: has(t, ["jc", "jcs"]) ? "jc" : undefined });
  }
  if (has(t, ["comment", "comments", "remark", "remarks"])) return cleanIntent({ ...out, intent: "comments" });
  // "jamaats in <a name we don't know>": let the engine say it isn't found (instead of listing everything).
  const inPlace = /\bjamaats?\s+(?:are\s+)?(?:in|of|under)\s+([a-z0-9][a-z0-9 ()-]{1,60})$/i.exec(message.trim().replace(/[?.!]+$/, ""));
  if (inPlace && !out.jamiat && !out.jamaat && !out.question && !out.status) return cleanIntent({ intent: "masters", jamiat: inPlace[1] });
  if (has(t, ["mauze", "house", "houses", "house count"]) || (has(t, ["how many", "list", "which"]) && has(t, ["jamaats in", "jamaats are in", "jamaats does", "jamaats has"]) && !out.question && !out.status)) {
    return cleanIntent({ ...out, intent: "masters" });
  }
  if (!out.question && has(t, ["questions", "options", "activities", "what activities"])) return { intent: "questions" };
  if (!out.question && (has(t, ["submitted", "submit", "filled", "fill", "form", "forms"]) || out.status === "answered" || out.status === "not_answered")) {
    const not = has(t, ["not", "not yet", "pending", "remaining", "haven t", "hasn t", "didn t", "missing", "left"]);
    return cleanIntent({ ...out, intent: "submission", status: undefined, submitted: !not });
  }
  if (!out.question && out.jamaat) return cleanIntent({ ...out, intent: "jamaat_detail" });
  // "answers / form / details of <a name we don't know>": let the engine say it isn't found.
  const named = /\b(?:answers?|form|details|status|data)\s+(?:of|for)\s+([a-z0-9][a-z0-9 ()-]{1,60})$/i.exec(message.trim().replace(/[?.!]+$/, ""));
  if (!out.question && named && !out.jamiat) return cleanIntent({ intent: "jamaat_detail", jamaat: named[1] });
  if (!out.question && out.jamiat && !dataWords) return cleanIntent({ ...out, intent: "masters" });
  if (!out.question) return { intent: "unclear", clarify: "Which question do you mean (for example Tibb, Riyadah, Nazafat or Mahul Shifa)?" };
  if (has(t, ["how many", "count", "number", "breakdown", "status", "summary"]) && !has(t, ["which", "who", "list", "show me which"])) return cleanIntent({ ...out, intent: "count" });
  return cleanIntent({ ...out, intent: out.status ? "list" : "count" });
}

/** History sent by the browser: only earlier questions and how they were read (checked again here). */
function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.slice(-6).map((x) => ({ q: str(x && x.q, 500), intent: cleanIntent(x && x.intent) })).filter((x) => x.q);
}

async function readQuestion(user, message, history) {
  const cat = await catalog(user);
  if (config.groqApiKey) {
    try {
      return { intent: await aiIntent(cat, message, history), source: "ai" };
    } catch (err) {
      console.warn("[chat] Groq failed, using the built-in reader:", err.message);
      return { intent: basicIntent(cat, message, history), source: "basic", aiError: err.status === 429 ? "busy" : "failed" };
    }
  }
  return { intent: basicIntent(cat, message, history), source: "basic" };
}

module.exports = { readQuestion, cleanIntent, cleanHistory, basicIntent, catalog, systemPrompt };
