/**
 * SIRAL — Catalogue des « Autres actes » (Techniques Spéciales d'Enquête)
 * côté service Attaché.
 *
 * ⚠ MIROIR de `config/acteTypes.ts`. Le conteneur de l'Attaché ne copie que
 * `scripts/` (voir Dockerfile.attache) : il ne peut PAS importer le fichier TS
 * de l'application. Ce module reprend donc le SQUELETTE LÉGAL des catégories
 * (clé, libellé, durée, unité, autorisation, plafond de prolongations) —
 * strictement suffisant pour que l'agent enregistre un acte AVEC sa clé de
 * catégorie et ses champs pré-remplis, exactement comme le fait la fenêtre
 * « Ajouter un acte » de l'app (components/modals/ActeModal.tsx).
 *
 * TOUTE modification des clés / durées / autorisations doit être répercutée
 * dans `config/acteTypes.ts` (et réciproquement). Les 12 catégories
 * correspondent à des régimes légaux du CPP : elles changent rarement.
 */

/**
 * @typedef {Object} AutreActeSkeleton
 * @property {string}  label
 * @property {boolean} hasDuree           false = pas de délai propre (art. 76)
 * @property {number} [duree]             durée légale fixe ; absent = durée libre (procureur)
 * @property {'jours'|'mois'|'heures'} [dureeUnit]
 * @property {number}  maxProlongations   0 = aucune, 1 = une fois, -1 = sans limite explicite
 * @property {'JLD'|'procureur'} autorisation
 */

/** @type {Record<string, AutreActeSkeleton>} */
export const AUTRE_ACTE_TYPES = {
  art76: {
    label: 'Article 76 (acte de procédure préliminaire)',
    hasDuree: false, maxProlongations: 0, autorisation: 'JLD',
  },
  imsi_donnees: {
    label: 'IMSI-Catcher — Recueil de données (art. 706-95-4 CPP)',
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'JLD',
  },
  imsi_interceptions: {
    label: 'IMSI-Catcher — Interceptions de communication (art. 706-95-4 CPP)',
    hasDuree: true, duree: 48, dureeUnit: 'heures', maxProlongations: 1, autorisation: 'JLD',
  },
  captation_images_public: {
    label: "Captation d'images et sonorisation — Lieux publics",
    hasDuree: true, duree: undefined, maxProlongations: -1, autorisation: 'procureur',
  },
  captation_images_prive: {
    label: "Captation d'images — Lieux privés (y compris hors art. 59)",
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'JLD',
  },
  sonorisation_prive: {
    label: 'Sonorisation — Lieux privés (y compris hors art. 59)',
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'JLD',
  },
  drone_public: {
    label: "Captation d'images par drone/aéronef — Lieux publics",
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'procureur',
  },
  drone_prive: {
    label: "Captation d'images par drone/aéronef — Lieux privés",
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'JLD',
  },
  captation_donnees_informatiques: {
    label: 'Captation de données informatiques (key logger)',
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'JLD',
  },
  activation_fixe: {
    label: 'Activation à distance — Appareil fixe (art. 706-102-1 CPP)',
    hasDuree: true, duree: 1, dureeUnit: 'mois', maxProlongations: 1, autorisation: 'JLD',
  },
  activation_mobile: {
    label: 'Activation à distance — Appareil mobile (art. 706-102-1 CPP)',
    hasDuree: true, duree: 15, dureeUnit: 'jours', maxProlongations: 1, autorisation: 'JLD',
  },
  infiltration: {
    label: 'Infiltration (art. 706-81 à 706-87-1 CPP)',
    hasDuree: true, duree: 4, dureeUnit: 'mois', maxProlongations: -1, autorisation: 'procureur',
  },
}

/** Clés du catalogue, dans l'ordre du menu déroulant de l'app. */
export const AUTRE_ACTE_TYPE_KEYS = Object.keys(AUTRE_ACTE_TYPES)

