/**
 * SIRAL — référentiels du module « Entraide internationale » (partagés par
 * l'écran et le connecteur) : pays, services enquêteurs de départ, catalogue
 * des mesures demandées.
 *
 * Les autorités étrangères, elles, ne sont PAS ici : elles vivent dans le
 * coffre `entraide` (liste apprise et enrichie à l'usage).
 */
import { normaliser } from './core.mjs'

// ── Pays ──
// adj : adjectif féminin pluriel (« les autorités judiciaires belges »).
// langue : langue par défaut des courriers adressés à ce pays.
// ue : État membre (DEE possible). en : nom anglais (courriers en anglais).
export const PAYS = [
  ['Allemagne', 'allemandes', 'en', true, 'Germany'], ['Autriche', 'autrichiennes', 'en', true, 'Austria'],
  ['Belgique', 'belges', 'fr', true, 'Belgium'], ['Bulgarie', 'bulgares', 'en', true, 'Bulgaria'],
  ['Chypre', 'chypriotes', 'en', true, 'Cyprus'], ['Croatie', 'croates', 'en', true, 'Croatia'],
  ['Danemark', 'danoises', 'en', true, 'Denmark'], ['Espagne', 'espagnoles', 'en', true, 'Spain'],
  ['Estonie', 'estoniennes', 'en', true, 'Estonia'], ['Finlande', 'finlandaises', 'en', true, 'Finland'],
  ['Grèce', 'grecques', 'en', true, 'Greece'], ['Hongrie', 'hongroises', 'en', true, 'Hungary'],
  ['Irlande', 'irlandaises', 'en', true, 'Ireland'], ['Italie', 'italiennes', 'en', true, 'Italy'],
  ['Lettonie', 'lettones', 'en', true, 'Latvia'], ['Lituanie', 'lituaniennes', 'en', true, 'Lithuania'],
  ['Luxembourg', 'luxembourgeoises', 'fr', true, 'Luxembourg'], ['Malte', 'maltaises', 'en', true, 'Malta'],
  ['Pays-Bas', 'néerlandaises', 'en', true, 'Netherlands'], ['Pologne', 'polonaises', 'en', true, 'Poland'],
  ['Portugal', 'portugaises', 'en', true, 'Portugal'], ['République tchèque', 'tchèques', 'en', true, 'Czech Republic'],
  ['Roumanie', 'roumaines', 'en', true, 'Romania'], ['Slovaquie', 'slovaques', 'en', true, 'Slovakia'],
  ['Slovénie', 'slovènes', 'en', true, 'Slovenia'], ['Suède', 'suédoises', 'en', true, 'Sweden'],
  ['Albanie', 'albanaises', 'en', false, 'Albania'], ['Algérie', 'algériennes', 'fr', false, 'Algeria'],
  ['Angola', 'angolaises', 'en', false, 'Angola'], ['Bénin', 'béninoises', 'fr', false, 'Benin'],
  ['Bosnie-Herzégovine', 'bosniennes', 'en', false, 'Bosnia and Herzegovina'], ['Brésil', 'brésiliennes', 'en', false, 'Brazil'],
  ['Cameroun', 'camerounaises', 'fr', false, 'Cameroon'], ['Canada', 'canadiennes', 'en', false, 'Canada'],
  ['Cap-Vert', 'cap-verdiennes', 'en', false, 'Cape Verde'], ['Chine', 'chinoises', 'en', false, 'China'],
  ['Congo', 'congolaises', 'fr', false, 'Congo'], ['Côte d’Ivoire', 'ivoiriennes', 'fr', false, 'Côte d’Ivoire'],
  ['États-Unis', 'américaines', 'en', false, 'United States'], ['Gabon', 'gabonaises', 'fr', false, 'Gabon'],
  ['Géorgie', 'géorgiennes', 'en', false, 'Georgia'], ['Islande', 'islandaises', 'en', false, 'Iceland'],
  ['Kosovo', 'kosovares', 'en', false, 'Kosovo'], ['Liechtenstein', 'liechtensteinoises', 'en', false, 'Liechtenstein'],
  ['Macédoine du Nord', 'macédoniennes', 'en', false, 'North Macedonia'], ['Mali', 'maliennes', 'fr', false, 'Mali'],
  ['Maroc', 'marocaines', 'fr', false, 'Morocco'], ['Moldavie', 'moldaves', 'en', false, 'Moldova'],
  ['Monaco', 'monégasques', 'fr', false, 'Monaco'], ['Monténégro', 'monténégrines', 'en', false, 'Montenegro'],
  ['Norvège', 'norvégiennes', 'en', false, 'Norway'], ['République démocratique du Congo', 'congolaises', 'fr', false, 'Democratic Republic of the Congo'],
  ['Royaume-Uni', 'britanniques', 'en', false, 'United Kingdom'], ['Russie', 'russes', 'en', false, 'Russia'],
  ['Sénégal', 'sénégalaises', 'fr', false, 'Senegal'], ['Serbie', 'serbes', 'en', false, 'Serbia'],
  ['Suisse', 'suisses', 'fr', false, 'Switzerland'], ['Tunisie', 'tunisiennes', 'fr', false, 'Tunisia'],
  ['Turquie', 'turques', 'en', false, 'Turkey'], ['Ukraine', 'ukrainiennes', 'en', false, 'Ukraine'],
].map(([nom, adj, langue, ue, en]) => ({ nom, adj, langue, ue, en }))

