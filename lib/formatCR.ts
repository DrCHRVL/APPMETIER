/**
 * Utilitaires de formatage des comptes-rendus.
 *
 * Partagé entre la carte d'aperçu (EnquetePreview / ExpandableCR) et le rendu
 * interne de la liste de CR (CompteRenduSection). Centralise la conversion
 * markdown-léger → HTML et le nettoyage des artefacts de presse-papier Office
 * (marqueurs <!-- StartFragment --> / <!-- EndFragment -->, espaces insécables,
 * balises vides Word/Outlook).
 */

// Supprime les bruits propres au presse-papier Office/Windows
export const stripClipboardNoise = (html: string): string => {
  if (!html) return '';
  return html
    // Commentaires HTML (StartFragment / EndFragment / if mso ...)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Balises Office résiduelles (o:p, w:*, m:*, xml)
    .replace(/<\/?(?:o:p|w:[a-z]+|m:[a-z]+|xml)[^>]*>/gi, '')
    // span/font vides laissés par Word
    .replace(/<(span|font)[^>]*>\s*<\/\1>/gi, '');
};

// Détecte si le texte est déjà du HTML (nouveau format WYSIWYG) ou du markdown léger
const looksLikeHtml = (text: string): boolean => /<[a-z][\s\S]*?>/i.test(text);

/**
 * Convertit le contenu stocké d'un CR en HTML affichable.
 * - Si c'est déjà du HTML (nouveau format WYSIWYG) : on nettoie les artefacts
 *   de presse-papier et on le renvoie tel quel.
 * - Sinon (ancien format markdown léger) : échappe les caractères HTML puis
 *   applique les règles **gras**, __souligné__, ==surligné==, listes et sauts
 *   de ligne.
 */
export const renderFormattedText = (text: string): string => {
  if (!text) return '';
  if (looksLikeHtml(text)) {
    return stripClipboardNoise(text);
  }
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    .replace(/==(.*?)==/g, '<mark style="background:#fef08a;padding:1px 2px">$1</mark>')
    .replace(/^- (.*)$/gm, '• $1')
    .replace(/\n/g, '<br>');
};