/** Normalisation robuste : sans accents, minuscules, séparateurs → espaces. */
function norm(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Fait correspondre une valeur `type` LIBRE (ce que le modèle a écrit :
 * « Article 76 », « art. 76 », « sonorisation », « IMSI interceptions »,
 * « 706-95-4 »…) à l'une des 12 clés du catalogue. Conservateur : ne renvoie
 * une clé que sur correspondance FIABLE, sinon `null` (l'acte reste alors un
 * acte libre, hors catégorie — ex. comparution art. 78).
 *
 * @param {string} input
 * @returns {string|null} une clé de AUTRE_ACTE_TYPES, ou null
 */
export function resolveAutreActeTypeKey(input) {
  const raw = String(input || '').trim()
  if (!raw) return null

  // 1) Déjà une clé exacte
  if (AUTRE_ACTE_TYPES[raw]) return raw
  const t = norm(raw)
  if (!t) return null
  const key = t.replace(/ /g, '_')
  if (AUTRE_ACTE_TYPES[key]) return key

  // 2) Libellé exact d'une catégorie
  for (const k of AUTRE_ACTE_TYPE_KEYS) {
    if (norm(AUTRE_ACTE_TYPES[k].label) === t) return k
  }

  // 3) Heuristiques par mots-clés — du plus spécifique au plus général
  const tokens = t.split(' ')
  const has = (w) => t.includes(w)
  const hasTok = (w) => tokens.includes(w)

  if (has('infiltration') || has('706 81')) return 'infiltration'

  if (has('key logger') || has('keylogger') ||
      (has('captation') && has('donnees') && has('informatique')) ||
      (has('donnees') && has('informatique'))) {
    return 'captation_donnees_informatiques'
  }

  if (has('imsi') || has('706 95 4')) {
    return (has('interception') || has('communication')) ? 'imsi_interceptions' : 'imsi_donnees'
  }

  if (has('drone') || has('aeronef')) {
    return has('prive') ? 'drone_prive' : 'drone_public'
  }

  if (has('activation') || has('706 102 1')) {
    if (has('mobile')) return 'activation_mobile'
    if (has('fixe')) return 'activation_fixe'
    return null // « activation » sans support précisé : trop ambigu
  }

  if (has('sonorisation') && !has('captation')) return 'sonorisation_prive'

  if (has('captation') && (has('image') || has('sonorisation'))) {
    return has('public') ? 'captation_images_public' : 'captation_images_prive'
  }

  // art. 76 : « 76 » comme mot isolé (jamais « 706 »/« 706-95 »), ou intitulé explicite
  if (has('procedure preliminaire') ||
      (hasTok('76') && !has('706') && !hasTok('706'))) {
    return 'art76'
  }

  return null
}

/** Ajoute `n` unités (jours|mois) à une date AAAA-MM-JJ — même calcul que le
 *  reste du service (cf. enregistrerActe). Renvoie '' si entrée invalide. */
function addDuree(debut, n, unit) {
  const d = Number(n)
  if (!Number.isFinite(d) || d <= 0 || !debut) return ''
  const end = new Date(debut + 'T00:00:00')
  if (Number.isNaN(end.getTime())) return ''
  if (unit === 'mois') end.setMonth(end.getMonth() + d)
  else end.setDate(end.getDate() + d)
  return end.toISOString().slice(0, 10)
}

/**
 * Calcule les champs d'un acte à partir de sa catégorie, en reproduisant la
 * logique de components/modals/ActeModal.tsx :
 *  - art. 76 (sans durée)          → statut « en_cours », pas de date de fin.
 *  - mesure JLD en attente          → statut « autorisation_pending ».
 *  - mesure à durée, autorisée      → statut « pose_pending », date de fin
 *                                     calculée depuis la date de début.
 *
 * L'unité « heures » (IMSI interceptions) est ramenée à « jours » pour le
 * stockage, comme le fait l'app (BaseActe.dureeUnit ∈ {jours, mois}).
 *
 * @param {AutreActeSkeleton} cfg
 * @param {{ dateDebut?: string, duree?: number|string, pendingJld?: boolean }} [opts]
 */
export function deriveAutreActeFields(cfg, opts = {}) {
  const dureeUnit = cfg.dureeUnit === 'mois' ? 'mois' : 'jours'
  // Durée effective : la durée légale fixe prime ; sinon la valeur fournie
  // (types à durée libre : captation en lieux publics).
  const effectiveDuree = cfg.duree !== undefined ? String(cfg.duree) : String(opts.duree ?? '')
  const maxProlongations = cfg.maxProlongations

  if (!cfg.hasDuree) {
    return { statut: 'en_cours', dateDebut: '', dateFin: '', duree: '', dureeUnit, maxProlongations, datePose: '' }
  }

  const pendingJld = opts.pendingJld === true && cfg.autorisation === 'JLD'
  if (pendingJld) {
    return { statut: 'autorisation_pending', dateDebut: '', dateFin: '', duree: effectiveDuree || '0', dureeUnit, maxProlongations, datePose: '' }
  }

  const dateDebut = opts.dateDebut || new Date().toISOString().slice(0, 10)
  const dateFin = addDuree(dateDebut, effectiveDuree, dureeUnit)
  // Mesure autorisée mais pas encore posée : en attente de pose, comme dans l'app.
  return { statut: 'pose_pending', dateDebut, dateFin, duree: effectiveDuree || '0', dureeUnit, maxProlongations, datePose: '' }
}
