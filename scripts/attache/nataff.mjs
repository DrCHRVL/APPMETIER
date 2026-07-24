/**
 * SIRAL — Attaché de justice · NATINF → catégorie métier (statistiques).
 *
 * MIROIR SERVEUR de lib/natinf/nataff.ts (même taxonomie Mémento parquet,
 * mêmes règles de découpage) : les agrégats par catégorie d'infraction que
 * l'attaché calcule (outil stats_synthese) doivent donner EXACTEMENT les
 * mêmes libellés que la page Statistiques de l'app (Vol, Stupéfiants,
 * Blanchiment…). Toute évolution de lib/natinf/nataff.ts doit être reportée
 * ici (et réciproquement).
 */

export const GRAND_TITRES = [
  { code: 'PERSONNES', label: 'Atteintes aux personnes' },
  { code: 'BIENS', label: 'Atteintes aux biens' },
  { code: 'ETAT', label: "Atteinte à l'autorité de l'État" },
  { code: 'ETRANGERS', label: 'Infractions à la législation sur les étrangers (ILE)' },
  { code: 'STUP', label: 'Stupéfiants' },
  { code: 'ECOFI', label: 'Économique et financier' },
  { code: 'CIRCULATION', label: 'Circulation et transports' },
]
const GRAND_TITRE_BY_CODE = new Map(GRAND_TITRES.map((g) => [g.code, g]))

export const STAT_CATEGORIES = [
  { code: 'VIOLENCES', label: 'Violences', grandTitre: 'PERSONNES' },
  { code: 'MENACES', label: 'Menaces', grandTitre: 'PERSONNES' },
  { code: 'ATT_INVOL', label: 'Atteintes involontaires', grandTitre: 'PERSONNES' },
  { code: 'AUTRES_VOL', label: 'Autres atteintes volontaires', grandTitre: 'PERSONNES' },
  { code: 'VIOL', label: 'Viol', grandTitre: 'PERSONNES' },
  { code: 'AGRESSION', label: 'Agression sexuelle', grandTitre: 'PERSONNES' },
  { code: 'ATT_SEX_MINEUR', label: 'Atteinte sexuelle sur mineur', grandTitre: 'PERSONNES' },
  { code: 'EXHIB', label: 'Exhibition / harcèlement sexuel', grandTitre: 'PERSONNES' },
  { code: 'PEDOPORNO', label: 'Pédopornographie', grandTitre: 'PERSONNES' },
  { code: 'PROXENETISME', label: 'Proxénétisme / prostitution', grandTitre: 'PERSONNES' },
  { code: 'AUTRES_SEX', label: 'Autres infractions sexuelles', grandTitre: 'PERSONNES' },
  { code: 'HARCELEMENT', label: 'Harcèlement', grandTitre: 'PERSONNES' },
  { code: 'VIE_PRIVEE', label: 'Vie privée', grandTitre: 'PERSONNES' },
  { code: 'FAMILLE', label: 'Famille', grandTitre: 'PERSONNES' },
  { code: 'VOL', label: 'Vol', grandTitre: 'BIENS' },
  { code: 'RECEL', label: 'Recel', grandTitre: 'BIENS' },
  { code: 'EXTORSION', label: 'Extorsion', grandTitre: 'BIENS' },
  { code: 'DESTRUCTION', label: 'Destruction / dégradation', grandTitre: 'BIENS' },
  { code: 'DESTRUCTION_INVOL', label: 'Destruction involontaire', grandTitre: 'BIENS' },
  { code: 'AUTORITE_ETAT', label: "Autorité de l'État", grandTitre: 'ETAT' },
  { code: 'POST_SENTENCIEL', label: 'Post-sentenciel', grandTitre: 'ETAT' },
  { code: 'ASSOC', label: 'Association de malfaiteurs', grandTitre: 'ETAT' },
  { code: 'ARMES', label: 'Armes (ILA)', grandTitre: 'ETAT' },
  { code: 'TERRORISME', label: 'Terrorisme', grandTitre: 'ETAT' },
  { code: 'FAUX', label: 'Faux', grandTitre: 'ETAT' },
  { code: 'OUTRAGE', label: 'Outrage / rébellion', grandTitre: 'ETAT' },
  { code: 'ILE', label: 'Étrangers (ILE)', grandTitre: 'ETRANGERS' },
  { code: 'STUP', label: 'Trafic de stupéfiants (ILS)', grandTitre: 'STUP' },
  { code: 'ESCROQUERIE', label: 'Escroquerie', grandTitre: 'ECOFI' },
  { code: 'ABUS_CONFIANCE', label: 'Abus de confiance', grandTitre: 'ECOFI' },
  { code: 'BLANCHIMENT', label: 'Blanchiment', grandTitre: 'ECOFI' },
  { code: 'MOYENS_PAIEMENT', label: 'Moyens de paiement', grandTitre: 'ECOFI' },
  { code: 'TRAVAIL_ILLEGAL', label: 'Travail illégal / vente sauvette', grandTitre: 'ECOFI' },
  { code: 'ILT', label: 'Tabac (ILT)', grandTitre: 'ECOFI' },
  { code: 'AUTRES_ECOFI', label: 'Autres écofi', grandTitre: 'ECOFI' },
  { code: 'CIRCULATION', label: 'Circulation routière', grandTitre: 'CIRCULATION' },
  { code: 'TRANSPORTS', label: 'Transports', grandTitre: 'CIRCULATION' },
]
const CAT_BY_CODE = new Map(STAT_CATEGORIES.map((c) => [c.code, c]))

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const THEME_TO_CAT_RAW = {
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
}
const THEME_TO_CAT = Object.fromEntries(Object.entries(THEME_TO_CAT_RAW).map(([k, v]) => [norm(k), v]))

