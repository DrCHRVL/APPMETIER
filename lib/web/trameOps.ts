/**
 * SIRAL — moteur d'ÉDITION des trames de forme (.docx).
 *
 * Applique des opérations SÛRES et déterministes sur le .docx de l'utilisateur
 * (police, taille, logo, marges, interligne, alignement, balises). C'est le
 * socle de l'assistant du module « Trames de forme » : le chat traduit une
 * phrase en une liste d'opérations, ce moteur les applique au fichier. Aucune
 * réécriture « à l'aveugle » du XML : chaque opération est une transformation
 * ciblée et bornée. Tout est local (aucune donnée ne sort de l'application).
 */

import PizZip from 'pizzip';

const CM_TO_TWIPS = 567; // 1 cm ≈ 567 twips
const CM_TO_EMU = 360000; // 1 cm = 360000 EMU

export type TrameOp =
  | { kind: 'police'; cible: 'tout' | 'corps'; police: string }
  | { kind: 'taille'; cible: 'tout' | 'corps'; pt: number }
  | { kind: 'logo'; facteur?: number; largeurCm?: number }
  | { kind: 'marges'; cm?: number; haut?: number; bas?: number; gauche?: number; droite?: number }
  | { kind: 'interligne'; cible: 'tout' | 'corps'; valeur: number }
  | { kind: 'aligner'; cible: 'corps'; alignement: 'gauche' | 'centre' | 'droite' | 'justifie' }
  | { kind: 'inserer_balise'; nom: string; apres: string }
  | { kind: 'retirer_balise'; nom: string }
  | { kind: 'baliser_auto' };

export interface TrameOpResult {
  docxBase64: string;
  /** Journal des opérations réellement appliquées (pour le retour à l'utilisateur). */
  applied: string[];
  /** Avertissements (opération sans effet, ancre introuvable…). */
  warnings: string[];
}

// ── Utilitaires XML ──────────────────────────────────────────────────────────

