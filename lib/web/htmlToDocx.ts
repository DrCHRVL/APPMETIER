/**
 * Convertisseur HTML → OOXML réel, pour remplacer l'ancienne astuce
 * `html-docx-js` (document Word dont le corps n'est qu'un `w:altChunk`
 * pointant vers le HTML brut embarqué). Word l'importait silencieusement à
 * l'ouverture, mais tout autre lecteur (LibreOffice, outils de signature
 * numérique type SIGNA…) qui ne supporte pas l'import altChunk se retrouvait
 * à afficher le HTML source tel quel.
 *
 * Ici, chaque bloc HTML (paragraphe, titre, liste, tableau…) est traduit en
 * véritables paragraphes/« runs » OOXML (`docx.Paragraph` / `docx.TextRun` /
 * `docx.Table`…) : le texte est un vrai texte Word pour n'importe quel
 * consommateur du format, altChunk ou pas.
 *
 * Le vocabulaire de balises/styles couvert correspond à celui produit par
 * `acteExport.ts` (papeterie des actes) et à l'allowlist de `sanitizeHtml.ts`
 * (contenu saisi par l'utilisateur dans les éditeurs riches de l'app) :
 * a, b/strong, i/em, u/ins, s/strike/del, mark, small, sub, sup, p, br, div,
 * span, ul/ol/li, blockquote, pre/code, h1-h6, table/thead/tbody/tfoot/tr/td/th,
 * hr, font, img (data URI).
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

/** Interligne 1,5 (240 = simple) appliqué au corps justifié des actes. */
const LINE_15 = { line: 360, lineRule: LineRuleType.AUTO } as const;

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];
type Block = Paragraph | Table;
type InlineRun = TextRun | ImageRun | ExternalHyperlink;

export interface ImageSize {
  width: number;
  height: number;
}

export interface HtmlToDocxOptions {
  /** Police par défaut du document (ex. "Times New Roman", "Calibri"). */
  defaultFont?: string;
  /** Taille par défaut, en demi-points (ex. 24 = 12pt). */
  defaultSizeHalfPt?: number;
  /** Dimensions naturelles (px) des images `data:` référencées, par src. */
  imageSizes?: Map<string, ImageSize>;
}

interface RunCtx {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  shadingFill?: string;
  size?: number;
  smallCaps?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  font?: string;
}

interface ParaStyle {
  alignment?: Align;
  indentLeft?: number;
  italics?: boolean;
  bold?: boolean;
  color?: string;
  size?: number;
  smallCaps?: boolean;
  underline?: boolean;
}

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'table', 'blockquote', 'hr', 'pre',
]);

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const SOLID_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const;
const NO_CELL_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };
const SOLID_CELL_BORDERS = { top: SOLID_BORDER, bottom: SOLID_BORDER, left: SOLID_BORDER, right: SOLID_BORDER };

// ── Utilitaires de parsing CSS minimal ──────────────────────────────────────

function parseStyle(style: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const k = decl.slice(0, idx).trim().toLowerCase();
    const v = decl.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function parseHalfPt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const pt = v.match(/([\d.]+)\s*pt/);
  if (pt) return Math.round(parseFloat(pt[1]) * 2);
  const px = v.match(/([\d.]+)\s*px/);
  if (px) return Math.round(parseFloat(px[1]) * 0.75 * 2);
  return undefined;
}

function parsePx(style: Record<string, string>, prop: string): number | undefined {
  const v = style[prop];
  if (!v) return undefined;
  const m = v.match(/([\d.]+)\s*px/);
  if (m) return parseFloat(m[1]);
  const n = v.match(/^([\d.]+)$/);
  return n ? parseFloat(n[1]) : undefined;
}

const NAMED_COLORS: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000',
  blue: '0000FF', gray: '808080', grey: '808080', yellow: 'FFFF00',
};

function normalizeColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  const hex = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return h.toUpperCase();
  }
  const rgb = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return NAMED_COLORS[t];
}

function mapAlign(v: string | undefined): Align | undefined {
  switch (v) {
    case 'center': return AlignmentType.CENTER;
    case 'right': return AlignmentType.RIGHT;
    case 'justify': return AlignmentType.JUSTIFIED;
    case 'left': return AlignmentType.LEFT;
    default: return undefined;
  }
}

