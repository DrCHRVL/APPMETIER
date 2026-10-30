// types/entraideTypes.ts
//
// Module « Entraide internationale » : suivi des demandes d'entraide pénale
// (DEE, dénonciations officielles, CRI, exécution de décisions) et civile,
// reçues ou émises. Registre PARTAGÉ entre tous les utilisateurs du module
// (coffre global `entraide`, cf. utils/dataSync/EntraideSyncService.ts).
//
// Principe : l'état d'une demande (étape, échéance, délais légaux) n'est
// jamais saisi — il se DÉDUIT de sa chronologie d'événements
// (lib/entraide/core.mjs). Chaque bouton de l'écran ajoute un événement.

export type EntraideType = 'dee' | 'do' | 'cri' | 'execution' | 'civil';
export type EntraideSens = 'recue' | 'emise';
/** Drapeau posé par le magistrat : orange = suivi renforcé, rouge = résultats urgents. */
export type EntraideDrapeau = 'orange' | 'rouge';

/** Issue d'une dénonciation officielle reçue (portée par l'événement de clôture). */
export type EntraideIssue = 'acceptee' | 'refusee';

export type EntraideLangue = 'fr' | 'en';

/** Courriers générés : T1 (ST enquêteurs), T2 (ST de relance), T3 (retour à
 *  l'autorité étrangère), T4 (relance de l'autorité étrangère). */
export type EntraideDocId = 't1' | 't2' | 't3' | 't4';

export type EntraideEvenementType =
  | 'reception'                // demande reçue (reçue)
  | 'enregistrement'           // demande enregistrée (émise)
  | 'ar_annexe_b'              // DEE reçue : accusé de réception (annexe B) adressé
  | 'traduction_demandee'
  | 'traduction_recue'
  | 'document_prepare'         // courrier préparé, à signer (doc)
  | 'signature'                // courrier validé et signé par le magistrat (doc)
  | 'envoi_enqueteurs'         // ST (T1) envoyé → délai de 3 mois
  | 'relance_enqueteurs_mail'  // simple mail de relance (pas de nouveau délai)
  | 'relance_enqueteurs'       // ST de relance (T2) envoyé → nouveau délai de 3 mois
  | 'retour_enqueteurs'        // retour des enquêteurs (partiel ou complet)
  | 'transmission_magistrat'   // dossier présenté au magistrat pour avis
  | 'envoi_autorite'           // reçue : retour (T3) envoyé ; émise : demande envoyée (→ 4 mois)
  | 'relance_autorite'         // relance de l'autorité étrangère (T4) → nouveau délai
  | 'prorogation'              // nouveau délai sans relance
  | 'retour_execution'         // émise : exécution reçue
  | 'ar_recu'                  // accusé de réception international reçu
  | 'cloture'
  | 'reouverture'
  | 'note';

export interface EntraideEvenement {
  id: string;
  type: EntraideEvenementType;
  /** Date de l'événement (AAAA-MM-JJ), modifiable. */
  date: string;
  /** Utilisateur qui l'a enregistré (windowsUsername). */
  par?: string;
  /** Courrier concerné (document_prepare, signature). */
  doc?: EntraideDocId;
  /** Langue du courrier préparé. */
  langue?: EntraideLangue;
  /** Délai en mois ouvert par l'événement (relance, prorogation). */
  delaiMois?: number;
  /** Échéance fixée explicitement (prime sur delaiMois). */
  echeance?: string;
  /** Retour partiel des enquêteurs : l'attente continue. */
  partiel?: boolean;
  /** Clôture d'une dénonciation officielle reçue : acceptée ou refusée. */
  issue?: EntraideIssue;
  note?: string;
  creeLe: string;
}

/** Échéance légale saisie à la main (prescription, date butoir de l'État…). */
export interface EntraideEcheanceManuelle {
  id: string;
  date: string;
  libelle: string;
}

export interface DemandeEntraide {
  id: string;
  type: EntraideType;
  sens: EntraideSens;
  /** N/réf : numéro ESABORA, collé tel qu'ESABORA l'affiche (ex. B3221-2025/00645). */
  refEsabora: string;
  /** V/réf : référence de l'autorité étrangère. */
  refEtrangere?: string;
  pays: string;
  /** Autorité étrangère (requérante si reçue, requise si émise). */
  autoriteId?: string;
  /** Nom de l'autorité (instantané, ou saisie libre sans fiche). */
  autoriteNom?: string;
  /** Service enquêteur saisi (demande reçue). */
  serviceId?: string;
  /** Précision libre si « Autre unité ». */
  serviceAutre?: string;
  objet: string;
  /** Mesures demandées (identifiants du catalogue config/entraideReferentiels). */
  mesures?: string[];
  /** Drapeau de suivi : délais raccourcis, pré-alerte plus tôt, tête de liste. */
  drapeau?: EntraideDrapeau;
  /** Codes NATINF de l'infraction visée (ou de son équivalent en droit français). */
  natinf?: string[];
  /** Paragraphe « Bien vouloir… » retouché (sinon généré depuis `mesures`). */
  texteMesures?: string;
  /** Personnes visées (texte libre). */
  personnes?: string;
  /** Magistrat en charge (windowsUsername). */
  magistrat?: string;
  dateEnregistrement: string;
  evenements: EntraideEvenement[];
  echeancesLegales?: EntraideEcheanceManuelle[];
  observations?: string;
  creePar?: string;
  creeLe: string;
  dateMiseAJour: string;
  /** Provenance d'une demande reprise du tableau Excel. */
  origine?: { source: 'import_excel'; onglet: string; ligne: number };
}

