/**
 * SIRAL — moteur de « trames de forme » au format OpenDocument (.odt).
 *
 * Jumeau de `trameFill.ts` pour les magistrats qui travaillent sous
 * LibreOffice/OpenOffice : mêmes balises, mêmes garanties. On ouvre le .odt de
 * l'utilisateur, on remplit les balises avec le texte de l'acte, on ressort un
 * .odt strictement identique à sa trame — logo, en-tête, police, pied de page,
 * styles : rien n'est reconstruit. Le corps injecté hérite du style du
 * paragraphe qui portait {{CORPS}}.
 *
 * Repères ODF utiles à la lecture du code :
 *   - le texte vit dans `content.xml`, sous `<office:body><office:text>` ;
 *   - un paragraphe est un `<text:p>` (ou un `<text:h>` pour un titre) ;
 *   - les espaces multiples, tabulations et sauts de ligne sont des ÉLÉMENTS
 *     (`<text:s/>`, `<text:tab/>`, `<text:line-break/>`) et non des caractères ;
 *   - la mise en forme est portée par des styles nommés (`text:style-name`),
 *     déclarés soit dans `content.xml` (styles « automatiques », propres au
 *     document), soit dans `styles.xml` (styles nommés, en-têtes, pieds de
 *     page, mise en page) ;
 *   - le gras/italique d'un fragment passe par un `<text:span>` dont le style
 *     n'ajoute QUE cette propriété : tout le reste (police, corps, couleur)
 *     continue d'être hérité du paragraphe.
 *
 * Limite connue et assumée : une balise que l'utilisateur aurait coupée en
 * deux fragments de styles différents (rarissime sous LibreOffice, qui ne
 * scinde pas le texte saisi d'un trait comme le fait Word) n'est pas
 * reconstituée. Le contrôle à l'import prévient alors qu'aucune balise n'a été
 * trouvée.
 */

import PizZip from 'pizzip';
import { TRAME_TOKENS } from './trameModele';
import type { ParaInfo, PlanAction, TrameVars } from './trameModele';
import type { TrameOp, TrameOpResult } from './trameOps';
import { zipVersBase64, zipVersArrayBuffer } from './zipSortie';

export const ODT_MIME = 'application/vnd.oasis.opendocument.text';

const CM_TO_IN = 1 / 2.54;

// ── XML : utilitaires ────────────────────────────────────────────────────────

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`));
  return m ? unescXml(m[1]) : '';
}

/** Pose/remplace un attribut dans une balise ouvrante (ou auto-fermante). */
function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\s${name.replace(':', '\\:')}=")[^"]*(")`);
  if (re.test(tag)) return tag.replace(re, `$1${escXml(value)}$2`);
  return tag.replace(/\/?>$/, (end) => ` ${name}="${escXml(value)}"${end}`);
}

function zipOf(base64: string): PizZip {
  return new PizZip(base64, { base64: true });
}

function readEntry(zip: PizZip, name: string): string {
  return zip.file(name)?.asText() || '';
}

// ── Paragraphes : découpage en fragments ─────────────────────────────────────

/**
 * Plages [début, fin) des paragraphes de PREMIER NIVEAU. Un `<text:p>` niché
 * dans un cadre ou une zone de texte ancrée au caractère appartient à son
 * paragraphe parent : le compteur de profondeur évite de couper celui-ci au
 * mauvais endroit.
 */
function paraRanges(xml: string): Array<[number, number]> {
  const re = /<text:(?:p|h)\b[^>]*?(\/?)>|<\/text:(?:p|h)>/g;
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) {
      if (depth > 0) { depth -= 1; if (depth === 0) out.push([start, re.lastIndex]); }
      continue;
    }
    if (m[1] === '/') { if (depth === 0) out.push([m.index, re.lastIndex]); continue; }
    if (depth === 0) start = m.index;
    depth += 1;
  }
  return out;
}

/** Les paragraphes de premier niveau, dans l'ordre du document. */
function listParas(xml: string): string[] {
  return paraRanges(xml).map(([a, b]) => xml.slice(a, b));
}

