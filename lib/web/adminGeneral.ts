/**
 * SIRAL — pouvoirs de l'ADMINISTRATEUR GÉNÉRAL sur les autres tribunaux, sans
 * y basculer. Tout se passe dans son navigateur : le serveur ne transmet que
 * des enveloppes chiffrées (route /api/tjs/donnees, journalisée), ouvertes ici
 * avec le séquestre du TJ (déposé par son administrateur local) et la clé
 * d'administration gardée en mémoire après déverrouillage.
 *  - debloquerCompte : nouvelle invitation pour un compte d'un TJ (inscrit en
 *    attente, phrase perdue…), aux périmètres de ses habilitations ;
 *  - cartographieInterTj : personnes mises en cause dans plusieurs TJ.
 *    Calculée à la demande, en mémoire, jamais enregistrée.
 */
import { decryptJson, encryptJson, type CipherEnvelope } from './crypto'
import { deriveRawKey, generateInvitationCode, importAesKey, newKdfParams, SCOPE_GLOBAL } from './keyring'
import { openEscrow, type EscrowEnvelope } from './escrow'
import { mecSortedKey } from '@/lib/recoupements/nomsCore.mjs'

export interface AdminHttp {
  get: (path: string) => Promise<{ status: number, json: Record<string, unknown> }>
  put: (path: string, body: unknown) => Promise<number>
  del: (path: string) => Promise<number>
}

const chemin = (tj: string, coffre: string) => `/api/tjs/donnees?tj=${encodeURIComponent(tj)}&coffre=${encodeURIComponent(coffre)}`
const cleAes = (b64: string) => importAesKey(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))

/** Clés d'un TJ, tirées de son séquestre. Lève si absent. */
export async function clesDuTj(tj: string, clePrivee: CryptoKey, http: AdminHttp): Promise<Record<string, string>> {
  const r = await http.get(chemin(tj, 'escrow-keys'))
  if (r.status !== 200) throw new Error('Séquestre absent : l’administrateur local ne s’est pas encore connecté depuis l’ouverture de l’accès général')
  return openEscrow(clePrivee, r.json.envelope as unknown as EscrowEnvelope)
}

async function lireCoffre<T>(tj: string, coffre: string, cle: string | undefined, http: AdminHttp): Promise<T | null> {
  if (!cle) return null
  const r = await http.get(chemin(tj, coffre))
  if (r.status !== 200) return null
  return decryptJson<T>(await cleAes(cle), r.json.envelope as unknown as CipherEnvelope)
}

/**
 * Débloque l'accès d'un compte : (réinitialise son trousseau s'il en a un)
 * puis dépose une invitation à usage unique aux périmètres de ses
 * habilitations dans ce TJ (global + contentieux attribués). Rend le code.
 */
export async function debloquerCompte(
  tj: string, username: string, clePrivee: CryptoKey, http: AdminHttp, moi: string,
): Promise<{ code: string, scopes: string[] }> {
  const keys = await clesDuTj(tj, clePrivee, http)
  const config = await lireCoffre<{ users?: Array<{ windowsUsername: string, contentieux?: Array<{ contentieuxId: string }> }> }>(
    tj, 'users-config', keys[SCOPE_GLOBAL], http)
  const profil = config?.users?.find((u) => u.windowsUsername.toLowerCase() === username.toLowerCase())
  const scopes = [SCOPE_GLOBAL, ...(profil?.contentieux || []).map((c) => `ctx-${c.contentieuxId}`)]
    .filter((s, i, a) => keys[s] && a.indexOf(s) === i)
  const subset = Object.fromEntries(scopes.map((s) => [s, keys[s]]))

  // un trousseau existant (phrase perdue) est remplacé : l'invitation le recrée
  await http.del(chemin(tj, `keyring-${username}`))
  const code = generateInvitationCode()
  const kdf = newKdfParams()
  const codeKey = await importAesKey(await deriveRawKey(code, kdf.salt, kdf.iterations))
  const env = await encryptJson(codeKey, { v: 1, keys: subset, grantedBy: moi, grantedAt: new Date().toISOString() })
  const st = await http.put(chemin(tj, `grant-${username}`), { ...env, kdfSalt: kdf.salt, kdfIterations: kdf.iterations })
  if (st !== 200) throw new Error(`Dépôt de l’invitation refusé (${st})`)
  return { code, scopes }
}

export interface OccurrenceTj { tj: string, nomTj: string, dossiers: Array<{ numero: string, contentieux: string, statut: string }> }
export interface PersonneCommune { nom: string, tjs: OccurrenceTj[] }
export interface CartographieInterTj {
  personnes: PersonneCommune[]
  couverture: Array<{ tj: string, nomTj: string, lu: boolean, raison?: string, personnes: number }>
}

/**
 * Personnes mises en cause (victimes exclues) présentes dans au moins deux
 * tribunaux — rapprochement sur le nom, insensible à l'ordre des mots, aux
 * accents et à la casse. Un signalement à vérifier, jamais une certitude.
 */
export async function cartographieInterTj(
  tjs: Array<{ id: string, name: string }>, clePrivee: CryptoKey, http: AdminHttp,
): Promise<CartographieInterTj> {
  const parCle = new Map<string, { nom: string, parTj: Map<string, OccurrenceTj> }>()
  const couverture: CartographieInterTj['couverture'] = []
  for (const tj of tjs) {
    let keys: Record<string, string>
    try {
      keys = await clesDuTj(tj.id, clePrivee, http)
    } catch (e) {
      couverture.push({ tj: tj.id, nomTj: tj.name, lu: false, raison: e instanceof Error ? e.message : 'illisible', personnes: 0 })
      continue
    }
    const vues = new Set<string>()
    for (const scope of Object.keys(keys).filter((s) => s.startsWith('ctx-'))) {
      const contentieux = scope.slice(4)
      let payload: { data?: { enquetes?: Array<{ numero?: string, statut?: string, misEnCause?: Array<{ nom?: string, isVictime?: boolean }> }> } } | null = null
      try { payload = await lireCoffre(tj.id, scope, keys[scope], http) } catch { payload = null }
      for (const e of payload?.data?.enquetes || []) {
        for (const m of e.misEnCause || []) {
          if (!m?.nom || m.isVictime) continue
          const cle = mecSortedKey(m.nom)
          if (!cle || cle.split(' ').length < 2) continue // un seul mot : trop peu pour rapprocher
          vues.add(cle)
          const entree = parCle.get(cle) || { nom: m.nom, parTj: new Map<string, OccurrenceTj>() }
          const occ = entree.parTj.get(tj.id) || { tj: tj.id, nomTj: tj.name, dossiers: [] }
          if (!occ.dossiers.some((d) => d.numero === e.numero && d.contentieux === contentieux)) {
            occ.dossiers.push({ numero: String(e.numero || '—'), contentieux, statut: String(e.statut || '') })
          }
          entree.parTj.set(tj.id, occ)
          parCle.set(cle, entree)
        }
      }
    }
    couverture.push({ tj: tj.id, nomTj: tj.name, lu: true, personnes: vues.size })
  }
  const personnes = [...parCle.values()]
    .filter((p) => p.parTj.size >= 2)
    .map((p) => ({ nom: p.nom, tjs: [...p.parTj.values()] }))
    .sort((a, b) => b.tjs.length - a.tjs.length || a.nom.localeCompare(b.nom))
  return { personnes, couverture }
}
