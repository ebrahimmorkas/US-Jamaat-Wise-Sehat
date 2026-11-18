// Colours of the Data tab's status choices: any "#rrggbb" picked by the Super Admin.
// Text on top is dark or white, whichever reads better (same rule as the server's Excel download).
export function inkFor(hex) {
  const h = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#c9ced6";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#111827" : "#ffffff";
}
/** Inline style for a colour (the same colour in light and dark mode: it is the one the Super Admin picked). */
export const colourStyle = (hex) => (hex ? { "--cb": hex, "--ci": inkFor(hex), "--cbd": hex, "--cid": inkFor(hex) } : undefined);
/** Style of a status value, or undefined when it isn't set / isn't a choice. */
export function choiceStyle(choices, value) {
  const c = value ? choices.find((x) => x.value === value) : null;
  return c ? colourStyle(c.color) : undefined;
}