/** Réécrit chaque paragraphe de premier niveau par `fn` (le reste est intact). */
function mapParas(xml: string, fn: (p: string, i: number) => string): string {
  const ranges = paraRanges(xml);
  let out = '';
  let cur = 0;
  ranges.forEach(([a, b], i) => {
    out += xml.slice(cur, a) + fn(xml.slice(a, b), i);
    cur = b;
  });
  return out + xml.slice(cur);
}

/** Le texte porté par une balise « blanche » d'ODF, s'il y en a un. */
function tagText(tag: string): string | null {
  if (/^<text:s\b/.test(tag)) return ' '.repeat(Math.max(1, parseInt(attr(tag, 'text:c') || '1', 10) || 1));
  if (/^<text:tab\b/.test(tag)) return '\t';
  if (/^<text:line-break\b/.test(tag)) return '\n';
  return null;
}

/** Contenu d'un paragraphe, découpé en segments texte / balises. */
function segments(inner: string): string[] {
  return inner.split(/(<[^>]*>)/).filter((s) => s !== '');
}

/** Texte lisible d'un paragraphe ODF (`<text:p …>…</text:p>`). */
function odtParaText(pXml: string): string {
  if (/\/>$/.test(pXml) && !/<\/text:(?:p|h)>$/.test(pXml)) return '';
  const inner = pXml.replace(/^<text:(?:p|h)\b[^>]*>/, '').replace(/<\/text:(?:p|h)>$/, '');
  let out = '';
  for (const seg of segments(inner)) {
    if (seg[0] === '<') { const t = tagText(seg); if (t) out += t; continue; }
    out += unescXml(seg);
  }
  return out;
}

// ── Styles : table de résolution (gras, italique, alignement) ────────────────

interface StyleInfo { parent?: string; align?: string; gras?: boolean; italique?: boolean }

const STYLE_RE = /<style:style\b[^>]*\/>|<style:style\b[^>]*>[\s\S]*?<\/style:style>/g;

function tableStyles(...xmls: string[]): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  for (const xml of xmls) {
    for (const el of xml.match(STYLE_RE) || []) {
      const open = el.match(/^<style:style\b[^>]*?\/?>/)?.[0] || '';
      const nom = attr(open, 'style:name');
      if (!nom) continue;
      map.set(nom, {
        parent: attr(open, 'style:parent-style-name') || undefined,
        align: (el.match(/\sfo:text-align="([^"]*)"/) || [])[1],
        gras: /\sfo:font-weight="(?:bold|[6-9]00)"/.test(el),
        italique: /\sfo:font-style="italic"/.test(el),
      });
    }
  }
  return map;
}

function resolve(map: Map<string, StyleInfo>, nom: string, champ: 'align' | 'gras' | 'italique'): string | boolean | undefined {
  let cur: string | undefined = nom;
  for (let i = 0; cur && i < 6; i += 1) {
    const s: StyleInfo | undefined = map.get(cur);
    if (!s) return undefined;
    const v = s[champ];
    if (v !== undefined && v !== false) return v;
    cur = s.parent;
  }
  return undefined;
}

// ── Lecture des paragraphes ──────────────────────────────────────────────────

/** Plages [début, fin) occupées par les tableaux. */
function tableRanges(xml: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /<table:table\b[^>]*>|<\/table:table>/g;
  let depth = 0;
  let start = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(xml))) {
    if (m[0][1] !== '/') { if (depth === 0) start = m.index; depth += 1; }
    else if (depth > 0) { depth -= 1; if (depth === 0) out.push([start, re.lastIndex]); }
  }
  return out;
}

/** Corps du document (`<office:text>`), avec son décalage dans content.xml. */
function corpsDoc(content: string): { texte: string; debut: number } {
  const m = content.match(/<office:text\b[^>]*>([\s\S]*)<\/office:text>/);
  if (!m) return { texte: '', debut: 0 };
  return { texte: m[1], debut: (m.index || 0) + m[0].indexOf(m[1]) };
}

