// Report PDFs. The Super Admin uploads a one-page PDF (the "format"): borders, background, a box with the word
// "Image" where a photo goes, and the words "Jamiat" / "Jamaat" where the names go. Each "Jamaat" word is one
// place for a Jamaat (3 rows = 3 Jamaats a page); the Image boxes and Jamiat words near it belong to it.
// Optional words: "Title" and "Date" (the report's heading, on every page, typed by Media) and
// "Description" (inside a box: each Jamaat's description, typed by Media, wrapped to fit the box).
// Media types each of them in Lisan ud Dawat (Al-Kanz font, right to left) or English.
//
//   analyze(bytes)  -> where the places are (stored with the format)
//   buildReport()   -> the format repeated as many times as needed: the words are removed from the page and
//                      replaced by the names, each photo is put (whole, centred) in its box. A Jamaat with fewer
//                      photos than boxes gets its photos centred and no empty box shows.
//   notFilledPdf()  -> a plain list of Jamaats that haven't filled the form
//
// The page is changed by editing its drawing commands (pdf-lib), so nothing else on it moves or changes.
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFRef, PDFNumber,
  decodePDFRawStream, StandardFonts, rgb, degrees,
  pushGraphicsState, popGraphicsState, rectangle, clip, endPath,
} = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const fontkit = require("@pdf-lib/fontkit");

// Arabic names are written in the Al-Kanz font (the Arabic names were typed for it: e.g. "ثث" shows as "پ").
// REPORT_ARABIC_FONT = another .ttf to use instead. No font file = English names only.
const ARABIC_FONT = process.env.REPORT_ARABIC_FONT || path.join(__dirname, "..", "..", "assets", "fonts", "Al-Kanz.ttf");
let arabic; // { bytes, kit } | null
function arabicFont() {
  if (arabic === undefined) {
    try { const bytes = fs.readFileSync(ARABIC_FONT); arabic = { bytes, kit: fontkit.create(bytes) }; } catch {
      arabic = null;
      console.warn(`[reports] Arabic font not found (${ARABIC_FONT}): reports show English names`);
    }
  }
  return arabic;
}
const HAS_ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const AR_SCALE = 1.2; // Al-Kanz letters look smaller than Helvetica at the same size
const MIRROR = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<" };
/** The font lays Arabic out right to left as a whole: brackets must be mirrored and numbers / English kept left to right. */
// (Arabic digits ٠-٩ / ۰-۹ too: "١٤٤٨" must read left to right.)
const rtlText = (s) => s.replace(/[()[\]{}<>]/g, (c) => MIRROR[c]).replace(/[0-9A-Za-z٠-٩۰-۹]{2,}/g, (w) => [...w].reverse().join(""));
/** Letters in this text the Arabic font can't draw (none when there is no font: then nothing is checked). */
// English text is drawn in Helvetica (Windows Latin letters only).
const LATIN_EXTRA = new Set([..."€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"]);
/** Letters the English font can't show (accents are dropped, so é is fine). */
function missingLatin(value) {
  const plain = String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return [...new Set([...plain].filter((ch) => {
    const c = ch.codePointAt(0);
    return !/\s/.test(ch) && !((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || LATIN_EXTRA.has(ch));
  }))];
}
function missingLetters(value) {
  const a = arabicFont();
  if (!a) return [];
  return [...new Set([...String(value || "").normalize("NFC")].filter((ch) => !/\s/.test(ch) && !a.kit.hasGlyphForCodePoint(ch.codePointAt(0))))];
}
/** The Arabic text as typed (tidied), or "" when there is none / the font can't show it (then English is used). */
function arabicPlain(value, keepLines) {
  const a = arabicFont();
  const t = String(value || "").normalize("NFC").replace(keepLines ? /[ \t]+/g : /\s+/g, " ").trim();
  if (!a || !t || !HAS_ARABIC.test(t)) return "";
  if ([...t].some((ch) => !/\s/.test(ch) && !a.kit.hasGlyphForCodePoint(ch.codePointAt(0)))) return "";
  return t;
}
/** The Arabic name ready to draw, or "" when there is none / the font can't show it (then the English name is used). */
function arabicOf(value) {
  const t = arabicPlain(value);
  return t ? rtlText(t) : "";
}
/**
 * A right-to-left line split into runs (in reading order): Arabic words together, and words without Arabic letters
 * (English, numbers, signs) on their own, drawn left to right. The font lays out a run that starts with English
 * as English, so English words mixed into Arabic text must be drawn separately.
 */
function rtlRuns(line) {
  const runs = [];
  for (const word of line.split(" ")) {
    if (!word) continue;
    const ar = HAS_ARABIC.test(word);
    const last = runs[runs.length - 1];
    if (last && last.ar === ar) last.text += ` ${word}`; else runs.push({ ar, text: word });
  }
  return runs.map((r) => ({ ar: r.ar, text: r.ar ? rtlText(r.text) : r.text }));
}
const runsWidth = (font, runs, size) => runs.reduce((w, r, i) => w + font.widthOfTextAtSize(r.text, size) + (i ? font.widthOfTextAtSize(" ", size) : 0), 0);
/** Draws the runs from the right edge leftwards (first run rightmost). */
function drawRuns(page, font, runs, right, y, size, color) {
  const space = font.widthOfTextAtSize(" ", size);
  let x = right;
  runs.forEach((r, i) => {
    if (i) x -= space;
    x -= font.widthOfTextAtSize(r.text, size);
    page.drawText(r.text, { x, y, size, font, color });
  });
}

class FormatError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}

const MM = 72 / 25.4; // points in a millimetre
const LINE = 1.45; // line height of descriptions (x the letter size)
const LAYOUT_V = 3; // older formats are read again (2: Title / Date / Description; 3: each Jamaat's whole place, left out when empty)
const WORDS = { image: "image", jamiat: "jamiat", jamaat: "jamaat", title: "title", date: "date", description: "description" };

