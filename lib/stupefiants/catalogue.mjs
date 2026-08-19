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