/** Les paragraphes du corps d'un .odt, avec ce qu'il faut pour les classer. */
export function odtParagraphes(odtBase64: string): ParaInfo[] {
  let content = '';
  let styles = '';
  try {
    const zip = zipOf(odtBase64);
    content = readEntry(zip, 'content.xml');
    styles = readEntry(zip, 'styles.xml');
  } catch { return []; }
  const { texte: corps } = corpsDoc(content);
  if (!corps) return [];
  const st = tableStyles(content, styles);
  const tables = tableRanges(corps);
  const out: ParaInfo[] = [];
  paraRanges(corps).forEach(([debut, fin], index) => {
    const p = corps.slice(debut, fin);
    const open = p.match(/^<text:(?:p|h)\b[^>]*?\/?>/)?.[0] || '';
    const styleP = attr(open, 'text:style-name');
    const spans = (p.match(/<text:span\b[^>]*>/g) || []).map((s) => attr(s, 'text:style-name'));
    const align = String(resolve(st, styleP, 'align') || '');
    out.push({
      index,
      texte: odtParaText(p),
      gras: Boolean(resolve(st, styleP, 'gras')) || spans.some((s) => Boolean(resolve(st, s, 'gras'))),
      italique: Boolean(resolve(st, styleP, 'italique')) || spans.some((s) => Boolean(resolve(st, s, 'italique'))),
      centre: align === 'center',
      droite: align === 'end' || align === 'right',
      tableau: tables.some(([a, b]) => debut >= a && debut < b),
      protege: /<draw:frame\b|<draw:image\b|<office:annotation\b/.test(p),
    });
  });
  return out;
}

// ── Écriture : plan d'actions paragraphe par paragraphe ──────────────────────

/**
 * Réécrit UN paragraphe : garde les `garde` premiers caractères (avec leur
 * mise en forme d'origine), pose `suffixe` juste après, efface le reste. Les
 * balises de structure (`<text:span>`…) sont conservées : seul le texte bouge.
 */
function odtRemplacerTexte(pXml: string, garde: number, suffixe: string): string {
  const auto = /\/>$/.test(pXml) && !/<\/text:(?:p|h)>$/.test(pXml);
  const open = pXml.match(/^<text:(?:p|h)\b[^>]*?\/?>/)?.[0] || '<text:p>';
  const nom = (open.match(/^<text:(p|h)\b/) || [])[1] || 'p';
  if (auto) {
    return `${open.replace(/\/>$/, '>')}${escXml(suffixe)}</text:${nom}>`;
  }
  const inner = pXml.replace(/^<text:(?:p|h)\b[^>]*>/, '').replace(/<\/text:(?:p|h)>$/, '');
  let vus = 0;
  let pose = false;
  const out: string[] = [];
  for (const seg of segments(inner)) {
    if (seg[0] === '<') {
      const t = tagText(seg);
      if (t == null) { out.push(seg); continue; } // balise de structure : conservée
      if (pose) continue;                          // espace/tab résiduel : retiré
      if (garde > 0 && vus + t.length <= garde) { vus += t.length; out.push(seg); continue; }
      pose = true;
      out.push(escXml(suffixe));
      continue;
    }
    const t = unescXml(seg);
    if (pose) continue;
    if (garde > 0 && vus + t.length <= garde) { vus += t.length; out.push(seg); continue; }
    pose = true;
    out.push(escXml(t.slice(0, Math.max(0, garde - vus)) + suffixe));
    vus += t.length;
  }
  if (!pose) out.push(escXml(suffixe));
  return `${open}${out.join('')}</text:${nom}>`;
}

/** Applique un plan (une action par paragraphe, même ordre) à un .odt base64. */
export function odtAppliquerPlan(odtBase64: string, plan: PlanAction[]): string {
  const zip = zipOf(odtBase64);
  const content = readEntry(zip, 'content.xml');
  const { texte: corps, debut } = corpsDoc(content);
  if (!corps) throw new Error('trame invalide : corps du document introuvable');
  const nouveauCorps = mapParas(corps, (p, index) => {
    const a = plan[index];
    if (!a || a.action === 'garder') return p;
    if (a.action === 'supprimer') {
      return /<draw:frame\b|<draw:image\b/.test(p) ? p : '';
    }
    return odtRemplacerTexte(p, Math.max(0, a.garde || 0), a.suffixe || '');
  });
  zip.file('content.xml', content.slice(0, debut) + nouveauCorps + content.slice(debut + corps.length));
  return zipVersBase64(zip);
}

