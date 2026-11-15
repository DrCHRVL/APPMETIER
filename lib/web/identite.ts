/**
 * SIRAL — identité serveur de la session (posée par WebGate à l'ouverture).
 *
 * Deux niveaux d'administration, vérifiés côté serveur :
 *  - administrateur du SERVEUR (`role: 'admin'`) : création des TJ, attaché,
 *    connecteur, mises à jour, référentiel NATINF — un seul compte ;
 *  - administrateur LOCAL du TJ actif (`tjAdmin`) : comptes, invitations,
 *    habilitations et papeterie de SON tribunal.
 */
export interface IdentiteSession { username: string; displayName: string; role: string; tjAdmin?: boolean }

declare global {
  interface Window { __SIRAL_ME__?: IdentiteSession }
}

export function identiteSession(): IdentiteSession | null {
  return typeof window !== 'undefined' ? window.__SIRAL_ME__ ?? null : null
}

/** Administrateur du serveur. */
export function estSuperAdmin(): boolean {
  return identiteSession()?.role === 'admin'
}

/** Administrateur local du TJ actif (l'administrateur du serveur l'est sur ses TJ). */
export function estAdminTj(): boolean {
  const me = identiteSession()
  return !!me && (me.tjAdmin === true || me.role === 'admin')
}

/** Identifiant du TJ actif ('default' = TJ d'origine, Amiens). */
export function tjCourantId(): string {
  return (typeof window !== 'undefined' && window.__SIRAL_TJ__?.active?.id) || 'default'
}

export function tjCourantNom(): string {
  return (typeof window !== 'undefined' && window.__SIRAL_TJ__?.active?.name) || ''
}

/** TJ d'origine : ses listes locales (services, secteurs, lieux) restent pré-remplies. */
export function estTjOrigine(): boolean {
  return tjCourantId() === 'default'
}

/**
 * Clé de stockage local (localStorage) propre au TJ actif : rien de ce qu'un
 * TJ laisse dans le navigateur n'est relu dans un autre. Le TJ d'origine garde
 * ses clés historiques (pas de perte des réglages existants).
 */
export function cleLocaleTj(cle: string): string {
  return estTjOrigine() ? cle : `${cle}@${tjCourantId()}`
}