// ---------- small matrix helpers ([a b c d e f], PDF order) ----------
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const ID = [1, 0, 0, 1, 0, 0];
const boxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
};
const rectPts = (m, x, y, w, h) => [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)];
const union = (a, b) => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const inter = (a, b) => (!a ? b : !b ? a : { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
const area = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const center = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const contains = (outer, inner, pad = 0) => inner.x0 >= outer.x0 - pad && inner.x1 <= outer.x1 + pad && inner.y0 >= outer.y0 - pad && inner.y1 <= outer.y1 + pad;
const holds = (b, [x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
const round = (n) => Math.round(n * 100) / 100;
const rbox = (b) => ({ x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) });

// ---------- content stream parsing ----------
const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0";
const isDelim = (c) => "()<>[]{}/%".includes(c);

function readLiteral(s, i) { // s[i] === "("; returns [string, end]
  let depth = 1, out = "";
  i++;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      const e = s[i + 1];
      i += 2;
      if (e === "n") out += "\n"; else if (e === "r") out += "\r"; else if (e === "t") out += "\t";
      else if (e === "b") out += "\b"; else if (e === "f") out += "\f";
      else if (e >= "0" && e <= "7") {
        let oct = e;
        while (oct.length < 3 && s[i] >= "0" && s[i] <= "7") oct += s[i++];
        out += String.fromCharCode(parseInt(oct, 8) & 255);
      } else if (e === "\r") { if (s[i] === "\n") i++; } else if (e !== "\n") out += e;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return [out, i + 1];
    out += ch;
    i++;
  }
  return [out, i];
}

/** Content stream text (latin1) -> [{ op, args, s, e }] where s..e is the whole command (operands + operator). */
function parseOps(s) {
  const ops = [];
  let stack = [];
  const arrays = [];
  let start = -1;
  let i = 0;
  const n = s.length;
  const push = (v, at) => {
    if (arrays.length) { arrays[arrays.length - 1].push(v); return; }
    if (start < 0) start = at;
    stack.push(v);
  };
  while (i < n) {
    const c = s[i];
    if (isWs(c)) { i++; continue; }
    if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    const at = i;
    if (c === "(") { const [str, e] = readLiteral(s, i); i = e; push({ str }, at); continue; }
    if (c === "<" && s[i + 1] === "<") { // dictionary operand (marked content): kept as text
      let depth = 0;
      while (i < n) {
        if (s[i] === "(") { i = readLiteral(s, i)[1]; continue; }
        if (s[i] === "<" && s[i + 1] === "<") { depth++; i += 2; continue; }
        if (s[i] === ">" && s[i + 1] === ">") { depth--; i += 2; if (!depth) break; continue; }
        i++;
      }
      push({ dict: s.slice(at, i) }, at);
      continue;
    }
    if (c === "<") {
      const e = s.indexOf(">", i);
      const end = e < 0 ? n : e;
      let hex = s.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, "");
      if (hex.length % 2) hex += "0";
      let str = "";
      for (let k = 0; k < hex.length; k += 2) str += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      i = end + 1;
      push({ str }, at);
      continue;
    }
    if (c === "[") { if (!arrays.length && start < 0) start = at; arrays.push([]); i++; continue; }
    if (c === "]") { i++; const a = arrays.pop(); if (a) push(a, at); continue; }
    if (c === "{" || c === "}" || c === ">" || c === ")") { i++; continue; }
    if (c === "/") {
      let j = i + 1;
      while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++;
      push({ name: s.slice(i + 1, j) }, at);
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !isWs(s[j]) && !isDelim(s[j])) j++;
    const word = s.slice(i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { push(Number(word), at); continue; }
    if (word === "true" || word === "false" || word === "null") { push(word, at); continue; }
    if (word === "BI") { // inline image: BI <dict> ID <data> EI
      const id = s.indexOf("ID", i);
      let k = id < 0 ? n : id + 3;
      while (k < n) {
        const ei = s.indexOf("EI", k);
        if (ei < 0) { k = n; break; }
        if (isWs(s[ei - 1]) && (ei + 2 >= n || isWs(s[ei + 2]))) { k = ei + 2; break; }
        k = ei + 2;
      }
      ops.push({ op: "BI", args: [], s: start < 0 ? at : start, e: k });
      i = k;
      stack = []; start = -1;
      continue;
    }
    ops.push({ op: word, args: stack, s: start < 0 ? at : start, e: j });
    stack = [];
    start = -1;
  }
  return ops;
}

// ---------- fonts (just enough to read the placeholder words and the width of each letter) ----------
const utf16 = (bytes) => {
  let out = "";
  for (let k = 0; k + 1 < bytes.length; k += 2) out += String.fromCharCode((bytes.charCodeAt(k) << 8) | bytes.charCodeAt(k + 1));
  return out;
};
const hexStr = (h) => { let s = ""; for (let k = 0; k + 1 < h.length; k += 2) s += String.fromCharCode(parseInt(h.slice(k, k + 2), 16)); return s; };
const hexNum = (h) => parseInt(h, 16);

function parseCMap(text) {
  const map = new Map();
  let bytes = 0;
  for (const block of text.match(/begincodespacerange([\s\S]*?)endcodespacerange/g) || []) {
    const m = block.match(/<([0-9a-fA-F]+)>/);
    if (m) bytes = Math.max(bytes, m[1].length / 2);
  }
  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
    let m;
    while ((m = re.exec(block))) map.set(hexNum(m[1]), utf16(hexStr(m[2])));
  }
  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]*)>|\[([^\]]*)\])/g;
    let m;
    while ((m = re.exec(block))) {
      const lo = hexNum(m[1]), hi = hexNum(m[2]);
      if (hi - lo > 65535) continue;
      if (m[4] !== undefined) {
        const dst = hexStr(m[4]);
        const last = dst.length >= 2 ? (dst.charCodeAt(dst.length - 2) << 8) | dst.charCodeAt(dst.length - 1) : 0;
        const head = utf16(dst.slice(0, Math.max(0, dst.length - 2)));
        for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + (c - lo)));
      } else {
        const list = (m[5].match(/<([0-9a-fA-F]*)>/g) || []).map((x) => utf16(hexStr(x.slice(1, -1))));
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
      }
    }
  }
  return { map, bytes };
}

