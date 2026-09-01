/**
 * SIRAL — test du RENOMMAGE D'UNE PERSONNE depuis la cartographie.
 *
 * Le nom affiché sur la carte est lu dans les dossiers : le corriger réécrit
 * donc de vraies données de procédure. Ce test verrouille les deux règles qui
 * décident de cette réécriture.
 *
 * 1. QUI est réécrit (utils/renameMecTransforms.ts) : la correspondance est la
 *    clé insensible à l'ordre des mots — celle qui fusionne déjà les nœuds du
 *    graphe. Un homonyme partiel ou une coquille NE DOIT PAS être réécrit :
 *    le rapprochement tolérant sert à suggérer, jamais à écrire.
 *
 * 2. Ce que DEVIENNENT les données manuelles de la carte
 *    (stores/useCartographieOverlayStore.renameMecReferences) : l'identifiant
 *    d'un MEC dérivant de son nom, un renommage déplace son id. Camps, bonus,
 *    épingles, liens, dossiers ex nihilo et annotations doivent suivre, avec
 *    les tombstones qui empêchent la sync de ressusciter l'ancien id.
 *
 *   node scripts/carto-renommage.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-renommage-'))

// Doublures : le store n'a besoin ni de React ni du pont de données pour la
// logique testée ici (on l'attaque par getState(), jamais par le hook).
fs.writeFileSync(path.join(TMP, 'zustand.mjs'), `
export function create(init) {
  let state
  const set = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  state = init(set, () => state)
  const hook = () => { throw new Error('hook React indisponible dans ce test') }
  hook.getState = () => state
  hook.setState = set
  return hook
}
`)
fs.writeFileSync(path.join(TMP, 'siralBridge.mjs'), `
export const SiralBridge = {
  getData: async (_k, fallback) => fallback,
  setData: async () => true,
}
`)

function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    .replace(/from\s*['"]@\/(lib\/[^'"]+\.mjs)['"]/g, (_, m) => `from '${path.join(REPO, m)}'`)
    .replace(/from\s*['"]@\/types\/cartographieTypes['"]/g, "from './cartographieTypes.mjs'")
    .replace(/from\s*['"]@\/utils\/mindmapGraph['"]/g, "from './mindmapGraph.mjs'")
    .replace(/from\s*['"]@\/lib\/zustand['"]/g, "from './zustand.mjs'")
    .replace(/from\s*['"]@\/utils\/siralBridge['"]/g, "from './siralBridge.mjs'")
    .replace(/^\s*import\s[^;]*?from\s*['"]@\/types\/[^'"]+['"];?\s*$/gm, '')
  fs.writeFileSync(path.join(TMP, `${nom}.mjs`), js)
  return nom
}

compile('types/cartographieTypes.ts')
compile('utils/mindmapGraph.ts')
compile('utils/renameMecTransforms.ts')
compile('stores/useCartographieOverlayStore.ts')

const {
  makeMatcher,
  renameInEnquete,
  renameInDossierInstruction,
  renameInResultat,
} = await import(path.join(TMP, 'renameMecTransforms.mjs'))
const { useCartographieOverlayStore } = await import(
  path.join(TMP, 'useCartographieOverlayStore.mjs')
)

let echecs = 0
function verifier(intitule, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${intitule}`)
  } else {
    echecs++
    console.log(`  ✗ ${intitule}${detail ? ` — ${detail}` : ''}`)
  }
}

// ──────────────────────────────────────────────
// 1. Correspondance : qui est réécrit
// ──────────────────────────────────────────────
console.log('\nCorrespondance (qui est concerné)')
{
  const matche = makeMatcher('KRASNIQI Bledar')
  verifier('la graphie exacte matche', matche('KRASNIQI Bledar'))
  verifier('l\'ordre inverse matche', matche('Bledar Krasniqi'))
  verifier('les accents et la casse sont ignorés', matche('krasniqi blédar'))
  verifier('une coquille ne matche PAS', !matche('KRASNIKI Bledar'))
  verifier('un prénom seul ne matche PAS', !matche('Bledar'))
  verifier('un homonyme enrichi ne matche PAS', !matche('KRASNIQI Bledar Junior'))
  verifier('un nom vide ne matche rien', !makeMatcher('')('KRASNIQI Bledar'))
}

// ──────────────────────────────────────────────
// 2. Réécriture des enregistrements
// ──────────────────────────────────────────────
console.log('\nRéécriture des enregistrements')
{
  const matche = makeMatcher('KRASNIQI Bledar')
  const enquete = {
    id: 7,
    dateMiseAJour: '2020-01-01T00:00:00.000Z',
    misEnCause: [
      { id: 1, nom: 'Bledar KRASNIQI', statut: 'mis en cause' },
      { id: 2, nom: 'ZOUAOUI Sami', statut: 'mis en cause' },
    ],
  }
  const res = renameInEnquete(enquete, matche, 'KRASNIQI Bledar')
  verifier('l\'enquête concernée est réécrite', res?.hits === 1, `hits=${res?.hits}`)
  verifier('seule la bonne personne change', res?.enquete.misEnCause[0].nom === 'KRASNIQI Bledar'
    && res?.enquete.misEnCause[1].nom === 'ZOUAOUI Sami')
  verifier('la date de mise à jour est rafraîchie',
    res?.enquete.dateMiseAJour !== enquete.dateMiseAJour)
  verifier('l\'enquête d\'origine n\'est pas mutée', enquete.misEnCause[0].nom === 'Bledar KRASNIQI')
  verifier('une enquête sans occurrence est laissée telle quelle',
    renameInEnquete({ id: 8, misEnCause: [{ id: 1, nom: 'ZOUAOUI Sami' }] }, matche, 'X') === null)
  verifier('une enquête sans mis en cause est ignorée',
    renameInEnquete({ id: 9 }, matche, 'X') === null)

  const dossier = {
    id: 42,
    misEnExamen: [{ id: 1, nom: 'krasniqi bledar' }, { id: 2, nom: 'AUTRE Jean' }],
    suspects: [{ id: 3, nom: 'Bledar Krasniqi' }],
    victimes: [{ id: 4, nom: 'MARTIN Claire' }],
  }
  const resDossier = renameInDossierInstruction(dossier, matche, 'KRASNIQI Bledar')
  verifier('mis en examen ET suspects sont réécrits', resDossier?.hits === 2, `hits=${resDossier?.hits}`)
  verifier('les victimes non concernées ne sont pas touchées',
    resDossier?.updates.victimes === undefined)
  verifier('le mis en examen porte le nouveau nom',
    resDossier?.updates.misEnExamen[0].nom === 'KRASNIQI Bledar')

  const resultat = {
    enqueteId: 7,
    condamnations: [
      { nom: 'Bledar KRASNIQI', peinePrison: 24 },
      { nom: 'ZOUAOUI Sami', peinePrison: 12 },
    ],
  }
  const resAudience = renameInResultat(resultat, matche, 'KRASNIQI Bledar')
  verifier('le condamné est réécrit', resAudience?.hits === 1)
  verifier('la peine est conservée', resAudience?.resultat.condamnations[0].peinePrison === 24)
}

// ──────────────────────────────────────────────
// 3. Données manuelles de la carte
// ──────────────────────────────────────────────
console.log('\nRemappage des données manuelles de la carte')
{
  const store = useCartographieOverlayStore.getState()
  useCartographieOverlayStore.setState({
    pinnedMecIds: ['bledar krasniqi', 'zouaoui sami'],
    mecsExNihilo: [
      { id: 'bledar krasniqi', displayName: 'Bledar KRASNIQI', alias: ['Le Grand'], notes: 'Chef présumé', createdAt: 1, updatedAt: 1 },
    ],
    dossiersExNihilo: [
      { id: 'dexn_1', label: 'Réseau', mecIds: ['bledar krasniqi', 'zouaoui sami'], createdAt: 1, updatedAt: 1 },
    ],
    liensRenseignement: [
      { id: 'lien_1', source: 'bledar krasniqi', target: 'zouaoui sami', createdAt: 1, updatedAt: 1 },
      { id: 'lien_2', source: 'bledar krasniqi', target: 'krasniqi bledar', createdAt: 1, updatedAt: 1 },
    ],
    clusterAnnotations: [
      { id: 'cluster_1', label: 'Amiens nord', nodeIds: ['bledar krasniqi', 'dexn_1'], createdAt: 1, updatedAt: 1 },
    ],
    mecScoreBoosts: [{ mecId: 'bledar krasniqi', bonus: 5, updatedAt: 1 }],
    mecCamps: [{ mecId: 'bledar krasniqi', label: 'KRASNIQI', color: '#16a34a', updatedAt: 1 }],
    deletedMecCampIds: [],
    deletedMecScoreBoostIds: [],
    deletedMecExNihiloIds: [],
    deletedPinnedMecIds: [],
    deletedLienIds: [],
  })

  const touched = store.renameMecReferences('Bledar KRASNIQI', 'KRASNIQI Bledar Junior')
  const s = useCartographieOverlayStore.getState()
  const NEW = 'krasniqi bledar junior'

  verifier('des références ont été remappées', touched >= 6, `touched=${touched}`)
  verifier('l\'épingle suit', s.pinnedMecIds.includes(NEW) && !s.pinnedMecIds.includes('bledar krasniqi'))
  verifier('l\'épingle des autres est intacte', s.pinnedMecIds.includes('zouaoui sami'))
  verifier('la fiche déménage avec ses notes',
    s.mecsExNihilo.length === 1
    && s.mecsExNihilo[0].id === NEW
    && s.mecsExNihilo[0].displayName === 'KRASNIQI Bledar Junior'
    && s.mecsExNihilo[0].notes === 'Chef présumé')
  verifier('l\'ancien id de fiche porte un tombstone',
    s.deletedMecExNihiloIds.some(t => t.id === 'bledar krasniqi'))
  verifier('le dossier manuel suit',
    s.dossiersExNihilo[0].mecIds.includes(NEW)
    && s.dossiersExNihilo[0].mecIds.includes('zouaoui sami')
    && !s.dossiersExNihilo[0].mecIds.includes('bledar krasniqi'))
  verifier('le lien vers un tiers suit',
    s.liensRenseignement.some(l => l.id === 'lien_1' && l.source === NEW))
  verifier('le lien devenu réflexif disparaît',
    !s.liensRenseignement.some(l => l.id === 'lien_2')
    && s.deletedLienIds.some(t => t.id === 'lien_2'))
  verifier('l\'annotation d\'aire suit',
    s.clusterAnnotations[0].nodeIds.includes(NEW)
    && s.clusterAnnotations[0].nodeIds.includes('dexn_1'))
  verifier('le bonus de score suit',
    s.mecScoreBoosts.length === 1 && s.mecScoreBoosts[0].mecId === NEW && s.mecScoreBoosts[0].bonus === 5)
  verifier('le camp suit, couleur comprise',
    s.mecCamps.length === 1 && s.mecCamps[0].mecId === NEW && s.mecCamps[0].color === '#16a34a')
  verifier('les anciens ids de camp et de bonus portent un tombstone',
    s.deletedMecCampIds.some(t => t.id === 'bledar krasniqi')
    && s.deletedMecScoreBoostIds.some(t => t.id === 'bledar krasniqi'))

  // Renommer une personne absente des données manuelles ne doit rien salir.
  const avant = JSON.stringify(useCartographieOverlayStore.getState().mecCamps)
  const rien = store.renameMecReferences('INCONNU Paul', 'AUTRE Paul')
  verifier('une personne absente ne change rien',
    rien === 0 && JSON.stringify(useCartographieOverlayStore.getState().mecCamps) === avant)
}

// ──────────────────────────────────────────────
// 4. Fusion : renommer vers une personne déjà fichée
// ──────────────────────────────────────────────
console.log('\nRenommage vers une personne déjà présente (fusion)')
{
  const store = useCartographieOverlayStore.getState()
  useCartographieOverlayStore.setState({
    pinnedMecIds: [],
    mecsExNihilo: [
      { id: 'krasniqi bledar', displayName: 'KRASNIQI Bledar', alias: ['Bledi'], notes: 'Fiche A', createdAt: 1, updatedAt: 1 },
      { id: 'zouaoui sami', displayName: 'ZOUAOUI Sami', alias: ['Sam'], notes: 'Fiche B', createdAt: 1, updatedAt: 2 },
    ],
    dossiersExNihilo: [],
    liensRenseignement: [],
    clusterAnnotations: [],
    mecScoreBoosts: [],
    mecCamps: [
      { mecId: 'krasniqi bledar', label: 'KRASNIQI', color: '#16a34a', updatedAt: 1 },
      { mecId: 'zouaoui sami', label: 'Egyptien', color: '#dc2626', updatedAt: 2 },
    ],
    deletedMecCampIds: [],
    deletedMecExNihiloIds: [],
    deletedPinnedMecIds: [],
    deletedMecScoreBoostIds: [],
    deletedLienIds: [],
  })
  store.renameMecReferences('KRASNIQI Bledar', 'ZOUAOUI Sami')
  const s = useCartographieOverlayStore.getState()
  const fiche = s.mecsExNihilo.find(m => m.id === 'zouaoui sami')
  verifier('une seule fiche subsiste', s.mecsExNihilo.length === 1, `${s.mecsExNihilo.length} fiche(s)`)
  verifier('les surnoms des deux fiches sont réunis',
    fiche?.alias.includes('Bledi') && fiche?.alias.includes('Sam'))
  verifier('aucune note n\'est perdue',
    fiche?.notes.includes('Fiche A') && fiche?.notes.includes('Fiche B'))
  verifier('un seul camp reste attaché à la personne',
    s.mecCamps.filter(c => c.mecId === 'zouaoui sami').length === 1)
}

console.log(echecs === 0 ? '\n✅ Renommage : tout est conforme\n' : `\n❌ ${echecs} vérification(s) en échec\n`)
process.exit(echecs === 0 ? 0 : 1)
