// The assistant's answers. The AI only turns a question into a small "intent" object; this file runs
// that intent against the database and writes the reply. Every number and name comes from here.
//
// Who sees what (checked here, never left to the AI):
//   JC          -> only the Jamaats assigned to them (and only inside their assigned Jamiats)
//   Saheb       -> every active Jamiat / Jamaat
//   Super Admin -> everything, plus users and their assignments
const User = require("../../models/User");
const Entry = require("../../models/Entry");
const Jamaat = require("../../models/Jamaat");
const Jamiat = require("../../models/Jamiat");
const { activeMasters } = require("../data");
const { activeFields, formFields } = require("../fields");
const { notDeleted } = require("../../lib/softDelete");
const { currentMonth, monthLabel, rangeText, portalMonths, isMonth, fromGregorian } = require("../../lib/month");

const NOT_MINE = "I am not responsible for this.";
const ROW_CAP = 200;
const MEANING_TEXT = {
  done: "Done", progress: "In progress", pending: "Pending", notdone: "Not done", na: "Not applicable",
  answered: "Answered", not_answered: "Not answered",
};
const ROLE_TEXT = { jc: "JC", saheb: "Saheb", superadmin: "Super Admin" };

// ---------- small helpers ----------
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const fmtDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
};
const fmtTime = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const text = (t) => ({ type: "text", text: t });
const table = (columns, rows, note) => ({ type: "table", columns, rows: rows.slice(0, ROW_CAP), ...(rows.length > ROW_CAP ? { note: `Showing the first ${ROW_CAP} of ${rows.length}.` } : note ? { note } : {}) });

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Best matches of a typed name: exact, then starts-with, then contains, then a close spelling. */
function matchName(query, items, nameOf = (x) => x.name) {
  const q = norm(query);
  if (!q) return [];
  const named = items.map((x) => [x, norm(nameOf(x))]);
  const tiers = [
    (n) => n === q,
    (n) => n.replace(/\s+/g, "") === q.replace(/\s+/g, ""),
    (n) => n.startsWith(q + " ") || n.split(" ")[0] === q,
    (n) => n.startsWith(q),
    (n) => q.length >= 3 && (` ${n} `).includes(` ${q} `),
    (n) => q.length >= 4 && n.includes(q),
    (n) => q.length >= 5 && editDistance(n, q) <= Math.max(1, Math.floor(q.length / 6)),
  ];
  for (const t of tiers) {
    const hit = named.filter(([, n]) => t(n)).map(([x]) => x);
    if (hit.length) return hit;
  }
  return [];
}

// Words people use for each answer meaning (the AI also maps them; this is the safety net).
const STATUS_WORDS = [
  ["not_answered", ["not answered", "not filled", "unanswered", "not updated", "missing", "empty", "blank", "left", "unfilled", "not entered"]],
  ["notdone", ["not done", "not completed", "no", "cancelled", "canceled", "not conducted", "not held"]],
  ["na", ["not applicable", "na", "n a", "n/a", "does not apply", "irrelevant"]],
  ["progress", ["in progress", "progress", "ongoing", "going on", "started", "underway", "under way", "partly", "partial", "running"]],
  ["pending", ["pending", "not yet", "yet to", "due", "remaining", "waiting", "awaited", "to do"]],
  ["answered", ["answered", "filled", "updated", "entered", "submitted", "any answer"]],
  ["done", ["done", "complete", "completed", "finished", "yes", "conducted", "held", "over", "achieved", "success", "successful", "accomplished"]],
];
function statusOf(raw) {
  const s = norm(raw);
  if (!s) return null;
  for (const [meaning, words] of STATUS_WORDS) if (meaning === s || words.includes(s)) return meaning;
  return null;
}

