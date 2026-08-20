// utils/saisineDocument.ts
//
// Génération du SOIT-TRANSMIS DE SAISINE du procureur de la République : l'acte
// par lequel la section criminalité organisée saisit (ou co-saisit) un service
// d'enquête, énonce les chefs poursuivis et délivre en une fois les
// autorisations dont les enquêteurs ont besoin.
//
// Même mécanique que utils/sasDocument.ts et utils/clotureDocument.ts : une
// trame éditable et sauvegardée porte les formules figées, les données du
// dossier sont injectées à la génération. La sortie est le TEXTE de l'acte ;
// sa mise en forme officielle (bandeau du ministère, cadre du titre, signature)
// est celle de lib/web/acteExport.ts, partagée avec tous les actes rédigés —
// d'où l'export Word et PDF sans gabarit dédié.
//
// Ce qui est déterministe est calculé, ce qui relève de l'appréciation est
// proposé puis relu :
//   - les chefs poursuivis, leurs articles de définition et de répression et
//     leur numéro NATINF viennent du référentiel (aucune saisie) ;
//   - le régime de l'article 706-80 est proposé par la table des familles
//     (utils/saisine/familles.ts) et confirmé par le magistrat ;
//   - la motivation de criminalité grave est composée à partir de la
//     bibliothèque de circonstances (utils/saisine/motivations.ts), puis
//     librement réécrite avant génération.
//
// Tout est produit côté client : aucune donnée de dossier ne sort de
// l'application.

import { Enquete } from '@/types/interfaces';
import { formatDateLong } from '@/utils/clotureDocument';
import type { Regime706 } from '@/utils/saisine/familles';

/** Formules figées de l'acte, éditables et sauvegardées comme la trame du SAS. */
export interface SaisineTemplate {
  // En-tête du parquet
  enteteJuridiction: string;
  enteteParquet: string;
  enteteService: string;
  enteteTelephone: string;
  // Objet
  titre: string;
  // Corps
  formuleSaisine: string;
  formuleSaisineCoSaisine: string;
  formuleActes: string;
  formuleActesApresAttendus: string;
  autorisationRequisitions: string;
  autorisationLogiciels: string;
  autorisationEchanges: string;
  rappelTransport: string;
  clause706Applicable: string;
  clause706SaufGav: string;
  clause706NonApplicable: string;
  formuleDiligences: string;
  formuleSuivi: string;
  formuleSuiviParSection: string;
  // Signature
  lieu: string;
  signataire: string;
}

export const DEFAULT_SAISINE_TEMPLATE: SaisineTemplate = {
  enteteJuridiction: "Cour d'Appel d'Amiens — Tribunal Judiciaire d'Amiens",
  enteteParquet: 'Parquet du procureur de la République',
  enteteService: 'Section Criminalité Organisée',
  enteteTelephone: '',
  titre: 'SOIT-TRANSMIS DU PROCUREUR DE LA REPUBLIQUE',
  formuleSaisine:
    "J'ai l'honneur de vous prier de bien vouloir poursuivre l'enquête des chefs suivants :",
  formuleSaisineCoSaisine:
    "J'ai l'honneur de vous prier de bien vouloir poursuivre en co-saisine l'enquête des chefs suivants :",
  formuleActes:
    'Et ce notamment en procédant à tous actes, investigations, surveillances, '
    + 'auditions, réquisitions, constatations, transports, utiles à la manifestation '
    + 'de la vérité, étant précisé que le présent vaut :',
  formuleActesApresAttendus:
    'Que dès lors vous poursuivrez cette enquête en procédant à tous actes, '
    + 'investigations, surveillances, auditions, réquisitions, constatations, '
    + 'transports, utiles à la manifestation de la vérité, étant précisé que le '
    + 'présent vaut :',
  autorisationRequisitions:
    'Autorisation de toutes réquisitions utiles notamment sur les fondements des '
    + 'articles 77-1 et 77-1-1 du code de procédure pénale ;',
  autorisationLogiciels:
    'Autorisation de recours aux logiciels de rapprochement judiciaire tel que '
    + 'prévu aux articles 230-20, R40-39 et R40-40 du code de procédure pénale ; en '
    + 'faisant apparaître que les enquêteurs utilisateurs sont habilités au sens de '
    + "l'article D40-39 du code de procédure pénale ;",
  autorisationEchanges:
    "Autorisation d'échanges d'informations avec les pays partenaires dans le cadre "
    + "de la décision-cadre du Conseil de l'Union Européenne du 18 décembre 2006 sur "
    + "le fondement de l'article 695-9-40 du code de procédure pénale ;",
  rappelTransport:
    "Rappelons que sur le fondement de l'article 18 alinéa 3 du Code de procédure "
    + 'pénale, les officiers de police judiciaire peuvent se transporter sur '
    + "l'étendue du territoire national à l'effet d'y poursuivre leurs investigations "
    + 'et de procéder à des auditions, perquisitions et saisies, après en avoir '
    + 'informé le procureur de la République saisi de l’enquête. Le procureur de '
    + 'la République du tribunal judiciaire dans le ressort duquel les investigations '
    + "sont réalisées est également informé par l'officier de police judiciaire de ce "
    + 'transport.',
  clause706Applicable:
    "Les dispositions spécifiques de l'article 706-80 du même code sont également applicables.",
  clause706SaufGav:
    "Les dispositions spécifiques de l'article 706-80 du même code sont également "
    + 'applicables à l’exception des régimes dérogatoires concernant la durée de '
    + 'la garde à vue.',
  clause706NonApplicable:
    "Rappelons que les dispositions spécifiques de l'article 706-80 du même code ne "
    + 'sont pas applicables.',
  formuleDiligences: 'Je vous saurais gré de diligenter prioritairement les actes suivants :',
  formuleSuivi:
    'Je vous prie enfin de bien vouloir me tenir régulièrement informé des avancées de cette enquête.',
  formuleSuiviParSection:
    'Je vous prie enfin de bien vouloir me tenir régulièrement informé, directement '
    + "ou par le biais de la section criminalité organisée du Parquet d'Amiens, des "
    + 'avancées de cette enquête.',
  lieu: 'Amiens',
  signataire: 'CHEVALIER Audran, Substitut',
};

