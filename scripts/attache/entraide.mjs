/**
 * SIRAL — Attaché de justice · module ENTRAIDE INTERNATIONALE (lecture et
 * écritures) pour le connecteur Claude web.
 *
 * Mêmes données que l'écran : coffre global `entraide` (registre PARTAGÉ —
 * demandes, autorités étrangères, services, signataires). Même logique :
 * l'étape et les échéances se DÉDUISENT de la chronologie
 * (lib/entraide/core.mjs) ; les chiffres viennent de lib/stats/entraideCore.mjs.
 *
 * Contrat de synchronisation (utils/dataSync/EntraideSyncService.ts) : fusion
 * par id, la `dateMiseAJour` la plus récente gagne. On bumpe donc
 * `dateMiseAJour` de chaque fiche touchée ; writeVault archive la version
 * précédente — toute écriture est réversible.
 */
import { attacheTj, readVault, writeVault, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import {
  aujourdhui, estDate, etatDemande, prochainesActions, cleUrgence, chercherAutorites,
  normaliser, texteRecherche, dateFr, EVENEMENT_LABELS, TYPE_LABELS, ETAPE_LABELS,
} from '../../lib/entraide/core.mjs'
import { paysDe, MESURES, SERVICES_DEPART } from '../../lib/entraide/referentiels.mjs'
import { computeEntraideStats } from '../../lib/stats/entraideCore.mjs'

const VAULT = 'entraide'
const TYPES = ['dee', 'do', 'cri', 'execution', 'civil']
const SENS = ['recue', 'emise']
export const EVENEMENTS_ENTRAIDE = Object.keys(EVENEMENT_LABELS)

const vide = () => ({ demandes: [], autorites: [], services: [], signataires: [], tombstones: [] })

function lire(keys) {
  const env = readVault(attacheTj(), VAULT)
  if (!env) return { data: vide(), version: 0, existe: false }
  const p = decryptJson(keys.global, env) || {}
  return {
    data: {
      demandes: p.demandes || [], autorites: p.autorites || [], services: p.services || [],
      signataires: p.signataires || [], tombstones: p.tombstones || [],
    },
    version: p.version || 0,
    existe: true,
  }
}

async function ecrire(keys, fn) {
  return withFileLock('entraide:write', async () => {
    const { data, version, existe } = lire(keys)
    if (!existe && !data.services.length) {
      const t = new Date().toISOString()
      data.services = SERVICES_DEPART.map((s) => ({ ...s, dateMiseAJour: t }))
    }
    const resultat = fn(data)
    const auteur = keys?.grantedBy || 'admin'
    const payload = { ...data, version: version + 1, updatedAt: new Date().toISOString(), updatedBy: `${auteur} (connecteur)` }
    await writeVault(attacheTj(), VAULT, encryptJson(keys.global, payload, { savedAt: payload.updatedAt, savedBy: auteur }), auteur)
    return resultat
  })
}

let seq = 0
const nouvelId = (p) => `${p}${Date.now().toString(36)}${(seq++ % 1296).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const maintenant = () => new Date().toISOString()

function date(v, champ) {
  if (v === undefined || v === null || v === '') return undefined
  const s = String(v).trim().slice(0, 10)
  if (!estDate(s)) throw new Error(`${champ} : date attendue au format AAAA-MM-JJ (reçu « ${v} »)`)
  return s
}

function trouver(data, ref) {
  const w = normaliser(ref).replace(/\s+/g, '')
  const hits = data.demandes.filter((d) => d.id === ref || normaliser(d.refEsabora).replace(/\s+/g, '') === w)
  if (!hits.length) throw new Error(`Demande « ${ref} » introuvable — voir entraide_lister`)
  if (hits.length > 1) throw new Error(`Référence « ${ref} » ambiguë (${hits.length} demandes) — utiliser l'id : ${hits.map((h) => h.id).join(', ')}`)
  return hits[0]
}

