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
const { schemaFor, describeSchema, OPS, DATASETS } = require("./query");

const INTENTS = ["list", "count", "submission", "jamaat_detail", "masters", "questions", "comments", "query", "users", "help", "greeting", "off_topic", "unclear"];
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
  // users intent: which details, filters, order, how many
  if (Array.isArray(r.fields)) {
    const f = [...new Set(r.fields.map((x) => String(x).toLowerCase().trim().replace(/^gmail$|^mail$/, "email").replace(/^stars?$|^ratings$/, "rating")))].filter(Boolean).slice(0, 12);
    if (f.length) out.fields = intent === "users" ? f.filter((x) => ["name", "email", "role", "active", "jamiats", "jamaats", "metrics", "rating"].includes(x)) : f;
    if (out.fields && !out.fields.length) delete out.fields;
  }
  if (r.metrics === "none" || r.metrics === "some") out.metrics = r.metrics;
  const mt = str(r.metric); if (mt) out.metric = mt;
  if (r.assigned_all === true) out.assigned_all = true;
  if (r.unrated === true) out.unrated = true;
  for (const k of ["stars_min", "stars_max"]) { const n = Number(r[k]); if (Number.isInteger(n) && n >= 1 && n <= 5) out[k] = n; }
  if (["metrics_desc", "metrics_asc", "rating_desc", "rating_asc"].includes(r.sort)) out.sort = r.sort;
  { const n = Number(r.limit); if (Number.isInteger(n) && n >= 1 && n <= 100) out.limit = n; }
  // query intent: dataset, conditions, columns, order, how many
  if (intent === "query") {
    const key = (v) => (typeof v === "string" ? v.trim().toLowerCase().slice(0, 60) : null);
    out.dataset = key(r.dataset) || "";
    if (Array.isArray(r.where)) {
      out.where = r.where.slice(0, 10).filter((c) => c && typeof c === "object" && key(c.field)).map((c) => ({
        field: key(c.field),
        op: OPS.includes(c.op) ? c.op : "is",
        ...(c.value === undefined || c.value === null ? {} : { value: Array.isArray(c.value) ? c.value.slice(0, 10).map((x) => String(x).slice(0, 100)) : typeof c.value === "boolean" || typeof c.value === "number" ? c.value : String(c.value).slice(0, 100) }),
      }));
    }
    if (r.sort && typeof r.sort === "object" && key(r.sort.field)) out.sort = { field: key(r.sort.field), dir: r.sort.dir === "asc" ? "asc" : "desc" };
    if (r.count_only === true) out.count_only = true;
    if (key(r.group_by)) out.group_by = key(r.group_by);
  }
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
  const schema = await schemaFor(user.role);
  return {
    role: user.role,
    schema,
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
   "jamaat_detail" (all FORM answers of one Jamaat, e.g. "show dhar's form", "what did dhar answer"; not its Mauze Type / houses / JCs - that is "query"),
   "masters" (ONLY: list the Jamiats, list ALL Jamaats of one Jamiat, or one Jamaat's details - with NO condition, number, sort or count; anything with a condition like "more than 100 houses", "Ummal", "no Mauze Type", "most Jamaats" is "query"),
   "questions" (what questions / activities / answer options exist; with "question" when one is named, e.g. "which are the activities in Tibb" -> {"intent":"questions","question":"tibb"}),
   "comments" (comments or remarks written by JCs),
   "query" (anything else about the stored lists: JCs, users, Jamiats, Jamaats, metrics, star ratings, Stats images, the Data sheet - see QUERIES),
   "help" (what can you do), "greeting" (hello/salaam/thanks only),
   "off_topic" (anything not about this software's data: general knowledge, weather, news, maths, coding, jokes, advice, other websites),
   "unclear" (about this data but too vague; then add "clarify": a short question back),
 "question": ONLY one of the question keys from the list above (e.g. "tibb"); omit it otherwise. Sent/submitted/filled the monthly form (no question named) is intent "submission", never a question,
 "activity": the activity name as listed (e.g. "Injection"),
 "status": the meaning: "done" | "pending" | "progress" | "notdone" | "na" | "answered" (filled/updated, any answer) | "not_answered" (not filled/empty) — map the user's words: complete/completed/finished/conducted/yes -> done; not yet/remaining/due -> pending; ongoing/started -> progress,
 "jamiat": Jamiat name as the user wrote it, "jamaat": Jamaat name as the user wrote it,
 "level": "jamiat" if they ask which/how many Jamiats, else "jamaat",
 "submitted": true (submitted/filled the form) or false (not submitted),
 "month": "YYYY-MM" Hijri month if they name one (year defaults to the latest one not after ${cat.month}), or
 "english_date": "YYYY-MM-15" if they name an English month (e.g. November 2026),
 "query" fields (see QUERIES below)}

QUERIES - for anything about the stored lists below (people, places, metrics, ratings, images, the Data sheet), use
{"intent":"query","dataset":<one of the datasets>,"where":[{"field":<field>,"op":<op>,"value":<value>}],"fields":[<only the fields the user asked to SEE; omit if not said>],"sort":{"field":<field>,"dir":"desc"|"asc"},"limit":<n>,"count_only":true (only "how many"),"group_by":<field> ("how many per ...")}
ops: is, is_not, contains, not_contains, starts_with, ends_with, gt, gte, lt, lte, empty, not_empty ("names starting with E" -> starts_with "E"). (list) fields hold several names: use "contains". (bool): value true/false. (date): value "YYYY-MM-DD" or "YYYY-MM". (stars): 1-5.
"fields", "where" and "sort" use ONLY the field names of the chosen dataset. "count_only" ONLY when they ask how many rows/things match ("how many JCs ..."); a number ABOUT one thing ("how many Jamiats does X have", "total Jamiats assigned to X") is a field (e.g. jamiat_count), not count_only.
FOLLOW-UPS: when the new message only adds or changes something (e.g. "give me gmail", "only names", "their metrics", "sort by rating", "and in Barwani?"), repeat the previous query from the earlier turns with ALL its conditions, changing only what was asked. Never ask "whose?" when an earlier turn already says it. EVERY condition in the question must become a "where" item or the sort/limit; never drop one. If a condition fits no field, still write it with the closest field name (the software will explain).
Datasets this person may ask about:
${describeSchema(cat.schema)}
Examples: ${cat.role === "jc" ? "" : `"JC with 2 stars rating" -> {"intent":"query","dataset":"jcs","where":[{"field":"rating","op":"is","value":2}]}; "Name of JC who has zero metrics" -> {"intent":"query","dataset":"jcs","where":[{"field":"metric_count","op":"is","value":0}],"fields":["name"]}; "Just give me the email of JC who has been assigned all the jamiats" -> {"intent":"query","dataset":"jcs","where":[{"field":"all_jamiats","op":"is","value":true}],"fields":["email"]}; "Who all has been assigned the Mumbai Jamiat?" -> {"intent":"query","dataset":"jcs","where":[{"field":"jamiats","op":"contains","value":"Mumbai"}],"fields":["name"]}; "Which JC has the most metrics?" -> {"intent":"query","dataset":"jcs","sort":{"field":"metric_count","dir":"desc"},"limit":1}; "Which JC names start with E" -> {"intent":"query","dataset":"jcs","where":[{"field":"name","op":"starts_with","value":"E"}],"fields":["name"]}; "Total number of jamiats assigned to a@b.com" -> {"intent":"query","dataset":"jcs","where":[{"field":"email","op":"is","value":"a@b.com"}],"fields":["name","jamiat_count"]}; after "JC with 4 metrics" -> {"intent":"query","dataset":"jcs","where":[{"field":"metric_count","op":"is","value":4}]}, the follow-up "Give me Gmail" -> {"intent":"query","dataset":"jcs","where":[{"field":"metric_count","op":"is","value":4}],"fields":["email"]}; "which jamaats are assigned to Ebrahim" -> {"intent":"query","dataset":"jcs","where":[{"field":"name","op":"contains","value":"Ebrahim"}],"fields":["name","jamaats"]}; "who is the JC of Dhar" -> {"intent":"query","dataset":"jcs","where":[{"field":"jamaats","op":"contains","value":"Dhar"}],"fields":["name"]} (a Jamaat name -> jamaats, a Jamiat name -> jamiats); "top rated JC" / "best JC" / "highest rated" -> {"intent":"query","dataset":"jcs","sort":{"field":"rating","dir":"desc"},"limit":1} (a ranking, NOT rating = 5; "top 3" -> limit 3); "JCs rated 4 or more" -> where rating gte 4;"JCs not rated yet" -> where rating empty; `}"Jamaats with more than 100 houses in Barwani" -> {"intent":"query","dataset":"jamaats","where":[{"field":"houses","op":"gt","value":100},{"field":"jamiat","op":"is","value":"Barwani"}]}; "how many Jamaats are Ummal" -> {"intent":"query","dataset":"jamaats","where":[{"field":"mauze_type","op":"is","value":"Ummal"}],"count_only":true}; "Jamaats per Mauze Type" -> {"intent":"query","dataset":"jamaats","group_by":"mauze_type"}; "what is the mauze type of Dhar" / "how many houses in Dhar" -> {"intent":"query","dataset":"jamaats","where":[{"field":"name","op":"is","value":"Dhar"}],"fields":["name","mauze_type"]} (or "houses"; "jamaat_detail" is only for the FORM answers of a Jamaat); "when was the Ahmedabad stats image uploaded" -> {"intent":"query","dataset":"stats","where":[{"field":"jamiat","op":"is","value":"Ahmedabad"},{"field":"current","op":"is","value":true}]}.
${cat.role === "jc" ? `Questions about other JCs, Sahebs or users (who they are, what they handle, their metrics or anything about them) -> {"intent":"query","dataset":"jcs"} (the software replies).
"my Jamaats"/"my Jamiats" = this person's own; e.g. "how many jamaats do I have" -> {"intent":"query","dataset":"jamaats","count_only":true}.
` : `JC "metrics" = permanent work a JC handles (entered by the JC); "rating" = the Super Admin's 1-5 star rating of a JC.
`}Use "list"/"count"/"submission"/"jamaat_detail"/"comments" (not query) for the JC form's answers, activities and comments.
Use earlier turns to fill in what a follow-up leaves out (e.g. "and in Barwani?" keeps the previous question and status).
"filled"/"updated"/"entered" a question (e.g. "which jamiat has filled tibb") -> "list" with status "answered".
A question about Jamaats, Jamiats, the form, answers, activities, comments or users is NEVER off_topic, even when a name or activity is not in the lists above (the user may misspell it, or it may not exist, or this person may not have access): copy the name as written into "jamiat"/"jamaat"/"activity" and the software will reply. E.g. "which jamaats have yoga done" -> {"intent":"list","question":"tibb","activity":"yoga","status":"done"}; "show the answers of Surat" -> {"intent":"jamaat_detail","jamaat":"Surat"}; "how many jamaats in Pune" -> {"intent":"masters","jamiat":"Pune"}.
Only questions about something else (general knowledge, weather, news, maths, coding, jokes, advice) are "off_topic", even if they mention health or a city.`;
}

/** Asks Groq for the intent. Throws on any failure (the caller falls back). */
// Groq's free plan allows a few questions a minute; when it says "try again in 1.4s", wait that long once.
function retryWait(res, text) {
  const h = Number(res.headers.get("retry-after"));
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(text);
  let ms = m ? (Number(m[1] || 0) * 60000 + Number(m[2]) * (m[3] === "ms" ? 1 : 1000)) : (h > 0 ? h * 1000 : NaN);
  return ms > 0 && ms <= 8000 ? Math.ceil(ms) + 250 : 0;
}

async function aiIntent(cat, message, history) {
  if (!config.groqApiKey) throw new Error("no key");
  const models = [config.groqModel, ...config.groqFallbackModels.filter((m) => m !== config.groqModel)];
  let last;
  // Each model has its own free allowance (tokens a minute, a day). Busy -> the next model; all busy for a
  // few seconds only -> wait for the first one to free up and try once more (better than a weaker answer).
  for (let round = 0; round < 2; round++) {
    for (const model of models) {
      if (exhausted.get(model) > Date.now()) continue;
      try {
        return await aiIntentWith(model, cat, message, history);
      } catch (err) {
        last = err;
        if (err.status === 429) { exhausted.set(model, Date.now() + (err.daily ? 30 * 60000 : Math.max(err.retryMs || 0, 2000))); continue; }
        if (err.status === 404 || err.status === 400 || err.status === 503 || err instanceof SyntaxError) continue;
        throw err;
      }
    }
    const soonest = Math.min(...models.map((m) => exhausted.get(m) || 0)) - Date.now();
    if (round === 0 && soonest > 0 && soonest <= 15000) await new Promise((r) => setTimeout(r, soonest + 200));
    else break;
  }
  throw last || new Error("no model");
}
const exhausted = new Map(); // model -> time it may be tried again

async function aiIntentWith(model, cat, message, history) {
  const messages = [{ role: "system", content: systemPrompt(cat) }];
  for (const h of history.slice(-3)) {
    messages.push({ role: "user", content: h.q });
    messages.push({ role: "assistant", content: JSON.stringify(h.intent) });
  }
  messages.push({ role: "user", content: message });
  const body = {
    model,
    messages,
    temperature: 0,
    // The answer is a small JSON object; Groq's free plan counts this reserve against 8,000 tokens a minute.
    max_completion_tokens: 450,
    response_format: { type: "json_object" },
  };
  if (/gpt-oss/.test(model)) body.reasoning_effort = "low";
  if (/qwen/.test(model)) body.reasoning_effort = "none";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const call = () => fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let res = await call();
    if (res.status === 429) {
      const wait = retryWait(res, await res.clone().text());
      if (wait) { await new Promise((r) => setTimeout(r, wait)); res = await call(); }
    }
    if (!res.ok) {
      const t = (await res.text()).slice(0, 400);
      const err = new Error(`Groq ${model} ${res.status}: ${t}`);
      err.status = res.status;
      err.daily = /per day|TPD|RPD/i.test(t);
      const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(t);
      err.retryMs = m ? Number(m[1] || 0) * 60000 + Number(m[2]) * (m[3] === "ms" ? 1 : 1000) : Number(res.headers.get("retry-after")) * 1000 || 0;
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
  "status", "comment", "comments", "remarks", "jc", "jcs", "user", "users", "saheb", "admin", "month", "mauze", "house", "houses", "answer", "answers", "report", "metric", "metrics", "handles", "handle", "rating", "rated", "stars"];

// Subjects that are never about this data, even next to a place name.
const OFF_WORDS = ["weather", "temperature", "rain", "news", "price", "prices", "cost", "recipe", "cricket", "match", "movie", "film", "song",
  "population", "capital", "history", "distance", "train", "flight", "hotel", "restaurant", "stock", "share", "gold", "time zone", "joke",
  "medicine for", "doctor", "hospital", "disease", "symptoms", "cure", "president", "prime minister", "election"];

// "not yet submitted" wording (norm() turns "haven't" into "haven t").
const NOT_YET = /(^| )(not|no|haven t|hasn t|didn t|don t|doesn t|havent|hasnt|didnt|yet to|pending|remaining|missing|left|without|never|unsubmitted)( |$)/;

/** Reads a question with keywords and names. Good for clear questions; says "unclear" otherwise. */
function basicIntent(cat, message, history) {
  const t = norm(message);
  const words = t.split(" ");
  const prev = history.length ? history[history.length - 1].intent : null;
  if (!t) return { intent: "unclear" };
  const fq = followUpQuery(cat, message, history);
  if (fq) return fq;
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
  if ((/[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]/i.test(message) && !out.question) || has(t, ["user", "users", "jc", "jcs", "who is", "assigned", "saheb", "admin", "metric", "metrics", "rating", "rated", "star", "stars", "handles", "handle", "handling"]) && !out.question) {
    return basicPeople(t, out, cat, message);
  }
  if (has(t, ["comment", "comments", "remark", "remarks"])) return cleanIntent({ ...out, intent: "comments" });
  // "jamaats in <a name we don't know>": let the engine say it isn't found (instead of listing everything).
  const inPlace = /\bjamaats?\s+(?:are\s+)?(?:in|of|under)\s+([a-z0-9][a-z0-9 ()-]{1,60})$/i.exec(message.trim().replace(/[?.!]+$/, ""));
  if (inPlace && !out.jamiat && !out.jamaat && !out.question && !out.status) return cleanIntent({ intent: "masters", jamiat: inPlace[1] });
  if (has(t, ["mauze", "house", "houses", "house count"]) || (has(t, ["how many", "list", "which"]) && has(t, ["jamaats in", "jamaats are in", "jamaats does", "jamaats has"]) && !out.question && !out.status)) {
    return cleanIntent({ ...out, intent: "masters" });
  }
  if (has(t, ["questions", "options", "activities", "what activities"]) && !out.status && !out.jamiat && !out.jamaat) return cleanIntent({ intent: "questions", question: out.question });
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

// "Give me Gmail", "only names", "their metrics" right after a data question: the same question, those details.
function followUpQuery(cat, message, history) {
  const prev = history.length ? history[history.length - 1].intent : null;
  if (!prev || prev.intent !== "query" || !cat.schema || !cat.schema[prev.dataset]) return null;
  const t = norm(message);
  if (!t || t.split(" ").length > 7) return null;
  const fields = cat.schema[prev.dataset].fields;
  const words = { email: ["gmail", "gmails", "email", "emails", "mail", "mails", "mail id", "email id"], name: ["name", "names"], rating: ["rating", "ratings", "stars", "star"],
    jamiats: ["jamiats", "jamiat"], jamaats: ["jamaats", "jamaat"], metrics: ["metrics", "metric"], jamiat_count: ["number of jamiats", "jamiat count", "how many jamiats", "total jamiats"],
    jamaat_count: ["number of jamaats", "jamaat count", "how many jamaats", "total jamaats"], metric_count: ["number of metrics", "how many metrics", "metric count"],
    last_login: ["last login", "last sign in", "last signed in", "logged in"], houses: ["houses", "house count"], children: ["children"], mauze_type: ["mauze", "mauze type"], jcs: ["jcs", "jc"] };
  const asked = [];
  for (const [k, ws] of Object.entries(words)) {
    if (!fields[k] && !(DATASETS[prev.dataset].fields || {})[k]) continue; // hidden ones too: the answer then says who sees them
    if (ws.some((w) => has(t, [w]))) asked.push(k);
  }
  for (const [k, f] of Object.entries(fields)) if (!asked.includes(k) && f.label.length > 3 && has(t, [norm(f.label)])) asked.push(k);
  // counts beat the list of the same thing ("number of jamiats" -> jamiat_count, not jamiats)
  for (const [n, l] of [["jamiat_count", "jamiats"], ["jamaat_count", "jamaats"], ["metric_count", "metrics"]]) if (asked.includes(n)) { const i = asked.indexOf(l); if (i >= 0) asked.splice(i, 1); }
  if (!asked.length) return null;
  // Anything else that looks like a new condition: not a pure follow-up.
  if (/\d|more than|less than|at least|at most|starts? with|where|which|who has|with no|without/.test(t)) return null;
  // "their jamiats" -> name + Jamiats (whose they are); "give me gmail" -> just the Gmail.
  const withName = !asked.includes("name") && !asked.includes("email") && ["jcs", "users", "jamaats", "jamiats"].includes(prev.dataset);
  return cleanIntent({ ...prev, fields: withName ? ["name", ...asked] : asked, count_only: false });
}

// The built-in reader for questions about JCs / users. It only answers what it fully understood:
// anything left over that looks like a condition (a number, "more than", a field word) -> "unclear".
function basicPeople(t, out, cat, message = "") {
  const where = [];
  const q = { intent: "query", dataset: has(t, ["user", "users", "saheb", "admin", "everyone"]) && !has(t, ["jc", "jcs"]) ? "users" : "jcs" };
  let rest = ` ${t} `;
  const eat = (re) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], " "); return m; };
  let m;
  const cmp = (w) => (/(more than|above|over|greater than)/.test(w) ? "gt" : /(less than|below|under|fewer than)/.test(w) ? "lt" : /(at least|or more|minimum|min)/.test(w) ? "gte" : /(at most|or less|maximum|max)/.test(w) ? "lte" : "is");
  if ((m = eat(/ (with |having |who has |has )?(more than|above|over|greater than|less than|below|under|fewer than|at least|at most|exactly )?([1-5]) (star|stars)( rating| rated)?( or more| or less)? /))) where.push({ field: "rating", op: cmp(`${m[2] || ""} ${m[6] || ""}`), value: Number(m[3]) });
  else if ((m = eat(/ (rated|rating( of)?|with a rating( of)?) (more than |above |over |less than |below |under |at least |at most )?([1-5])( stars?)?( or more| or less)? /))) where.push({ field: "rating", op: cmp(`${m[4] || ""} ${m[7] || ""}`), value: Number(m[5]) });
  if (eat(/ (not rated|unrated|no rating|without (a )?rating)( yet)? /)) where.push({ field: "rating", op: "empty" });
  if ((m = eat(/ (with |having |who has |has )?(zero|no|0) metrics? /)) || eat(/ (not|haven t|hasn t) added (any )?metrics? /)) where.push({ field: "metric_count", op: "is", value: 0 });
  else if ((m = eat(/ (with |having |who has |has )?(more than|above|over|less than|below|under|fewer than|at least|at most|exactly )?(\d+) metrics? /))) where.push({ field: "metric_count", op: cmp(m[2] || ""), value: Number(m[3]) });
  if (eat(/ (has |have |with |assigned |handles? )?(all|every) (the )?jamiats? /)) where.push({ field: "all_jamiats", op: "is", value: true });
  if (out.jamiat) { where.push({ field: "jamiats", op: "contains", value: out.jamiat }); rest = rest.replace(` ${norm(out.jamiat)} `, " "); }
  if (out.jamaat && q.dataset === "jcs") { where.push({ field: "jamaats", op: "contains", value: out.jamaat }); rest = rest.replace(` ${norm(out.jamaat)} `, " "); }
  // A Gmail address (read from the original text: the cleaned text has no "@" or ".").
  const mail = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/i.exec(message);
  if (mail) { where.push({ field: "email", op: "is", value: mail[0].toLowerCase() }); rest = rest.replace(` ${norm(mail[0])} `, " "); }
  if ((m = eat(/ (whose )?(names? )?(starts?|starting|begins?|beginning) with (the letter )?([a-z0-9]+) /))) where.push({ field: "name", op: "starts_with", value: m[5] });
  if ((m = eat(/ (whose )?(names? )?(ends?|ending) with (the letter )?([a-z0-9]+) /))) where.push({ field: "name", op: "ends_with", value: m[5] });
  if ((m = eat(/ (whose )?(names? )?(contains?|containing) (the letter )?([a-z0-9]+) /))) where.push({ field: "name", op: "contains", value: m[5] });
  // A number ABOUT each JC ("total number of jamiats assigned to …") is a column, not "how many JCs".
  const countCols = [];
  // "number" also as typed in a hurry (numebr, nubmer, numbr), and "jamiats count" / "count of jamiats".
  const NUM = "(the )?(total )?(nu[a-z]{2,5} of|no of|count of|how many|total)";
  for (const [word, col] of [["(jamiats?|jamaits?|jamiyats?)", "jamiat_count"], ["(jamaats?|jamats?)", "jamaat_count"], ["metrics?", "metric_count"]]) {
    if (eat(new RegExp(` ${NUM} ${word} `)) || eat(new RegExp(` (the )?(total )?${word} (count|total|number) `))) countCols.push(col);
  }
  if ((m = eat(/ (who|which jcs?|jcs?) (handles?|handling|looks? after|manages?|is in charge of) (the )?(.+?)( department| work)? $/))) where.push({ field: "metrics", op: "contains", value: m[4].trim() });
  if (eat(/ (most|highest|maximum|max) metrics? /)) { q.sort = { field: "metric_count", dir: "desc" }; q.limit = 1; }
  else if (eat(/ (least|fewest|lowest|minimum|min) metrics? /)) { q.sort = { field: "metric_count", dir: "asc" }; q.limit = 1; }
  else if (eat(/ (highest|best|top) (rated|rating)|most stars /)) { q.sort = { field: "rating", dir: "desc" }; q.limit = 1; }
  else if (eat(/ (lowest|worst|least) (rated|rating)|fewest stars /)) { q.sort = { field: "rating", dir: "asc" }; q.limit = 1; }
  const fields = [];
  if (/(only|just) (the )?names?|names? only|^names? of/.test(t)) fields.push("name");
  if (/(e ?mail|gmail| mail )/.test(rest)) fields.push("email");
  if (/ (their|the) metrics /.test(rest)) fields.push("metrics");
  if (countCols.length) fields.push("name", ...countCols);
  if (fields.length) q.fields = [...new Set(fields)];
  if (/^(how many|count|number of)/.test(t) && !countCols.length) q.count_only = true;
  // Left-over conditions we didn't understand: don't guess.
  if (/\d/.test(rest) || /(more than|less than|at least|at most|above|below|between|greater|fewer|before|after|since|rated|rating|stars?|metric|login|sign ?in|house|children|mauze|@|starts?|ends?|begin|contain|total|number|named|called)/.test(rest)) {
    return { intent: "unclear", clarify: "I couldn't read every part of that question precisely right now. Please try again in a minute." };
  }
  if (where.length) q.where = where;
  return cleanIntent(q);
}

/** History sent by the browser: only earlier questions and how they were read (checked again here). */
function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.slice(-6).map((x) => ({ q: str(x && x.q, 500), intent: cleanIntent(x && x.intent) })).filter((x) => x.q);
}

/**
 * Checks on the AI's query that the words of the question settle for certain:
 *  - a Gmail address is used exactly as typed (the AI sometimes drops or adds a letter);
 *  - "number of Jamiats assigned to X" / "Jamiats count of X" is X's own count, never "how many JCs".
 */
function fixQuery(intent, message) {
  if (!intent || intent.intent !== "query") return intent;
  const q = { ...intent, where: (intent.where || []).map((c) => ({ ...c })) };
  const mails = (String(message).match(/[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/gi) || []).map((m) => m.toLowerCase());
  if (mails.length === 1) {
    const c = q.where.find((w) => w.field === "email");
    if (c) { c.value = mails[0]; if (!["is", "contains"].includes(c.op)) c.op = "is"; }
    else if (q.dataset === "jcs" || q.dataset === "users") q.where.push({ field: "email", op: "is", value: mails[0] });
  }
  if (q.dataset === "jcs" || q.dataset === "users") {
    const t = ` ${String(message).toLowerCase().replace(/[^a-z0-9@.]+/g, " ")} `;
    const NUM = "(total )?(nu[a-z]{2,5} of|no of|count of|how many|total)";
    for (const [word, col, list] of [["(jamiats?|jamaits?|jamiyats?)", "jamiat_count", "jamiats"], ["(jamaats?|jamats?)", "jamaat_count", "jamaats"], ["metrics?", "metric_count", "metrics"]]) {
      if (new RegExp(` ${NUM} ${word} `).test(t) || new RegExp(` ${word} (count|total|number) `).test(t)) {
        if (q.dataset === "jcs" || col !== "metric_count") {
          q.fields = [...new Set(["name", ...(q.fields || []).filter((f) => f !== list), col])];
          delete q.count_only;
        }
      }
    }
  }
  if (!q.where.length) delete q.where;
  return q;
}

async function readQuestion(user, message, history) {
  const cat = await catalog(user);
  if (config.groqApiKey) {
    try {
      let intent = await aiIntent(cat, message, history);
      const basic = basicIntent(cat, message, history);
      // A count/list needs a question; without one, the built-in reading (e.g. "who hasn't submitted") is better.
      if ((intent.intent === "count" || intent.intent === "list") && !intent.question && basic.intent === "submission") intent = { ...basic, month: intent.month, english_date: intent.english_date };
      // Submitted or not: the words decide ("haven't sent", "not submitted", "pending", "remaining").
      if (intent.intent === "submission") intent = { ...intent, submitted: !NOT_YET.test(norm(message)) };
      // A follow-up like "give me gmail" that the AI didn't connect to the previous question.
      if (["unclear", "off_topic", "help"].includes(intent.intent)) { const f = followUpQuery(cat, message, history); if (f) return { intent: f, source: "ai" }; }
      // The AI asked "did you mean …?" but the built-in reader understood every word: answer instead of asking.
      if (intent.intent === "unclear" && basic.intent === "query") return { intent: fixQuery(basic, message), source: "basic" };
      // "Which Jamiat(s) …": the answer is by Jamiat, even if the AI left that out.
      if (["list", "count", "submission"].includes(intent.intent) && !intent.level && basic.level === "jamiat") intent = { ...intent, level: "jamiat" };
      // Safety net: if the AI calls it off-topic but the question clearly names this data, use the built-in reading.
      if (intent.intent === "off_topic") {
        if (!["off_topic", "unclear", "greeting", "help"].includes(basic.intent)) return { intent: basic, source: "basic" };
      }
      return { intent: fixQuery(intent, message), source: "ai" };
    } catch (err) {
      console.warn("[chat] Groq failed, using the built-in reader:", err.message);
      return { intent: basicIntent(cat, message, history), source: "basic", aiError: err.status === 429 ? "busy" : "failed" };
    }
  }
  return { intent: basicIntent(cat, message, history), source: "basic" };
}

module.exports = { readQuestion, cleanIntent, cleanHistory, basicIntent, catalog, systemPrompt, fixQuery };