const GLYPH_NAMES = { space: " ", hyphen: "-", period: ".", comma: ",", colon: ":", braceleft: "{", braceright: "}", underscore: "_" };
["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].forEach((w, k) => { GLYPH_NAMES[w] = String(k); });
const glyphName = (n) => (n.length === 1 ? n : GLYPH_NAMES[n] || (/^uni([0-9A-F]{4})$/.test(n) ? String.fromCharCode(parseInt(n.slice(3), 16)) : ""));

function makeReader(doc) {
  const ctx = doc.context;
  const look = (x) => (x instanceof PDFRef ? ctx.lookup(x) : x);
  const num = (x) => { const v = look(x); return v instanceof PDFNumber ? v.asNumber() : typeof v === "number" ? v : 0; };
  const name = (x) => { const v = look(x); return v instanceof PDFName ? v.decodeText() : ""; };
  const arr = (x) => { const v = look(x); return v instanceof PDFArray ? v.asArray() : []; };
  const dict = (x) => { const v = look(x); return v instanceof PDFDict ? v : v instanceof PDFStream ? v.dict : null; };
  const streamText = (x) => {
    const v = look(x);
    if (v instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(v).decode()).toString("latin1");
    if (v instanceof PDFStream && v.getContents) return Buffer.from(v.getContents()).toString("latin1");
    return "";
  };
  const fonts = new Map();
  function font(ref) {
    const key = ref instanceof PDFRef ? ref.toString() : ref;
    if (key && fonts.has(key)) return fonts.get(key);
    const d = dict(ref);
    const f = { bytes: 1, widths: new Map(), dw: 0, scale: 0.001, toUni: null, enc: new Map(), name: "", bold: false };
    if (d) {
      const sub = name(d.get(PDFName.of("Subtype")));
      f.name = name(d.get(PDFName.of("BaseFont")));
      if (sub === "Type0") {
        f.bytes = 2;
        const desc = dict(arr(d.get(PDFName.of("DescendantFonts")))[0]);
        if (desc) {
          f.dw = desc.get(PDFName.of("DW")) ? num(desc.get(PDFName.of("DW"))) : 1000;
          const w = arr(desc.get(PDFName.of("W"))).map(look);
          for (let k = 0; k < w.length;) {
            const first = num(w[k]);
            if (w[k + 1] instanceof PDFArray) { w[k + 1].asArray().forEach((x, j) => f.widths.set(first + j, num(x))); k += 2; }
            else { const last = num(w[k + 1]), wd = num(w[k + 2]); for (let c = first; c <= last && c - first < 65536; c++) f.widths.set(c, wd); k += 3; }
          }
          if (!f.name) f.name = name(desc.get(PDFName.of("BaseFont")));
        }
      } else {
        const first = num(d.get(PDFName.of("FirstChar")));
        arr(d.get(PDFName.of("Widths"))).forEach((x, j) => f.widths.set(first + j, num(x)));
        const fd = dict(d.get(PDFName.of("FontDescriptor")));
        f.dw = fd && fd.get(PDFName.of("MissingWidth")) ? num(fd.get(PDFName.of("MissingWidth"))) : f.widths.size ? 0 : 500;
        if (sub === "Type3") { const fm = arr(d.get(PDFName.of("FontMatrix"))); f.scale = fm.length ? num(fm[0]) : 0.001; }
        const enc = dict(d.get(PDFName.of("Encoding")));
        if (enc) {
          let code = 0;
          for (const x of arr(enc.get(PDFName.of("Differences"))).map(look)) {
            if (x instanceof PDFNumber) code = x.asNumber();
            else if (x instanceof PDFName) f.enc.set(code++, glyphName(x.decodeText()));
          }
        }
      }
      const tu = d.get(PDFName.of("ToUnicode"));
      if (tu) {
        const cm = parseCMap(streamText(tu));
        f.toUni = cm.map;
        if (sub !== "Type0" && cm.bytes === 2) f.bytes = 2;
      }
      f.bold = /bold|black|heavy|semibold|demi/i.test(f.name);
    }
    f.uni = (code) => (f.toUni && f.toUni.has(code) ? f.toUni.get(code) : f.enc.has(code) ? f.enc.get(code) : f.bytes === 1 ? String.fromCharCode(code) : "");
    f.width = (code) => (f.widths.has(code) ? f.widths.get(code) : f.dw);
    if (key) fonts.set(key, f);
    return f;
  }
  return { look, num, name, arr, dict, streamText, font };
}

/** Reads the drawing of a page: every letter (with where it is) and every painted shape / picture. */
function readPage(doc, page) {
  const R = makeReader(doc);
  const streams = new Map(); // key -> { text, ops, ref }
  const glyphs = [];
  const shapes = [];
  const contents = R.look(page.node.get(PDFName.of("Contents")));
  const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const pageText = parts.map((p) => R.streamText(p)).join("\n");
  const pageRes = page.node.Resources();

  function walk(key, text, resources, ctm0, depth) {
    const ops = parseOps(text);
    if (!streams.has(key)) streams.set(key, { text, ops });
    const res = (k) => (resources ? R.dict(resources.get(PDFName.of(k))) : null);
    const fontRes = res("Font");
    const xRes = res("XObject");
    const gs = { ctm: ctm0, fill: [0, 0, 0], Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, size: 0, rise: 0, clipBox: null };
    const stack = [];
    let tm = ID, tlm = ID;
    let path = [];
    let pendingClip = false;
    const record = (op, bbox, kind) => {
      const b = gs.clipBox ? inter(bbox, gs.clipBox) : bbox;
      if (b.x1 - b.x0 > 0.5 && b.y1 - b.y0 > 0.5) shapes.push({ stream: key, op, bbox: b, kind });
    };
    const setFill = (vals) => {
      const v = vals.filter((x) => typeof x === "number");
      if (v.length === 1) gs.fill = [v[0], v[0], v[0]];
      else if (v.length === 3) gs.fill = v;
      else if (v.length === 4) gs.fill = [(1 - v[0]) * (1 - v[3]), (1 - v[1]) * (1 - v[3]), (1 - v[2]) * (1 - v[3])];
    };
    const show = (str, opIndex, part) => {
      const f = gs.font;
      if (!f || !gs.size) return;
      const size = gs.size, Th = gs.Th;
      for (let k = 0, idx = 0; k < str.length; idx++) {
        let code = 0;
        for (let b = 0; b < f.bytes && k < str.length; b++, k++) code = (code << 8) | str.charCodeAt(k);
        const w0 = f.width(code) * f.scale;
        const adv = (w0 * size + gs.Tc + (f.bytes === 1 && code === 32 ? gs.Tw : 0)) * Th;
        const m = mul(tm, gs.ctm);
        const bbox = boxOf(rectPts(m, 0, gs.rise - 0.22 * size, Math.max(adv, w0 * size * Th), 0.97 * size));
        const eff = size * Math.hypot(m[2], m[3]);
        const [ox, oy] = apply(m, 0, gs.rise);
        glyphs.push({ stream: key, op: opIndex, part, idx, uni: f.uni(code), bbox, x: ox, y: oy, end: apply(m, adv, gs.rise)[0], size: eff,
          adjN: size ? -((w0 * size + gs.Tc + (f.bytes === 1 && code === 32 ? gs.Tw : 0)) * 1000) / size : 0,
          fill: gs.fill.slice(), bold: f.bold, bytes: f.bytes });
        tm = mul([1, 0, 0, 1, adv, 0], tm);
      }
    };
    const nextLine = () => { tlm = mul([1, 0, 0, 1, 0, -gs.TL], tlm); tm = tlm; };
    ops.forEach((o, i) => {
      const a = o.args;
      switch (o.op) {
        case "q": stack.push({ ...gs, fill: gs.fill.slice() }); break;
        case "Q": if (stack.length) Object.assign(gs, stack.pop()); break;
        case "cm": if (a.length === 6) gs.ctm = mul(a, gs.ctm); break;
        case "g": case "rg": case "k": case "sc": case "scn": setFill(a); break;
        case "m": case "l": path.push(apply(gs.ctm, a[0], a[1])); break;
        case "c": path.push(apply(gs.ctm, a[0], a[1]), apply(gs.ctm, a[2], a[3]), apply(gs.ctm, a[4], a[5])); break;
        case "v": case "y": path.push(apply(gs.ctm, a[0], a[1]), apply(gs.ctm, a[2], a[3])); break;
        case "re": path.push(...rectPts(gs.ctm, a[0], a[1], a[2], a[3])); break;
        case "W": case "W*": pendingClip = true; break;
        case "S": case "s": case "f": case "F": case "f*": case "B": case "B*": case "b": case "b*": case "n": {
          if (path.length) {
            const b = boxOf(path);
            if (pendingClip) gs.clipBox = inter(gs.clipBox, b);
            if (o.op !== "n") record(i, b, "path");
          }
          path = [];
          pendingClip = false;
          break;
        }
        case "Do": {
          const nm = a[0] && a[0].name;
          const ref = xRes && nm ? xRes.get(PDFName.of(nm)) : null;
          const x = ref ? R.look(ref) : null;
          if (!(x instanceof PDFStream)) break;
          const sub = R.name(x.dict.get(PDFName.of("Subtype")));
          if (sub === "Image") record(i, boxOf(rectPts(gs.ctm, 0, 0, 1, 1)), "image");
          else if (sub === "Form" && depth < 8 && ref instanceof PDFRef) {
            const mat = R.arr(x.dict.get(PDFName.of("Matrix"))).map(R.num);
            const inner = mul(mat.length === 6 ? mat : ID, gs.ctm);
            const fres = R.dict(x.dict.get(PDFName.of("Resources"))) || resources;
            const before = shapes.length;
            walk(`x:${ref.toString()}`, R.streamText(ref), fres, inner, depth + 1);
            // a group drawn as one: also counts as one shape (so a whole drawn box can be found)
            const bb = shapes.slice(before).reduce((acc, s) => union(acc, s.bbox), null);
            if (bb) record(i, bb, "form");
          }
          break;
        }
        case "BI": record(i, boxOf(rectPts(gs.ctm, 0, 0, 1, 1)), "image"); break;
        case "BT": tm = ID; tlm = ID; break;
        case "Tf": {
          const ref = fontRes && a[0] && a[0].name ? fontRes.get(PDFName.of(a[0].name)) : null;
          gs.font = ref ? R.font(ref) : null;
          gs.size = typeof a[1] === "number" ? a[1] : 0;
          break;
        }
        case "Tc": gs.Tc = a[0] || 0; break;
        case "Tw": gs.Tw = a[0] || 0; break;
        case "Tz": gs.Th = (a[0] || 100) / 100; break;
        case "TL": gs.TL = a[0] || 0; break;
        case "Ts": gs.rise = a[0] || 0; break;
        case "Td": tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); tm = tlm; break;
        case "TD": gs.TL = -(a[1] || 0); tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); tm = tlm; break;
        case "Tm": if (a.length === 6) { tlm = a.slice(); tm = tlm; } break;
        case "T*": nextLine(); break;
        case "Tj": if (a[0] && a[0].str !== undefined) show(a[0].str, i, 0); break;
        case "'": nextLine(); if (a[0] && a[0].str !== undefined) show(a[0].str, i, 0); break;
        case "\"": gs.Tw = a[0] || 0; gs.Tc = a[1] || 0; nextLine(); if (a[2] && a[2].str !== undefined) show(a[2].str, i, 0); break;
        case "TJ": {
          (Array.isArray(a[0]) ? a[0] : []).forEach((el, part) => {
            if (typeof el === "number") tm = mul([1, 0, 0, 1, (-el / 1000) * gs.size * gs.Th, 0], tm);
            else if (el && el.str !== undefined) show(el.str, i, part);
          });
          break;
        }
        default: break;
      }
    });
  }
  walk("page", pageText, pageRes, ID, 0);
  return { streams, glyphs, shapes };
}