// ── Styles de fragment (gras / italique / souligné) pour le corps injecté ────

const STYLES_FRAGMENT: Record<string, string> = {
  SiralGras: 'fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"',
  SiralItal: 'fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"',
  SiralSoul: 'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"',
};

/** Déclare, si besoin, les styles de fragment utilisés par le corps injecté. */
function assurerStylesFragment(content: string): string {
  const manquants = Object.entries(STYLES_FRAGMENT)
    .filter(([nom]) => !new RegExp(`style:name="${nom}"`).test(content))
    .map(([nom, props]) => `<style:style style:name="${nom}" style:family="text"><style:text-properties ${props}/></style:style>`)
    .join('');
  if (!manquants) return content;
  if (content.includes('</office:automatic-styles>')) {
    return content.replace('</office:automatic-styles>', `${manquants}</office:automatic-styles>`);
  }
  return content.replace(/(<office:body\b)/, `<office:automatic-styles>${manquants}</office:automatic-styles>$1`);
}

/** Un fragment de texte, éventuellement gras / italique / souligné. */
function span(texte: string, opt: { b?: boolean; i?: boolean; u?: boolean }): string {
  let out = escXml(texte);
  if (opt.u) out = `<text:span text:style-name="SiralSoul">${out}</text:span>`;
  if (opt.b) out = `<text:span text:style-name="SiralGras">${out}</text:span>`;
  if (opt.i) out = `<text:span text:style-name="SiralItal">${out}</text:span>`;
  return out;
}

/** Découpe une ligne en fragments, en interprétant **gras** et __souligné__. */
function inlineSpans(texte: string, force: { b?: boolean; i?: boolean }): string {
  const parts: { t: string; b?: boolean; u?: boolean }[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(texte))) {
    if (m.index > last) parts.push({ t: texte.slice(last, m.index) });
    if (m[1] != null) parts.push({ t: m[1], b: true });
    else parts.push({ t: m[2], u: true });
    last = re.lastIndex;
  }
  if (last < texte.length) parts.push({ t: texte.slice(last) });
  if (!parts.length) parts.push({ t: texte });
  return parts.map((p) => span(p.t, { b: p.b || force.b, i: force.i, u: p.u })).join('');
}

/** Corps (markdown léger) → paragraphes ODF clonant le style de la balise. */
function corpsToParas(corps: string, styleName: string): string {
  const st = styleName ? ` text:style-name="${escXml(styleName)}"` : '';
  const vide = `<text:p${st}/>`;
  const out: string[] = [];
  for (const raw of String(corps || '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = raw.trim();
    if (!t) { out.push(vide); continue; }
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    if (h) { out.push(`<text:p${st}>${inlineSpans(h[2], { b: true })}</text:p>`); continue; }
    const b = t.match(/^[-*•]\s+(.+)$/);
    if (b) { out.push(`<text:p${st}>•<text:s text:c="2"/>${inlineSpans(b[1], {})}</text:p>`); continue; }
    out.push(`<text:p${st}>${inlineSpans(t, { i: /^Vu\b/i.test(t) })}</text:p>`);
  }
  return out.join('') || vide;
}

/** Signature (multi-lignes) → un paragraphe par ligne, même style que la balise. */
function signatureToParas(sig: string, styleName: string): string {
  const st = styleName ? ` text:style-name="${escXml(styleName)}"` : '';
  const lignes = String(sig || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lignes.length) return `<text:p${st}/>`;
  return lignes.map((l) => `<text:p${st}>${inlineSpans(l.trim(), {})}</text:p>`).join('');
}

// ── Remplissage des balises ──────────────────────────────────────────────────

/** Refusionne les fragments consécutifs de même style (balise coupée en deux). */
function repairSpans(xml: string): string {
  const pair = /<text:span text:style-name="([^"]*)">([^<]*)<\/text:span><text:span text:style-name="\1">([^<]*)<\/text:span>/;
  let prev = '';
  let out = xml;
  while (prev !== out) {
    prev = out;
    out = out.replace(pair, (_m, s, a, b) => `<text:span text:style-name="${s}">${a}${b}</text:span>`);
  }
  return out;
}

