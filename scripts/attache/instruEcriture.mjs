/**
 * SIRAL — Attaché de justice · ÉCRITURES dans le module instruction.
 *
 * Mêmes données que l'onglet instruction de l'app : saisine in rem, mis en
 * examen (chefs, mesure de sûreté, DML), suspects, victimes, notes perso,
 * bloc « Actes à faire / à demander à la JI », chronologie, débats JLD, OP,
 * nombre de cotes, état du règlement.
 *
 * Contrat de synchronisation (utils/dataSync/InstructionSyncService.ts) : le
 * client fusionne par dossier, la `dateMiseAJour` la plus récente gagne. On
 * modifie donc le dossier ENTIER, on bumpe `dateMiseAJour`, et on réécrit
 * chaque coffre `instructions-<user>` qui le contient (coffre personnel et,
 * en partage, coffre de groupe) — writeVault archive la version précédente :
 * toute écriture est réversible.
 */
import fs from 'node:fs'
import { attacheTj, tjDataDir, readVault, writeVault } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { natinfEntry } from './natinf.mjs'

function authorOf(keys) {
  return keys?.grantedBy || 'admin'
}

function normNum(v) {
  return String(v ?? '').trim().replace(/\s+/g, '')
}

function matchNumero(d, numero) {
  const w = normNum(numero)
  return (d.numeroInstruction && normNum(d.numeroInstruction) === w)
    || (d.numeroParquet && normNum(d.numeroParquet) === w)
}

/** Tous les coffres `instructions-<user>` du TJ confié (même énumération que instru.mjs). */
function vaultNames() {
  const dir = tjDataDir(attacheTj(), 'vaults')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('instructions-') && f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
}

// Ids numériques comme l'app (Date.now() + aléa), uniques dans un même appel.
let seq = 0
function newId() {
  return Date.now() + Math.floor(Math.random() * 1000) + (seq++ % 1000) * 1000
}

function isoDate(v, champ) {
  if (v === undefined || v === null || v === '') return undefined
  const s = String(v).trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new Error(`${champ} : date attendue au format AAAA-MM-JJ (reçu « ${s} »)`)
  return s.slice(0, 10)
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Texte brut → HTML des champs riches (description, bloc-notes JI, éléments à charge). */
function textToHtml(s) {
  const t = String(s ?? '')
  if (/<[a-z][\s\S]*>/i.test(t)) return t // déjà du HTML
  return escapeHtml(t).replace(/\n/g, '<br>')
}

function natinfRefOf(code) {
  if (!code) return {}
  const e = natinfEntry(code)
  if (!e) throw new Error(`NATINF ${code} inconnu du référentiel — vérifie avec natinf_chercher`)
  return { natinfCode: String(e.code), natinfRef: { code: String(e.code), libelle: e.libelle, nature: e.nature } }
}

/** Même calcul que utils/instructionUtils.ts (10 jours ouvrables, UTC). */
export function calculateDMLEcheance(dateDepot) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateDepot)
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  let count = 0
  while (count < 10) {
    date.setUTCDate(date.getUTCDate() + 1)
    const day = date.getUTCDay()
    if (day !== 0 && day !== 6) count++
  }
  return date.toISOString().split('T')[0]
}

/** Même calcul que utils/instructionUtils.ts (de date à date, repli fin de mois). */
export function calculatePeriodeDPEnd(dateDebut, dureeMois) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateDebut)
  const year = Number(m[1])
  const day = Number(m[3])
  const monthIdx = Number(m[2]) - 1 + dureeMois
  const targetYear = year + Math.floor(monthIdx / 12)
  const targetMonth = ((monthIdx % 12) + 12) % 12
  const last = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, last))).toISOString().split('T')[0]
}

// ── Chargement / écriture ──

function loadVaults(keys) {
  const out = []
  for (const name of vaultNames()) {
    const env = readVault(attacheTj(), name)
    if (!env) continue
    let payload
    try { payload = decryptJson(keys.global, env) } catch { continue }
    out.push({ name, payload })
  }
  return out
}

/**
 * Modifie un dossier d'instruction. `fn(dossier, ctx)` mute la copie la plus
 * récente ; le résultat est réécrit dans chaque coffre qui porte ce dossier.
 */
