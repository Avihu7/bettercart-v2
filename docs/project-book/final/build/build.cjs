/*
 * BetterCart Project Book — DOCX builder.
 *
 * Reads the structured Hebrew content in ../content/*.md (a small, fixed markup —
 * see README.md in this folder) and the images in ../figures, and writes
 * ../BetterCart_Project_Book.docx with real Word styles: headings, captions,
 * automatic table of contents / list of figures / list of tables, RTL paragraphs,
 * David 14 for Hebrew and Times New Roman 12 for English.
 *
 * Usage:  node build.cjs [output.docx]
 */
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const d = require("docx");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  TableOfContents, StyleLevel, HeadingLevel, AlignmentType, WidthType, ShadingType,
  BorderStyle, LevelFormat, PageNumber, Header, Footer, VerticalAlign, TableLayoutType,
  PageBreak, MathRun, MathFraction, MathSubScript, MathSuperScript, MathSubSuperScript, MathSum,
} = d;
const DMath = d.Math;

const ROOT = path.join(__dirname, "..");
const CONTENT = process.env.BOOK_CONTENT ? path.resolve(process.env.BOOK_CONTENT) : path.join(ROOT, "content");
const FIGS = path.join(ROOT, "figures");
const OUT = process.argv[2] || path.join(ROOT, "BetterCart_Project_Book.docx");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIGS, "manifest.json"), "utf8"));

// ---------- visual system ----------
const GREEN = "1B7F5C";       // accent
const GREEN_DARK = "135C43";  // heading numbers, table header text
const GREEN_TINT = "E4F2EB";  // table header / decision callout fill
const GREY_TINT = "F3F5F4";   // code / pseudocode fill
const AMBER_TINT = "FBF3E0";  // limitation callout fill
const AMBER = "B7791F";
const INK = "1F2933";         // headings
const MUTED = "5F6B76";       // captions, header
const RULE = "C9D3CE";        // table rules
const HE_FONT = "David";
const EN_FONT = "Times New Roman";
const MONO = "Courier New";
const FONT = { ascii: EN_FONT, hAnsi: EN_FONT, cs: HE_FONT, eastAsia: EN_FONT };
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1417;  // A4, 2.5 cm margins
const TEXT_W = PAGE_W - 2 * MARGIN;                   // 9072 DXA = 16 cm
const TEXT_W_PX = 604;

// Body sizes in half-points: Hebrew 14 pt, English 12 pt.
const BODY = { he: 28, en: 24 };
const TABLE = { he: 23, en: 20 };
const SMALL = { he: 22, en: 20 };

// ---------- inline text ----------
const HEB = /[֐-׿]/;
const LAT = /[A-Za-z]/;

/** Split plain text into Hebrew (RTL) and Latin (LTR) segments. */
function splitDirections(text, forceLtr) {
  if (forceLtr) return [{ t: text, rtl: false }];
  const out = [];
  let i = 0, buf = "";
  const n = text.length;
  const INNER = /[A-Za-z0-9 .,_/:()'’+\-–&@#%·×=<>*~!?"]/;
  const startsLatin = (k) => { const m = text.slice(k).match(/^[0-9.,]*[A-Za-z]/); return !!m; };
  while (i < n) {
    if (startsLatin(i) && !(i > 0 && /[0-9.,]/.test(text[i - 1]) && !LAT.test(text[i]))) {
      let j = i, lastGood = i;
      while (j < n && !HEB.test(text[j]) && INNER.test(text[j])) {
        // Sentence punctuation followed by a space ends the segment unless the next word is Latin too.
        if (/[.,;:!?]/.test(text[j]) && (j + 1 >= n || text[j + 1] === " ")) {
          let k = j + 1; while (k < n && text[k] === " ") k++;
          const word = text.slice(k).split(" ")[0] || "";
          if (!/[A-Za-z]/.test(word) || HEB.test(word)) break;
        }
        // A space followed by a Hebrew-attached token ends the segment as well.
        if (text[j] === " ") {
          const word = text.slice(j + 1).split(" ")[0] || "";
          if (HEB.test(word) || word === "" ) break;
        }
        if (/[A-Za-z0-9)%]/.test(text[j])) lastGood = j;
        j++;
      }
      let seg = text.slice(i, lastGood + 1);
      while (seg.endsWith(")") && (seg.match(/\(/g) || []).length < (seg.match(/\)/g) || []).length) seg = seg.slice(0, -1);
      if (buf) { out.push({ t: buf, rtl: true }); buf = ""; }
      out.push({ t: seg, rtl: false });
      i += seg.length;
    } else { buf += text[i]; i++; }
  }
  if (buf) out.push({ t: buf, rtl: true });
  return out;
}

