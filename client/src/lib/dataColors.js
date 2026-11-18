// Colours of the Data tab's dropdown choices (palette comes from the server: { green: { bg, ink, darkBg, darkInk } }).
// The CSS picks the light or dark pair (see .dchip / .dsel in styles.css).
export function choiceStyle(palette, choices, value) {
  const c = value ? choices.find((x) => x.value === value) : null;
  const p = c && palette && palette[c.color];
  if (!p) return undefined;
  return { "--cb": p.bg, "--ci": p.ink, "--cbd": p.darkBg, "--cid": p.darkInk };
}
export const colourStyle = (palette, color) => {
  const p = palette && palette[color];
  return p ? { "--cb": p.bg, "--ci": p.ink, "--cbd": p.darkBg, "--cid": p.darkInk } : undefined;
};
