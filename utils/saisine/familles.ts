// utils/saisine/familles.ts
//
// Rattachement « infraction du dossier → famille de contentieux CO », socle du
// soit-transmis de saisine (cf. utils/saisineDocument.ts).
//
// Trois questions se posent à la rédaction d'un ST de saisine, et une seule
// relève d'une appréciation ; les deux autres se lisent dans les textes :
//   1. quelle qualification rappeler dans l'autorisation d'accès aux données de
//      trafic et de localisation (« la procédure concerne des faits de … ») ;
//   2. le régime dérogatoire de l'article 706-80 du code de procédure pénale
//      est-il applicable (c'est le « avec / sans 706-80 » des trames) ;
//   3. quelle motivation de criminalité grave retenir — voir motivations.ts.
//
// Le rattachement se fait sur les ARTICLES de définition du NATINF, et non sur
// son thème : le thème de l'export officiel est parfois erroné (le NATINF 16,
// aide à l'entrée et au séjour irréguliers, y est classé « Armes et explosifs »),
// alors que les articles, eux, sont fiables. Un repli sur le libellé couvre les
// codes dont les articles ne sont pas renseignés.
//
// Aucune numérotation d'alinéa de l'article 706-73 n'est produite ici : les
// trames du magistrat n'en citent pas (une seule le fait, pour le proxénétisme),
// et une numérotation erronée dans un acte serait pire que son absence. Le
// régime est donc rendu sous forme de PROPOSITION, que le magistrat confirme
// d'une case à cocher avant génération.

/** Identifiants de familles couvertes par la bibliothèque de motivations. */
export type FamilleId =
  | 'stups'
  | 'vol'
  | 'extorsion'
  | 'sequestration'
  | 'proxenetisme'
  | 'traite'
  | 'escroquerie'
  | 'blanchiment'
  | 'recel'
  | 'ile'
  | 'ila'
  | 'tabac'
  | 'corruption'
  | 'secret'
  | 'destructions'
  | 'association_malfaiteurs';

/** Régime proposé au titre de l'article 706-80 du code de procédure pénale. */
export type Regime706 =
  /** Infraction figurant à l'article 706-73 (ou 706-73-1) : 706-80 applicable. */
  | 'derogatoire'
  /** Cas du tabac en bande organisée : 706-80 applicable SAUF la garde à vue. */
  | 'derogatoire_sauf_gav'
  /** Hors liste : le ST rappelle que le 706-80 n'est pas applicable. */
  | 'droit_commun';

export interface Famille {
  id: FamilleId;
  /** Nom court affiché dans l'interface. */
  libelle: string;
  /**
   * Qualification telle qu'elle est rappelée dans l'autorisation d'accès aux
   * données (« … concerne des faits de {qualification} ») — reprise mot pour mot
   * des actes validés du magistrat.
   */
  qualification: string;
  /** Variante employée quand la bande organisée est retenue. */
  qualificationBO?: string;
  /**
   * Régime 706-80 hors bande organisée. Plusieurs familles ne basculent au
   * régime dérogatoire QUE si la bande organisée est retenue (vol, extorsion,
   * escroquerie, armes, aide au séjour, tabac) : c'est `regimeBO` qui s'applique
   * alors.
   */
  regime: Regime706;
  /** Régime lorsque la bande organisée est retenue (défaut : `regime`). */
  regimeBO?: Regime706;
  /**
   * Famille accessoire : elle qualifie des faits mais ne porte pas à elle seule
   * la motivation de criminalité grave (association de malfaiteurs, recel).
   * Elle n'est jamais choisie comme famille principale si une autre est présente.
   */
  accessoire?: boolean;
  /** Articles de définition qui rattachent un NATINF à cette famille. */
  articles: RegExp[];
  /** Repli sur le libellé du NATINF quand les articles manquent. */
  libelles?: RegExp[];
}

/**
 * Table de rattachement. L'ordre compte : la première famille non accessoire
 * qui reconnaît une infraction du dossier devient la famille principale, et
 * c'est elle qui commande la motivation proposée.
 */
