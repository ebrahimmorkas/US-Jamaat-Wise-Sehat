export const ALL = "All";
export const NOT_FILLED = "Not filled";

export const norm = (v) => (v == null ? "" : String(v).trim());
export const lower = (v) => norm(v).toLowerCase();
export const same = (a, b) => lower(a) === lower(b);
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
export const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

// Answer helpers. Every question (metric) has its own answers:
//   metric.options = [{ value, tone }]   metric.done = ["Completed", ...]
// Tones: good | info | warn (pending) | bad | na (not applicable).
export function makeStatusHelpers() {
  const toneOf = (s, metric) => {
    if (s === NOT_FILLED) return "empty";
    const o = metric && (metric.options || []).find((x) => same(x.value, s));
    return o ? o.tone : "na";
  };
  return {
    statusesFor: (metric) => (metric.options || []).map((o) => o.value),
    toneOf,
    isDone: (v, metric) => (metric.done || []).some((d) => same(d, v)),
    isNA: (v, metric) => !!norm(v) && toneOf(v, metric) === "na",
    isPending: (v, metric) => !!norm(v) && toneOf(v, metric) === "warn",
    matchesStatus: (v, status) => (status === NOT_FILLED ? !norm(v) : same(v, status)),
  };
}

export function scopeRows(jamiats, jamiat, jamaat) {
  const rows = [];
  for (const j of jamiats) {
    if (jamiat !== ALL && j.name !== jamiat) continue;
    for (const jm of j.jamaats) {
      if (jamiat !== ALL && jamaat !== ALL && jm.name !== jamaat) continue;
      rows.push({ jamiat: j.name, ...jm });
    }
  }
  return rows;
}
