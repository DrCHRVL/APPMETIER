// Résolution NATINF → NATAFF (nature d'affaire).
//
// La nomenclature NATAFF (data/natinf/nataff.json) ne fournit PAS de table de
// correspondance officielle NATINF → NATAFF : on la déduit ici. La déduction
// procède en trois temps, du plus spécifique au plus général :
//   1. CODE_TO_N2  — correction explicite pour un n° NATINF précis ;
//   2. THEME_TO_N2 — le thème « mémento » du NATINF (24 catégories couvrant les
//      infractions fréquentes, soit l'essentiel du volume réel des dossiers) ;
//   3. KEYWORD_RULES — repli sur le libellé pour les ~16 000 codes sans thème.
// À défaut, le NATINF est « non classé ».
//
// Cette table est volontairement éditable à la main : pour corriger un
// rattachement, ajouter une entrée dans CODE_TO_N2 (un code) ou ajuster
// THEME_TO_N2 (tout un thème).

import type { NatinfEntry } from '@/types/natinf';
import type { NataffN1, NataffN2, NataffResolution } from '@/types/nataff';
import nataffData from '@/data/natinf/nataff.json';

export const NATAFF_N1 = nataffData.n1 as NataffN1[];
export const NATAFF_N2 = nataffData.n2 as NataffN2[];

const N1_BY_CODE = new Map(NATAFF_N1.map((x) => [x.code, x]));
const N2_BY_CODE = new Map(NATAFF_N2.map((x) => [x.code, x]));

/** Normalisation (minuscules, sans accents) pour comparer thèmes et libellés. */
const norm = (s: string | undefined): string =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// ── 2. Thème mémento → code NATAFF N2 ─────────────────────────────────────────
// Clés normalisées (cf. norm) pour être insensible aux accents/apostrophes.
// ⚠ = thème pouvant chevaucher plusieurs N2 ; valeur = N2 dominant retenu.
const THEME_TO_N2_RAW: Record<string, string> = {
  'Violences': 'A3',
  'Atteintes volontaires aux personnes': 'A3',
  'Infractions sexuelles': 'A3', // ⚠ majeur ; viol/agression sur mineur = A4, mœurs = A8
  'Menaces': 'A7',
  'Harcèlement': 'A7', // ⚠ harcèlement moral ; harcèlement sexuel = A8
  'Homicide et blessures involontaires': 'A5',
  'Atteintes à la vie privée': 'A6',
  'Droit pénal de la famille': 'A9',
  'Atteintes aux biens': 'B2', // ⚠ résiduel « vols » (recel/extorsion/destruction ont leur propre thème)
  'Recel': 'B4',
  'Extorsion': 'B5',
  'Destructions et dégradations volontaires': 'B7',
  'Destructions et dégradations involontaires': 'B7',
  'Infractions terroristes': 'C1',
  'Armes et explosifs (ILA)': 'C2',
  'Faux': 'C4',
  'Incriminations post-sentencielles': 'C5', // ⚠ violation de décision judiciaire / évasion
  'Outrage et rébellion': 'C6',
  "Infractions contre l'État et l'autorité": 'C6', // ⚠ peut relever de C1/C3/C5 selon le fait
  'Association de malfaiteurs et ordre public': 'C7',
  'Économique et financier (écofi)': 'E1', // ⚠ E1 sociétés ; fiscal/douanier/blanchiment = E2, paiement = E3
  'Stupéfiants (ILS)': 'G1',
  'Circulation routière': 'I2', // ⚠ règles de conduite ; usage des voies = I8, stationnement = I9
  'Coordination des transports': 'I3',
};
const THEME_TO_N2: Record<string, string> = Object.fromEntries(
  Object.entries(THEME_TO_N2_RAW).map(([k, v]) => [norm(k), v]),
);

