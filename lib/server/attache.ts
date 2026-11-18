/**
 * SIRAL — Attaché de justice · côté application web.
 *
 * L'app ne détient AUCUNE clé de l'attaché : elle garde les routes
 * (administrateur du TJ confié uniquement), relaie vers le service attaché
 * (sidecar, seul détenteur de la clé-maître) et lit sur disque les fichiers
 * d'enveloppes que le navigateur de l'admin déchiffre lui-même avec sa clé
 * « global » — le même modèle E2EE que le reste de SIRAL.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { jsonResponse, requireTjSession } from './auth'
import { tjDataDir, withFileLock, ensureDir, atomicWrite, readJson, DEFAULT_TJ_ID, readLogTailLines } from './store'

export function attacheEnabled(): boolean {
  return Boolean(process.env.SIRAL_ATTACHE_URL)
}

export function attacheTjId(): string {
  return process.env.SIRAL_ATTACHE_TJ || DEFAULT_TJ_ID
}

function serviceUrl(): string {
  return (process.env.SIRAL_ATTACHE_URL || '').replace(/\/+$/, '')
}

function bridgeSecret(): string | null {
  if (process.env.SIRAL_ATTACHE_BRIDGE_SECRET) return process.env.SIRAL_ATTACHE_BRIDGE_SECRET
  if (process.env.SIRAL_SECRET) {
    return crypto.createHash('sha256').update('attache-bridge:' + process.env.SIRAL_SECRET).digest('hex')
  }
  return null
}

/**
 * Garde des routes attaché : session admin, TJ actif = TJ confié,
 * fonctionnalité activée. L'attaché est INVISIBLE de tout autre utilisateur —
 * un non-admin reçoit le même 404 qu'une route inexistante.
 */
