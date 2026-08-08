// utils/documents/htmlEscape.ts
//
// Échappement HTML minimal partagé par les générateurs de trames documentaires
// (SAS, soit-transmis de clôture…). Ces sorties sont injectées dans des nœuds
// texte, donc l'échappement des seuls `&`, `<`, `>` suffit — inutile d'échapper
// les guillemets, aucun attribut n'étant construit à partir de ces valeurs.

/** Échappe les caractères HTML réservés d'une chaîne. */
export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Convertit les retours à la ligne d'un champ en sauts HTML. */
export const toHtmlLines = (s: string): string =>
  escapeHtml(s).replace(/\n/g, '<br />');
