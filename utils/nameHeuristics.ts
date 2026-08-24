// utils/nameHeuristics.ts
//
// Repère, dans une liste de noms de mis en cause (export cartographie), les
// entrées qui ne sont PAS un nom/prénom de personne physique exploitable tel
// quel : placeholder (« X »), description (« Femme blonde »), personne
// morale (« SARL … »), précision ou date accolée au nom (« … 1991 »,
// « … (compagne Nabil) »), surnom entre guillemets, etc.
//
// Sert à trier l'export avant réutilisation directe (ex. mots-clés d'une
// règle d'alerte messagerie) : les noms exploitables d'un côté, ce qui
// mérite une relecture manuelle de l'autre — sans jamais perdre d'entrée,
// juste en la signalant.
//
// Volontairement CONSERVATEUR : on ne signale que sur un indice fort (chiffre,
// ponctuation, forme sociale, mot descriptif) plutôt que sur l'absence de
// correspondance à un motif « Prénom Nom ». Un patronyme seul et sans
// prénom connu (« BLONDEL »), une casse inhabituelle ou un nom à
// consonance étrangère ne sont PAS signalés — seule une anomalie
// caractérisée l'est, pour éviter de noyer les vraies alertes sous du bruit.
//
// Logique pure (aucun import de valeur) pour rester testable en isolation,
// cf. scripts/nameHeuristics.test.mjs.

export interface NameCheck {
  /** Faux si l'entrée ne ressemble pas à un nom/prénom exploitable tel quel. */
  looksLikeName: boolean;
  /** Motif du signalement — chaîne vide quand looksLikeName est vrai. */
  reason: string;
}

// Formes sociales usuelles — quasi toujours une personne morale plutôt qu'un
// mis en cause. Recherché en mot entier (bornes \b) pour ne jamais déclencher
// sur un patronyme qui contiendrait la sous-chaîne (ex. "SASSI", "SACKO").
const LEGAL_ENTITY_SUFFIXES = ['SARL', 'SAS', 'SASU', 'SCI', 'EURL', 'EARL', 'SCEA', 'SNC', 'GIE', 'SDC'];

// Mots qui trahissent une description ou un statut plutôt qu'un nom propre.
// Comparés en minuscules sur l'entrée mise en minuscule.
const DESCRIPTIVE_KEYWORDS = [
  'individu', 'identifié', 'identifie', 'inconnu', 'inconnue',
  'femme', 'homme', 'nourrice', 'coordinateur', 'coordinatrice',
  'rabatteur', 'complice', 'squatté', 'squatte', 'squattée', 'squattee',
  'compagne', 'compagnon', 'surnommé', 'surnomme', 'surnommée', 'surnommee',
  'frères', 'freres', 'sœurs', 'soeurs', 'garde les', "né le", "née le",
  "qu'elle nomme", "qu'il nomme", 'alias',
];

/**
 * Évalue si `raw` ressemble à un nom/prénom de personne physique exploitable
 * directement (ex. comme mot-clé de règle d'alerte).
 */
export function checkLooksLikeName(raw: string): NameCheck {
  const name = (raw || '').trim();
  if (!name) return { looksLikeName: false, reason: 'entrée vide' };

  // Initiale(s) seule(s) : convention classique pour désigner une personne
  // non identifiée dans un PV ("X", "HX"...).
  if (/^[A-ZÀ-Ý]{1,3}$/.test(name)) {
    return { looksLikeName: false, reason: 'initiale(s) seule(s) — personne non identifiée' };
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
  if (/["“”]/.test(name)) {
    return { looksLikeName: false, reason: 'surnom entre guillemets' };
  }

  const upper = name.toUpperCase();
  for (const suf of LEGAL_ENTITY_SUFFIXES) {
    if (new RegExp(`\\b${suf}\\b`).test(upper)) {
      return { looksLikeName: false, reason: 'personne morale (société)' };
    }
  }

  const lower = name.toLowerCase();
  const hit = DESCRIPTIVE_KEYWORDS.find(kw => lower.includes(kw));
  if (hit) {
    return { looksLikeName: false, reason: `description plutôt qu'un nom ("${hit}")` };
  }

  // Un seul « bloc » alphabétique très court (ni espace, ni tiret, ni
  // apostrophe) : trop court pour être exploitable tel quel (coquille,
  // fragment). Un patronyme seul mais normal ("BLONDEL", "CETIN") reste
  // au-dessus de ce seuil et n'est donc pas signalé.
  if (!/[\s'-]/.test(name) && name.length <= 3) {
    return { looksLikeName: false, reason: 'trop court pour être exploitable' };
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