export function requireAttacheAdmin(req: Request) {
  const session = requireTjSession(req)
  if (session.r !== 'admin' || !attacheEnabled() || session.tj !== attacheTjId()) {
    throw new Response(JSON.stringify({ error: 'Introuvable' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    })
  }
  return session
}

/** Relaie une requête JSON vers le service attaché. */
export async function attacheFetch(pathname: string, init?: { method?: string, body?: unknown, timeoutMs?: number }): Promise<Response> {
  const secret = bridgeSecret()
  // `injoignable` distingue « service momentanément absent » de « fonctionnalité
  // désactivée » (404). Le navigateur s'en sert pour GARDER le module visible et
  // afficher le diagnostic, au lieu de faire disparaître l'assistant en silence.
  if (!secret) return jsonResponse({ error: 'Service attaché non configuré (secret absent)', injoignable: true }, { status: 503 })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 30_000)
  try {
    const res = await fetch(serviceUrl() + pathname, {
      method: init?.method || 'GET',
      headers: {
        'x-attache-secret': secret,
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    })
    return res
  } catch {
    return jsonResponse({ error: 'Service attaché injoignable', injoignable: true }, { status: 503 })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Réveil du FLUX TENDU de l'attaché : « ce dossier a bougé » (pièce versée,
 * CR, acte — par n'importe quel utilisateur du TJ confié). Best-effort et
 * jamais bloquant : un réveil manqué est rattrapé par la relève du service.
 * Ne porte aucune donnée d'enquête — un numéro ou une clé de dossier (déjà en
 * clair sur le disque), une raison, un auteur.
 */
export function reveilAttache(body: { numeros?: string[], docKey?: string, raison: string, par?: string }): void {
  if (!attacheEnabled()) return
  attacheFetch('/reveil', { method: 'POST', body, timeoutMs: 5_000 }).catch(() => {})
}

/** Le pont app ↔ service est-il configurable (secret partagé présent) ? */
export function attacheBridgeConfigured(): boolean {
  return Boolean(bridgeSecret())
}

// ── Interrupteur « fonctionnalités IA » (par tribunal, tenu par l'app) ──
// Le magistrat peut TOUT masquer d'un geste : menu, page, raccourci, actes
// rédigés, chat de dossier, boutons attaché de la cartographie. Seul l'onglet
// « Attaché IA » des paramètres survit — sans lui, l'interrupteur ne pourrait
// plus être rendu, donc jamais rouvert.
//
// Le drapeau appartient à l'APP, pas au service : il vit dans l'espace du TJ
// ACTIF (et non du TJ confié) et s'écrit sans la moindre clé. Il se règle donc
// même service éteint, et il suit le magistrat d'un appareil à l'autre.

function visibiliteFile(tj: string): string {
  return tjDataDir(tj, 'ia-visibilite.json')
}

/** Vrai = toutes les fonctionnalités IA sont masquées sur ce tribunal. */
export function readIaMasquee(tj: string): boolean {
  return readJson<{ masque?: boolean }>(visibiliteFile(tj), {}).masque === true
}

export async function writeIaMasquee(tj: string, masque: boolean, par: string): Promise<void> {
  await withFileLock('ia-visibilite-' + tj, async () => {
    atomicWrite(visibiliteFile(tj), JSON.stringify({ masque, at: new Date().toISOString(), par }, null, 2))
  })
}

// ── Diagnostic de présence (administrateur connecté uniquement) ──
// Quand /api/attache/status répond 404, c'est volontairement muet : ni le
// motif, ni même l'existence de la fonctionnalité ne doivent transparaître.
// Muet, l'admin n'avait pourtant AUCUN moyen de savoir laquelle des trois
// conditions manquait — d'où des disparitions inexplicables. Ce diagnostic
// nomme la condition en défaut ; il n'est rendu qu'à une session admin, tout
// autre appelant recevant le même 404 qu'une route inexistante.

export interface AttacheDiagnostic {
  actif: boolean
  tjActif: string
  tjConfie: string
  tjConcorde: boolean
  secretPont: boolean
  service: { joignable: boolean, code?: number, motif?: string } | null
  masque: boolean
}

export async function attacheDiagnostic(session: { r: string, tj: string }): Promise<AttacheDiagnostic> {
  const actif = attacheEnabled()
  const tjConfie = attacheTjId()
  const base: AttacheDiagnostic = {
    actif,
    tjActif: session.tj,
    tjConfie,
    tjConcorde: session.tj === tjConfie,
    secretPont: attacheBridgeConfigured(),
    service: null,
    masque: readIaMasquee(session.tj),
  }
  if (!actif || !base.secretPont) return base
  const res = await attacheFetch('/status?bref=1', { timeoutMs: 8_000 })
  if (res.ok) {
    base.service = { joignable: true }
  } else {
    const detail = await res.json().catch(() => ({} as { error?: string }))
    base.service = { joignable: false, code: res.status, motif: detail?.error }
  }
  return base
}

// ── Lectures disque (enveloppes chiffrées, déchiffrées par le navigateur admin) ──

function attacheDir(...segments: string[]): string {
  return tjDataDir(attacheTjId(), 'attache', ...segments)
}

export function readEncryptedLog(file: 'audit.jsonl', max = 500): Array<{ ts: number, id?: string, iv: string, ct: string }> {
  const p = attacheDir(file)
  if (!fs.existsSync(p)) return []
  // Queue seulement : ces journaux grossissent sans fin (l'épisode des cartes
  // de mise en pause répétées a pu enfler feed.jsonl), et ils sont relus à
  // chaque affichage du fil. Voir readLogTailLines.
  const lines = readLogTailLines(p)
  const out: Array<{ ts: number, iv: string, ct: string }> = []
  for (const line of lines) {
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out.slice(-max)
}

export interface AttacheEnvelope { v: number, encrypted: true, iv: string, ct: string, savedAt?: string, savedBy?: string }

/** Instructions du projet Claude web (version de référence tenue dans SIRAL). */
export function readInstructionsProjetEnvelope(): AttacheEnvelope | null {
  return readJson<AttacheEnvelope | null>(attacheDir('instructions-projet.json'), null)
}

export async function writeInstructionsProjetEnvelope(envelope: AttacheEnvelope): Promise<void> {
  await writeVersionedEnvelope('instructions-projet', envelope)
}

/** Consignes permanentes (le « prompt » du magistrat). */
export function readInstructionsEnvelope(): AttacheEnvelope | null {
  return readJson<AttacheEnvelope | null>(attacheDir('instructions.json'), null)
}

export async function writeInstructionsEnvelope(envelope: AttacheEnvelope): Promise<void> {
  await writeVersionedEnvelope('instructions', envelope)
}

/** Consignes PAR DOMAINE : les prompts métier (description, carto, registre). */
export function readConsignesEnvelope(): AttacheEnvelope | null {
  return readJson<AttacheEnvelope | null>(attacheDir('consignes.json'), null)
}

export async function writeConsignesEnvelope(envelope: AttacheEnvelope): Promise<void> {
  await writeVersionedEnvelope('consignes', envelope)
}

// ── Collections d'enveloppes (skills, trames, base de connaissances) ──
// Un fichier-enveloppe par entrée, dans le même répertoire et au même format
// que le service attaché (attache/<collection>/) : le navigateur admin
// chiffre/déchiffre, l'app ne voit que des enveloppes. Versionnage avant
// toute réécriture ou suppression — rien n'est jamais écrasé à sec.

const ENTRY_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/
type AttacheCollection = 'skills' | 'trames' | 'kb'

export function listCollectionEnvelopes(collection: AttacheCollection): Array<{ id: string, envelope: AttacheEnvelope }> {
  const dir = attacheDir(collection)
  if (!fs.existsSync(dir)) return []
  const out: Array<{ id: string, envelope: AttacheEnvelope }> = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const id = f.slice(0, -'.json'.length)
    if (!ENTRY_ID_RE.test(id)) continue
    const envelope = readJson<AttacheEnvelope | null>(path.join(dir, f), null)
    if (envelope) out.push({ id, envelope })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export async function writeCollectionEnvelope(collection: AttacheCollection, id: string, envelope: AttacheEnvelope): Promise<void> {
  if (!ENTRY_ID_RE.test(id)) throw new Error('Identifiant invalide')
  const p = attacheDir(collection, id + '.json')
  try {
    await withFileLock(`attache-${collection}-` + id, async () => {
      if (fs.existsSync(p)) {
        const vdir = attacheDir(collection, '.versions', id)
        ensureDir(vdir)
        fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '~' + crypto.randomBytes(4).toString('hex') + '.json'))
      }
      ensureDir(path.dirname(p))
      atomicWrite(p, JSON.stringify(envelope, null, 2))
    })
  } catch (e) {
    // Volume partagé : le répertoire peut appartenir au conteneur du service
    // (créé root avant le correctif de permissions) — on relaie l'écriture au
    // service, qui écrit la même enveloppe opaque. Sans service : erreur claire.
    const relayed = await attacheFetch('/collection', { method: 'PUT', body: { collection, id, envelope } })
    if (!relayed.ok) {
      const detail = await relayed.json().catch(() => ({} as { error?: string }))
      throw new Error(detail.error || (e instanceof Error ? e.message : 'Écriture refusée'))
    }
  }
}

/** Suppression réversible : la version courante est archivée avant retrait. */
export async function deleteCollectionEnvelope(collection: AttacheCollection, id: string): Promise<boolean> {
  if (!ENTRY_ID_RE.test(id)) throw new Error('Identifiant invalide')
  const p = attacheDir(collection, id + '.json')
  try {
    return await withFileLock(`attache-${collection}-` + id, async () => {
      if (!fs.existsSync(p)) return false
      const vdir = attacheDir(collection, '.versions', id)
      ensureDir(vdir)
      fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '~' + crypto.randomBytes(4).toString('hex') + '~suppression.json'))
      fs.unlinkSync(p)
      return true
    })
  } catch (e) {
    // Même repli que l'écriture : suppression relayée au service attaché.
    const relayed = await attacheFetch('/collection?collection=' + encodeURIComponent(collection) + '&id=' + encodeURIComponent(id), { method: 'DELETE' })
    if (!relayed.ok) {
      const detail = await relayed.json().catch(() => ({} as { error?: string }))
      throw new Error(detail.error || (e instanceof Error ? e.message : 'Suppression refusée'))
    }
    const out = await relayed.json().catch(() => ({ ok: false })) as { ok?: boolean }
    return Boolean(out.ok)
  }
}