/**
 * Traduit le style CSS d'un élément de BLOC (`p`, `div`, cellule…) en réglages
 * de paragraphe/run. Ne renseigne QUE les clés réellement présentes : une clé
 * absente n'est pas posée à `undefined`, ce qui préserve l'héritage lors du
 * `withPara({ ...this.para, ...patch })` (ex. le `font-variant:small-caps` de la
 * cellule d'en-tête doit rester actif dans les `div` internes qui ne le
 * redéfinissent pas). Comble le trou historique : jusqu'ici, gras/italique/
 * taille/petites-capitales posés sur un `<p>` ou un `<div>` étaient ignorés à
 * l'export Word (seul le PDF, rendu par un navigateur, les honorait).
 */
function paraPatchFromStyle(style: Record<string, string>): Partial<ParaStyle> {
  const patch: Partial<ParaStyle> = {};
  const align = mapAlign(style['text-align']);
  if (align) patch.alignment = align;
  const color = normalizeColor(style.color);
  if (color) patch.color = color;
  if (/bold|[6-9]00/.test(style['font-weight'] || '')) patch.bold = true;
  if (style['font-style'] === 'italic') patch.italics = true;
  const size = parseHalfPt(style['font-size']);
  if (size) patch.size = size;
  const variant = `${style['font-variant'] || ''} ${style['font-variant-caps'] || ''}`;
  if (/small-caps/.test(variant)) patch.smallCaps = true;
  const td = style['text-decoration'] || style['text-decoration-line'] || '';
  if (/underline/.test(td)) patch.underline = true;
  return patch;
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Contexte « run » (formatage inline hérité) ──────────────────────────────

function applyInlineTag(tag: string, el: Element, ctx: RunCtx): RunCtx {
  const next: RunCtx = { ...ctx };
  if (tag === 'b' || tag === 'strong') next.bold = true;
  if (tag === 'i' || tag === 'em') next.italics = true;
  if (tag === 'u' || tag === 'ins') next.underline = true;
  if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true;
  if (tag === 'sub') next.subScript = true;
  if (tag === 'sup') next.superScript = true;
  if (tag === 'small') next.size = Math.max(12, (next.size || 22) - 6);
  if (tag === 'mark') {
    const style = parseStyle(el.getAttribute('style'));
    next.shadingFill = normalizeColor(style.background || style['background-color']) || 'FEF08A';
  }
  if (tag === 'font') {
    const color = el.getAttribute('color');
    if (color) next.color = normalizeColor(color) || next.color;
  }
  const style = parseStyle(el.getAttribute('style'));
  if (style['font-weight'] && /bold|[6-9]00/.test(style['font-weight'])) next.bold = true;
  if (style['font-style'] === 'italic') next.italics = true;
  const td = style['text-decoration'] || style['text-decoration-line'];
  if (td) {
    if (/underline/.test(td)) next.underline = true;
    if (/line-through/.test(td)) next.strike = true;
  }
  if (style.color) next.color = normalizeColor(style.color) || next.color;
  const bg = style.background || style['background-color'];
  if (bg) next.shadingFill = normalizeColor(bg) || next.shadingFill;
  const sz = parseHalfPt(style['font-size']);
  if (sz) next.size = sz;
  return next;
}

function makeTextRun(text: string, ctx: RunCtx): TextRun {
  return new TextRun({
    text,
    bold: ctx.bold,
    italics: ctx.italics,
    underline: ctx.underline ? {} : undefined,
    strike: ctx.strike,
    color: ctx.color,
    size: ctx.size,
    smallCaps: ctx.smallCaps,
    font: ctx.font,
    superScript: ctx.superScript,
    subScript: ctx.subScript,
    shading: ctx.shadingFill
      ? { fill: ctx.shadingFill, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
  });
}

function buildImageRun(el: Element, imageSizes: Map<string, ImageSize>): ImageRun | null {
  const src = el.getAttribute('src') || '';
  const m = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  const type = (ext === 'jpeg' ? 'jpg' : ext) as 'jpg' | 'png' | 'gif' | 'bmp';
  let data: Uint8Array;
  try {
    data = base64ToUint8Array(m[2]);
  } catch {
    return null;
  }
  const style = parseStyle(el.getAttribute('style'));
  const natural = imageSizes.get(src) || { width: 200, height: 60 };
  const cssWidth = parsePx(style, 'width') || Number(el.getAttribute('width')) || natural.width;
  const scale = natural.width > 0 ? cssWidth / natural.width : 1;
  const width = Math.max(1, Math.round(cssWidth));
  const height = Math.max(1, Math.round((natural.height || cssWidth) * scale));
  return new ImageRun({ type, data, transformation: { width, height } });
}

/** Formatage inline (texte, gras/italique/liens/images…) → suite de runs. */
function collectRuns(node: Node, ctx: RunCtx, imageSizes: Map<string, ImageSize>): InlineRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || '').replace(/[ \t\r\n]+/g, ' ');
    if (!text) return [];
    return [makeTextRun(text, ctx)];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') return [new TextRun({ text: '', break: 1 })];
  if (tag === 'img') {
    const run = buildImageRun(el, imageSizes);
    return run ? [run] : [];
  }
  const next = applyInlineTag(tag, el, ctx);
  if (tag === 'a') {
    const href = el.getAttribute('href');
    const linkCtx: RunCtx = { ...next, underline: true, color: next.color || '0563C1' };
    const children = Array.from(el.childNodes).flatMap((c) => collectRuns(c, linkCtx, imageSizes));
    if (href && /^https?:|^mailto:/i.test(href) && children.length) {
      return [new ExternalHyperlink({ link: href, children: children as TextRun[] })];
    }
    return children;
  }
  return Array.from(el.childNodes).flatMap((c) => collectRuns(c, next, imageSizes));
}

