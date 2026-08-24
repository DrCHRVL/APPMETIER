// utils/nameHeuristics.ts
//
// Repère, dans une liste de noms de mis en cause (export cartographie), les
// entrées qui ne sont PAS exploitables telles quelles comme nom/prénom
// exportable : placeholder (« X »), description (« Femme blonde »), personne
// morale (« SARL … »), précision ou date accolée au nom (« … 1991 »,
// « … (compagne Nabil) »), surnom entre guillemets, OU nom/prénom seul sans
// l'autre pour le distinguer d'un homonyme (« BLONDEL », « Michel »).
//
// Sert à trier l'export avant réutilisation directe (ex. mots-clés d'une
// règle d'alerte messagerie) : les entrées exploitables d'un côté, ce qui
// mérite une relecture manuelle de l'autre — sans jamais perdre d'entrée,
// juste en la signalant. Un nom/prénom seul reste un mis en cause parfaitement
// valide sur la carto ; il est signalé ICI uniquement parce qu'utilisé seul
// comme mot-clé d'alerte, il déclencherait sur n'importe quel homonyme sans
// rapport avec le dossier.
//
// Volontairement CONSERVATEUR au-delà de ce cas : on ne signale que sur un
// indice fort (chiffre, ponctuation, forme sociale, mot descriptif, absence
// totale d'espace) plutôt que sur l'absence de correspondance à un motif
// « Prénom Nom ». Une casse inhabituelle ou un nom à consonance étrangère ne
// sont PAS signalés — seule une anomalie caractérisée l'est, pour éviter de
// noyer les vraies alertes sous du bruit.
//
// Logique pure (aucun import de valeur) pour rester testable en isolation,
// cf. scripts/nameHeuristics.test.mjs.

export interface NameCheck {
  /** Faux si l'entrée n'est pas exploitable telle quelle (pas un nom, ou trop
   *  ambiguë pour servir de mot-clé sans faux positifs). */
  looksLikeName: boolean;
  /** Motif du signalement — chaîne vide quand looksLikeName est vrai. */
  reason: string;
}

// Formes sociales usuelles — quasi toujours une personne morale plutôt qu'un
// mis en cause. Toujours écrites tout en capitales dans une PV (jamais en
// casse naturelle) : recherchées en mot entier ET en casse exacte, pour ne
// jamais déclencher ni sur un patronyme qui contiendrait la sous-chaîne (ex.
// "SASSI", "SACKO") ni sur un prénom qui coïncide avec le sigle en casse
// normale (ex. "Earl", prénom antillais/anglophone plausible, vs "EARL").
const LEGAL_ENTITY_SUFFIXES = ['SARL', 'SAS', 'SASU', 'SCI', 'EURL', 'EARL', 'SCEA', 'SNC', 'GIE', 'SDC'];

// Mots qui trahissent une description ou un statut plutôt qu'un nom propre.
// Comparés en minuscules sur l'entrée mise en minuscule, en mot entier (cf.
// hasWordBoundaryMatch) pour ne jamais déclencher sur un patronyme qui
// contiendrait la sous-chaîne (ex. "homme" dans "BONHOMME", "LHOMME" ; "né
// le" dans "René LEFEBVRE").
const DESCRIPTIVE_KEYWORDS = [
  'individu', 'identifié', 'identifie', 'inconnu', 'inconnue',
  'femme', 'homme', 'nourrice', 'coordinateur', 'coordinatrice',
  'rabatteur', 'complice', 'squatté', 'squatte', 'squattée', 'squattee',
  'compagne', 'compagnon', 'surnommé', 'surnomme', 'surnommée', 'surnommee',
  'frères', 'freres', 'sœurs', 'soeurs', 'garde les', "né le", "née le",
  "qu'elle nomme", "qu'il nomme", 'alias',
];

// Caractère de mot au sens large (lettres accentuées françaises incluses) —
// le \b natif de JS ne traite que [A-Za-z0-9_], ce qui le rend inutilisable
// tel quel dès qu'un mot-clé touche une lettre accentuée ("née", "sœurs").
function isWordChar(c: string): boolean {
  return /[a-zà-ÿœæ0-9]/i.test(c);
}

