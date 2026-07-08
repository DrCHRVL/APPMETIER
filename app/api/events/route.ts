/**
 * Événements partagés (activité des collègues), par TJ. Payloads chiffrés côté client.
 * GET ?since=<ms epoch> : événements depuis cette date.
 */
import crypto from 'crypto'
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { appendLog, readLog, tjFile } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface EventRecord { id: string, username: string, ct: string, iv: string, timestamp: number }

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const sinceParam = new URL(req.url).searchParams.get('since')
    const sinceNum = sinceParam !== null ? Number(sinceParam) : NaN
    // Un `?since=` absent OU invalide (NaN) retombe sur la fenêtre 24 h par
    // défaut ; sans ce garde, un NaN désactive le filtre et renvoie tout.
    const since = Number.isFinite(sinceNum) ? sinceNum : undefined
    const events = readLog<EventRecord>(tjFile(session.tj, 'events.jsonl'), { sinceMs: since ?? Date.now() - 24 * 3600 * 1000, max: 500 })
    return jsonResponse({ events, partial: false })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const { ct, iv } = await req.json()
    if (typeof ct !== 'string' || typeof iv !== 'string') return jsonResponse({ error: 'ct/iv requis' }, { status: 400 })
    if (ct.length > 256 * 1024 || iv.length > 64) return jsonResponse({ error: 'Événement trop volumineux' }, { status: 413 })
    const record: EventRecord = {
      id: crypto.randomUUID(),
      username: session.u,
      ct, iv,
      timestamp: Date.now(),
    }
    await appendLog(tjFile(session.tj, 'events.jsonl'), record)
    return jsonResponse({ ok: true, id: record.id })
  })
}
