/**
 * SIRAL — test du FLUX TENDU (file d'attente + pipeline par dossier).
 *
 * Vérifie, sans modèle (briques IA remplacées par des doublures) :
 *   - la relève pose un point de référence SILENCIEUX (rien en file) ;
 *   - un réveil met le dossier en file avec sa raison et son auteur, et la
 *     pompe respecte la période de calme ;
 *   - un passage ingère les pièces nouvelles, les fiche, analyse les actes
 *     (proposition ✓/✗ dédoublonnée, carte d'alerte sur les incohérences),
 *     joint au run les fiches, les candidats mis en cause (rôle de mis en
 *     cause, jamais un témoin, jamais un enregistré) et l'analyse ;
 *   - le CR écrit par le run, la proposition de mis en cause et la description
 *     sont comptés ; les pièces reçoivent leur marque de flux ; le CR de
 *     l'attaché ne réveille pas le dossier ;
 *   - un second passage sans neuf ne lance aucun run ;
 *   - un CR ajouté par l'app (relève) repasse en file et est joint au run ;
 *   - un versement massif bascule sur un chantier au lieu d'un passage rapide.
 *
 *   node scripts/attache-flux.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-flux-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, decryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM = '500/100/2026 - FLUXTEST'
const enqueteInitiale = () => ({
  id: 1, numero: NUM, dateDebut: '2026-03-01', statut: 'en_cours', description: 'SYNTHÈSE\nTrafic de résine.\nMIS EN CAUSE\nDURAND Kévin — transports.',
  tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [],
  misEnCause: [{ id: 1, nom: 'DURAND Kévin', role: 'transporteur', statut: 'actif' }],
  infractionNatinfCodes: ['7101'],
})
function ecrireVault(enquetes) {
  const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 1 }
  fs.writeFileSync(
    path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
    JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }))
  )
}
ecrireVault([enqueteInitiale()])

const { writeDocBlob, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const { readRegistre, writeRegistre } = await import(`${REPO}/scripts/attache/registre.mjs`)
const { classerNote, loadContentieux, actualiserDescription } = await import(`${REPO}/scripts/attache/dossier.mjs`)
const { addProposition, listPropositions } = await import(`${REPO}/scripts/attache/propositions.mjs`)
const { readFeed } = await import(`${REPO}/scripts/attache/journal.mjs`)
const flux = await import(`${REPO}/scripts/attache/flux.mjs`)

const KEY = docServerKey(NUM)
const verse = (rel, texte) =>
  writeDocBlob(attacheTj(), KEY, rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'greffe' })
const enquete = () => loadContentieux(keys).data.enquetes.find((e) => e.numero === NUM)

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// ── Doublures des briques IA ─────────────────────────────────────────────
const FICHES = {
  'PV/D1_audition_MARTIN.txt': {
    type: 'PV audition', datePiece: '2026-09-02',
    personnes: [
      { nom: 'MARTIN Paul', alias: 'Polo', role: 'mis en cause' },
      { nom: 'DUPONT Jean', role: 'témoin' },
      { nom: 'DURAND Kévin', role: 'mis en cause' },
    ],
    resume: 'MARTIN Paul reconnaît fournir la résine à DURAND ; DUPONT Jean a vu les remises au garage.',
  },
  'Actes/ordonnance_ecoute.txt': {
    type: 'ordonnance', datePiece: '2026-09-01', personnes: [{ nom: 'MARTIN Paul', role: 'mis en cause' }],
    resume: 'Le JLD autorise l\'interception de la ligne 06.12.34.56.78 attribuée à MARTIN pour un mois.',
  },
}
const appels = { fiches: 0, analyse: [], runs: [], chantiers: [] }
flux.configurerFlux({
  registreFichesStep: async (k, { docKey }) => {
    appels.fiches++
    const reg = readRegistre(k, docKey)
    let faites = 0
    for (const [rel, e] of Object.entries(reg.pieces)) {
      if (e.fiche) continue
      e.fiche = FICHES[rel] || { type: 'autre', personnes: [], resume: `pièce ${rel}` }
      faites++
    }
    writeRegistre(k, docKey, reg)
    return { dossier: NUM, faites, copies: 0, echecs: 0, restantes: 0 }
  },
  analyseDocuments: async (args) => {
    appels.analyse.push(args)
    return {
      ok: true,
      actes: [
        { fileName: 'Actes/ordonnance_ecoute.txt', type: 'autorisation_initiale_ecoute', autorite: 'jld', cibles: ['06.12.34.56.78'], duree: '1', dureeUnit: 'mois', dateAutorisation: '2026-09-01', titulaire: 'MARTIN Paul', confidence: 0.92, motif: 'dispositif clair' },
        { fileName: 'Actes/ordonnance_ecoute.txt', type: 'autorisation_initiale_ecoute', autorite: 'jld', cibles: ['06.99.99.99.99'], duree: '1', dureeUnit: 'mois', dateAutorisation: '2026-09-01', confidence: 0.3, motif: 'OCR douteux' },
      ],
      chaineLegale: [],
      incoherences: [{ type: 'natinf_absent', fileName: 'Actes/ordonnance_ecoute.txt', detail: 'vise le 7989 (blanchiment), absent du dossier', severite: 'warning', natinfCode: '7989' }],
      crSuggere: 'Ordonnance JLD du 01/09 — interception 06.12.34.56.78 (MARTIN), 1 mois.',
      resume: 'une ordonnance',
    }
  },
  runAgent: async ({ prompt }) => {
    appels.runs.push(prompt)
    // Ce que ferait le run : un CR complet, un mis en cause proposé, la description.
    await classerNote(keys, { numero: NUM, titre: 'Réception de pièces — fournisseur identifié', contenu: 'PIÈCES REÇUES…\nFAITS NOUVEAUX : MARTIN Paul fournit la résine (PV/D1).' })
    await addProposition(keys, { numero: NUM, type: 'mec', payload: { nom: 'MARTIN Paul', role: 'Fournisseur de la résine remise à DURAND au garage, d\'après son audition (PV/D1) ; titulaire de la ligne interceptée.' }, source: 'PV/D1_audition_MARTIN.txt' })
    await actualiserDescription(keys, { numero: NUM, description: 'SYNTHÈSE\nTrafic de résine, fournisseur MARTIN.\nMIS EN CAUSE\nDURAND Kévin — transports.' })
    return { ok: true, convId: 'conv-test' }
  },
  createChantier: async (k, opts) => {
    appels.chantiers.push(opts)
    return { id: 'ch-test', etat: 'devis', creeLe: new Date().toISOString(), estimation: { pieces: 120, lots: 10, nuits: 2, heures: 6 } }
  },
})

// ── 1. Relève : point de référence silencieux
let r = flux.balayer(keys)
attendu('relève initiale : rien en file', r.enfiles.length === 0 && flux.fileAttente().enAttente.length === 0)

// ── 2. Pièces versées + réveil
verse('PV/D1_audition_MARTIN.txt', 'Audition de MARTIN Paul dit Polo : il fournit la résine à DURAND Kévin. DUPONT Jean, témoin, a vu les remises. Ligne 06.12.34.56.78.')
verse('Actes/ordonnance_ecoute.txt', 'Ordonnance du JLD autorisant l\'interception de la ligne 06.12.34.56.78 (MARTIN Paul) pour une durée d\'un mois.')
const rev = flux.enfiler(keys, { docKey: KEY, raison: 'document', par: 'greffe' })
attendu('réveil par clé de dossier : dossier en file, position 1', rev?.numero === NUM && rev.position === 1, JSON.stringify(rev))
const fa = flux.fileAttente()
attendu('file : raison et auteur visibles', fa.enAttente[0]?.numero === NUM && fa.enAttente[0].raisons.includes('document — greffe'), JSON.stringify(fa.enAttente))
attendu('réveil inconnu ignoré', flux.enfiler(keys, { numero: 'inconnu/2026' }) === null)

const p0 = await flux.pomper(keys)
attendu('pompe : période de calme respectée (rien traité tout de suite)', p0.ok && p0.traites.length === 0, JSON.stringify(p0))

// ── 3. Passage complet
const b1 = await flux.traiterDossier(keys, NUM)
attendu('passage : 2 pièces nouvelles, run lancé', b1.pieces === 2 && b1.run === true && b1.ok === true, JSON.stringify(b1))
attendu('mini-fiches demandées sur ce dossier seulement', appels.fiches >= 1)
attendu('analyse d\'actes : seules les pièces des zones d\'actes', appels.analyse.length === 1 && appels.analyse[0].docs.length === 1 && appels.analyse[0].docs[0].fileName === 'Actes/ordonnance_ecoute.txt', JSON.stringify(appels.analyse[0]?.docs?.map((d) => d.fileName)))
attendu('analyse d\'actes : contexte NATINF transmis', appels.analyse[0].enquete.natinfs.includes('7101'))
const propsActe = listPropositions(keys, { numero: NUM }).filter((p) => p.type === 'acte')
attendu('un acte proposé (confiance faible écartée)', propsActe.length === 1 && propsActe[0].payload.cible === '06.12.34.56.78' && propsActe[0].payload.statut === 'en_cours' && b1.actesProposes === 1, JSON.stringify(propsActe.map((p) => p.payload)))
attendu('CR écrit et MEC proposé comptés', b1.crEcrit === 1 && b1.mecProposes === 1 && b1.descriptionChangee === true, JSON.stringify(b1))
const prompt1 = appels.runs[0] || ''
attendu('prompt : fiches jointes', prompt1.includes('PV/D1_audition_MARTIN.txt') && prompt1.includes('reconnaît fournir'))
attendu('prompt : candidat MARTIN (rôle mis en cause), pas DUPONT (témoin), pas DURAND (enregistré)',
  /CANDIDATS MIS EN CAUSE[\s\S]*MARTIN Paul/.test(prompt1) && !/CANDIDATS MIS EN CAUSE[\s\S]*DUPONT/.test(prompt1) && !/CANDIDATS MIS EN CAUSE[\s\S]*DURAND/.test(prompt1))
attendu('prompt : analyse des actes jointe (proposés, incohérence, CR suggéré)', prompt1.includes('1 acte(s) PROPOSÉ(S)') && prompt1.includes('INCOHÉRENCE natinf_absent') && prompt1.includes('Projet de CR de réception'))
attendu('prompt : description et mis en cause enregistrés', prompt1.includes('DESCRIPTION ACTUELLE') && prompt1.includes('DURAND Kévin (transporteur)'))
attendu('prompt : consignes du socle flux', prompt1.includes('FAITS NOUVEAUX') && prompt1.includes('classer_note'))
const reg1 = readRegistre(keys, KEY)
attendu('pièces marquées traitées par le flux', Boolean(reg1.pieces['PV/D1_audition_MARTIN.txt']?.flux?.le) && Boolean(reg1.pieces['Actes/ordonnance_ecoute.txt']?.flux?.le))
const feed = readFeed().map((l) => decryptJson(keys.global, l))
attendu('carte d\'alerte sur l\'incohérence', feed.some((c) => c.type === 'alerte' && /natinf_absent/.test(c.resume)), JSON.stringify(feed.map((c) => c.titre)))
attendu('file vidée après le passage', flux.fileAttente().enAttente.length === 0 && flux.fileAttente().derniers[0]?.numero === NUM)

// ── 4. Le CR de l'attaché ne réveille pas ; rien de neuf = pas de run
r = flux.balayer(keys)
attendu('relève : le CR écrit par l\'attaché ne remet pas le dossier en file', r.enfiles.length === 0, JSON.stringify(r))
const b2 = await flux.traiterDossier(keys, NUM)
attendu('second passage : rien de neuf, aucun run', b2.pieces === 0 && b2.run === false && appels.runs.length === 1, JSON.stringify(b2))

// ── 5. Un CR ajouté par l'app : relève → file → joint au run
{
  const e = enquete()
  e.comptesRendus.push({ id: Date.now() + 7, date: '2026-09-05', enqueteur: 'CAPITAINE X', description: 'Surveillance du 04/09 : <b>MARTIN</b> vu au garage avec une Clio FG-527-XZ.' })
  const { data } = loadContentieux(keys)
  ecrireVault(data.enquetes.map((x) => (x.numero === NUM ? e : x)))
}
r = flux.balayer(keys)
attendu('relève : CR ajouté par l\'app → dossier en file (raison tick)', r.enfiles.includes(NUM) && flux.fileAttente().enAttente[0]?.raisons.includes('tick'), JSON.stringify(r))
const b3 = await flux.traiterDossier(keys, NUM)
const prompt3 = appels.runs[1] || ''
attendu('passage : le CR nouveau est joint (HTML retiré), aucune pièce', b3.crs === 1 && b3.pieces === 0 && b3.run === true && prompt3.includes('CR NOUVEAUX (1)') && prompt3.includes('MARTIN vu au garage') && !prompt3.includes('<b>'), JSON.stringify(b3))

// ── 6. Versement massif → chantier
for (let i = 0; i < flux.CHANTIER_SEUIL; i++) verse(`PV/Masse/D${1000 + i}.txt`, `Procès-verbal numéro ${i} : constatations.`)
flux.enfiler(keys, { numero: NUM, raison: 'document', par: 'greffe' })
const b4 = await flux.traiterDossier(keys, NUM)
attendu('versement massif : bascule chantier, pas de run', b4.chantier === true && appels.chantiers.length === 1 && appels.chantiers[0].numero === NUM && appels.runs.length === 2, JSON.stringify(b4))
const reg4 = readRegistre(keys, KEY)
attendu('pièces du versement massif marquées (chantier)', Object.values(reg4.pieces).filter((e) => e.flux?.chantier).length >= flux.CHANTIER_SEUIL)
attendu('file vidée', flux.fileAttente().enAttente.length === 0)

console.log(echecs.length ? `\n${echecs.length} échec(s) : ${echecs.join(' ; ')}` : '\nTous les tests passent.')
fs.rmSync(SCRATCH, { recursive: true, force: true })
process.exit(echecs.length ? 1 : 0)