/** Remplace le paragraphe dont le texte vaut exactement `{{NOM}}` par du XML généré. */
function replaceParaToken(corps: string, nom: string, gen: (styleName: string) => string): string {
  const token = `{{${nom}}}`;
  return mapParas(corps, (p) => {
    if (odtParaText(p).trim() !== token) return p;
    const open = p.match(/^<text:(?:p|h)\b[^>]*?\/?>/)?.[0] || '';
    return gen(attr(open, 'text:style-name'));
  });
}

/**
 * Remplit une trame de forme (.odt base64) avec les variables d'un acte et
 * retourne le Blob .odt final.
 */
export async function fillTrameOdt(odtBase64: string, vars: TrameVars): Promise<Blob> {
  const zip = zipOf(odtBase64);
  let content = readEntry(zip, 'content.xml');
  if (!content) throw new Error('trame invalide : content.xml absent');
  content = assurerStylesFragment(repairSpans(content));

  const { texte: avant, debut } = corpsDoc(content);
  if (!avant) throw new Error('trame invalide : corps du document introuvable');
  let corps = avant;

  if (vars.corps != null) corps = replaceParaToken(corps, 'CORPS', (st) => corpsToParas(vars.corps || '', st));
  if (vars.titre != null) {
    corps = replaceParaToken(corps, 'TITRE', (st) => (
      `<text:p${st ? ` text:style-name="${escXml(st)}"` : ''}>${inlineSpans(vars.titre || '', {})}</text:p>`
    ));
  }
  if (vars.signature != null) corps = replaceParaToken(corps, 'SIGNATURE', (st) => signatureToParas(vars.signature || '', st));

  for (const [nom, valeur] of [['DESTINATAIRE', vars.destinataire], ['OBJET', vars.objet], ['DATE', vars.date]] as const) {
    if (valeur == null) continue;
    corps = corps.split(`{{${nom}}}`).join(escXml(valeur));
  }

  content = content.slice(0, debut) + corps + content.slice(debut + avant.length);
  zip.file('content.xml', content);
  return new Blob([zipVersArrayBuffer(zip)], { type: ODT_MIME });
}

/** Liste des balises reconnues présentes dans le .odt (base64). */
export function listOdtTokens(odtBase64: string): string[] {
  try {
    const content = repairSpans(readEntry(zipOf(odtBase64), 'content.xml'));
    return TRAME_TOKENS.filter((tk) => content.includes(`{{${tk}}}`));
  } catch {
    return [];
  }
}

// ── Édition assistée (mêmes opérations que `trameOps` côté Word) ─────────────

/** Longueur ODF (« 4.5cm », « 1.2in »…) convertie en centimètres. */
function toCm(v: string): number | null {
  const m = String(v).match(/^(-?\d+(?:\.\d+)?)(cm|mm|in|pt|pc)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'mm': return n / 10;
    case 'in': return n / CM_TO_IN;
    case 'pt': return (n / 72) / CM_TO_IN;
    case 'pc': return (n / 6) / CM_TO_IN;
    default: return n;
  }
}

function opPolice(zip: PizZip, police: string, res: TrameOpResult): void {
  const esc = police.replace(/"/g, '');
  for (const nom of ['content.xml', 'styles.xml']) {
    const xml = readEntry(zip, nom);
    if (!xml) continue;
    zip.file(nom, xml
      .replace(/style:font-name(?:-asian|-complex)?="[^"]*"/g, (m) => m.replace(/="[^"]*"/, `="${esc}"`))
      .replace(/fo:font-family(?:-asian|-complex)?="[^"]*"/g, (m) => m.replace(/="[^"]*"/, `="${esc}"`)));
  }
  res.applied.push(`police du document → ${esc}`);
}