// ── Parcours des blocs ───────────────────────────────────────────────────────

function heading(level: number): { size: number; spacingBefore: number; spacingAfter: number } {
  const sizes: Record<number, number> = { 1: 32, 2: 28, 3: 24, 4: 22, 5: 22, 6: 22 };
  return { size: sizes[level] || 22, spacingBefore: 200, spacingAfter: 120 };
}

class Ctx2 {
  constructor(public run: RunCtx, public para: ParaStyle, public imageSizes: Map<string, ImageSize>) {}

  withPara(patch: Partial<ParaStyle>): Ctx2 {
    return new Ctx2(this.run, { ...this.para, ...patch }, this.imageSizes);
  }
}

interface ParaExtra {
  spacing?: { before?: number; after?: number };
  indent?: { left?: number };
}

function paragraphFromInline(nodes: ChildNode[], ctx: Ctx2, extra: ParaExtra = {}): Paragraph | null {
  const runCtx: RunCtx = {
    ...ctx.run,
    bold: ctx.run.bold || ctx.para.bold,
    italics: ctx.run.italics || ctx.para.italics,
    underline: ctx.run.underline || ctx.para.underline,
    smallCaps: ctx.run.smallCaps || ctx.para.smallCaps,
    color: ctx.run.color || ctx.para.color,
    size: ctx.para.size ?? ctx.run.size,
  };
  const runs = nodes.flatMap((n) => collectRuns(n, runCtx, ctx.imageSizes));
  if (runs.length === 0) return null;
  // Interligne 1,5 sur le corps justifié (visas, motifs) ; l'en-tête, le titre
  // et la signature (centrés/à droite) restent en interligne simple, plus serré.
  const justified = ctx.para.alignment === AlignmentType.JUSTIFIED;
  return new Paragraph({
    children: runs,
    alignment: ctx.para.alignment,
    indent: ctx.para.indentLeft ? { left: ctx.para.indentLeft } : undefined,
    spacing: { after: 120, ...(justified ? LINE_15 : {}) },
    ...extra,
  });
}

function listParagraph(li: Element, ctx: Ctx2, ordered: boolean, index: number, depth: number): Paragraph[] {
  const out: Paragraph[] = [];
  // Isole le texte direct de <li> de ses éventuelles sous-listes imbriquées.
  const directChildren: ChildNode[] = [];
  const nestedLists: Element[] = [];
  for (const c of Array.from(li.childNodes)) {
    if (c.nodeType === Node.ELEMENT_NODE && ['ul', 'ol'].includes((c as Element).tagName.toLowerCase())) {
      nestedLists.push(c as Element);
    } else {
      directChildren.push(c);
    }
  }
  const bullet = ordered ? `${index}. ` : '• ';
  const runCtx = ctx.run;
  const runs = directChildren.flatMap((n) => collectRuns(n, runCtx, ctx.imageSizes));
  const indentLeft = 360 + depth * 360;
  out.push(new Paragraph({
    children: [makeTextRun(bullet, runCtx), ...runs],
    indent: { left: indentLeft, hanging: 300 },
    spacing: { after: 60 },
    alignment: ctx.para.alignment,
  }));
  for (const nested of nestedLists) {
    out.push(...listBlock(nested, ctx, depth + 1));
  }
  return out;
}

function listBlock(listEl: Element, ctx: Ctx2, depth: number): Paragraph[] {
  const ordered = listEl.tagName.toLowerCase() === 'ol';
  const items = Array.from(listEl.children).filter((c) => c.tagName.toLowerCase() === 'li');
  const out: Paragraph[] = [];
  items.forEach((li, i) => out.push(...listParagraph(li, ctx, ordered, i + 1, depth)));
  return out;
}

