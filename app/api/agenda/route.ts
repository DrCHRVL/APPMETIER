/**
 * Agenda — proxy lecture seule d'un flux iCal Google Calendar.
 *
 * Sécurité (pas de backdoor / anti-SSRF) :
 *  - hôte STRICTEMENT limité à calendar.google.com en HTTPS ;
 *  - méthode GET uniquement, aucune redirection suivie vers un autre hôte ;
 *  - délai et taille bornés ; on ne renvoie que des événements (titre + dates),
 *    jamais le flux brut. L'URL secrète n'est ni journalisée ni stockée côté
 *    serveur : elle est fournie à chaque appel par le client (prefs chiffrées).
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 2 * 1024 * 1024

function isAllowed(raw: string): URL | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return null
    if (u.hostname !== 'calendar.google.com') return null
    return u
  } catch { return null }
}

/** Déplie les lignes ICS (RFC 5545 : continuation par espace/tab en tête). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

function parseIcsDate(v: string): { iso: string, allDay: boolean } | null {
  // formes : 20260612 (date) | 20260612T140000Z | 20260612T140000
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (!h) return { iso: `${y}-${mo}-${d}T00:00:00`, allDay: true }
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`
  return { iso, allDay: false }
}

export async function POST(req: Request) {
  return handle(async () => {
    requireSession(req)
    const { url } = await req.json()
    const safe = isAllowed(String(url || ''))
    if (!safe) return jsonResponse({ error: 'URL iCal Google invalide (https://calendar.google.com/… attendu)' }, { status: 400 })

    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 10000)
    let text = ''
    try {
      const res = await fetch(safe.toString(), { signal: ctl.signal, redirect: 'error', headers: { accept: 'text/calendar' } })
      if (!res.ok) return jsonResponse({ error: 'Agenda injoignable (' + res.status + ')' }, { status: 502 })
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.length > MAX_BYTES) return jsonResponse({ error: 'Agenda trop volumineux' }, { status: 413 })
      text = new TextDecoder().decode(buf)
    } catch {
      return jsonResponse({ error: 'Agenda injoignable' }, { status: 504 })
    } finally {
      clearTimeout(t)
    }

    const now = Date.now()
    const horizon = now + 60 * 24 * 3600 * 1000 // 60 jours à venir
    const events: Array<{ title: string, start: string, allDay: boolean }> = []
    let cur: { title?: string, start?: string, allDay?: boolean } | null = null
    for (const line of unfold(text)) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue }
      if (line === 'END:VEVENT') {
        if (cur?.start && cur.title) {
          const ts = Date.parse(cur.start)
          if (Number.isFinite(ts) && ts >= now - 12 * 3600 * 1000 && ts <= horizon) {
            events.push({ title: cur.title.slice(0, 200), start: cur.start, allDay: !!cur.allDay })
          }
        }
        cur = null; continue
      }
      if (!cur) continue
      if (line.startsWith('SUMMARY')) cur.title = line.slice(line.indexOf(':') + 1).replace(/\\,/g, ',').replace(/\\n/g, ' ').trim()
      else if (line.startsWith('DTSTART')) {
        const d = parseIcsDate(line.slice(line.indexOf(':') + 1))
        if (d) { cur.start = d.iso; cur.allDay = d.allDay }
      }
    }
    events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    return jsonResponse({ events: events.slice(0, 50) })
  })
}
