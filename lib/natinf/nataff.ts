// Résolution NATINF → catégorie métier (statistiques).
//
// Axe principal : la taxonomie du Mémento parquet (Lebreton), c'est-à-dire le
// langage du parquet — libellés courts et parlants (Vol, Stupéfiants,
// Proxénétisme, Blanchiment, Armes ILA…), regroupés sous un « grand titre »
// (Atteintes aux personnes / aux biens / à l'autorité de l'État…).
//
// La catégorie se déduit du THÈME mémento du NATINF (24 thèmes fiables, déjà
// présents dans les données) ; pour les thèmes hétérogènes (infractions
// sexuelles, écofi), on affine PAR LIBELLÉ mais en restant BORNÉ au thème, ce
// qui rend le découpage sûr. Repli mot-clé pour les codes sans thème.
//
// NATAFF (champ nataffN1 de chaque catégorie) n'est plus l'axe d'affichage : il
// est conservé uniquement comme roll-up officiel A→L, pour un éventuel export
// vers les nomenclatures de l'État (cf. data/natinf/nataff.json).
//
// Tout est éditable à la main : renommer un label, déplacer une catégorie de
// grand titre, ou ajuster une règle de découpage.

import type { NatinfEntry } from '@/types/natinf';
import type { GrandTitre, StatCategory, CategoryResolution, NataffN1 } from '@/types/nataff';
import nataffData from '@/data/natinf/nataff.json';

export const NATAFF_N1 = nataffData.n1 as NataffN1[];
const NATAFF_N1_BY_CODE = new Map(NATAFF_N1.map((x) => [x.code, x]));

// ── Grands titres (axe macro d'affichage) ─────────────────────────────────────
export const GRAND_TITRES: GrandTitre[] = [
  { code: 'PERSONNES', label: 'Atteintes aux personnes', order: 1 },
  { code: 'BIENS', label: 'Atteintes aux biens', order: 2 },
  { code: 'ETAT', label: "Atteinte à l'autorité de l'État", order: 3 },
  { code: 'STUP', label: 'Stupéfiants', order: 4 },
  { code: 'ECOFI', label: 'Économique et financier', order: 5 },
  { code: 'CIRCULATION', label: 'Circulation et transports', order: 6 },
];
const GRAND_TITRE_BY_CODE = new Map(GRAND_TITRES.map((g) => [g.code, g]));

