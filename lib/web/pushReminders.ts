/**
 * SIRAL — rappels d'échéances par notification (iPhone PWA / PC).
 *
 * Côté client : on calcule les moments de rappel à partir des alertes
 * (déchiffrées localement), et on ne dépose au serveur QUE des horodatages.
 * La notification reçue est générique ; le détail s'affiche dans l'app.
 *
 * iPhone : nécessite l'app installée sur l'écran d'accueil (iOS 16.4+) et
 * l'autorisation de notifications.
 */

const ENABLED_KEY = 'siral-push-enabled'

export function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export function isPushEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}

function b64urlToUint8(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function enablePushReminders(): Promise<{ ok: boolean, reason?: string }> {
  if (!isPushSupported()) {
    return { ok: false, reason: "Non pris en charge ici. Sur iPhone : installez d'abord SIRAL sur l'écran d'accueil (Partager → Sur l'écran d'accueil)." }
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: 'Autorisation de notifications refusée' }
  const reg = await navigator.serviceWorker.ready
  const keyRes = await fetch('/api/push', { credentials: 'same-origin' })
  if (!keyRes.ok) return { ok: false, reason: 'Serveur injoignable' }
  const { publicKey } = await keyRes.json()
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64urlToUint8(publicKey) as BufferSource,
  })
  const save = await fetch('/api/push', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }), credentials: 'same-origin',
  })
  if (!save.ok) return { ok: false, reason: 'Enregistrement refusé' }
  try { localStorage.setItem(ENABLED_KEY, '1') } catch {}
  flushSchedule()
  return { ok: true }
}

export async function disablePushReminders(): Promise<void> {
  try { localStorage.removeItem(ENABLED_KEY) } catch {}
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe()
  } catch {}
  try { await fetch('/api/push', { method: 'DELETE', credentials: 'same-origin' }) } catch {}
}

// ── Calendrier : fusion des sources (enquêtes, instructions) ──
const sourceTimes = new Map<string, number[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Moments de rappel pour une échéance : 9h le jour J et 9h l'avant-veille. */
export function reminderTimesForDeadline(deadlineIso: string): number[] {
  const d = new Date(deadlineIso)
  if (isNaN(d.getTime())) return []
  const at9 = (date: Date) => { const x = new Date(date); x.setHours(9, 0, 0, 0); return x.getTime() }
  const now = Date.now()
  return [at9(new Date(d.getTime() - 2 * 24 * 3600 * 1000)), at9(d)].filter((t) => t > now)
}

/**
 * Met à jour les rappels issus d'une source d'alertes ('enquetes' | 'instructions').
 * Appelé par les hooks d'alertes existants à chaque recalcul — sans effet si
 * les rappels ne sont pas activés.
 */
export function updatePushSchedule(source: string, alerts: Array<{ deadline?: string }>): void {
  if (!isPushEnabled()) return
  const times = alerts.flatMap((a) => (a.deadline ? reminderTimesForDeadline(a.deadline) : []))
  sourceTimes.set(source, times)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flushSchedule, 4000)
}

function flushSchedule(): void {
  if (!isPushEnabled()) return
  const all = Array.from(new Set(Array.from(sourceTimes.values()).flat())).sort((a, b) => a - b)
  fetch('/api/push', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ times: all }), credentials: 'same-origin',
  }).catch(() => {})
}
