import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon } from "./Icons";

// Rich text editor for emails: font, size, bold / italic / underline / strike, text colour, highlight,
// alignment, headings, lists, quote, line, links, images (shown in the email), document links, {{variables}}.
//
//   <RichEditor resetKey={k} initialHtml={html} onChange={(html) => …} variables={[{ key, group, hint }]}
//     uploadPublic={(file, onProgress) => Promise<{ kind, name, url }>} onError={(msg) => …} />
//
// Uncontrolled: the content is set from `initialHtml` when `resetKey` changes. Formatting is written as inline
// styles (what email apps understand); the server keeps only safe formatting.

const FONTS = [
  ["", "Font"], ["Arial, Helvetica, sans-serif", "Arial"], ["Georgia, serif", "Georgia"], ["'Times New Roman', serif", "Times New Roman"],
  ["Verdana, sans-serif", "Verdana"], ["Tahoma, sans-serif", "Tahoma"], ["'Trebuchet MS', sans-serif", "Trebuchet"], ["'Courier New', monospace", "Courier New"],
];
const SIZES = [["", "Size"], ["2", "Small"], ["3", "Normal"], ["4", "Medium"], ["5", "Large"], ["6", "Extra large"], ["7", "Huge"]];
const BLOCKS = [["", "Style"], ["p", "Paragraph"], ["h1", "Title"], ["h2", "Heading"], ["h3", "Sub-heading"]];
const SWATCHES = ["#111827", "#4b5563", "#9ca3af", "#ffffff", "#b91c1c", "#ea580c", "#ca8a04", "#15803d", "#1f6f43", "#0e7490", "#1d4ed8", "#7c3aed", "#be185d"];
const HILITES = ["transparent", "#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e5e7eb"];