function resoudreAutorite(data, nom, pays) {
  if (!nom) return null
  const exact = data.autorites.find((a) => normaliser(a.nom) === normaliser(nom))
  if (exact) return exact
  const [premier] = chercherAutorites(data.autorites, nom, pays)
  return premier && normaliser(premier.nom).includes(normaliser(nom)) ? premier : null
}

function resoudreService(data, s) {
  if (!s) return {}
  const n = normaliser(s)
  const hit = data.services.find((x) => x.id === s || normaliser(x.libelle) === n)
    || data.services.find((x) => normaliser(x.libelle).includes(n))
  return hit ? { serviceId: hit.id } : { serviceAutre: String(s) }
}

function controlerMesures(ids) {
  for (const id of ids || []) if (!MESURES.some((m) => m.id === id)) throw new Error(`Mesure inconnue : ${id} — mesures possibles : ${MESURES.map((m) => m.id).join(', ')}`)
  return ids || []
}

function evenement(e, par) {
  if (!EVENEMENTS_ENTRAIDE.includes(e.type)) throw new Error(`type d'événement inconnu : ${e.type}`)
  const d = date(e.date, 'date')
  if (!d) throw new Error('date de l’événement requise (AAAA-MM-JJ)')
  return {
    id: e.id || nouvelId('e'),
    type: e.type,
    date: d,
    par: e.par || par,
    ...(e.doc ? { doc: e.doc } : {}),
    ...(e.langue ? { langue: e.langue } : {}),
    ...(e.delaiMois ? { delaiMois: Number(e.delaiMois) } : {}),
    ...(e.echeance ? { echeance: date(e.echeance, 'echeance') } : {}),
    ...(e.partiel ? { partiel: true } : {}),
    ...(e.note ? { note: String(e.note) } : {}),
    creeLe: e.creeLe || maintenant(),
  }
}

function resume(d, data, jour) {
  const e = etatDemande(d, jour)
  const autorite = d.autoriteId ? data.autorites.find((a) => a.id === d.autoriteId) : null
  const service = d.serviceId ? data.services.find((s) => s.id === d.serviceId) : null
  return {
    id: d.id,
    refEsabora: d.refEsabora,
    type: TYPE_LABELS[d.type],
    sens: d.sens,
    pays: d.pays,
    autorite: autorite?.nom || d.autoriteNom || null,
    objet: d.objet,
    etape: e.libelleEtape,
    chez: e.chez,
    echeance: e.prochaineDate,
    joursRestants: e.joursRestants,
    niveau: e.niveau,
    ...(service || d.serviceAutre ? { service: service?.libelle || d.serviceAutre } : {}),
    ...(d.magistrat ? { magistrat: d.magistrat } : {}),
  }
}

// ── Lectures ──

export function listerEntraide(keys, a = {}) {
  const { data } = lire(keys)
  const jour = aujourdhui()
  const portee = a.portee || 'en_cours'
  const q = normaliser(a.filtre)
  let liste = data.demandes.map((d) => ({ d, e: etatDemande(d, jour) }))
    .filter(({ e }) => portee === 'toutes' || (portee === 'cloturees' ? e.etape === 'cloturee' : e.etape !== 'cloturee'))
    .filter(({ d }) => !a.type || d.type === a.type)
    .filter(({ d }) => !a.sens || d.sens === a.sens)
    .filter(({ d }) => !a.magistrat || (d.magistrat || '').toLowerCase() === String(a.magistrat).toLowerCase())
    .filter(({ e }) => !a.enRetard || e.niveau === 'retard')
    .filter(({ d }) => !q || texteRecherche(d, data.autorites.find((x) => x.id === d.autoriteId)?.nom || '').includes(q))
    .sort((x, y) => cleUrgence(x.e) - cleUrgence(y.e))
  const total = liste.length
  const offset = Math.max(0, Number(a.offset) || 0)
  const limit = Math.min(300, Math.max(1, Number(a.limit) || 80))
  liste = liste.slice(offset, offset + limit)
  return {
    total,
    affiches: liste.length,
    ...(offset + limit < total ? { offsetSuivant: offset + limit } : {}),
    demandes: liste.map(({ d }) => resume(d, data, jour)),
  }
}

