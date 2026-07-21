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

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type TrameFormeType = 'courrier' | 'requete' | 'soit-transmis' | 'defaut';

export interface TrameForme {
  id: string;
  nom: string;
  type: TrameFormeType;
  /** Le .docx de l'utilisateur, encodé en base64. */
  docxBase64: string;
  updatedAt: string;
}

export interface TrameVars {
  corps?: string;
  titre?: string;
  signature?: string;
  destinataire?: string;
  objet?: string;
  date?: string;
}

export const TRAME_TOKENS = ['CORPS', 'TITRE', 'SIGNATURE', 'DESTINATAIRE', 'OBJET', 'DATE'] as const;

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
  return xml.replace(/<w:p\b[^>]*>.*?<\/w:p>/gs, (p) => {
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
  const ab = zip.generate({ type: 'arraybuffer' }) as ArrayBuffer;
  return new Blob([ab], { type: DOCX_MIME });
}

/** Vrai si le .docx (base64) contient au moins une balise reconnue. */
export function trameHasTokens(docxBase64: string): boolean {
  try {
    const zip = new PizZip(docxBase64, { base64: true });
    const xml = zip.file('word/document.xml')?.asText() || '';
    const flat = repairRuns(xml);
    return TRAME_TOKENS.some((tk) => flat.includes(`{{${tk}}}`));
  } catch {
    return false;
  }
}
