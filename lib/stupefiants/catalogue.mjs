/**
 * SIRAL — référentiel des produits stupéfiants saisis.
 *
 * Module JavaScript pur (aucune dépendance) : utilisé par l'interface (bundle
 * Next) comme par lib/stats/audienceCore.mjs et le service attaché.
 *
 * Historique : les saisies ne connaissaient que cinq cases à cocher
 * (`TypeStupefiant` = cocaine | heroine | cannabis | synthese | autre), avec
 * UNE quantité en texte libre pour l'ensemble. Le référentiel ci-dessous
 * détaille les produits et porte la quantité PAR produit ; le champ historique
 * `types` reste alimenté (dérivé de `produits`) pour que les anciennes lectures
 * et les statistiques existantes continuent de fonctionner.
 *
 * Les cinq codes historiques sont conservés comme entrées « nature non
 * précisée » : une donnée ancienne se relit telle quelle, sans rien inventer.
 */

/** Unités de mesure proposées pour une quantité saisie. */
export const UNITES_STUPEFIANT = [
  { code: 'g', label: 'g', pluriel: 'g' },
  { code: 'kg', label: 'kg', pluriel: 'kg' },
  { code: 'comprime', label: 'comprimé(s)', pluriel: 'comprimés' },
  { code: 'unite', label: 'unité(s)', pluriel: 'unités' },
  { code: 'plant', label: 'plant(s)', pluriel: 'plants' },
  { code: 'dose', label: 'dose(s)', pluriel: 'doses' },
  { code: 'ml', label: 'ml', pluriel: 'ml' },
  { code: 'l', label: 'L', pluriel: 'L' },
]

const UNITES_INDEX = new Map(UNITES_STUPEFIANT.map((u) => [u.code, u]))

/** Familles servant de regroupement dans le sélecteur. */
export const FAMILLES_STUPEFIANT = [
  'Cocaïne et dérivés',
  'Opiacés',
  'Cannabis',
  'Drogues de synthèse',
  'Autres produits',
]

/**
 * Catalogue des produits.
 *  - `legacy`  : case historique alimentée dans `StupefiantSaisi.types` ;
 *                mapping strict (aucune extrapolation : ce qui ne correspond
 *                pas exactement à une des cinq cases retombe sur 'autre').
 *  - `unite`   : unité proposée par défaut, modifiable à la saisie.
 *  - `alias`   : termes de recherche supplémentaires (argot, noms de rue).
 */