/** `needle` apparaît dans `haystack` (déjà en minuscules) en mot entier, au
 *  sens large défini par `isWordChar` (donc y compris pour un `needle` à
 *  plusieurs mots comme "né le" — seules ses deux extrémités comptent). */
function hasWordBoundaryMatch(haystack: string, needle: string): boolean {
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    const before = idx === 0 ? '' : haystack[idx - 1];
    const after = haystack[idx + needle.length] || '';
    if (!isWordChar(before) && !isWordChar(after)) return true;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return false;
}

// Convention d'anonymisation "civilité + initiale seule" ("Monsieur X",
// "Madame Y", "M. X", "Mme Z") — aussi répandue que l'initiale nue ("X").
const CIVILITY_PLUS_INITIAL = /^(?:m\.?|mr|monsieur|mme|madame|mlle|mademoiselle)\s+[a-zà-ý]{1,3}$/i;

/**
 * Évalue si `raw` ressemble à un nom/prénom de personne physique exploitable
 * directement (ex. comme mot-clé de règle d'alerte).
 */
export function checkLooksLikeName(raw: string): NameCheck {
  const name = (raw || '').trim();
  if (!name) return { looksLikeName: false, reason: 'entrée vide' };

  if (CIVILITY_PLUS_INITIAL.test(name)) {
    return { looksLikeName: false, reason: 'civilité suivie d\'une initiale seule — personne non identifiée' };
  }
  if (name.includes('?')) {
    return { looksLikeName: false, reason: "point d'interrogation — identité incertaine" };
  }
  if (/\d/.test(name)) {
    return { looksLikeName: false, reason: 'contient un chiffre (date, âge…)' };
  }
  if (/[()]/.test(name)) {
    return { looksLikeName: false, reason: 'précision entre parenthèses accolée au nom' };
  }
  if (/["“”«»]/.test(name)) {
    return { looksLikeName: false, reason: 'surnom entre guillemets' };
  }

  for (const suf of LEGAL_ENTITY_SUFFIXES) {
    if (new RegExp(`\\b${suf}\\b`).test(name)) {
      return { looksLikeName: false, reason: 'personne morale (société)' };
    }
  }

  const lower = name.toLowerCase();
  const hit = DESCRIPTIVE_KEYWORDS.find(kw => hasWordBoundaryMatch(lower, kw));
  if (hit) {
    return { looksLikeName: false, reason: `description plutôt qu'un nom ("${hit}")` };
  }

  // Aucun espace : un seul mot, donc nom OU prénom seul (ou une coquille de
  // saisie type "ffef", ou un placeholder type "X"/"HX"), jamais les deux.
  // Reste un mis en cause valide sur la carto, mais signalé pour ne pas finir
  // tel quel comme mot-clé d'alerte — "BLONDEL" ou "Michel" seuls
  // déclencheraient sur tout homonyme.
  if (!/\s/.test(name)) {
    return {
      looksLikeName: false,
      reason: 'nom ou prénom seul — homonymes possibles, à ne pas utiliser seul comme mot-clé',
    };
  }

  return { looksLikeName: true, reason: '' };
}

/** Sépare une liste de noms en (noms exploitables, entrées à vérifier). */
export function splitByNameLikeness(names: string[]): {
  valid: string[];
  flagged: Array<{ name: string; reason: string }>;
} {
  const valid: string[] = [];
  const flagged: Array<{ name: string; reason: string }> = [];
  for (const n of names) {
    const check = checkLooksLikeName(n);
    if (check.looksLikeName) valid.push(n);
    else flagged.push({ name: n, reason: check.reason });
  }
  return { valid, flagged };
}

/**
 * Nettoyage léger pour réemploi direct comme mot-clé (ex. règle d'alerte
 * messagerie) : espaces multiples ou tabulations réduits à un seul espace,
 * ponctuation parasite de bord retirée (virgule, tiret, point isolés en
 * début/fin — artefacts fréquents d'une saisie ou d'un copier-coller
 * imparfait). Ne touche jamais à l'intérieur du nom.
 */
export function cleanForKeywordUse(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;.\-–—]+/, '')
    .replace(/[\s,;.\-–—]+$/, '')
    .trim();
}
