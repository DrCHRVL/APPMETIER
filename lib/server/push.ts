/**
 * SIRAL — notifications push (rappels d'échéances sur iPhone/PC).
 *
 * Contrainte E2EE : le serveur ne connaît JAMAIS le contenu des dossiers.
 * Le client dépose uniquement des HORODATAGES (« préviens-moi à ces moments ») ;
 * à l'heure dite, le serveur envoie une notification GÉNÉRIQUE (« des échéances
 * arrivent — ouvrez SIRAL ») : aucun nom, aucun numéro de dossier ne transite.
 *
 * Clés VAPID auto-générées au premier usage (persistées dans le volume données).
 */
import webpush from 'web-push'
import { dataDir, readJson, writeJson, withFileLock } from './store'

interface StoredSub { username: string, endpoint: string, subscription: webpush.PushSubscription, createdAt: string }
interface ScheduleMap { [username: string]: number[] }

const SUBS = 'push-subs.json'
const SCHEDULE = 'push-schedule.json'
const MAX_TIMES_PER_USER = 300

function vapidKeys(): { publicKey: string, privateKey: string } {
  const p = dataDir('push-vapid.json')
  const existing = readJson<{ publicKey: string, privateKey: string } | null>(p, null)
  if (existing) return existing
  const keys = webpush.generateVAPIDKeys()
  writeJson(p, keys)
  return keys
}

export function pushPublicKey(): string {
  return vapidKeys().publicKey
}

export async function saveSubscription(username: string, subscription: webpush.PushSubscription): Promise<void> {
  if (!subscription || typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048) {
    throw new Error('Souscription invalide')
  }
  await withFileLock('push-subs', async () => {
    const all = readJson<StoredSub[]>(dataDir(SUBS), [])
    const next = all.filter((s) => s.endpoint !== subscription.endpoint)
    next.push({ username, endpoint: subscription.endpoint, subscription, createdAt: new Date().toISOString() })
    writeJson(dataDir(SUBS), next.slice(-500))
  })
}

export async function removeSubscriptions(username: string): Promise<void> {
  await withFileLock('push-subs', async () => {
    const all = readJson<StoredSub[]>(dataDir(SUBS), [])
    writeJson(dataDir(SUBS), all.filter((s) => s.username !== username))
  })
  await withFileLock('push-schedule', async () => {
    const map = readJson<ScheduleMap>(dataDir(SCHEDULE), {})
    delete map[username]
    writeJson(dataDir(SCHEDULE), map)
  })
}

export function hasSubscription(username: string): boolean {
  return readJson<StoredSub[]>(dataDir(SUBS), []).some((s) => s.username === username)
}

/** Remplace le calendrier de rappels de l'utilisateur (horodatages epoch ms uniquement). */
export async function saveSchedule(username: string, times: number[]): Promise<number> {
  const now = Date.now()
  const horizon = now + 366 * 24 * 3600 * 1000
  const clean = Array.from(new Set(
    times.filter((t) => Number.isFinite(t) && t > now - 3600 * 1000 && t < horizon).map((t) => Math.round(t)),
  )).sort((a, b) => a - b).slice(0, MAX_TIMES_PER_USER)
  await withFileLock('push-schedule', async () => {
    const map = readJson<ScheduleMap>(dataDir(SCHEDULE), {})
    map[username] = clean
    writeJson(dataDir(SCHEDULE), map)
  })
  return clean.length
}

async function sendDue(): Promise<void> {
  const now = Date.now()
  let due: string[] = []
  await withFileLock('push-schedule', async () => {
    const map = readJson<ScheduleMap>(dataDir(SCHEDULE), {})
    let changed = false
    for (const [username, times] of Object.entries(map)) {
      const ready = times.filter((t) => t <= now)
      if (ready.length) {
        due.push(username)
        map[username] = times.filter((t) => t > now)
        changed = true
      }
    }
    if (changed) writeJson(dataDir(SCHEDULE), map)
  })
  if (!due.length) return

  const { publicKey, privateKey } = vapidKeys()
  webpush.setVapidDetails('mailto:admin@siral.local', publicKey, privateKey)
  const subs = readJson<StoredSub[]>(dataDir(SUBS), [])
  const dead: string[] = []
  for (const username of due) {
    for (const s of subs.filter((x) => x.username === username)) {
      try {
        // payload générique : aucune donnée métier ne sort du chiffrement
        await webpush.sendNotification(s.subscription, JSON.stringify({
          title: 'SIRAL',
          body: 'Des échéances arrivent — ouvrez SIRAL pour les consulter.',
        }), { TTL: 24 * 3600 })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) dead.push(s.endpoint)
      }
    }
  }
  if (dead.length) {
    await withFileLock('push-subs', async () => {
      const all = readJson<StoredSub[]>(dataDir(SUBS), [])
      writeJson(dataDir(SUBS), all.filter((s) => !dead.includes(s.endpoint)))
    })
  }
}

// ── Boucle d'envoi : démarrée paresseusement, une seule par processus ──
declare global {
  // eslint-disable-next-line no-var
  var __siralPushLoop: ReturnType<typeof setInterval> | undefined
}

export function ensurePushLoop(): void {
  if (globalThis.__siralPushLoop) return
  globalThis.__siralPushLoop = setInterval(() => { sendDue().catch(() => {}) }, 60 * 1000)
}
