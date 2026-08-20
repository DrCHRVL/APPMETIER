// utils/saisine/motivations.ts
//
// Bibliothèque des motivations de « criminalité grave » du soit-transmis de
// saisine — le seul passage de l'acte qui change réellement d'un dossier à
// l'autre (voir utils/saisineDocument.ts pour le reste, qui est déterministe).
//
// L'autorisation d'accès aux données de trafic et de localisation obéit
// toujours au même moule dans les actes du magistrat :
//
//   Autorisation de requérir l'accès aux données de trafic et de localisation
//   en ce que la procédure concerne des faits de {QUALIFICATION}, faits punis
//   de {QUANTUM} d'emprisonnement ; qu'en considération {CIRCONSTANCES}, cette
//   enquête relève de la criminalité grave ; que l'accès à des données de
//   trafic et de localisation est nécessaire aux investigations et
//   proportionné à la gravité des faits commis{COMPLÉMENT}.
//
// QUALIFICATION et QUANTUM sont lus dans le référentiel NATINF (familles.ts) ;
// CIRCONSTANCES et COMPLÉMENT viennent d'ici. Tous les fragments ci-dessous
// sont repris MOT POUR MOT des soit-transmis validés et signés du magistrat
// (bibliothèque de trames « st-saisine-* » et « st-co-saisine-* ») : rien n'est
// reformulé, rien n'est inventé. C'est ce qui rend la motivation reproductible
// d'un dossier à l'autre et vérifiable ligne à ligne.
//
// Le magistrat coche, décoche et réécrit librement ces circonstances avant
// génération : cette motivation conditionne la régularité de l'accès aux
// données de connexion, elle n'est jamais délivrée sans relecture.

import type { FamilleId } from './familles';

/** Une circonstance mobilisée dans la motivation, cochable dans l'interface. */
export interface Motif {
  id: string;
  /** Libellé court dans l'interface. */
  label: string;
  /** Fragment tel qu'il s'écrit dans l'acte, à la suite de « en considération ». */
  texte: string;
  /** Coché par défaut lorsque la famille est retenue. */
  defaut?: boolean;
}

export interface MotifsFamille {
  /** Circonstances propres à la famille. */
  motifs: Motif[];
  /**
   * Complément de la formule de proportionnalité, propre à certaines familles
   * (« … proportionné à la gravité des faits commis QUI PORTENT ATTEINTE … »).
   */
  complement?: string;
}