export async function mutateInstruction(keys, numero, fn) {
  if (!keys?.global) throw new Error('Trousseau sans clé globale — remise des clés requise')
  const vaults = loadVaults(keys)
  const hits = []
  for (const v of vaults) {
    for (const d of v.payload?.dossiers || []) if (matchNumero(d, numero)) hits.push({ v, d })
  }
  if (!hits.length) throw new Error(`Dossier d'instruction ${numero} introuvable — voir instru_lister`)
  const ids = new Set(hits.map((h) => h.d.id))
  if (ids.size > 1) throw new Error(`Numéro ${numero} ambigu : ${ids.size} dossiers d'instruction distincts — préciser le n° d'instruction`)
  const time = (d) => Date.parse(d.dateMiseAJour || d.dateCreation || '') || 0
  hits.sort((a, b) => time(b.d) - time(a.d))
  const dossier = structuredClone(hits[0].d)
  const proprietaire = hits[0].v.name.slice('instructions-'.length)
  const result = fn(dossier, { proprietaire })
  dossier.dateMiseAJour = new Date().toISOString()

  const author = authorOf(keys)
  const touched = new Set(hits.map((h) => h.v))
  for (const v of touched) {
    const p = v.payload
    p.dossiers = p.dossiers.map((d) => (d.id === dossier.id ? dossier : d))
    p.version = (Number(p.version) || 0) + 1
    p.updatedAt = dossier.dateMiseAJour
    p.updatedBy = author
    const env = encryptJson(keys.global, p, { savedAt: p.updatedAt, savedBy: author })
    await writeVault(attacheTj(), v.name, env, author)
  }
  return { dossier: dossier.numeroInstruction || dossier.numeroParquet, ...result }
}

// ── Champs du dossier ──

const ETATS = ['en_cours', '175_recu', 'reqdef_redigees', 'ordonnance_rendue']
const ORIENTATIONS = ['TC', 'CCD', 'Assises', 'TPE', 'CAM', 'non_lieu', 'incertain']

export async function modifierDossierInstruction(keys, a) {
  return mutateInstruction(keys, a.numero, (d) => {
    const modifies = []
    const set = (k, v) => { d[k] = v; modifies.push(k) }
    for (const k of ['magistratInstructeur', 'serviceEnqueteur', 'lienNpp', 'numeroParquet', 'numeroInstruction', 'cabinetId']) {
      if (a[k] !== undefined) set(k, String(a[k]))
    }
    if (a.dateOuverture !== undefined) set('dateOuverture', isoDate(a.dateOuverture, 'dateOuverture'))
    if (a.dateRI !== undefined) set('dateRI', isoDate(a.dateRI, 'dateRI'))
    if (a.etatReglement !== undefined) {
      if (!ETATS.includes(a.etatReglement)) throw new Error(`etatReglement : ${ETATS.join(' | ')}`)
      set('etatReglement', a.etatReglement)
    }
    if (a.orientationPrevisible !== undefined) {
      if (!ORIENTATIONS.includes(a.orientationPrevisible)) throw new Error(`orientationPrevisible : ${ORIENTATIONS.join(' | ')}`)
      set('orientationPrevisible', a.orientationPrevisible)
    }
    if (a.cotes !== undefined) {
      const n = Number(a.cotes)
      if (!Number.isInteger(n) || n < 0) throw new Error('cotes : entier positif attendu')
      set('cotesTomes', n)
    }
    if (a.cotesAjouter !== undefined) {
      const n = Number(a.cotesAjouter)
      if (!Number.isInteger(n)) throw new Error('cotesAjouter : entier attendu')
      set('cotesTomes', Math.max(0, (Number(d.cotesTomes) || 0) + n))
    }
    for (const k of ['suiviJIRS', 'suiviPG']) if (a[k] !== undefined) set(k, Boolean(a[k]))
    if (a.description !== undefined) set('description', textToHtml(a.description))
    if (a.descriptionAjouter) set('description', (d.description ? d.description + '<br><br>' : '') + textToHtml(a.descriptionAjouter))
    if (a.notesActesJI !== undefined) set('notesActesJI', textToHtml(a.notesActesJI))
    if (a.notesActesJIAjouter) set('notesActesJI', (d.notesActesJI ? d.notesActesJI + '<br>' : '') + textToHtml(a.notesActesJIAjouter))
    if (!modifies.length) throw new Error('Aucun champ à modifier')
    return { modifies: [...new Set(modifies)], cotes: d.cotesTomes ?? 0, etatReglement: d.etatReglement }
  })
}