// ── 3. Règles mot-clé (repli pour les codes sans thème) ───────────────────────
// Best-effort : appliquées sur le libellé normalisé, première correspondance
// gagnante. Ordonnées du plus spécifique au plus générique.
const KEYWORD_RULES: { re: RegExp; n2: string }[] = [
  { re: /stupefiant|trafic de stup/, n2: 'G1' },
  { re: /abus de confiance/, n2: 'B5' },
  { re: /\brecel\b/, n2: 'B4' },
  { re: /extorsion/, n2: 'B5' },
  { re: /escroquerie|abus de faiblesse|filouterie/, n2: 'B6' },
  { re: /blanchiment|fraude fiscale|infraction douaniere|contrebande/, n2: 'E2' },
  { re: /abus de biens sociaux|banqueroute|abus de credit/, n2: 'E1' },
  { re: /cheque|carte de paiement|moyen de paiement/, n2: 'E3' },
  { re: /proxenetisme/, n2: 'A3' },
  { re: /harcelement sexuel|exhibition|pedopornographie|corruption de mineur|prostitution/, n2: 'A8' },
  { re: /viol |agression sexuelle/, n2: 'A3' },
  { re: /\bmenace|chantage/, n2: 'A7' },
  { re: /outrage|rebellion/, n2: 'C6' },
  { re: /association de malfaiteurs/, n2: 'C7' },
  { re: /terroris/, n2: 'C1' },
  { re: /\barme|explosif|munition/, n2: 'C2' },
  { re: /corruption|trafic d.influence|prise illegale d.interet/, n2: 'C3' },
  { re: /faux|falsification|fausse monnaie|contrefacon de marque/, n2: 'C4' },
  { re: /homicide involontaire|blessures involontaires|atteinte.*involontaire/, n2: 'A5' },
  { re: /meurtre|assassinat|homicide volontaire/, n2: 'A1' },
  { re: /violence/, n2: 'A3' },
  { re: /destruction|degradation|incendie/, n2: 'B7' },
  { re: /\bvol\b|\bvols\b/, n2: 'B2' },
  { re: /stationnement/, n2: 'I9' },
  { re: /alcool|alcoolemie|delit de fuite|refus d.obtemperer/, n2: 'I2' },
  { re: /permis de conduire/, n2: 'I1' },
];

// ── 1. Corrections explicites par n° NATINF ───────────────────────────────────
// À compléter au fil des cas signalés (« ce code devrait être en X »).
const CODE_TO_N2: Record<string, string> = {};

/** Code NATAFF N2 déduit d'un NATINF, ou undefined si non classé. */
function resolveN2Code(entry: Pick<NatinfEntry, 'code' | 'theme' | 'libelle'>): string | undefined {
  const override = CODE_TO_N2[entry.code];
  if (override) return override;

  const fromTheme = entry.theme ? THEME_TO_N2[norm(entry.theme)] : undefined;
  if (fromTheme) return fromTheme;

  const lib = norm(entry.libelle);
  for (const { re, n2 } of KEYWORD_RULES) {
    if (re.test(lib)) return n2;
  }
  return undefined;
}

/** Résout un NATINF vers sa NATAFF (N2 + N1 parent), ou undefined. */
export function nataffForEntry(
  entry: Pick<NatinfEntry, 'code' | 'theme' | 'libelle'> | undefined | null,
): NataffResolution | undefined {
  if (!entry) return undefined;
  const n2code = resolveN2Code(entry);
  if (!n2code) return undefined;
  const n2 = N2_BY_CODE.get(n2code);
  if (!n2) return undefined;
  const n1 = N1_BY_CODE.get(n2.n1);
  if (!n1) return undefined;
  return { n2, n1 };
}

/** Accès direct à une sous-catégorie N2 par son code. */
export function nataffN2(code: string): NataffN2 | undefined {
  return N2_BY_CODE.get(code);
}

/** Accès direct à une catégorie N1 par son code. */
export function nataffN1(code: string): NataffN1 | undefined {
  return N1_BY_CODE.get(code);
}