/** Circonstances par famille, extraites des actes validés. */
export const MOTIFS_PAR_FAMILLE: Record<FamilleId, MotifsFamille> = {
  stups: {
    motifs: [
      {
        id: 'stups-organisations',
        label: 'Organisations criminelles / ramifications',
        texte:
          "des organisations criminelles à l'œuvre avec des ramifications potentiellement trans-départementales",
        defaut: true,
      },
      {
        id: 'stups-victimes',
        label: 'Nombre de victimes',
        texte: 'du nombre de victimes',
      },
      {
        id: 'stups-reseau',
        label: 'Organisation du réseau',
        texte: "de l'organisation du réseau criminel à l'origine de ces faits",
        defaut: true,
      },
      {
        id: 'stups-sante-securite',
        label: 'Santé et sécurité publiques, violences associées',
        texte:
          "les enjeux majeurs en termes de santé et sécurité publique face à l'arrivée sur le territoire national de stupéfiants et de sécurité publique au regard des violences associées à ce trafic (règlements de comptes, intimidations, etc.)",
        defaut: true,
      },
    ],
  },

  vol: {
    motifs: [
      {
        id: 'vol-organisations',
        label: 'Ramifications trans-départementales voire trans-régionales',
        texte:
          "des organisations criminelles à l'œuvre avec des ramifications potentiellement trans-départementales voire trans-régionales",
        defaut: true,
      },
      {
        id: 'vol-transnational',
        label: 'Organisation transnationale',
        texte:
          "de l'organisation criminelle transnationale à l'œuvre avec des ramifications internationales",
      },
      {
        id: 'vol-victimes',
        label: 'Nombre de victimes',
        texte: 'du nombre de victimes',
        defaut: true,
      },
      {
        id: 'vol-auteurs',
        label: "Nombre d'auteurs impliqués",
        texte: "du nombre d'auteurs impliqués dans cette structure",
      },
      {
        id: 'vol-reseau',
        label: 'Organisation du réseau',
        texte: "de l'organisation du réseau criminel à l'origine de ces faits",
        defaut: true,
      },
      {
        id: 'vol-reseau-sophistique',
        label: 'Réseau sophistiqué',
        texte: "de l'organisation sophistiquée du réseau criminel à l'origine de ces faits",
      },
      {
        id: 'vol-fret',
        label: 'Enjeux économiques (fret routier)',
        texte: "des enjeux économiques considérables liés au vol de fret routier",
      },
    ],
  },

  extorsion: {
    motifs: [
      {
        id: 'extorsion-commanditaire',
        label: 'Commanditaire opérant à distance',
        texte: "de l'organisation criminelle à l'œuvre avec un commanditaire opérant à distance",
        defaut: true,
      },
      {
        id: 'extorsion-hierarchie',
        label: 'Hiérarchie donneurs d’ordre / exécutants',
        texte: "de la hiérarchie établie entre donneurs d'ordre et exécutants",
        defaut: true,
      },
      {
        id: 'extorsion-premeditation',
        label: 'Préméditation et concert',
        texte: 'de la préméditation des faits et de leur caractère concerté',
        defaut: true,
      },
      {
        id: 'extorsion-auteurs',
        label: "Nombre d'auteurs",
        texte: "du nombre d'auteurs impliqués dans ce réseau criminel structuré",
        defaut: true,
      },
      {
        id: 'extorsion-violences',
        label: 'Violences exercées sur les victimes',
        texte:
          "des enjeux majeurs en termes de sécurité publique et d'atteinte aux personnes face aux violences exercées sur les victimes",
        defaut: true,
      },
    ],
  },

  sequestration: {
    motifs: [
      {
        id: 'sequestration-atteinte',
        label: 'Atteinte à la liberté et à l’intégrité des personnes',
        texte:
          "des enjeux majeurs en termes de sécurité publique et d'atteinte aux personnes face aux violences exercées sur les victimes",
        defaut: true,
      },
      {
        id: 'sequestration-concert',
        label: 'Préméditation et concert',
        texte: 'de la préméditation des faits et de leur caractère concerté',
        defaut: true,
      },
    ],
  },

  proxenetisme: {
    motifs: [
      {
        id: 'proxo-reseau',
        label: 'Réseau structuré, pluralité d’auteurs',
        texte:
          "de l'existence apparente d'un réseau structuré d'exploitation de la prostitution mettant en cause une pluralité d'auteurs",
        defaut: true,
      },
      {
        id: 'proxo-vulnerabilite',
        label: 'Vulnérabilité des personnes prostituées',
        texte: 'de la particulière vulnérabilité des personnes prostituées',
        defaut: true,
      },
      {
        id: 'proxo-mineurs',
        label: 'Mise en cause de mineurs',
        texte: "de l'exposition et de la mise en cause alléguées de mineurs",
      },
      {
        id: 'proxo-ramifications',
        label: 'Ramifications trans-départementales',
        texte:
          "des ramifications potentiellement trans-départementales de cette organisation criminelle",
        defaut: true,
      },
    ],
  },

  traite: {
    motifs: [
      {
        id: 'traite-vulnerabilite',
        label: 'Vulnérabilité des victimes',
        texte: 'de la particulière vulnérabilité des victimes',
        defaut: true,
      },
      {
        id: 'traite-filieres',
        label: 'Structure organisée des filières',
        texte: "de la structure organisée des filières à l'origine de ces faits",
        defaut: true,
      },
    ],
    complement:
      "qui portent atteinte tant à la liberté qu'à la dignité humaine des personnes concernées",
  },

  escroquerie: {
    motifs: [
      {
        id: 'escro-transnational',
        label: 'Ramifications transnationales établies',
        texte:
          "des organisations criminelles à l'œuvre avec des ramifications transnationales établies",
        defaut: true,
      },
      {
        id: 'escro-prejudice',
        label: 'Montant du préjudice',
        texte:
          "du montant considérable des préjudices s'élevant à plusieurs centaines de milliers d'euros",
        defaut: true,
      },
      {
        id: 'escro-victimes',
        label: 'Nombre important de victimes',
        texte: 'du nombre important de victimes',
        defaut: true,
      },
      {
        id: 'escro-sophistication',
        label: 'Sophistication du réseau',
        texte: "de la sophistication du réseau criminel à l'origine de ces faits",
        defaut: true,
      },
      {
        id: 'escro-flux',
        label: 'Moyens numériques de dissimulation des flux',
        texte:
          "des moyens complexes et numériques mis en œuvre pour masquer les flux financiers frauduleux",
        defaut: true,
      },
    ],
    complement:
      "qui portent atteinte non seulement aux intérêts patrimoniaux des victimes mais également à la confiance dans les systèmes de paiement",
  },

  blanchiment: {
    motifs: [
      {
        id: 'blanchiment-mecanisme',
        label: 'Mécanisme de dissimulation (complices, virements, prête-noms)',
        texte:
          "de l'organisation criminelle de blanchiment à l'œuvre caractérisée par l'utilisation d'un réseau de complices pour la dissimulation des fonds, la multiplication des virements bancaires vers différents bénéficiaires pour fractionner et dissimuler l'origine illicite des capitaux, l'acquisition immobilière destinée à l'investissement des capitaux illégaux, l'utilisation de prête-noms et de comptes multiples pour créer une apparence de légalité aux flux financiers",
        defaut: true,
      },
      {
        id: 'blanchiment-economie',
        label: 'Infiltration de capitaux illicites dans l’économie légale',
        texte:
          "des enjeux en termes de sécurité économique et financière face à l'infiltration de capitaux illicites dans l'économie légale",
        defaut: true,
      },
    ],
  },

  recel: {
    motifs: [
      {
        id: 'recel-ecoulement',
        label: 'Filière d’écoulement organisée',
        texte: "de la structure organisée des filières d'écoulement à l'origine de ces faits",
        defaut: true,
      },
    ],
  },

  ile: {
    motifs: [
      {
        id: 'ile-reseaux',
        label: 'Réseaux pluri-départementaux voire internationaux',
        texte:
          "des réseaux criminels organisés opérant potentiellement sur plusieurs départements voire à l'international",
        defaut: true,
      },
      {
        id: 'ile-vulnerabilite',
        label: 'Vulnérabilité des personnes concernées',
        texte: 'de la vulnérabilité des personnes concernées',
        defaut: true,
      },
      {
        id: 'ile-filieres',
        label: 'Structure organisée des filières',
        texte:
          "de la structure organisée des filières d'immigration irrégulière à l'origine de ces faits",
        defaut: true,
      },
    ],
    complement:
      "qui portent atteinte tant aux règles nationales relatives à l'entrée et au séjour des étrangers qu'à la dignité humaine des personnes concernées",
  },

  ila: {
    motifs: [
      {
        id: 'ila-reseaux',
        label: 'Réseaux pluri-départementaux voire internationaux',
        texte:
          "des réseaux criminels organisés opérant potentiellement sur plusieurs départements voire à l'international",
        defaut: true,
      },
      {
        id: 'ila-dangerosite',
        label: 'Dangerosité des matériels',
        texte:
          'de la dangerosité des matériels concernés destinés à commettre des infractions violentes',
        defaut: true,
      },
      {
        id: 'ila-filieres',
        label: 'Structure organisée des filières',
        texte: "de la structure organisée des filières de trafic d'armes à l'origine de ces faits",
        defaut: true,
      },
    ],
    complement:
      "qui portent atteinte tant aux règles nationales relatives à la détention et au commerce des armes qu'à la sécurité publique et l'intégrité physique des personnes",
  },

  tabac: {
    motifs: [
      {
        id: 'tabac-organisations',
        label: 'Ramifications trans-départementales',
        texte:
          "des organisations à l'œuvre avec des ramifications potentiellement trans-départementales",
        defaut: true,
      },
      {
        id: 'tabac-auteurs',
        label: "Nombre d'auteurs impliqués",
        texte: "du nombre d'auteurs impliqués",
        defaut: true,
      },
      {
        id: 'tabac-quantites',
        label: 'Quantités saisies',
        texte: 'des quantités saisies',
      },
      {
        id: 'tabac-reseau',
        label: 'Organisation du réseau',
        texte: "de l'organisation du réseau à l'origine de ces faits",
        defaut: true,
      },
      {
        id: 'tabac-fiscal',
        label: 'Contournement de la réglementation fiscale',
        texte:
          'des enjeux économiques liés au contournement de la réglementation fiscale',
        defaut: true,
      },
    ],
  },

  corruption: {
    motifs: [
      {
        id: 'corruption-complicite',
        label: 'Complicité d’un agent, fuite d’informations sensibles',
        texte:
          "de l'organisation criminelle à l'œuvre impliquant la complicité d'un agent des forces de l'ordre dans la transmission d'informations sensibles relatives aux opérations judiciaires et enquêtes en cours",
        defaut: true,
      },
      {
        id: 'corruption-transdep',
        label: 'Caractère transdépartemental',
        texte: 'du caractère transdépartemental des faits',
        defaut: true,
      },
      {
        id: 'corruption-crypte',
        label: 'Communications cryptées, destruction de preuves',
        texte:
          "de la structure du réseau criminel avec ses moyens de communication cryptés et ses mécanismes de protection par la destruction de preuves",
        defaut: true,
      },
      {
        id: 'corruption-integrite',
        label: 'Intégrité de l’action publique',
        texte:
          "des enjeux en termes d'intégrité de l'action publique et de sécurité des opérations judiciaires",
        defaut: true,
      },
    ],
  },

  secret: {
    motifs: [
      {
        id: 'secret-integrite',
        label: 'Intégrité de l’action publique',
        texte:
          "des enjeux en termes d'intégrité de l'action publique et de sécurité des opérations judiciaires",
        defaut: true,
      },
      {
        id: 'secret-crypte',
        label: 'Communications cryptées, destruction de preuves',
        texte:
          "de la structure du réseau criminel avec ses moyens de communication cryptés et ses mécanismes de protection par la destruction de preuves",
      },
    ],
  },

  destructions: {
    motifs: [
      {
        id: 'destructions-securite',
        label: 'Sécurité publique',
        texte: "des enjeux majeurs en termes de sécurité publique",
        defaut: true,
      },
      {
        id: 'destructions-reseau',
        label: 'Organisation du réseau',
        texte: "de l'organisation du réseau criminel à l'origine de ces faits",
        defaut: true,
      },
    ],
  },

  association_malfaiteurs: {
    motifs: [
      {
        id: 'am-groupement',
        label: 'Groupement structuré et durable',
        texte:
          "de l'organisation du réseau criminel à l'origine de ces faits et de la préparation concertée des infractions projetées",
        defaut: true,
      },
    ],
  },
};