export function lireEntraide(keys, ref) {
  const { data } = lire(keys)
  const d = trouver(data, ref)
  const jour = aujourdhui()
  const e = etatDemande(d, jour)
  return {
    ...resume(d, data, jour),
    refEtrangere: d.refEtrangere || null,
    personnes: d.personnes || null,
    mesures: (d.mesures || []).map((id) => MESURES.find((m) => m.id === id)?.libelle || id),
    texteMesures: d.texteMesures || null,
    observations: d.observations || null,
    dateEnregistrement: d.dateEnregistrement,
    echeanceInterne: e.echeance,
    echeancesLegales: e.echeancesLegales,
    courrierEnAttente: e.docEnAttente,
    prochainesActions: prochainesActions(d, e).map((x) => x.libelle),
    chronologie: [...d.evenements].sort((x, y) => x.date.localeCompare(y.date)).map((x) => ({
      id: x.id, date: dateFr(x.date), evenement: EVENEMENT_LABELS[x.type] + (x.doc ? ` (${x.doc.toUpperCase()})` : '') + (x.partiel ? ' — partiel' : ''),
      ...(x.note ? { note: x.note } : {}), ...(x.par ? { par: x.par } : {}),
    })),
    ...(d.origine ? { origine: d.origine } : {}),
  }
}

export function statsEntraide(keys, annee) {
  const { data } = lire(keys)
  const svc = new Map(data.services.map((s) => [s.id, s.libelle]))
  return computeEntraideStats(data.demandes, Number(annee) || new Date().getFullYear(), new Date(), (id, autre) => (id && svc.get(id)) || autre || 'Non renseigné')
}

export function referentielEntraide(keys) {
  const { data } = lire(keys)
  return {
    autorites: data.autorites.map((a) => ({ id: a.id, nom: a.nom, ville: a.ville, pays: a.pays, langue: a.langue, motsCles: a.motsCles })),
    services: data.services.map((s) => ({ id: s.id, libelle: s.libelle, inactif: !!s.inactif })),
    mesures: MESURES.map((m) => ({ id: m.id, libelle: m.libelle })),
    etapes: ETAPE_LABELS,
    evenements: EVENEMENT_LABELS,
  }
}

// ── Écritures ──

/** Construit une demande complète à partir des champs du connecteur. */
function construireDemande(data, a, par) {
  if (!TYPES.includes(a.type)) throw new Error(`type : ${TYPES.join(' | ')}`)
  if (!SENS.includes(a.sens)) throw new Error('sens : recue | emise')
  if (!a.refEsabora) throw new Error('refEsabora (N/réf ESABORA) requis')
  const dateEnregistrement = date(a.dateEnregistrement, 'dateEnregistrement') || aujourdhui()
  const pays = paysDe(a.pays)?.nom || a.pays
  if (!pays) throw new Error('pays requis')
  const autorite = resoudreAutorite(data, a.autorite, pays)
  const t = maintenant()
  const evenements = (a.evenements || []).map((e) => evenement(e, par))
  if (!evenements.some((e) => e.type === 'reception' || e.type === 'enregistrement')) {
    evenements.unshift(evenement({ type: a.sens === 'recue' ? 'reception' : 'enregistrement', date: dateEnregistrement }, par))
  }
  return {
    id: a.id || nouvelId('d'),
    type: a.type,
    sens: a.sens,
    refEsabora: String(a.refEsabora).trim(),
    ...(a.refEtrangere ? { refEtrangere: String(a.refEtrangere) } : {}),
    pays,
    ...(autorite ? { autoriteId: autorite.id, autoriteNom: autorite.nom } : a.autorite ? { autoriteNom: String(a.autorite) } : {}),
    ...resoudreService(data, a.service),
    objet: String(a.objet || ''),
    mesures: controlerMesures(a.mesures),
    ...(a.personnes ? { personnes: String(a.personnes) } : {}),
    ...(a.magistrat ? { magistrat: String(a.magistrat) } : {}),
    ...(a.observations ? { observations: String(a.observations) } : {}),
    dateEnregistrement,
    evenements,
    ...(a.echeancesLegales?.length ? { echeancesLegales: a.echeancesLegales.map((l) => ({ id: nouvelId('l'), date: date(l.date, 'echeancesLegales.date'), libelle: String(l.libelle || 'Échéance légale') })) } : {}),
    ...(a.origine ? { origine: { source: 'import_excel', onglet: String(a.origine.onglet), ligne: Number(a.origine.ligne) } } : {}),
    creePar: par,
    creeLe: t,
    dateMiseAJour: t,
  }
}

