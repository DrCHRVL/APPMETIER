/**
 * SIRAL — cloisonnement des coffres par juridiction (garde-fou serveur).
 *
 * Le chiffrement E2EE assure déjà qu'un coffre n'est lisible qu'avec sa clé.
 * Ce module ajoute un VERROU CÔTÉ SERVEUR (défense en profondeur) : un compte
 * rattaché à un TJ ne peut ni lire ni écrire les coffres de DONNÉES d'un autre
 * TJ — même si, par erreur d'enrôlement, il se retrouvait sur la même instance.
 *
 * Principe de nommage :
 *   - Le PREMIER compte créé (administrateur du serveur) définit la juridiction
 *     « primaire ». Ses coffres gardent leur nom historique (non préfixé) :
 *     l'existant n'est jamais renommé ni re-chiffré.
 *   - Les autres juridictions écrivent dans des coffres préfixés
 *     « tj-<slug>__<nom> ». Le slug provient de `slugifyTribunal`.
 *   - Les coffres d'ACCÈS (`keyring-*`, `grant-*`) sont par-utilisateur et
 *     restent hors périmètre tribunal.
 *
 * Mode hérité : tant qu'aucune juridiction primaire n'est connue (déploiement
 * antérieur sans tribunal renseigné), le cloisonnement est inactif — le
 * comportement reste strictement identique à l'existant (aucun risque de
 * verrouillage rétroactif).
 */
import { slugifyTribunal } from '@/lib/tribunaux'
import { Account, listAccounts, findAccount } from './auth'

const TJ_PREFIX_RE = /^tj-([a-z0-9-]+)__/

/** Coffre d'accès (trousseau ou invitation) — jamais cloisonné par tribunal. */
export function isAccessVault(name: string): boolean {
  return /^(keyring|grant)-/.test(name)
}

/**
 * Juridiction primaire du serveur = celle du premier compte (admin bootstrap).
 * Retourne '' si inconnue → mode hérité (cloisonnement inactif).
 */
export function primaryTribunalSlug(): string {
  const first = listAccounts()[0]
  return first ? slugifyTribunal(first.tribunal) : ''
}

/** Juridiction « propriétaire » d'un coffre, d'après son nom (préfixe ou primaire). */
export function tribunalOfVault(name: string, primary: string): string {
  const m = TJ_PREFIX_RE.exec(name)
  return m ? m[1] : primary
}

/** Slug effectif d'un compte : sa juridiction, ou la primaire si non renseignée. */
function accountSlug(account: Account | null, primary: string): string {
  return slugifyTribunal(account?.tribunal) || primary
}

/**
 * Préfixe physique des coffres de données pour ce compte. '' pour la
 * juridiction primaire (compat) ou en mode hérité ; sinon « tj-<slug>__ ».
 */
export function vaultPrefixForAccount(account: Account | null): string {
  const primary = primaryTribunalSlug()
  if (!primary) return ''
  const slug = accountSlug(account, primary)
  return slug === primary ? '' : `tj-${slug}__`
}

/**
 * Vrai si `account` peut accéder au coffre `name`. Les coffres d'accès et le
 * mode hérité passent toujours ; sinon la juridiction du coffre doit
 * correspondre à celle du compte.
 */
export function canAccessVault(name: string, account: Account | null): boolean {
  if (isAccessVault(name)) return true
  const primary = primaryTribunalSlug()
  if (!primary) return true
  return tribunalOfVault(name, primary) === accountSlug(account, primary)
}

/**
 * Identité renvoyée au client après connexion/enrôlement : inclut la
 * juridiction et le préfixe de coffres à appliquer côté client.
 */
export function accountIdentity(account: Account) {
  return {
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    tribunal: account.tribunal || null,
    vaultPrefix: vaultPrefixForAccount(account),
  }
}

/**
 * Garde de route : charge le compte de `username` et lève une 403 si le coffre
 * `name` relève d'une autre juridiction. Retourne le compte pour réutilisation.
 */
export function assertVaultAccess(username: string, name: string): Account | null {
  const account = findAccount(username)
  if (!canAccessVault(name, account)) {
    throw new Response(
      JSON.stringify({ error: 'Accès refusé : ce coffre relève d’une autre juridiction' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
  }
  return account
}