export const PRODUITS_STUPEFIANT = [
  // ── Cocaïne et dérivés
  { code: 'cocaine', libelle: 'Cocaïne', famille: 'Cocaïne et dérivés', legacy: 'cocaine', unite: 'g', alias: ['coke', 'chlorhydrate'] },
  { code: 'crack', libelle: 'Crack / cocaïne base', famille: 'Cocaïne et dérivés', legacy: 'cocaine', unite: 'g', alias: ['galette', 'free base', 'caillou'] },

  // ── Opiacés
  { code: 'heroine', libelle: 'Héroïne', famille: 'Opiacés', legacy: 'heroine', unite: 'g', alias: ['brown sugar', 'came'] },
  { code: 'opium', libelle: 'Opium / rachacha', famille: 'Opiacés', legacy: 'autre', unite: 'g', alias: ['pavot'] },
  { code: 'opioides_synthese', libelle: 'Opioïdes de synthèse (fentanyl, nitazènes…)', famille: 'Opiacés', legacy: 'synthese', unite: 'g', alias: ['fentanyl', 'nitazene', 'carfentanil'] },
  { code: 'medicaments_opiaces', libelle: 'Médicaments opiacés détournés (méthadone, Skenan, tramadol…)', famille: 'Opiacés', legacy: 'autre', unite: 'comprime', alias: ['subutex', 'buprenorphine', 'codeine', 'morphine'] },

  // ── Cannabis
  { code: 'cannabis', libelle: 'Cannabis (nature non précisée)', famille: 'Cannabis', legacy: 'cannabis', unite: 'g', alias: [] },
  { code: 'cannabis_herbe', libelle: 'Cannabis — herbe', famille: 'Cannabis', legacy: 'cannabis', unite: 'g', alias: ['beuh', 'weed', 'marijuana'] },
  { code: 'cannabis_resine', libelle: 'Cannabis — résine', famille: 'Cannabis', legacy: 'cannabis', unite: 'g', alias: ['shit', 'haschich', 'hash', 'savonnette'] },
  { code: 'cannabis_huile', libelle: 'Cannabis — huile / concentré', famille: 'Cannabis', legacy: 'cannabis', unite: 'g', alias: ['wax', 'rosin', 'thc'] },
  { code: 'cannabis_plants', libelle: 'Plants de cannabis', famille: 'Cannabis', legacy: 'cannabis', unite: 'plant', alias: ['culture', 'plantation', 'pieds'] },

  // ── Drogues de synthèse
  { code: 'synthese', libelle: 'Drogue de synthèse (nature non précisée)', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'g', alias: [] },
  { code: 'mdma', libelle: 'MDMA / ecstasy', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'comprime', alias: ['taz', 'xtc', 'cachet'] },
  { code: 'amphetamine', libelle: 'Amphétamines (speed)', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'g', alias: ['speed', 'amph'] },
  { code: 'methamphetamine', libelle: 'Méthamphétamine (crystal)', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'g', alias: ['crystal', 'ice', 'meth'] },
  { code: 'ketamine', libelle: 'Kétamine', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'g', alias: ['keta', 'ket'] },
  { code: 'lsd', libelle: 'LSD (buvards)', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'unite', alias: ['acide', 'buvard', 'trip'] },
  { code: 'ghb_gbl', libelle: 'GHB / GBL', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'ml', alias: ['drogue du violeur'] },
  { code: 'cathinones', libelle: 'Cathinones de synthèse (3-MMC, 4-MMC…)', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'g', alias: ['3mmc', '4mmc', '3cmc', 'mephedrone'] },
  { code: 'cannabinoides_synthese', libelle: 'Cannabinoïdes de synthèse', famille: 'Drogues de synthèse', legacy: 'synthese', unite: 'g', alias: ['spice', 'buddha blue', 'hhc'] },

  // ── Autres produits
  { code: 'champignons', libelle: 'Champignons hallucinogènes', famille: 'Autres produits', legacy: 'autre', unite: 'g', alias: ['psilocybe', 'psilocybine'] },
  { code: 'medicaments_detournes', libelle: 'Médicaments détournés (Rivotril, prégabaline…)', famille: 'Autres produits', legacy: 'autre', unite: 'comprime', alias: ['lyrica', 'benzodiazepine', 'artane'] },
  { code: 'protoxyde_azote', libelle: 'Protoxyde d\'azote', famille: 'Autres produits', legacy: 'autre', unite: 'unite', alias: ['proto', 'cartouche', 'ballon'] },
  { code: 'produits_coupage', libelle: 'Produits de coupage', famille: 'Autres produits', legacy: 'autre', unite: 'g', alias: ['phenacetine', 'levamisole', 'creatine'] },
  { code: 'precurseurs', libelle: 'Précurseurs chimiques', famille: 'Autres produits', legacy: 'autre', unite: 'l', alias: ['laboratoire', 'apaan', 'bmk'] },
  { code: 'autre', libelle: 'Autre produit stupéfiant', famille: 'Autres produits', legacy: 'autre', unite: 'g', alias: [] },
]

const PRODUITS_INDEX = new Map(PRODUITS_STUPEFIANT.map((p) => [p.code, p]))

/** Préfixe des produits saisis en texte libre (hors référentiel). */
export const PREFIXE_PRODUIT_LIBRE = 'libre:'

/** Vrai si le code désigne un produit saisi en texte libre. */
export function estProduitLibre(code) {
  return typeof code === 'string' && code.startsWith(PREFIXE_PRODUIT_LIBRE)
}

/** Entrée du catalogue pour un code, ou undefined (produit libre / inconnu). */
export function getProduitStupefiant(code) {
  return PRODUITS_INDEX.get(code)
}

/** Libellé affichable d'un produit saisi (référentiel, libre, ou code brut). */
export function libelleProduit(produit) {
  if (!produit) return ''
  const entree = PRODUITS_INDEX.get(produit.code)
  if (entree) return entree.libelle
  if (produit.libelle) return produit.libelle
  if (estProduitLibre(produit.code)) return produit.code.slice(PREFIXE_PRODUIT_LIBRE.length)
  return produit.code
}

