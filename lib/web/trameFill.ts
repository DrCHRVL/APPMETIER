/**
 * SIRAL — moteur de « trames de forme ».
 *
 * Une trame de forme est un document Word (.docx) fourni par le magistrat :
 * SA papeterie (logo, en-tête, police, pied de page…), telle qu'il la veut,
 * dans laquelle il a placé des BALISES là où le contenu de l'acte doit se
 * déverser. À l'export, on ouvre ce .docx, on remplit les balises avec le
 * texte de l'acte, et on ressort le Word — strictement identique à la trame,
 * au contenu près. On ne reconstruit RIEN : la forme est 100 % celle du
 * fichier de l'utilisateur.
 *
 * Balises reconnues (à saisir en texte simple dans le .docx) :
 *   {{CORPS}}        — paragraphe seul : le corps de l'acte se déverse ici, en
 *                      héritant de la police/mise en forme de CE paragraphe
 *                      (visas en italique, puces, gras/souligné conservés).
 *   {{TITRE}}        — paragraphe seul : le titre de l'acte.
 *   {{SIGNATURE}}    — paragraphe seul : le bloc signature (multi-lignes).
 *   {{DESTINATAIRE}} — en ligne : le destinataire (courriers).
 *   {{OBJET}}        — en ligne : l'objet (courriers).
 *   {{DATE}}         — en ligne : la date.
 *
 * Robustesse : Word scinde souvent un mot en plusieurs « runs » (métadonnées
 * de révision), ce qui casserait une balise saisie d'un seul tenant. On
 * refusionne d'abord les runs consécutifs de même formatage, ce qui répare la
 * balise sans toucher aux runs réellement distincts (ex. le label « OBJET »
 * en gras reste séparé de la valeur qui le suit).
 */

import PizZip from 'pizzip';
import { TRAME_TOKENS } from './trameModele';
import { zipVersBase64, zipVersArrayBuffer } from './zipSortie';
import type { ParaInfo, PlanAction, TrameVars } from './trameModele';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Le modèle (types de trame, variables, balises) est commun aux deux formats :
// il vit dans `trameModele.ts`. On le ré-exporte ici, où le reste de
// l'application a l'habitude de le trouver.
export type { TrameFormeType, TrameFormeFormat, TrameForme, TrameVars, ParaInfo, PlanAction } from './trameModele';
export { TRAME_TOKENS, TRAME_TYPES, trameTypes, trameFormat } from './trameModele';

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Réparation des runs scindés ──────────────────────────────────────────────

/**
 * Normalise les balises `<w:r>`/`<w:t>` (on retire les rsid, informatifs) puis
 * fusionne les runs de texte consécutifs partageant EXACTEMENT le même `<w:rPr>`.
 * Une balise `{{CORPS}}` éclatée par Word en `{{COR` + `PS}}` redevient entière ;
 * un label gras suivi d'un texte normal reste, lui, en deux runs distincts.
 */
function repairRuns(xml: string): string {
  let out = xml
    .replace(/<w:r\b[^>]*>/g, '<w:r>')
    .replace(/<w:t\b[^>]*>/g, '<w:t xml:space="preserve">');
  const pair = /<w:r>(<w:rPr>.*?<\/w:rPr>)?<w:t xml:space="preserve">([^<]*)<\/w:t><\/w:r><w:r>(<w:rPr>.*?<\/w:rPr>)?<w:t xml:space="preserve">([^<]*)<\/w:t><\/w:r>/s;
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(pair, (m, rp1, t1, rp2, t2) => (
      (rp1 || '') === (rp2 || '')
        ? `<w:r>${rp1 || ''}<w:t xml:space="preserve">${t1}${t2}</w:t></w:r>`
        : m
    ));
  }
  return out;
}

// ── Génération du corps (markdown léger → paragraphes OOXML) ─────────────────