// ---------- finding the placeholders ----------
/** Letters -> runs of text that belong together (same line, no gap). */
function textRuns(glyphs) {
  const runs = [];
  let cur = null;
  for (const g of glyphs) {
    const prev = cur && cur.glyphs[cur.glyphs.length - 1];
    const sameLine = prev && Math.abs(prev.y - g.y) < 0.35 * Math.max(prev.size, g.size);
    const gap = prev ? g.x - prev.end : 0;
    if (!prev || !sameLine || gap > 0.6 * g.size || gap < -0.6 * g.size) { cur = { glyphs: [] }; runs.push(cur); }
    cur.glyphs.push(g);
  }
  // A long gap made of spaces also separates two runs ("Jamiat      Jamaat").
  const out = [];
  for (const r of runs) {
    let piece = [];
    let spaces = 0;
    for (const g of r.glyphs) {
      if (/^\s$/.test(g.uni)) spaces++; else { if (spaces >= 2 && piece.length) { out.push(piece); piece = []; } spaces = 0; }
      piece.push(g);
    }
    if (piece.length) out.push(piece);
  }
  return out.map((gl) => ({ glyphs: gl, text: gl.map((g) => g.uni).join("") }));
}

// "Image", "Jamiat", "Jamaat" written on their own (or {{Image}} ...). Words in capitals ("JAMAAT") are
// labels of the design, not places.
function placeholderOf(text) {
  const t = text.replace(/\s+/g, " ").trim();
  const braces = t.match(/^\{\{\s*([A-Za-z]+)\s*\}\}$/);
  if (braces) return WORDS[braces[1].toLowerCase()] || null;
  const m = t.match(/^([A-Za-z]+)$/);
  if (!m || (m[1] !== m[1][0] + m[1].slice(1).toLowerCase())) return null;
  return WORDS[m[1].toLowerCase()] || null;
}