// ── Collections simples (saisine, suspects, victimes, notes, chronologie, JLD, OP) ──

const TYPES_DEBAT = ['placement_dp', 'prolongation_dp', 'dml', 'autre']
const DECISIONS = ['placement', 'maintien', 'remise_en_liberte', 'cj', 'arse', 'autre']

/**
 * Par collection : champ du dossier, nettoyage des champs fournis et
 * champs obligatoires à la création. Les champs non listés sont ignorés.
 */
const COLLECTIONS = {
  saisine: {
    champ: 'saisine',
    clean: (c) => ({
      ...(c.qualification !== undefined ? { qualification: String(c.qualification) } : {}),
      ...(c.natinfCode !== undefined ? (c.natinfCode ? natinfRefOf(c.natinfCode) : { natinfCode: undefined, natinfRef: undefined }) : {}),
      ...(c.acte !== undefined ? { acte: c.acte === 'suppletif' ? 'suppletif' : 'introductif' } : {}),
      ...(c.dateActe !== undefined ? { dateActe: isoDate(c.dateActe, 'dateActe') } : {}),
      ...(c.faits !== undefined ? { faits: String(c.faits) } : {}),
    }),
    defauts: { acte: 'introductif' },
    requis: ['qualification'],
  },
  suspects: {
    champ: 'suspects',
    clean: (c) => ({
      ...(c.nom !== undefined ? { nom: String(c.nom) } : {}),
      ...(c.role !== undefined ? { role: String(c.role) } : {}),
    }),
    requis: ['nom'],
  },
  victimes: {
    champ: 'victimes',
    clean: (c) => ({
      ...(c.nom !== undefined ? { nom: String(c.nom) } : {}),
      ...(c.partieCivile !== undefined ? { partieCivile: Boolean(c.partieCivile) } : {}),
      ...(c.datePC !== undefined ? { datePC: isoDate(c.datePC, 'datePC') } : {}),
      ...(c.notes !== undefined ? { notes: String(c.notes) } : {}),
      ...(c.surCarto !== undefined ? { surCarto: Boolean(c.surCarto) } : {}),
    }),
    requis: ['nom'],
  },
  notesPerso: {
    champ: 'notesPerso',
    clean: (c) => ({
      ...(c.contenu !== undefined ? { contenu: String(c.contenu).trim() } : {}),
      ...(c.date !== undefined ? { date: isoDate(c.date, 'date') } : {}),
      ...(c.tags !== undefined ? { tags: (Array.isArray(c.tags) ? c.tags : [c.tags]).map(String).filter(Boolean) } : {}),
    }),
    requis: ['contenu'],
    creer: (item, ctx) => ({ date: new Date().toISOString(), auteur: ctx.proprietaire, ...item }),
  },
  evenements: {
    champ: 'evenements',
    clean: (c, d) => ({
      ...(c.type !== undefined ? { type: String(c.type) } : {}),
      ...(c.date !== undefined ? { date: isoDate(c.date, 'date') } : {}),
      ...(c.titre !== undefined ? { titre: String(c.titre) } : {}),
      ...(c.description !== undefined ? { description: textToHtml(c.description) } : {}),
      ...(c.misEnExamen !== undefined ? { misEnExamenId: c.misEnExamen ? findMex(d, c.misEnExamen).id : undefined } : {}),
      ...(c.victime !== undefined ? { victimeId: c.victime ? findIn(d.victimes, c.victime, 'victime').id : undefined } : {}),
      ...(c.categorieExpertise !== undefined ? { categorieExpertise: String(c.categorieExpertise) } : {}),
      ...(c.expertiseLibelle !== undefined ? { expertiseLibelle: String(c.expertiseLibelle) } : {}),
    }),
    requis: ['type', 'date'],
  },
  debatsJLD: {
    champ: 'debatsJLD',
    clean: (c, d) => {
      if (c.type !== undefined && !TYPES_DEBAT.includes(c.type)) throw new Error(`type de débat : ${TYPES_DEBAT.join(' | ')}`)
      if (c.decision && !DECISIONS.includes(c.decision)) throw new Error(`decision : ${DECISIONS.join(' | ')}`)
      return {
        ...(c.type !== undefined ? { type: c.type } : {}),
        ...(c.date !== undefined ? { date: String(c.date).trim() } : {}),
        ...(c.heureExacte !== undefined ? { heureExacte: Boolean(c.heureExacte) } : {}),
        ...(c.misEnExamen !== undefined ? { misEnExamenId: c.misEnExamen ? findMex(d, c.misEnExamen).id : undefined } : {}),
        ...(c.requisitionsRedigees !== undefined ? { requisitionsRedigees: Boolean(c.requisitionsRedigees) } : {}),
        ...(c.dateRequisitions !== undefined ? { dateRequisitions: isoDate(c.dateRequisitions, 'dateRequisitions') } : {}),
        ...(c.decision !== undefined ? { decision: c.decision || undefined } : {}),
        ...(c.notes !== undefined ? { notes: String(c.notes) } : {}),
      }
    },
    requis: ['type', 'date'],
  },
  ops: {
    champ: 'ops',
    clean: (c) => ({
      ...(c.date !== undefined ? { date: isoDate(c.date, 'date') } : {}),
      ...(c.description !== undefined ? { description: String(c.description) } : {}),
      ...(c.service !== undefined ? { service: String(c.service) } : {}),
      ...(c.requisitionsRedigees !== undefined ? { requisitionsRedigees: Boolean(c.requisitionsRedigees) } : {}),
      ...(c.dateRequisitions !== undefined ? { dateRequisitions: isoDate(c.dateRequisitions, 'dateRequisitions') } : {}),
      ...(c.notes !== undefined ? { notes: String(c.notes) } : {}),
    }),
    requis: ['date'],
  },
}
export const COLLECTIONS_INSTRUCTION = Object.keys(COLLECTIONS)