// ---------- what this person may see ----------
async function loadScope(user, month) {
  const masters = await activeMasters();
  let jamiats = masters;
  if (user.role === "jc") {
    const u = await User.findById(user.id).select("jamiats jamaats").lean();
    const myJamiats = new Set(((u && u.jamiats) || []).map(String));
    const myJamaats = new Set(((u && u.jamaats) || []).map(String));
    jamiats = masters
      .filter((j) => myJamiats.has(String(j._id)))
      .map((j) => ({ ...j, jamaats: j.jamaats.filter((jm) => myJamaats.has(String(jm._id))) }))
      .filter((j) => j.jamaats.length);
  } else if (!["saheb", "superadmin"].includes(user.role)) {
    jamiats = [];
  }
  const jamaats = jamiats.flatMap((j) => j.jamaats.map((jm) => ({
    _id: jm._id, id: String(jm._id), name: jm.name, jamiat: j.name, jamiatId: String(j._id),
    mauzeType: jm.mauzeType || "", houseCount: jm.houseCount == null ? null : jm.houseCount,
  })));
  const [parents, fields, entries] = await Promise.all([
    activeFields(),
    formFields(month),
    month ? Entry.find({ month, jamaat: { $in: jamaats.map((x) => x._id) } }).select("jamaat values comments doneDates remarks updatedAt").lean() : [],
  ]);
  return {
    role: user.role, month, jamiats, jamaats, parents, fields,
    entryOf: new Map(entries.map((e) => [String(e.jamaat), e])),
    everything: user.role !== "jc",
  };
}

const whereText = (scope) => (scope.role === "jc" ? "your Jamaats" : "all Jamiats");
const monthText = (m) => `${monthLabel(m)} (${rangeText(m)})`;

/** The month asked about: a Hijri "YYYY-MM", an English date inside it, or this month. */
function resolveMonth(intent) {
  const now = currentMonth();
  let m = now;
  if (intent.english_date && /^\d{4}-\d{2}-\d{2}$/.test(intent.english_date)) {
    const [y, mo, d] = intent.english_date.split("-").map(Number);
    const h = fromGregorian(Date.UTC(y, mo - 1, d));
    m = `${h.y}-${String(h.m).padStart(2, "0")}`;
  } else if (isMonth(intent.month)) {
    m = intent.month;
  }
  if (m > now) return { error: `${monthLabel(m)} hasn't started yet, so there is no data for it. The current month is ${monthText(now)}.` };
  if (!portalMonths().includes(m)) {
    const months = portalMonths();
    return { error: `The portal keeps months from ${monthLabel(months[months.length - 1])} to ${monthLabel(now)}. ${monthLabel(m)} is outside that range.` };
  }
  return { month: m };
}

/** Jamaats the question is about (one Jamaat, one Jamiat, or everything visible). */
function pickPlaces(scope, intent) {
  let pool = scope.jamaats;
  let label = whereText(scope);
  const mine = scope.role === "jc" ? " among your Jamaats" : "";
  if (intent.jamiat) {
    const hit = matchName(intent.jamiat, scope.jamiats);
    if (!hit.length) return { error: `I couldn't find a Jamiat called “${intent.jamiat}”${scope.role === "jc" ? " among your Jamiats" : ""}.` + jamiatHint(scope) };
    if (hit.length > 1) return { error: `“${intent.jamiat}” matches more than one Jamiat: ${hit.map((j) => j.name).join(", ")}. Which one do you mean?` };
    pool = pool.filter((x) => x.jamiatId === String(hit[0]._id));
    label = `${hit[0].name} Jamiat`;
  }
  if (intent.jamaat) {
    const hit = matchName(intent.jamaat, pool);
    if (!hit.length) {
      // A Jamiat name given as a Jamaat ("in Barwani")? Use the Jamiat.
      if (!intent.jamiat) {
        const asJamiat = matchName(intent.jamaat, scope.jamiats);
        if (asJamiat.length === 1) return pickPlaces(scope, { ...intent, jamaat: null, jamiat: asJamiat[0].name });
      }
      return { error: `I couldn't find a Jamaat called “${intent.jamaat}”${intent.jamiat ? ` in ${label}` : mine}.` };
    }
    if (hit.length > 1) {
      const exact = hit.filter((x) => norm(x.name) === norm(intent.jamaat));
      if (exact.length !== 1) {
        return { error: `“${intent.jamaat}” matches ${hit.length} Jamaats: ${hit.slice(0, 10).map((x) => `${x.name} (${x.jamiat})`).join(", ")}${hit.length > 10 ? "…" : ""}. Which one do you mean?` };
      }
      hit.splice(0, hit.length, exact[0]);
    }
    return { pool: hit, label: `${hit[0].name} (${hit[0].jamiat})`, one: hit[0] };
  }
  return { pool, label };
}
const jamiatHint = (scope) => (scope.jamiats.length && scope.jamiats.length <= 30 ? ` ${scope.role === "jc" ? "Your" : "The"} Jamiats are: ${scope.jamiats.map((j) => j.name).join(", ")}.` : "");