/** Rows first (top to bottom), then left to right. */
function readingOrder(list, boxKey) {
  const items = list.slice().sort((a, b) => b[boxKey].y1 - a[boxKey].y1);
  const rows = [];
  for (const it of items) {
    const [, cy] = center(it[boxKey]);
    const row = rows.find((r) => cy <= r.y1 && cy >= r.y0);
    if (row) row.items.push(it); else rows.push({ y0: it[boxKey].y0, y1: it[boxKey].y1, items: [it] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a[boxKey].x0 - b[boxKey].x0));
}

/**
 * Reads a format PDF. Returns { page: {w, h, x, y, rotate}, slots: [{ jamaat:[text], jamiat:[text], images:[img] }],
 * remove: { words: [...], boxes: [...] }, photoSize: {w, h} (mm, from the first Image box) }.
 */
async function analyze(bytes) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); } catch {
    throw new FormatError("This file couldn't be read as a PDF. Save it again as a PDF and upload it.");
  }
  if (doc.isEncrypted) throw new FormatError("This PDF is protected with a password. Save it without protection and upload it again.");
  if (doc.getPageCount() !== 1) throw new FormatError(`The format must be one page (this PDF has ${doc.getPageCount()} pages). The page is repeated to make the report.`);
  const page = doc.getPage(0);
  const mb = page.getMediaBox();
  const pageBox = { x0: mb.x, y0: mb.y, x1: mb.x + mb.width, y1: mb.y + mb.height };
  const { glyphs, shapes } = readPage(doc, page);
  if (!glyphs.length) {
    throw new FormatError("No text was found in this PDF (it may be a scanned picture). Type the words Image, Jamiat and Jamaat in your design and save it as a PDF again.");
  }

  const found = { image: [], jamiat: [], jamaat: [], title: [], date: [], description: [] };
  for (const r of textRuns(glyphs)) {
    const kind = placeholderOf(r.text);
    if (!kind) continue;
    const letters = r.glyphs.filter((g) => !/^\s$/.test(g.uni));
    const bbox = letters.reduce((acc, g) => union(acc, g.bbox), null);
    found[kind].push({ kind, glyphs: r.glyphs, bbox, size: Math.max(...letters.map((g) => g.size)), fill: letters[0].fill, bold: letters.some((g) => g.bold) });
  }
  if (!found.jamaat.length) {
    throw new FormatError("The word \"Jamaat\" wasn't found. Type Jamaat (on its own) where each Jamaat's name goes — one for each Jamaat on the page.");
  }
  if (!found.image.length) {
    throw new FormatError("The word \"Image\" wasn't found. Type Image (on its own) inside each box where a photo goes.");
  }

  const pageArea = area(pageBox);
  const smallest = (b, mustContainAll) => shapes
    .filter((s) => area(s.bbox) < pageArea * 0.5 && (mustContainAll ? contains(s.bbox, b, 0.5) : holds(s.bbox, center(b))) && s.bbox.x1 - s.bbox.x0 >= (b.x1 - b.x0) * 0.9)
    .sort((x, y) => area(x.bbox) - area(y.bbox))[0];

  // Each Image word: its box = the smallest shape around it; everything drawn inside that box (outline, fill,
  // an icon) is part of the empty box and is removed when no photo goes there.
  const allWords = [...found.image, ...found.jamiat, ...found.jamaat, ...found.title, ...found.date, ...found.description];
  const boxRemove = [];
  for (const im of found.image) {
    const s = smallest(im.bbox, false);
    im.box = s ? s.bbox : im.bbox;
    im.hasShape = !!s;
    im.parts = s ? shapes.filter((x) => contains(im.box, x.bbox, 2) && !allWords.some((w) => w !== im && contains(x.bbox, w.bbox))).map((x) => ({ stream: x.stream, op: x.op })) : [];
    boxRemove.push(...im.parts);
  }
  for (const t of [...found.jamiat, ...found.jamaat, ...found.title, ...found.date, ...found.description]) {
    const s = smallest(t.bbox, true);
    t.frame = s ? s.bbox : null;
    const frame = s ? s.bbox : pageBox;
    const [cx] = center(t.bbox);
    const [fx] = center(frame);
    t.align = Math.abs(cx - fx) <= (frame.x1 - frame.x0) * 0.06 ? "center" : "left";
    // a left-aligned name stops before the first box to its right on the same line
    let right = frame.x1;
    for (const im of found.image) {
      const b = im.box;
      if (b.x0 > t.bbox.x0 && b.y0 < t.bbox.y1 && b.y1 > t.bbox.y0) right = Math.min(right, b.x0);
    }
    t.maxW = t.align === "center" ? (frame.x1 - frame.x0) * 0.94 : Math.max(t.bbox.x1 - t.bbox.x0, (right - t.bbox.x0) * 0.95);
  }

  // Places for Jamaats: one per "Jamaat" word, in reading order. Image boxes and Jamiat words go to their Jamaat:
  // in reading order when they divide evenly (e.g. 6 boxes, 3 Jamaats = 2 each), otherwise to the nearest.
  const jamaats = readingOrder(found.jamaat, "bbox");
  const images = readingOrder(found.image, "box");
  const jamiats = readingOrder(found.jamiat, "bbox");
  const slots = jamaats.map((j) => ({ jamaat: [j], jamiat: [], images: [] }));
  const nearest = (b) => {
    const [x, y] = center(b);
    let best = 0, bd = Infinity;
    jamaats.forEach((j, k) => { const [jx, jy] = center(j.bbox); const d = Math.hypot(jx - x, (jy - y) * 1.5); if (d < bd) { bd = d; best = k; } });
    return best;
  };
  if (images.length % jamaats.length === 0) {
    const per = images.length / jamaats.length;
    images.forEach((im, k) => slots[Math.floor(k / per)].images.push(im));
  } else images.forEach((im) => slots[nearest(im.box)].images.push(im));
  if (jamiats.length === jamaats.length) jamiats.forEach((t, k) => slots[k].jamiat.push(t));
  else jamiats.forEach((t) => slots[nearest(t.bbox)].jamiat.push(t));
  // Description: the box around the word (else from the word, as wide as a name there, about 6 lines down)
  const descs = readingOrder(found.description, "bbox");
  for (const d of descs) {
    d.area = d.frame && !found.image.some((im) => contains(d.frame, im.box, 1))
      ? d.frame
      : { x0: d.bbox.x0, x1: d.bbox.x0 + d.maxW, y1: d.bbox.y1, y0: Math.max(pageBox.y0, d.bbox.y1 - d.size * 1.4 * 6) };
  }
  slots.forEach((s) => { s.description = []; });
  if (descs.length === jamaats.length) descs.forEach((t, k) => slots[k].description.push(t));
  else descs.forEach((t) => slots[nearest(t.bbox)].description.push(t));

  // A name with no frame of its own, centred above / below its Jamaat's photos, is centred on them.
  for (const s of slots) {
    const ib = s.images.reduce((acc, im) => union(acc, im.box), null);
    if (!ib) continue;
    for (const t of [...s.jamaat, ...s.jamiat]) {
      if (smallest(t.bbox, true)) continue;
      const w = ib.x1 - ib.x0;
      if (Math.abs(center(t.bbox)[0] - center(ib)[0]) <= w * 0.06) { t.align = "center"; t.maxW = Math.max(w, t.bbox.x1 - t.bbox.x0); }
    }
  }

  // Each Jamaat's whole place on the page: the smallest drawn shape (a frame / card) around all its words and boxes
  // that holds nothing of another Jamaat — else just the area of its words, boxes and their frames. Everything drawn
  // only inside it (frame, name pill, description box, labels) is left out on a page where that place has no Jamaat
  // (the last page, when there are fewer Jamaats than places). Something drawn once and reused in several places is
  // left out only by the command that draws it there.
  const itemsOf = (s) => [...s.images.map((im) => im.box), ...[...s.jamaat, ...s.jamiat, ...s.description].flatMap((t) => [t.bbox, t.frame].filter(Boolean)), ...s.description.map((d) => d.area)];
  const wordsOf = (s) => [...s.images.map((im) => im.box), ...[...s.jamaat, ...s.jamiat, ...s.description].map((t) => t.bbox)];
  const instances = new Map(); // "stream#op" -> bboxes of every time it is drawn
  const add = (stream, op, bbox) => { const k = `${stream}#${op}`; if (!instances.has(k)) instances.set(k, { stream, op, boxes: [] }); instances.get(k).boxes.push(bbox); };
  for (const x of shapes) add(x.stream, x.op, x.bbox);
  for (const g of glyphs) add(g.stream, g.op, g.bbox);
  slots.forEach((s, k) => {
    const own = itemsOf(s).reduce((acc, b) => union(acc, b), null);
    const others = slots.flatMap((o, j) => (j === k ? [] : wordsOf(o)));
    const card = shapes
      .filter((x) => area(x.bbox) < pageArea * 0.5 && contains(x.bbox, own, 0.5) && !others.some((b) => holds(x.bbox, center(b))))
      .sort((a, b) => area(a.bbox) - area(b.bbox))[0];
    const region = card ? card.bbox : own;
    s.place = region;
    s.empty = [...instances.values()].filter((it) => it.boxes.every((b) => contains(region, b, 2))).map((it) => ({ stream: it.stream, op: it.op }));
  });

  const ref = (g) => ({ stream: g.stream, op: g.op, part: g.part, idx: g.idx, bytes: g.bytes, adjN: round(g.adjN) });
  const text = (t) => ({ bbox: rbox(t.bbox), size: round(t.size), fill: t.fill.map(round), bold: t.bold, align: t.align, maxW: round(t.maxW) });
  const first = images[0];
  return {
    v: LAYOUT_V,
    page: { w: round(mb.width), h: round(mb.height), x: round(mb.x), y: round(mb.y), rotate: page.getRotation().angle || 0 },
    slots: slots.map((s) => ({
      jamaat: s.jamaat.map(text),
      jamiat: s.jamiat.map(text),
      images: s.images.map((im) => ({ word: rbox(im.bbox), box: rbox(im.box), hasShape: im.hasShape })),
      description: s.description.map((d) => ({ ...text(d), area: rbox(d.area) })),
      place: rbox(s.place),
      empty: s.empty,
    })),
    title: found.title.map(text),
    date: found.date.map(text),
    remove: {
      words: allWords.flatMap((w) => w.glyphs.map(ref)),
      boxes: boxRemove,
    },
    // photo size to start with: a little inside the first box (the Super Admin can change it)
    photoSize: { w: Math.max(5, Math.floor((first.box.x1 - first.box.x0) / MM) - 4), h: Math.max(5, Math.floor((first.box.y1 - first.box.y0) / MM) - 4) },
  };
}

