/**
 * Événements partagés (activité des collègues). Payloads chiffrés côté client.
 * GET ?since=<ms epoch> : événements depuis cette date.
 */
import crypto from 'crypto'
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { appendLog, readLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface EventRecord { id: string, username: string, ct: string, iv: string, timestamp: number }

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    const since = Number(new URL(req.url).searchParams.get('since') || 0)
    const events = readLog<EventRecord>('events.jsonl', { sinceMs: since || Date.now() - 24 * 3600 * 1000, max: 500 })
    return jsonResponse({ events, partial: false })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    const { ct, iv } = await req.json()
    if (typeof ct !== 'string' || typeof iv !== 'string') return jsonResponse({ error: 'ct/iv requis' }, { status: 400 })
    if (ct.length > 256 * 1024 || iv.length > 64) return jsonResponse({ error: 'Événement trop volumineux' }, { status: 413 })
    const record: EventRecord = {
      id: crypto.randomUUID(),
      username: session.u,
      ct, iv,
      timestamp: Date.now(),
    }
    await appendLog('events.jsonl', record)
    return jsonResponse({ ok: true, id: record.id })
  })
}