function paraText(pXml: string): string {
  return (pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
}

/** Applique `fn` au paragraphe dont le texte vaut exactement `{{NAME}}`. Retourne [xml, trouvé]. */
function editTokenPara(xml: string, name: string, fn: (p: string) => string): [string, boolean] {
  let found = false;
  const out = xml.replace(/<w:p\b[^>]*>.*?<\/w:p>/gs, (p) => {
    if (paraText(p).trim() !== `{{${name}}}`) return p;
    found = true;
    return fn(p);
  });
  return [out, found];
}

/** Pose/replace un enfant simple dans le `<w:pPr>` d'un paragraphe (retire l'ancien du même tag). */
function setPPrChild(pXml: string, tag: string, element: string): string {
  const stripped = pXml.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'g'), '');
  if (/<w:pPr>/.test(stripped)) return stripped.replace('<w:pPr>', `<w:pPr>${element}`);
  // pas de pPr : en créer un juste après l'ouverture du paragraphe
  return stripped.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${element}</w:pPr>`);
}

/** Pose/replace rFonts ou sz dans le premier `<w:rPr>` d'un paragraphe. */
function setRunProp(pXml: string, tag: string, element: string): string {
  const cleaned = pXml.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'g'), '');
  if (/<w:rPr>/.test(cleaned)) return cleaned.replace(/<w:rPr>/g, `<w:rPr>${element}`);
  return cleaned;
}

// ── Opérations ───────────────────────────────────────────────────────────────

function opPoliceTout(zip: PizZip, police: string, res: TrameOpResult): void {
  const esc = police.replace(/"/g, '');
  for (const f of zip.file(/word\/(document|header\d+|footer\d+|styles)\.xml/)) {
    let xml = f.asText();
    xml = xml.replace(/w:ascii="[^"]*"/g, `w:ascii="${esc}"`)
      .replace(/w:hAnsi="[^"]*"/g, `w:hAnsi="${esc}"`)
      .replace(/w:cs="[^"]*"/g, `w:cs="${esc}"`);
    zip.file(f.name, xml);
  }
  res.applied.push(`police du document → ${esc}`);
}

function opTailleTout(zip: PizZip, pt: number, res: TrameOpResult): void {
  const half = Math.round(pt * 2);
  for (const f of zip.file(/word\/(document|header\d+|footer\d+|styles)\.xml/)) {
    let xml = f.asText();
    xml = xml.replace(/<w:sz w:val="\d+"\/>/g, `<w:sz w:val="${half}"/>`)
      .replace(/<w:szCs w:val="\d+"\/>/g, `<w:szCs w:val="${half}"/>`);
    zip.file(f.name, xml);
  }
  res.applied.push(`taille du document → ${pt} pt`);
}

function editDocumentCorps(zip: PizZip, name: string, fn: (p: string) => string, res: TrameOpResult, label: string): void {
  const f = zip.file('word/document.xml');
  if (!f) return;
  const [xml, found] = editTokenPara(f.asText(), name, fn);
  if (found) { zip.file('word/document.xml', xml); res.applied.push(label); }
  else res.warnings.push(`balise {{${name}}} introuvable — ${label} sans effet`);
}

function opLogo(zip: PizZip, op: { facteur?: number; largeurCm?: number }, res: TrameOpResult): void {
  let done = false;
  for (const f of zip.file(/word\/(document|header\d+)\.xml/)) {
    let xml = f.asText();
    xml = xml.replace(/(cx=")(\d+)(" cy=")(\d+)(")/g, (_m, a, cx, b, cy, c) => {
      const CX = Number(cx); const CY = Number(cy);
      let f2 = op.facteur ?? 1;
      if (op.largeurCm) f2 = (op.largeurCm * CM_TO_EMU) / CX;
      done = true;
      return `${a}${Math.round(CX * f2)}${b}${Math.round(CY * f2)}${c}`;
    });
    if (done) zip.file(f.name, xml);
  }
  if (done) res.applied.push(op.largeurCm ? `logo → largeur ${op.largeurCm} cm` : `logo → ×${op.facteur}`);
  else res.warnings.push('aucun logo trouvé à redimensionner');
}

function opMarges(zip: PizZip, op: { cm?: number; haut?: number; bas?: number; gauche?: number; droite?: number }, res: TrameOpResult): void {
  const f = zip.file('word/document.xml');
  if (!f) return;
  const tw = (v?: number) => (v == null ? null : Math.round(v * CM_TO_TWIPS));
  const top = tw(op.haut ?? op.cm); const bot = tw(op.bas ?? op.cm);
  const left = tw(op.gauche ?? op.cm); const right = tw(op.droite ?? op.cm);
  let n = 0;
  const xml = f.asText().replace(/<w:pgMar\b[^>]*\/>/g, (m) => {
    n += 1;
    let out = m;
    if (top != null) out = out.replace(/w:top="[-\d]+"/, `w:top="${top}"`);
    if (bot != null) out = out.replace(/w:bottom="[-\d]+"/, `w:bottom="${bot}"`);
    if (left != null) out = out.replace(/w:left="\d+"/, `w:left="${left}"`);
    if (right != null) out = out.replace(/w:right="\d+"/, `w:right="${right}"`);
    return out;
  });
  if (n) { zip.file('word/document.xml', xml); res.applied.push('marges ajustées'); }
  else res.warnings.push('marges introuvables');
}

function opInsererBalise(zip: PizZip, nom: string, apres: string, res: TrameOpResult): void {
  const f = zip.file('word/document.xml');
  if (!f) return;
  let xml = f.asText();
  if (xml.includes(`{{${nom}}}`)) { res.warnings.push(`{{${nom}}} déjà présente`); return; }
  // Insère un run {{NOM}} juste après le run de texte contenant l'ancre.
  const re = new RegExp(`(<w:r>(?:<w:rPr>.*?</w:rPr>)?<w:t[^>]*>[^<]*${apres.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*</w:t></w:r>)`, 's');
  if (!re.test(xml)) { res.warnings.push(`ancre « ${apres} » introuvable pour insérer {{${nom}}}`); return; }
  xml = xml.replace(re, `$1<w:r><w:t xml:space="preserve"> {{${nom}}}</w:t></w:r>`);
  zip.file('word/document.xml', xml);
  res.applied.push(`balise {{${nom}}} insérée après « ${apres} »`);
}

function opRetirerBalise(zip: PizZip, nom: string, res: TrameOpResult): void {
  const f = zip.file('word/document.xml');
  if (!f) return;
  const xml = f.asText();
  if (!xml.includes(`{{${nom}}}`)) { res.warnings.push(`{{${nom}}} absente`); return; }
  zip.file('word/document.xml', xml.split(`{{${nom}}}`).join(''));
  res.applied.push(`balise {{${nom}}} retirée`);
}

/**
 * Balisage automatique (best-effort) : pose {{DESTINATAIRE}}, {{OBJET}},
 * {{CORPS}} d'après le contenu type d'un courrier, si absentes.
 */
function opBaliserAuto(zip: PizZip, res: TrameOpResult): void {
  const f = zip.file('word/document.xml');
  if (!f) return;
  let xml = f.asText();
  const before = xml;
  // OBJET : ajoute {{OBJET}} dans le paragraphe qui commence par « Objet »
  if (!xml.includes('{{OBJET}}')) {
    xml = xml.replace(/(<w:p\b(?:(?!<\/w:p>).)*?Objet(?:(?!<\/w:p>).)*?)(<\/w:p>)/s, (m, a, b) => (
      /Objet/.test(paraText(m)) ? `${a}<w:r><w:t xml:space="preserve"> {{OBJET}}</w:t></w:r>${b}` : m
    ));
  }
  // CORPS : premier paragraphe « vide » (texte réduit à un point ou rien) après l'objet
  if (!xml.includes('{{CORPS}}')) {
    let injected = false;
    xml = xml.replace(/<w:p\b[^>]*>.*?<\/w:p>/gs, (p) => {
      if (injected) return p;
      const t = paraText(p).trim();
      if (t === '.' || t === '') {
        // on n'injecte que s'il y a un run de texte à réutiliser
        if (/<w:t[^>]*>/.test(p)) {
          injected = true;
          return p.replace(/(<w:t[^>]*>)[^<]*(<\/w:t>)/, '$1{{CORPS}}$2');
        }
      }
      return p;
    });
    if (injected) res.applied.push('{{CORPS}} posée');
    else res.warnings.push('emplacement du corps non trouvé — placez {{CORPS}} à la main');
  }
  if (xml !== before) { zip.file('word/document.xml', xml); if (xml.includes('{{OBJET}}')) res.applied.push('{{OBJET}} posée'); }
  else res.warnings.push('balisage auto : rien à ajouter');
}

const JC: Record<string, string> = { gauche: 'left', centre: 'center', droite: 'right', justifie: 'both' };
const LINE: Record<number, string> = { 1: '240', 1.5: '360', 2: '480' };

// ── Point d'entrée ───────────────────────────────────────────────────────────

/** Applique une liste d'opérations à une trame (.docx base64) et retourne le nouveau .docx. */
export function applyTrameOps(docxBase64: string, ops: TrameOp[]): TrameOpResult {
  const zip = new PizZip(docxBase64, { base64: true });
  const res: TrameOpResult = { docxBase64: '', applied: [], warnings: [] };

  for (const op of ops) {
    switch (op.kind) {
      case 'police':
        if (op.cible === 'tout') opPoliceTout(zip, op.police, res);
        else editDocumentCorps(zip, 'CORPS', (p) => setRunProp(p, 'w:rFonts', `<w:rFonts w:ascii="${op.police}" w:hAnsi="${op.police}" w:cs="${op.police}"/>`), res, `police du corps → ${op.police}`);
        break;
      case 'taille':
        if (op.cible === 'tout') opTailleTout(zip, op.pt, res);
        else editDocumentCorps(zip, 'CORPS', (p) => setRunProp(p, 'w:sz', `<w:sz w:val="${Math.round(op.pt * 2)}"/>`), res, `taille du corps → ${op.pt} pt`);
        break;
      case 'logo':
        opLogo(zip, op, res);
        break;
      case 'marges':
        opMarges(zip, op, res);
        break;
      case 'interligne': {
        const line = LINE[op.valeur] || String(Math.round(op.valeur * 240));
        if (op.cible === 'corps') {
          editDocumentCorps(zip, 'CORPS', (p) => setPPrChild(p, 'w:spacing', `<w:spacing w:line="${line}" w:lineRule="auto"/>`), res, `interligne du corps → ${op.valeur}`);
        } else {
          res.warnings.push('interligne « tout » : appliquez sur le corps ({{CORPS}})');
        }
        break;
      }
      case 'aligner':
        editDocumentCorps(zip, 'CORPS', (p) => setPPrChild(p, 'w:jc', `<w:jc w:val="${JC[op.alignement] || 'both'}"/>`), res, `alignement du corps → ${op.alignement}`);
        break;
      case 'inserer_balise':
        opInsererBalise(zip, op.nom.toUpperCase(), op.apres, res);
        break;
      case 'retirer_balise':
        opRetirerBalise(zip, op.nom.toUpperCase(), res);
        break;
      case 'baliser_auto':
        opBaliserAuto(zip, res);
        break;
      default:
        break;
    }
  }

  res.docxBase64 = zip.generate({ type: 'base64' });
  return res;
}