/** Fusion rétro-compatible d'une trame sauvegardée avec les valeurs par défaut. */
export const mergeSaisineTemplate = (
  saved: Partial<SaisineTemplate> | null | undefined,
): SaisineTemplate => ({ ...DEFAULT_SAISINE_TEMPLATE, ...(saved || {}) });

/** Données propres au dossier, saisies ou calculées au moment de la génération. */
export interface SaisineDossierData {
  /** Service(s) destinataire(s) : deux lignes en cas de co-saisine. */
  destinataires: string[];
  coSaisine: boolean;
  /** Lignes de visa (« Vu la procédure de … »), dans l'ordre. */
  visas: string[];
  /** Chefs poursuivis, un bloc par infraction (libellé + articles + NATINF). */
  preventions: string[];
  /** Situation des faits (« Commis le 26 mai 2024 à CAYEUX SUR MER (80) »). */
  commis: string;
  /** Attendus caractérisant la bande organisée (art. 132-71 C. pén.), si retenue. */
  attendusBandeOrganisee: string;
  /** Autorisations propres au dossier (bris de scellés, acquisition de matériel…). */
  autorisationsLibres: string[];
  /** Paragraphe d'accès aux données de trafic et de localisation, déjà composé. */
  motivationDonnees: string;
  /** Autorisation d'extraction d'un détenu, le cas échéant. */
  extractionDetenu: string;
  /** Régime de l'article 706-80 retenu. */
  regime706: Regime706;
  /** Mentionner expressément que le 706-80 n'est pas applicable (cas du tabac simple). */
  mentionner706Inapplicable: boolean;
  /** Actes prioritaires demandés au service, numérotés dans l'acte. */
  diligences: string[];
  /** Échéance d'une première actualisation (texte libre, ex. « le 17 août 2026 »). */
  echeance: string;
  /** Suivi passant par la section CO plutôt qu'en direct. */
  suiviParSection: boolean;
}

/** Données minimales pour un aperçu vide (ouverture du modal). */
export const EMPTY_SAISINE_DATA: SaisineDossierData = {
  destinataires: [],
  coSaisine: false,
  visas: [],
  preventions: [],
  commis: '',
  attendusBandeOrganisee: '',
  autorisationsLibres: [],
  motivationDonnees: '',
  extractionDetenu: '',
  regime706: 'droit_commun',
  mentionner706Inapplicable: false,
  diligences: [],
  echeance: '',
  suiviParSection: false,
};

/** Service saisi, à défaut de saisie : directeur d'enquête, sinon services. */
export const destinatairesParDefaut = (enquete: Enquete): string[] => {
  if (enquete.directeurEnquete?.trim()) return [enquete.directeurEnquete.trim()];
  if (enquete.services?.length) return [...enquete.services];
  return [];
};

