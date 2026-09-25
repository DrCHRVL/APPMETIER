/**
 * SIRAL — test de bout en bout de l'ENREGISTREMENT DES RÉSULTATS D'AUDIENCE
 * (enregistrer_audience) depuis le connecteur / l'attaché.
 *
 * Fabrique un SIRAL_DATA_DIR réel (trousseau remis, coffre ctx-crimorg des
 * enquêtes, coffre global `audience` déjà peuplé comme par l'app : brouillon
 * de saisies, audience à venir), lance scripts/attache-mcp.mjs en stdio
 * JSON-RPC comme le CLI Claude Code, dicte des résultats, puis vérifie :
 *  - le coffre `audience` déchiffré (forme EXACTE de l'app : condamnations,
 *    renvoyés, résultat partiel, audience à venir, classement, OI) ;
 *  - l'archivage de l'enquête dans le coffre ctx (marqueur + journal) ;
 *  - la version précédente archivée, l'absence d'écriture sur erreur ;
 *  - les statistiques calculées par les CŒURS PARTAGÉS avec l'écran
 *    (défèrements à leur date réelle, renvoyés compris ; CRPC par personne ;
 *    relaxes à part ; procédures terminées).
 *
 *   node scripts/attache-audience.test.mjs
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-audience-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
const VAULTS = path.join(DATA_DIR, 'vaults')
fs.mkdirSync(VAULTS, { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, decryptJson } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)
const { deferementsAnnee, statsAudienceAnnee, proceduresTerminees } = await import(`${REPO}/lib/stats/ecranCore.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')

const enquete = (id, numero, mecs, extra = {}) => ({
  id, numero, dateDebut: '2025-11-02', dateCreation: '2025-11-02', dateMiseAJour: '2026-01-01T10:00:00.000Z',
  statut: 'en_cours', tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], toDos: [], modifications: [],
  misEnCause: mecs.map(([mid, nom, more]) => ({ id: mid, nom, statut: 'actif', ...(more || {}) })),
  ...extra,
})
const ENQUETES = [
  enquete(1, '2026/000101 - RESEAU NORD', [[11, 'DUPONT Jean'], [12, 'MARTIN Paul'], [13, 'DURAND Marc'], [14, 'LEROY Ali'], [15, 'BERNARD Luc', { isVictime: true }]], { infractionNatinfCodes: ['7991', '7992'] }),
  enquete(2, '2026/000202 - SUD', [[21, 'ALPHA Karim'], [22, 'BETA Yanis']], { statut: 'archive', dateArchivage: '2026-05-02T18:00:00.000Z' }),
  enquete(3, '2026/000303 - EST', [[31, 'GAMMA Leo']], { infractionNatinfCodes: ['7995'] }),
  enquete(4, '2026/000404 - OUEST', [[41, 'OMEGA Tom']], { infractionNatinfCodes: ['7991'] }),
  enquete(5, '2026/000505 - CENTRE', [[51, 'KAPPA Noe'], [52, 'SIGMA Rayan']], { infractionNatinfCodes: ['7992'] }),
]
fs.writeFileSync(path.join(VAULTS, 'ctx-crimorg.json'), JSON.stringify(encryptJson(keyCtx, {
  data: { enquetes: ENQUETES, version: 7 },
  metadata: { lastModified: '2026-01-01T10:00:00.000Z', modifiedBy: 'Audran CHEVALIER', version: 7 },
})))

// Coffre `audience` tel que l'app le pousse : brouillon de saisies (dossier 1),
// audience à venir saisie à l'archivage (dossier 2), résultat d'un AUTRE contentieux.
const SAISIES = { vehicules: [{ type: 'voiture', marqueModele: 'Audi A3' }], immeubles: [], numeraire: 5000, saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [] }
const vide = { vehicules: [], immeubles: [], numeraire: 0, saisiesBancaires: [], cryptomonnaies: [], objetsMobiliers: [] }
const AUDIENCE_INITIALE = {
  version: 12, updatedAt: '2026-01-01T10:00:00.000Z', updatedBy: 'Audran CHEVALIER', computerName: 'poste',
  audienceResultats: {
    crimorg__1: { enqueteId: 1, contentieuxId: 'crimorg', dateAudience: '', condamnations: [], confiscations: vide, saisies: SAISIES, isPreArchiveSaisies: true, modifiedAt: '2026-01-02T10:00:00.000Z' },
    crimorg__2: { enqueteId: 2, contentieuxId: 'crimorg', dateAudience: '2026-05-20', condamnations: [], confiscations: vide, isAudiencePending: true, typeInfraction: 'pending', dateDefere: '2026-05-02', nombreDeferes: 2, modifiedAt: '2026-05-02T18:00:00.000Z' },
    ecofi__1: { enqueteId: 1, contentieuxId: 'ecofi', dateAudience: '2026-02-02', condamnations: [], confiscations: vide, isClassement: true, modifiedAt: '2026-02-02T10:00:00.000Z' },
  },
}
const cheminAudience = path.join(VAULTS, 'audience.json')
fs.writeFileSync(cheminAudience, JSON.stringify(encryptJson(keyGlobal, AUDIENCE_INITIALE)))
const lireAudience = () => decryptJson(keyGlobal, JSON.parse(fs.readFileSync(cheminAudience, 'utf8')))
const lireEnquetes = () => decryptJson(keyCtx, JSON.parse(fs.readFileSync(path.join(VAULTS, 'ctx-crimorg.json'), 'utf8'))).data.enquetes

function lancer(run) {
  const child = spawn('node', [path.join(REPO, 'scripts/attache-mcp.mjs')], {
    env: { ...process.env, SIRAL_ATTACHE_RUN: run },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let buffer = ''
  const pending = new Map()
  child.stdout.on('data', (c) => {
    buffer += c.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
  })
  let nextId = 1
  const rpc = (method, params) => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)) } }, 30000)
    })
  }
  const call = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args })
    const text = r.result.content[0].text
    let json; try { json = JSON.parse(text) } catch { json = text }
    return { err: r.result.isError === true, json, text }
  }
  return { child, rpc, call }
}

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

const { child, rpc, call } = lancer('chat')
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
const outil = (await rpc('tools/list', {})).result.tools.find((t) => t.name === 'enregistrer_audience')
attendu('outil enregistrer_audience exposé', Boolean(outil) && outil.inputSchema.properties.personnes?.type === 'array')

// ── Erreurs : rien n'est écrit
const avantErreurs = fs.readFileSync(cheminAudience, 'utf8')
const cas = [
  ['dossier inconnu', { numero: '1999/999999', personnes: [{ nom: 'X', orientation: 'CI', prisonFermeMois: 3 }], dateAudience: '2026-03-10' }, /introuvable/],
  ['condamnation sans peine chiffrée', { numero: '2026/000101', dateAudience: '2026-03-10', personnes: [{ nom: 'DUPONT Jean', orientation: 'CI', decision: 'condamnation' }] }, /aucune peine chiffrée/],
  ['renvoi sans date', { numero: '2026/000101', personnes: [{ nom: 'DUPONT Jean', decision: 'renvoi' }] }, /date de renvoi requise/],
  ['orientation inconnue', { numero: '2026/000101', dateAudience: '2026-03-10', personnes: [{ nom: 'DUPONT Jean', orientation: 'CPPV', prisonFermeMois: 3 }] }, /CPPV/],
  ['mois non entiers', { numero: '2026/000101', dateAudience: '2026-03-10', personnes: [{ nom: 'DUPONT Jean', orientation: 'CI', prisonFermeMois: 1.5 }] }, /entier de mois/],
  ['date invalide', { numero: '2026/000101', dateAudience: '2026-02-30', personnes: [{ nom: 'DUPONT Jean', orientation: 'CI', prisonFermeMois: 3 }] }, /AAAA-MM-JJ/],
  ['personne dictée deux fois', { numero: '2026/000101', dateAudience: '2026-03-10', personnes: [{ nom: 'DUPONT', orientation: 'CI', prisonFermeMois: 3 }, { nom: 'Dupont Jean', orientation: 'CI', prisonFermeMois: 4 }] }, /deux fois/],
  ['jugé sans orientation', { numero: '2026/000101', dateAudience: '2026-03-10', personnes: [{ nom: 'DUPONT Jean', prisonFermeMois: 3 }] }, /orientation requise/],
  ['jugement sans date d\'audience', { numero: '2026/000101', personnes: [{ nom: 'DUPONT Jean', orientation: 'CI', prisonFermeMois: 3 }] }, /dateAudience requise/],
  ['classement avec personnes', { numero: '2026/000101', issue: 'classement', personnes: [{ nom: 'DUPONT Jean' }] }, /sans personnes/],
]
for (const [nom, args, motif] of cas) {
  const r = await call('enregistrer_audience', args)
  attendu(`refus : ${nom}`, r.err && motif.test(r.text), r.text.slice(0, 160))
}
attendu('aucune écriture sur erreur', fs.readFileSync(cheminAudience, 'utf8') === avantErreurs)

// ── Dictée : « DUPONT, MARTIN et DURAND déférés le 10/03. DUPONT et MARTIN CRPC :
//    DUPONT 12 mois dont 6 avec sursis probatoire, MARTIN 8 mois ferme et 500 €.
//    Renvoi au 15/04 pour les autres (DURAND en CI ; LEROY, convoqué en COPJ). »
let r = await call('enregistrer_audience', {
  numero: '2026/000101',
  dateAudience: '2026-03-10',
  dateDefere: '2026-03-10',
  personnes: [
    { nom: 'Dupont', decision: 'condamnation', orientation: 'CRPC', defere: true, prisonFermeMois: 6, sursisProbatoireMois: 6 },
    { nom: 'MARTIN', orientation: 'CRPC', prisonFermeMois: 8, amende: 500 },
    { nom: 'DURAND Marc', decision: 'renvoi', orientation: 'CI', defere: true, dateRenvoi: '2026-04-15' },
    { nom: 'LEROY Ali', decision: 'renvoi', orientation: 'COPJ', dateRenvoi: '15/04/2026' },
  ],
})
attendu('jugement partiel : ok', !r.err && r.json.ok === true, r.text.slice(0, 300))
attendu('dossier archivé', r.json.archivage === 'dossier archivé', r.json.archivage)
attendu('rattachements signalés', (r.json.precisions || []).some((l) => /Dupont.*DUPONT Jean/.test(l)) && (r.json.precisions || []).some((l) => /MARTIN.*MARTIN Paul/.test(l)))
attendu('saisies non reportées signalées', (r.json.avertissements || []).some((l) => /non reporté/.test(l)))
attendu('récapitulatif lisible', r.json.resultat.some((l) => /DUPONT Jean — CRPC — déféré le 10\/03\/2026 — 6 mois ferme \+ 6 mois sursis probatoire/.test(l))
  && r.json.resultat.some((l) => /DURAND Marc — RENVOI au 15\/04\/2026 — CI — déféré le 10\/03\/2026/.test(l)), JSON.stringify(r.json.resultat))

let aud = lireAudience()
let r1 = aud.audienceResultats.crimorg__1
const dupont = r1.condamnations.find((c) => c.nom === 'DUPONT Jean')
const martin = r1.condamnations.find((c) => c.nom === 'MARTIN Paul')
attendu('ligne DUPONT conforme à l\'app', dupont && dupont.misEnCauseId === 11 && dupont.typeAudience === 'CRPC-Def' && dupont.defere === true
  && dupont.dateDefere === '2026-03-10' && dupont.peinePrison === 6 && dupont.sursisProbatoire === 6 && dupont.sursisSimple === 0
  && dupont.peineAmende === 0 && dupont.interdictionParaitre === false && dupont.isRelaxe === false && dupont.isPending === false, JSON.stringify(dupont))
attendu('MARTIN : CRPC déférée par défaut, amende', martin && martin.defere === true && martin.dateDefere === '2026-03-10' && martin.peineAmende === 500 && martin.peinePrison === 8)
const durand = r1.pendingCondamnations.find((p) => p.nom === 'DURAND Marc')
const leroy = r1.pendingCondamnations.find((p) => p.nom === 'LEROY Ali')
attendu('renvoyés gardent orientation et défèrement', durand?.dateAudiencePending === '2026-04-15' && durand.typeAudience === 'CI' && durand.defere === true
  && durand.dateDefere === '2026-03-10' && durand.misEnCauseId === 13 && leroy?.typeAudience === 'COPJ' && leroy.defere === false && leroy.dateAudiencePending === '2026-04-15', JSON.stringify(r1.pendingCondamnations))
attendu('résultat partiel (drapeaux de l\'app)', r1.hasPartialResults === true && r1.isPartiallyPending === true && !r1.isAudiencePending && !r1.isPreArchiveSaisies)
attendu('défèrements des renvoyés portés au dossier', r1.nombreDeferes === 3 && r1.dateDefere === '2026-03-10')
attendu('infractions reprises du dossier', JSON.stringify(r1.infractionNatinfCodes) === '["7991","7992"]' && /DETENTION/.test(r1.typeInfraction) && r1.typesInfraction.length === 2)
attendu('saisies d\'enquête conservées', r1.saisies?.numeraire === 5000 && r1.saisies.vehicules.length === 1)
attendu('confiscations non inventées', r1.confiscations.vehicules.length === 0 && r1.confiscations.numeraire === 0)
attendu('modifiedAt posé (fusion client)', r1.modifiedAt > '2026-01-02T10:00:00.000Z')
attendu('autres résultats intacts', aud.audienceResultats.ecofi__1?.isClassement === true && aud.audienceResultats.crimorg__2?.isAudiencePending === true)
attendu('métadonnées du coffre', aud.version === 13 && aud.updatedBy === 'Audran CHEVALIER' && aud.computerName === 'SIRAL')
attendu('version précédente archivée', fs.readdirSync(path.join(VAULTS, '.versions', 'audience')).length >= 1)
let e1 = lireEnquetes().find((e) => e.id === 1)
attendu('enquête archivée comme par l\'app', e1.statut === 'archive' && Boolean(e1.dateArchivage) && e1.modifications.some((m) => m.type === 'enquete_archived') && e1.dateMiseAJour > '2026-01-01T10:00:00.000Z')

// Les chiffres que calculera l'écran (cœurs partagés)
let enquetes = lireEnquetes()
const fin2026 = new Date('2026-12-31T12:00:00Z')
let def = deferementsAnnee(aud.audienceResultats, 2026, { maintenant: fin2026, enquetes })
attendu('écran : 3 défèrements en mars (renvoyé compris)', def.total === 5 && def.parMois[2] === 3, `total ${def.total} (dont 2 du dossier 2), mars ${def.parMois[2]}`)
let s = statsAudienceAnnee(aud.audienceResultats, enquetes, 2026)
attendu('écran : 2 CRPC, 2 condamnations, 3 défèrements d\'orientation', s.nombreCRPC === 2 && s.nombreCondamnations === 2 && s.nombreDeferements === 3, `CRPC ${s.nombreCRPC}, cond ${s.nombreCondamnations}, déf ${s.nombreDeferements}`)
attendu('écran : procédure partielle comptée terminée', proceduresTerminees(aud.audienceResultats, enquetes, 2026, fin2026).total === 1)

// ── Plus tard : « DURAND jugé le 15/04 : 18 mois ferme » (compléter)
r = await call('enregistrer_audience', { numero: '2026/000101', personnes: [{ nom: 'DURAND', prisonFermeMois: 18 }] })
attendu('compléter un renvoyé : ok', !r.err && r.json.archivage === 'dossier déjà archivé', r.text.slice(0, 300))
r1 = lireAudience().audienceResultats.crimorg__1
const durandJuge = r1.condamnations.find((c) => c.nom === 'DURAND Marc')
attendu('DURAND jugé : voie et défèrement retrouvés', durandJuge?.typeAudience === 'CI' && durandJuge.defere === true && durandJuge.dateDefere === '2026-03-10'
  && durandJuge.peinePrison === 18 && durandJuge.dateAudiencePending === '2026-04-15', JSON.stringify(durandJuge))
attendu('les autres personnes restent', r1.condamnations.length === 3 && r1.pendingCondamnations.length === 1 && r1.pendingCondamnations[0].nom === 'LEROY Ali')
attendu('date d\'audience principale conservée', r1.dateAudience === '2026-03-10')
attendu('report au dossier effacé (lignes suffisent)', r1.nombreDeferes === undefined && r1.dateDefere === undefined && r1.hasPartialResults === true)

// ── « LEROY relaxé » : dossier entièrement jugé
r = await call('enregistrer_audience', { numero: '2026/000101', personnes: [{ nom: 'LEROY', decision: 'relaxe' }] })
r1 = lireAudience().audienceResultats.crimorg__1
const leroyRelaxe = r1.condamnations.find((c) => c.nom === 'LEROY Ali')
attendu('relaxe enregistrée', !r.err && leroyRelaxe?.isRelaxe === true && leroyRelaxe.peinePrison === 0 && leroyRelaxe.typeAudience === 'COPJ' && leroyRelaxe.defere === false, r.text.slice(0, 200))
attendu('plus de renvoyé : résultat complet', r1.pendingCondamnations.length === 0 && r1.hasPartialResults === false && r1.isPartiallyPending === false)
aud = lireAudience()
enquetes = lireEnquetes()
s = statsAudienceAnnee(aud.audienceResultats, enquetes, 2026)
attendu('écran : relaxe à part, orientations par dossier', s.nombreRelaxes === 1 && s.nombreCondamnations === 3 && s.nombreCRPC === 2 && s.nombreCI === 1 && s.nombreCOPJ === 1 && s.nombreDeferements === 3,
  `relaxes ${s.nombreRelaxes}, cond ${s.nombreCondamnations}, CRPC ${s.nombreCRPC}, CI ${s.nombreCI}, COPJ ${s.nombreCOPJ}, déf ${s.nombreDeferements}`)

// ── Audience à venir saisie dans l'app, puis jugée : infractions exigées
r = await call('enregistrer_audience', { numero: '2026/000202', personnes: [{ nom: 'ALPHA Karim', orientation: 'CI', prisonFermeMois: 24 }, { nom: 'BETA', orientation: 'CI', decision: 'relaxe' }] })
attendu('sans NATINF au dossier : refus explicite', r.err && /natinfCodes/.test(r.text), r.text.slice(0, 200))
r = await call('enregistrer_audience', { numero: '2026/000202', natinfCodes: ['7995'], personnes: [{ nom: 'ALPHA Karim', orientation: 'CI', prisonFermeMois: 24 }, { nom: 'BETA', orientation: 'CI', decision: 'relaxe' }] })
const r2 = lireAudience().audienceResultats.crimorg__2
attendu('audience à venir jugée : date reprise', !r.err && r2.dateAudience === '2026-05-20' && !r2.isAudiencePending && r2.typeInfraction === 'IMPORTATION NON AUTORISEE DE STUPEFIANTS', r.text.slice(0, 300))
attendu('défèrement saisi à l\'archivage reporté sur chaque ligne', r2.condamnations.every((c) => c.defere === true && c.dateDefere === '2026-05-02') && r2.nombreDeferes === undefined)
attendu('pas d\'écart annoncé (2 déférés sur 2)', !(r.json.avertissements || []).some((l) => /annoncé/.test(l)))

// ── Tout le monde renvoyé : audience à venir nominative (CDD)
r = await call('enregistrer_audience', {
  numero: '2026/000303', dateDefere: '2026-06-10',
  personnes: [{ nom: 'GAMMA Leo', orientation: 'CDD', dateRenvoi: '2026-07-01' }, { nom: 'DELTA Max', orientation: 'CDD', dateRenvoi: '2026-07-08' }],
})
const r3 = lireAudience().audienceResultats.crimorg__3
attendu('audience à venir nominative', !r.err && r3.isAudiencePending === true && r3.typeInfraction === 'pending' && r3.dateAudience === '2026-07-01'
  && r3.nombreDeferes === 2 && r3.dateDefere === '2026-06-10' && r3.pendingCondamnations.length === 2 && r3.condamnations.length === 0, r.text.slice(0, 300))
attendu('nom hors mis en cause signalé', (r.json.avertissements || []).some((l) => /DELTA Max.*texte libre/.test(l)))
attendu('dossier 3 archivé', lireEnquetes().find((e) => e.id === 3).statut === 'archive')

// ── Classement, puis garde avant de changer de nature
r = await call('enregistrer_audience', { numero: '2026/000404', issue: 'classement', motifClassement: 'Infraction insuffisamment caractérisée', dateAudience: '2026-02-01' })
let r4 = lireAudience().audienceResultats.crimorg__4
attendu('classement sans suite', !r.err && r4.isClassement === true && r4.motifClassement === 'Infraction insuffisamment caractérisée' && r4.dateAudience === '2026-02-01')
r = await call('enregistrer_audience', { numero: '2026/000404', dateAudience: '2026-03-01', personnes: [{ nom: 'OMEGA Tom', orientation: 'CI', prisonFermeMois: 2 }] })
attendu('changer un classement exige remplacer:true', r.err && /classement sans suite/.test(r.text) && /remplacer/.test(r.text), r.text.slice(0, 200))
r = await call('enregistrer_audience', { numero: '2026/000404', issue: 'ouverture_information', dateAudience: '2026-03-05', remplacer: true })
r4 = lireAudience().audienceResultats.crimorg__4
attendu('OI en remplacement', !r.err && r4.isOI === true && r4.typeInfraction === 'OI' && !r4.isClassement && r4.dateAudience === '2026-03-05')

// ── Dictée « bruitée » (zéros, champs vides, participes) : rien d'inventé, rien d'effacé
r = await call('enregistrer_audience', {
  numero: '2026/000505', dateAudience: '2026-08-01', natinfCodes: [],
  personnes: [
    { nom: 'KAPPA Noe', decision: 'condamné', orientation: 'CI', dateDefere: '2026-08-01', prisonFermeMois: 10, sursisProbatoireMois: 0, sursisSimpleMois: 0, amende: 0,
      interdictionParaitre: true, lieuInterdictionParaitre: 'Amiens', dureeInterdictionParaitreMois: 24, interdictionGerer: false, dureeInterdictionGererMois: 0 },
    { nom: 'SIGMA', decision: 'renvoyé', orientation: 'CI', dateDefere: '2026-08-01', dateRenvoi: '2026-09-01', prisonFermeMois: 0, amende: 0, dureeInterdictionParaitreMois: 0, lieuInterdictionParaitre: '' },
  ],
})
let r5 = lireAudience().audienceResultats.crimorg__5
const kappa = r5?.condamnations.find((c) => c.nom === 'KAPPA Noe')
attendu('zéros et participes tolérés', !r.err && kappa?.peinePrison === 10 && r5.pendingCondamnations[0]?.nom === 'SIGMA Rayan' && r5.pendingCondamnations[0].defere === true, r.text.slice(0, 300))
attendu('interdiction de paraître (lieu, durée), pas d\'interdiction de gérer inventée', kappa?.interdictionParaitre === true && kappa.lieuInterdictionParaitre === 'Amiens'
  && kappa.dureeInterdictionParaitre === 24 && kappa.interdictionGerer === false && kappa.dureeInterdictionGerer === undefined, JSON.stringify(kappa))
attendu('natinfCodes vide : infractions du dossier', JSON.stringify(r5.infractionNatinfCodes) === '["7992"]')
r = await call('enregistrer_audience', { numero: '2026/000505', issue: 'jugement', personnes: [{ nom: 'KAPPA', orientation: '', dateDefere: '', interdictionParaitre: false }] })
r5 = lireAudience().audienceResultats.crimorg__5
const kappa2 = r5.condamnations.find((c) => c.nom === 'KAPPA Noe')
attendu('champs vides : rien d\'effacé ; false retire l\'interdiction', !r.err && kappa2.typeAudience === 'CI' && kappa2.dateDefere === '2026-08-01' && kappa2.peinePrison === 10
  && kappa2.interdictionParaitre === false && kappa2.lieuInterdictionParaitre === undefined, JSON.stringify(kappa2))

// ── « Audience à venir le 01/10 pour KAPPA et SIGMA » : la date vaut renvoi de chacun
r = await call('enregistrer_audience', { numero: '2026/000505', issue: 'audience_a_venir', dateAudience: '2026-10-01', remplacer: true,
  personnes: [{ nom: 'KAPPA Noe', orientation: 'CI', defere: true, dateDefere: '2026-08-01' }, { nom: 'SIGMA Rayan', orientation: 'COPJ' }] })
r5 = lireAudience().audienceResultats.crimorg__5
attendu('audience à venir : date commune de renvoi', !r.err && r5.isAudiencePending === true && r5.dateAudience === '2026-10-01'
  && r5.pendingCondamnations.every((p) => p.dateAudiencePending === '2026-10-01') && r5.nombreDeferes === 1 && r5.dateDefere === '2026-08-01', r.text.slice(0, 300))

// ── Lecture : lire_dossier montre le résultat
r = await call('lire_dossier', { numero: '2026/000101' })
attendu('lire_dossier : bloc résultat d\'audience', typeof r.json === 'string' && /## Résultat d'audience/.test(r.json) && /LEROY Ali — COPJ — non déféré — RELAXE/.test(r.json), String(r.text).slice(-600))
r = await call('lire_dossier', { numero: '2026/000101', section: 'mec' })
attendu('section ciblée inchangée', !/Résultat d'audience/.test(String(r.json)))

child.stdin.end()

// ── Run autonome : écriture interdite
const auto = lancer('apprentissage')
await auto.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
r = await auto.call('enregistrer_audience', { numero: '2026/000404', issue: 'classement' })
attendu('run autonome : refusé', r.err && /Run autonome/.test(r.text), r.text.slice(0, 160))
auto.child.stdin.end()

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.log(`\n${echecs.length} échec(s) : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
