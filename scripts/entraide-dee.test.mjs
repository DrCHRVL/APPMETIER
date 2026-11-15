/**
 * SIRAL — module Entraide : lecture d'une DEE (annexe A) déposée dans le
 * registre, et recherche des demandes déjà enregistrées (lib/entraide/dee.mjs).
 *
 * Textes fictifs, au format du texte qu'extrait pdfjs (une ligne par ligne
 * du PDF, pied de page en tête de page).
 *
 *   node scripts/entraide-dee.test.mjs
 */
import { lireDee, demandesCorrespondantes, personnesEnTexteDee, dateIso } from '../lib/entraide/dee.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`❌ ${label}\n   attendu : ${JSON.stringify(expected)}\n   obtenu  : ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

const EMISE = `DEE – Allemagne – Procédure 2026/123 – page  1
ANNEXE A
DÉCISION D'ENQUÊTE EUROPÉENNE
SECTION A
État d'émission :  France – Tribunal judiciaire d'Amiens, parquet du procureur de la République
État d'exécution :  République fédérale d'Allemagne – Staatsanwaltschaft Köln, service de l'entraide
pénale internationale, Am Justizzentrum 13, 50939 Köln – rechtshilfe@sta-koeln.example –
tél. +49 221 000
SECTION B : Urgence
Veuillez indiquer s'il s'agit d'un cas d'urgence justifié par
☑  la dissimulation ou la destruction de preuves
☐  l'imminence du procès
Veuillez préciser ci-après :
Données de connexion à conservation courte.
Les délais impartis pour exécuter la décision d'enquête européenne sont fixés dans la directive 2014/41/UE.
Toutefois, si un délai plus court ou un délai spécifique est nécessaire, veuillez fournir la date et la justifier
:
Exécution au plus tard le 1er décembre 2026.
SECTION C : Mesure(s) d'enquête à exécuter
Mesure n° 1 – Identification de l'utilisateur d'une adresse IP
Auprès de l'opérateur : identifier l'abonné.
Mesure n° 2 – Informations relatives aux comptes bancaires
☐  Audition
☐  d'un témoin   ☑  d'un suspect
☐  Perquisition
☑  Informations relatives aux comptes bancaires et autres comptes financiers
SECTION D : Lien avec une décision d'enquête européenne antérieure
Néant.
SECTION E : Identité de la personne concernée
i) S'il s'agit d'une/de personne(s) physique(s)
Nom :  MARTIN
Prénom(s) :  Paul
Pseudonyme(s), le cas échéant :  néant connu
Nationalité :  allemande

DEE – Allemagne – Procédure 2026/123 – page  2
Date de naissance :  01/02/1990
Lieu de naissance :  Bonn (Allemagne)
Résidence et/ou adresse connue :  Hauptstr. 1, 50667 Köln –
adresse déclarée à la banque
ii) S'il s'agit d'une (de) personne(s) morale(s)
Dénomination :  ................................................
Veuillez décrire la qualité de la personne concernée au stade actuel de la procédure :
☑  Suspect ou personne poursuivie
☐  Victime
SECTION G : Motifs de l'émission de la décision d'enquête européenne
2. Nature et qualification juridique de l'infraction ou des infractions pour lesquelles la décision
d'enquête européenne est émise et disposition juridique ou code applicable :
– BLANCHIMENT AGGRAVÉ, infraction prévue par l'article 324-2 du code pénal (NATINF 7208) ;
– ESCROQUERIE EN BANDE ORGANISÉE, infraction prévue par l'article 313-2 (NATINF 7876).
Faits commis le 3 mars 2026 à Amiens (France).
SECTION K : Coordonnées de l'autorité qui a émis la décision d'enquête européenne
Nom de l'autorité : Parquet du procureur de la République près le tribunal judiciaire d'Amiens
Dossier n° : procédure n° 2026/123
Signature de l'autorité d'émission et/ou de son représentant certifiant que le contenu de la décision
d'enquête européenne est exact et correct :
Nom : X
Date : 12 novembre 2026
SECTION L : Coordonnées de l'autorité judiciaire qui a validé la décision d'enquête`

