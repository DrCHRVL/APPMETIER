// Familles d'infractions NATINF fréquemment retenues ensemble.
//
// Lorsqu'un utilisateur saisit un code appartenant à une famille, l'application
// peut proposer d'ajouter les autres codes de la même famille (cf. composant
// NatinfGroupSuggestions). Cela évite d'oublier un chef « jumeau » classique —
// typiquement le quatuor du trafic de stupéfiants (transport / détention /
// offre-cession / acquisition), presque toujours visés conjointement.
//
// Pour ajouter une famille : compléter NATINF_GROUPS ci-dessous. Les codes
// doivent exister dans le référentiel (data/natinf) pour être résolus en
// libellé ; un code inconnu reste proposé sous la forme « NATINF <code> ».

export interface NatinfGroup {
  /** Identifiant stable (sert de clé d'affichage / de rejet de la suggestion). */
  id: string;
  /** Libellé de la famille affiché à l'utilisateur. */
  label: string;
  /** Codes NATINF de la famille (au moins 2). */
  codes: string[];
}

export const NATINF_GROUPS: NatinfGroup[] = [
  {
    id: 'stupefiants-trafic',
    label: 'Trafic de stupéfiants',
    // Transport / Détention / Offre ou cession / Acquisition non autorisés.
    codes: ['7990', '7991', '7992', '7993'],
  },
];

export interface NatinfGroupSuggestion {
  group: NatinfGroup;
  /** Codes de la famille pas encore sélectionnés. */
  missing: string[];
}

/**
 * Familles dont au moins un code est déjà sélectionné mais qui ne sont pas
 * complètes, avec la liste des codes manquants. Sert de source pour proposer
 * l'ajout des chefs « jumeaux » non encore saisis.
 */
export function getNatinfGroupSuggestions(selectedCodes: string[]): NatinfGroupSuggestion[] {
  const selected = new Set(selectedCodes.map((c) => String(c)));
  const suggestions: NatinfGroupSuggestion[] = [];
  for (const group of NATINF_GROUPS) {
    const present = group.codes.some((c) => selected.has(c));
    if (!present) continue;
    const missing = group.codes.filter((c) => !selected.has(c));
    if (missing.length === 0) continue;
    suggestions.push({ group, missing });
  }
  return suggestions;
}

/** Famille à laquelle appartient un code, le cas échéant. */
export function getNatinfGroupForCode(code: string): NatinfGroup | undefined {
  return NATINF_GROUPS.find((g) => g.codes.includes(String(code)));
}