export const FAMILLES: Famille[] = [
  {
    id: 'tabac',
    libelle: 'Tabac / contributions indirectes',
    qualification: 'détention et vente frauduleuse de tabacs manufacturés',
    qualificationBO:
      'détention et vente frauduleuse de tabacs manufacturés en bande organisée',
    regime: 'droit_commun',
    regimeBO: 'derogatoire_sauf_gav',
    articles: [
      /ART\.419/i, /C\.DOUANES/i, /ART\.1810/i, /C\.G\.I/i, /C\.I\.B\.S/i,
      /ART\.L\.351[25]-/i, // dispositions « tabac » du code de la santé publique
    ],
    libelles: [/TABAC/i],
  },
  {
    id: 'stups',
    libelle: 'Stupéfiants (ILS)',
    qualification: 'trafic de stupéfiants',
    regime: 'derogatoire', // art. 222-34 à 222-40 C. pén. : régime CO de plein droit
    // Le code de la santé publique porte aussi les dispositions sur le tabac
    // (art. L.3512-*, L.3515-*) : on ne vise donc que ses articles relatifs aux
    // substances vénéneuses, jamais « C.SANTE.PUB » en bloc.
    articles: [/ART\.222-3[4-9]/i, /ART\.222-40/i, /ART\.222-41/i, /ART\.[LR]\.5132-/i],
    libelles: [/STUPEFIANT/i],
  },
  {
    id: 'proxenetisme',
    libelle: 'Proxénétisme',
    qualification: 'proxénétisme aggravé',
    regime: 'derogatoire',
    articles: [/ART\.225-(5|6|7|8|9|10|11|12)\b/i],
    libelles: [/PROXENETISME/i],
  },
  {
    id: 'traite',
    libelle: 'Traite des êtres humains',
    qualification: "traite des êtres humains",
    regime: 'derogatoire',
    articles: [/ART\.225-4-/i],
    libelles: [/TRAITE DES ETRES HUMAINS/i],
  },
  {
    id: 'extorsion',
    libelle: 'Extorsion',
    qualification: 'extorsion',
    qualificationBO: 'extorsion en bande organisée',
    regime: 'droit_commun',
    regimeBO: 'derogatoire', // art. 312-6 et 312-7 C. pén.
    articles: [/ART\.312-/i],
    libelles: [/EXTORSION/i],
  },
  {
    id: 'sequestration',
    libelle: 'Enlèvement et séquestration',
    qualification: 'arrestation, enlèvement, séquestration ou détention arbitraire',
    qualificationBO: 'enlèvement et séquestration en bande organisée',
    regime: 'droit_commun',
    regimeBO: 'derogatoire',
    articles: [/ART\.224-[1-5]/i],
    libelles: [/SEQUESTRATION|ENLEVEMENT/i],
  },
  {
    id: 'vol',
    libelle: 'Vol',
    qualification: 'vol',
    qualificationBO: 'vol en bande organisée',
    regime: 'droit_commun',
    regimeBO: 'derogatoire', // art. 311-9 C. pén.
    articles: [/ART\.311-/i],
    libelles: [/\bVOL\b/i],
  },
  {
    id: 'escroquerie',
    libelle: 'Escroquerie',
    qualification: "escroquerie",
    qualificationBO: 'escroquerie en bande organisée',
    regime: 'droit_commun',
    regimeBO: 'derogatoire', // art. 313-2 dernier alinéa C. pén.
    articles: [/ART\.313-/i],
    libelles: [/ESCROQUERIE/i],
  },
  {
    id: 'blanchiment',
    libelle: 'Blanchiment',
    qualification: 'blanchiment',
    regime: 'droit_commun', // dérogatoire seulement si l'infraction d'origine l'est
    articles: [/ART\.324-/i],
    libelles: [/BLANCHIMENT/i],
  },
  {
    id: 'ile',
    libelle: "Aide à l'entrée et au séjour irréguliers (ILE)",
    qualification:
      "aide à l'entrée, à la circulation ou au séjour irréguliers d'un étranger en France",
    qualificationBO:
      "aide à l'entrée, à la circulation ou au séjour irréguliers d'un étranger en France commise en bande organisée",
    regime: 'droit_commun',
    regimeBO: 'derogatoire', // art. L.823-1 à L.823-3 CESEDA en bande organisée
    articles: [/C\.E\.S\.E\.D\.A/i, /ART\.L\.82[0-9]-/i],
    libelles: [/ETRANGER EN FRANCE|SEJOUR IRREGULIER/i],
  },
  {
    id: 'ila',
    libelle: 'Armes et munitions (ILA)',
    qualification: "achat ou vente entre particuliers d'armes, munitions ou de leurs éléments",
    qualificationBO: "trafic d'armes commis en bande organisée",
    regime: 'droit_commun',
    regimeBO: 'derogatoire', // art. 222-52 à 222-54 C. pén. en bande organisée
    articles: [/C\.S\.I/i, /ART\.L\.31[1-7]-/i, /ART\.222-5[2-9]/i],
    libelles: [/\bARME|MUNITION/i],
  },
  {
    id: 'corruption',
    libelle: "Corruption et atteintes à l'autorité",
    qualification:
      "corruption active et passive en lien avec une personne dépositaire de l'autorité publique",
    regime: 'droit_commun',
    articles: [/ART\.432-11/i, /ART\.433-1/i, /ART\.432-1[0-9]/i],
    libelles: [/CORRUPTION|TRAFIC D'INFLUENCE/i],
  },
  {
    id: 'secret',
    libelle: "Violation du secret de l'enquête",
    qualification:
      "révélation d'information sur une enquête ou une instruction pour crime ou délit à une personne susceptible d'y être impliquée",
    regime: 'droit_commun',
    articles: [/ART\.434-7-2/i],
    libelles: [/VIOLATION DU SECRET|REVELATION D'INFORMATION/i],
  },
  {
    id: 'destructions',
    libelle: 'Destructions et dégradations',
    qualification: 'destruction ou dégradation',
    qualificationBO: 'destruction ou dégradation commise en bande organisée',
    regime: 'droit_commun',
    regimeBO: 'derogatoire', // art. 322-8 C. pén.
    articles: [/ART\.322-/i],
    libelles: [/DESTRUCTION|DEGRADATION/i],
  },
  {
    id: 'recel',
    libelle: 'Recel',
    qualification: 'recel',
    regime: 'droit_commun',
    accessoire: true,
    articles: [/ART\.321-[1-6]/i],
    libelles: [/\bRECEL\b/i],
  },
  {
    id: 'association_malfaiteurs',
    libelle: 'Association de malfaiteurs',
    qualification: "participation à une association de malfaiteurs",
    regime: 'droit_commun', // suit le régime de l'infraction préparée
    accessoire: true,
    articles: [/ART\.450-1/i],
    libelles: [/ASSOCIATION DE MALFAITEURS/i],
  },
];

/** Infraction du dossier, réduite à ce dont le rattachement a besoin. */
export interface InfractionSaisine {
  /** Libellé de la qualification (NATINF ou tag). */
  label: string;
  /** Numéro NATINF, si résolu. */
  code?: string;
  /** Articles définissant l'infraction (export officiel NATINF). */
  articlesDefinition?: string;
  /** Articles édictant les peines (export officiel NATINF). */
  articlesRepression?: string;
  /** Emprisonnement encouru, en mois, quand le référentiel le renseigne. */
  emprisonnementMois?: number;
  /** Réclusion encourue, en années, pour les crimes. */
  reclusionAnnees?: number;
}

const matchFamille = (f: Famille, i: InfractionSaisine): boolean => {
  const arts = `${i.articlesDefinition || ''} ${i.articlesRepression || ''}`;
  if (arts.trim() && f.articles.some((re) => re.test(arts))) return true;
  return Boolean(f.libelles?.some((re) => re.test(i.label || '')));
};

/** Familles reconnues dans les infractions du dossier, sans doublon. */
export const famillesDetectees = (infractions: InfractionSaisine[]): Famille[] => {
  const vues = new Set<FamilleId>();
  const out: Famille[] = [];
  for (const f of FAMILLES) {
    if (vues.has(f.id)) continue;
    if (infractions.some((i) => matchFamille(f, i))) {
      vues.add(f.id);
      out.push(f);
    }
  }
  return out;
};

/**
 * Famille principale : la première famille non accessoire reconnue. Un dossier
 * « association de malfaiteurs + escroquerie » est motivé par l'escroquerie ;
 * un dossier qui ne porte QUE de l'association de malfaiteurs retombe sur elle.
 */
export const famillePrincipale = (
  infractions: InfractionSaisine[],
): Famille | undefined => {
  const familles = famillesDetectees(infractions);
  return familles.find((f) => !f.accessoire) || familles[0];
};

/** Vrai si l'une des qualifications vise expressément la bande organisée. */
export const viseBandeOrganisee = (infractions: InfractionSaisine[]): boolean =>
  infractions.some(
    (i) =>
      /BANDE ORGANIS/i.test(i.label || '')
      || /ART\.132-71/i.test(`${i.articlesDefinition || ''} ${i.articlesRepression || ''}`),
  );

/** Régime 706-80 proposé pour une famille, selon que la BO est retenue. */
export const regimePropose = (famille: Famille | undefined, bandeOrganisee: boolean): Regime706 => {
  if (!famille) return 'droit_commun';
  return bandeOrganisee ? famille.regimeBO || famille.regime : famille.regime;
};

/** Qualification à rappeler dans l'autorisation d'accès aux données. */
export const qualificationPour = (famille: Famille | undefined, bandeOrganisee: boolean): string => {
  if (!famille) return '';
  return (bandeOrganisee && famille.qualificationBO) || famille.qualification;
};

// ── Quantum encouru ─────────────────────────────────────────────────────────
//
// L'autorisation d'accès aux données de trafic et de localisation énonce le
// quantum (« faits punis de dix ans d'emprisonnement ») : l'article 60-1-2 du
// code de procédure pénale réserve ces réquisitions, notamment, aux crimes et
// aux délits punis d'au moins trois ans d'emprisonnement. Le quantum n'est donc
// pas décoratif, et il n'est JAMAIS deviné : il vient du référentiel NATINF
// quand celui-ci le renseigne (codes du mémento parquet), sinon le magistrat le
// saisit — le référentiel officiel ne porte pas la peine encourue.

const MOIS_EN_LETTRES: Record<number, string> = {
  36: 'trois ans',
  60: 'cinq ans',
  84: 'sept ans',
  120: 'dix ans',
  180: 'quinze ans',
  240: 'vingt ans',
};

const ANNEES_EN_LETTRES: Record<number, string> = {
  15: 'quinze ans',
  20: 'vingt ans',
  30: 'trente ans',
};

/** Peine la plus élevée encourue parmi les infractions, en années. */
export const quantumMaxAnnees = (infractions: InfractionSaisine[]): number | undefined => {
  let max: number | undefined;
  for (const i of infractions) {
    const annees = i.reclusionAnnees
      ?? (i.emprisonnementMois ? i.emprisonnementMois / 12 : undefined);
    if (annees && (max === undefined || annees > max)) max = annees;
  }
  return max;
};

/**
 * Quantum en toutes lettres tel qu'il s'écrit dans l'acte (« dix ans »), à
 * partir des infractions du dossier. Rend `undefined` quand le référentiel ne
 * renseigne aucune peine : c'est alors au magistrat de compléter.
 */
export const quantumEnLettres = (infractions: InfractionSaisine[]): string | undefined => {
  const annees = quantumMaxAnnees(infractions);
  if (!annees) return undefined;
  const mois = Math.round(annees * 12);
  return MOIS_EN_LETTRES[mois] || ANNEES_EN_LETTRES[annees] || `${annees} ans`;
};

/**
 * Contrôle du seuil de l'article 60-1-2 du code de procédure pénale : sous
 * trois ans d'emprisonnement encouru, l'autorisation d'accès aux données de
 * trafic et de localisation ne peut pas être délivrée sur ce fondement.
 * Rend `null` quand le quantum est inconnu (contrôle impossible, pas rassurant).
 */
export const seuilDonneesConnexionAtteint = (
  infractions: InfractionSaisine[],
): boolean | null => {
  const annees = quantumMaxAnnees(infractions);
  if (!annees) return null;
  return annees >= 3;
};