function run(text, o = {}) {
  const sz = o.sz || BODY;
  const base = {
    text,
    font: o.font ? { ascii: o.font, hAnsi: o.font, cs: o.font, eastAsia: o.font } : FONT,
    size: o.rtl ? sz.he : sz.en,
    sizeComplexScript: sz.he,
    bold: o.bold || undefined,
    boldComplexScript: o.bold || undefined,
    italics: o.italic || undefined,
    italicsComplexScript: o.italic || undefined,
    color: o.color,
    rightToLeft: o.rtl || undefined,
    highlight: o.highlight,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
    superScript: o.sup || undefined,
    subScript: o.sub || undefined,
  };
  if (o.fixed) { base.size = o.fixed; base.sizeComplexScript = o.fixed; }
  return new TextRun(base);
}

/** Inline formula: italic LTR run(s) with simple ^ and _ handling (x^2, a_i, 10^{-9}). */
function inlineMath(src, o) {
  src = src.replace(/\\cdot/g, "·").replace(/\\le/g, "≤").replace(/\\ge/g, "≥").replace(/\\log/g, "log").replace(/\\times/g, "×");
  const out = [];
  const re = /([\^_])(\{[^}]*\}|.)/g;
  let last = 0, m;
  const push = (t, extra = {}) => { if (t) out.push(run(t, { ...o, rtl: false, italic: true, ...extra })); };
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index));
    const body = m[2].startsWith("{") ? m[2].slice(1, -1) : m[2];
    push(body, m[1] === "^" ? { sup: true } : { sub: true });
    last = m.index + m[0].length;
  }
  push(src.slice(last));
  return out;
}

/** Inline markup -> TextRun[]. Supports **bold**, *italic*, `code`, $math$, [[placeholder]]. */
function inline(text, o = {}) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\$[^$]+\$|\[\[[^\]]+\]\])/g;
  let last = 0, m;
  const plain = (s, extra = {}) => {
    if (!s) return;
    for (const seg of splitDirections(s, o.ltr)) runs.push(run(seg.t, { ...o, ...extra, rtl: seg.rtl }));
  };
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) plain(tok.slice(2, -2), { bold: true });
    else if (tok.startsWith("[[")) {
      for (const seg of splitDirections("[להשלמה: " + tok.slice(2, -2) + "]"))
        runs.push(run(seg.t, { ...o, rtl: seg.rtl, highlight: "yellow" }));
    } else if (tok.startsWith("`")) {
      const sz = o.sz || BODY;
      runs.push(run(tok.slice(1, -1), { ...o, rtl: false, font: MONO, fixed: sz.en - 3, shade: o.noShade ? undefined : GREY_TINT }));
    } else if (tok.startsWith("$")) {
      runs.push(...inlineMath(tok.slice(1, -1), o));
    } else plain(tok.slice(1, -1), { italic: true });
    last = m.index + tok.length;
  }
  plain(text.slice(last));
  return runs;
}

// ---------- paragraphs ----------
function para(text, o = {}) {
  return new Paragraph({
    bidirectional: o.ltr ? undefined : true,
    alignment: o.align || (o.ltr ? AlignmentType.BOTH : AlignmentType.BOTH),
    spacing: { line: o.line || 360, after: o.after ?? 140, before: o.before ?? 0 },
    keepNext: o.keepNext, keepLines: o.keepLines, indent: o.indent,
    style: o.style, numbering: o.numbering, border: o.border, pageBreakBefore: o.pageBreakBefore,
    children: Array.isArray(text) ? text : inline(text, { ...(o.run || {}), ltr: o.ltr }),
  });
}

function headingParts(text) {
  let m;
  if ((m = text.match(/^פרק\s+(\d+)\s+[—-]\s+(.*)$/))) return { num: m[1], title: m[2], chapter: m[1] };
  if ((m = text.match(/^נספח\s+([א-ת])\s+[—-]\s+(.*)$/))) return { num: "נספח " + m[1], title: m[2], chapter: m[1], appendix: true };
  if ((m = text.match(/^((?:\d+|[א-ת])(?:\.\d+)+)\s+(.*)$/))) return { num: m[1], title: m[2] };
  return { num: null, title: text };
}

