export const ALL = "All";
export const NOT_FILLED = "Not filled";

export const norm = (v) => (v == null ? "" : String(v).trim());
export const lower = (v) => norm(v).toLowerCase();
export const same = (a, b) => lower(a) === lower(b);
export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
export const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

// Status helpers that depend on the server-provided config.
export function makeStatusHelpers(config) {
  const done = (config.doneStatuses || []).map(lower);
  const tones = config.statusTones || {};
  const statusesFor = (metric) => config.statusSets[metric.statuses] || [];
  const toneOf = (s) => {
    if (s === NOT_FILLED) return "empty";
    const key = Object.keys(tones).find((k) => same(k, s));
    return key ? tones[key] : "na";
  };
  return {
    statusesFor,
    toneOf,
    // Meanings come from the Super Admin's dropdown settings (via the colour of each answer).
    isDone: (v) => done.includes(lower(v)),
    isNA: (v) => !!norm(v) && toneOf(v) === "na",
    isPending: (v) => !!norm(v) && toneOf(v) === "warn",
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

export function formatDuration(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return m ? `${m}:${String(s).padStart(2, "0")} min` : `${s} sec`;
}
