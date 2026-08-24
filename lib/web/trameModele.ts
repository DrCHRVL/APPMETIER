/**
 * SIRAL — modèle commun des « trames de forme » (papeteries de l'utilisateur).
 *
 * Une trame de forme est un document bureautique fourni par le magistrat — SA
 * papeterie — dans lequel il a placé des balises là où le contenu de l'acte
 * doit se déverser. Deux formats sont acceptés, au choix de l'utilisateur :
 *   - Word (.docx)          → moteur `trameFill.ts`
 *   - OpenDocument (.odt)   → moteur `trameOdt.ts`
 * Les deux moteurs exposent les MÊMES primitives ; `trameDoc.ts` aiguille sur
 * l'un ou l'autre d'après le format de la trame. Ce fichier ne contient que
 * les types partagés (aucune dépendance), pour que les deux moteurs et le
 * répartiteur puissent s'y référer sans se croiser.
 */

/** Famille de papeterie servie par une trame. */
export type TrameFormeType = 'courrier' | 'requete' | 'soit-transmis' | 'defaut';

/** Format du fichier modèle déposé par l'utilisateur. */
export type TrameFormeFormat = 'docx' | 'odt';

export interface TrameForme {
  id: string;
  nom: string;
  /**
   * Type principal. Historique : les trames enregistrées avant le multi-type
   * n'ont que ce champ — il reste la source de vérité quand `types` est absent.
   */
  type: TrameFormeType;
  /** Types d'actes servis par la trame (contient toujours `type` s'il est seul). */
  types?: TrameFormeType[];
  /** Format du fichier modèle. Absent = `docx` (trames antérieures à l'ODT). */
  format?: TrameFormeFormat;
  /**
   * Le fichier modèle de l'utilisateur, encodé en base64. Le nom du champ est
   * historique : il porte un .docx OU un .odt, selon `format`.
   */
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

/**
 * Un paragraphe du corps du document, tel que les moteurs le voient. Sert à
 * l'édition ligne à ligne et à l'analyse d'un acte existant : le rôle d'une
 * ligne se devine autant à sa mise en forme (titre centré en gras, signature
 * calée à droite) qu'à son texte.
 */
export interface ParaInfo {
  /** Rang du paragraphe dans le corps du document (ordre du fichier). */
  index: number;
  texte: string;
  gras: boolean;
  italique: boolean;
  centre: boolean;
  droite: boolean;
  /** Paragraphe situé dans un tableau (cadre du titre, en-tête en colonnes…). */
  tableau: boolean;
  /** Paragraphe portant une image ou des propriétés de section : jamais supprimable. */
  protege: boolean;
}

/**
 * Opération à appliquer à UN paragraphe :
 *   - `garder`    : intact ;
 *   - `supprimer` : le paragraphe disparaît du document ;
 *   - `remplacer` : on conserve les `garde` premiers caractères du paragraphe
 *                   (avec leur mise en forme d'origine) et on écrit `suffixe`
 *                   à la suite, le reste de la ligne étant effacé. `garde: 0`
 *                   remplace donc toute la ligne.
 */
export type PlanAction =
  | { action: 'garder' }
  | { action: 'supprimer' }
  | { action: 'remplacer'; garde: number; suffixe: string };

/** Types de trame reconnus, pour normaliser une entrée libre. */
export const TRAME_TYPES: TrameFormeType[] = ['courrier', 'requete', 'soit-transmis', 'defaut'];

/** Types servis par une trame (compatible avec les trames mono-type d'origine). */
export function trameTypes(t: Pick<TrameForme, 'type' | 'types'>): TrameFormeType[] {
  const list = Array.isArray(t.types) ? t.types.filter((x) => TRAME_TYPES.includes(x)) : [];
  if (list.length) return Array.from(new Set(list));
  return t.type ? [t.type] : [];
}

/** Format d'une trame (les trames antérieures à l'ODT sont des .docx). */
export function trameFormat(t: Pick<TrameForme, 'format'>): TrameFormeFormat {
  return t.format === 'odt' ? 'odt' : 'docx';
}

/** Trame applicable pour un type donné : celle qui sert ce type, à défaut la trame « défaut ». */
export function pickTrameForme(list: TrameForme[], type: TrameFormeType): TrameForme | null {
  return list.find((t) => trameTypes(t).includes(type))
    || list.find((t) => trameTypes(t).includes('defaut'))
    || null;
}

/**
 * Insère (ou met à jour) une trame dans la liste en lui RÉSERVANT ses types :
 * les autres trames perdent les types qu'elle reprend, de sorte qu'un type
 * d'acte n'est jamais servi par deux trames. Une trame qui se retrouve sans
 * type n'est pas supprimée pour autant — on ne jette pas le fichier de
 * l'utilisateur dans son dos ; elle est simplement inutilisée jusqu'à ce qu'il
 * lui en réattribue un.
 */
export function poserTrame(list: TrameForme[], trame: TrameForme): TrameForme[] {
  const pris = new Set(trameTypes(trame));
  const autres = list
    .filter((t) => t.id !== trame.id)
    .map((t) => {
      const restants = trameTypes(t).filter((x) => !pris.has(x));
      if (restants.length === trameTypes(t).length) return t;
      return { ...t, type: restants[0] || t.type, types: restants };
    });
  return list.some((t) => t.id === trame.id)
    ? list.map((t) => (t.id === trame.id ? trame : autres.find((a) => a.id === t.id) || t))
    : [...autres, trame];
}
