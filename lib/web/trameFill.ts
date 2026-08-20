/**
 * SIRAL — remplissage des « trames de forme ».
 *
 * Une trame de forme est un document Word (.docx) fourni par le magistrat :
 * SA papeterie (logo, en-tête, police, pied de page…), telle qu'il la veut,
 * dans laquelle il a placé des BALISES là où le contenu de l'acte doit se
 * déverser. À l'export, on ouvre ce .docx, on remplit les balises avec le
 * texte de l'acte, et on ressort le Word — strictement identique à la trame,
 * au contenu près. On ne reconstruit RIEN : la forme est 100 % celle du
 * fichier de l'utilisateur.
 *
 * Ce module ne fait que l'entrée/sortie du .zip .docx ; toute la logique de
 * rendu (repérage des balises, markdown → OOXML) vit dans `trameFillCore.mjs`,
 * pur et testable en Node (`node scripts/trame-forme.test.mjs`).
 *
 * Balises reconnues (à saisir en texte simple dans le .docx — la casse, les
 * espaces intérieurs et le découpage en « runs » par Word sont sans effet) :
 *   {{CORPS}}        — paragraphe seul : le corps de l'acte se déverse ici, en
 *                      héritant de la police/mise en forme de CE paragraphe.
 *                      Le markdown de l'acte devient de vrais objets Word :
 *                      titres, listes, TABLEAUX, gras/italique/souligné.
 *   {{TITRE}}        — paragraphe seul : le titre de l'acte.
 *   {{SIGNATURE}}    — paragraphe seul : le bloc signature (multi-lignes).
 *   {{DESTINATAIRE}} — en ligne : le destinataire (courriers).
 *   {{OBJET}}        — en ligne : l'objet (courriers).
 *   {{DATE}}         — en ligne : la date.
 *
 * Les balises EN LIGNE sont aussi remplies dans les en-têtes et pieds de page
 * (une papeterie y pose souvent la date ou l'objet). Une balise sans valeur
 * est retirée : le document remis ne porte jamais de `{{…}}` résiduel.
 */

import PizZip from 'pizzip';
import { fillPartXml, findTokens, TRAME_TOKENS as CORE_TOKENS } from './trameFillCore.mjs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Parties du .docx où des balises peuvent figurer (corps, en-têtes, pieds). */
const PART_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;

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

export const TRAME_TOKENS = CORE_TOKENS as readonly string[];

/** Parties du document susceptibles de porter des balises. */
function partNames(zip: PizZip): string[] {
  return Object.keys((zip as unknown as { files: Record<string, unknown> }).files)
    .filter((n) => PART_RE.test(n));
}

/**
 * Remplit une trame de forme (.docx base64) avec les variables d'un acte et
 * retourne le Blob .docx final. Portable navigateur/Node (sortie en Uint8Array
 * enveloppée dans un Blob).
 */
export async function fillTrameDocx(docxBase64: string, vars: TrameVars): Promise<Blob> {
  const zip = new PizZip(docxBase64, { base64: true });
  if (!zip.file('word/document.xml')) throw new Error('trame invalide : word/document.xml absent');

  for (const name of partNames(zip)) {
    const file = zip.file(name);
    if (!file) continue;
    // Corps du document : toutes les balises. En-têtes / pieds de page : seules
    // les balises en ligne (on n'y déverse pas le corps de l'acte).
    const blocks = name === 'word/document.xml';
    zip.file(name, fillPartXml(file.asText(), vars, { blocks }));
  }

  const ab = zip.generate({ type: 'arraybuffer', compression: 'DEFLATE' }) as ArrayBuffer;
  return new Blob([ab], { type: DOCX_MIME });
}

/** Liste des balises reconnues présentes dans le .docx (base64). */
export function listTrameTokens(docxBase64: string): string[] {
  try {
    const zip = new PizZip(docxBase64, { base64: true });
    const found = new Set<string>();
    for (const name of partNames(zip)) {
      const file = zip.file(name);
      if (file) for (const t of findTokens(file.asText())) found.add(t);
    }
    return CORE_TOKENS.filter((t: string) => found.has(t));
  } catch {
    return [];
  }
}

/** Vrai si le .docx (base64) contient au moins une balise reconnue. */
export function trameHasTokens(docxBase64: string): boolean {
  return listTrameTokens(docxBase64).length > 0;
}