/** One sentence about what was found (shown to the Super Admin). */
function describe(layout) {
  const n = layout.slots.length;
  const per = layout.slots.map((s) => s.images.length);
  const same = per.every((x) => x === per[0]);
  const jt = layout.slots.filter((s) => s.jamiat.length).length;
  const ds = layout.slots.filter((s) => (s.description || []).length).length;
  const head = [(layout.title || []).length && "title", (layout.date || []).length && "date"].filter(Boolean);
  return `${n} Jamaat${n === 1 ? "" : "s"} on each page, ${same ? `${per[0]} photo${per[0] === 1 ? "" : "s"} each` : `photos: ${per.join(", ")}`}`
    + `${jt ? (jt === n ? ", with the Jamiat name" : `, Jamiat name for ${jt} of them`) : ", no Jamiat name"}`
    + `${ds ? (ds === n ? ", a description box" : `, a description box for ${ds} of them`) : ""}`
    + `${head.length ? `; ${head.join(" and ")} at the top` : ""}.`;
}

// ---------- changing the page ----------
const hex = (str) => { let h = ""; for (let k = 0; k < str.length; k++) h += str.charCodeAt(k).toString(16).padStart(2, "0"); return `<${h}>`; };
const fmt = (n) => String(Math.round(n * 1000) / 1000);

/**
 * A copy of the format page without the placeholder words (and, if asked, without the Image boxes), and without the
 * drawing commands in `drop` ({stream, op}: the places of Jamaats that aren't on this page).
 */
async function variant(bytes, layout, removeBoxes, drop = []) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const { streams } = readPage(doc, page);
  const edits = new Map(); // stream -> Map(op index -> { glyphs: [], drop: bool })
  const at = (stream, op) => {
    if (!edits.has(stream)) edits.set(stream, new Map());
    const m = edits.get(stream);
    if (!m.has(op)) m.set(op, { glyphs: [], drop: false });
    return m.get(op);
  };
  for (const g of layout.remove.words) at(g.stream, g.op).glyphs.push(g);
  if (removeBoxes) for (const b of layout.remove.boxes) at(b.stream, b.op).drop = true;
  for (const d of drop) at(d.stream, d.op).drop = true;

  for (const [key, changes] of edits) {
    const st = streams.get(key);
    if (!st) continue;
    let out = "";
    let pos = 0;
    st.ops.forEach((o, i) => {
      const ch = changes.get(i);
      if (!ch) return;
      out += st.text.slice(pos, o.s);
      pos = o.e;
      if (ch.drop) {
        // text: nothing shown, but a "next line" stays so later lines don't move; shapes: the path is ended unpainted
        out += o.op === "Do" || o.op === "BI" || o.op === "Tj" || o.op === "TJ" ? " "
          : o.op === "'" ? " T*" : o.op === "\"" ? ` ${fmt(o.args[0] || 0)} Tw ${fmt(o.args[1] || 0)} Tc T*` : " n";
        return;
      }
      // Remove some letters but keep everything after them where it was (TJ with spacing instead of the letters).
      const gone = new Map(ch.glyphs.map((g) => [`${g.part}:${g.idx}`, g]));
      const b = ch.glyphs[0] ? ch.glyphs[0].bytes || 1 : 1; // one font per command
      const parts = o.op === "TJ" ? (Array.isArray(o.args[0]) ? o.args[0] : []) : [o.op === "\"" ? o.args[2] : o.args[0]];
      const items = [];
      parts.forEach((p, part) => {
        if (typeof p === "number") { items.push(fmt(p)); return; }
        if (!p || p.str === undefined) return;
        let keep = "";
        for (let k = 0, idx = 0; k < p.str.length; idx++) {
          const code = p.str.slice(k, k + b);
          k += b;
          const g = gone.get(`${part}:${idx}`);
          if (g) { if (keep) { items.push(hex(keep)); keep = ""; } items.push(fmt(g.adjN)); } else keep += code;
        }
        if (keep) items.push(hex(keep));
      });
      const tj = `[${items.join(" ")}] TJ`;
      out += o.op === "'" ? ` T* ${tj}` : o.op === "\"" ? ` ${fmt(o.args[0] || 0)} Tw ${fmt(o.args[1] || 0)} Tc T* ${tj}` : ` ${tj}`;
    });
    out += st.text.slice(pos);
    const data = Buffer.from(out, "latin1");
    if (key === "page") {
      page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(data)));
    } else {
      const ref = PDFRef.of(...key.slice(2).split(" ").slice(0, 2).map(Number));
      const old = doc.context.lookup(ref);
      const fresh = doc.context.flateStream(data);
      for (const [k, v] of old.dict.entries()) {
        const nm = k.decodeText();
        if (nm !== "Length" && nm !== "Filter" && nm !== "DecodeParms") fresh.dict.set(k, v);
      }
      doc.context.assign(ref, fresh);
    }
  }
  return doc;
}