/** rPr de base + bascules gras/italique/souligné (ajoutées en fin, Word tolère l'ordre). */
function rPrWith(baseRPr: string, opt: { b?: boolean; i?: boolean; u?: boolean }): string {
  const inner = baseRPr ? baseRPr.replace(/^<w:rPr>/, '').replace(/<\/w:rPr>$/, '') : '';
  const cleaned = inner
    .replace(/<w:b\/>/g, '').replace(/<w:i\/>/g, '').replace(/<w:u\b[^>]*\/>/g, '');
  const add = `${opt.b ? '<w:b/>' : ''}${opt.i ? '<w:i/>' : ''}${opt.u ? '<w:u w:val="single"/>' : ''}`;
  return `<w:rPr>${cleaned}${add}</w:rPr>`;
}

/** Découpe une ligne en runs, en interprétant **gras** et __souligné__. */
function inlineRuns(text: string, baseRPr: string, force: { b?: boolean; i?: boolean }): string {
  const parts: { t: string; b?: boolean; u?: boolean }[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index) });
    if (m[1] != null) parts.push({ t: m[1], b: true });
    else parts.push({ t: m[2], u: true });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  if (parts.length === 0) parts.push({ t: text });
  return parts.map((p) => (
    `<w:r>${rPrWith(baseRPr, { b: p.b || force.b, i: force.i, u: p.u })}`
    + `<w:t xml:space="preserve">${escXml(p.t)}</w:t></w:r>`
  )).join('');
}

/** Corps (texte markdown léger) → suite de `<w:p>` clonant pPr/rPr de la balise. */
function corpsToParagraphs(corps: string, basePPr: string, baseRPr: string): string {
  const pPr = basePPr || '';
  const lines = String(corps || '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const emptyPara = () => `<w:p>${pPr}</w:p>`;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { out.push(emptyPara()); continue; }
    const h = t.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      out.push(`<w:p>${pPr}${inlineRuns(h[2], baseRPr, { b: true })}</w:p>`);
      continue;
    }
    const b = t.match(/^[-*•]\s+(.+)$/);
    if (b) {
      const bulletRun = `<w:r>${rPrWith(baseRPr, {})}<w:t xml:space="preserve">•  </w:t></w:r>`;
      out.push(`<w:p>${pPr}${bulletRun}${inlineRuns(b[1], baseRPr, {})}</w:p>`);
      continue;
    }
    const visa = /^Vu\b/i.test(t);
    out.push(`<w:p>${pPr}${inlineRuns(t, baseRPr, { i: visa })}</w:p>`);
  }
  return out.join('') || emptyPara();
}

