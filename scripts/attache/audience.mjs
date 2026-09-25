/**
 * SIRAL — Attaché de justice · RÉSULTATS D'AUDIENCE d'une enquête.
 *
 * Même donnée que les fenêtres « Archiver l'enquête » et « Résultats
 * d'audience » de l'app (ArchiveEnqueteModal, AudienceResultModal) : un
 * résultat par enquête dans le coffre GLOBAL `audience` — celui que lit la
 * page Statistiques — sous la clé `${contentieux}__${idEnquête}`, puis
 * l'archivage de l'enquête, comme dans l'app (un résultat d'audience ne naît
 * que du circuit d'archivage : cf. utils/archiveState.ts, qui ré-archive
 * d'office une enquête jamais archivée portant un résultat).
 *
 * Une ligne par personne : orientation (CRPC, CI, COPJ, CDD, OI), défèrement
 * à sa date réelle, et décision — condamnation (peines chiffrées), relaxe, ou
 * renvoi à une date (« en attente d'audience »). Tout le monde renvoyé ⇒
 * audience à venir ; une partie jugée ⇒ résultat PARTIEL, le dossier reste
 * dans les audiences en attente jusqu'au jugement des renvoyés. S'y ajoutent
 * le classement sans suite et l'ouverture d'information.
 *
 * Contrat de synchronisation (utils/dataSync/AudienceSyncService.ts) : le
 * client fusionne clé par clé, le `modifiedAt` le plus récent gagne. On pose
 * donc `modifiedAt`, on réécrit le coffre entier, et writeVault archive la
 * version précédente : toute écriture est réversible.
 */
import { attacheTj, attacheContentieux, readVault, writeVault, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { natinfEntry } from './natinf.mjs'
import { loadContentieux, resolveEnquete, archiverDossier, normalizeNom, proximiteNoms } from './dossier.mjs'
import { buildResultatKey, migrateLegacyResultats } from '../../lib/audience/resultatsCles.mjs'
import { emptyConfiscations, hasAnySaisies, migrateConfiscations, mergeConfiscations, countConfiscations } from '../../lib/stats/audienceCore.mjs'

const COFFRE = 'audience'

export const ISSUES_AUDIENCE = ['jugement', 'audience_a_venir', 'classement', 'ouverture_information']
export const DECISIONS_AUDIENCE = ['condamnation', 'relaxe', 'renvoi']

// Les cinq types d'audience de l'app (select « Type d'audience »).
const ORIENTATIONS = { crpc: 'CRPC-Def', 'crpc-def': 'CRPC-Def', ci: 'CI', copj: 'COPJ', cdd: 'CDD', oi: 'OI' }
const LIBELLE_ORIENTATION = { 'CRPC-Def': 'CRPC', CI: 'CI', COPJ: 'COPJ', CDD: 'CDD', OI: 'OI' }
// Voies qui supposent un défèrement : CRPC sur défèrement (seule CRPC de
// l'app), comparution immédiate (art. 395) et à délai différé (art. 397-1-1).
const DEFERE_PAR_DEFAUT = new Set(['CRPC-Def', 'CI', 'CDD'])

function authorOf(keys) {
  return keys?.grantedBy || 'admin'
}

const aujourdhui = () => new Date().toISOString().slice(0, 10)

/** AAAA-MM-JJ (JJ/MM/AAAA toléré) — date calendaire réelle, sinon erreur. */
function isoDate(v, champ) {
  if (v === undefined || v === null || v === '') return undefined
  const s = String(v).trim()
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s)
  const iso = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : s.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (!d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error(`${champ} : date attendue au format AAAA-MM-JJ (reçu « ${s} »)`)
  }
  return iso
}

const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '?')

function moisEntier(v, champ) {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${champ} : nombre entier de mois attendu (1 an = 12 mois ; reçu « ${v} »)`)
  return n
}

function montant(v, champ) {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${champ} : montant en euros attendu (reçu « ${v} »)`)
  return n
}

function orientationDe(v, nom) {
  if (v === undefined || v === null || v === '') return undefined
  const o = ORIENTATIONS[String(v).trim().toLowerCase().replace(/[\s_]+/g, '-')]
  if (!o) {
    throw new Error(`Orientation « ${v} » inconnue (${nom}) : l'app ne connaît que CRPC, CI, COPJ, CDD et OI — pour une autre voie (CPPV, ordonnance pénale…), demander au magistrat la case à retenir`)
  }
  return o
}