/**
 * Circonstances transversales, proposées quelle que soit la famille : elles
 * couvrent ce qui varie d'un dossier à l'autre à l'intérieur d'une même famille
 * (ampleur, victimes, dimension internationale, moyens employés).
 */
export const MOTIFS_TRANSVERSAUX: Motif[] = [
  {
    id: 'tr-transdep',
    label: 'Ramifications trans-départementales',
    texte: 'des ramifications potentiellement trans-départementales de cette organisation criminelle',
  },
  {
    id: 'tr-transnational',
    label: 'Ramifications transnationales établies',
    texte: "des ramifications transnationales établies de cette organisation criminelle",
  },
  {
    id: 'tr-auteurs',
    label: "Nombre d'auteurs impliqués",
    texte: "du nombre d'auteurs impliqués dans cette structure",
  },
  {
    id: 'tr-victimes',
    label: 'Nombre important de victimes',
    texte: 'du nombre important de victimes',
  },
  {
    id: 'tr-prejudice',
    label: 'Montant du préjudice',
    texte: "du montant considérable des préjudices causés",
  },
  {
    id: 'tr-chiffre',
    label: 'Moyens de communication chiffrés',
    texte: "de l'usage de moyens de communication chiffrés destinés à faire échec aux investigations",
  },
  {
    id: 'tr-mineurs',
    label: 'Mise en cause de mineurs',
    texte: "de la mise en cause de mineurs",
  },
  {
    id: 'tr-vulnerabilite',
    label: 'Vulnérabilité des victimes',
    texte: 'de la particulière vulnérabilité des victimes',
  },
  {
    id: 'tr-armes',
    label: 'Usage ou détention d’armes',
    texte: "de l'usage ou de la détention d'armes par les mis en cause",
  },
];