const PAYS_ALIAS = {
  'royaume uni': 'Royaume-Uni', 'uk': 'Royaume-Uni', 'angleterre': 'Royaume-Uni', 'irlande du nord': 'Royaume-Uni',
  'etats unis': 'États-Unis', 'usa': 'États-Unis', 'pays bas': 'Pays-Bas', 'hollande': 'Pays-Bas',
  'congo brazzaville': 'Congo', 'rdc': 'République démocratique du Congo', 'republique democratique du congo': 'République démocratique du Congo',
  'cote d ivoire': 'Côte d’Ivoire', 'cap vert': 'Cap-Vert', 'republique tcheque': 'République tchèque', 'tchequie': 'République tchèque',
  'benin': 'Bénin',
}

/** Retrouve un pays (casse, accents et variantes indifférents). */
export function paysDe(nom) {
  const n = normaliser(nom)
  if (!n) return null
  const alias = PAYS_ALIAS[n]
  return PAYS.find((p) => normaliser(p.nom) === n || (alias && p.nom === alias)) || null
}

/** « les autorités judiciaires belges » ; repli : « les autorités judiciaires (Pays) ». */
export function autoritesJudiciairesDe(pays) {
  const p = paysDe(pays)
  return p ? `les autorités judiciaires ${p.adj}` : `les autorités judiciaires (${pays || 'pays à préciser'})`
}

// ── Services enquêteurs ──
// Les « cases » cochent la trame T1/T2 (CASES_TRAME). Un service « autre »
// s'imprime après « Autre unité : ».
export const CASES_TRAME = [
  'ddsp', 'comm_amiens', 'comm_abbeville', 'drpj', 'antenne_amiens',
  'cgd', 'cgd_abbeville', 'cgd_amiens', 'cgd_montdidier', 'cgd_peronne', 'autre',
]

export const SERVICES_DEPART = [
  { id: 'ddsp_amiens', libelle: "Police — Commissariat d'Amiens", cases: ['ddsp', 'comm_amiens'] },
  { id: 'ddsp_abbeville', libelle: "Police — Commissariat d'Abbeville", cases: ['ddsp', 'comm_abbeville'] },
  { id: 'drpj_amiens', libelle: "DRPJ Lille — Antenne d'Amiens", cases: ['drpj', 'antenne_amiens'] },
  { id: 'cgd_abbeville', libelle: "Compagnie de gendarmerie d'Abbeville", cases: ['cgd', 'cgd_abbeville'] },
  { id: 'cgd_amiens', libelle: "Compagnie de gendarmerie d'Amiens", cases: ['cgd', 'cgd_amiens'] },
  { id: 'cgd_montdidier', libelle: 'Compagnie de gendarmerie de Montdidier', cases: ['cgd', 'cgd_montdidier'] },
  { id: 'cgd_peronne', libelle: 'Compagnie de gendarmerie de Péronne', cases: ['cgd', 'cgd_peronne'] },
  { id: 'sr_amiens', libelle: "Section de recherches d'Amiens", cases: ['autre'] },
]

// ── Mesures demandées ──
// texte : ce qui suit « Bien vouloir » ; {personnes} est remplacé par les
// personnes visées (ou « la personne visée dans la demande »).
// juge : mesure qui, en France, requiert l'autorisation d'un juge.
export const FAMILLES_MESURES = {
  auditions: 'Auditions',
  identification: 'Identification et localisation',
  notification: 'Notification et remise',
  patrimoine: 'Banque, patrimoine, réquisitions',
  preuves: 'Preuves et constatations',
  execution: 'Exécution et renseignements',
}