/** The question (and its activities) the intent is about. */
function resolveQuestion(scope, intent, { needed = true } = {}) {
  const parents = scope.parents;
  let parent = null;
  if (intent.question) {
    parent = parents.find((p) => p.key === intent.question) || matchName(intent.question, parents, (p) => p.label)[0] || null;
  }
  // Only an activity named ("injection"): find its question.
  if (!parent && intent.activity) {
    const acts = scope.fields.filter((f) => f.parentKey && matchName(intent.activity, [f.activity])[0]);
    if (acts.length) parent = parents.find((p) => p.key === acts[0].parentKey);
    else if (!intent.question) return { error: `There is no activity called “${intent.activity}” in ${monthLabel(scope.month)}.${activityHint(scope)}` };
  }
  if (!parent) {
    if (!needed && !intent.question) return { none: true };
    return { error: `${intent.question ? `I couldn't find a question called “${intent.question}”. ` : "Which question do you mean? "}The questions are: ${parents.filter((p) => p.type === "select" || p.type === "date").map((p) => p.label).join(", ")}.` };
  }
  if (!parent.hasActivities) {
    const f = scope.fields.find((x) => x.key === parent.key);
    return { parent, targets: f ? [f] : [] };
  }
  const acts = scope.fields.filter((f) => f.parentKey === parent.key);
  if (!acts.length) return { error: `No activities have been added under ${parent.label} for ${monthLabel(scope.month)}, so there is nothing to answer for it yet.` };
  if (intent.activity) {
    const hit = matchName(intent.activity, acts, (f) => f.activity.name);
    if (!hit.length) return { error: `${parent.label} has no activity called “${intent.activity}” in ${monthLabel(scope.month)}. Its activities are: ${acts.map((a) => a.activity.name).join(", ")}.` };
    return { parent, targets: hit.slice(0, 1) };
  }
  return { parent, targets: acts };
}
function activityHint(scope) {
  const acts = scope.fields.filter((f) => f.parentKey);
  return acts.length ? ` This month's activities are: ${acts.map((a) => a.label).join(", ")}.` : "";
}

/** A test for one answer: meaning (done/pending/…), "answered"/"not_answered", or an exact answer. */
function statusTest(field, status) {
  if (!status) return null;
  const opt = (field.options || []).find((o) => norm(o.value) === norm(status));
  if (opt) return { label: opt.value, test: (v) => v === opt.value, meaning: opt.meaning };
  const meaning = statusOf(status);
  if (!meaning) return { error: `“${status}” is not an answer of ${field.label}. Its answers are: ${(field.options || []).map((o) => o.value).join(", ") || "a date"}.` };
  if (meaning === "answered") return { label: "answered", test: (v) => !!v };
  if (meaning === "not_answered") return { label: "not answered", test: (v) => !v };
  if (field.type === "date") {
    if (meaning === "done") return { label: "filled", test: (v) => !!v };
    return { error: `${field.label} is a date question; it is either filled or not.` };
  }
  const values = field.options.filter((o) => o.meaning === meaning).map((o) => o.value);
  if (!values.length) return { error: `${field.label} has no “${MEANING_TEXT[meaning]}” answer. Its answers are: ${field.options.map((o) => o.value).join(", ")}.` };
  return { label: values.join(" / "), test: (v) => values.includes(v), meaning };
}

const valueOf = (scope, jm, key) => {
  const e = scope.entryOf.get(jm.id);
  return (e && e.values && e.values[key]) || "";
};
const dateOf = (scope, jm, key) => {
  const e = scope.entryOf.get(jm.id);
  return (e && e.doneDates && e.doneDates[key]) || "";
};
const submittedCount = (scope, pool) => pool.filter((x) => scope.entryOf.has(x.id)).length;

// ---------- intents ----------

// "Which Jamaats / Jamiats have <answer> for <question>?"
function listByStatus(scope, intent) {
  const q = resolveQuestion(scope, intent);
  if (q.error) return [text(q.error)];
  const places = pickPlaces(scope, intent);
  if (places.error) return [text(places.error)];
  const pool = places.pool;
  if (!intent.status) return countByStatus(scope, intent); // no answer named: show the split
  const head = `${monthText(scope.month)} · ${places.label}`;
  const subs = submittedCount(scope, pool);
  const out = [];
  const anyOf = q.targets.length > 1 && ["answered", "not_answered"].includes(statusOf(intent.status));

  // "Which Jamaats filled Tibb?" -> any of its activities answered (or none, for "not filled").
  const groups = anyOf
    ? [{ title: q.parent.label, fields: q.targets, combine: true }]
    : q.targets.map((f) => ({ title: f.label, fields: [f] }));
  for (const g of groups) {
    const f = g.fields[0];
    const st = statusTest(f, intent.status);
    if (st.error) return [text(st.error)];
    const want = statusOf(intent.status);
    const hit = pool.filter((jm) => {
      const vals = g.fields.map((x) => valueOf(scope, jm, x.key));
      return g.combine ? (want === "answered" ? vals.some(Boolean) : !vals.some(Boolean)) : st.test(vals[0]);
    });
    const what = g.combine ? (want === "answered" ? `filled at least one ${q.parent.label} activity` : `not filled any ${q.parent.label} activity`) : `${st.label}`;
    out.push(...placesResult(scope, intent, pool, hit, g.combine ? `${g.title}: ${what}` : `${g.title} = ${what}`, f, st));
  }
  out.unshift(text(`${head}. ${plural(subs, "form")} submitted out of ${plural(pool.length, "Jamaat")}.`));
  return out;
}

/** The matching Jamaats, as a Jamiat summary or a Jamaat list. */
function placesResult(scope, intent, pool, hit, title, field, st) {
  const out = [];
  const showDate = field && field.parentKey && st && st.meaning === "done";
  if (!hit.length) {
    out.push(text(`**${title}**: no Jamaat yet.`));
    return out;
  }
  if (intent.level === "jamiat" && !(intent.jamaat)) {
    const byJamiat = new Map();
    for (const jm of pool) {
      if (!byJamiat.has(jm.jamiat)) byJamiat.set(jm.jamiat, { total: 0, hit: 0 });
      byJamiat.get(jm.jamiat).total++;
    }
    for (const jm of hit) byJamiat.get(jm.jamiat).hit++;
    const rows = [...byJamiat.entries()].filter(([, c]) => c.hit).map(([name, c]) => [name, `${c.hit} of ${c.total}`]);
    out.push(text(`**${title}**: ${plural(rows.length, "Jamiat")} (${plural(hit.length, "Jamaat")} in all).`));
    out.push(table(["Jamiat", "Jamaats"], rows));
    return out;
  }
  out.push(text(`**${title}**: ${plural(hit.length, "Jamaat")}.`));
  const many = new Set(hit.map((x) => x.jamiat)).size > 1;
  const cols = ["#", "Jamaat", ...(many ? ["Jamiat"] : []), ...(showDate ? ["Date done"] : [])];
  out.push(table(cols, hit.map((jm, i) => [String(i + 1), jm.name, ...(many ? [jm.jamiat] : []), ...(showDate ? [fmtDay(dateOf(scope, jm, field.key)) || "Not given"] : [])])));
  return out;
}

// "How many Jamaats have each answer for <question>?"
function countByStatus(scope, intent) {
  const q = resolveQuestion(scope, intent);
  if (q.error) return [text(q.error)];
  const places = pickPlaces(scope, intent);
  if (places.error) return [text(places.error)];
  const pool = places.pool;
  const subs = submittedCount(scope, pool);
  const out = [text(`${monthText(scope.month)} · ${places.label}. ${plural(subs, "form")} submitted out of ${plural(pool.length, "Jamaat")}.`)];

  if (places.one) return jamaatAnswers(scope, { ...intent }, places, q);

  if (intent.status) {
    // "How many have Completed for Injection?" -> the number, plus the list.
    const lines = [];
    for (const f of q.targets) {
      const st = statusTest(f, intent.status);
      if (st.error) return [text(st.error)];
      const n = pool.filter((jm) => st.test(valueOf(scope, jm, f.key))).length;
      lines.push([f.label, st.label, String(n)]);
    }
    out.push(table(["Question", "Answer", "Jamaats"], lines));
    return out;
  }
  if (intent.level === "jamiat") {
    for (const f of q.targets) {
      const opts = f.type === "date" ? [] : f.options;
      const rows = scope.jamiats
        .map((j) => {
          const js = pool.filter((x) => x.jamiat === j.name);
          if (!js.length) return null;
          const cells = opts.map((o) => String(js.filter((x) => valueOf(scope, x, f.key) === o.value).length));
          const notFilled = js.filter((x) => !valueOf(scope, x, f.key)).length;
          return [j.name, ...cells, String(notFilled), String(js.length)];
        })
        .filter(Boolean);
      out.push(text(`**${f.label}**`));
      out.push(table(["Jamiat", ...opts.map((o) => o.value), "Not answered", "Jamaats"], rows));
    }
    return out;
  }
  const opts = q.targets[0].type === "date" ? [] : q.targets[0].options;
  const rows = q.targets.map((f) => {
    const cells = opts.map((o) => String(pool.filter((jm) => valueOf(scope, jm, f.key) === o.value).length));
    const filledForm = pool.filter((jm) => scope.entryOf.has(jm.id) && !valueOf(scope, jm, f.key)).length;
    const noForm = pool.length - subs;
    if (f.type === "date") return [f.label, String(pool.filter((jm) => valueOf(scope, jm, f.key)).length), String(filledForm), String(noForm)];
    return [f.label, ...cells, String(filledForm), String(noForm)];
  });
  const cols = q.targets[0].type === "date" ? ["Question", "Date filled", "Left empty", "No form yet"] : ["Question", ...opts.map((o) => o.value), "Left empty", "No form yet"];
  out.push(table(cols, rows, "“Left empty” = the form was submitted without this answer. “No form yet” = the Jamaat hasn't submitted this month's form."));
  return out;
}

// "Which Jamaats / Jamiats have submitted the form?"
function submissions(scope, intent) {
  const places = pickPlaces(scope, intent);
  if (places.error) return [text(places.error)];
  const pool = places.pool;
  const done = pool.filter((x) => scope.entryOf.has(x.id));
  const head = text(`${monthText(scope.month)} · ${places.label}: **${done.length} of ${pool.length}** Jamaats have submitted the form; ${pool.length - done.length} not yet.`);
  if (places.one) {
    const e = scope.entryOf.get(places.one.id);
    return [text(e ? `${places.one.name} (${places.one.jamiat}) submitted the form for ${monthLabel(scope.month)}; last saved on ${fmtTime(e.updatedAt)}.` : `${places.one.name} (${places.one.jamiat}) has not submitted the form for ${monthLabel(scope.month)} yet.`)];
  }
  if (intent.level === "jamiat") {
    const rows = scope.jamiats.map((j) => {
      const js = pool.filter((x) => x.jamiat === j.name);
      if (!js.length) return null;
      const n = js.filter((x) => scope.entryOf.has(x.id)).length;
      return [j.name, String(n), String(js.length - n), String(js.length)];
    }).filter(Boolean);
    const filtered = intent.submitted === true ? rows.filter((r) => r[1] !== "0") : intent.submitted === false ? rows.filter((r) => r[2] !== "0") : rows;
    return [head, table(["Jamiat", "Submitted", "Not yet", "Jamaats"], filtered)];
  }
  const want = intent.submitted === false ? pool.filter((x) => !scope.entryOf.has(x.id)) : done;
  const many = new Set(want.map((x) => x.jamiat)).size > 1;
  if (!want.length) return [head];
  const title = intent.submitted === false ? "Not submitted yet" : "Submitted";
  return [head, text(`**${title}** (${want.length}):`),
    table(["#", "Jamaat", ...(many ? ["Jamiat"] : []), ...(intent.submitted === false ? [] : ["Last saved"])],
      want.map((x, i) => [String(i + 1), x.name, ...(many ? [x.jamiat] : []), ...(intent.submitted === false ? [] : [fmtTime(scope.entryOf.get(x.id).updatedAt)])]))];
}

// "What did Dhar answer?" / "Show Dhar's form"
function jamaatAnswers(scope, intent, placesIn, qIn) {
  const places = placesIn || pickPlaces(scope, intent);
  if (places.error) return [text(places.error)];
  if (!places.one) {
    return [text(`Which Jamaat do you mean? Please name one Jamaat${scope.role === "jc" ? " (one of yours)" : ""}.`)];
  }
  const jm = places.one;
  const e = scope.entryOf.get(jm.id);
  const q = qIn || resolveQuestion(scope, intent, { needed: false });
  if (q.error) return [text(q.error)];
  const out = [text(`**${jm.name}** (${jm.jamiat}) · ${monthText(scope.month)}`)];
  if (!e) {
    out.push(text(`This Jamaat has not submitted the form for ${monthLabel(scope.month)} yet, so there are no answers.`));
    return out;
  }
  out.push(text(`Last saved on ${fmtTime(e.updatedAt)}.`));
  const fields = q.none ? scope.fields : q.targets;
  const rows = fields.map((f) => {
    const v = valueOf(scope, jm, f.key);
    const shown = f.type === "date" ? fmtDay(v) : v;
    const d = f.parentKey ? fmtDay(dateOf(scope, jm, f.key)) : "";
    return [f.label, shown || "—", d, ((e.comments || {})[f.key] || "")];
  });
  const hasDate = rows.some((r) => r[2]);
  const hasComment = rows.some((r) => r[3]);
  out.push(table(["Question", "Answer", ...(hasDate ? ["Date done"] : []), ...(hasComment ? ["Comment"] : [])],
    rows.map((r) => [r[0], r[1], ...(hasDate ? [r[2] || ""] : []), ...(hasComment ? [r[3]] : [])])));
  if (q.none && e.remarks) out.push(text(`**Remarks:** ${e.remarks}`));
  return out;
}

// Jamiats / Jamaats and their details.
function masters(scope, intent) {
  if (intent.jamaat) {
    const places = pickPlaces(scope, intent);
    if (places.error) return [text(places.error)];
    if (places.one) {
      const jm = places.one;
      return [text(`**${jm.name}** is in ${jm.jamiat} Jamiat.`),
        table(["Detail", "Value"], [["Mauze Type", jm.mauzeType || "Not set"], ["House Count", jm.houseCount == null ? "Not set" : String(jm.houseCount)]])];
    }
    return [text(`${places.label}: ${plural(places.pool.length, "Jamaat")}.`), table(["#", "Jamaat"], places.pool.map((x, i) => [String(i + 1), x.name]))];
  }
  if (intent.jamiat) {
    const places = pickPlaces(scope, intent);
    if (places.error) return [text(places.error)];
    return [text(`**${places.label}** has ${plural(places.pool.length, "Jamaat")}${scope.role === "jc" ? " assigned to you" : ""}.`),
      table(["#", "Jamaat", "Mauze Type", "Houses"], places.pool.map((x, i) => [String(i + 1), x.name, x.mauzeType || "—", x.houseCount == null ? "—" : String(x.houseCount)]))];
  }
  const rows = scope.jamiats.map((j) => [j.name, String(j.jamaats.length)]);
  const total = scope.jamaats.length;
  return [text(scope.role === "jc"
    ? `You are assigned **${plural(total, "Jamaat")}** in ${plural(rows.length, "Jamiat")}.`
    : `There are **${plural(rows.length, "Jamiat")}** with **${plural(total, "Jamaat")}** in all.`),
  table(["Jamiat", "Jamaats"], rows)];
}

// The questions, their answers and this month's activities.
function questions(scope) {
  const rows = [];
  for (const p of scope.parents) {
    const answers = p.type === "date" ? "A date" : p.options.map((o) => o.value).join(", ");
    if (p.hasActivities) {
      const acts = scope.fields.filter((f) => f.parentKey === p.key).map((f) => f.activity.name);
      rows.push([p.section, p.label, answers, acts.length ? acts.join(", ") : "None added yet"]);
    } else rows.push([p.section, p.label, answers, ""]);
  }
  return [text(`The JC form for ${monthText(scope.month)} has these questions:`), table(["Section", "Question", "Answers", "Activities this month"], rows)];
}

// Comments (and remarks) written by JCs.
function comments(scope, intent) {
  const places = pickPlaces(scope, intent);
  if (places.error) return [text(places.error)];
  const q = resolveQuestion(scope, intent, { needed: false });
  if (q.error) return [text(q.error)];
  const keys = q.none ? null : new Set(q.targets.map((f) => f.key));
  const label = (k) => (scope.fields.find((f) => f.key === k) || {}).label || "Question no longer on the form";
  const rows = [];
  for (const jm of places.pool) {
    const e = scope.entryOf.get(jm.id);
    if (!e) continue;
    for (const [k, c] of Object.entries(e.comments || {})) if (c && (!keys || keys.has(k))) rows.push([jm.name, jm.jamiat, label(k), c]);
    if (!keys && e.remarks) rows.push([jm.name, jm.jamiat, "Remarks", e.remarks]);
  }
  const head = `${monthText(scope.month)} · ${places.label}`;
  if (!rows.length) return [text(`${head}: no comments${keys ? ` on ${q.parent.label}` : ""} yet.`)];
  return [text(`${head}: ${plural(rows.length, "comment")}.`), table(["Jamaat", "Jamiat", "Question", "Comment"], rows)];
}

// Users and who is assigned where (Super Admin only).
async function users(scope, intent, user) {
  if (user.role !== "superadmin") return [text("User and assignment details are only available to the Super Admin.")];
  const all = await User.find({ ...notDeleted() }).select("name email username role isActive jamiats jamaats").lean();
  const [jts, jms] = await Promise.all([Jamiat.find(notDeleted()).select("name").lean(), Jamaat.find(notDeleted()).select("name jamiat").lean()]);
  const jtName = new Map(jts.map((j) => [String(j._id), j.name]));
  const jmName = new Map(jms.map((j) => [String(j._id), j.name]));
  let list = all;
  const role = ["jc", "saheb", "superadmin"].includes(intent.role_filter) ? intent.role_filter : null;
  if (role) list = list.filter((u) => u.role === role);
  let title = role ? `${ROLE_TEXT[role]}s` : "Everyone who can sign in";
  if (intent.person) {
    const hit = matchName(intent.person, list, (u) => `${u.name || ""} ${u.email || u.username || ""}`)
      .concat(list.filter((u) => norm(u.email).startsWith(norm(intent.person))));
    list = [...new Set(hit)];
    title = `Users matching “${intent.person}”`;
  }
  if (intent.jamaat || intent.jamiat) {
    const places = pickPlaces({ ...scope, role: "superadmin" }, intent);
    if (places.error) return [text(places.error)];
    const ids = new Set(places.pool.map((x) => x.id));
    const jtIds = new Set(places.pool.map((x) => x.jamiatId));
    list = list.filter((u) => u.role === "jc" && (u.jamaats || []).some((id) => ids.has(String(id))) && (u.jamiats || []).some((id) => jtIds.has(String(id))));
    title = `JCs assigned to ${places.label}`;
  }
  if (!list.length) return [text(`${title}: nobody found.`)];
  const names = (ids, map) => {
    const n = (ids || []).map((id) => map.get(String(id))).filter(Boolean);
    return n.length > 4 ? `${n.slice(0, 4).join(", ")} +${n.length - 4} more` : n.join(", ");
  };
  return [text(`**${title}**: ${list.length}.`), table(["Name", "Gmail", "Role", "Active", "Jamiats", "Jamaats"],
    list.map((u) => [u.name || "—", u.email || u.username || "—", ROLE_TEXT[u.role] || u.role, u.isActive === false ? "No" : "Yes",
      u.role === "jc" ? names(u.jamiats, jtName) || "—" : "All", u.role === "jc" ? `${(u.jamaats || []).length}${(u.jamaats || []).length ? `: ${names(u.jamaats, jmName)}` : ""}` : "All"]))];
}

function help(scope) {
  const ex = scope.role === "jc"
    ? ["Which of my Jamaats have not submitted the form?", "Which Jamaats have Injection completed?", "Show the answers of <your Jamaat>", "How many Jamaats are pending for Tibb?"]
    : ["Which Jamiats have filled Tibb?", "Which Jamaats in Barwani have Injection done?", "How many Jamaats submitted the form this month?", "Show the comments on Tibb"];
  if (scope.role === "superadmin") ex.push("Who is the JC of Dhar?");
  return [text(`I answer questions about the JC form data you can see${scope.role === "jc" ? " (only your assigned Jamaats)" : ""}: answers, activities and their dates, submitted forms, comments, Jamiats and Jamaats, and any month from the last 3 years. For example:`),
    { type: "examples", items: ex }];
}

/** Runs one intent; returns the reply blocks. */
async function runIntent(user, intent) {
  if (!intent || intent.intent === "off_topic") return [text(NOT_MINE)];
  const kind = intent.intent;
  if (kind === "greeting") {
    const scope = await loadScope(user, null);
    return [text("Salaam! Ask me anything about the JC form data."), ...help(scope).slice(1)];
  }
  const m = resolveMonth(intent);
  if (m.error) return [text(m.error)];
  const scope = await loadScope(user, m.month);
  if (!scope.jamaats.length && kind !== "help") {
    return [text(scope.role === "jc" ? "No Jamaats are assigned to you yet, so there is no data to answer from. Ask the Super Admin to assign your Jamaats." : "There are no active Jamiats or Jamaats yet.")];
  }
  switch (kind) {
    case "list": return listByStatus(scope, intent);
    case "count": return countByStatus(scope, intent);
    case "submission": return submissions(scope, intent);
    case "jamaat_detail": return jamaatAnswers(scope, intent);
    case "masters": return masters(scope, intent);
    case "questions": return questions(scope);
    case "comments": return comments(scope, intent);
    case "users": return users(scope, intent, user);
    case "help": return help(scope);
    case "unclear":
    default:
      return [text(intent.clarify || "I didn't quite understand that. Could you ask it another way? For example:"), ...help(scope).slice(1)];
  }
}

module.exports = { runIntent, loadScope, statusOf, matchName, norm, NOT_MINE, STATUS_WORDS };