function tableCellBlocks(cell: Element, ctx: Ctx2): Block[] {
  const blocks: Block[] = [];
  walkChildren(cell, ctx, blocks);
  if (blocks.length === 0) blocks.push(new Paragraph({}));
  return blocks;
}

function tableBlock(tableEl: Element, ctx: Ctx2): Table {
  const tableStyle = parseStyle(tableEl.getAttribute('style'));
  const tableHasBorder = /1px\s+solid/i.test(tableStyle.border || '');
  const rows: TableRow[] = [];
  const trEls = Array.from(tableEl.querySelectorAll('tr'));
  for (const tr of trEls) {
    const cells: TableCell[] = [];
    for (const cellEl of Array.from(tr.children)) {
      const tag = cellEl.tagName.toLowerCase();
      if (tag !== 'td' && tag !== 'th') continue;
      const cellStyle = parseStyle(cellEl.getAttribute('style'));
      const cellHasBorder = tableHasBorder || /1px\s+solid/i.test(cellStyle.border || '');
      let cellCtx = ctx.withPara(paraPatchFromStyle(cellStyle));
      if (tag === 'th') cellCtx = cellCtx.withPara({ bold: true });
      const widthPx = parsePx(cellStyle, 'width');
      const span = Number(cellEl.getAttribute('colspan'));
      cells.push(new TableCell({
        children: tableCellBlocks(cellEl, cellCtx),
        borders: cellHasBorder ? SOLID_CELL_BORDERS : NO_CELL_BORDERS,
        width: widthPx ? { size: Math.round(widthPx * 15), type: WidthType.DXA } : undefined,
        columnSpan: span && span > 1 ? span : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
      }));
    }
    if (cells.length) rows.push(new TableRow({ children: cells }));
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableHasBorder ? SOLID_CELL_BORDERS : NO_CELL_BORDERS,
  });
}

function handleBlockEl(el: Element, tag: string, ctx: Ctx2, out: Block[]): void {
  const style = parseStyle(el.getAttribute('style'));
  const align = mapAlign(style['text-align']);
  const color = normalizeColor(style.color);

  if (tag === 'hr') {
    out.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
      spacing: { before: 160, after: 160 },
    }));
    return;
  }
  if (tag === 'ul' || tag === 'ol') {
    out.push(...listBlock(el, align ? ctx.withPara({ alignment: align }) : ctx, 0));
    return;
  }
  if (tag === 'table') {
    out.push(tableBlock(el, ctx));
    return;
  }
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const { size, spacingBefore, spacingAfter } = heading(level);
    const runs = Array.from(el.childNodes).flatMap((n) => collectRuns(n, { ...ctx.run, bold: true, size, color }, ctx.imageSizes));
    if (runs.length) {
      out.push(new Paragraph({
        children: runs,
        alignment: align,
        spacing: { before: spacingBefore, after: spacingAfter },
      }));
    }
    return;
  }
  if (tag === 'blockquote') {
    const nextCtx = ctx.withPara({ indentLeft: 480, italics: true, color: color || '555555' });
    if (hasBlockChild(el)) {
      walkChildren(el, nextCtx, out);
    } else {
      const p = paragraphFromInline(Array.from(el.childNodes), nextCtx, { indent: { left: 480 } });
      if (p) out.push(p);
    }
    return;
  }
  if (tag === 'pre') {
    const text = el.textContent || '';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const runs: InlineRun[] = [];
    lines.forEach((line, i) => {
      if (i > 0) runs.push(new TextRun({ text: '', break: 1 }));
      runs.push(makeTextRun(line, { ...ctx.run, font: 'Courier New' }));
    });
    out.push(new Paragraph({ children: runs, spacing: { after: 120 } }));
    return;
  }
  if (tag === 'div') {
    const nextCtx = ctx.withPara(paraPatchFromStyle(style));
    if (hasBlockChild(el)) {
      walkChildren(el, nextCtx, out);
    } else {
      const p = paragraphFromInline(Array.from(el.childNodes), nextCtx);
      if (p) out.push(p);
    }
    return;
  }
  // 'p' et défaut
  const nextCtx = ctx.withPara(paraPatchFromStyle(style));
  const p = paragraphFromInline(Array.from(el.childNodes), nextCtx);
  if (p) out.push(p);
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));
}

