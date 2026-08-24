/**
 * SIRAL — répartiteur des « trames de forme » entre les deux formats.
 *
 * Le magistrat dépose sa papeterie en Word (.docx) ou en OpenDocument (.odt),
 * au choix ; l'application ne doit s'en soucier nulle part ailleurs. Ce module
 * expose UNE seule API — remplir, lister les balises, lire et réécrire les
 * lignes, appliquer les opérations d'édition — et aiguille vers `trameFill`
 * (Word) ou `trameOdt` (OpenDocument) d'après le format de la trame.
 *
 * Tout se passe dans le navigateur : le fichier de l'utilisateur n'est jamais
 * envoyé nulle part, il est ouvert, modifié et refermé sur place.
 */

import PizZip from 'pizzip';
import {
  fillTrameDocx, listTrameTokens, docxParagraphes, docxAppliquerPlan,
} from './trameFill';
import {
  fillTrameOdt, listOdtTokens, odtParagraphes, odtAppliquerPlan, applyOdtOps, ODT_MIME,
} from './trameOdt';
import { applyTrameOps, type TrameOp, type TrameOpResult } from './trameOps';
import type { ParaInfo, PlanAction, TrameFormeFormat, TrameVars } from './trameModele';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Extension de fichier d'une trame (et donc de l'acte exporté à partir d'elle). */
export function extensionTrame(format: TrameFormeFormat): string {
  return format === 'odt' ? 'odt' : 'docx';
}

/** Type MIME d'une trame. */
export function mimeTrame(format: TrameFormeFormat): string {
  return format === 'odt' ? ODT_MIME : DOCX_MIME;
}

/** Format déduit d'un nom de fichier (`.docx` / `.odt`), sinon null. */
export function formatDepuisNom(nom: string): TrameFormeFormat | null {
  if (/\.docx$/i.test(nom)) return 'docx';
  if (/\.odt$/i.test(nom)) return 'odt';
  return null;
}

/**
 * Format réellement porté par le fichier (on regarde DANS l'archive, pas
 * l'extension) : un .odt renommé en .docx serait sinon accepté puis illisible.
 */
export function detecterFormat(base64: string): TrameFormeFormat | null {
  try {
    const zip = new PizZip(base64, { base64: true });
    if (zip.file('word/document.xml')) return 'docx';
    if (zip.file('content.xml')) {
      const mime = zip.file('mimetype')?.asText() || '';
      if (!mime || /opendocument\.text/.test(mime)) return 'odt';
    }
    return null;
  } catch {
    return null;
  }
}

/** Remplit la trame avec les variables de l'acte et rend le fichier final. */
export function fillTrame(base64: string, format: TrameFormeFormat, vars: TrameVars): Promise<Blob> {
  return format === 'odt' ? fillTrameOdt(base64, vars) : fillTrameDocx(base64, vars);
}

/** Balises reconnues présentes dans la trame. */
export function tokensTrame(base64: string, format: TrameFormeFormat): string[] {
  return format === 'odt' ? listOdtTokens(base64) : listTrameTokens(base64);
}

/** Vrai si la trame porte au moins une balise reconnue. */
export function trameBalisee(base64: string, format: TrameFormeFormat): boolean {
  return tokensTrame(base64, format).length > 0;
}

/** Tous les paragraphes du corps, vides compris, dans l'ordre du fichier. */
export function paragraphesTrame(base64: string, format: TrameFormeFormat): ParaInfo[] {
  return format === 'odt' ? odtParagraphes(base64) : docxParagraphes(base64);
}

/** Applique un plan (une action par paragraphe, même ordre) et rend le fichier. */
export function appliquerPlan(base64: string, format: TrameFormeFormat, plan: PlanAction[]): string {
  return format === 'odt' ? odtAppliquerPlan(base64, plan) : docxAppliquerPlan(base64, plan);
}

/** Applique les opérations de l'assistant (police, logo, marges, balises…). */
export function appliquerOpsTrame(base64: string, format: TrameFormeFormat, ops: TrameOp[]): TrameOpResult {
  return format === 'odt' ? applyOdtOps(base64, ops) : applyTrameOps(base64, ops);
}

// ── Édition ligne à ligne ────────────────────────────────────────────────────

export interface LigneTrame {
  /** Rang du paragraphe dans le document (identifiant stable). */
  index: number;
  texte: string;
}

/** Lignes de texte éditables de la trame (paragraphes non vides, dans l'ordre). */
export function lignesTrame(base64: string, format: TrameFormeFormat): LigneTrame[] {
  return paragraphesTrame(base64, format)
    .filter((p) => p.texte.trim().length > 0)
    .map((p) => ({ index: p.index, texte: p.texte }));
}

/** Réécrit le texte des lignes désignées, en gardant leur mise en forme. */
export function ecrireLignes(base64: string, format: TrameFormeFormat, lignes: LigneTrame[]): string {
  const total = paragraphesTrame(base64, format).length;
  const parIndex = new Map(lignes.map((l) => [l.index, l.texte]));
  const plan: PlanAction[] = [];
  for (let i = 0; i < total; i += 1) {
    const t = parIndex.get(i);
    plan.push(t == null ? { action: 'garder' } : { action: 'remplacer', garde: 0, suffixe: t });
  }
  return appliquerPlan(base64, format, plan);
}
