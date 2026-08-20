// types/recoupementTypes.ts
//
// VEILLE DE RECOUPEMENTS.
//
// Deux dossiers parlent parfois de la même personne, de la même adresse ou de
// la même ligne sans que personne ne s'en aperçoive : la pièce arrive d'une
// autre unité, elle est classée, et le nom qui la relie à une affaire en cours
// dort dans un PDF. La veille lit ce qui est DÉJÀ dans l'application (mis en
// cause, actes, comptes rendus, pièces déposées) et signale ces coïncidences.
//
// Règle de conduite : elle ne bloque rien, ne modifie rien, n'ouvre rien.
// Elle pose un signal discret — « regardez ça » — et se tait dès qu'on l'a
// écarté, tant que la situation ne change pas (même doctrine que les alertes :
// silence jusqu'à changement réel, cf. docs/REFONTE-ALERTES.md).

/** Nature de la coïncidence relevée. */
export type RecoupementKind =
  | 'personne'    // même personne (orthographe tolérée, ordre Nom/Prénom indifférent)
  | 'patronyme'   // même nom de famille, prénoms différents — lien familial possible
  | 'telephone'
  | 'adresse'
  | 'plaque'
  | 'compte'      // pseudo / compte de réseau social
  | 'iban'
  | 'imei';

/** Endroit d'où sort une valeur, dans un dossier. */
export type RecoupementOrigine =
  | 'mec'              // mis en cause / mis en examen / suspect / victime déclaré
  | 'ecoute'
  | 'geolocalisation'
  | 'acte'
  | 'description'
  | 'notes'
  | 'cr'
  | 'document';

/** Dossier au sens de la veille : enquête préliminaire ou dossier d'instruction. */
export interface RecoupementDossierRef {
  /** Identifiant stable et unique (les id d'enquête repartent de 1 par contentieux). */
  key: string;
  numero: string;
  /** Libellé affiché (numéro + objet court). */
  label: string;
  nature: 'enquete' | 'instruction';
  contentieuxId?: string;
  /** Id d'enquête, pour rouvrir la fiche depuis le signal. */
  enqueteId?: number;
  /** Id de dossier d'instruction, même usage. */
  instructionId?: number;
}

/** Un texte à fouiller, avec sa provenance (pour dire OÙ on a vu la valeur). */
export interface CorpusFragment {
  origine: RecoupementOrigine;
  /** Précision affichée : « CR du 20/07/2026 », « PV_gendarmerie.pdf »… */
  detail?: string;
  texte: string;
}

/** Tout ce que la veille sait d'un dossier. */
export interface DossierCorpus extends RecoupementDossierRef {
  /** Personnes DÉCLARÉES (mis en cause, mis en examen, suspects, victimes). */
  personnes: string[];
  fragments: CorpusFragment[];
}

/** Une occurrence d'une valeur, dans un dossier donné. */
export interface RecoupementOccurrence {
  dossier: RecoupementDossierRef;
  origine: RecoupementOrigine;
  detail?: string;
  /** Valeur telle qu'écrite sur place. */
  valeurBrute: string;
  /** Courte citation autour de la valeur (texte libre uniquement). */
  extrait?: string;
  /** Vraie si la valeur vient d'un champ structuré (fiche MEC, ligne d'écoute…)
   *  et non d'un texte libre : c'est ce qui distingue un fait saisi d'une
   *  simple mention au fil d'une pièce. */
  declaree: boolean;
}

/** Un signal : une valeur partagée par au moins deux dossiers. */
export interface Recoupement {
  /** Identité stable du signal (nature + valeur canonique). */
  id: string;
  kind: RecoupementKind;
  /** Forme affichable de la valeur (« 16 rue Balzac », « MEON »). */
  valeur: string;
  /** Forme canonique ayant servi au rapprochement. */
  canon: string;
  /** Confiance, de 0 à 1. */
  score: number;
  /**
   * Empreinte de la situation qui justifie le signal : liste des dossiers
   * concernés. Écarter le signal mémorise cette empreinte ; il ne réapparaît
   * que si un dossier de plus rejoint la coïncidence.
   */
  stateKey: string;
  dossierKeys: string[];
  occurrences: RecoupementOccurrence[];
  /** Aucun mis en cause commun entre ces dossiers : pont réellement inédit. */
  pontInedit: boolean;
}

/** Geste de l'utilisateur sur un signal, mémorisé par utilisateur. */
export interface RecoupementAck {
  /** Empreinte au moment du geste (cf. Recoupement.stateKey). */
  stateKey: string;
  /** 'vu' = lu sans suite ; 'ecarte' = sans intérêt, ne plus remonter. */
  action: 'vu' | 'ecarte';
  at: string;
}

export type RecoupementAcks = Record<string, RecoupementAck>;
