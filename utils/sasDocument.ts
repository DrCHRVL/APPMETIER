// utils/sasDocument.ts
//
// Génération de la trame « SAS » — autorisation de poursuite d'actes en cours
// (art. 80-5 CPP), délivrée à l'ouverture d'une information pour éviter toute
// discontinuité des mesures : les actes autorisés peuvent se poursuivre pendant
// 48 heures à compter du réquisitoire introductif (cf. §3.1.1 de la circulaire
// du 8 avril 2019). Le délai se calcule en HEURES à compter de l'établissement
// du RI — d'où l'horodatage date + heure demandé à la génération (Crim.,
// 29 novembre 2022).
//
// Même mécanique que utils/clotureDocument.ts : trame éditable sauvegardée +
// données du dossier injectées à la génération. Deux sorties :
//  - buildSasText : texte brut (aperçu écran + presse-papiers)
//  - buildSasHtml : HTML mis en forme, destiné à downloadAsDocx (Word/.docx)
//
// Tout est généré côté client : aucune donnée ne sort de l'application.

import { Enquete } from '@/types/interfaces';
import { formatDateLong } from '@/utils/clotureDocument';

/**
 * Trame de rédaction éditable du SAS. Les libellés statiques (en-tête, objet,
 * visas, attendu générique, dispositif, signature) sont stockés et
 * modifiables ; les données du dossier (RI horodaté, préventions, listes des
 * mesures en cours, numéro d'enquête, date) sont injectées dynamiquement.
 */
export interface SasTemplate {
  // En-tête du parquet
  enteteJuridiction: string;
  enteteParquet: string;
  enteteService: string;
  // Objet de l'acte
  titre: string;
  reference: string;
  // Corps
  qualiteMagistrat: string;
  visa: string;
  beforePreventions: string;
  attendu: string;
  dispositif: string;
  beforeEcoutes: string;
  beforeGeolocs: string;
  // Signature
  lieu: string;
  signataire: string;
}

export const DEFAULT_SAS_TEMPLATE: SasTemplate = {
  enteteJuridiction: "Cour d'Appel d'Amiens — Tribunal Judiciaire d'Amiens",
  enteteParquet: 'Parquet du procureur de la République',
  enteteService: 'Section Criminalité Organisée',
  titre: "AUTORISATION DE POURSUITE D'ACTES EN COURS",
  reference: 'Article 80-5 du code de procédure pénale',
  qualiteMagistrat:
    'Le procureur de la République près le tribunal judiciaire d’AMIENS,',
  visa: 'Vu l’article 80-5 du code de procédure pénale,',
  beforePreventions: 'Concernant les préventions d’infraction suivantes :',
  attendu:
    'Attendu que la recherche de la manifestation de la vérité nécessite que les '
    + 'investigations en cours ne fassent l’objet d’aucune interruption, en ce que '
    + 'ces différentes mesures sont impératives pour [motivation au cas d’espèce : '
    + 'matérialiser les liens entre les suspects, cartographier les trajets des '
    + 'véhicules balisés, identifier les filières d’approvisionnement et de '
    + 'revente…] ;',
  dispositif:
    'AUTORISONS les officiers de police judiciaire, ou les agents de police '
    + 'judiciaire placés sous leur responsabilité, initialement chargés de '
    + 'l’enquête, à poursuivre, pendant une durée ne pouvant excéder '
    + 'quarante-huit heures à compter de la délivrance du réquisitoire '
    + 'introductif, sous réserve de la durée initialement fixée par le juge des '
    + 'libertés et de la détention, les opérations suivantes :',
  beforeEcoutes:
    '— les interceptions de correspondances émises par la voie des '
    + 'communications électroniques sur les lignes et/ou IMEI suivants :',
  beforeGeolocs: '— les géolocalisations en temps réel des objets suivants :',
  lieu: 'Amiens',
  signataire: 'Audran CHEVALIER, substitut,',
};

/**
 * Fusionne une trame sauvegardée (potentiellement partielle) avec les valeurs
 * par défaut, afin de rester rétro-compatible si des champs sont ajoutés.
 */
export const mergeSasTemplate = (
  saved: Partial<SasTemplate> | null | undefined,
): SasTemplate => ({ ...DEFAULT_SAS_TEMPLATE, ...(saved || {}) });

/**
 * Données propres au dossier saisies au moment de la génération (elles ne font
 * pas partie de la trame sauvegardée).
 */
export interface SasDossierData {
  /** Date du réquisitoire introductif (ISO aaaa-mm-jj) ; vide = à compléter. */
  dateRI: string;
  /** Heure du RI (ex. « 14H00 ») — le délai de 48 h court en heures. */
  heureRI: string;
  /** Préventions (une entrée par infraction, éventuellement multiligne). */
  preventions: string[];
}

/** Service ayant diligenté l'enquête (directeur d'enquête, à défaut services). */
const dilligentParLabel = (enquete: Enquete): string => {
  if (enquete.directeurEnquete && enquete.directeurEnquete.trim()) {
    return enquete.directeurEnquete.trim();
  }
  if (enquete.services && enquete.services.length > 0) {
    return enquete.services.join(', ');
  }
  return '';
};

// Le SAS ne vise que la POURSUITE d'actes : les mesures définitivement
// terminées, refusées, avortées ou pas encore autorisées n'y figurent pas.
const EXCLUDED_STATUTS = new Set<string>([
  'termine',
  'refuse',
  'pose_avortee',
  'autorisation_pending',
]);

const ecouteItems = (enquete: Enquete): string[] =>
  (enquete.ecoutes || [])
    .filter((e) => !EXCLUDED_STATUTS.has(e.statut))
    .map((e) => `${e.numero}${e.cible ? ` (${e.cible})` : ''}`);