const f = lireDee(EMISE)
check('DEE émise : sens et pays', [f.sens, f.pays], ['emise', 'Allemagne'])
check('DEE émise : autorité destinataire (section A)', f.autorite, { nom: 'Staatsanwaltschaft Köln', ville: 'Köln', email: 'rechtshilfe@sta-koeln.example', pays: 'Allemagne' })
check('DEE émise : n° de procédure, pas de V/réf', [f.procedure, f.refEtrangere], ['2026/123', ''])
check('DEE émise : date de signature', f.dateEmission, '2026-11-12')
check('urgence et date butoir (« 1er décembre »)', [f.urgence, f.dateButoir], ['Données de connexion à conservation courte.', '2026-12-01'])
check('mesures : cases cochées seulement, pas les ☐', f.mesures, ['requisitions_internet', 'requisitions_bancaires', 'audition_suspect'])
check('titres des mesures', f.mesuresTitres, ["Identification de l'utilisateur d'une adresse IP", 'Informations relatives aux comptes bancaires'])
check('personne : valeur sur deux pages, pied de page ignoré',
  personnesEnTexteDee(f.personnes), 'MARTIN Paul, né(e) le 01/02/1990 à Bonn (Allemagne), demeurant Hauptstr. 1, 50667 Köln (suspect)')
check('infractions et NATINF', [f.infractions, f.natinf], [['Blanchiment aggravé', 'Escroquerie en bande organisée'], ['7208', '7876']])
check('date et lieu des faits', [f.dateFaits, f.lieuFaits], ['3 mars 2026', 'Amiens (France)'])

// DEE reçue : l'autorité d'émission et sa référence viennent de la section K.
const RECUE = `ANNEXE A
DÉCISION D’ENQUÊTE EUROPÉENNE
SECTION A
État d’émission : Royaume de Belgique – Parquet de Tournai
État d’exécution : France
SECTION E : Identité de la personne concernée
Nom : DUPONT
Prénom(s) : Marie
Veuillez décrire la qualité de la personne concernée au stade actuel de la procédure :
☐ Suspect ou personne poursuivie
☐ Victime
☑ Témoin
SECTION K : Coordonnées de l’autorité qui a émis la décision d’enquête européenne
Nom de l’autorité : Parquet du Hainaut, division Tournai
Dossier n° : TO.12.AB.3456/26
Adresse : Place du Palais 1, 7500 Tournai
Adresse électronique : tournai@example.be`
const r = lireDee(RECUE)
check('DEE reçue : sens, pays (« Royaume de Belgique »)', [r.sens, r.pays], ['recue', 'Belgique'])
check('DEE reçue : autorité et V/réf de la section K', [r.autorite.nom, r.autorite.ville, r.refEtrangere], ['Parquet du Hainaut, division Tournai', 'Tournai', 'TO.12.AB.3456/26'])
check('DEE reçue : qualité témoin', personnesEnTexteDee(r.personnes), 'DUPONT Marie (témoin)')

check('pièce qui n’est pas une DEE → null', lireDee('Commission rogatoire internationale\nSECTION A'), null)
check('dateIso', [dateIso('15 décembre 2026'), dateIso('5/3/2026'), dateIso('rien')], ['2026-12-15', '2026-03-05', ''])

// Demandes déjà enregistrées
const demandes = [
  { id: 'proc', type: 'dee', sens: 'emise', pays: 'Allemagne', refEsabora: 'B3221-2026/00001', objet: 'Blanchiment – proc. 2026/123', personnes: '' },
  { id: 'nom', type: 'cri', sens: 'recue', pays: 'Allemagne', refEsabora: 'B3221-2026/00002', objet: '', personnes: 'M. Paul Martin, né le 01/02/1990' },
  { id: 'nom-autre-pays', type: 'dee', sens: 'emise', pays: 'Belgique', refEsabora: '', objet: '', personnes: 'MARTIN Paul' },
  { id: 'rien', type: 'dee', sens: 'emise', pays: 'Allemagne', refEsabora: '', objet: 'Vol – 2026/1234', personnes: 'DURAND' },
]
const c = demandesCorrespondantes(demandes, f)
check('correspondances : n° de procédure d’abord, puis même personne et même pays', c.map((x) => [x.demande.id, x.fort]), [['proc', true], ['nom', false]])
check('motifs affichés', c[0].motifs, ['même n° de procédure (2026/123)', 'même pays (Allemagne)'])
check('V/réf identique → correspondance forte (DEE reçue)',
  demandesCorrespondantes([{ id: 'v', type: 'dee', sens: 'recue', pays: 'Belgique', refEsabora: 'B1', refEtrangere: 'TO.12.AB.3456/26' }], r).map((x) => [x.demande.id, x.fort]), [['v', true]])
check('aucune correspondance', demandesCorrespondantes([demandes[3]], { ...f, personnes: [] }), [])

if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1) }
console.log('\nTous les tests passent.')