// ── Catégories métier ─────────────────────────────────────────────────────────
// (code, label affiché, grand titre, lettre NATAFF N1 pour l'export officiel)
export const STAT_CATEGORIES: StatCategory[] = [
  // Atteintes aux personnes
  { code: 'VIOLENCES', label: 'Violences', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'MENACES', label: 'Menaces', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'ATT_INVOL', label: 'Atteintes involontaires', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'AUTRES_VOL', label: 'Autres atteintes volontaires', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'VIOL', label: 'Viol', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'AGRESSION', label: 'Agression sexuelle', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'ATT_SEX_MINEUR', label: 'Atteinte sexuelle sur mineur', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'EXHIB', label: 'Exhibition / harcèlement sexuel', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'PEDOPORNO', label: 'Pédopornographie', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'PROXENETISME', label: 'Proxénétisme / prostitution', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'AUTRES_SEX', label: 'Autres infractions sexuelles', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'HARCELEMENT', label: 'Harcèlement', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'VIE_PRIVEE', label: 'Vie privée', grandTitre: 'PERSONNES', nataffN1: 'A' },
  { code: 'FAMILLE', label: 'Famille', grandTitre: 'PERSONNES', nataffN1: 'A' },
  // Atteintes aux biens
  { code: 'VOL', label: 'Vol', grandTitre: 'BIENS', nataffN1: 'B' },
  { code: 'RECEL', label: 'Recel', grandTitre: 'BIENS', nataffN1: 'B' },
  { code: 'EXTORSION', label: 'Extorsion', grandTitre: 'BIENS', nataffN1: 'B' },
  { code: 'DESTRUCTION', label: 'Destruction / dégradation', grandTitre: 'BIENS', nataffN1: 'B' },
  { code: 'DESTRUCTION_INVOL', label: 'Destruction involontaire', grandTitre: 'BIENS', nataffN1: 'B' },
  // Atteinte à l'autorité de l'État
  { code: 'AUTORITE_ETAT', label: "Autorité de l'État", grandTitre: 'ETAT', nataffN1: 'C' },
  { code: 'POST_SENTENCIEL', label: 'Post-sentenciel', grandTitre: 'ETAT', nataffN1: 'C' },
  { code: 'ASSOC', label: 'Association de malfaiteurs', grandTitre: 'ETAT', nataffN1: 'C' },
  { code: 'ARMES', label: 'Armes (ILA)', grandTitre: 'ETAT', nataffN1: 'C' },
  { code: 'TERRORISME', label: 'Terrorisme', grandTitre: 'ETAT', nataffN1: 'C' },
  { code: 'FAUX', label: 'Faux', grandTitre: 'ETAT', nataffN1: 'C' },
  { code: 'OUTRAGE', label: 'Outrage / rébellion', grandTitre: 'ETAT', nataffN1: 'C' },
  // Stupéfiants
  { code: 'STUP', label: 'Trafic de stupéfiants (ILS)', grandTitre: 'STUP', nataffN1: 'G' },
  // Économique et financier
  { code: 'ESCROQUERIE', label: 'Escroquerie', grandTitre: 'ECOFI', nataffN1: 'B' },
  { code: 'ABUS_CONFIANCE', label: 'Abus de confiance', grandTitre: 'ECOFI', nataffN1: 'B' },
  { code: 'BLANCHIMENT', label: 'Blanchiment', grandTitre: 'ECOFI', nataffN1: 'E' },
  { code: 'MOYENS_PAIEMENT', label: 'Moyens de paiement', grandTitre: 'ECOFI', nataffN1: 'E' },
  { code: 'TRAVAIL_ILLEGAL', label: 'Travail illégal / vente sauvette', grandTitre: 'ECOFI', nataffN1: 'H' },
  { code: 'ILT', label: 'Tabac (ILT)', grandTitre: 'ECOFI', nataffN1: 'G' },
  { code: 'AUTRES_ECOFI', label: 'Autres écofi', grandTitre: 'ECOFI', nataffN1: 'E' },
  // Circulation et transports
  { code: 'CIRCULATION', label: 'Circulation routière', grandTitre: 'CIRCULATION', nataffN1: 'I' },
  { code: 'TRANSPORTS', label: 'Transports', grandTitre: 'CIRCULATION', nataffN1: 'I' },
];
const CAT_BY_CODE = new Map(STAT_CATEGORIES.map((c) => [c.code, c]));

/** Normalisation (minuscules, sans accents) pour comparer thèmes et libellés. */
const norm = (s: string | undefined): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Thèmes « simples » (un thème = une catégorie).
const THEME_TO_CAT_RAW: Record<string, string> = {
  'Violences': 'VIOLENCES',
  'Atteintes volontaires aux personnes': 'AUTRES_VOL',
  'Menaces': 'MENACES',
  'Harcèlement': 'HARCELEMENT',
  'Homicide et blessures involontaires': 'ATT_INVOL',
  'Atteintes à la vie privée': 'VIE_PRIVEE',
  'Droit pénal de la famille': 'FAMILLE',
  'Atteintes aux biens': 'VOL',
  'Recel': 'RECEL',
  'Extorsion': 'EXTORSION',
  'Destructions et dégradations volontaires': 'DESTRUCTION',
  'Destructions et dégradations involontaires': 'DESTRUCTION_INVOL',
  "Infractions contre l'État et l'autorité": 'AUTORITE_ETAT',
  'Outrage et rébellion': 'OUTRAGE',
  'Association de malfaiteurs et ordre public': 'ASSOC',
  'Faux': 'FAUX',
  'Incriminations post-sentencielles': 'POST_SENTENCIEL',
  'Infractions terroristes': 'TERRORISME',
  'Armes et explosifs (ILA)': 'ARMES',
  'Stupéfiants (ILS)': 'STUP',
  'Circulation routière': 'CIRCULATION',
  'Coordination des transports': 'TRANSPORTS',
};
const THEME_TO_CAT: Record<string, string> = Object.fromEntries(
  Object.entries(THEME_TO_CAT_RAW).map(([k, v]) => [norm(k), v]),
);

const THEME_SEXUEL = norm('Infractions sexuelles');
const THEME_ECOFI = norm('Économique et financier (écofi)');