// ---------- building the report ----------
const SAFE = (font) => (text) => {
  const plain = String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let out = "";
  for (const ch of plain) { try { font.widthOfTextAtSize(ch, 10); out += ch; } catch { out += "?"; } }
  return out;
};

/**
 * @param {object} o
 * @param {Buffer} o.bytes      the format PDF
 * @param {object} o.layout     from analyze()
 * @param {{w:number,h:number}} o.photoSize  mm
 * @param {{jamiat:string, jamaat:string, photos:any[]}[]} o.groups  one per Jamaat, in order
 * @param {(photo:any)=>Promise<{bytes:Buffer}|null>} o.loadPhoto  null = draw a grey sample box
 * @param {{title?:string, date?:string, titleLang?:string, dateLang?:string}} o.heading  printed where the format
 *   has "Title" / "Date" (every page); lang "en" = English, else Lisan ud Dawat
 *   (each group may have a description + descriptionLang: printed in its "Description" box)
 * @returns {Promise<{ bytes: Uint8Array, pages: number, failed: number }>}
 */
async function buildReport({ bytes, layout, photoSize, groups, loadPhoto, title = "Report", heading = {} }) {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator("Umoor Sehhat");
  out.setProducer("Umoor Sehhat");
  const [withBoxes, noBoxes] = await Promise.all([variant(bytes, layout, false), variant(bytes, layout, true)]);
  const [A] = await out.embedPdf(withBoxes, [0]);
  const [B] = await out.embedPdf(noBoxes, [0]);
  const fonts = { r: await out.embedFont(StandardFonts.Helvetica), b: await out.embedFont(StandardFonts.HelveticaBold) };
  if (groups.some((g) => arabicOf(g.jamiatAr) || arabicOf(g.jamaatAr) || arabicOf(g.description)) || arabicOf(heading.title) || arabicOf(heading.date)) {
    out.registerFontkit(fontkit);
    fonts.ar = await out.embedFont(arabicFont().bytes, { subset: true });
  }
  const safe = SAFE(fonts.r);
  const P = layout.page;
  const W = Math.max(5, Number(photoSize && photoSize.w) || 50) * MM;
  const H = Math.max(5, Number(photoSize && photoSize.h) || 50) * MM;
  const S = layout.slots.length;
  const pages = Math.max(1, Math.ceil(groups.length / S));
  // The last page may have fewer Jamaats than places: those places are left out (not drawn empty).
  const onLast = groups.length - (pages - 1) * S;
  let Last = B;
  if (onLast < S) {
    const drop = layout.slots.slice(Math.max(0, onLast)).flatMap((s) => s.empty || []);
    if (drop.length) [Last] = await out.embedPdf(await variant(bytes, layout, true, drop), [0]);
  }
  let failed = 0;
  const sample = rgb(0.85, 0.87, 0.9);

  // one line in a place of the format: Arabic in Al-Kanz (else the English text), made smaller to fit
  const putLine = (page, t, value, valueAr) => {
    const ar = fonts.ar && valueAr ? arabicPlain(valueAr) : "";
    const font = ar ? fonts.ar : t.bold ? fonts.b : fonts.r;
    const runs = ar ? rtlRuns(ar) : null;
    const text = ar ? "" : safe(value);
    if (!ar && !text) return;
    let size = ar ? t.size * AR_SCALE : t.size;
    const width = () => (runs ? runsWidth(font, runs, size) : font.widthOfTextAtSize(text, size));
    while (size > 5 && width() > t.maxW) size -= 0.5;
    const w = width();
    const [cx] = center(t.bbox);
    const x = t.align === "center" ? cx - w / 2 : t.bbox.x0;
    const base = t.bbox.y0 + 0.22 * t.size; // the placeholder's baseline
    const color = rgb(...t.fill.map((v) => Math.min(1, Math.max(0, v))));
    if (runs) drawRuns(page, font, runs, x + w - P.x, base - P.y, size, color);
    else page.drawText(text, { x: x - P.x, y: base - P.y, size, font, color });
  };
  // a description: lines wrapped to the box (Arabic from the right), made smaller until it all fits
  const putParagraph = (page, d, value, lang) => {
    const raw = String(value || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
    if (!raw) return;
    const ar = !!(lang !== "en" && fonts.ar && arabicPlain(raw, true));
    const font = ar ? fonts.ar : fonts.r;
    const lineWidth = (l, size) => (ar ? runsWidth(font, rtlRuns(l), size) : font.widthOfTextAtSize(safe(l), size));
    const pad = 4;
    const A = d.area;
    const w = A.x1 - A.x0 - 2 * pad;
    const h = A.y1 - A.y0 - 2 * pad;
    const wrap = (size) => {
      const lines = [];
      for (const para of raw.split("\n")) {
        const words = para.split(" ").filter(Boolean);
        let cur = "";
        for (const word of words) {
          const next = cur ? `${cur} ${word}` : word;
          if (!cur || lineWidth(next, size) <= w) cur = next;
          else { lines.push(cur); cur = word; }
        }
        lines.push(cur);
      }
      return lines;
    };
    let size = ar ? d.size * AR_SCALE : d.size;
    let lines = wrap(size);
    const fits = () => lines.length * size * LINE <= h && lines.every((l) => lineWidth(l, size) <= w);
    while (size > 5 && !fits()) { size -= 0.5; lines = wrap(size); }
    const color = rgb(...d.fill.map((v) => Math.min(1, Math.max(0, v))));
    let y = A.y1 - pad - size;
    for (const l of lines) {
      if (y < A.y0 - size) break;
      if (ar) drawRuns(page, font, rtlRuns(l), A.x1 - pad - P.x, y - P.y, size, color);
      else if (l) page.drawText(safe(l), { x: A.x0 + pad - P.x, y: y - P.y, size, font, color });
      y -= size * LINE;
    }
  };

  for (let p = 0; p < pages; p++) {
    const page = out.addPage([P.w, P.h]);
    if (P.rotate) page.setRotation(degrees(P.rotate));
    page.drawPage(p === pages - 1 ? Last : B, { x: 0, y: 0 });
    const X = (x) => x - P.x;
    const Y = (y) => y - P.y;
    (layout.title || []).forEach((t) => putLine(page, t, heading.title, heading.titleLang === "en" ? "" : heading.title));
    (layout.date || []).forEach((t) => putLine(page, t, heading.date, heading.dateLang === "en" ? "" : heading.date));
    for (let s = 0; s < S; s++) {
      const g = groups[p * S + s];
      if (!g) continue;
      const slot = layout.slots[s];
      const m = slot.images.length;
      // photos (whole, centred in their box); a failed photo is left out
      const loaded = [];
      for (const ph of g.photos.slice(0, m)) {
        if (ph === "sample") { loaded.push("sample"); continue; }
        let img = null;
        try {
          const got = await loadPhoto(ph);
          if (got && got.bytes) {
            const b = new Uint8Array(got.bytes); // a copy: pdf-lib misreads Node's shared buffers
            img = b[0] === 0x89 && b[1] === 0x50 ? await out.embedPng(b) : await out.embedJpg(b);
          }
        } catch { img = null; }
        if (img) loaded.push(img); else failed++;
      }
      const k = loaded.length;
      const centres = slot.images.map((im) => center(im.box));
      let spots = centres;
      if (k > 0 && k < m) { // fewer photos than boxes: keep their spacing, centred on all the boxes
        const avg = (list, i) => list.reduce((acc, c) => acc + c[i], 0) / list.length;
        const dx = avg(centres, 0) - avg(centres.slice(0, k), 0);
        const dy = avg(centres, 1) - avg(centres.slice(0, k), 1);
        spots = centres.slice(0, k).map(([x, y]) => [x + dx, y + dy]);
      }
      if (k === m) {
        for (const im of slot.images) {
          if (!im.hasShape) continue;
          const pad = 4;
          page.pushOperators(pushGraphicsState(), rectangle(X(im.box.x0 - pad), Y(im.box.y0 - pad), im.box.x1 - im.box.x0 + 2 * pad, im.box.y1 - im.box.y0 + 2 * pad), clip(), endPath());
          page.drawPage(A, { x: 0, y: 0 });
          page.pushOperators(popGraphicsState());
        }
      }
      loaded.forEach((img, i) => {
        const [cx, cy] = spots[i];
        if (img === "sample") {
          page.drawRectangle({ x: X(cx - W / 2), y: Y(cy - H / 2), width: W, height: H, color: sample, borderColor: rgb(0.55, 0.6, 0.68), borderWidth: 0.75 });
          const label = `Photo ${i + 1}`;
          const fs = Math.max(6, Math.min(14, W / 6));
          page.drawText(label, { x: X(cx) - fonts.r.widthOfTextAtSize(label, fs) / 2, y: Y(cy) - fs / 3, size: fs, font: fonts.r, color: rgb(0.3, 0.34, 0.4) });
          return;
        }
        const r = Math.min(W / img.width, H / img.height);
        const w = img.width * r, h = img.height * r;
        page.drawImage(img, { x: X(cx - w / 2), y: Y(cy - h / 2), width: w, height: h });
      });
      // names: the Arabic name in Al-Kanz; the English name when there is no Arabic one
      slot.jamaat.forEach((t) => putLine(page, t, g.jamaat, g.jamaatAr));
      slot.jamiat.forEach((t) => putLine(page, t, g.jamiat, g.jamiatAr));
      (slot.description || []).forEach((d) => putParagraph(page, d, g.description, g.descriptionLang));
    }
  }
  return { bytes: await out.save(), pages, failed };
}

// Sample heading / description (Arabic, so the Super Admin sees how Media's Arabic text sits on the page)
const SAMPLE_HEADING = { title: "عنوان التقرير", date: "٢٩ ربيع الآخر ١٤٤٨" };
const SAMPLE_DESC = "هنا يكتب الوصف الذي يكتبه فريق الإعلام لكل جماعة، ويظهر في هذا المكان من التقرير على عدة أسطر حسب طوله.";
/**
 * Sample report for the Super Admin: page 1 every place full, page 2 one photo less (if a Jamaat has 2+ boxes).
 * names = real Jamaats ({jamiat, jamiatAr, jamaat, jamaatAr}) so the Arabic names can be checked; else "Jamaat 1"...
 */
function sampleGroups(layout, names = []) {
  const S = layout.slots.length;
  const nm = (k, extra = "") => (names[k] ? { ...names[k] } : { jamiat: `Jamiat ${k + 1}`, jamaat: `Jamaat ${k + 1}${extra}` });
  const one = layout.slots.map((s, k) => ({ ...nm(k), description: SAMPLE_DESC, photos: s.images.map(() => "sample") }));
  const fewer = layout.slots.some((s) => s.images.length > 1)
    ? layout.slots.map((s, k) => ({ ...nm(S + k, " (fewer photos)"), photos: s.images.slice(1).map(() => "sample") })).slice(0, Math.max(1, S - 1))
    : [];
  return [...one, ...fewer];
}

/** A plain A4 list of the Jamaats that haven't filled the form (and those that filled without a photo). */
async function notFilledPdf({ title, sections, note }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${title} - not filled`);
  doc.setCreator("Umoor Sehhat");
  doc.setProducer("Umoor Sehhat");
  const r = await doc.embedFont(StandardFonts.Helvetica);
  const b = await doc.embedFont(StandardFonts.HelveticaBold);
  const safe = SAFE(r);
  const [PW, PH] = [595.28, 841.89];
  const M = 42;
  let page, y;
  const fit = (text, font, size, max) => { let t = safe(text); while (t.length > 1 && font.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + "…"; return t; };
  const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; };
  const line = (text, font, size, x = M, color = rgb(0.1, 0.12, 0.16)) => { page.drawText(fit(text, font, size, PW - M - x), { x, y, size, font, color }); };
  newPage();
  line(title, b, 16); y -= 20;
  if (note) { line(note, r, 9, M, rgb(0.4, 0.43, 0.48)); y -= 22; } else y -= 8;
  const cols = [M, M + 34, M + 34 + 215];
  for (const sec of sections) {
    if (y < M + 60) newPage();
    line(`${sec.title} (${sec.rows.length})`, b, 12); y -= 18;
    if (!sec.rows.length) { line(sec.empty || "None.", r, 10, M, rgb(0.4, 0.43, 0.48)); y -= 24; continue; }
    const head = () => {
      page.drawRectangle({ x: M - 4, y: y - 4, width: PW - 2 * M + 8, height: 16, color: rgb(0.93, 0.94, 0.96) });
      ["#", "Jamiat", "Jamaat"].forEach((h, i) => page.drawText(h, { x: cols[i], y, size: 9, font: b, color: rgb(0.25, 0.28, 0.33) }));
      y -= 18;
    };
    head();
    sec.rows.forEach((row, i) => {
      if (y < M) { newPage(); head(); }
      page.drawText(String(i + 1), { x: cols[0], y, size: 9.5, font: r });
      page.drawText(fit(row.jamiat, r, 9.5, cols[2] - cols[1] - 8), { x: cols[1], y, size: 9.5, font: r });
      page.drawText(fit(row.jamaat, r, 9.5, PW - M - cols[2]), { x: cols[2], y, size: 9.5, font: r });
      y -= 15;
    });
    y -= 16;
  }
  const n = doc.getPageCount();
  doc.getPages().forEach((p, i) => p.drawText(`Page ${i + 1} of ${n}`, { x: PW - M - 60, y: 22, size: 8, font: r, color: rgb(0.5, 0.52, 0.56) }));
  return doc.save();
}

module.exports = { analyze, describe, buildReport, sampleGroups, notFilledPdf, FormatError, MM, LAYOUT_V, missingLetters, missingLatin, SAMPLE_HEADING, arabicFontFile: () => (arabicFont() ? ARABIC_FONT : null), _test: { parseOps, readPage, textRuns, rtlText, arabicOf, rtlRuns } };
