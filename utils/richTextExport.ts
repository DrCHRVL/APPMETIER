// utils/richTextExport.ts
//
// Helpers d'export de contenu HTML riche, sans dépendance externe.
// - copyHtmlToClipboard : pousse le HTML dans le presse-papiers (avec
//   text/plain en repli) ; un coller dans Word préserve la mise en forme.
// - downloadAsDoc : génère un fichier .doc (HTML + en-tête MS Word) que
//   Word ouvre nativement en conservant gras / titres / listes / couleurs.

const escapeXml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Copie un fragment HTML dans le presse-papiers en exposant à la fois
 * `text/html` et `text/plain` pour que les éditeurs (Word, Outlook…)
 * récupèrent la version formatée.
 */
export const copyHtmlToClipboard = async (html: string): Promise<boolean> => {
  const plain = stripHtml(html);
  try {
    if (
      typeof window !== 'undefined' &&
      navigator.clipboard &&
      typeof window.ClipboardItem !== 'undefined'
    ) {
      const item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // Tombe sur le fallback ci-dessous
  }
  // Fallback execCommand : sélectionner un noeud avec le HTML puis copier
  try {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.innerHTML = html;
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    document.body.removeChild(div);
    return ok;
  } catch {
    return false;
  }
};

/** Retire les balises HTML pour générer une version texte brut. */
export const stripHtml = (html: string): string => {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, '');
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
};

/**
 * Construit le HTML « complet » envoyé aux convertisseurs Word/.doc, avec
 * une feuille de style minimale alignée sur la mise en forme attendue
 * dans un réquisitoire (Calibri 11pt, titres calibrés, listes propres).
 */
const buildWordHtml = (bodyHtml: string, title: string): string => {
  const head = `
    <meta charset="utf-8" />
    <title>${escapeXml(title)}</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
      h1 { font-size: 16pt; }
      h2 { font-size: 14pt; }
      h3 { font-size: 12pt; }
      ul, ol { margin-left: 1.5em; }
      blockquote { border-left: 3px solid #ccc; padding-left: 12px; color: #555; }
      hr { border: none; border-top: 1px solid #999; margin: 16pt 0; }
      .acte-bloc { page-break-inside: avoid; margin-bottom: 18pt; }
      .acte-titre { font-weight: 700; font-size: 13pt; margin-bottom: 2pt; }
      .acte-date { color: #666; font-size: 10pt; margin-bottom: 4pt; }
    </style>
  `;
  return (
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
    + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
    + 'xmlns="http://www.w3.org/TR/REC-html40">'
    + `<head>${head}</head><body>${bodyHtml}</body></html>`
  );
};

/**
 * Télécharge un vrai fichier .docx via html-docx-js (Word natif).
 * Préserve gras / italique / titres / listes / couleurs / liens.
 * Tombe en .doc si la lib n'est pas installée (cas dégradé).
 */
export const downloadAsDocx = async (
  bodyHtml: string,
  filename: string,
  title?: string,
): Promise<void> => {
  const fullTitle = title || filename;
  const html = buildWordHtml(bodyHtml, fullTitle);
  try {
    // Import dynamique pour ne pas charger la lib si l'utilisateur n'exporte pas.
    const mod: any = await import('html-docx-js/dist/html-docx');
    const htmlDocx = mod?.default || mod;
    const blob: Blob = htmlDocx.asBlob(html);
    triggerDownload(
      blob,
      filename.endsWith('.docx') ? filename : `${filename}.docx`,
    );
  } catch (err) {
    console.warn('html-docx-js indisponible, fallback .doc :', err);
    downloadAsDoc(bodyHtml, filename, title);
  }
};

/**
 * Télécharge un fichier .doc compatible Word à partir d'un fragment HTML.
 * Utilise l'astuce historique « HTML déguisé en .doc » : Word reconnaît
 * l'en-tête mso et préserve la mise en forme (titres, gras, listes,
 * couleurs) sans nécessiter de lib docx côté client. Conservé comme
 * fallback de downloadAsDocx.
 */
export const downloadAsDoc = (
  bodyHtml: string,
  filename: string,
  title?: string,
): void => {
  const html = buildWordHtml(bodyHtml, title || filename);
  // BOM utf-8 en tête → Word détecte correctement l'encodage
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  triggerDownload(blob, filename.endsWith('.doc') ? filename : `${filename}.doc`);
};

/** Variante : téléchargement HTML pur (universel, plus léger). */
export const downloadAsHtml = (
  bodyHtml: string,
  filename: string,
  title?: string,
): void => {
  const html =
    '<!doctype html><html lang="fr"><head><meta charset="utf-8" />'
    + `<title>${escapeXml(title || filename)}</title></head>`
    + `<body>${bodyHtml}</body></html>`;
  const blob = new Blob([html], { type: 'text/html' });
  triggerDownload(blob, filename.endsWith('.html') ? filename : `${filename}.html`);
};

/** Déclenche un téléchargement navigateur d'un Blob donné. */
const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
