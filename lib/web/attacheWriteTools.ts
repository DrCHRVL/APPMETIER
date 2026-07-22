/**
 * SIRAL — outils de l'attaché IA qui MODIFIENT les données d'un dossier
 * (actes, comptes-rendus, mis en cause, NATINF, description, à-faire, cotes,
 * création de dossier). Sert à déclencher une synchronisation + rafraîchissement
 * IMMÉDIAT dès qu'un run de chat vient d'écrire, plutôt que d'attendre le cycle
 * de sync périodique (2 min). Les outils en lecture seule n'y figurent pas.
 *
 * Les noms proviennent des définitions MCP (scripts/attache-mcp.mjs). Le flux de
 * chat retire déjà le préfixe `mcp__siral__` ; on le retire par sécurité ici aussi.
 */
export const ATTACHE_DOSSIER_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'enregistrer_acte',
  'acter_prolongation',
  'classer_note',
  'ajouter_todo',
  'ajouter_natinfs',
  'creer_dossier',
  'actualiser_description',
  'cotes_enregistrer',
]);

/** Vrai si le nom d'outil (préfixé ou non) écrit dans les données d'un dossier. */
export function toolTouchesDossierData(name: string): boolean {
  const base = String(name || '').replace(/^mcp__[^_]+__/, '');
  return ATTACHE_DOSSIER_WRITE_TOOLS.has(base);
}

/** Vrai si au moins un outil de la liste a modifié les données du dossier. */
export function runTouchedDossierData(toolNames: readonly string[]): boolean {
  return Array.isArray(toolNames) && toolNames.some(toolTouchesDossierData);
}