function heading(level, text0) {
  const noBreak = /\{nobreak\}/.test(text0);
  const text = text0.replace("{nobreak}", "").trim();
  const p = headingParts(text);
  const sz = level === 1 ? { he: 46, en: 40 } : level === 2 ? { he: 34, en: 30 } : { he: 29, en: 26 };
  const children = [];
  if (p.num) {
    if (p.appendix) children.push(run(p.num, { rtl: true, bold: true, color: GREEN, sz }));
    else children.push(run(p.num, { rtl: true, bold: true, color: GREEN, sz }));
    children.push(run(level === 1 ? (p.appendix ? " — " : "   ") : "  ", { rtl: true, bold: true, color: GREEN, sz }));
  }
  children.push(...inline(p.title, { bold: true, color: INK, sz, noShade: true }));
  return new Paragraph({
    heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1],
    bidirectional: true, alignment: AlignmentType.START, keepNext: true, keepLines: true,
    pageBreakBefore: level === 1 && !noBreak,
    spacing: level === 1 ? { before: noBreak ? 480 : 0, after: 360, line: 320 } : level === 2 ? { before: 360, after: 140, line: 320 } : { before: 260, after: 100, line: 320 },
    border: level === 1 ? { bottom: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 10 } } : undefined,
    children,
  });
}

// ---------- tables ----------
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const THIN = { style: BorderStyle.SINGLE, size: 4, color: RULE };