export async function creerEntraide(keys, a) {
  const par = keys?.grantedBy || 'admin'
  return ecrire(keys, (data) => {
    const d = construireDemande(data, a, par)
    data.demandes.push(d)
    return { cree: resume(d, data, aujourdhui()) }
  })
}

/**
 * Import en lot (reprise du tableau Excel) — IDEMPOTENT : une demande dont
 * l'origine (onglet + ligne) est déjà présente est mise à jour, pas dupliquée.
 * Les autorités fournies sont créées (ou complétées) d'abord.
 */
export async function importerEntraide(keys, { demandes = [], autorites = [] }) {
  const par = keys?.grantedBy || 'admin'
  return ecrire(keys, (data) => {
    const t = maintenant()
    let autCrees = 0
    for (const a of autorites) {
      if (!a?.nom || !a?.pays) throw new Error('autorité : nom et pays requis')
      const ex = data.autorites.find((x) => normaliser(x.nom) === normaliser(a.nom))
      const fiche = {
        id: ex?.id || nouvelId('a'),
        nom: String(a.nom),
        ...(a.nature ? { nature: a.nature } : ex?.nature ? { nature: ex.nature } : {}),
        ...(a.ville || ex?.ville ? { ville: a.ville || ex.ville } : {}),
        ...(a.adresse || ex?.adresse ? { adresse: a.adresse || ex.adresse } : {}),
        pays: paysDe(a.pays)?.nom || a.pays,
        langue: a.langue || ex?.langue || paysDe(a.pays)?.langue || 'en',
        ...(a.email || ex?.email ? { email: a.email || ex.email } : {}),
        motsCles: Array.from(new Set([...(ex?.motsCles || []), ...(a.motsCles || [])])),
        dateMiseAJour: t,
      }
      if (!ex) autCrees++
      data.autorites = [...data.autorites.filter((x) => x.id !== fiche.id), fiche]
    }
    let crees = 0
    let majs = 0
    const erreurs = []
    demandes.forEach((brut, i) => {
      try {
        const d = construireDemande(data, brut, par)
        const ex = brut.origine
          ? data.demandes.find((x) => x.origine && x.origine.onglet === String(brut.origine.onglet) && x.origine.ligne === Number(brut.origine.ligne))
          : null
        if (ex) {
          Object.assign(ex, { ...d, id: ex.id, creeLe: ex.creeLe, creePar: ex.creePar })
          majs++
        } else {
          data.demandes.push(d)
          crees++
        }
      } catch (e) {
        erreurs.push({ index: i, ref: brut?.refEsabora, origine: brut?.origine, erreur: String(e.message || e) })
      }
    })
    return { demandesRecues: demandes.length, crees, misesAJour: majs, autoritesCreees: autCrees, erreurs, totalRegistre: data.demandes.length }
  })
}

const CHAMPS_MODIFIABLES = ['refEsabora', 'refEtrangere', 'pays', 'objet', 'personnes', 'magistrat', 'observations', 'texteMesures', 'type', 'sens']