/** « condamné », « relaxé », « renvoyé » valent la décision correspondante. */
function decisionDe(v, nom) {
  const k = String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  const d = k.startsWith('condamn') ? 'condamnation' : k.startsWith('relax') ? 'relaxe' : k.startsWith('renvo') ? 'renvoi' : null
  if (!d) throw new Error(`decision (${nom}) : ${DECISIONS_AUDIENCE.join(' | ')} (reçu « ${v} »)`)
  return d
}

// ── Coffre `audience` ──

/** Lit le coffre : null s'il n'existe pas encore ; ERREUR s'il est illisible (on n'écrase jamais ce qu'on ne sait pas lire). */
function lireCoffre(keys) {
  const env = readVault(attacheTj(), COFFRE)
  if (!env) return null
  try {
    return decryptJson(keys.global, env) || {}
  } catch {
    throw new Error('Coffre des résultats d\'audience illisible avec le trousseau remis — rien n\'a été écrit (remettre les clés depuis l\'app)')
  }
}

async function ecrireCoffre(keys, fichier, resultats) {
  const author = authorOf(keys)
  const now = new Date().toISOString()
  const payload = {
    ...fichier,
    version: (Number(fichier?.version) || 0) + 1,
    updatedAt: now,
    updatedBy: author,
    computerName: 'SIRAL',
    audienceResultats: resultats,
  }
  const env = encryptJson(keys.global, payload, { savedAt: now, savedBy: author })
  await writeVault(attacheTj(), COFFRE, env, author)
}

/** Nature d'un résultat existant, pour savoir ce qu'on complète. */
function natureDe(r) {
  if (!r) return 'aucun'
  if (r.isPreArchiveSaisies) return 'brouillon'
  if (r.isClassement) return 'classement'
  if (r.isOI) return 'oi'
  if (r.isAudiencePending) return 'a_venir'
  return 'jugement'
}

// ── Personnes ──

/**
 * Rattache un nom dicté à un mis en cause du dossier (victimes exclues) :
 * écriture exacte d'abord, sinon rapprochement tolérant UNIQUE (même règle que
 * le dédoublonnage des mis en cause). Sans rattachement sûr, le nom reste en
 * texte libre — comme la saisie manuelle de l'app.
 */
function rattacherMec(e, nom) {
  const mecs = (e.misEnCause || []).filter((m) => m && m.nom && !m.isVictime)
  const n = normalizeNom(nom)
  const exacts = mecs.filter((m) => normalizeNom(m.nom) === n)
  if (exacts.length === 1) return { mec: exacts[0] }
  if (exacts.length > 1) return { ambigu: exacts.map((m) => m.nom) }
  const proches = mecs.map((m) => ({ m, motif: proximiteNoms(nom, m.nom) })).filter((x) => x.motif)
  if (proches.length === 1) return { mec: proches[0].m, motif: proches[0].motif }
  if (proches.length > 1) return { ambigu: proches.map((x) => x.m.nom) }
  return {}
}

/** Lignes du résultat existant, à plat : condamnés/relaxés et renvoyés. */
function personnesDe(r) {
  const out = []
  for (const c of r?.condamnations || []) {
    if (!c) continue
    out.push({ ...c, statut: c.isPending ? 'renvoi' : (c.isRelaxe ? 'relaxe' : 'condamnation') })
  }
  for (const p of r?.pendingCondamnations || []) {
    if (!p) continue
    out.push({ ...p, statut: 'renvoi' })
  }
  return out
}

function trouverPersonne(personnes, nom, misEnCauseId) {
  if (misEnCauseId != null) {
    const parId = personnes.find((x) => x.misEnCauseId != null && Number(x.misEnCauseId) === Number(misEnCauseId))
    if (parId) return parId
  }
  const n = normalizeNom(nom)
  const exacts = personnes.filter((x) => normalizeNom(x.nom || '') === n)
  if (exacts.length === 1) return exacts[0]
  const proches = personnes.filter((x) => x.nom && proximiteNoms(nom, x.nom))
  if (exacts.length > 1 || proches.length > 1) {
    throw new Error(`« ${nom} » peut désigner plusieurs personnes déjà enregistrées (${(exacts.length > 1 ? exacts : proches).map((x) => x.nom).join(', ')}) — reprendre le nom exact`)
  }
  return proches[0] || null
}

const aUnePeine = (x) => (x.peinePrison || 0) > 0 || (x.sursisProbatoire || 0) > 0
  || (x.sursisSimple || 0) > 0 || (x.peineAmende || 0) > 0

/**
 * Applique une ligne dictée à la personne déjà enregistrée (ou à une page
 * blanche) : seuls les champs fournis changent — « DURAND : 18 mois ferme »
 * complète un renvoyé sans retaper son orientation ni son défèrement.
 */
