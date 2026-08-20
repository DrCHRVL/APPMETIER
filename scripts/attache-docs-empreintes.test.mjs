/**
 * SIRAL — test des EMPREINTES de contenu et de la RECHERCHE PLEIN TEXTE.
 *
 * Vérifie la chaîne « chaque versement analysé, indexé, dédoublonné » :
 *   - ensureDocShas complète l'index avec le sha256 du CLAIR (le stock ancien
 *     n'en a pas) — deux pièces au contenu identique ⇒ même empreinte ;
 *   - groupesDoublons ne groupe QUE les contenus strictement identiques ;
 *   - dossier_arborescence annote les copies (copieExacteDe) sans jamais
 *     écarter une pièce simplement voisine ;
 *   - pieces_chercher trouve (insensible casse/accents, mots en ET), sert les
 *     extraits avec le chemin exact, saute les doublons exacts et fouille
 *     aussi les fiches de dépouillement ;
 *   - createChantier écarte les copies exactes des lots (chaque contenu lu
 *     une fois) et les nomme dans le devis.
 *
 * Fabrique un SIRAL_DATA_DIR réel (clé-maître, trousseau remis, coffre
 * ctx-crimorg chiffré, blobs SIR1) puis appelle directement les modules.
 *
 *   node scripts/attache-docs-empreintes.test.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-docs-test-'))
const DATA_DIR = path.join(SCRATCH, 'siral-test-data')
fs.mkdirSync(path.join(DATA_DIR, 'vaults'), { recursive: true })

process.env.SIRAL_DATA_DIR = DATA_DIR
process.env.SIRAL_ATTACHE_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const { encryptJson, encryptDocBlob } = await import(`${REPO}/scripts/attache/crypto.mjs`)
const { grantKeyring, loadKeyring } = await import(`${REPO}/scripts/attache/keyring.mjs`)

const keyGlobal = crypto.randomBytes(32)
const keyCtx = crypto.randomBytes(32)
grantKeyring({ global: keyGlobal.toString('base64'), 'ctx-crimorg': keyCtx.toString('base64') }, 'Audran CHEVALIER')
const keys = loadKeyring()

const NUM = '500/100/2026 - TESTDOC'
const NUM2 = '600/200/2026 - TESTDOC2'
const enquetes = [{
  id: 1, numero: NUM, dateDebut: '2026-03-01', statut: 'en_cours',
  tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [],
}, {
  id: 2, numero: NUM2, dateDebut: '2026-04-01', statut: 'en_cours',
  tags: [], actes: [], comptesRendus: [], ecoutes: [], geolocalisations: [], misEnCause: [],
}]
const syncData = { enquetes, audienceResultats: {}, customTags: [], alertRules: [], version: 1 }
fs.writeFileSync(
  path.join(DATA_DIR, 'vaults', 'ctx-crimorg.json'),
  JSON.stringify(encryptJson(keyCtx, { data: syncData, metadata: { lastModified: new Date().toISOString(), modifiedBy: 'test', version: 1 } }))
)

const { writeDocBlob, listDocsMeta, docServerKey, attacheTj } = await import(`${REPO}/scripts/attache/store.mjs`)
const { ensureDocShas, groupesDoublons, arborescenceDocuments, chercherDansPieces, normAligne } =
  await import(`${REPO}/scripts/attache/dossier.mjs`)

const KEY = docServerKey(NUM)
const verse = (rel, texte, meta = {}) =>
  writeDocBlob(attacheTj(), KEY, rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'test', ...meta })
const verse2 = (rel, texte) =>
  writeDocBlob(attacheTj(), docServerKey(NUM2), rel, encryptDocBlob(keyGlobal, Buffer.from(texte, 'utf8')), { savedBy: 'test' })

// ── Corpus : 4 pièces + 1 copie exacte + 1 version voisine + 1 copie MD/
const AUDITION = 'Audition de M. DURAND Kévin, demeurant à Péronne.\nIl reconnaît les transports de résine vers Amiens à bord de la Clio grise immatriculée FG-527-XZ.'
verse('PV/Proc1/D12_audition_DURAND.txt', AUDITION)
verse('PV/Proc2/D340_audition_DURAND.txt', AUDITION)                                // copie EXACTE (jonction)
verse('PV/Proc1/D13_audition_DURAND_suite.txt', AUDITION + '\nIl précise avoir agi seul.') // version VOISINE : pas un doublon
verse('Actes/ordonnance_ecoutes.md', "Ordonnance autorisant l'interception de la ligne 06.12.34.56.78 visant Kévin DURAND.")
verse('Ecoutes/retranscription_0612.txt', 'Retranscription : « rendez-vous au garage, apporte la voiture »')
// pièce « originale » binaire dont seul le jumeau MD/ porte le texte
verse('PV/Proc1/D99_scan.pdf', '%PDF-faux-binaire')
verse('MD/PV/Proc1/D99_scan.md', 'Procès-verbal de perquisition au domicile de DURAND : découverte de 1 200 euros et de la résine.')

const echecs = []
function attendu(nom, cond, detail) {
  console.log(`${cond ? '✅' : '❌'} ${nom}${detail ? ' — ' + detail : ''}`)
  if (!cond) echecs.push(nom)
}

// ── normAligne : 1:1, casse et accents
attendu('normAligne aligne (longueur conservée)', normAligne('Péronne Été').length === 'Péronne Été'.length)
attendu('normAligne abaisse casse et accents', normAligne('KÉvin').startsWith('kevin'))

// ── ensureDocShas : le stock (versé sans empreinte) est complété
const bilan = ensureDocShas(keys, KEY)
attendu('empreintes calculées pour le stock', bilan.calculees >= 6 && bilan.restantes === 0, JSON.stringify(bilan))
const metas = listDocsMeta(attacheTj(), KEY)
const shaDe = (rel) => metas.find((d) => d.rel === rel)?.sha
attendu('copie exacte : même empreinte', shaDe('PV/Proc1/D12_audition_DURAND.txt') === shaDe('PV/Proc2/D340_audition_DURAND.txt'))
attendu('version voisine : empreinte différente', shaDe('PV/Proc1/D12_audition_DURAND.txt') !== shaDe('PV/Proc1/D13_audition_DURAND_suite.txt'))
attendu('MD/ ignorées par les empreintes', !shaDe('MD/PV/Proc1/D99_scan.md'))

// ── groupesDoublons : STRICT — un seul groupe, les deux copies exactes
const groupes = groupesDoublons(metas)
attendu('un seul groupe de doublons', groupes.length === 1, JSON.stringify(groupes))
attendu('le groupe contient les deux copies', groupes[0]?.pieces.join('|') === 'PV/Proc1/D12_audition_DURAND.txt|PV/Proc2/D340_audition_DURAND.txt')

// ── arborescence : copie annotée, porteur intact
const arbo = arborescenceDocuments(keys, NUM)
attendu('arborescence compte les doublons exacts', arbo.doublonsExacts === 1, JSON.stringify({ doublonsExacts: arbo.doublonsExacts }))
const copie = arbo.pieces.find((p) => p.chemin === 'PV/Proc2/D340_audition_DURAND.txt')
const porteur = arbo.pieces.find((p) => p.chemin === 'PV/Proc1/D12_audition_DURAND.txt')
attendu('copie annotée copieExacteDe', copie?.copieExacteDe === 'PV/Proc1/D12_audition_DURAND.txt', JSON.stringify(copie))
attendu('porteur non annoté', porteur && !porteur.copieExacteDe)
attendu('version voisine non annotée', !arbo.pieces.find((p) => p.chemin === 'PV/Proc1/D13_audition_DURAND_suite.txt')?.copieExacteDe)

// ── pieces_chercher : localisation
const r1 = await chercherDansPieces(keys, NUM, { requete: 'Clio grise' })
attendu('trouve la Clio', r1.pieces.some((p) => p.chemin === 'PV/Proc1/D12_audition_DURAND.txt'), JSON.stringify(r1.pieces?.map((p) => p.chemin)))
attendu('extrait fidèle (accents/casse d\'origine)', r1.pieces[0]?.extraits[0]?.includes('Clio grise'), JSON.stringify(r1.pieces[0]?.extraits))
attendu('doublon exact sauté', r1.couverture.doublonsExactsSautes === 1, JSON.stringify(r1.couverture))
attendu('la copie n\'apparaît pas en double', !r1.pieces.some((p) => p.chemin === 'PV/Proc2/D340_audition_DURAND.txt'))

const r2 = await chercherDansPieces(keys, NUM, { requete: 'kevin durand' })
attendu('insensible casse et accents', r2.pieces.length >= 2, JSON.stringify(r2.pieces?.map((p) => p.chemin)))

const r3 = await chercherDansPieces(keys, NUM, { requete: 'resine perquisition' })
attendu('ET logique : mots dans la même pièce seulement', r3.pieces.length === 1 && r3.pieces[0].chemin === 'PV/Proc1/D99_scan.pdf', JSON.stringify(r3.pieces?.map((p) => p.chemin)))
attendu('jumeau MD/ servi pour l\'original', Boolean(r3.pieces[0]), 'la pièce .pdf est fouillée via sa copie MD/')

const r4 = await chercherDansPieces(keys, NUM, { requete: 'clio', pochette: 'Actes' })
attendu('filtre pochette respecté', r4.pieces.length === 0, JSON.stringify(r4.pieces))

// ── fiches de dépouillement fouillées en premier
const { saveProduction } = await import(`${REPO}/scripts/attache/productions.mjs`)
await saveProduction(keys, { numero: NUM, type: 'fiche', titre: 'Fiche — PV/Proc1 — lot 1', contenu: '## Personnes\n- DURAND Kévin : transports de résine, Clio grise FG-527-XZ (D12)', source: 'chantier:test' })
const r5 = await chercherDansPieces(keys, NUM, { requete: 'FG-527-XZ' })
attendu('les fiches sont fouillées', r5.fiches.length === 1 && r5.fiches[0].extraits[0].includes('FG-527-XZ'), JSON.stringify(r5.fiches))

// ── chantier : les copies exactes sortent des lots
const { createChantier } = await import(`${REPO}/scripts/attache/chantier.mjs`)
const ch = await createChantier(keys, { type: 'dossier', numero: NUM })
attendu('devis : copies exactes écartées des lots', ch.totalPieces === 5 && ch.piecesDeposees === 6, JSON.stringify({ totalPieces: ch.totalPieces, piecesDeposees: ch.piecesDeposees }))
attendu('devis : doublons nommés', ch.doublonsExclus === 1 && ch.estimation.doublonsExclus === 1, JSON.stringify(ch.estimation))
// le résumé n'expose pas les lots : on relit le plan brut
const { readChantier } = await import(`${REPO}/scripts/attache/chantier.mjs`)
const brut = readChantier(keys, ch.id)
const lotsRels = brut.plan.flatMap((p) => p.lots.flatMap((l) => l.pieces))
attendu('la copie exacte absente des lots', !lotsRels.includes('PV/Proc2/D340_audition_DURAND.txt'), JSON.stringify(lotsRels))
attendu('le porteur présent dans les lots', lotsRels.includes('PV/Proc1/D12_audition_DURAND.txt'))
attendu('la version voisine présente dans les lots', lotsRels.includes('PV/Proc1/D13_audition_DURAND_suite.txt'))

// ── ingestion de fond : extraction + empreinte d'office, échecs mémorisés
const { ingestPass } = await import(`${REPO}/scripts/attache/ingest.mjs`)
verse('PV/Proc1/D200_scan_illisible.pdf', '%PDF-faux-scan-sans-couche-texte')
const i1 = await ingestPass(keys)
attendu('ingestion visite le dossier modifié', i1.dossiers === 1, JSON.stringify(i1))
attendu('ingestion pose l\'empreinte de la pièce nouvelle',
  /^[a-f0-9]{64}$/.test(String(listDocsMeta(attacheTj(), KEY).find((d) => d.rel === 'PV/Proc1/D200_scan_illisible.pdf')?.sha || '')))
attendu('échec d\'extraction mémorisé (pas de moulinette)', i1.echecs === 1 && i1.enAttente === 0, JSON.stringify(i1))
const i2 = await ingestPass(keys)
attendu('dossier à jour : passage no-op', i2.dossiers === 0 && i2.echecs === 0 && i2.extraites === 0, JSON.stringify(i2))
verse('Ecoutes/retranscription_0613.txt', 'Retranscription : « il arrive avec la Clio »')
const i3 = await ingestPass(keys)
attendu('nouveau dépôt : ré-ingestion, sans re-tenter l\'échec connu', i3.dossiers === 1 && i3.echecs === 0, JSON.stringify(i3))

// ── registre : entités déterministes extraites à l'ingestion
const { extraireEntites, lireRegistre, recouperRegistres, readRegistre, writeRegistre } =
  await import(`${REPO}/scripts/attache/registre.mjs`)

const ent = extraireEntites('Appel du +33 6 12 34 56 78 depuis le 12 Rue de la Paix ; véhicule FG-527-XZ ; compte FR76 3000 6000 0112 3456 7890 189.')
attendu('téléphone normalisé (+33 → 0)', ent.tel.includes('0612345678'), JSON.stringify(ent.tel))
attendu('plaque normalisée', ent.plaque.includes('FG527XZ'), JSON.stringify(ent.plaque))
attendu('adresse extraite', ent.adresse.some((a) => a.includes('rue de la paix')), JSON.stringify(ent.adresse))
attendu('IBAN extrait', ent.iban.length === 1, JSON.stringify(ent.iban))

const r6 = lireRegistre(keys, NUM)
const entreeOrd = r6.pieces.find((p) => p.chemin === 'Actes/ordonnance_ecoutes.md')
const entreeAud = r6.pieces.find((p) => p.chemin === 'PV/Proc1/D12_audition_DURAND.txt')
attendu('registre : le téléphone de l\'ordonnance est là', entreeOrd?.entites?.tel?.includes('0612345678'), JSON.stringify(entreeOrd?.entites))
attendu('registre : la plaque de l\'audition est là', entreeAud?.entites?.plaque?.includes('FG527XZ'), JSON.stringify(entreeAud?.entites))
const r7 = lireRegistre(keys, NUM, { filtre: 'FG-527-XZ' })
attendu('registre : filtre insensible au formatage', r7.pieces.length >= 1 && r7.pieces.some((p) => p.chemin === entreeAud.chemin), JSON.stringify(r7.pieces?.map((p) => p.chemin)))

// ── recoupement inter-dossiers : le lien caché dans la masse
verse2('PV/D4_surveillance.txt', 'Surveillance : l\'individu joint le 06 12 34 56 78 et repart à bord du véhicule FG-527-XZ.')
const i4 = await ingestPass(keys)
attendu('ingestion du second dossier', i4.dossiers === 1 && i4.entites === 1, JSON.stringify(i4))

const rec1 = recouperRegistres(keys)
const telRec = rec1.recoupements.find((r) => r.entite === 'tel:0612345678')
const plaqueRec = rec1.recoupements.find((r) => r.entite === 'plaque:FG527XZ')
attendu('téléphone partagé entre les deux dossiers', telRec?.dossiers.length === 2, JSON.stringify(telRec))
attendu('plaque partagée entre les deux dossiers', plaqueRec?.dossiers.length === 2, JSON.stringify(plaqueRec))
attendu('chaque côté cite ses pièces', telRec?.dossiers.every((d) => d.pieces.length >= 1), JSON.stringify(telRec?.dossiers))
attendu('numéros lisibles des dossiers', telRec?.dossiers.some((d) => d.dossier === NUM) && telRec?.dossiers.some((d) => d.dossier === NUM2), JSON.stringify(telRec?.dossiers.map((d) => d.dossier)))

// personnes des mini-fiches : clé canonique insensible à l'ordre des mots
const KEY2 = docServerKey(NUM2)
const regA = readRegistre(keys, KEY)
regA.pieces['PV/Proc1/D12_audition_DURAND.txt'].fiche = { type: 'PV audition', personnes: [{ nom: 'DURAND Kévin' }], resume: 'Reconnaît les transports.', majLe: new Date().toISOString() }
writeRegistre(keys, KEY, regA)
const regB = readRegistre(keys, KEY2)
regB.pieces['PV/D4_surveillance.txt'].fiche = { type: 'PV constatations', personnes: [{ nom: 'Kévin DURAND' }], resume: 'Surveillance.', majLe: new Date().toISOString() }
writeRegistre(keys, KEY2, regB)
const rec2 = recouperRegistres(keys)
const persRec = rec2.recoupements.find((r) => r.entite === 'personne:durand kevin')
attendu('personne recoupée malgré l\'ordre des mots', persRec?.dossiers.length === 2, JSON.stringify(rec2.recoupements.filter((r) => r.entite.startsWith('personne:'))))

const rec3 = recouperRegistres(keys, { entite: '06 12 34 56 78' })
attendu('recherche d\'une valeur formatée', rec3.recoupements.some((r) => r.entite === 'tel:0612345678'), JSON.stringify(rec3.recoupements.map((r) => r.entite)))
const rec4 = recouperRegistres(keys, { numero: NUM2 })
attendu('filtre par dossier', rec4.recoupements.every((r) => r.dossiers.some((d) => d.dossier === NUM2)), JSON.stringify(rec4.recoupements.map((r) => r.entite)))

// ── déplacement d'une pièce (moveDoc préserve savedAt) : la signature
// d'ingestion doit bouger quand même (empreinte des chemins) et le registre
// doit suivre le nouveau chemin
const dossierDir2 = path.join(DATA_DIR, 'docs', KEY2)
fs.renameSync(path.join(dossierDir2, 'PV/D4_surveillance.txt.enc'), path.join(dossierDir2, 'PV/D4bis_surveillance.txt.enc'))
const idx2Path = path.join(dossierDir2, '.index.json')
const idx2 = JSON.parse(fs.readFileSync(idx2Path, 'utf8'))
  .map((d) => (d.rel === 'PV/D4_surveillance.txt' ? { ...d, rel: 'PV/D4bis_surveillance.txt' } : d))
fs.writeFileSync(idx2Path, JSON.stringify(idx2))
const i5 = await ingestPass(keys)
attendu('déplacement détecté malgré savedAt inchangé', i5.dossiers === 1 && i5.entites === 1, JSON.stringify(i5))
const regApres = readRegistre(keys, KEY2)
attendu('le registre suit le nouveau chemin',
  Boolean(regApres.pieces['PV/D4bis_surveillance.txt']?.entites?.tel?.includes('0612345678')),
  JSON.stringify(Object.keys(regApres.pieces)))

fs.rmSync(SCRATCH, { recursive: true, force: true })
if (echecs.length) {
  console.error(`\n${echecs.length} échec(s) : ${echecs.join(' · ')}`)
  process.exit(1)
}
console.log('\nTous les contrôles passent.')