/**
 * Visa proposé à l'ouverture : la procédure du service saisi, référencée par le
 * numéro de parquet à défaut du numéro d'enquête. Le numéro de procès-verbal du
 * service n'étant pas une donnée du dossier, le magistrat corrige la ligne.
 */
export const visaParDefaut = (enquete: Enquete): string => {
  const service = destinatairesParDefaut(enquete)[0] || '[service]';
  const numero = enquete.numeroParquet?.trim() || enquete.numero || '[n° de procédure]';
  return `Vu la procédure de ${service} au numéro de procédure ${numero}`;
};

/** Clause relative à l'article 706-80, selon le régime retenu. */
export const clause706 = (
  template: SaisineTemplate,
  regime: Regime706,
  mentionnerInapplicable: boolean,
): string => {
  if (regime === 'derogatoire') return template.clause706Applicable;
  if (regime === 'derogatoire_sauf_gav') return template.clause706SaufGav;
  return mentionnerInapplicable ? template.clause706NonApplicable : '';
};

/** Ajoute une ligne si elle est non vide, en la faisant précéder d'une ligne blanche. */
const pushBloc = (out: string[], texte: string): void => {
  const t = texte.trim();
  if (!t) return;
  out.push('', t);
};

/**
 * Texte complet du soit-transmis de saisine. Sert d'aperçu à l'écran, de contenu
 * de la copie presse-papiers, et de source aux exports Word et PDF via
 * lib/web/acteExport.ts (qui reconnaît l'en-tête, le titre et le bloc signature
 * à partir de ce même texte).
 */
export const buildSaisineText = (
  template: SaisineTemplate,
  dossier: SaisineDossierData,
  dateStr: string = formatDateLong(),
): string => {
  const out: string[] = [];

  // En-tête institutionnel : repris tel quel par le bandeau des exports.
  out.push(template.enteteJuridiction);
  out.push(template.enteteParquet);
  out.push(template.enteteService);
  if (template.enteteTelephone.trim()) out.push(template.enteteTelephone.trim());

  out.push('', template.titre);

  // Destinataire(s). « À ET » marque la co-saisine dans les actes du magistrat.
  const destinataires = dossier.destinataires.map((d) => d.trim()).filter(Boolean);
  out.push('', dossier.coSaisine && destinataires.length > 1 ? 'À ET' : 'À');
  if (destinataires.length) out.push(...destinataires);
  else out.push('[service destinataire]');

  const visas = dossier.visas.map((v) => v.trim()).filter(Boolean);
  if (visas.length) {
    out.push('');
    out.push(...visas);
  }

  pushBloc(out, dossier.coSaisine ? template.formuleSaisineCoSaisine : template.formuleSaisine);

  if (dossier.preventions.length) {
    for (const p of dossier.preventions) pushBloc(out, p);
  } else {
    pushBloc(out, '[chefs de poursuite à compléter]');
  }

  pushBloc(out, dossier.commis);

  // Attendus de bande organisée : ils précèdent et commandent la formule
  // d'actes (« Que dès lors vous poursuivrez cette enquête… »).
  const attendus = dossier.attendusBandeOrganisee.trim();
  if (attendus) {
    for (const par of attendus.split(/\n{2,}/)) pushBloc(out, par);
    pushBloc(out, template.formuleActesApresAttendus);
  } else {
    pushBloc(out, template.formuleActes);
  }

  // Autorisations, dans l'ordre constant des actes du magistrat.
  pushBloc(out, `- ${template.autorisationRequisitions}`);
  for (const a of dossier.autorisationsLibres) {
    const t = a.trim();
    if (t) pushBloc(out, t.startsWith('-') ? t : `- ${t}`);
  }
  pushBloc(out, `- ${template.autorisationLogiciels}`);
  pushBloc(out, `- ${template.autorisationEchanges}`);
  if (dossier.motivationDonnees.trim()) pushBloc(out, `- ${dossier.motivationDonnees.trim()}`);
  if (dossier.extractionDetenu.trim()) pushBloc(out, `- ${dossier.extractionDetenu.trim()}`);

  pushBloc(out, template.rappelTransport);
  pushBloc(out, clause706(template, dossier.regime706, dossier.mentionner706Inapplicable));

  const diligences = dossier.diligences.map((d) => d.trim()).filter(Boolean);
  if (diligences.length) {
    pushBloc(out, template.formuleDiligences);
    out.push('');
    diligences.forEach((d, i) => out.push(`${i + 1}. ${d}`));
  }

  if (dossier.echeance.trim()) {
    pushBloc(
      out,
      `Vous voudrez bien m'adresser une première actualisation de l'enquête, portant sur `
      + `les premiers éléments recueillis, pour ${dossier.echeance.trim()}.`,
    );
  }

  pushBloc(out, dossier.suiviParSection ? template.formuleSuiviParSection : template.formuleSuivi);

  out.push('', `Fait à ${template.lieu}, le ${dateStr}`);
  out.push('', 'P/Procureur de la République');
  out.push(template.signataire);

  return out.join('\n');
};

