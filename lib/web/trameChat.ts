/**
 * SIRAL — assistant des trames de forme (interprète de commandes).
 *
 * Traduit une instruction en langage naturel (français) en une liste
 * d'opérations pour le moteur `trameOps`, ou en une réponse de conseil
 * (Niveau 1) quand c'est une question. Déterministe, local, instantané :
 * aucune donnée ne sort de l'application. Il ne comprend pas toutes les
 * tournures possibles d'un vrai LLM, mais couvre les demandes courantes
 * d'édition d'une papeterie (police, taille, logo, marges, interligne,
 * alignement, balises) et guide l'utilisateur.
 */

import type { TrameOp } from './trameOps';
import { TRAME_TOKENS } from './trameFill';

export interface TrameChatResponse {
  ops: TrameOp[];
  reply: string;
}

const FONTS: Record<string, string> = {
  'times new roman': 'Times New Roman', times: 'Times New Roman',
  marianne: 'Marianne', calibri: 'Calibri', arial: 'Arial',
  garamond: 'Garamond', cambria: 'Cambria', georgia: 'Georgia',
};

function deburr(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function num(s: string): number | null {
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

function cible(t: string): 'tout' | 'corps' {
  return /\bcorps\b|\btexte\b/.test(t) ? 'corps' : 'tout';
}

function findFont(t: string): string | null {
  for (const key of Object.keys(FONTS)) if (t.includes(key)) return FONTS[key];
  return null;
}

const HELP = [
  'Je peux modifier votre trame. Exemples :',
  '• « mets le corps en Times New Roman 12 »',
  '• « agrandis le logo » / « logo à 4 cm »',
  '• « marges à 1,5 cm »',
  '• « interligne du corps à 1,5 »',
  '• « corps justifié »',
  '• « pose les balises » (balisage automatique)',
  '• « ajoute la balise OBJET après Objet »  /  « retire la balise DATE »',
].join('\n');

/** Interprète une instruction. `tokensPresent` = balises déjà dans la trame. */
export function interpretTrameCommand(instruction: string, tokensPresent: string[]): TrameChatResponse {
  const raw = instruction.trim();
  const t = deburr(raw.toLowerCase());
  const ops: TrameOp[] = [];

  // ── Questions / conseil (Niveau 1) ──
  if (/\b(aide|help|que peux|quoi faire|comment)\b/.test(t) && !/police|taille|logo|marge|balis|interlign/.test(t)) {
    return { ops: [], reply: HELP };
  }
  const asksAboutTokens = (
    /\bmanque\b/.test(t)
    || (/balise/.test(t)
      && (/\?/.test(raw) || /\b(ou|quel|quelle|quelles|combien|liste|etat|presente?s?|reste)\b/.test(t)))
  ) && !/(pose|ajoute|insere|insère|retire|enleve|enlève|supprime|balise ma|balise-|balise[rz]\b)/.test(t);
  if (asksAboutTokens) {
    const present = tokensPresent.length ? tokensPresent.map((x) => `{{${x}}}`).join(', ') : 'aucune';
    const missing = TRAME_TOKENS.filter((x) => !tokensPresent.includes(x));
    return {
      ops: [],
      reply: `Balises présentes : ${present}.\n`
        + (missing.length ? `Manquantes possibles : ${missing.map((x) => `{{${x}}}`).join(', ')}. Seule {{CORPS}} est indispensable.` : 'Toutes les balises utiles sont présentes.'),
    };
  }

  // ── Balisage automatique (demande d'action explicite) ──
  if (/pose[rz]? les balises|balise ma trame|balise-?moi|balisage? ?automatique|balise automatiquement|auto ?balis|^\s*balise[rz]?\b/.test(t)
    && !/apres|après|ajoute|insere|insère|retire|enleve|enlève|supprime/.test(t)) {
    ops.push({ kind: 'baliser_auto' });
    return { ops, reply: 'Je pose les balises automatiquement (objet, corps) là où je les reconnais.' };
  }
  const mIns = t.match(/(?:ajoute|insere|insère|mets?)\b.*?balise\s+([a-z]+).*?(?:apres|après)\s+(.+)$/);
  if (mIns) {
    const nom = mIns[1].toUpperCase();
    const apres = raw.slice(raw.toLowerCase().lastIndexOf(mIns[2].slice(0, 4).toLowerCase())).trim() || mIns[2];
    ops.push({ kind: 'inserer_balise', nom, apres: apres.replace(/["'«»]/g, '').trim() });
    return { ops, reply: `J'insère {{${nom}}} après « ${apres} ».` };
  }
  const mDel = t.match(/(?:retire|enleve|enlève|supprime)\b.*?balise\s+([a-z]+)/);
  if (mDel) {
    const nom = mDel[1].toUpperCase();
    ops.push({ kind: 'retirer_balise', nom });
    return { ops, reply: `Je retire {{${nom}}}.` };
  }

  // ── Police ──
  if (/police|font/.test(t) || findFont(t)) {
    const font = findFont(t);
    if (font) ops.push({ kind: 'police', cible: cible(t), police: font });
    else return { ops: [], reply: 'Quelle police ? (ex. Times New Roman, Marianne, Calibri)' };
  }

  // ── Taille ──
  if (/\btaille\b|\bpt\b|\bpoints?\b/.test(t) || /\b(corps|texte)\b.*\b\d+\b/.test(t)) {
    const n = num(t);
    if (n && n >= 6 && n <= 72) ops.push({ kind: 'taille', cible: cible(t), pt: n });
  }

  // ── Logo ──
  if (/logo/.test(t)) {
    const cm = /\bcm\b/.test(t) ? num(t) : null;
    if (cm) ops.push({ kind: 'logo', largeurCm: cm });
    else if (/agrandi|plus grand|grossi|augment/.test(t)) ops.push({ kind: 'logo', facteur: 1.25 });
    else if (/redui|rédui|plus petit|diminu|rapeti/.test(t)) ops.push({ kind: 'logo', facteur: 0.8 });
    else return { ops: [], reply: 'Logo : « agrandis le logo », « réduis le logo » ou « logo à 4 cm ».' };
  }

  // ── Marges ──
  if (/marge/.test(t)) {
    const cm = num(t);
    if (cm != null) {
      const op: TrameOp = { kind: 'marges' };
      if (/haut/.test(t)) op.haut = cm; else if (/bas/.test(t)) op.bas = cm;
      else if (/gauche/.test(t)) op.gauche = cm; else if (/droit/.test(t)) op.droite = cm;
      else op.cm = cm;
      ops.push(op);
    } else return { ops: [], reply: 'Précisez les marges en cm (ex. « marges à 1,5 cm »).' };
  }

  // ── Interligne ──
  if (/interlign|espacement des lignes/.test(t)) {
    let v: number | null = null;
    if (/double/.test(t)) v = 2; else if (/simple/.test(t)) v = 1; else v = num(t);
    if (v) ops.push({ kind: 'interligne', cible: 'corps', valeur: v });
  }

  // ── Alignement ──
  if (/justifi/.test(t)) ops.push({ kind: 'aligner', cible: 'corps', alignement: 'justifie' });
  else if (/centr/.test(t)) ops.push({ kind: 'aligner', cible: 'corps', alignement: 'centre' });
  else if (/\ba gauche\b|aligne.*gauche/.test(t)) ops.push({ kind: 'aligner', cible: 'corps', alignement: 'gauche' });
  else if (/\ba droite\b|aligne.*droit/.test(t)) ops.push({ kind: 'aligner', cible: 'corps', alignement: 'droite' });

  if (ops.length === 0) {
    return { ops: [], reply: `Je n'ai pas compris.\n\n${HELP}` };
  }
  return { ops, reply: '' };
}