/** Découpage du thème « Infractions sexuelles » par libellé (borné au thème). */
function splitSexuel(lib: string): string {
  if (/proxenet|prostitution|racolage/.test(lib)) return 'PROXENETISME';
  if (/pedoporno|pornograph|image.*mineur/.test(lib)) return 'PEDOPORNO';
  if (/\bviol\b|viol /.test(lib)) return 'VIOL';
  if (/agression sexuelle/.test(lib)) return 'AGRESSION';
  if (/atteinte sexuelle|incitation|proposition sexuelle|corruption de mineur/.test(lib)) return 'ATT_SEX_MINEUR';
  if (/exhibition|harcelement sexuel/.test(lib)) return 'EXHIB';
  return 'AUTRES_SEX';
}

/** Découpage du thème « écofi » par libellé (borné au thème). */
function splitEcofi(lib: string): string {
  if (/tabac/.test(lib)) return 'ILT';
  if (/blanchiment/.test(lib)) return 'BLANCHIMENT';
  if (/escroquerie|filouterie|abus de faiblesse/.test(lib)) return 'ESCROQUERIE';
  if (/abus de confiance|detournement/.test(lib)) return 'ABUS_CONFIANCE';
  if (/cheque|carte de paiement|moyen de paiement|monnaie/.test(lib)) return 'MOYENS_PAIEMENT';
  if (/travail (dissimule|illegal)|sauvette/.test(lib)) return 'TRAVAIL_ILLEGAL';
  return 'AUTRES_ECOFI';
}

// Repli mot-clé pour les codes SANS thème mémento (best-effort).
const KEYWORD_FALLBACK: { re: RegExp; cat: string }[] = [
  { re: /tabac/, cat: 'ILT' },
  { re: /stupefiant/, cat: 'STUP' },
  { re: /blanchiment/, cat: 'BLANCHIMENT' },
  { re: /proxenet|prostitution/, cat: 'PROXENETISME' },
  { re: /\brecel/, cat: 'RECEL' },
  { re: /extorsion/, cat: 'EXTORSION' },
  { re: /escroquerie/, cat: 'ESCROQUERIE' },
  { re: /abus de confiance/, cat: 'ABUS_CONFIANCE' },
  { re: /terroris/, cat: 'TERRORISME' },
  { re: /association de malfaiteurs/, cat: 'ASSOC' },
  { re: /\barme|explosif|munition/, cat: 'ARMES' },
  { re: /outrage|rebellion/, cat: 'OUTRAGE' },
  { re: /\bfaux\b|falsification|fausse monnaie/, cat: 'FAUX' },
  { re: /destruction|degradation|incendie/, cat: 'DESTRUCTION' },
  { re: /\bvols?\b|cambriolage/, cat: 'VOL' },
  { re: /violence|coups/, cat: 'VIOLENCES' },
  { re: /conduite|ivresse|alcoolemie|permis de conduire|stationnement/, cat: 'CIRCULATION' },
];

const CODE_TO_CAT: Record<string, string> = {};

function resolveCategoryCode(
  entry: Pick<NatinfEntry, 'code' | 'theme' | 'libelle'>,
): string | undefined {
  const override = CODE_TO_CAT[entry.code];
  if (override) return override;

  const lib = norm(entry.libelle);
  const theme = norm(entry.theme);

  if (theme === THEME_SEXUEL) return splitSexuel(lib);
  if (theme === THEME_ECOFI) return splitEcofi(lib);
  if (theme && THEME_TO_CAT[theme]) return THEME_TO_CAT[theme];

  for (const { re, cat } of KEYWORD_FALLBACK) {
    if (re.test(lib)) return cat;
  }
  return undefined;
}

/** Catégorie métier + grand titre d'un NATINF, ou undefined si non classé. */
export function categoryForEntry(
  entry: Pick<NatinfEntry, 'code' | 'theme' | 'libelle'> | undefined | null,
): CategoryResolution | undefined {
  if (!entry) return undefined;
  const code = resolveCategoryCode(entry);
  if (!code) return undefined;
  const category = CAT_BY_CODE.get(code);
  if (!category) return undefined;
  const grandTitre = GRAND_TITRE_BY_CODE.get(category.grandTitre);
  if (!grandTitre) return undefined;
  return { category, grandTitre };
}

/** Grande catégorie NATAFF (N1) d'une catégorie métier, pour l'export officiel. */
export function nataffN1ForCategory(category: StatCategory): NataffN1 | undefined {
  return NATAFF_N1_BY_CODE.get(category.nataffN1);
}