function appliquerPersonne(base, dictee, ctx) {
  const nom = base.nom
  // Un champ vide (« », null) n'est pas une consigne : il ne doit rien effacer.
  const p = Object.fromEntries(Object.entries(dictee || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  const x = { ...base }
  if (p.orientation !== undefined) x.typeAudience = orientationDe(p.orientation, nom)
  if (p.defere !== undefined) x.defere = Boolean(p.defere)
  if (p.dateDefere !== undefined) x.dateDefere = isoDate(p.dateDefere, `dateDefere (${nom})`)
  if (p.dateRenvoi !== undefined) x.dateAudiencePending = isoDate(p.dateRenvoi, `dateRenvoi (${nom})`)

  const peines = {
    peinePrison: moisEntier(p.prisonFermeMois, `prisonFermeMois (${nom})`),
    sursisProbatoire: moisEntier(p.sursisProbatoireMois, `sursisProbatoireMois (${nom})`),
    sursisSimple: moisEntier(p.sursisSimpleMois, `sursisSimpleMois (${nom})`),
    peineAmende: montant(p.amende, `amende (${nom})`),
  }
  // Un zéro corrige une peine (« pas d'amende finalement ») mais n'en prononce aucune.
  const peinesFournies = Object.values(peines).some((v) => v > 0)
  for (const [k, v] of Object.entries(peines)) if (v !== undefined) x[k] = v

  // Interdictions : un lieu ou une durée suffit à la dire prononcée ; false la retire.
  const lieuIp = p.lieuInterdictionParaitre !== undefined ? String(p.lieuInterdictionParaitre).trim().slice(0, 120) : undefined
  const dureeIp = moisEntier(p.dureeInterdictionParaitreMois, `dureeInterdictionParaitreMois (${nom})`)
  if (p.interdictionParaitre === false) {
    x.interdictionParaitre = false
    delete x.lieuInterdictionParaitre
    delete x.dureeInterdictionParaitre
  } else if (p.interdictionParaitre === true || lieuIp || dureeIp > 0) {
    x.interdictionParaitre = true
    if (lieuIp) x.lieuInterdictionParaitre = lieuIp
    if (dureeIp > 0) x.dureeInterdictionParaitre = dureeIp
  }
  const dureeIg = moisEntier(p.dureeInterdictionGererMois, `dureeInterdictionGererMois (${nom})`)
  if (p.interdictionGerer === false) {
    x.interdictionGerer = false
    delete x.dureeInterdictionGerer
  } else if (p.interdictionGerer === true || dureeIg > 0) {
    x.interdictionGerer = true
    if (dureeIg > 0) x.dureeInterdictionGerer = dureeIg
  }

  // Décision : dite, sinon déduite de ce qui est dicté, sinon celle déjà enregistrée.
  let statut = p.decision !== undefined ? decisionDe(p.decision, nom) : undefined
  if (statut === undefined) {
    if (peinesFournies) statut = 'condamnation'
    else if (p.dateRenvoi !== undefined) statut = 'renvoi'
    else statut = base.statut || (ctx.issue === 'audience_a_venir' ? 'renvoi' : undefined)
  }
  if (!statut) {
    throw new Error(`Décision manquante pour ${nom} : condamnation (avec la peine), relaxe, ou renvoi (avec dateRenvoi)`)
  }
  x.statut = statut

  if (statut === 'renvoi') {
    if (peinesFournies) throw new Error(`${nom} : une peine ET un renvoi — la décision est-elle rendue ou l'affaire renvoyée ?`)
    x.dateAudiencePending = x.dateAudiencePending || ctx.dateRenvoi
    if (!x.dateAudiencePending) throw new Error(`${nom} : date de renvoi requise (dateRenvoi)`)
  } else {
    if (!x.typeAudience) {
      throw new Error(`${nom} : orientation requise (CRPC, CI, COPJ, CDD ou OI) — la fenêtre de l'app l'exige pour toute personne jugée`)
    }
    if (statut === 'relaxe') {
      Object.assign(x, { peinePrison: 0, sursisProbatoire: 0, sursisSimple: 0, peineAmende: 0, interdictionParaitre: false, interdictionGerer: false })
      delete x.lieuInterdictionParaitre
      delete x.dureeInterdictionParaitre
      delete x.dureeInterdictionGerer
      if (x.typeAudience === 'CRPC-Def') ctx.avertissements.push(`${nom} : relaxe enregistrée sur une CRPC — la CRPC suppose la reconnaissance des faits ; orientation à vérifier (les statistiques ne la comptent pas comme CRPC)`)
    } else if (!aUnePeine(x)) {
      throw new Error(`${nom} : aucune peine chiffrée — l'app n'enregistre une condamnation qu'avec prison ferme, sursis probatoire, sursis simple ou amende (TIG, jours-amende, stage… n'ont pas de case : demander au magistrat comment les saisir)`)
    }
  }

  // Défèrement : dit, sinon celui de la voie suivie (CRPC, CI, CDD le supposent).
  if (x.defere === undefined) x.defere = DEFERE_PAR_DEFAUT.has(x.typeAudience)
  if (x.defere) {
    x.dateDefere = x.dateDefere || ctx.dateDefere
    if (!x.dateDefere) ctx.avertissements.push(`${nom} : déféré sans date de défèrement — les statistiques le rattachent alors au mois de l'audience`)
  } else {
    delete x.dateDefere
  }
  return x
}

/** Ligne « condamnations » de l'app (AudienceResultModal) — condamné ou relaxé. */
function versCondamnation(x) {
  const { statut, ...reste } = x
  const out = {
    ...reste,
    peinePrison: x.peinePrison || 0,
    sursisProbatoire: x.sursisProbatoire || 0,
    sursisSimple: x.sursisSimple || 0,
    peineAmende: x.peineAmende || 0,
    interdictionParaitre: Boolean(x.interdictionParaitre),
    interdictionGerer: Boolean(x.interdictionGerer),
    typeAudience: x.typeAudience,
    defere: Boolean(x.defere),
    isRelaxe: statut === 'relaxe',
    isPending: false,
    dateAudiencePending: x.dateAudiencePending || '',
  }
  if (out.misEnCauseId == null) delete out.misEnCauseId
  if (!out.dateDefere) delete out.dateDefere
  return out
}

/**
 * Ligne « en attente » : l'app n'y lisait que le nom et la date. Orientation,
 * défèrement et rattachement y sont gardés pour que la personne, une fois
 * jugée (ici ou dans la fenêtre de l'app), retrouve sa voie et sa date réelle
 * de défèrement.
 */
function versRenvoi(x) {
  const out = { nom: x.nom, dateAudiencePending: x.dateAudiencePending }
  if (x.typeAudience) out.typeAudience = x.typeAudience
  out.defere = Boolean(x.defere)
  if (x.defere && x.dateDefere) out.dateDefere = x.dateDefere
  if (x.misEnCauseId != null) out.misEnCauseId = x.misEnCauseId
  return out
}

const plusTot = (dates) => dates.filter(Boolean).sort()[0]

function codesInfraction(a, existant, e) {
  let codes = [a.natinfCodes].flat().map((c) => String(c ?? '').trim()).filter(Boolean)
  if (codes.length) {
    const inconnus = codes.filter((c) => !natinfEntry(c))
    if (inconnus.length) throw new Error(`NATINF inconnu(s) du référentiel : ${inconnus.join(', ')} — vérifier avec natinf_chercher`)
  } else if (existant?.infractionNatinfCodes?.length) {
    codes = existant.infractionNatinfCodes
  } else {
    codes = e.infractionNatinfCodes || []
  }
  codes = [...new Set(codes.map(String))]
  if (!codes.length) {
    throw new Error('Aucune infraction : le dossier n\'a pas de NATINF enregistré — fournir natinfCodes (natinf_chercher), la fenêtre de l\'app en exige au moins un')
  }
  const libelle = (c) => natinfEntry(c)?.libelle ?? `NATINF ${c}`
  return { infractionNatinfCodes: codes, typesInfraction: codes.map(libelle), typeInfraction: libelle(codes[0]) }
}

// ── Écriture ──

/**
 * Enregistre (ou complète) le résultat d'audience d'une enquête, puis
 * l'archive. Sans `remplacer`, un résultat existant est COMPLÉTÉ : les
 * personnes dictées sont mises à jour ou ajoutées, les autres restent.
 *
 * Sérialisé : plusieurs dossiers dictés d'un coup arrivent en appels
 * parallèles, et chacun relit puis réécrit le coffre ENTIER — sans verrou,
 * le dernier effacerait les autres.
 */
export async function enregistrerAudience(keys, a = {}) {
  return withFileLock('audience:enregistrer', () => enregistrer(keys, a))
}

async function enregistrer(keys, a) {
  if (!keys?.global) throw new Error('Trousseau sans clé globale — remise des clés requise')
  if (!String(a.numero ?? '').trim()) throw new Error('numero requis : le dossier (enquête) dont on enregistre le résultat')
  loadContentieux(keys) // trousseau sans clé du contentieux : erreur explicite plutôt qu'un « introuvable »
  const e = resolveEnquete(keys, a.numero)
  if (!e) throw new Error(`Dossier ${a.numero} introuvable — voir lister_dossiers (portee:"toutes")`)
  if (e.statut === 'instruction') {
    throw new Error(`Le dossier ${e.numero} est passé à l'instruction : ses résultats relèvent du module instruction, pas des résultats d'enquête`)
  }

  const personnesDictees = Array.isArray(a.personnes) ? a.personnes : []
  const issue = a.issue || (personnesDictees.length ? 'jugement' : (a.motifClassement !== undefined ? 'classement' : undefined))
  if (!ISSUES_AUDIENCE.includes(issue)) {
    throw new Error(`issue : ${ISSUES_AUDIENCE.join(' | ')} (personnes[] pour un jugement ou une audience à venir nominative)`)
  }
  if ((issue === 'classement' || issue === 'ouverture_information') && personnesDictees.length) {
    throw new Error(`${issue} : sans personnes — c'est le dossier entier qui est ${issue === 'classement' ? 'classé' : 'ouvert à l\'information'}`)
  }

  const fichier = lireCoffre(keys)
  const resultats = migrateLegacyResultats(fichier?.audienceResultats || {}).migrated
  const ctxId = attacheContentieux()
  const cle = buildResultatKey(ctxId, e.id)
  const existant = resultats[cle] || null
  const nature = natureDe(existant)
  const remplacer = a.remplacer === true

  const cible = issue === 'classement' ? 'classement' : issue === 'ouverture_information' ? 'oi' : 'jugement'
  const naturesCompatibles = {
    classement: ['aucun', 'brouillon', 'classement'],
    oi: ['aucun', 'brouillon', 'oi'],
    jugement: ['aucun', 'brouillon', 'a_venir', 'jugement'],
  }[cible]
  if (!remplacer && !naturesCompatibles.includes(nature)) {
    throw new Error(`Le dossier porte déjà ${resumeNature(existant)} — pour le remplacer, rappeler avec remplacer:true (la version actuelle reste dans l'historique du coffre)`)
  }

  const now = new Date().toISOString()
  const avertissements = []
  const precisions = []
  const socle = {
    enqueteId: e.id,
    contentieuxId: ctxId,
    // Données que la fenêtre de l'app garde d'une saisie à l'autre : les
    // saisies d'enquête ne se perdent jamais avec le résultat.
    ...(hasAnySaisies(existant?.saisies) ? { saisies: existant.saisies } : {}),
    ...(existant?.numeroAudience ? { numeroAudience: existant.numeroAudience } : {}),
  }
  let resultat

  if (cible === 'classement') {
    resultat = {
      ...socle,
      dateAudience: isoDate(a.dateAudience, 'dateAudience') || (nature === 'classement' && !remplacer ? existant.dateAudience : aujourdhui()),
      condamnations: [],
      confiscations: emptyConfiscations(),
      isClassement: true,
      motifClassement: a.motifClassement !== undefined ? String(a.motifClassement || '').slice(0, 500) : (nature === 'classement' ? existant.motifClassement || '' : ''),
    }
  } else if (cible === 'oi') {
    resultat = {
      ...socle,
      dateAudience: isoDate(a.dateAudience, 'dateAudience') || (nature === 'oi' && !remplacer ? existant.dateAudience : aujourdhui()),
      typeInfraction: 'OI',
      condamnations: [],
      confiscations: emptyConfiscations(),
      isOI: true,
      isDirectResult: false,
    }
  } else {
    const dateDefereCommune = isoDate(a.dateDefere, 'dateDefere')
    const ctx = {
      issue,
      avertissements,
      // Audience à venir : sa date vaut date de renvoi de chacun, sauf date propre.
      dateRenvoi: issue === 'audience_a_venir' ? isoDate(a.dateAudience, 'dateAudience') : undefined,
      // Défèrement commun : celui dicté, sinon celui saisi à l'archivage (« audience à venir »).
      dateDefere: dateDefereCommune || (!remplacer && nature === 'a_venir' ? existant.dateDefere : undefined),
    }
    const personnes = !remplacer && (nature === 'jugement' || nature === 'a_venir') ? personnesDe(existant) : []
    const vues = new Set()
    for (const p of personnesDictees) {
      const nomDicte = String(p?.nom || '').trim()
      if (!nomDicte) throw new Error('Chaque personne doit porter un nom')
      const r = rattacherMec(e, nomDicte)
      const dejaLa = trouverPersonne(personnes, r.mec ? r.mec.nom : nomDicte, r.mec?.id)
      if (r.mec) {
        if (r.motif) precisions.push(`« ${nomDicte} » rattaché au mis en cause ${r.mec.nom} (${r.motif})`)
      } else if (dejaLa) {
        if (normalizeNom(dejaLa.nom) !== normalizeNom(nomDicte)) precisions.push(`« ${nomDicte} » rapproché de ${dejaLa.nom}, déjà enregistré au résultat`)
      } else if (r.ambigu) {
        avertissements.push(`« ${nomDicte} » : plusieurs mis en cause possibles (${r.ambigu.join(', ')}) — laissé en texte libre, reprendre le nom exact pour le rattacher`)
      } else {
        avertissements.push(`« ${nomDicte} » ne figure pas aux mis en cause du dossier — enregistré en texte libre`)
      }
      const base = {
        ...(dejaLa || {}),
        nom: r.mec ? r.mec.nom : (dejaLa ? dejaLa.nom : nomDicte),
        ...(r.mec ? { misEnCauseId: r.mec.id } : {}),
      }
      const cleVue = normalizeNom(base.nom)
      if (vues.has(cleVue)) throw new Error(`${base.nom} figure deux fois dans la dictée`)
      vues.add(cleVue)
      const maj = appliquerPersonne(base, p, ctx)
      if (dejaLa) personnes[personnes.indexOf(dejaLa)] = maj
      else personnes.push(maj)
    }

    const juges = personnes.filter((x) => x.statut !== 'renvoi')
    const renvoyes = personnes.filter((x) => x.statut === 'renvoi')
    if (issue === 'audience_a_venir' && juges.length) {
      throw new Error(`audience_a_venir : ${juges.map((x) => x.nom).join(', ')} ${juges.length > 1 ? 'sont' : 'est'} déjà jugé(s) — utiliser issue:"jugement" (les renvoyés y restent en attente)`)
    }
    const nombreDeferesDicte = a.nombreDeferes !== undefined ? Number(a.nombreDeferes) : undefined
    if (nombreDeferesDicte !== undefined && (!Number.isInteger(nombreDeferesDicte) || nombreDeferesDicte < 0)) {
      throw new Error('nombreDeferes : entier positif attendu')
    }

    if (!juges.length) {
      // Personne n'est encore jugé : c'est une AUDIENCE À VENIR (branche « Audience
      // à venir » de l'archivage), nominative si des personnes sont dictées.
      if (issue === 'jugement' && !renvoyes.length) {
        throw new Error('Aucune personne : indiquer les personnes jugées ou renvoyées (personnes[])')
      }
      const dateAudience = isoDate(a.dateAudience, 'dateAudience')
        || plusTot(renvoyes.map((x) => x.dateAudiencePending))
        || (!remplacer && nature === 'a_venir' ? existant.dateAudience : undefined)
      if (!dateAudience) throw new Error('Date de l\'audience à venir requise (dateAudience)')
      const deferes = renvoyes.filter((x) => x.defere)
      let nombreDeferes
      let dateDefere
      if (deferes.length) {
        nombreDeferes = deferes.length
        dateDefere = plusTot(deferes.map((x) => x.dateDefere)) || ctx.dateDefere
        if (nombreDeferesDicte !== undefined && nombreDeferesDicte !== deferes.length) {
          avertissements.push(`nombreDeferes (${nombreDeferesDicte}) ignoré : ce sont les personnes dictées qui font foi (${deferes.length} déférée(s))`)
        }
      } else {
        // Aucun déféré nommé : le nombre dicté, sinon celui saisi à l'archivage.
        nombreDeferes = nombreDeferesDicte ?? (!remplacer && nature === 'a_venir' ? existant.nombreDeferes : undefined)
        dateDefere = ctx.dateDefere
      }
      if (nombreDeferes && !dateDefere) avertissements.push('Défèrement sans date — les statistiques le rattachent alors à la date d\'audience')
      resultat = {
        ...socle,
        dateAudience,
        condamnations: [],
        confiscations: emptyConfiscations(),
        isAudiencePending: true,
        typeInfraction: 'pending',
        ...(nombreDeferes ? { nombreDeferes } : {}),
        ...(nombreDeferes && dateDefere ? { dateDefere } : {}),
        ...(renvoyes.length ? { pendingCondamnations: renvoyes.map(versRenvoi) } : {}),
      }
    } else {
      const dateAudience = isoDate(a.dateAudience, 'dateAudience')
        || (!remplacer && (nature === 'jugement' || nature === 'a_venir') ? existant.dateAudience : undefined)
      if (!dateAudience) {
        throw new Error('dateAudience requise : date de l\'audience où la décision a été rendue (homologation de la CRPC, jugement) — souvent le jour du défèrement pour une CRPC')
      }
      const condamnations = juges.map(versCondamnation)
      const deferesJuges = condamnations.filter((c) => c.defere).length
      const deferesRenvoyes = renvoyes.filter((x) => x.defere)
      // Défèrements : une ligne par personne jugée (chacune à sa date). Un renvoyé
      // déféré n'a pas encore de ligne de condamnation ; sans report au niveau du
      // dossier, son défèrement disparaîtrait des statistiques jusqu'à son
      // jugement. On le porte donc au niveau du résultat (nombre TOTAL des
      // déférés + date) — règle de l'écran : ce total prime sur les lignes pour
      // la courbe des défèrements, et ne compte que le surplus dans les
      // orientations (aucun double compte). Une fois tout le monde jugé, les
      // lignes suffisent et le report s'efface — comme dans la fenêtre de l'app.
      let nombreDeferes
      let dateDefere
      if (deferesRenvoyes.length) {
        nombreDeferes = deferesJuges + deferesRenvoyes.length
        dateDefere = plusTot([...condamnations.filter((c) => c.defere).map((c) => c.dateDefere), ...deferesRenvoyes.map((x) => x.dateDefere)]) || ctx.dateDefere
      } else if (!deferesJuges && !remplacer && existant) {
        // Aucune personne déférée : on garde ce qui avait été saisi à l'archivage.
        nombreDeferes = existant.nombreDeferes
        dateDefere = existant.dateDefere
      }
      const attendus = !remplacer && nature === 'a_venir' ? Number(existant.nombreDeferes) || 0 : 0
      if (attendus && deferesJuges + deferesRenvoyes.length !== attendus) {
        avertissements.push(`${attendus} déféré(s) annoncé(s) à l'archivage, ${deferesJuges + deferesRenvoyes.length} saisi(s) — vérifier`)
      }

      let confiscations = !remplacer && nature === 'jugement' ? migrateConfiscations(existant.confiscations) : emptyConfiscations()
      if (a.reporterSaisies === true) {
        if (!hasAnySaisies(socle.saisies)) {
          avertissements.push('reporterSaisies : aucune saisie d\'enquête enregistrée sur ce dossier')
        } else {
          const { merged, totalAdded } = mergeConfiscations(confiscations, socle.saisies)
          confiscations = merged
          precisions.push(`${totalAdded} élément(s) repris des saisies d'enquête dans les confiscations`)
        }
      } else if (hasAnySaisies(socle.saisies) && countConfiscations(confiscations) === 0) {
        avertissements.push(`${countConfiscations(socle.saisies)} élément(s) saisi(s) pendant l'enquête non reporté(s) en confiscations — reporterSaisies:true pour les reprendre (bouton « Reporter les saisies » de l'app)`)
      }

      const partiel = renvoyes.length > 0
      resultat = {
        ...socle,
        dateAudience,
        condamnations,
        confiscations,
        ...codesInfraction(a, !remplacer ? existant : null, e),
        hasPartialResults: partiel,
        pendingCondamnations: renvoyes.map(versRenvoi),
        isPartiallyPending: partiel,
        ...(nombreDeferes ? { nombreDeferes } : {}),
        ...(nombreDeferes && dateDefere ? { dateDefere } : {}),
      }
    }
  }

  resultat.modifiedAt = now
  resultats[cle] = resultat
  await ecrireCoffre(keys, fichier || {}, resultats)

  // Archivage — même geste que l'app après la saisie des résultats.
  let archivage
  try {
    const r = await archiverDossier(keys, { numero: e.numero, mode: 'archiver' })
    archivage = r.note === 'déjà archivé' ? 'dossier déjà archivé' : 'dossier archivé'
  } catch (err) {
    archivage = `ÉCHEC de l'archivage (${err?.message || err}) — résultat enregistré, archiver avec archiver_dossier`
  }

  return {
    ok: true,
    dossier: e.numero,
    resultat: resumeResultat(resultat),
    archivage,
    ...(precisions.length ? { precisions } : {}),
    ...(avertissements.length ? { avertissements } : {}),
    note: 'Écrit dans les résultats d\'audience (version précédente archivée, réversible). Visible dans l\'app à la prochaine synchronisation (≤ 30 s) : page Archives et Statistiques.',
  }
}

// ── Lecture ──

function peineTexte(c) {
  const prison = []
  if (c.peinePrison > 0) prison.push(`${c.peinePrison} mois ferme`)
  if (c.sursisProbatoire > 0) prison.push(`${c.sursisProbatoire} mois sursis probatoire`)
  if (c.sursisSimple > 0) prison.push(`${c.sursisSimple} mois sursis simple`)
  const parts = prison.length ? [prison.join(' + ')] : []
  if (c.peineAmende > 0) parts.push(`amende ${c.peineAmende} €`)
  if (c.interdictionParaitre) {
    const precision = [c.lieuInterdictionParaitre, c.dureeInterdictionParaitre ? `${c.dureeInterdictionParaitre} mois` : ''].filter(Boolean).join(', ')
    parts.push(`interdiction de paraître${precision ? ` (${precision})` : ''}`)
  }
  if (c.interdictionGerer) parts.push(`interdiction de gérer${c.dureeInterdictionGerer ? ` (${c.dureeInterdictionGerer} mois)` : ''}`)
  return parts.join(' · ')
}

const defereTexte = (x) => (x.defere ? `déféré le ${dateFr(x.dateDefere)}` : 'non déféré')

function resumeNature(r) {
  switch (natureDe(r)) {
    case 'classement': return `un classement sans suite du ${dateFr(r.dateAudience)}`
    case 'oi': return `une ouverture d'information du ${dateFr(r.dateAudience)}`
    case 'a_venir': return `une audience à venir le ${dateFr(r.dateAudience)}`
    case 'jugement': return `un résultat d'audience du ${dateFr(r.dateAudience)}`
    default: return 'un brouillon de saisies'
  }
}

/** Le résultat en lignes lisibles — réponse de l'écriture et bloc de lire_dossier. */
export function resumeResultat(r) {
  const lignes = []
  const nature = natureDe(r)
  if (nature === 'classement') {
    lignes.push(`Classement sans suite le ${dateFr(r.dateAudience)}${r.motifClassement ? ` — motif : ${r.motifClassement}` : ''}`)
  } else if (nature === 'oi') {
    lignes.push(`Ouverture d'information le ${dateFr(r.dateAudience)}`)
  } else if (nature === 'a_venir') {
    lignes.push(`Audience à venir le ${dateFr(r.dateAudience)}${r.nombreDeferes ? ` — ${r.nombreDeferes} déféré(s) le ${dateFr(r.dateDefere)}` : ''}`)
  } else if (nature === 'jugement') {
    const renvois = r.pendingCondamnations || []
    lignes.push(`${renvois.length ? 'Jugement PARTIEL' : 'Jugement'} — audience du ${dateFr(r.dateAudience)}${renvois.length ? ` ; ${renvois.length} personne(s) renvoyée(s)` : ''}`)
    if (r.infractionNatinfCodes?.length) {
      lignes.push(`Infractions : ${r.infractionNatinfCodes.map((c, i) => `NATINF ${c} — ${r.typesInfraction?.[i] || '?'}`).join(' ; ')}`)
    }
  } else {
    return lignes
  }
  for (const c of r.condamnations || []) {
    if (!c) continue
    const decision = c.isRelaxe ? 'RELAXE' : peineTexte(c) || 'peine non chiffrée'
    lignes.push(`${c.nom || '(sans nom)'} — ${LIBELLE_ORIENTATION[c.typeAudience] || c.typeAudience || '?'} — ${defereTexte(c)} — ${decision}`)
  }
  for (const p of r.pendingCondamnations || []) {
    if (!p) continue
    const details = [p.typeAudience ? LIBELLE_ORIENTATION[p.typeAudience] || p.typeAudience : 'orientation non précisée', p.defere === undefined ? null : defereTexte(p)].filter(Boolean)
    lignes.push(`${p.nom} — RENVOI au ${dateFr(p.dateAudiencePending)} — ${details.join(' — ')}`)
  }
  if (nature === 'jugement' && r.nombreDeferes) {
    lignes.push(`Défèrements comptés au dossier : ${r.nombreDeferes} le ${dateFr(r.dateDefere)} (renvoyés compris, jusqu'à leur jugement)`)
  }
  const nbConf = countConfiscations(r.confiscations)
  const nbSaisies = hasAnySaisies(r.saisies) ? countConfiscations(r.saisies) : 0
  if (nbConf || nbSaisies) lignes.push(`Confiscations : ${nbConf} élément(s) · saisies d'enquête : ${nbSaisies} élément(s)`)
  return lignes
}

/** Bloc markdown « Résultat d'audience » de lire_dossier ('' si aucun). */
export function resultatAudienceMarkdown(keys, numero) {
  try {
    const e = resolveEnquete(keys, numero)
    const fichier = e ? lireCoffre(keys) : null
    if (!fichier) return ''
    const resultats = migrateLegacyResultats(fichier.audienceResultats || {}).migrated
    const r = resultats[buildResultatKey(attacheContentieux(), e.id)]
    const lignes = r ? resumeResultat(r) : []
    if (!lignes.length) return ''
    return ['\n## Résultat d\'audience (enregistrer_audience pour le compléter)', ...lignes.map((l) => `- ${l}`)].join('\n')
  } catch {
    return ''
  }
}