/** Signature (multi-lignes) → paragraphes clonant la mise en forme de la balise. */
function signatureToParagraphs(sig: string, basePPr: string, baseRPr: string): string {
  const lines = String(sig || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return `<w:p>${basePPr || ''}</w:p>`;
  return lines.map((l) => `<w:p>${basePPr || ''}${inlineRuns(l.trim(), baseRPr, {})}</w:p>`).join('');
}

// ── Remplacement des balises ─────────────────────────────────────────────────

function paraText(pXml: string): string {
  return (pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map((t) => t.replace(/<[^>]+>/g, '')).join('');
}

/** Remplace le paragraphe dont le texte vaut exactement `{{NAME}}` par du XML généré. */
function replaceParaToken(xml: string, name: string, gen: (pPr: string, rPr: string) => string): string {
  const token = `{{${name}}}`;
  return mapParas(xml, (p) => {
    if (paraText(p).trim() !== token) return p;
    const pPr = (p.match(/<w:pPr>.*?<\/w:pPr>/s) || [''])[0];
    const rPr = (p.match(/<w:rPr>.*?<\/w:rPr>/s) || [''])[0];
    return gen(pPr, rPr);
  });
}

/** Remplace une balise en ligne `{{NAME}}` par sa valeur (échappée). */
function replaceInlineToken(xml: string, name: string, value: string | undefined): string {
  if (value == null) return xml;
  return xml.split(`{{${name}}}`).join(escXml(value));
}

/**
 * Remplit une trame de forme (.docx base64) avec les variables d'un acte et
 * retourne le Blob .docx final. Portable navigateur/Node (sortie en Uint8Array
 * enveloppée dans un Blob).
 */
export async function fillTrameDocx(docxBase64: string, vars: TrameVars): Promise<Blob> {
  const zip = new PizZip(docxBase64, { base64: true });
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('trame invalide : word/document.xml absent');
  let xml = docFile.asText();

  xml = repairRuns(xml);

  // Paragraphes complets (générés en clonant la mise en forme de la balise).
  if (vars.corps != null) xml = replaceParaToken(xml, 'CORPS', (pPr, rPr) => corpsToParagraphs(vars.corps || '', pPr, rPr));
  if (vars.titre != null) xml = replaceParaToken(xml, 'TITRE', (pPr, rPr) => `<w:p>${pPr}${inlineRuns(vars.titre || '', rPr, {})}</w:p>`);
  if (vars.signature != null) xml = replaceParaToken(xml, 'SIGNATURE', (pPr, rPr) => signatureToParagraphs(vars.signature || '', pPr, rPr));

  // Balises en ligne.
  xml = replaceInlineToken(xml, 'DESTINATAIRE', vars.destinataire);
  xml = replaceInlineToken(xml, 'OBJET', vars.objet);
  xml = replaceInlineToken(xml, 'DATE', vars.date);

  zip.file('word/document.xml', xml);
  return new Blob([zipVersArrayBuffer(zip)], { type: DOCX_MIME });
}

/** Liste des balises reconnues présentes dans le .docx (base64). */
export function listTrameTokens(docxBase64: string): string[] {
  try {
    const zip = new PizZip(docxBase64, { base64: true });
    const xml = zip.file('word/document.xml')?.asText() || '';
    const flat = repairRuns(xml);
    return TRAME_TOKENS.filter((tk) => flat.includes(`{{${tk}}}`));
  } catch {
    return [];
  }
}

/** Vrai si le .docx (base64) contient au moins une balise reconnue. */
export function trameHasTokens(docxBase64: string): boolean {
  return listTrameTokens(docxBase64).length > 0;
}

// ── Paragraphes du corps : lecture et plan d'écriture (.docx) ────────────────
//
// Ces primitives servent à l'édition ligne à ligne de la trame ET à l'analyse
// d'un acte déjà rédigé (`trameAnalyse.ts`), qui repère les lignes variables
// et les remplace par des balises. Elles voient TOUS les paragraphes du corps
// du document — vides compris, dans l'ordre du fichier — pour que le rang d'un
// paragraphe soit un identifiant stable entre la lecture et l'écriture.
// L'en-tête et le pied de page (fichiers séparés) sont hors champ : par
// construction, c'est de la papeterie qu'on ne touche jamais.

/** Fragments porteurs de texte, dans l'ordre : texte, tabulation, saut de ligne. */
const CHUNK_RE = /<w:t\b[^>]*\/>|<w:t\b[^>]*>[^<]*<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;

/**
 * Plages [début, fin) des paragraphes de PREMIER NIVEAU. Un `<w:p>` imbriqué
 * (zone de texte d'un en-tête, forme dessinée) appartient à son paragraphe
 * parent : le compteur de profondeur évite de le compter deux fois, et surtout
 * de couper le parent au mauvais endroit.
 */
function paraRanges(xml: string): Array<[number, number]> {
  const re = /<w:p\b[^>]*?(\/?)>|<\/w:p>/g;
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

function unescXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Texte porté par un fragment (`<w:t>`, `<w:tab/>`, `<w:br/>`). */
function chunkText(chunk: string): string {
  if (chunk.startsWith('<w:tab')) return '\t';
  if (chunk.startsWith('<w:br')) return '\n';
  const m = chunk.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/);
  return m ? unescXml(m[1]) : '';
}

/** Plages [début, fin) occupées par les tableaux de premier niveau. */
function tableRanges(xml: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /<w:tbl\b[^>]*>|<\/w:tbl>/g;
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

/** Les paragraphes du corps d'un .docx, avec ce qu'il faut pour les classer. */
export function docxParagraphes(docxBase64: string): ParaInfo[] {
  let xml = '';
  try {
    const zip = new PizZip(docxBase64, { base64: true });
    xml = zip.file('word/document.xml')?.asText() || '';
  } catch { return []; }
  const tables = tableRanges(xml);
  const out: ParaInfo[] = [];
  paraRanges(xml).forEach(([debut, fin], index) => {
    const p = xml.slice(debut, fin);
    const texte = (p.match(CHUNK_RE) || []).map(chunkText).join('');
    out.push({
      index,
      texte,
      gras: /<w:b\s*\/>|<w:b\s+w:val="(?:1|true|on)"/.test(p),
      italique: /<w:i\s*\/>|<w:i\s+w:val="(?:1|true|on)"/.test(p),
      centre: /<w:jc\b[^>]*w:val="center"/.test(p),
      droite: /<w:jc\b[^>]*w:val="(?:right|end)"/.test(p),
      tableau: tables.some(([a, b]) => debut >= a && debut < b),
      protege: /<w:drawing\b|<w:pict\b|<w:object\b|<w:sectPr\b/.test(p),
    });
  });
  return out;
}

/**
 * Réécrit UN paragraphe : garde les `garde` premiers caractères (avec leur
 * mise en forme d'origine), pose `suffixe` juste après, efface le reste.
 * Le suffixe atterrit dans le fragment où tombe la coupe — il hérite donc de
 * la police de ce qui précède, ce qui est exactement ce qu'on veut pour une
 * balise posée après un label (« Objet : {{OBJET}} »).
 */
function docxRemplacerTexte(pXml: string, garde: number, suffixe: string): string {
  const estTexte = (chunk: string) => /^<w:t[\s>/]/.test(chunk);
  let vus = 0;
  let pose = false;
  let out = pXml.replace(CHUNK_RE, (chunk) => {
    const t = chunkText(chunk);
    if (pose) return estTexte(chunk) ? '<w:t xml:space="preserve"></w:t>' : '';
    if (garde > 0 && vus + t.length <= garde) {
      vus += t.length;
      return chunk;
    }
    // La coupe tombe dans ce fragment (ou juste avant).
    const conserve = Math.max(0, garde - vus);
    pose = true;
    vus += t.length;
    if (estTexte(chunk)) {
      return `<w:t xml:space="preserve">${escXml(t.slice(0, conserve) + suffixe)}</w:t>`;
    }
    // Tabulation / saut de ligne : on garde le fragment s'il est avant la coupe,
    // et on pose le suffixe dans un run neuf juste après.
    const avant = conserve > 0 ? chunk : '';
    return `${avant}<w:r><w:t xml:space="preserve">${escXml(suffixe)}</w:t></w:r>`;
  });
  if (!pose) {
    // Paragraphe sans texte (ou coupe au-delà de la fin) : on ajoute un run.
    const run = `<w:r><w:t xml:space="preserve">${escXml(suffixe)}</w:t></w:r>`;
    out = /<\/w:p>$/.test(out)
      ? out.replace(/<\/w:p>$/, `${run}</w:p>`)
      : out.replace(/<w:p\b([^>]*)\/>/, `<w:p$1>${run}</w:p>`);
  }
  return out;
}

/** Applique un plan (une action par paragraphe, même ordre) à un .docx base64. */
export function docxAppliquerPlan(docxBase64: string, plan: PlanAction[]): string {
  const zip = new PizZip(docxBase64, { base64: true });
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('trame invalide : word/document.xml absent');
  const xml = mapParas(f.asText(), (p, index) => {
    const a = plan[index];
    if (!a || a.action === 'garder') return p;
    if (a.action === 'supprimer') {
      // Jamais d'image ni de propriétés de section perdues par une suppression.
      return /<w:drawing\b|<w:pict\b|<w:object\b|<w:sectPr\b/.test(p) ? p : '';
    }
    return docxRemplacerTexte(p, Math.max(0, a.garde || 0), a.suffixe || '');
  });
  zip.file('word/document.xml', xml);
  return zipVersBase64(zip);
}