function visLen(s) { return s.replace(/[*`$\[\]]/g, "").length; }

function colWidths(rows, hint, total = TEXT_W) {
  const n = rows[0].length;
  let w;
  if (hint && hint.length === n) w = hint;
  else {
    w = Array(n).fill(0);
    for (const r of rows) r.forEach((c, i) => {
      const longestWord = Math.max(...c.split(/\s+/).map(visLen), 0);
      w[i] = Math.max(w[i], Math.min(46, Math.max(visLen(c) * 0.55, longestWord * 1.15, 5)));
    });
  }
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.floor((x / sum) * total));
  out[n - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

function tableBlock(rows, opts = {}) {
  const widths = colWidths(rows, opts.widths);
  const trs = rows.map((cells, ri) => new TableRow({
    tableHeader: ri === 0, cantSplit: true,
    children: cells.map((c, ci) => {
      const head = ri === 0;
      const short = visLen(c) <= 3 && /^[✓✗—\-0-9]*$/.test(c.trim());
      const ltrCell = !HEB.test(c) && c.trim() !== "";
      return new TableCell({
        width: { size: widths[ci], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: head ? { type: ShadingType.CLEAR, fill: GREEN_TINT, color: "auto" } : (ri % 2 === 0 ? { type: ShadingType.CLEAR, fill: "FAFBFA", color: "auto" } : undefined),
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        borders: {
          top: head ? { style: BorderStyle.SINGLE, size: 8, color: GREEN } : THIN,
          bottom: head ? { style: BorderStyle.SINGLE, size: 8, color: GREEN } : THIN,
          left: NO_BORDER, right: NO_BORDER,
        },
        children: [new Paragraph({
          bidirectional: true,
          alignment: short ? AlignmentType.CENTER : AlignmentType.START,
          spacing: { line: 276, after: 0, before: 0 },
          keepNext: rows.length <= 14 && ri < rows.length - 1,
          children: inline(c.trim() || " ", { sz: TABLE, bold: head, color: head ? GREEN_DARK : undefined, noShade: head, ltr: ltrCell }),
        })],
      });
    }),
  }));
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths,
    visuallyRightToLeft: true, layout: TableLayoutType.FIXED, alignment: AlignmentType.CENTER,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: trs,
  });
}

function caption(kind, num, text, style) {
  return new Paragraph({
    style, bidirectional: true, alignment: AlignmentType.CENTER, keepNext: kind === "טבלה", keepLines: true,
    spacing: kind === "טבלה" ? { before: 200, after: 100, line: 300 } : { before: 100, after: 260, line: 300 },
    children: [
      run(`${kind} ${num}`, { rtl: true, bold: true, color: GREEN_DARK, sz: SMALL }),
      run(" — ", { rtl: true, color: MUTED, sz: SMALL }),
      ...inline(text, { sz: SMALL, color: "3A444D", noShade: true }),
    ],
  });
}

function boxTable(children, { fill, bar, ltr = false }) {
  const barBorder = { style: BorderStyle.SINGLE, size: 30, color: bar };
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [TEXT_W],
    visuallyRightToLeft: !ltr, layout: TableLayoutType.FIXED,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: TEXT_W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill, color: "auto" },
      margins: { top: 120, bottom: 120, left: 200, right: 200 },
      // In a visually-RTL table Word mirrors left/right, so "left" is the reading-start edge in both cases.
      borders: { top: NO_BORDER, bottom: NO_BORDER, right: NO_BORDER, left: barBorder },
      children,
    })] })],
  });
}

function callout(kind, title, lines) {
  const spec = {
    decision: { label: "החלטה הנדסית", fill: GREEN_TINT, bar: GREEN, color: GREEN_DARK },
    limit: { label: "מגבלה", fill: AMBER_TINT, bar: AMBER, color: "8A5A12" },
    note: { label: "הערה", fill: GREY_TINT, bar: "8795A1", color: "3A444D" },
    insight: { label: "תובנה", fill: GREEN_TINT, bar: GREEN, color: GREEN_DARK },
    todo: { label: "להשלמה בידי המגישים", fill: "FFF7C2", bar: "D4A900", color: "6B5600" },
  }[kind];
  const sz = { he: 25, en: 22 };
  const head = new Paragraph({
    bidirectional: true, alignment: AlignmentType.START, spacing: { line: 300, after: 60 }, keepNext: true,
    children: [run(spec.label, { rtl: true, bold: true, color: spec.color, sz }),
      ...(title ? [run("  ·  ", { rtl: true, color: spec.color, sz }), ...inline(title, { bold: true, color: INK, sz, noShade: true })] : [])],
  });
  const body = lines.map((l, i) => new Paragraph({
    bidirectional: true, alignment: AlignmentType.BOTH, spacing: { line: 320, after: i === lines.length - 1 ? 0 : 80 },
    children: inline(l, { sz, noShade: true }),
  }));
  return [boxTable([head, ...body], { fill: spec.fill, bar: spec.bar }), spacer(160)];
}

function spacer(after = 120) {
  return new Paragraph({ spacing: { before: 0, after, line: 120 }, children: [] });
}

const KEYWORDS = /\b(function|for each|for|while|if|else if|else|then|return|repeat|until|do|end|in|and|or|not|break|continue|input|output)\b/g;
function codeBlock(lines, o = {}) {
  const paras = [];
  if (o.title) {
    paras.push(new Paragraph({
      bidirectional: true, alignment: AlignmentType.START, spacing: { line: 300, after: 80 }, keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
      children: inline(o.title, { bold: true, color: GREEN_DARK, sz: { he: 24, en: 21 }, noShade: true }),
    }));
  }
  lines.forEach((l0, idx) => {
    const l = l0.replace(/\s{3,}\/\//, "   //");
    const children = [];
    if (o.algo) {
      children.push(new TextRun({ text: String(idx + 1).padStart(2, " ") + "  ", font: MONO, size: 16, color: "9AA5AE" }));
      const cm = l.indexOf("//");
      const code = cm >= 0 ? l.slice(0, cm) : l, comment = cm >= 0 ? l.slice(cm) : "";
      let last = 0, m;
      KEYWORDS.lastIndex = 0;
      while ((m = KEYWORDS.exec(code))) {
        if (m.index > last) children.push(new TextRun({ text: code.slice(last, m.index), font: MONO, size: 17 }));
        children.push(new TextRun({ text: m[0], font: MONO, size: 17, bold: true, color: GREEN_DARK }));
        last = m.index + m[0].length;
      }
      if (last < code.length) children.push(new TextRun({ text: code.slice(last), font: MONO, size: 17 }));
      if (comment) children.push(new TextRun({ text: comment, font: MONO, size: 16, italics: true, color: MUTED }));
    } else children.push(new TextRun({ text: l || " ", font: MONO, size: 17 }));
    paras.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 250, after: 0 }, children }));
  });
  return [boxTable(paras, { fill: GREY_TINT, bar: o.algo ? GREEN : "8795A1", ltr: true }), spacer(160)];
}

// ---------- equations ----------
const SYM = { cdot: "·", le: "≤", ge: "≥", times: "×", in: "∈", pm: "±", approx: "≈", lceil: "⌈", rceil: "⌉", to: "→", ne: "≠", quad: "    ", Sigma: "Σ", minus: "−" };
function parseMath(src) {
  let i = 0;
  function group() {           // expects src[i] === "{"
    let depth = 0, start = i + 1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { const inner = src.slice(start, i); i++; return parseMath(inner); } }
    }
    throw new Error("Unbalanced braces in equation: " + src);
  }
  const nodes = [];
  let text = "";
  const flush = () => { if (text) { nodes.push({ text }); text = ""; } };
  const toRuns = (ns) => ns.map((x) => (x.text !== undefined ? new MathRun(x.text) : x.node));
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      const m = src.slice(i).match(/^\\([A-Za-z]+)/);
      const name = m[1]; i += m[0].length;
      if (name === "frac") { flush(); const a = group(), b = group(); nodes.push({ node: new MathFraction({ numerator: a, denominator: b }) }); }
      else if (name === "sum") {
        flush(); let sub = [], sup = [];
        if (src[i] === "_") { i++; sub = group(); }
        if (src[i] === "^") { i++; sup = group(); }
        while (src[i] === " ") i++;
        const body = src[i] === "{" ? group() : [];
        nodes.push({ node: new MathSum({ children: body, subScript: sub, superScript: sup.length ? sup : undefined }) });
      } else if (name === "text") { flush(); const start = i + 1; const end = src.indexOf("}", start); nodes.push({ text: src.slice(start, end) }); i = end + 1; }
      else if (SYM[name] !== undefined) text += SYM[name];
      else text += name;   // \min, \max, \exp, \ln, \round ...
    } else if (ch === "_" || ch === "^") {
      i++;
      const arg = src[i] === "{" ? group() : [new MathRun(src[i++])];
      const m = text.match(/([A-Za-z0-9]+|\S)$/);
      const baseText = m ? m[0] : "";
      text = text.slice(0, text.length - baseText.length); flush();
      const base = [new MathRun(baseText)];
      if (ch === "_" && src[i] === "^") { i++; const sup = src[i] === "{" ? group() : [new MathRun(src[i++])]; nodes.push({ node: new MathSubSuperScript({ children: base, subScript: arg, superScript: sup }) }); }
      else nodes.push({ node: ch === "_" ? new MathSubScript({ children: base, subScript: arg }) : new MathSuperScript({ children: base, superScript: arg }) });
    } else { text += ch; i++; }
  }
  flush();
  return toRuns(nodes);
}

function equation(src, num) {
  const eqW = TEXT_W - 760;
  const cell = (w, children) => new TableCell({
    width: { size: w, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }, children,
  });
  return [new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [eqW, 760], layout: TableLayoutType.FIXED,
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [new TableRow({ cantSplit: true, children: [
      cell(eqW, [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60, line: 300 }, children: [new DMath({ children: parseMath(src) })] })]),
      cell(760, [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: num ? `(${num})` : "", font: EN_FONT, size: 22, color: MUTED })] })]),
    ] })],
  }), spacer(num ? 100 : 20)];
}

// ---------- figures ----------
function figure(num, file, cap, pct) {
  const dims = MANIFEST[file];
  if (!dims) throw new Error("Figure missing from manifest: " + file);
  const w = Math.round(TEXT_W_PX * (pct / 100));
  const h = Math.round(w * dims[1] / dims[0]);
  const ext = path.extname(file).slice(1).toLowerCase();
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 60 },
      children: [new ImageRun({ type: ext === "jpeg" ? "jpg" : ext, data: fs.readFileSync(path.join(FIGS, file)), transformation: { width: w, height: h },
        altText: { title: `איור ${num}`, description: cap, name: file } })],
    }),
    caption("איור", num, cap, "FigureCaption"),
  ];
}

// ---------- cover ----------
function cover(meta) {
  const c = (text, o = {}) => new Paragraph({
    bidirectional: !o.ltr || undefined, alignment: AlignmentType.CENTER,
    spacing: { before: o.before || 0, after: o.after ?? 120, line: o.line || 320 },
    border: o.border, children: inline(text, { sz: o.sz || BODY, bold: o.bold, color: o.color, noShade: true }),
  });
  return [
    new Paragraph({ spacing: { before: 0, after: 0 }, border: { top: { style: BorderStyle.SINGLE, size: 48, color: GREEN, space: 1 } }, children: [] }),
    c(meta.college, { sz: { he: 36, en: 32 }, bold: true, before: 500 }),
    c(meta.department, { sz: { he: 30, en: 26 }, after: 600 }),
    c("דוח סיכום פרויקט", { sz: { he: 30, en: 26 }, color: GREEN_DARK, bold: true, after: 300 }),
    c("BetterCart", { sz: { he: 84, en: 84 }, bold: true, color: GREEN, after: 200, line: 800, ltr: true }),
    c(meta.titleHe, { sz: { he: 34, en: 30 }, bold: true, after: 160, line: 420 }),
    c(meta.titleEn, { sz: { he: 28, en: 26 }, color: MUTED, after: 500, line: 380 }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } }, indent: { left: 2800, right: 2800 }, children: [] }),
    c("מגישים", { sz: SMALL, color: MUTED, after: 60 }),
    ...meta.authors.map((a) => c(a, { sz: { he: 30, en: 26 }, after: 60 })),
    c("מנחה", { sz: SMALL, color: MUTED, before: 260, after: 60 }),
    c(meta.supervisor, { sz: { he: 30, en: 26 }, after: 60 }),
    ...(meta.partner ? [c(meta.partner, { sz: SMALL, before: 300, after: 60 })] : []),
    c(meta.date, { sz: { he: 28, en: 24 }, before: 400, after: 0 }),
  ];
}

// ---------- parser ----------
function parseFile(file, state) {
  const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const isBlockStart = (l) => /^(#{1,4} |\||```|:::|!fig\[|\$\$|- |\d+\. |\s+- |\s+\d+\. |@@|Table:|Widths:|\\pagebreak)/.test(l);
  let pendingCaption = null, pendingWidths = null;
  while (i < lines.length) {
    let l = lines[i];
    if (!l.trim() || /^<!--.*-->$/.test(l.trim()) || l.trim() === "---") { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,3}) (.*)$/))) {
      const level = m[1].length, text = m[2].trim();
      if (level === 1) { const p = headingParts(text.replace("{nobreak}", "").trim()); state.chapter = p.chapter || null; state.eq = 0; }
      out.push(heading(level, text)); i++; continue;
    }
    if ((m = l.match(/^#### (.*)$/))) { out.push(para(m[1], { run: { bold: true, color: GREEN_DARK }, keepNext: true, before: 160, after: 80, align: AlignmentType.START })); i++; continue; }
    if (l.startsWith("@@")) {
      const cmd = l.slice(2).trim();
      if (cmd === "cover") out.push(...cover(state.meta));
      else if (cmd === "toc") out.push(new TableOfContents("תוכן העניינים", { hyperlink: true, headingStyleRange: "1-2" }));
      else if (cmd === "lof") out.push(new TableOfContents("רשימת איורים", { hyperlink: true, stylesWithLevels: [new StyleLevel("FigureCaption", 1)] }));
      else if (cmd === "lot") out.push(new TableOfContents("רשימת טבלאות", { hyperlink: true, stylesWithLevels: [new StyleLevel("TableCaption", 1)] }));
      else if ((m = cmd.match(/^title (.*)$/))) out.push(new Paragraph({ style: "FrontTitle", bidirectional: true, alignment: AlignmentType.START, pageBreakBefore: !/\{nobreak\}/.test(m[1]),
        spacing: { before: /\{nobreak\}/.test(m[1]) ? 240 : 0, after: 220, line: 320 }, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: GREEN, space: 10 } },
        children: inline(m[1].replace("{nobreak}", "").trim(), { bold: true, color: INK, sz: { he: 46, en: 40 } }) }));
      else throw new Error("Unknown directive " + l);
      i++; continue;
    }
    if (l.trim() === "\\pagebreak") { out.push(new Paragraph({ children: [new PageBreak()] })); i++; continue; }
    if ((m = l.match(/^Table:\s*(\S+)\s*\|\s*(.*)$/))) { pendingCaption = { num: m[1], text: m[2].trim() }; i++; continue; }
    if ((m = l.match(/^Widths:\s*(.*)$/))) { pendingWidths = m[1].split(",").map(Number); i++; continue; }
    if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const n = rows[0].length;
      rows.forEach((r) => { while (r.length < n) r.push(""); });
      if (pendingCaption) out.push(caption("טבלה", pendingCaption.num, pendingCaption.text, "TableCaption"));
      out.push(tableBlock(rows, { widths: pendingWidths }), spacer(200));
      pendingCaption = null; pendingWidths = null; continue;
    }
    if (l.startsWith("```")) {
      const info = l.slice(3).trim(); const body = []; i++;
      while (i < lines.length && !lines[i].startsWith("```")) { body.push(lines[i]); i++; }
      i++;
      const t = info.match(/title="([^"]*)"/);
      out.push(...codeBlock(body, { algo: info.startsWith("algo"), title: t ? t[1] : null }));
      continue;
    }
    if ((m = l.match(/^::: ?(\w+)\s*(.*)$/))) {
      const kind = m[1], title = m[2].trim(); const body = []; i++;
      let buf = "";
      while (i < lines.length && lines[i].trim() !== ":::") {
        if (!lines[i].trim()) { if (buf) body.push(buf); buf = ""; } else buf += (buf ? " " : "") + lines[i].trim();
        i++;
      }
      if (buf) body.push(buf); i++;
      if (kind === "ltr") body.forEach((b) => out.push(para(b, { ltr: true, line: 276, after: 80 })));
      else if (kind === "tight") body.forEach((b) => out.push(para(b, { line: 276, after: 80 })));
      else if (kind === "ref") body.forEach((b) => out.push(refEntry(b)));
      else out.push(...callout(kind, title, body));
      continue;
    }
    if ((m = l.match(/^!fig\[([^|]+)\|([^|]+)\|([^|]+)(?:\|(\d+))?\]$/))) { out.push(...figure(m[1].trim(), m[2].trim(), m[3].trim(), Number(m[4] || 100))); i++; continue; }
    if (l.startsWith("$$")) {
      let src = l.slice(2).trim(); let noNum = false;
      if (src.endsWith("{-}")) { noNum = true; src = src.slice(0, -3).trim(); }
      src = src.replace(/\$\$$/, "").trim();
      if (!noNum) state.eq++;
      out.push(...equation(src, noNum ? null : `${state.chapter || ""}${state.chapter ? "." : ""}${state.eq}`)); i++; continue;
    }
    if ((m = l.match(/^(\s*)(- |\d+\. )(.*)$/))) {
      // list (bullets or numbers); nested level by indentation
      const inst = ++state.listInstance;
      while (i < lines.length && (m = lines[i].match(/^(\s*)(- |\d+\. )(.*)$/))) {
        const level = m[1].length >= 2 ? 1 : 0, ordered = m[2] !== "- ";
        let text = m[3]; i++;
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && /^\s{2,}\S/.test(lines[i])) { text += " " + lines[i].trim(); i++; }
        out.push(para(text, { numbering: { reference: ordered ? "numbers" : "bullets", level, instance: ordered ? inst : undefined }, after: 70, line: 340 }));
        while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && /^(\s*)(- |\d+\. )/.test(lines[i + 1])) i++;
      }
      out.push(spacer(60)); continue;
    }
    // plain paragraph
    let text = l.trim(); i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { text += " " + lines[i].trim(); i++; }
    out.push(para(text));
  }
  return out;
}