function walkChildren(parent: ParentNode, ctx: Ctx2, out: Block[]): void {
  let inlineBuffer: ChildNode[] = [];
  const flushInline = () => {
    if (inlineBuffer.length === 0) return;
    const buf = inlineBuffer;
    inlineBuffer = [];
    const p = paragraphFromInline(buf, ctx);
    if (p) out.push(p);
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!(child.textContent || '').trim()) continue;
      inlineBuffer.push(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (!BLOCK_TAGS.has(tag)) {
      inlineBuffer.push(el);
      continue;
    }
    flushInline();
    handleBlockEl(el, tag, ctx, out);
  }
  flushInline();
}

/** Convertit un fragment HTML en blocs OOXML réels (paragraphes/tableaux). */
export function htmlToDocxBlocks(html: string, opts: HtmlToDocxOptions = {}): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root: RunCtx = { font: opts.defaultFont, size: opts.defaultSizeHalfPt };
  const ctx = new Ctx2(root, {}, opts.imageSizes || new Map());
  const out: Block[] = [];
  walkChildren(doc.body, ctx, out);
  return out;
}

/**
 * Pré-résout, avant conversion, la taille naturelle (px) des images `data:`
 * référencées dans le HTML — nécessaire pour dimensionner l'`ImageRun` OOXML,
 * que `docx` ne peut pas déduire seul d'un simple flux d'octets.
 */
export async function collectImageSizes(html: string): Promise<Map<string, ImageSize>> {
  const map = new Map<string, ImageSize>();
  if (typeof document === 'undefined' || typeof Image === 'undefined') return map;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const srcs = Array.from(doc.querySelectorAll('img[src]'))
    .map((img) => img.getAttribute('src') || '')
    .filter((src, i, arr) => src && arr.indexOf(src) === i);
  await Promise.all(srcs.map((src) => new Promise<void>((resolve) => {
    const im = new Image();
    im.onload = () => { map.set(src, { width: im.naturalWidth || 200, height: im.naturalHeight || 60 }); resolve(); };
    im.onerror = () => resolve();
    im.src = src;
  })));
  return map;
}

export interface BuildDocxOptions extends HtmlToDocxOptions {
  pageMargins?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Fragment HTML posé en en-tête de page Word (répété sur chaque page). */
  headerHtml?: string;
  /** Fragment HTML posé en pied de page Word (coordonnées du parquet…). */
  footerHtml?: string;
}

/**
 * Construit directement le `Blob` .docx final à partir d'un fragment HTML.
 * Point d'entrée unique pour les appelants (`acteExport.ts`, `richTextExport.ts`) :
 * `docx` (Document/Packer) n'est importé qu'ici, pour éviter qu'un module
 * bundlé deux fois (import statique ici + import dynamique ailleurs) ne fasse
 * échouer les vérifications `instanceof` internes de la lib et ne corrompe le
 * XML généré.
 */
export async function buildDocxBlob(html: string, opts: BuildDocxOptions = {}): Promise<Blob> {
  // Les images éventuelles de l'en-tête/pied doivent aussi être pré-mesurées :
  // on résout les tailles sur l'ensemble (corps + chrome).
  const imageSizes = opts.imageSizes
    || await collectImageSizes([html, opts.headerHtml, opts.footerHtml].filter(Boolean).join('\n'));
  const conv = { defaultFont: opts.defaultFont, defaultSizeHalfPt: opts.defaultSizeHalfPt, imageSizes };
  const children = htmlToDocxBlocks(html, conv);
  const headerBlocks = opts.headerHtml ? htmlToDocxBlocks(opts.headerHtml, conv) : null;
  const footerBlocks = opts.footerHtml ? htmlToDocxBlocks(opts.footerHtml, conv) : null;
  const doc = new Document({
    // Réglages par défaut du document (docDefaults) : la police et la taille
    // demandées deviennent le socle hérité par TOUS les runs/paragraphes, y
    // compris ceux des cellules et des listes, sans avoir à les repositionner
    // partout. L'interligne fin (240) reste la base ; le corps justifié le
    // passe à 1,5 au niveau du paragraphe (cf. paragraphFromInline).
    styles: {
      default: {
        document: {
          run: { font: opts.defaultFont, size: opts.defaultSizeHalfPt },
          paragraph: { spacing: { after: 120, line: 240, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [{
      properties: opts.pageMargins ? { page: { margin: opts.pageMargins } } : undefined,
      headers: headerBlocks ? { default: new Header({ children: headerBlocks }) } : undefined,
      footers: footerBlocks ? { default: new Footer({ children: footerBlocks }) } : undefined,
      children,
    }],
  });
  return Packer.toBlob(doc);
}