/** Tous les motifs disponibles pour une famille : les siens, puis les transversaux. */
export const motifsDisponibles = (famille: FamilleId | undefined): Motif[] => {
  const propres = famille ? MOTIFS_PAR_FAMILLE[famille]?.motifs || [] : [];
  const ids = new Set(propres.map((m) => m.id));
  return [...propres, ...MOTIFS_TRANSVERSAUX.filter((m) => !ids.has(m.id))];
};

/** Identifiants cochés par défaut pour une famille. */
export const motifsParDefaut = (famille: FamilleId | undefined): string[] =>
  motifsDisponibles(famille).filter((m) => m.defaut).map((m) => m.id);

/**
 * Enchaîne les circonstances comme le fait le magistrat dans ses actes :
 * séparées par des virgules, la dernière introduite par « ainsi que ».
 */
export const enchainerMotifs = (textes: string[]): string => {
  const items = textes.map((t) => t.trim()).filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ainsi que ${items[items.length - 1]}`;
};

/**
 * Élide « de » devant une voyelle ou un h muet, comme le fait le magistrat dans
 * ses actes : « des faits d'escroquerie », « des faits de vol en bande
 * organisée ». Sans cela l'acte porterait « des faits de escroquerie ».
 */
export const deQualification = (qualification: string): string => {
  const q = qualification.trim();
  if (!q) return '';
  const initiale = q
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .charAt(0)
    .toLowerCase();
  // Le « h » aspiré (« haine », « hold-up ») reste marginal dans les
  // qualifications visées ; l'élision est la règle pour les autres.
  return 'aeiouy'.includes(initiale) || initiale === 'h' ? `d'${q}` : `de ${q}`;
};