export async function modifierEntraide(keys, a) {
  return ecrire(keys, (data) => {
    const d = trouver(data, a.ref)
    if (a.type !== undefined && !TYPES.includes(a.type)) throw new Error(`type : ${TYPES.join(' | ')}`)
    if (a.sens !== undefined && !SENS.includes(a.sens)) throw new Error('sens : recue | emise')
    for (const c of CHAMPS_MODIFIABLES) if (a[c] !== undefined) d[c] = String(a[c])
    if (a.mesures !== undefined) d.mesures = controlerMesures(a.mesures)
    if (a.autorite !== undefined) {
      const au = resoudreAutorite(data, a.autorite, d.pays)
      if (au) { d.autoriteId = au.id; d.autoriteNom = au.nom } else { delete d.autoriteId; d.autoriteNom = String(a.autorite) }
    }
    if (a.service !== undefined) { delete d.serviceId; delete d.serviceAutre; Object.assign(d, resoudreService(data, a.service)) }
    if (a.echeanceLegale) {
      d.echeancesLegales = [...(d.echeancesLegales || []), { id: nouvelId('l'), date: date(a.echeanceLegale.date, 'echeanceLegale.date'), libelle: String(a.echeanceLegale.libelle || 'Échéance légale') }]
    }
    d.dateMiseAJour = maintenant()
    return { modifie: resume(d, data, aujourdhui()) }
  })
}

export async function evenementEntraide(keys, a) {
  const par = keys?.grantedBy || 'admin'
  return ecrire(keys, (data) => {
    const d = trouver(data, a.ref)
    if (a.operation === 'supprimer') {
      const avant = d.evenements.length
      d.evenements = d.evenements.filter((e) => e.id !== a.id)
      if (d.evenements.length === avant) throw new Error(`Événement ${a.id} introuvable`)
    } else if (a.operation === 'modifier') {
      const e = d.evenements.find((x) => x.id === a.id)
      if (!e) throw new Error(`Événement ${a.id} introuvable`)
      if (a.date !== undefined) e.date = date(a.date, 'date')
      if (a.note !== undefined) e.note = String(a.note)
    } else {
      d.evenements.push(evenement(a, par))
    }
    d.dateMiseAJour = maintenant()
    return { etat: resume(d, data, aujourdhui()), prochainesActions: prochainesActions(d, etatDemande(d, aujourdhui())).map((x) => x.libelle) }
  })
}

export async function autoriteEntraide(keys, a) {
  return ecrire(keys, (data) => {
    const ex = a.id ? data.autorites.find((x) => x.id === a.id) : data.autorites.find((x) => normaliser(x.nom) === normaliser(a.nom))
    if (a.operation === 'supprimer') {
      if (!ex) throw new Error('Autorité introuvable')
      data.autorites = data.autorites.filter((x) => x.id !== ex.id)
      data.tombstones.push({ id: ex.id, deletedAt: maintenant() })
      return { supprime: ex.nom }
    }
    if (!ex && (!a.nom || !a.pays)) throw new Error('nom et pays requis pour une nouvelle autorité')
    const fiche = {
      ...(ex || { id: nouvelId('a'), motsCles: [] }),
      ...(a.nom ? { nom: String(a.nom) } : {}),
      ...(a.nature ? { nature: a.nature } : {}),
      ...(a.ville !== undefined ? { ville: String(a.ville) } : {}),
      ...(a.adresse !== undefined ? { adresse: String(a.adresse) } : {}),
      ...(a.pays ? { pays: paysDe(a.pays)?.nom || a.pays } : {}),
      ...(a.langue ? { langue: a.langue } : {}),
      ...(a.email !== undefined ? { email: String(a.email) } : {}),
      ...(a.motsCles ? { motsCles: Array.from(new Set([...(ex?.motsCles || []), ...a.motsCles])) } : {}),
      dateMiseAJour: maintenant(),
    }
    if (!fiche.langue) fiche.langue = paysDe(fiche.pays)?.langue || 'en'
    data.autorites = [...data.autorites.filter((x) => x.id !== fiche.id), fiche]
    return { autorite: fiche, operation: ex ? 'modifiee' : 'creee' }
  })
}