function refEntry(text) {
  // "[n] reference text" — numbered reference, LTR for English entries, RTL for Hebrew ones.
  const m = text.match(/^\[(\d+)\]\s+(.*)$/);
  const body = m ? m[2] : text;
  const rtl = HEB.test(body.slice(0, 40));
  return new Paragraph({
    bidirectional: rtl || undefined, alignment: AlignmentType.START, spacing: { line: 300, after: 110 },
    indent: { left: 560, hanging: 560 },
    children: [new TextRun({ text: m ? `[${m[1]}]\t` : "", font: EN_FONT, size: 22, color: GREEN_DARK, bold: true }),
      ...inline(body, { sz: { he: 24, en: 22 }, noShade: true, ltr: !rtl })],
  });
}

// ---------- document ----------
const meta = JSON.parse(fs.readFileSync(path.join(CONTENT, "meta.json"), "utf8"));
const state = { meta, chapter: null, eq: 0, listInstance: 0 };
const files = fs.readdirSync(CONTENT).filter((f) => /^\d\d.*\.md$/.test(f)).sort();
const children = [];
for (const f of files) children.push(...parseFile(path.join(CONTENT, f), state));

const lvl = (format, text, left) => ({ level: 0, format, text, alignment: AlignmentType.START, style: { paragraph: { indent: { left, hanging: 360 } }, run: { font: FONT } } });
const doc = new Document({
  creator: "BetterCart", title: "BetterCart — דוח סיכום פרויקט", description: "Project Book", language: "he-IL",
  features: { updateFields: true },
  styles: {
    default: {
      document: { run: { font: FONT, size: BODY.en, sizeComplexScript: BODY.he, color: "000000" }, paragraph: { spacing: { line: 360 } } },
      heading1: { run: { font: FONT, bold: true, size: 40, sizeComplexScript: 46, color: INK }, paragraph: { spacing: { after: 360 } } },
      heading2: { run: { font: FONT, bold: true, size: 30, sizeComplexScript: 34, color: INK } },
      heading3: { run: { font: FONT, bold: true, size: 26, sizeComplexScript: 29, color: INK } },
    },
    paragraphStyles: [
      { id: "FigureCaption", name: "FigureCaption", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: SMALL.en, sizeComplexScript: SMALL.he } },
      { id: "TableCaption", name: "TableCaption", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: SMALL.en, sizeComplexScript: SMALL.he } },
      { id: "FrontTitle", name: "FrontTitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, bold: true, size: 40, sizeComplexScript: 46, color: INK } },
      { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 24, sizeComplexScript: 26, bold: true }, paragraph: { spacing: { before: 120, after: 40, line: 300 } } },
      { id: "TOC2", name: "toc 2", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 22, sizeComplexScript: 24 }, paragraph: { spacing: { before: 0, after: 20, line: 280 }, indent: { left: 300 } } },
      { id: "TOC3", name: "toc 3", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 20, sizeComplexScript: 22, color: "3A444D" }, paragraph: { spacing: { before: 0, after: 0, line: 260 }, indent: { left: 640 } } },
    ],
  },
  numbering: { config: [
    { reference: "bullets", levels: [
      { ...lvl(LevelFormat.BULLET, "•", 560), level: 0 },
      { ...lvl(LevelFormat.BULLET, "–", 1040), level: 1 } ] },
    { reference: "numbers", levels: [
      { ...lvl(LevelFormat.DECIMAL, "%1.", 560), level: 0 },
      { ...lvl(LevelFormat.BULLET, "–", 1040), level: 1 } ] },
  ] },
  sections: [{
    properties: { titlePage: true, page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 680, footer: 680 } } },
    headers: {
      default: new Header({ children: [new Paragraph({ bidirectional: true, alignment: AlignmentType.START, spacing: { after: 0 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
        children: [run("BetterCart", { rtl: false, bold: true, color: GREEN, sz: { he: 20, en: 18 } }), run("  ·  דוח סיכום פרויקט", { rtl: true, color: MUTED, sz: { he: 20, en: 18 } })] })] }),
      first: new Header({ children: [new Paragraph({ children: [] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 },
        children: [new TextRun({ children: [PageNumber.CURRENT], font: EN_FONT, size: 22, color: "3A444D" })] })] }),
      first: new Footer({ children: [new Paragraph({ children: [] })] }),
    },
    children,
  }],
});

