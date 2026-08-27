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
//
// Le moteur est un module PARTAGÉ (lib/recoupements/*.mjs), exécuté tel quel
// par le service attaché : ce test lit EXACTEMENT le code qui tourne en
// production, sans transpilation ni copie.
import { detecterRecoupements } from '../lib/recoupements/moteurCore.mjs'
import { extractValues } from '../lib/recoupements/valeursCore.mjs'
import { buildCorpus } from '../lib/recoupements/corpusCore.mjs'

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

// ──────────────────────────────────────────────
// PSEUDOS DE RÉSEAUX SOCIAUX
//
// Un pseudo se présente : entre guillemets, annoncé par le mot qui le nomme,
// ou par sa forme même (un chiffre, un séparateur). Ce qui suit un nom de
// réseau au fil de la phrase n'est que du texte — la veille remontait des
// « comme », « avait », « Ainsi », et jusqu'à des morceaux de mots (« ement »,
// pris au milieu de « signalement »).
// ──────────────────────────────────────────────

const comptes = (texte) => extractValues(texte).filter(v => v.kind === 'compte').map(v => v.valeur)

console.log('\nPseudos — ce que la veille ne doit PAS inventer :')

const riens = [
  'Le signal du téléphone a été perdu. Ainsi, les investigations se poursuivent.',
  'Aucun signal n’a été capté, il avait quitté les lieux.',
  'Le signal GSM se comporte comme celui d’une borne relais.',
  'L’exploitation Snapchat confirme un signalement anonyme également reçu.',
  'Les applications Snapchat et Instagram étaient installées sur l’appareil.',
  'Un snap envoyé le matin, puis plus rien.',
  'Le compte Snapchat : aucune donnée exploitable n’a été transmise.',
  'Réquisition Snapchat adressée le 12 mars, réponse en attente.',
]
for (const phrase of riens) {
  const trouves = comptes(phrase)
  ok(trouves.length === 0, `rien dans « ${phrase.slice(0, 54)}… »`, JSON.stringify(trouves))
}

console.log('\nPseudos — ce que la veille doit voir :')

const vrais = [
  ['Il utilise Snapchat sous le pseudo « jul.62 » depuis 2023.', 'jul.62'],
  ['Compte Instagram : katsu80 exploité par l’intéressé.', 'katsu80'],
  ['SNAPCHAT : kayzer_80', 'kayzer_80'],
  ['connu sous le pseudonyme Snapchat Kaiser par ses proches', 'Kaiser'],
  ['son compte Telegram durand.michel a servi aux commandes', 'durand.michel'],
  ['contacté sur @jul_62 hier soir', '@jul_62'],
]
for (const [phrase, attendu] of vrais) {
  const trouves = comptes(phrase)
  ok(trouves.includes(attendu), `« ${attendu} » relevé`, JSON.stringify(trouves))
}

console.log('')

// ──────────────────────────────────────────────
// LE CORPUS DU CHANTIER — plusieurs contentieux, pièces comprises
// ──────────────────────────────────────────────
//
// C'est l'intérêt même du dispositif : le pont qui compte est celui qui
// TRAVERSE les contentieux — le même homme mis en cause au stup et cité dans
// une procédure financière. Tant que le calcul vivait dans le navigateur, ce
// corpus-là n'était jamais complet ; il l'est côté serveur.

console.log('Corpus du chantier (plusieurs contentieux, pièces comprises) :')

const enquetesParContentieux = new Map([
  ['crimorg', [{
    id: 9026, numero: '2026/9026', statut: 'en_cours',
    misEnCause: [{ nom: 'DOMONT Sherazed', role: 'stup' }],
    comptesRendus: [{
      id: 1, date: '2026-03-12', enqueteur: 'OPJ MARTIN',
      description: '<p>Ligne <b>06.79.55.13.84</b> active au 16 rue Balzac.</p>',
    }],
    documents: [{ cheminRelatif: 'PV/pv1.pdf', nom: 'pv1.pdf' }],
  }]],
  ['ecofi', [{
    id: 12, numero: '2026/0012', statut: 'en_cours',
    misEnCause: [{ nom: 'BERTIN Paul', role: 'gérant' }],
    documents: [{ cheminRelatif: 'PV/audition.pdf', nom: 'audition.pdf' }],
  }]],
])

const textesDesPieces = new Map([
  ['2026/9026::PV/pv1.pdf', 'Surveillance du 16 rue Balzac. Contact au +33 6 79 55 13 84.'],
  ['2026/0012::PV/audition.pdf', 'Le gérant déclare connaître DOMONT Sherazed, jointe au 06 79 55 13 84.'],
])

const corpusChantier = await buildCorpus(enquetesParContentieux, [], { documentTexts: textesDesPieces })
ok(corpusChantier.length === 2, 'les deux contentieux entrent dans le même corpus',
  JSON.stringify(corpusChantier.map((d) => d.key)))

const avancement = []
const transversaux = await detecterRecoupements(corpusChantier, {
  avancement: (lus, total) => avancement.push(`${lus}/${total}`),
})
const kindsTransversaux = transversaux.map((s) => s.kind)
ok(kindsTransversaux.includes('telephone'),
  'la ligne écrite « 06.79.55.13.84 » d\'un côté et « +33 6 79… » de l\'autre est rapprochée')
ok(kindsTransversaux.includes('personne'),
  'la personne DÉCLARÉE au stup et CITÉE dans une pièce ECOFI est rapprochée')
ok(transversaux.every((s) => s.pontInedit),
  'aucun mis en cause commun : ces ponts sont bien annoncés inédits')
ok(avancement.length > 0 && avancement[avancement.length - 1] === '2/2',
  'l\'avancement va jusqu\'au bout (le moniteur ne reste plus à zéro)', avancement.join(' '))

// Un dossier inchangé ne doit pas être rebâti : la mémoire de corpus sert d'un
// chantier à l'autre, et rendre un objet DIFFÉRENT à contenu identique
// suffirait à refaire tout le dé-balisage des comptes rendus.
const memoire = new Map()
const premier = await buildCorpus(enquetesParContentieux, [], { documentTexts: textesDesPieces }, { memo: memoire })
const second = await buildCorpus(enquetesParContentieux, [], { documentTexts: textesDesPieces }, { memo: memoire })
ok(premier[0] === second[0] && premier[1] === second[1],
  'à fonds inchangé, le corpus mémoïsé est rendu tel quel')

console.log('')

if (echecs > 0) {
  console.error(`${echecs} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Recoupements entre dossiers : toutes les vérifications passent.\n')