export type AutoriteNature = 'parquet' | 'tribunal' | 'juge' | 'ministere' | 'police' | 'autre';

export interface AutoriteEtrangere {
  id: string;
  nom: string;
  nature?: AutoriteNature;
  /** Ville (sert à « Parquet de … » / « Tribunal de … » dans T1-T2). */
  ville?: string;
  /** Adresse postale, une ligne par élément. */
  adresse?: string;
  pays: string;
  /** Langue des courriers T3/T4 et des mails. */
  langue: EntraideLangue;
  email?: string;
  /** Mots-clés appris : ce qu'on a tapé pour la retrouver. */
  motsCles: string[];
  dateMiseAJour: string;
}

export interface ServiceEnqueteur {
  id: string;
  libelle: string;
  email?: string;
  /** Cases à cocher des trames T1/T2 (cf. CASES_TRAME). */
  cases: string[];
  /** Service retiré de la liste (conservé pour l'historique). */
  inactif?: boolean;
  dateMiseAJour: string;
}

/** Bloc signature d'un magistrat (renseigné par lui-même). */
export interface SignataireEntraide {
  username: string;
  civilite: 'M.' | 'Mme';
  prenomNom: string;
  /** Ex. « Substitut du procureur de la République ». */
  fonction: string;
  telephone?: string;
  email?: string;
  /** Image de la signature (data URL PNG/JPEG). Apposée uniquement quand ce
   *  magistrat valide lui-même un courrier. */
  signature?: string;
  dateMiseAJour: string;
}

export interface EntraideTombstone {
  id: string;
  deletedAt: string;
}

/** Contenu du coffre `entraide`. */
export interface EntraideData {
  demandes: DemandeEntraide[];
  autorites: AutoriteEtrangere[];
  services: ServiceEnqueteur[];
  signataires: SignataireEntraide[];
  /** Suppressions (demandes, autorités, services) — anti-résurrection. */
  tombstones: EntraideTombstone[];
}

export interface EntraideSyncFile extends EntraideData {
  version: number;
  updatedAt: string;
  updatedBy: string;
  computerName?: string;
}

// ── État déduit (lib/entraide/core.mjs) ──

export type EntraideEtape =
  | 'a_traiter'
  | 'en_traduction'
  | 'a_signer'
  | 'a_envoyer'
  | 'chez_enqueteurs'
  | 'avis_magistrat'
  | 'attente_etranger'
  | 'attente_ar'
  | 'a_cloturer'
  | 'cloturee';

export type EntraideChez = 'greffe' | 'magistrat' | 'enqueteurs' | 'traduction' | 'autorite' | 'aucun';

export interface EntraideEcheanceLegale {
  code: string;
  libelle: string;
  date: string;
  /** non_renseigne : dossier clôturé sans trace de la diligence (reprise d'historique). */
  statut: 'respecte' | 'en_cours' | 'depasse' | 'depasse_fait' | 'non_renseigne';
  faitLe?: string;
}

export interface EntraideEtat {
  etape: EntraideEtape;
  libelleEtape: string;
  chez: EntraideChez;
  /** Échéance interne en cours (retour attendu, représentation). */
  echeance: { date: string; libelle: string } | null;
  echeancesLegales: EntraideEcheanceLegale[];
  /** Courrier en attente (à signer ou à envoyer). */
  docEnAttente: { doc: EntraideDocId; langue?: EntraideLangue; depuis: string; signeLe?: string; signePar?: string } | null;
  /** Échéance la plus proche, internes et légales confondues (non tenues). */
  prochaineDate: string | null;
  /** Jours restants avant prochaineDate (négatif = retard). */
  joursRestants: number | null;
  niveau: 'retard' | 'proche' | 'ok' | 'aucune' | 'cloturee';
  /** Aucune échéance et rien depuis longtemps. */
  dormant: boolean;
  dernierEvenement: string | null;
  dateCloture: string | null;
  nbRelances: number;
  drapeau: EntraideDrapeau | null;
}

export interface EntraideAction {
  action: string;
  libelle: string;
  primaire?: boolean;
  doc?: EntraideDocId;
}