function normNom(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Élément d'une liste par id exact, ou par nom (personnes) — erreur sinon. */
function findIn(list, ref, quoi) {
  const arr = list || []
  const byId = arr.find((x) => String(x.id) === String(ref))
  if (byId) return byId
  const n = normNom(ref)
  const byNom = n ? arr.filter((x) => x.nom && normNom(x.nom) === n) : []
  if (byNom.length === 1) return byNom[0]
  const partiel = n ? arr.filter((x) => x.nom && normNom(x.nom).includes(n)) : []
  if (partiel.length === 1) return partiel[0]
  throw new Error(`${quoi} « ${ref} » introuvable${partiel.length > 1 ? ' (plusieurs correspondances — donner l\'id)' : ''} — ids visibles avec lire_dossier`)
}

function findMex(d, ref) {
  return findIn(d.misEnExamen, ref, 'Mis en examen')
}

export async function elementInstruction(keys, { numero, collection, operation, id, champs }) {
  const def = COLLECTIONS[collection]
  if (!def) throw new Error(`collection : ${COLLECTIONS_INSTRUCTION.join(' | ')}`)
  return mutateInstruction(keys, numero, (d, ctx) => {
    d[def.champ] = d[def.champ] || []
    const list = d[def.champ]
    const c = champs || {}
    if (operation === 'ajouter') {
      const item = { ...(def.defauts || {}), ...def.clean(c, d) }
      const manque = def.requis.filter((k) => item[k] === undefined || item[k] === '')
      if (manque.length) throw new Error(`Champs requis pour ${collection} : ${manque.join(', ')}`)
      if (def.champ === 'suspects' || def.champ === 'victimes') {
        const dup = list.find((x) => normNom(x.nom) === normNom(item.nom))
        if (dup) throw new Error(`« ${item.nom} » figure déjà (${collection}, id ${dup.id})`)
      }
      const created = { id: newId(), ...(def.creer ? def.creer(item, ctx) : item) }
      list.push(created)
      return { operation, collection, element: created }
    }
    if (id === undefined || id === null || id === '') throw new Error('id (ou nom pour une personne) requis')
    const cible = findIn(list, id, `Élément ${collection}`)
    if (operation === 'modifier') {
      Object.assign(cible, def.clean(c, d))
      for (const k of Object.keys(cible)) if (cible[k] === undefined) delete cible[k]
      return { operation, collection, element: cible }
    }
    if (operation === 'supprimer') {
      d[def.champ] = list.filter((x) => x !== cible)
      return { operation, collection, supprime: cible }
    }
    throw new Error('operation : ajouter | modifier | supprimer')
  })
}

// ── Mis en examen ──

function cleanIdentite(c) {
  const out = {}
  for (const k of ['nom', 'lieuNaissance', 'nationalite', 'profession', 'adresse']) if (c[k] !== undefined) out[k] = String(c[k])
  if (c.dateNaissance !== undefined) out.dateNaissance = isoDate(c.dateNaissance, 'dateNaissance')
  if (c.dateMiseEnExamen !== undefined) out.dateMiseEnExamen = isoDate(c.dateMiseEnExamen, 'dateMiseEnExamen')
  if (c.elementsCharge !== undefined) out.elementsCharge = textToHtml(c.elementsCharge)
  if (c.notes !== undefined) out.notes = String(c.notes)
  return out
}

function buildInfraction(i) {
  const src = typeof i === 'string' ? { qualification: i } : (i || {})
  const nat = src.natinfCode ? natinfRefOf(src.natinfCode) : {}
  const qualification = String(src.qualification || nat.natinfRef?.libelle || '').trim()
  if (!qualification) throw new Error('Chef de mise en examen sans qualification')
  return {
    id: newId(),
    qualification,
    ...nat,
    ...(src.dateInfraction ? { dateInfraction: isoDate(src.dateInfraction, 'dateInfraction') } : {}),
    ...(src.lieuInfraction ? { lieuInfraction: String(src.lieuInfraction) } : {}),
    ...(src.explication ? { explication: String(src.explication) } : {}),
  }
}

/**
 * Mesure de sûreté : libre | cj | arse | detenu. Pour « detenu », une
 * première période de placement est créée si dureeMois est fourni ; une
 * « prolongation » ajoute une période à la suite de la dernière.
 */
function appliquerMesure(mex, m) {
  const type = m.type
  const depuis = isoDate(m.depuis, 'mesure.depuis')
  const notes = m.notes !== undefined ? String(m.notes) : undefined
  if (type === 'libre') { mex.mesureSurete = { type, ...(depuis ? { depuis } : {}), ...(notes ? { notes } : {}) }; return }
  if (type === 'cj' || type === 'arse') {
    mex.mesureSurete = { type, depuis: depuis || mex.dateMiseEnExamen, ...(m.lieu && type === 'arse' ? { lieu: String(m.lieu) } : {}), ...(notes ? { notes } : {}) }
    return
  }
  if (type === 'detenu') {
    const regime = m.regime === 'criminel' ? 'criminel' : 'correctionnel'
    const cur = mex.mesureSurete?.type === 'detenu' ? mex.mesureSurete : null
    const debut = depuis || cur?.depuis || mex.dateMiseEnExamen
    const next = cur
      ? { ...cur, ...(depuis ? { depuis } : {}), ...(m.regime ? { regime } : {}), ...(notes !== undefined ? { notes } : {}) }
      : { type: 'detenu', depuis: debut, regime, periodes: [], ...(notes ? { notes } : {}) }
    if (m.casDPId) next.casDPId = String(m.casDPId)
    const duree = Number(m.dureeMois)
    if (m.dureeMois !== undefined) {
      if (!Number.isInteger(duree) || duree <= 0) throw new Error('mesure.dureeMois : entier positif attendu')
      const periodes = next.periodes || []
      const prolongation = m.prolongation === true
      if (prolongation && !periodes.length) throw new Error('Prolongation impossible : aucune période de placement enregistrée')
      const dateDebut = isoDate(m.dateDebutPeriode, 'mesure.dateDebutPeriode')
        || (prolongation ? periodes[periodes.length - 1].dateFin : debut)
      periodes.push({
        id: newId(), dateDebut, dureeMois: duree, dateFin: calculatePeriodeDPEnd(dateDebut, duree),
        regime: next.regime, type: prolongation ? 'prolongation' : 'placement',
        ...(m.ordonnanceJLD ? { ordonnanceJLD: String(m.ordonnanceJLD) } : {}),
        ...(m.dateDebatJLD ? { dateDebatJLD: isoDate(m.dateDebatJLD, 'mesure.dateDebatJLD') } : {}),
        ...(m.motifProlongation ? { motifProlongation: String(m.motifProlongation) } : {}),
      })
      next.periodes = periodes
    }
    mex.mesureSurete = next
    return
  }
  throw new Error('mesure.type : libre | cj | arse | detenu')
}

export async function misEnExamenInstruction(keys, a) {
  const { numero, operation } = a
  return mutateInstruction(keys, numero, (d) => {
    d.misEnExamen = d.misEnExamen || []
    if (operation === 'ajouter') {
      const ident = cleanIdentite(a)
      if (!ident.nom) throw new Error('nom requis')
      const dup = d.misEnExamen.find((m) => normNom(m.nom) === normNom(ident.nom))
      if (dup) throw new Error(`« ${ident.nom} » est déjà mis en examen (id ${dup.id})`)
      const mex = {
        id: newId(),
        dateMiseEnExamen: new Date().toISOString().slice(0, 10),
        ...ident,
        infractions: (a.infractionsAjouter || []).map(buildInfraction),
        elementsPersonnalite: [],
        mesureSurete: { type: 'libre' },
        dmls: [],
      }
      if (a.mesure) appliquerMesure(mex, a.mesure)
      d.misEnExamen.push(mex)
      // Un suspect mis en examen quitte la liste des suspects (comme la promotion dans l'app).
      let suspectRetire
      if (a.depuisSuspect) {
        const s = findIn(d.suspects, a.depuisSuspect, 'Suspect')
        d.suspects = d.suspects.filter((x) => x !== s)
        suspectRetire = s.nom
      }
      return { operation, misEnExamen: mex, ...(suspectRetire ? { suspectRetire } : {}) }
    }
    const ref = a.id ?? a.cible
    if (ref === undefined || ref === null || ref === '') throw new Error('id ou cible (nom) du mis en examen requis')
    const mex = findMex(d, ref)
    if (operation === 'supprimer') {
      d.misEnExamen = d.misEnExamen.filter((m) => m !== mex)
      return { operation, supprime: mex.nom }
    }
    if (operation !== 'modifier') throw new Error('operation : ajouter | modifier | supprimer')
    Object.assign(mex, cleanIdentite(a))
    mex.infractions = mex.infractions || []
    if (a.infractionsAjouter?.length) mex.infractions.push(...a.infractionsAjouter.map(buildInfraction))
    if (a.infractionsSupprimer?.length) {
      const retirer = new Set(a.infractionsSupprimer.map((r) => findIn(mex.infractions.map((i) => ({ ...i, nom: i.qualification })), r, 'Chef').id))
      mex.infractions = mex.infractions.filter((i) => !retirer.has(i.id))
    }
    if (a.mesure) appliquerMesure(mex, a.mesure)
    mex.dmls = mex.dmls || []
    if (a.dmlAjouter) {
      const dateDepot = isoDate(a.dmlAjouter.dateDepot, 'dmlAjouter.dateDepot')
      if (!dateDepot) throw new Error('dmlAjouter.dateDepot requis')
      mex.dmls.push({
        id: newId(), dateDepot, dateEcheance: calculateDMLEcheance(dateDepot), statut: 'en_attente',
        ...(a.dmlAjouter.notes ? { notes: String(a.dmlAjouter.notes) } : {}),
      })
    }
    if (a.dmlModifier) {
      const x = mex.dmls.find((m) => String(m.id) === String(a.dmlModifier.id))
      if (!x) throw new Error(`DML ${a.dmlModifier.id} introuvable pour ${mex.nom}`)
      if (a.dmlModifier.statut !== undefined) {
        if (!['en_attente', 'accordee', 'rejetee'].includes(a.dmlModifier.statut)) throw new Error('dml.statut : en_attente | accordee | rejetee')
        x.statut = a.dmlModifier.statut
      }
      if (a.dmlModifier.dateRequisitions !== undefined) x.dateRequisitions = isoDate(a.dmlModifier.dateRequisitions, 'dateRequisitions')
      if (a.dmlModifier.notes !== undefined) x.notes = String(a.dmlModifier.notes)
    }
    return { operation, misEnExamen: mex }
  })
}
