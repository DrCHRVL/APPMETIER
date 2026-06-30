// utils/clotureDocument.ts
//
// Génération de la trame « soit-transmis » de contrôle JLD (art. 706-95 CPP)
// à partir des données d'une enquête. Deux sorties :
//  - buildClotureText : texte brut (aperçu écran + presse-papiers)
//  - buildClotureHtml : HTML mis en forme, destiné à downloadAsDocx (Word/.docx)
//
// Tout est généré côté client : aucune donnée ne sort de l'application.

import { Enquete } from '@/types/interfaces';

/**
 * Trame de rédaction éditable du soit-transmis JLD. Les libellés statiques
 * (en-tête du parquet, objet, visas, signature) sont stockés et modifiables ;
 * les listes (écoutes, géolocalisations), le numéro d'enquête et la date sont
 * injectés dynamiquement à la génération.
 */
export interface ClotureTemplate {
  // En-tête du parquet
  enteteJuridiction: string;
  enteteParquet: string;
  enteteService: string;
  // Objet de l'acte
  titre: string;
  sousTitre: string;
  reference: string;
  // Corps
  qualiteMagistrat: string;
  visa: string;
  beforeEcoutes: string;
  beforeGeolocs: string;
  footer: string;
  // Signature
  lieu: string;
  signataire: string;
}

export const DEFAULT_CLOTURE_TEMPLATE: ClotureTemplate = {
  enteteJuridiction: "Cour d'Appel d'Amiens — Tribunal Judiciaire d'Amiens",
  enteteParquet: 'Parquet du procureur de la République',
  enteteService: 'Section Criminalité Organisée',
  titre: 'INFORMATION au JUGE DES LIBERTÉS ET DE LA DÉTENTION',
  sousTitre: 'Contrôle des actes autorisés',
  reference: 'Article 706-95 du code de procédure pénale',
  qualiteMagistrat:
    'Nous, CHEVALIER Audran, substitut du Procureur de la République près le tribunal judiciaire d’AMIENS,',
  visa: 'Vu les articles 706-95, 100-4 et 100-5 du code de procédure pénale,',
  beforeEcoutes:
    'METTONS A DISPOSITION les pièces correspondant aux interceptions de correspondance des lignes et/ou IMEI suivants :',
  beforeGeolocs:
    'METTONS A DISPOSITION les pièces correspondant aux géolocalisations des objets suivants :',
  footer:
    'Auprès de Monsieur le juge des libertés et de la détention et le prions de bien vouloir nous en faire retour revêtu de son visa.',
  lieu: 'Amiens',
  signataire: 'Audran CHEVALIER, substitut,',
};

/**
 * Fusionne une trame sauvegardée (potentiellement partielle / ancienne version
 * à 3 champs) avec les valeurs par défaut, afin de rester rétro-compatible.
 */
export const mergeClotureTemplate = (
  saved: Partial<ClotureTemplate> | null | undefined,
): ClotureTemplate => ({ ...DEFAULT_CLOTURE_TEMPLATE, ...(saved || {}) });

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

const ecouteItems = (enquete: Enquete): string[] =>
  (enquete.ecoutes || []).map(
    (e) => `${e.numero}${e.cible ? ` (${e.cible})` : ''}`,
  );

const geolocItems = (enquete: Enquete): string[] =>
  (enquete.geolocalisations || []).map((g) => g.objet);

/** Date du jour formatée en français long (ex. « 16 avril 2026 »). */
export const formatDateLong = (d: Date = new Date()): string =>
  d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const vuEnqueteLine = (enquete: Enquete): string => {
  const dili = dilligentParLabel(enquete);
  const numero = enquete.numero || '';
  return `Vu l’enquête n° ${numero}${dili ? ` diligentée par ${dili}` : ''},`;
};

/**
 * Version texte brut du soit-transmis (aperçu écran + copie presse-papiers).
 */
export const buildClotureText = (
  template: ClotureTemplate,
  enquete: Enquete,
  dateStr: string = formatDateLong(),
): string => {
  const ecoutes = ecouteItems(enquete);
  const geolocs = geolocItems(enquete);

  const ecoutesLines = ecoutes.length
    ? ecoutes.map((l) => `• ${l}`).join('\n')
    : '• (aucune interception renseignée)';
  const geolocsLines = geolocs.length
    ? geolocs.map((l) => `• ${l}`).join('\n')
    : '• (aucune géolocalisation renseignée)';

  return [
    template.enteteJuridiction,
    template.enteteParquet,
    template.enteteService,
    '',
    template.titre,
    template.sousTitre,
    template.reference,
    '',
    template.qualiteMagistrat,
    template.visa,
    vuEnqueteLine(enquete),
    '',
    template.beforeEcoutes,
    ecoutesLines,
    '',
    template.beforeGeolocs,
    geolocsLines,
    '',
    template.footer,
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

/** Convertit les retours à la ligne d'un champ en paragraphes/sauts HTML. */
const toHtmlLines = (s: string): string =>
  escapeHtml(s).replace(/\n/g, '<br />');

/**
 * Version HTML mise en forme du soit-transmis, destinée à `downloadAsDocx`.
 * En-tête et objet centrés, listes à puces, bloc signature aligné à droite.
 */
export const buildClotureHtml = (
  template: ClotureTemplate,
  enquete: Enquete,
  dateStr: string = formatDateLong(),
): string => {
  const ecoutes = ecouteItems(enquete);
  const geolocs = geolocItems(enquete);

  const listOrNote = (items: string[], emptyNote: string): string =>
    items.length
      ? `<ul>${items.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
      : `<p style="margin-left:1.5em"><i>${escapeHtml(emptyNote)}</i></p>`;

  return [
    '<div style="text-align:center">',
    `<p><b>${escapeHtml(template.enteteJuridiction)}</b></p>`,
    `<p>${escapeHtml(template.enteteParquet)}</p>`,
    `<p>${escapeHtml(template.enteteService)}</p>`,
    '</div>',
    '<p>&nbsp;</p>',
    '<div style="text-align:center">',
    `<p style="font-size:14pt"><b>${escapeHtml(template.titre)}</b></p>`,
    `<p><b>${escapeHtml(template.sousTitre)}</b></p>`,
    `<p><i>${escapeHtml(template.reference)}</i></p>`,
    '</div>',
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.qualiteMagistrat)}</p>`,
    `<p>${toHtmlLines(template.visa)}</p>`,
    `<p>${escapeHtml(vuEnqueteLine(enquete))}</p>`,
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.beforeEcoutes)}</p>`,
    listOrNote(ecoutes, 'aucune interception renseignée'),
    `<p>${toHtmlLines(template.beforeGeolocs)}</p>`,
    listOrNote(geolocs, 'aucune géolocalisation renseignée'),
    '<p>&nbsp;</p>',
    `<p>${toHtmlLines(template.footer)}</p>`,
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
export const clotureFileName = (enquete: Enquete): string => {
  const safe = (enquete.numero || 'enquete').replace(/[\\/:*?"<>|]+/g, '-');
  return `ST_JLD_Cloture_${safe}`;
};