export const listSkillEnvelopes = () => listCollectionEnvelopes('skills')
export const writeSkillEnvelope = (id: string, envelope: AttacheEnvelope) => writeCollectionEnvelope('skills', id, envelope)
export const deleteSkillEnvelope = (id: string) => deleteCollectionEnvelope('skills', id)

/** Écrit une enveloppe d'attaché en archivant la version précédente (jamais d'écrasement sec). */
async function writeVersionedEnvelope(name: 'memory' | 'instructions' | 'consignes' | 'instructions-projet', envelope: AttacheEnvelope): Promise<void> {
  const p = attacheDir(name + '.json')
  try {
    await withFileLock('attache-' + name, async () => {
      if (fs.existsSync(p)) {
        const vdir = path.join(path.dirname(p), '.versions', name)
        ensureDir(vdir)
        const stamp = new Date().toISOString().replace(/:/g, '_')
        fs.copyFileSync(p, path.join(vdir, stamp + '~' + crypto.randomBytes(4).toString('hex') + '.json'))
      }
      atomicWrite(p, JSON.stringify(envelope, null, 2))
    })
  } catch (e) {
    // même repli que les collections : écriture relayée au service attaché
    const relayed = await attacheFetch('/envelope-file', { method: 'PUT', body: { name, envelope } })
    if (!relayed.ok) {
      const detail = await relayed.json().catch(() => ({} as { error?: string }))
      throw new Error(detail.error || (e instanceof Error ? e.message : 'Écriture refusée'))
    }
  }
}
