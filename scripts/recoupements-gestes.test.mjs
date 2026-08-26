/**
 * SIRAL — test des GESTES de la veille de recoupements.
 *
 * Le défaut corrigé ici : des signaux ÉCARTÉS revenaient « à regarder », puis
 * l'onglet « Écartés » se vidait tout seul. Deux causes, toutes deux couvertes :
 *
 *   1. l'empreinte du geste était comparée à l'identique. Un dossier qui
 *      QUITTAIT la coïncidence (pièce pas encore relue au démarrage, dossier
 *      archivé, préliminaire versée dans son instruction) suffisait à faire
 *      « changer » la situation, alors qu'il ne s'était rien passé de neuf ;
 *   2. le « j'ai vu » passif — fermer la vue d'ensemble, déplier un bandeau —
 *      réécrivait le geste de tous les signaux affichés, y compris ceux qui
 *      venaient de remonter : l'écartement était remplacé par un « vu », donc
 *      perdu définitivement.
 *
 *   node scripts/recoupements-gestes.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-gestes-'))

const src = fs.readFileSync(path.join(REPO, 'utils/recoupements/gestes.ts'), 'utf8')
const { outputText } = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
})
fs.writeFileSync(
  path.join(TMP, 'gestes.mjs'),
  outputText.replace(/^\s*import\s[^;]*?from\s*['"]@\/types\/[^'"]+['"];?\s*$/gm, ''),
)

const {
  aGagneUnDossier, ackPour, estNouveau, estRevenuApresEcart,
  fusionnerAcks, patchVus, trierSelonGestes,
} = await import(path.join(TMP, 'gestes.mjs'))

let echecs = 0
function verifie(intitule, condition) {
  if (condition) {
    console.log(`  ✓ ${intitule}`)
  } else {
    echecs++
    console.log(`  ✗ ${intitule}`)
  }
}

/** Signal de veille réduit à ce dont les gestes ont besoin. */
function signal(id, dossiers) {
  const keys = [...dossiers].sort()
  return { id, dossierKeys: keys, stateKey: keys.join('|') }
}

const A = 'enq:crimorg#9026'
const B = 'enq:crimorg#9031'
const C = 'inst:412'

// ──────────────────────────────────────────────────────────────────────
console.log('\nÉcartement — ce qui doit rester muet')

const deuxDossiers = signal('telephone:0679551384', [A, B])
const ecarte = { [deuxDossiers.id]: ackPour(deuxDossiers, 'ecarte', '2026-08-01T09:00:00.000Z') }

verifie(
  'situation inchangée : le signal reste écarté',
  trierSelonGestes([deuxDossiers], ecarte).ecartes.length === 1,
)

const unDossierEnMoins = signal(deuxDossiers.id, [A])
verifie(
  'un dossier QUITTE la coïncidence : toujours écarté (c\'était le défaut)',
  trierSelonGestes([unDossierEnMoins], ecarte).ecartes.length === 1,
)

const memesDossiersAutreOrdre = { ...deuxDossiers, dossierKeys: [B, A] }
verifie(
  'mêmes dossiers dans un autre ordre : toujours écarté',
  trierSelonGestes([memesDossiersAutreOrdre], ecarte).ecartes.length === 1,
)

// ──────────────────────────────────────────────────────────────────────
console.log('\nÉcartement — ce qui doit ressortir')

const unDossierEnPlus = signal(deuxDossiers.id, [A, B, C])
const tri = trierSelonGestes([unDossierEnPlus], ecarte)
verifie('un dossier de PLUS : le signal ressort', tri.retenus.length === 1 && tri.ecartes.length === 0)
verifie('… et il est signalé comme neuf', tri.nouveaux.length === 1)
verifie('… et l\'écran peut dire pourquoi', estRevenuApresEcart(ecarte, unDossierEnPlus))
verifie('un signal jamais traité est neuf', estNouveau({}, deuxDossiers))

// ──────────────────────────────────────────────────────────────────────
console.log('\nLe « j\'ai vu » passif ne défait aucune décision')

const patch = patchVus([unDossierEnPlus], ecarte, '2026-08-26T10:00:00.000Z')
verifie(
  'un signal écarté revenu à l\'affichage n\'est PAS réenregistré « vu »',
  patch[unDossierEnPlus.id] === undefined,
)

const jamaisVu = signal('personne:domont sherazed', [A, B])
verifie(
  'un signal neuf, lui, est bien marqué vu',
  patchVus([jamaisVu], {}, '2026-08-26T10:00:00.000Z')[jamaisVu.id]?.action === 'vu',
)

const dejaVu = { [jamaisVu.id]: ackPour(jamaisVu, 'vu', '2026-08-01T09:00:00.000Z') }
verifie(
  'un signal déjà vu et inchangé n\'est pas réécrit (aucune écriture inutile)',
  Object.keys(patchVus([jamaisVu], dejaVu, '2026-08-26T10:00:00.000Z')).length === 0,
)

const vuPuisAgrandi = signal(jamaisVu.id, [A, B, C])
verifie(
  'un signal vu qu\'un dossier de plus rejoint redevient neuf',
  estNouveau(dejaVu, vuPuisAgrandi)
    && patchVus([vuPuisAgrandi], dejaVu, '2026-08-26T10:00:00.000Z')[jamaisVu.id]?.action === 'vu',
)

// ──────────────────────────────────────────────────────────────────────
console.log('\nGestes enregistrés avant que l\'ack ne porte les dossiers')

const ancien = { [deuxDossiers.id]: { stateKey: `${A}|${B}`, action: 'ecarte', at: '2026-07-01T09:00:00.000Z' } }
verifie(
  'l\'empreinte seule suffit à relire les dossiers du geste',
  trierSelonGestes([deuxDossiers], ancien).ecartes.length === 1
    && aGagneUnDossier(ancien[deuxDossiers.id], unDossierEnPlus),
)

// ──────────────────────────────────────────────────────────────────────
console.log('\nFusion des gestes (préférences arrivées après coup, synchro)')

const ici = { s1: { stateKey: A, action: 'ecarte', at: '2026-08-26T10:00:00.000Z' } }
const enregistres = {
  s1: { stateKey: A, action: 'vu', at: '2026-08-01T09:00:00.000Z' },
  s2: { stateKey: B, action: 'ecarte', at: '2026-08-02T09:00:00.000Z' },
}
const fusion = fusionnerAcks(ici, enregistres)
verifie('le geste le plus récent l\'emporte', fusion.s1.action === 'ecarte')
verifie('les gestes des sessions précédentes ne sont pas perdus', fusion.s2.action === 'ecarte')

console.log(echecs === 0 ? '\nTout est vert.\n' : `\n${echecs} vérification(s) en échec.\n`)
process.exit(echecs === 0 ? 0 : 1)