function opTaille(zip: PizZip, pt: number, res: TrameOpResult): void {
  for (const nom of ['content.xml', 'styles.xml']) {
    const xml = readEntry(zip, nom);
    if (!xml) continue;
    zip.file(nom, xml.replace(/fo:font-size(?:-asian|-complex)?="[\d.]+pt"/g, (m) => m.replace(/="[\d.]+pt"/, `="${pt}pt"`)));
  }
  res.applied.push(`taille du document → ${pt} pt`);
}

function opMarges(zip: PizZip, op: { cm?: number; haut?: number; bas?: number; gauche?: number; droite?: number }, res: TrameOpResult): void {
  const xml = readEntry(zip, 'styles.xml');
  if (!xml) { res.warnings.push('marges introuvables'); return; }
  const cotes: Array<[string, number | undefined]> = [
    ['fo:margin-top', op.haut ?? op.cm],
    ['fo:margin-bottom', op.bas ?? op.cm],
    ['fo:margin-left', op.gauche ?? op.cm],
    ['fo:margin-right', op.droite ?? op.cm],
  ];
  let n = 0;
  const out = xml.replace(/<style:page-layout-properties\b[^>]*\/?>/g, (tag) => {
    n += 1;
    let t = tag;
    for (const [nom, v] of cotes) if (v != null) t = setAttr(t, nom, `${v}cm`);
    return t;
  });
  if (n) { zip.file('styles.xml', out); res.applied.push('marges ajustées'); }
  else res.warnings.push('marges introuvables');
}

function opLogo(zip: PizZip, op: { facteur?: number; largeurCm?: number }, res: TrameOpResult): void {
  let done = false;
  for (const nom of ['content.xml', 'styles.xml']) {
    const xml = readEntry(zip, nom);
    if (!xml) continue;
    const out = xml.replace(/<draw:frame\b[^>]*>/g, (tag) => {
      const l = toCm(attr(tag, 'svg:width'));
      const h = toCm(attr(tag, 'svg:height'));
      if (l == null || h == null || !l || !h) return tag;
      const f = op.largeurCm ? op.largeurCm / l : (op.facteur ?? 1);
      done = true;
      return setAttr(setAttr(tag, 'svg:width', `${(l * f).toFixed(3)}cm`), 'svg:height', `${(h * f).toFixed(3)}cm`);
    });
    if (out !== xml) zip.file(nom, out);
  }
  if (done) res.applied.push(op.largeurCm ? `logo → largeur ${op.largeurCm} cm` : `logo → ×${op.facteur}`);
  else res.warnings.push('aucun logo trouvé à redimensionner');
}

/**
 * Style dédié au paragraphe {{CORPS}} : on clone son style automatique (ou on
 * en crée un qui hérite du style nommé), on y pose les propriétés demandées et
 * on réaffecte le paragraphe. Le reste du document n'est pas touché.
 */