export interface MotivationParams {
  /** Qualification rappelée (« … concerne des faits de … »). */
  qualification: string;
  /** Quantum en toutes lettres (« dix ans »), ou vide si à compléter. */
  quantum: string;
  /** Textes des circonstances retenues, dans l'ordre d'affichage. */
  circonstances: string[];
  /** Complément de proportionnalité propre à la famille, s'il y en a un. */
  complement?: string;
}

/**
 * Compose le paragraphe complet d'autorisation d'accès aux données de trafic et
 * de localisation. Les valeurs manquantes laissent un repère explicite entre
 * crochets plutôt qu'un blanc silencieux : un acte incomplet doit se voir.
 */
export const buildMotivation = (p: MotivationParams): string => {
  const qualification = p.qualification.trim()
    ? deQualification(p.qualification)
    : 'de [qualification à préciser]';
  const quantum = p.quantum.trim() || "[quantum à compléter]";
  const circonstances = enchainerMotifs(p.circonstances) || '[circonstances à préciser]';
  const complement = p.complement?.trim() ? ` ${p.complement.trim()}` : '';
  return (
    "Autorisation de requérir l'accès aux données de trafic et de localisation "
    + `en ce que la procédure concerne des faits ${qualification}, faits punis de `
    + `${quantum} d'emprisonnement ; qu'en considération ${circonstances}, cette enquête `
    + "relève de la criminalité grave ; que l'accès à des données de trafic et de "
    + 'localisation est nécessaire aux investigations et proportionné à la gravité '
    + `des faits commis${complement}.`
  );
};