const THEME_SEXUEL = norm('Infractions sexuelles')
const THEME_ECOFI = norm('Économique et financier (écofi)')

function splitSexuel(lib) {
  if (/proxenet|prostitution|racolage/.test(lib)) return 'PROXENETISME'
  if (/pedoporno|pornograph|image.*mineur/.test(lib)) return 'PEDOPORNO'
  if (/\bviol\b|viol /.test(lib)) return 'VIOL'
  if (/agression sexuelle/.test(lib)) return 'AGRESSION'
  if (/atteinte sexuelle|incitation|proposition sexuelle|corruption de mineur/.test(lib)) return 'ATT_SEX_MINEUR'
  if (/exhibition|harcelement sexuel/.test(lib)) return 'EXHIB'
  return 'AUTRES_SEX'
}

function splitEcofi(lib) {
  if (/tabac/.test(lib)) return 'ILT'
  if (/blanchiment/.test(lib)) return 'BLANCHIMENT'
  if (/escroquerie|filouterie|abus de faiblesse/.test(lib)) return 'ESCROQUERIE'
  if (/abus de confiance|detournement/.test(lib)) return 'ABUS_CONFIANCE'
  if (/cheque|carte de paiement|moyen de paiement|monnaie/.test(lib)) return 'MOYENS_PAIEMENT'
  if (/travail (dissimule|illegal)|sauvette/.test(lib)) return 'TRAVAIL_ILLEGAL'
  return 'AUTRES_ECOFI'
}

const KEYWORD_FALLBACK = [
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
]

// Codes ILE : dans les données, ces codes portent à tort le thème « Armes » —
// même liste d'overrides que lib/natinf/nataff.ts.
const ILE_CODES = [
  '16', '22098', '29525', '29526', '29527', '29528', '29529', '30739',
  '22174', '6310', '6311', '26357', '30740', '6312', '6313', '30741',
  '29524', '31534', '31513', '31514',
]
const CODE_TO_CAT = Object.fromEntries(ILE_CODES.map((c) => [c, 'ILE']))

function resolveCategoryCode(entry) {
  const override = CODE_TO_CAT[String(entry.code)]
  if (override) return override
  const lib = norm(entry.libelle)
  const theme = norm(entry.theme)
  if (theme === THEME_SEXUEL) return splitSexuel(lib)
  if (theme === THEME_ECOFI) return splitEcofi(lib)
  if (theme && THEME_TO_CAT[theme]) return THEME_TO_CAT[theme]
  for (const { re, cat } of KEYWORD_FALLBACK) {
    if (re.test(lib)) return cat
  }
  return undefined
}

/**
 * Catégorie métier d'un NATINF ({ code, libelle, theme }) :
 * { code, label, grandTitre: { code, label } } — ou null si non classé.
 * Même résolution que categoryForEntry (lib/natinf/nataff.ts).
 */
export function categorieNatinf(entry) {
  if (!entry) return null
  const code = resolveCategoryCode(entry)
  if (!code) return null
  const category = CAT_BY_CODE.get(code)
  if (!category) return null
  const grandTitre = GRAND_TITRE_BY_CODE.get(category.grandTitre)
  return { code: category.code, label: category.label, grandTitre: grandTitre || null }
}

/** Libellé de catégorie, avec le même repli que l'app (« Autres / non classé »). */
export function labelCategorie(entry) {
  return categorieNatinf(entry)?.label || 'Autres / non classé'
}