export default function RichEditor({ resetKey, initialHtml = "", onChange, variables = [], uploadPublic, onError, placeholder = "Write your message…", minHeight = 240 }) {
  const ed = useRef(null);
  const saved = useRef(null); // the last selection inside the editor
  const [empty, setEmpty] = useState(!initialHtml);
  const [menu, setMenu] = useState(""); // "color" | "hilite" | "vars" | "link"
  const [link, setLink] = useState("https://");
  const [busy, setBusy] = useState("");
  const [img, setImg] = useState(null); // the image clicked (size bar)
  const [varQ, setVarQ] = useState("");

  const changed = useCallback(() => {
    if (!ed.current) return;
    setEmpty(!ed.current.innerText.trim() && !ed.current.querySelector("img"));
    if (onChange) onChange(ed.current.innerHTML);
  }, [onChange]);

  useEffect(() => {
    if (!ed.current) return;
    ed.current.innerHTML = initialHtml || "";
    setEmpty(!ed.current.innerText.trim() && !ed.current.querySelector("img"));
    setImg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Remember where the cursor was (selects and colour boxes take the focus away).
  useEffect(() => {
    const onSel = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && ed.current && ed.current.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);
  // Close a menu on an outside click.
  const bar = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (bar.current && !bar.current.contains(e.target)) setMenu(""); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const restore = () => {
    ed.current.focus();
    const s = window.getSelection();
    if (saved.current) { s.removeAllRanges(); s.addRange(saved.current); }
    else { const r = document.createRange(); r.selectNodeContents(ed.current); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
  };
  const cmd = (c, v = null) => {
    restore();
    document.execCommand("styleWithCSS", false, c !== "fontSize");
    document.execCommand(c, false, v);
    if (c === "fontSize") sizeToCss();
    changed();
  };
  // execCommand("fontSize") writes <font size>: turn it into an inline size email apps understand.
  const sizeToCss = () => {
    const px = { 1: "10px", 2: "13px", 3: "15px", 4: "18px", 5: "22px", 6: "28px", 7: "36px" };
    const made = [];
    ed.current.querySelectorAll("font[size]").forEach((f) => {
      const span = document.createElement("span");
      span.style.fontSize = px[f.getAttribute("size")] || "15px";
      if (f.getAttribute("color")) span.style.color = f.getAttribute("color");
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
      made.push(span);
    });
    // Keep the same text selected (so a colour or bold can be added next).
    if (made.length) {
      const r = document.createRange();
      r.setStartBefore(made[0].firstChild || made[0]);
      r.setEndAfter(made[made.length - 1].lastChild || made[made.length - 1]);
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
      saved.current = r.cloneRange();
    }
  };
  const insertHtml = (html) => { restore(); document.execCommand("insertHTML", false, html); changed(); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const addLink = () => {
    const url = link.trim();
    const isVar = /^\{\{[^{}]+\}\}$/.test(url);
    if (!isVar && !/^(https?:\/\/|mailto:|tel:)\S+$/i.test(url)) return onError && onError("Write a full link, e.g. https://example.com (or pick a variable such as {{Form link}}).");
    restore();
    const s = window.getSelection();
    if (s.isCollapsed) document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(isVar ? url : url.replace(/^mailto:|^tel:/i, ""))}</a>&nbsp;`);
    else document.execCommand("createLink", false, url);
    setMenu(""); setLink("https://");
    changed();
  };

  const upload = async (file, want) => {
    if (!uploadPublic) return;
    setBusy(`${want === "image" ? "Adding image" : "Adding document"} 0%`);
    try {
      const r = await uploadPublic(file, (p) => setBusy(`${want === "image" ? "Adding image" : "Adding document"} ${Math.round(p * 100)}%`));
      if (r.kind === "image") insertHtml(`<img src="${esc(r.url)}" alt="${esc(r.name)}" style="width:${r.width && r.width < 600 ? `${r.width}px` : "100%"}"><br>`);
      else insertHtml(`<a href="${esc(r.url)}">📄 ${esc(r.name)}</a>&nbsp;`);
    } catch (e) { if (onError) onError(e.message); }
    finally { setBusy(""); }
  };
  const pick = (accept, want) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept;
    i.onchange = () => { if (i.files[0]) upload(i.files[0], want); };
    i.click();
  };

  const setImgWidth = (w) => { if (!img) return; img.style.width = w; img.removeAttribute("width"); changed(); };
  const dropImg = () => { if (!img) return; img.remove(); setImg(null); changed(); };

  const B = ({ c, v, title, children, on }) => (
    <button type="button" className={on ? "is-on" : ""} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(c, v)}>{children}</button>
  );
  const Sel = ({ opts, onPick, title }) => (
    <select className="re-sel" value="" title={title} aria-label={title} onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onPick(v); }}>
      {opts.map(([v, l]) => <option key={v || "x"} value={v} disabled={!v} hidden={!v}>{l}</option>)}
    </select>
  );

  const groups = [];
  const vq = varQ.trim().toLowerCase();
  for (const v of variables.filter((x) => !vq || x.key.toLowerCase().includes(vq) || (x.group || "").toLowerCase().includes(vq))) {
    let g = groups.find((x) => x.name === v.group);
    if (!g) groups.push((g = { name: v.group, items: [] }));
    g.items.push(v);
  }

  return (
    <div className="re">
      <div className="re-bar" ref={bar}>
        <Sel title="Text style" opts={BLOCKS} onPick={(v) => cmd("formatBlock", v)} />
        <Sel title="Font" opts={FONTS} onPick={(v) => cmd("fontName", v)} />
        <Sel title="Text size" opts={SIZES} onPick={(v) => cmd("fontSize", v)} />
        <span className="re-sep" />
        <B c="bold" title="Bold (Ctrl+B)"><b>B</b></B>
        <B c="italic" title="Italic (Ctrl+I)"><i>I</i></B>
        <B c="underline" title="Underline (Ctrl+U)"><u>U</u></B>
        <B c="strikeThrough" title="Strikethrough"><s>S</s></B>
        <div className="re-pop">
          <button type="button" title="Text colour" aria-label="Text colour" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu(menu === "color" ? "" : "color")}><span className="re-a">A</span><span className="re-line" /></button>
          {menu === "color" && (
            <div className="re-menu re-swatches">
              {SWATCHES.map((c) => <button key={c} type="button" style={{ background: c }} title={c} aria-label={`Colour ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { cmd("foreColor", c); setMenu(""); }} />)}
              <label className="re-custom" title="Any colour">+<input type="color" onChange={(e) => { cmd("foreColor", e.target.value); }} /></label>
            </div>
          )}
        </div>
        <div className="re-pop">
          <button type="button" title="Highlight" aria-label="Highlight" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu(menu === "hilite" ? "" : "hilite")}><span className="re-hl">ab</span></button>
          {menu === "hilite" && (
            <div className="re-menu re-swatches">
              {HILITES.map((c) => <button key={c} type="button" className={c === "transparent" ? "re-none" : ""} style={{ background: c }} title={c === "transparent" ? "No highlight" : c} aria-label={c === "transparent" ? "No highlight" : `Highlight ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { cmd("hiliteColor", c); setMenu(""); }} />)}
            </div>
          )}
        </div>
        <span className="re-sep" />
        <B c="justifyLeft" title="Align left">⯇</B>
        <B c="justifyCenter" title="Centre">≡</B>
        <B c="justifyRight" title="Align right">⯈</B>
        <B c="insertUnorderedList" title="Bulleted list">• List</B>
        <B c="insertOrderedList" title="Numbered list">1. List</B>
        <B c="formatBlock" v="blockquote" title="Quote">“ ”</B>
        <B c="insertHorizontalRule" title="Line">―</B>
        <span className="re-sep" />
        <div className="re-pop">
          <button type="button" title="Link" aria-label="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => setMenu(menu === "link" ? "" : "link")}>Link</button>
          {menu === "link" && (
            <div className="re-menu re-link">
              <input className="input" autoFocus value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link address"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } if (e.key === "Escape") setMenu(""); }} />
              <button type="button" className="btn btn-primary" onClick={addLink}>Add</button>
              {variables.some((v) => v.key === "Form link") && <button type="button" className="btn btn-ghost" onClick={() => setLink("{{Form link}}")}>Form link</button>}
            </div>
          )}
        </div>
        <B c="unlink" title="Remove link">Unlink</B>
        {uploadPublic && <button type="button" title="Insert an image" onMouseDown={(e) => e.preventDefault()} onClick={() => pick("image/png,image/jpeg,image/gif,image/webp", "image")}>Image</button>}
        {uploadPublic && <button type="button" title="Insert a link to a document (PDF, Word, Excel…)" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip", "document")}>Document</button>}
        {variables.length > 0 && (
          <div className="re-pop">
            <button type="button" className="re-varbtn" title="Insert a variable (filled in for each person)" onMouseDown={(e) => e.preventDefault()} onClick={() => { setMenu(menu === "vars" ? "" : "vars"); setVarQ(""); }}>{"{{ }}"} Variable</button>
            {menu === "vars" && (
              <div className="re-menu re-vars">
                <input className="input" autoFocus placeholder="Search variables…" value={varQ} onChange={(e) => setVarQ(e.target.value)} aria-label="Search variables" />
                <div className="re-vars-list">
                  {groups.map((g) => (
                    <div key={g.name}>
                      <div className="re-vars-group">{g.name}</div>
                      {g.items.map((v) => (
                        <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { insertHtml(esc(`{{${v.key}}}`)); setMenu(""); }}>
                          <b>{v.key}</b><small>{v.hint}</small>
                        </button>
                      ))}
                    </div>
                  ))}
                  {!groups.length && <div className="re-vars-none">No variable found.</div>}
                </div>
              </div>
            )}
          </div>
        )}
        <span className="re-sep" />
        <B c="removeFormat" title="Clear formatting">Clear</B>
        <B c="undo" title="Undo (Ctrl+Z)">↶</B>
        <B c="redo" title="Redo (Ctrl+Y)">↷</B>
        {busy && <span className="re-busy">{busy}</span>}
      </div>
      {img && (
        <div className="re-imgbar">
          <span>Image size:</span>
          {[["25%", "Small"], ["50%", "Medium"], ["75%", "Large"], ["100%", "Full width"]].map(([w, l]) => <button key={w} type="button" onClick={() => setImgWidth(w)}>{l}</button>)}
          <button type="button" className="re-imgdrop" onClick={dropImg}>Remove image</button>
          <button type="button" className="re-x" onClick={() => setImg(null)} aria-label="Close"><CloseIcon /></button>
        </div>
      )}
      <div ref={ed} className={`re-text${empty ? " is-empty" : ""}`} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Message"
        data-placeholder={placeholder} style={{ minHeight }}
        onInput={changed}
        onClick={(e) => setImg(e.target.tagName === "IMG" ? e.target : null)}
        onPaste={(e) => {
          // Pasted text comes in plain (formatting from Word / websites breaks emails); format it here.
          e.preventDefault();
          const t = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, t);
        }} />
    </div>
  );
}