function patchStyleCorps(content: string, props: { para?: Record<string, string>; texte?: Record<string, string> }): { content: string; ok: boolean } {
  const NOM = 'SiralCorps';
  const { texte: corps } = corpsDoc(content);
  if (!corps) return { content, ok: false };

  // 1) Le style porté aujourd'hui par le paragraphe {{CORPS}}.
  let styleActuel: string | null = null;
  for (const p of listParas(corps)) {
    if (odtParaText(p).trim() !== '{{CORPS}}') continue;
    styleActuel = attr(p.match(/^<text:(?:p|h)\b[^>]*?\/?>/)?.[0] || '', 'text:style-name');
    break;
  }
  if (styleActuel == null) return { content, ok: false };

  // 2) Style cible : le nôtre s'il existe déjà, sinon un clone du style actuel
  //    (ou, si celui-ci est un style nommé de styles.xml, un style qui en hérite).
  const nomStyle = (el: string) => attr(el.match(/^<style:style\b[^>]*?\/?>/)?.[0] || '', 'style:name');
  const styles = content.match(STYLE_RE) || [];
  const dejaNotre = styleActuel === NOM;
  const modele = styles.find((el) => nomStyle(el) === (dejaNotre ? NOM : styleActuel));
  let cible = modele
    ? modele.replace(/^<style:style\b[^>]*?\/?>/, (t) => setAttr(t, 'style:name', NOM))
    : `<style:style style:name="${NOM}" style:family="paragraph"${styleActuel ? ` style:parent-style-name="${escXml(styleActuel)}"` : ''}/>`;
  // Un élément auto-fermant doit s'ouvrir pour accueillir ses propriétés.
  if (/^<style:style\b[^>]*\/>$/.test(cible)) cible = cible.replace(/\/>$/, '></style:style>');

  // 3) Pose des propriétés (l'ordre du schéma ODF veut paragraph avant text).
  const poser = (el: string, tag: string, map?: Record<string, string>, enTete = false): string => {
    if (!map || !Object.keys(map).length) return el;
    const re = new RegExp(`<${tag}\\b[^>]*\\/?>`);
    if (re.test(el)) {
      return el.replace(re, (t) => Object.entries(map).reduce((acc, [k, v]) => setAttr(acc, k, v), t));
    }
    const decl = `<${tag} ${Object.entries(map).map(([k, v]) => `${k}="${escXml(v)}"`).join(' ')}/>`;
    return enTete
      ? el.replace(/^<style:style\b[^>]*?>/, (t) => `${t}${decl}`)
      : el.replace(/<\/style:style>$/, `${decl}</style:style>`);
  };
  cible = poser(cible, 'style:paragraph-properties', props.para, true);
  cible = poser(cible, 'style:text-properties', props.texte);

  // 4) Enregistrement du style (remplacement du nôtre, ou ajout).
  let out = content;
  const existant = styles.find((el) => nomStyle(el) === NOM);
  if (existant) out = out.replace(existant, cible);
  else if (out.includes('</office:automatic-styles>')) out = out.replace('</office:automatic-styles>', `${cible}</office:automatic-styles>`);
  else out = out.replace(/(<office:body\b)/, `<office:automatic-styles>${cible}</office:automatic-styles>$1`);

  // 5) Réaffectation du paragraphe {{CORPS}} au style patché.
  if (!dejaNotre) {
    const { texte: c2, debut: d2 } = corpsDoc(out);
    const maj = mapParas(c2, (p) => (
      odtParaText(p).trim() === '{{CORPS}}'
        ? p.replace(/^<text:(?:p|h)\b[^>]*?\/?>/, (t) => setAttr(t, 'text:style-name', NOM))
        : p
    ));
    out = out.slice(0, d2) + maj + out.slice(d2 + c2.length);
  }
  return { content: out, ok: true };
}

function editCorps(zip: PizZip, props: { para?: Record<string, string>; texte?: Record<string, string> }, res: TrameOpResult, label: string): void {
  const content = readEntry(zip, 'content.xml');
  const r = patchStyleCorps(content, props);
  if (!r.ok) { res.warnings.push(`balise {{CORPS}} introuvable — ${label} sans effet`); return; }
  zip.file('content.xml', r.content);
  res.applied.push(label);
}

function opInsererBalise(zip: PizZip, nom: string, apres: string, res: TrameOpResult): void {
  const content = readEntry(zip, 'content.xml');
  if (content.includes(`{{${nom}}}`)) { res.warnings.push(`{{${nom}}} déjà présente`); return; }
  const { texte: corps, debut } = corpsDoc(content);
  let pose = false;
  const maj = mapParas(corps, (p) => {
    if (pose || !odtParaText(p).includes(apres)) return p;
    pose = true;
    return odtRemplacerTexte(p, odtParaText(p).length, ` {{${nom}}}`);
  });
  if (!pose) { res.warnings.push(`ancre « ${apres} » introuvable pour insérer {{${nom}}}`); return; }
  zip.file('content.xml', content.slice(0, debut) + maj + content.slice(debut + corps.length));
  res.applied.push(`balise {{${nom}}} insérée après « ${apres} »`);
}