/** Libellé court d'une unité (« g », « comprimés »…). */
export function libelleUnite(code, quantite) {
  const unite = UNITES_INDEX.get(code)
  if (!unite) return code || ''
  return (quantite ?? 0) > 1 ? unite.pluriel : unite.label
}

/** Rendu « 250 g », « 3 plants », ou '' si aucune quantité n'est renseignée. */
export function formatQuantite(produit) {
  if (!produit || produit.quantite === undefined || produit.quantite === null || produit.quantite === '') return ''
  const q = Number(produit.quantite)
  if (!Number.isFinite(q) || q <= 0) return ''
  const affichage = Number.isInteger(q) ? String(q) : String(q).replace('.', ',')
  const unite = libelleUnite(produit.unite || 'g', q)
  return `${affichage} ${unite}`.trim()
}

// ── Conversions et agrégation des quantités ──

/**
 * Famille de mesure d'une unité : les quantités ne s'additionnent qu'à
 * l'intérieur d'une même famille (250 g + 1,5 kg = 1,75 kg ; 3 plants restent
 * 3 plants).
 */
export const FAMILLE_UNITE = {
  g: 'masse',
  kg: 'masse',
  ml: 'volume',
  l: 'volume',
  comprime: 'comptage',
  unite: 'comptage',
  plant: 'comptage',
  dose: 'comptage',
}

/** Unités de comptage, conservées séparément (un comprimé n'est pas un plant). */
export const UNITES_COMPTAGE = ['comprime', 'unite', 'plant', 'dose']

const quantiteValide = (produit) => {
  const q = Number(produit?.quantite)
  return Number.isFinite(q) && q > 0 ? q : 0
}

/** Quantité convertie en grammes, ou 0 si l'unité n'est pas une masse. */
export function enGrammes(produit) {
  const q = quantiteValide(produit)
  if (!q) return 0
  const unite = produit.unite || 'g'
  if (unite === 'kg') return q * 1000
  if (unite === 'g') return q
  return 0
}

/** Quantité convertie en millilitres, ou 0 si l'unité n'est pas un volume. */
export function enMillilitres(produit) {
  const q = quantiteValide(produit)
  if (!q) return 0
  const unite = produit.unite || 'g'
  if (unite === 'l') return q * 1000
  if (unite === 'ml') return q
  return 0
}

/** Arrondi à `decimales` chiffres, sans zéros inutiles, séparateur français. */
const nombreFr = (n, decimales = 1) => {
  const arrondi = Math.round(n * 10 ** decimales) / 10 ** decimales
  return String(arrondi).replace('.', ',')
}

/** « 1,75 kg » au-delà du kilo, « 250 g » en deçà, '' si rien. */
export function formatMasse(grammes) {
  if (!grammes) return ''
  return grammes >= 1000 ? `${nombreFr(grammes / 1000, 2)} kg` : `${nombreFr(grammes)} g`
}

/** « 2,5 L » au-delà du litre, « 400 ml » en deçà, '' si rien. */
export function formatVolume(millilitres) {
  if (!millilitres) return ''
  return millilitres >= 1000 ? `${nombreFr(millilitres / 1000, 2)} L` : `${nombreFr(millilitres)} ml`
}

/** Crée un accumulateur de quantités vide (masse, volume, comptages). */
export function totauxStupefiantsVides() {
  const comptages = {}
  for (const u of UNITES_COMPTAGE) comptages[u] = 0
  return { masseG: 0, volumeMl: 0, comptages }
}

/** Ajoute un produit saisi à un accumulateur (mutation contrôlée). */
export function ajouterAuxTotaux(totaux, produit) {
  totaux.masseG += enGrammes(produit)
  totaux.volumeMl += enMillilitres(produit)
  const unite = produit?.unite || 'g'
  if (UNITES_COMPTAGE.includes(unite)) {
    totaux.comptages[unite] = (totaux.comptages[unite] || 0) + quantiteValide(produit)
  }
  return totaux
}

