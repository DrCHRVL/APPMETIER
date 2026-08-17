/**
 * SIRAL — test de la résolution de l'état d'archivage (utils/archiveState.ts).
 *
 * Couvre le scénario qui a motivé le correctif : un collègue archive une
 * enquête avec ses résultats d'audience, le poste du magistrat porte une
 * édition plus récente, et l'ancienne fusion (arbitrée sur `dateMiseAJour`)
 * rebasculait l'enquête en « en cours » tout en effaçant `dateArchivage` —
 * l'enquête restait sur la grille, avec son marteau vert, mais n'apparaissait
 * jamais dans les enquêtes terminées.
 *
 *   node scripts/archive-state.test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// `utils/archiveState.ts` est une logique pure : ses seuls imports sont des
// types, élidés à la transpilation. On peut donc l'évaluer tel quel.
const source = fs.readFileSync(path.join(REPO, 'utils/archiveState.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
})
if (/^\s*import\s/m.test(outputText)) {
  throw new Error('archiveState.ts doit rester pur (aucun import de valeur) pour ce test')
}
const mod = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const { resolveArchiveState, repairArchiveState, isArchivingResult, getArchiveEvidence } = mod

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`❌ ${label}\n   attendu : ${JSON.stringify(expected)}\n   obtenu  : ${JSON.stringify(actual)}`)
  } else {
    console.log(`✅ ${label}`)
  }
}

const T = {
  archivage: '2026-08-10T09:00:00.000Z',
  editionLocale: '2026-08-14T11:00:00.000Z',
  desarchivage: '2026-08-16T08:00:00.000Z',
}

const modif = (type, timestamp) => ({
  id: `${type}_${timestamp}`,
  type,
  label: type,
  user: { username: 'collegue', displayName: 'Collègue' },
  timestamp,
})

const enquete = (over = {}) => ({
  id: 19,
  numero: '19/2026 - ETELFAY',
  statut: 'en_cours',
  dateCreation: '2026-06-05T08:00:00.000Z',
  dateMiseAJour: '2026-06-05T08:00:00.000Z',
  ...over,
})

// ── 1. Fusion : l'archivage du collègue survit à une édition locale postérieure
{
  const local = enquete({ dateMiseAJour: T.editionLocale }) // jamais vu l'archivage
  const server = enquete({
    statut: 'archive',
    dateArchivage: T.archivage,
    dateMiseAJour: T.archivage,
    modifications: [modif('enquete_archived', T.archivage)],
  })
  const merged = [...(server.modifications || [])]
  check(
    'fusion : archivage collègue conservé malgré une édition locale plus récente',
    resolveArchiveState(local, server, merged)?.statut,
    'archive',
  )
}

// ── 2. Fusion : un désarchivage explicite l'emporte sur l'archivage antérieur
{
  const local = enquete({
    statut: 'en_cours',
    dateArchivage: T.archivage,
    dateDesarchivage: T.desarchivage,
    modifications: [modif('enquete_archived', T.archivage), modif('enquete_unarchived', T.desarchivage)],
  })
  const server = enquete({
    statut: 'archive',
    dateArchivage: T.archivage,
    dateMiseAJour: T.archivage,
    modifications: [modif('enquete_archived', T.archivage)],
  })
  const merged = [modif('enquete_archived', T.archivage), modif('enquete_unarchived', T.desarchivage)]
  check(
    'fusion : désarchivage explicite respecté',
    resolveArchiveState(local, server, merged)?.statut,
    'en_cours',
  )
}

// ── 3. Fusion : aucune trace d'archivage → pas de décision imposée
{
  check(
    'fusion : sans marqueur ni évènement, aucune résolution',
    resolveArchiveState(enquete(), enquete(), []),
    null,
  )
}

// ── 4. Réparation : marqueurs effacés, l'évènement du journal fait foi
{
  const cassee = enquete({
    statut: 'en_cours',
    dateMiseAJour: T.editionLocale,
    modifications: [modif('enquete_archived', T.archivage)],
  })
  const { enquetes, repaired } = repairArchiveState([cassee], () => undefined)
  check('réparation : statut rétabli depuis le journal', enquetes[0].statut, 'archive')
  check('réparation : dateArchivage restaurée', enquetes[0].dateArchivage, T.archivage)
  check('réparation : enquête signalée comme réparée', repaired.length, 1)
}

// ── 5. Réparation : aucune trace, mais un résultat d'audience définitif existe
{
  const cassee = enquete({ statut: 'en_cours' })
  const resultat = {
    enqueteId: 19,
    contentieuxId: 'crimorg',
    dateAudience: '2026-08-10',
    modifiedAt: T.archivage,
    condamnations: [{ nom: 'MONGA MUEMA Thony' }],
    confiscations: {},
  }
  const { enquetes } = repairArchiveState([cassee], () => resultat)
  check('réparation : résultat d\'audience définitif ⇒ enquête terminée', enquetes[0].statut, 'archive')
  check('réparation : dateArchivage prise sur le résultat', enquetes[0].dateArchivage, T.archivage)
}

// ── 6. Réparation : audience à venir (pending) ⇒ également archivée
{
  const cassee = enquete({ statut: 'en_cours' })
  const pending = {
    enqueteId: 19,
    contentieuxId: 'crimorg',
    dateAudience: '2026-09-25',
    modifiedAt: T.archivage,
    isAudiencePending: true,
    condamnations: [],
    confiscations: {},
  }
  const { enquetes } = repairArchiveState([cassee], () => pending)
  check('réparation : audience en attente ⇒ enquête terminée', enquetes[0].statut, 'archive')
}

// ── 7. Réparation : un brouillon de saisies pré-archivage n'archive rien
{
  const enCours = enquete({ statut: 'en_cours' })
  const brouillon = {
    enqueteId: 19,
    contentieuxId: 'crimorg',
    dateAudience: '',
    isPreArchiveSaisies: true,
    condamnations: [],
    confiscations: {},
  }
  check('brouillon de saisies : pas un résultat d\'archivage', isArchivingResult(brouillon), false)
  const { repaired } = repairArchiveState([enCours], () => brouillon)
  check('réparation : brouillon de saisies laissé en cours', repaired.length, 0)
}

// ── 8. Réparation : un désarchivage volontaire n'est jamais annulé
{
  const desarchivee = enquete({
    statut: 'en_cours',
    dateArchivage: T.archivage,
    dateDesarchivage: T.desarchivage,
    modifications: [modif('enquete_archived', T.archivage), modif('enquete_unarchived', T.desarchivage)],
  })
  const resultat = {
    enqueteId: 19,
    contentieuxId: 'crimorg',
    dateAudience: '2026-08-10',
    modifiedAt: T.archivage,
    condamnations: [],
    confiscations: {},
  }
  const { repaired } = repairArchiveState([desarchivee], () => resultat)
  check('réparation : enquête volontairement désarchivée laissée en cours', repaired.length, 0)
}

// ── 9. Réparation : un dossier passé à l'instruction n'est jamais touché
{
  const instruction = enquete({
    statut: 'instruction',
    modifications: [modif('enquete_archived', T.archivage)],
  })
  const { repaired } = repairArchiveState([instruction], () => undefined)
  check('réparation : statut instruction préservé', repaired.length, 0)
}

// ── 10. Preuves : marqueur et journal se complètent (journal élagué / marqueur effacé)
{
  check(
    'preuves : marqueur seul',
    getArchiveEvidence({ dateArchivage: T.archivage }).archivedAt > 0,
    true,
  )
  check(
    'preuves : journal seul',
    getArchiveEvidence({ modifications: [modif('enquete_archived', T.archivage)] }).archivedAt > 0,
    true,
  )
}

if (failures > 0) {
  console.error(`\n${failures} test(s) en échec`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