function opRetirerBalise(zip: PizZip, nom: string, res: TrameOpResult): void {
  const content = readEntry(zip, 'content.xml');
  if (!content.includes(`{{${nom}}}`)) { res.warnings.push(`{{${nom}}} absente`); return; }
  zip.file('content.xml', content.split(`{{${nom}}}`).join(''));
  res.applied.push(`balise {{${nom}}} retirée`);
}

/** Balisage automatique : pose {{OBJET}} et {{CORPS}} là où on les reconnaît. */
function opBaliserAuto(zip: PizZip, res: TrameOpResult): void {
  const content = readEntry(zip, 'content.xml');
  const { texte: corps, debut } = corpsDoc(content);
  if (!corps) { res.warnings.push('balisage auto : corps introuvable'); return; }
  let objet = content.includes('{{OBJET}}');
  let body = content.includes('{{CORPS}}');
  const maj = mapParas(corps, (p) => {
    const t = odtParaText(p);
    if (!objet && /^\s*objet\s*:/i.test(t)) {
      objet = true;
      return odtRemplacerTexte(p, t.replace(/^(\s*objet\s*:\s*).*$/i, '$1').length, '{{OBJET}}');
    }
    if (!body && (t.trim() === '' || t.trim() === '.')) {
      body = true;
      return odtRemplacerTexte(p, 0, '{{CORPS}}');
    }
    return p;
  });
  if (maj === corps) { res.warnings.push('balisage auto : rien à ajouter'); return; }
  zip.file('content.xml', content.slice(0, debut) + maj + content.slice(debut + corps.length));
  if (objet) res.applied.push('{{OBJET}} posée');
  if (body) res.applied.push('{{CORPS}} posée');
  else res.warnings.push('emplacement du corps non trouvé — placez {{CORPS}} à la main');
}

const ALIGN: Record<string, string> = { gauche: 'start', centre: 'center', droite: 'end', justifie: 'justify' };

/** Applique une liste d'opérations à une trame .odt et retourne le nouveau .odt. */
export function applyOdtOps(odtBase64: string, ops: TrameOp[]): TrameOpResult {
  const zip = zipOf(odtBase64);
  const res: TrameOpResult = { docxBase64: '', applied: [], warnings: [] };

  for (const op of ops) {
    switch (op.kind) {
      case 'police':
        if (op.cible === 'tout') opPolice(zip, op.police, res);
        else editCorps(zip, { texte: { 'style:font-name': op.police, 'fo:font-family': op.police } }, res, `police du corps → ${op.police}`);
        break;
      case 'taille':
        if (op.cible === 'tout') opTaille(zip, op.pt, res);
        else editCorps(zip, { texte: { 'fo:font-size': `${op.pt}pt` } }, res, `taille du corps → ${op.pt} pt`);
        break;
      case 'logo': opLogo(zip, op, res); break;
      case 'marges': opMarges(zip, op, res); break;
      case 'interligne':
        if (op.cible === 'corps') {
          editCorps(zip, { para: { 'fo:line-height': `${Math.round(op.valeur * 100)}%` } }, res, `interligne du corps → ${op.valeur}`);
        } else {
          res.warnings.push('interligne « tout » : appliquez sur le corps ({{CORPS}})');
        }
        break;
      case 'aligner':
        editCorps(zip, { para: { 'fo:text-align': ALIGN[op.alignement] || 'justify' } }, res, `alignement du corps → ${op.alignement}`);
        break;
      case 'inserer_balise': opInsererBalise(zip, op.nom.toUpperCase(), op.apres, res); break;
      case 'retirer_balise': opRetirerBalise(zip, op.nom.toUpperCase(), res); break;
      case 'baliser_auto': opBaliserAuto(zip, res); break;
      default: break;
    }
  }

  res.docxBase64 = zipVersBase64(zip);
  return res;
}