export const MESURES = [
  { id: 'audition_temoin', famille: 'auditions', libelle: 'Audition d’un témoin', synonymes: ['entendre', 'temoin', 'audition'], texte: 'procéder à l’audition en qualité de témoin de {personnes}' },
  { id: 'audition_suspect', famille: 'auditions', libelle: 'Audition d’un suspect', synonymes: ['mis en cause', 'suspect', 'audition', 'entendre', 'garde a vue', 'audition libre'], texte: 'procéder à l’audition en qualité de suspect de {personnes}, sous le régime adapté (audition libre ou garde à vue) et avec les droits afférents' },
  { id: 'audition_victime', famille: 'auditions', libelle: 'Audition d’une victime', synonymes: ['victime', 'plaignant', 'audition', 'entendre', 'plainte'], texte: 'procéder à l’audition en qualité de victime de {personnes}' },
  { id: 'audition_visio', famille: 'auditions', libelle: 'Audition par visioconférence', synonymes: ['visio', 'visioconference', 'videoconference', 'audition'], texte: 'organiser l’audition par visioconférence de {personnes}, aux date et heure à convenir avec l’autorité requérante' },
  { id: 'confrontation', famille: 'auditions', libelle: 'Confrontation', synonymes: ['confronter'], texte: 'procéder à la confrontation de {personnes}' },
  { id: 'identification', famille: 'identification', libelle: 'Identification d’une personne', synonymes: ['identifier', 'identite', 'qui est'], texte: 'procéder à l’identification complète de {personnes}' },
  { id: 'verification_adresse', famille: 'identification', libelle: 'Vérification d’adresse', synonymes: ['adresse', 'domicile', 'localiser', 'localisation', 'demeure'], texte: 'vérifier l’adresse et les conditions de domiciliation de {personnes}' },
  { id: 'verification_identite', famille: 'identification', libelle: 'Vérification d’identité', synonymes: ['identite', 'etat civil', 'verifier'], texte: 'vérifier l’identité et l’état civil de {personnes}' },
  { id: 'identification_societe', famille: 'identification', libelle: 'Identification d’une société', synonymes: ['societe', 'entreprise', 'gerant', 'associe', 'kbis', 'dirigeant'], texte: 'identifier la société concernée, ses dirigeants et associés, et vérifier si {personnes} y exerce des fonctions' },
  { id: 'notification_acte', famille: 'notification', libelle: 'Notification d’un acte', synonymes: ['notifier', 'notification', 'remettre', 'signifier', 'ecritures', 'pli'], texte: 'notifier à {personnes} l’acte joint et en recueillir l’accusé de réception signé' },
  { id: 'remise_convocation', famille: 'notification', libelle: 'Remise d’une convocation', synonymes: ['convocation', 'citation', 'convoquer'], texte: 'remettre à {personnes} la convocation jointe et en recueillir l’accusé de réception' },
  { id: 'remise_documents', famille: 'notification', libelle: 'Obtention de documents', synonymes: ['documents', 'pieces', 'remise', 'copie', 'obtenir'], texte: 'obtenir la remise des documents visés dans la demande' },
  { id: 'requisitions_bancaires', famille: 'patrimoine', libelle: 'Réquisitions bancaires', synonymes: ['banque', 'bancaire', 'compte', 'releves', 'ficoba', 'iban'], texte: 'procéder à des réquisitions bancaires afin d’identifier les comptes ouverts au nom de {personnes} et d’en obtenir les relevés' },
  { id: 'titulaire_compte', famille: 'patrimoine', libelle: 'Identification du titulaire d’un compte', synonymes: ['titulaire', 'compte', 'iban', 'banque', 'revolut'], texte: 'identifier le titulaire du compte bancaire mentionné dans la demande et obtenir la documentation bancaire afférente' },
  { id: 'enquete_patrimoniale', famille: 'patrimoine', libelle: 'Enquête patrimoniale', synonymes: ['patrimoine', 'biens', 'avoirs', 'solvabilite', 'immobilier'], texte: 'réaliser une enquête patrimoniale concernant {personnes}' },
  { id: 'requisitions_telephonie', famille: 'patrimoine', libelle: 'Réquisitions téléphoniques', synonymes: ['telephone', 'operateur', 'ligne', 'fadette', 'abonne'], texte: 'procéder aux réquisitions auprès des opérateurs de téléphonie afin d’identifier le titulaire de la ligne mentionnée et d’obtenir les données utiles' },
  { id: 'requisitions_internet', famille: 'patrimoine', libelle: 'Réquisitions internet (IP, comptes)', synonymes: ['ip', 'internet', 'mail', 'compte en ligne', 'reseau social', 'fournisseur'], texte: 'procéder aux réquisitions auprès des fournisseurs de services en ligne afin d’identifier l’utilisateur des comptes ou adresses IP mentionnés' },
  { id: 'requisitions_vehicule', famille: 'patrimoine', libelle: 'Identification d’un véhicule', synonymes: ['vehicule', 'immatriculation', 'plaque', 'voiture', 'siv', 'carte grise'], texte: 'identifier le titulaire du certificat d’immatriculation du véhicule mentionné' },
  { id: 'perquisition', famille: 'preuves', libelle: 'Perquisition', synonymes: ['perquisitionner', 'fouille', 'domicile'], texte: 'procéder à une perquisition au domicile de {personnes}', juge: true },
  { id: 'saisie', famille: 'preuves', libelle: 'Saisie', synonymes: ['saisir', 'gel', 'confiscation', 'avoirs'], texte: 'procéder à la saisie des biens ou objets visés dans la demande', juge: true },
  { id: 'interception', famille: 'preuves', libelle: 'Interception de communications', synonymes: ['ecoute', 'interception', 'telephone'], texte: 'procéder à l’interception des communications de la ligne visée dans la demande', juge: true },
  { id: 'constatations', famille: 'preuves', libelle: 'Constatations, photographies', synonymes: ['constater', 'photo', 'lieux', 'transport'], texte: 'procéder aux constatations et photographies des lieux visés dans la demande' },
  { id: 'expertise', famille: 'preuves', libelle: 'Expertise', synonymes: ['expert', 'analyse', 'adn', 'prelevement'], texte: 'faire procéder à l’expertise visée dans la demande' },
  { id: 'execution_amende', famille: 'execution', libelle: 'Exécution d’une sanction pécuniaire', synonymes: ['amende', 'sanction pecuniaire', 'recouvrement', 'payer'], texte: 'mettre à exécution la sanction pécuniaire prononcée à l’encontre de {personnes}' },
  { id: 'execution_peine', famille: 'execution', libelle: 'Exécution d’une peine', synonymes: ['peine', 'emprisonnement', 'condamnation', 'incarceration', 'execution'], texte: 'mettre à exécution la condamnation prononcée à l’encontre de {personnes}' },
  { id: 'casier', famille: 'execution', libelle: 'Extrait de casier judiciaire', synonymes: ['casier', 'b1', 'antecedents', 'condamnations'], texte: 'communiquer le bulletin n° 1 du casier judiciaire de {personnes}' },
  { id: 'personnalite', famille: 'execution', libelle: 'Renseignements de personnalité', synonymes: ['personnalite', 'situation', 'enquete sociale', 'emploi', 'famille'], texte: 'recueillir tous renseignements sur la situation personnelle, familiale et professionnelle de {personnes}' },
  { id: 'copie_procedure', famille: 'execution', libelle: 'Copie de procédure', synonymes: ['copie', 'procedure', 'dossier', 'communiquer'], texte: 'communiquer copie de la procédure visée dans la demande' },
]

/** Mesures proposées pour une saisie, les plus fréquentes d'abord. */
export function chercherMesures(requete, frequences = {}) {
  const q = normaliser(requete).split(' ').filter(Boolean)
  const res = []
  for (const m of MESURES) {
    const champs = normaliser([m.libelle, ...m.synonymes].join(' ')).split(' ')
    if (q.length && !q.every((w) => champs.some((c) => c.startsWith(w)))) continue
    res.push(m)
  }
  return res.sort((a, b) => (frequences[b.id] || 0) - (frequences[a.id] || 0))
}

/** Lignes « Bien vouloir … » d'une demande (une par mesure). */
export function lignesMesures(mesures, personnes) {
  const p = String(personnes || '').trim() || 'la personne visée dans la demande'
  return (mesures || [])
    .map((id) => MESURES.find((m) => m.id === id))
    .filter(Boolean)
    .map((m) => `Bien vouloir ${m.texte.replace(/\{personnes\}/g, p)}`)
}
