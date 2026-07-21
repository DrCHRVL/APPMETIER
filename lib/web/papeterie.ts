/**
 * SIRAL — papeterie institutionnelle (identité du parquet).
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  À PARAMÉTRER PAR UTILISATEUR À TERME.                                   │
 * │  Aujourd'hui l'application n'a qu'un seul magistrat (l'administrateur),  │
 * │  ses coordonnées sont donc figées ici. Le jour où un autre utilisateur  │
 * │  a accès à l'Assistant de Justice IA — ou si le magistrat change de      │
 * │  tribunal — il suffira de remplacer ce SEUL objet par une valeur issue  │
 * │  du profil utilisateur / d'une table de configuration. Aucune autre     │
 * │  partie du code ne doit coder « en dur » une adresse, un nom ou une      │
 * │  section : tout passe par PAPETERIE.                                     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Les libellés reprennent à l'identique la trame Word officielle du parquet
 * (en-tête « Cour d'appel / Tribunal / Parquet / Section », bloc coordonnées
 * de pied de page, bloc signature).
 */

export interface Papeterie {
  /** Ligne d'en-tête « Cour d'appel — Tribunal judiciaire ». */
  juridiction: string;
  /** Ligne « Parquet du procureur de la République ». */
  parquet: string;
  /** Rattachement court du magistrat (actes : requêtes, soit-transmis). */
  section: string;
  /** Rattachement détaillé (courriers) : section + compétences. */
  sectionDetail: string;
  /** Ville du lieu de signature (« Fait à … »). */
  ville: string;
  magistrat: {
    /** Forme « NOM Prénom » (en-tête, « Nous, … »). */
    nomQualite: string;
    /** Forme « Prénom NOM » (signature). */
    prenomNom: string;
    /** Qualité (« substitut du Procureur de la République »). */
    qualite: string;
    /** Rattachement (« près le tribunal judiciaire d'AMIENS »). */
    ressort: string;
  };
  /** Bloc signature, ligne à ligne (calé à droite). */
  signature: string[];
  /** Bloc coordonnées du pied de page (courriers). */
  coordonnees: {
    adresse: string[];
    mails: string[];
    standard: string;
    /** Ligne des compétences, en bas de page. */
    thematiques: string;
  };
}

export const PAPETERIE: Papeterie = {
  juridiction: "Cour d'Appel d'Amiens — Tribunal Judiciaire d'Amiens",
  parquet: 'Parquet du procureur de la République',
  section: 'Section Criminalité Organisée',
  sectionDetail: 'Section Criminalité organisée — Entraide pénale européenne',
  ville: 'Amiens',
  magistrat: {
    nomQualite: 'CHEVALIER Audran',
    prenomNom: 'Audran CHEVALIER',
    qualite: 'substitut du Procureur de la République',
    ressort: "près le tribunal judiciaire d'AMIENS",
  },
  signature: [
    'P/ Le Procureur de la République',
    'Audran CHEVALIER',
    'Substitut',
  ],
  coordonnees: {
    adresse: [
      "Tribunal Judiciaire d'Amiens",
      '14 rue Robert de Luzarches',
      'CS 32722',
      '80027 Amiens Cedex 1',
    ],
    mails: ['audran.chevalier@justice.fr', 'crimorg.tj-amiens@justice.fr'],
    standard: '03.22.82.47.07',
    thematiques: 'Criminalité Organisée · CyberCriminalité · Entraide pénale internationale',
  },
};
