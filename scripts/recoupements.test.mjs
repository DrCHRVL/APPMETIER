/**
 * SIRAL — test de la VEILLE DE RECOUPEMENTS.
 *
 * Scénario réel : un PV d'investigations d'une brigade de gendarmerie arrive
 * dans un dossier (trafic à Doullens) ; un autre dossier du parquet (trafic à
 * Amiens) est ouvert depuis des mois. Personne ne les a rapprochés. Le PV
 * contient pourtant :
 *   - « DOMONT Sherazed », déjà mise en cause dans le dossier d'Amiens ;
 *   - « MEON Louan » et « MEON Christophe », alors qu'un « MEON Bryan » est
 *     mis en cause à Amiens (même patronyme, lien familial possible) ;
 *   - « 16 rue balzac », adresse du lieu de stockage identifié à Amiens ;
 *   - la ligne 06 79 55 13 84, écrite « +33 6 79 55 13 84 » d'un côté et
 *     « 06.79.55.13.84 » de l'autre.
 *
 * Le test vérifie que ces quatre recoupements sortent, et surtout que le
 * greffe du PV n'en produit AUCUN : ni l'OPJ signataire, ni le substitut cité,
 * ni la gendarmerie ne doivent déclencher un signal.
 *
 *   node scripts/recoupements.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-recoup-'))

// ── Transpilation à la volée : le moteur est du TypeScript pur (aucune
//    dépendance navigateur), on le compile en ESM dans un dossier temporaire.
function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    // Les imports de TYPES restants (@/types/…) n'ont pas d'équivalent runtime.
    .replace(/^\s*import\s[^;]*?from\s*['"]@\/types\/[^'"]+['"];?\s*$/gm, '')
    .replace(/from\s*['"]\.\/([^'"]+)['"]/g, (_, m) => `from './${m}.mjs'`)
    .replace(/from\s*['"]@\/utils\/([^'"]+)['"]/g, (_, m) => `from './${m.split('/').pop()}.mjs'`)
  fs.writeFileSync(path.join(TMP, `${nom}.mjs`), js)
  return nom
}

compile('utils/mindmapGraph.ts')
compile('utils/recoupements/extract.ts')
compile('utils/recoupements/engine.ts')

const { detecterRecoupements } = await import(path.join(TMP, 'engine.mjs'))

// ──────────────────────────────────────────────
// DOSSIER 1 — enquête d'Amiens (existant dans l'application)
// ──────────────────────────────────────────────

const amiens = {
  key: 'enq:crimorg#9026',
  numero: '2026/9026',
  label: 'Enquête 2026/9026',
  nature: 'enquete',
  contentieuxId: 'crimorg',
  enqueteId: 9026,
  personnes: ['MOKRANI Mickael', 'MEON Bryan', 'FOUQUET Jérémy', 'MEON Lorane', 'DOMONT Sherazed'],
  fragments: [
    {
      origine: 'description',
      texte: `Trafic d'héroïne et cocaïne organisé depuis Amiens. MOKRANI Mickael à la tête du réseau.
        Base rue Vulfran Mollet, appartement 4 / 5 rue Vulfran Mollet loué par MEON Lorane.
        Stockage identifié dans les caves du 16 rue Balzac (bornage exclusif de la ligne 13.84).
        Véhicule KIA Niro GM-970-AY utilisé régulièrement par MOKRANI.`,
    },
    {
      origine: 'ecoute',
      detail: 'Interception 06.79.55.13.84',
      texte: '06.79.55.13.84 — MEON Bryan — bornage exclusif rue Balzac',
    },
    {
      origine: 'cr',
      detail: 'CR du 20/08/2026',
      texte: `MOKRANI en vacances en Espagne depuis le 09/08. DOMONT Sherazed s'installe
        5 rue Vulfran Mollet et gère seule la ligne 19.75 avec les livreurs.`,
    },
  ],
}

// ──────────────────────────────────────────────
// DOSSIER 2 — le PV reçu de la gendarmerie, déposé dans un autre dossier
// ──────────────────────────────────────────────

const PV = `GENDARMERIE NATIONALE
Compagnie de gendarmerie départementale d'Amiens
ENQUÊTE DE FLAGRANCE — PROCÈS-VERBAL D'INVESTIGATIONS — COB DOULLENS
Le mardi 18 août 2026 à 16 heures 40 minutes.
Nous soussigné Adjudant Thomas CARDON, Officier de Police Judiciaire en résidence à DOULLENS 80600.

RENSEIGNEMENTS
Nous sommes destinataires de plusieurs renseignements qui indiquent un trafic de stupéfiants au
niveau de la résidence Lionel Menut à Doullens. La vente passerait par le compte snapchat
« pepitocroco2024 ». Le dénommé Pépito a été identifié comme étant Louan MEHON né le 04/09/2001
à AMIENS. Plusieurs jeunes gravitent autour de lui comme PREIRA Anicet, FALLER Angélo,
ROUSSEAU Jean Pierre.

ENVIRONNEMENTS ET VERIFICATIONS
L'identification de l'IP nous amène à un contrat SFR appartenant à MEON Christophe demeurant
16 rue balzac appt 7 à AMIENS. Il s'agit du père de MEON Louan né le 04/09/2001. L'intéressé donne
l'adresse de son père lors des différents contrôles au lieu de celle où il vit avec sa compagne
résidence lionel menut bâtiment L appt 01 à DOULLENS.

Mr VAN-DER-VLIST Samuel, Substitut de Mr le Procureur de la République d'Amiens était informé
des renseignements en notre possession.

INVESTIGATIONS
La ligne 0768509864 est identifiée comme appartenant à ROUSSEAU Sergine. Elle est utilisée par le
fils Jean Pierre. L'identification de l'annuaire de la ligne met en évidence un lien avec :
  7713  +33 7 68 50 98 64  ROUSSEAU Jean Pierre 10/11/1999 à DOULLENS
   320  +33 7 82 78 55 24  METTE SERGINE, mère de ROUSSEAU Jean Pierre
    55  +33 7 58 24 79 85  sherazed domont 03/12/2004, 4 Impasse de Rouval 80600 Doullens
    11  +33 6 59 64 12 21  MME BACHELOT MARIE-ELISABETH, grand-mère de MOKRANI Ismael
                           11/12/1997 à DOULLENS et de DOMONT Sherazed
     2  +33 6 79 55 13 84  contact non identifié
Le numéro de la sim est le 89331054230101138452 et l'IMEI est le 353234332659000.

DEMANDE INTERCEPTION TÉLÉPHONIQUE
Il serait opportun d'intercepter les communications sur la ligne 07 68 50 98 64 de ROUSSEAU Jean
Pierre. Dont procès-verbal fait et clos à DOULLENS 80600, le 18 août 2026 à 16 heures 50 minutes.`

const doullens = {
  key: 'enq:crimorg#9031',
  numero: '2026/9031',
  label: 'Enquête 2026/9031',
  nature: 'enquete',
  contentieuxId: 'crimorg',
  enqueteId: 9031,
  personnes: ['ROUSSEAU Jean Pierre', 'MEHON Louan'],
  fragments: [
    { origine: 'description', texte: 'Trafic de stupéfiants résidence Lionel Menut à Doullens — saisine COB Doullens.' },
    { origine: 'document', detail: 'PV_investigations_18-08-2026.pdf', texte: PV },
  ],
}

// ──────────────────────────────────────────────
// EXÉCUTION
// ──────────────────────────────────────────────

const signaux = await detecterRecoupements([amiens, doullens])

let echecs = 0
const ok = (condition, libelle, detail) => {
  if (condition) {
    console.log(`  ✓ ${libelle}`)
  } else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? `\n      ${detail}` : ''}`)
  }
}

const trouver = (kind, predicat) => signaux.find(s => s.kind === kind && predicat(s))
const resume = signaux
  .map(s => `${s.kind} « ${s.valeur} » (${s.score}) — ${s.dossierKeys.join(' ↔ ')}`)
  .join('\n    ')

console.log(`\n${signaux.length} signal(aux) :\n    ${resume}\n`)

console.log('Ce que la veille doit voir :')

const personne = trouver('personne', s => /domont/i.test(s.valeur))
ok(!!personne, 'DOMONT Sherazed : même personne dans les deux dossiers')
ok(
  !!personne && personne.occurrences.some(o => o.dossier.key === doullens.key && o.origine === 'document'),
  'DOMONT Sherazed : l’occurrence pointe la pièce où elle est citée',
  personne && JSON.stringify(personne.occurrences.map(o => `${o.dossier.numero}/${o.origine}`))
)

const patronyme = trouver('patronyme', s => /meon/i.test(s.canon))
ok(!!patronyme, 'MEON : même patronyme, prénoms différents (lien familial possible)')
ok(!!patronyme && patronyme.score < (personne?.score ?? 1), 'un patronyme pèse moins qu’une identité complète')

const adresse = trouver('adresse', s => /balzac/.test(s.canon))
ok(!!adresse, '16 rue Balzac : même adresse des deux côtés')
ok(!!adresse && adresse.canon === '16 rue balzac', 'l’adresse est ramenée à sa forme canonique', adresse?.canon)

const tel = trouver('telephone', s => s.canon === '0679551384')
ok(!!tel, '06 79 55 13 84 : même ligne, écrite « 06.79.55.13.84 » et « +33 6 79 55 13 84 »')

console.log('\nCe que la veille doit ignorer :')

const bruit = ['cardon', 'vlist', 'gendarmerie', 'procureur', 'doullens', 'amiens', 'substitut']
for (const mot of bruit) {
  const parasite = signaux.find(s =>
    (s.kind === 'personne' || s.kind === 'patronyme') && s.canon.includes(mot)
  )
  ok(!parasite, `aucun signal sur « ${mot} »`, parasite && JSON.stringify(parasite.valeur))
}

const sansAncrage = signaux.find(s =>
  (s.kind === 'personne' || s.kind === 'patronyme') && !s.occurrences.some(o => o.declaree)
)
ok(!sansAncrage, 'aucun signal de personne sans ancrage sur une personne déclarée', sansAncrage?.valeur)

console.log('\nStabilité du signal (silence jusqu’à changement réel) :')

const memeCorpus = await detecterRecoupements([amiens, doullens])
ok(
  memeCorpus.map(s => `${s.id}|${s.stateKey}`).join(',') === signaux.map(s => `${s.id}|${s.stateKey}`).join(','),
  'deux passes sur le même corpus donnent exactement les mêmes empreintes'
)

const troisieme = {
  ...doullens,
  key: 'enq:ecofi#12',
  numero: '2026/12',
  label: 'Enquête 2026/12',
  contentieuxId: 'ecofi',
  enqueteId: 12,
}
const avecTroisieme = await detecterRecoupements([amiens, doullens, troisieme])
const adresseApres = avecTroisieme.find(s => s.kind === 'adresse' && /balzac/.test(s.canon))
ok(
  !!adresseApres && adresseApres.id === adresse?.id && adresseApres.stateKey !== adresse?.stateKey,
  'un dossier de plus sur la même valeur : même signal, empreinte changée (il ressort)'
)

console.log('\nDiscrétion (la veille ne fige jamais l’interface) :')

const avecRespiration = await detecterRecoupements([amiens, doullens], {
  respirer: () => new Promise(r => setTimeout(r, 0)),
})
ok(
  !!avecRespiration && avecRespiration.length === signaux.length,
  'rendre la main au navigateur ne change rien au résultat'
)

// L'interruption ne peut aboutir que si le moteur repasse par ses points de
// respiration : ce test garantit qu'ils sont bien là.
const interrompu = await detecterRecoupements([amiens, doullens], {
  respirer: () => new Promise(r => setTimeout(r, 0)),
  annule: () => true,
})
ok(interrompu === null, 'le calcul s’interrompt sur demande, sans rendre de signal partiel')

console.log('')
fs.rmSync(TMP, { recursive: true, force: true })

if (echecs > 0) {
  console.error(`${echecs} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Veille de recoupements : toutes les vérifications passent.\n')