(async () => {
  const buf = await Packer.toBuffer(doc);
  // Post-process: Word builds TOC paragraphs from the "toc N" styles, which must be RTL.
  const zip = await JSZip.loadAsync(buf);
  let styles = await zip.file("word/styles.xml").async("string");
  for (const id of ["TOC1", "TOC2", "TOC3", "FigureCaption", "TableCaption", "FrontTitle", "Heading1", "Heading2", "Heading3"]) {
    const re = new RegExp(`(<w:style [^>]*w:styleId="${id}"[^>]*>[\\s\\S]*?)(<w:pPr>|<w:rPr>|</w:style>)`);
    styles = styles.replace(re, (all, pre, tag) => (tag === "<w:pPr>" ? `${pre}<w:pPr><w:bidi/>` : `${pre}<w:pPr><w:bidi/></w:pPr>${tag}`));
  }
  zip.file("word/styles.xml", styles);
  // The TOC field paragraphs are emitted without direction; Word then freezes them as LTR.
  let docXml = await zip.file("word/document.xml").async("string");
  docXml = docXml.replace(/(<w:sdtContent>)([\s\S]*?)(<\/w:sdtContent>)/g, (all, a, body, c) =>
    a + body.replace(/<w:p>(?!<w:pPr>)/g, "<w:p><w:pPr><w:bidi/></w:pPr>").replace(/<w:p><w:pPr>(?!<w:bidi)/g, "<w:p><w:pPr><w:bidi/>") + c);
  docXml = docXml.replace(/<w:sectPr>/g, "<w:sectPr>").replace(/(<w:sectPr[^>]*>[\s\S]*?)(<\/w:sectPr>)/g, (all, a, b) => (/<w:bidi\/>/.test(a) ? all : a + "<w:bidi/>" + b));
  zip.file("word/document.xml", docXml);
  let settings = await zip.file("word/settings.xml").async("string");
  if (!/w:themeFontLang/.test(settings)) settings = settings.replace("</w:settings>", '<w:themeFontLang w:val="en-US" w:bidi="he-IL"/></w:settings>');
  zip.file("word/settings.xml", settings);
  fs.writeFileSync(OUT, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("Wrote", OUT, "blocks:", children.length);
})();