/** Vrai si l'accumulateur ne porte aucune quantité chiffrée. */
export function totauxVides(totaux) {
  if (!totaux) return true
  if (totaux.masseG > 0 || totaux.volumeMl > 0) return false
  return !UNITES_COMPTAGE.some((u) => (totaux.comptages?.[u] || 0) > 0)
}

/**
 * Rendu lisible d'un accumulateur : « 1,75 kg + 12 plants ». Renvoie '' si
 * aucune quantité n'a été chiffrée (produits retenus sans pesée).
 */
export function formatTotaux(totaux) {
  if (!totaux) return ''
  const morceaux = []
  const masse = formatMasse(totaux.masseG)
  if (masse) morceaux.push(masse)
  const volume = formatVolume(totaux.volumeMl)
  if (volume) morceaux.push(volume)
  for (const u of UNITES_COMPTAGE) {
    const n = totaux.comptages?.[u] || 0
    if (n > 0) morceaux.push(`${nombreFr(n)} ${libelleUnite(u, n)}`)
  }
  return morceaux.join(' + ')
}

const sansAccents = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Recherche par libellé, code ou alias (insensible aux accents et à la casse).
 * `exclure` : codes déjà retenus, retirés des propositions.
 */
export function chercherProduitStupefiant(requete, { exclure = [], limit = 20 } = {}) {
  const q = sansAccents(requete).trim()
  const dejaPris = new Set(exclure)
  const candidats = PRODUITS_STUPEFIANT.filter((p) => !dejaPris.has(p.code))
  if (!q) return candidats.slice(0, limit)

  const scores = []
  for (const p of candidats) {
    const libelle = sansAccents(p.libelle)
    const cible = [libelle, p.code, ...(p.alias || []).map(sansAccents)].join(' ')
    if (!cible.includes(q)) continue
    // Un début de libellé remonte avant une correspondance au milieu ou un alias.
    const score = libelle.startsWith(q) ? 0 : libelle.includes(q) ? 1 : 2
    scores.push({ p, score })
  }
  scores.sort((a, b) => a.score - b.score || a.p.libelle.localeCompare(b.p.libelle, 'fr'))
  return scores.slice(0, limit).map((s) => s.p)
}

/** Case historique correspondant à un produit (mapping strict). */
export function typeLegacyProduit(code) {
  const entree = PRODUITS_INDEX.get(code)
  return entree ? entree.legacy : 'autre'
}

/** Crée une ligne produit prête à l'édition (quantité laissée vide). */
export function creerProduitStupefiant(code, libelle) {
  const entree = PRODUITS_INDEX.get(code)
  const produit = { code, unite: entree ? entree.unite : 'g' }
  if (!entree && libelle) produit.libelle = libelle
  return produit
}

/**
 * Normalise un bloc stupéfiants :
 *  - reconstruit `produits` depuis l'ancien format (cases à cocher) ;
 *  - redérive `types` depuis `produits` (compat des anciennes lectures) ;
 *  - renvoie undefined si le bloc ne porte plus rien.
 *
 * L'ancienne quantité globale en texte libre (« 5 kg ») n'est jamais convertie
 * en nombre : elle est reportée sur la précision du produit quand il n'y en a
 * qu'un — sinon conservée telle quelle dans `quantite`, pour ne rien perdre.
 */
export function normaliserStupefiants(brut) {
  if (!brut) return undefined

  let produits = Array.isArray(brut.produits) ? brut.produits.filter((p) => p && p.code) : []
  let quantiteLegacy = typeof brut.quantite === 'string' ? brut.quantite.trim() : ''

  if (produits.length === 0) {
    const types = Array.isArray(brut.types) ? brut.types.filter(Boolean) : []
    produits = types.map((t) => creerProduitStupefiant(t))
    // Une seule case cochée : la quantité libre se rattache sans ambiguïté.
    if (produits.length === 1 && quantiteLegacy) {
      produits[0].precision = quantiteLegacy
      quantiteLegacy = ''
    }
  }

  if (produits.length === 0) return undefined

  const types = []
  for (const p of produits) {
    const legacy = typeLegacyProduit(p.code)
    if (!types.includes(legacy)) types.push(legacy)
  }

  const normalise = { types, produits }
  if (quantiteLegacy) normalise.quantite = quantiteLegacy
  if (brut.description) normalise.description = brut.description
  return normalise
}