const geolocItems = (enquete: Enquete): string[] =>
  (enquete.geolocalisations || [])
    .filter((g) => !EXCLUDED_STATUTS.has(g.statut))
    .map((g) => g.objet);

/** Date ISO (aaaa-mm-jj) → français long, sans décalage de fuseau. */
const formatDateFrIso = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  return formatDateLong(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
};

/** Ligne « Vu le réquisitoire introductif… » — RI horodaté (date + heure). */
const vuRiLine = (dossier: SasDossierData): string => {
  const date = dossier.dateRI.trim() ? formatDateFrIso(dossier.dateRI) : '[date]';
  const heure = dossier.heureRI.trim() || '[heure]';
  return `Vu le réquisitoire introductif en date du ${date} à ${heure},`;
};

const vuEnqueteLine = (enquete: Enquete): string => {
  const dili = dilligentParLabel(enquete);
  const numero = enquete.numero || '';
  return `Vu l’enquête n° ${numero}${dili ? ` diligentée par ${dili}` : ''},`;
};

/**
 * Version texte brut du SAS (aperçu écran + copie presse-papiers).
 */
export const buildSasText = (
  template: SasTemplate,
  enquete: Enquete,
  dossier: SasDossierData,
  dateStr: string = formatDateLong(),
): string => {
  const ecoutes = ecouteItems(enquete);
  const geolocs = geolocItems(enquete);

  const preventionsLines = dossier.preventions.length
    ? dossier.preventions.map((p) => `- ${p}`).join('\n\n')
    : '- (préventions à compléter)';
  const ecoutesLines = ecoutes.length
    ? ecoutes.map((l) => `• ${l}`).join('\n')
    : '• (aucune interception en cours renseignée)';
  const geolocsLines = geolocs.length
    ? geolocs.map((l) => `• ${l}`).join('\n')
    : '• (aucune géolocalisation en cours renseignée)';

  return [
    template.enteteJuridiction,
    template.enteteParquet,
    template.enteteService,
    '',
    template.titre,
    template.reference,
    '',
    template.qualiteMagistrat,
    template.visa,
    vuRiLine(dossier),
    vuEnqueteLine(enquete),
    '',
    template.beforePreventions,
    '',
    preventionsLines,
    '',
    template.attendu,
    '',
    template.dispositif,
    '',
    template.beforeEcoutes,
    ecoutesLines,
    '',
    template.beforeGeolocs,
    geolocsLines,
    '',
    `Fait à ${template.lieu}, le ${dateStr}`,
    '',
    'P/le procureur de la République,',
    template.signataire,
  ].join('\n');
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Convertit les retours à la ligne d'un champ en sauts HTML. */
const toHtmlLines = (s: string): string =>
  escapeHtml(s).replace(/\n/g, '<br />');

/**
 * Version HTML mise en forme du SAS, destinée à `downloadAsDocx`.
 * En-tête et objet centrés, listes à puces, bloc signature aligné à droite.
 */
export const buildSasHtml = (
  template: SasTemplate,
  enquete: Enquete,
  dossier: SasDossierData,
  dateStr: string = formatDateLong(),
): string => {
  const ecoutes = ecouteItems(enquete);
  const geolocs = geolocItems(enquete);

  const listOrNote = (items: string[], emptyNote: string): string =>
    items.length
      ? `<ul>${items.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : `<p style="margin-left:1.5em"><i>${escapeHtml(emptyNote)}</i></p>`;

  const preventionsHtml = dossier.preventions.length
    ? dossier.preventions
        .map((p) => `<p style="margin-left:1.5em">- ${toHtmlLines(p)}</p>`)
        .join('')
    : '<p style="margin-left:1.5em"><i>- (préventions à compléter)</i></p>';

  return [
    '<div style="text-align:center">',
    `<p><b>${escapeHtml(template.enteteJuridiction)}</b></p>`,
    `<p>${escapeHtml(template.enteteParquet)}</p>`,
    `<p>${escapeHtml(template.enteteService)}</p>`,
    '</div>',
    '<p>&nbsp;</p>',
    '<div style="text-align:center">',
    `<p style="font-size:14pt"><b>${escapeHtml(template.titre)}</b></p>`,
    `<p><i>${escapeHtml(template.reference)}</i></p>`,
    '</div>',
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.qualiteMagistrat)}</p>`,
    `<p>${toHtmlLines(template.visa)}</p>`,
    `<p><b>${escapeHtml(vuRiLine(dossier))}</b></p>`,
    `<p>${escapeHtml(vuEnqueteLine(enquete))}</p>`,
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.beforePreventions)}</p>`,
    preventionsHtml,
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.attendu)}</p>`,
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.dispositif)}</p>`,
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.beforeEcoutes)}</p>`,
    listOrNote(ecoutes, 'aucune interception en cours renseignée'),
    `<p>${toHtmlLines(template.beforeGeolocs)}</p>`,
    listOrNote(geolocs, 'aucune géolocalisation en cours renseignée'),
    '<p>&nbsp;</p>',
    '<div style="text-align:right">',
    `<p>Fait à ${escapeHtml(template.lieu)}, le ${escapeHtml(dateStr)}</p>`,
    '<p>&nbsp;</p>',
    '<p>P/le procureur de la République,</p>',
    `<p>${escapeHtml(template.signataire)}</p>`,
    '</div>',
  ].join('');
};

/** Nom de fichier proposé pour le téléchargement (sans extension). */
export const sasFileName = (enquete: Enquete): string => {
  const safe = (enquete.numero || 'enquete').replace(/[\\/:*?"<>|]+/g, '-');
  return `ST_JI_SAS_art_80-5_${safe}`;
};
