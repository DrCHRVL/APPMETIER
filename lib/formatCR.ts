/**
 * Utilitaires de formatage des comptes-rendus.
 *
 * Partagé entre la carte d'aperçu (EnquetePreview / ExpandableCR) et le rendu
 * interne de la liste de CR (CompteRenduSection). Centralise la conversion
 * markdown-léger → HTML et le nettoyage des artefacts de presse-papier Office
 * (marqueurs <!-- StartFragment --> / <!-- EndFragment -->, espaces insécables,
 * balises vides Word/Outlook, conditionnels MSO, balises namespacées o:/w:/m:…).
 */

// Supprime les bruits propres au presse-papier Office/Windows
export const stripClipboardNoise = (html: string): string => {
  if (!html) return '';
  return html
    // Commentaires HTML (StartFragment / EndFragment / if mso ...)
    .replace(/<!--[\s\S]*?-->/g, '')
    // Conditionnels MSO orphelins (downlevel-revealed) : <![if …]> / <![endif]>
    .replace(/<!\[if[^\]]*\][\s\S]*?(?:<!\[endif\]>|$)/gi, '')
    .replace(/<!\[endif\]-?-?>?/gi, '')
    // Balises Office/Word résiduelles : <o:…>, <w:…>, <m:…>, <v:…>, <st1:…>, <xml>
    .replace(/<\/?(?:o|w|m|v|st\d+):[a-z][\w-]*[^>]*>/gi, '')
    .replace(/<\/?xml[^>]*>/gi, '')
    // Résidus textuels laissés par les conditionnels MSO après dé-tagging
    .replace(/\[if\s+[!a-z0-9\s><=.-]*\]>?/gi, '')
    .replace(/<!\[endif\]/gi, '')
    // span/font vides laissés par Word
    .replace(/<(span|font)[^>]*>\s*<\/\1>/gi, '');
};

// ── Détection de HTML brut ou de HTML échappé ──────────────────────────────
// `<[a-z]` couvre le HTML normal. `&lt;[a-z!]` couvre les anciens CR stockés
// avec entités (où `<` est devenu `&lt;`) — sans ça, ce contenu tombe dans la
// branche markdown qui re-échappe `&` → `&amp;` et affiche littéralement
// « <!--[if gte mso 9]> » à l'écran.
const looksLikeHtml = (text: string): boolean =>
  /<[a-z][\s\S]*?>/i.test(text) || /&lt;[!a-z]/i.test(text);

// Désescape une seule passe d'entités HTML sur les marqueurs MSO détectés.
// Utilisé pour « réparer » les CR historiquement stockés avec entités avant
// de les nettoyer via stripClipboardNoise.
const decodeMsoEntities = (text: string): string => {
  if (!/&lt;(?:!--|[owmv]:|xml|\/[owmv]:|\/xml)/i.test(text)) return text;
  const decoded = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return stripClipboardNoise(decoded);
};

/**
 * Convertit le contenu stocké d'un CR en HTML affichable.
 * - Si c'est déjà du HTML (nouveau format WYSIWYG) : on nettoie les artefacts
 *   de presse-papier et on le renvoie tel quel.
 * - Si c'est du HTML échappé (CR historique stocké avec entités) : on
 *   désescape les marqueurs MSO puis on nettoie.
 * - Sinon (ancien format markdown léger) : on nettoie les éventuels résidus,
 *   on échappe les caractères HTML puis on applique les règles **gras**,
 *   __souligné__, ==surligné==, listes et sauts de ligne.
 */
export const renderFormattedText = (text: string): string => {
  if (!text) return '';
  // Nettoyage entités-échappées en amont (CR historiques).
  const pre = decodeMsoEntities(text);
  if (looksLikeHtml(pre)) {
    return stripClipboardNoise(pre);
  }
  // Défense en profondeur : certains CR markdown anciens peuvent contenir des
  // restes MSO mal découpés — on les retire AVANT l'échappement pour éviter
  // qu'ils ne soient re-rendus sous forme de texte visible.
  const cleaned = stripClipboardNoise(pre);
  const escaped = cleaned
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