/** Nom de fichier proposé au téléchargement (sans extension). */
export const saisineFileName = (enquete: Enquete): string => {
  const safe = (enquete.numero || 'enquete').replace(/[\\/:*?"<>|]+/g, '-');
  return `ST_SAISINE_${safe}`;
};

// ── Chefs de poursuite ───────────────────────────────────────────────────────

/** Infraction telle que le ST la rappelle (voir utils/saisine/familles.ts). */
export interface PreventionSource {
  label: string;
  code?: string;
  articlesDefinition?: string;
  articlesRepression?: string;
}

/**
 * Bloc de prévention tel qu'il s'écrit dans les soit-transmis du magistrat :
 * la qualification, son numéro NATINF, puis les articles qui la définissent et
 * ceux qui la répriment. Les références viennent du référentiel, jamais d'une
 * saisie : c'est ce qui garantit qu'un article visé dans l'acte existe.
 */
export const preventionBloc = (i: PreventionSource): string => {
  const lignes: string[] = [];
  lignes.push(i.code ? `${i.label} (Natinf ${i.code})` : i.label);
  if (i.articlesDefinition?.trim()) lignes.push(`Définie par ${i.articlesDefinition.trim()}`);
  if (i.articlesRepression?.trim()) lignes.push(`Réprimée par ${i.articlesRepression.trim()}`);
  return lignes.join('\n');
};

/**
 * Fin de libellé commune à plusieurs qualifications, mot à mot depuis la droite
 * (« … DE STUPEFIANTS »). Rend un tableau vide si la factorisation viderait
 * l'un des libellés — mieux vaut répéter que produire un chef amputé.
 */
const finCommune = (labels: string[]): string[] => {
  const mots = labels.map((l) => l.trim().split(/\s+/));
  const commun: string[] = [];
  for (let k = 1; k <= Math.min(...mots.map((m) => m.length)) - 1; k++) {
    const candidat = mots[0][mots[0].length - k];
    if (!mots.every((m) => m[m.length - k] === candidat)) break;
    commun.unshift(candidat);
  }
  return commun;
};

/**
 * Chefs de poursuite regroupés comme le magistrat les écrit : les NATINF qui
 * partagent EXACTEMENT les mêmes articles de définition et de répression (les
 * cinq verbes du trafic de stupéfiants, les qualifications douanières du tabac)
 * forment un seul chef, dont les références ne sont citées qu'une fois. Le
 * regroupement est purement rédactionnel : aucune qualification n'est perdue,
 * et tous les numéros NATINF restent visés.
 */
export const preventionsBlocs = (infractions: PreventionSource[]): string[] => {
  const groupes = new Map<string, PreventionSource[]>();
  for (const i of infractions) {
    const cle = `${i.articlesDefinition || ''}|${i.articlesRepression || ''}`;
    // Sans article, pas de regroupement possible : chaque chef reste isolé.
    const k = cle === '|' ? `seul:${i.label}` : cle;
    groupes.set(k, [...(groupes.get(k) || []), i]);
  }

  return [...groupes.values()].map((groupe) => {
    if (groupe.length === 1) return preventionBloc(groupe[0]);

    const labels = groupe.map((i) => i.label.trim()).filter(Boolean);
    const fin = finCommune(labels);
    let libelle: string;
    if (fin.length) {
      const tetes = labels.map((l) => l.split(/\s+/).slice(0, -fin.length).join(' '));
      libelle = `${tetes.slice(0, -1).join(', ')} ET ${tetes[tetes.length - 1]} ${fin.join(' ')}`;
    } else {
      libelle = `${labels.slice(0, -1).join(', ')} ET ${labels[labels.length - 1]}`;
    }

    const codes = groupe.map((i) => i.code).filter(Boolean);
    return preventionBloc({
      label: libelle,
      code: undefined,
      articlesDefinition: groupe[0].articlesDefinition,
      articlesRepression: groupe[0].articlesRepression,
    }).replace(
      libelle,
      codes.length ? `${libelle} (Natinf ${codes.join(', ')})` : libelle,
    );
  });
};
