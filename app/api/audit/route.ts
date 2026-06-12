/**
 * Journal d'audit applicatif (entrées chiffrées côté client, append-only).
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { appendLog, readLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface AuditRecord { username: string, ct: string, iv: string, timestamp: number }

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    const entries = readLog<AuditRecord>('audit-app.jsonl', { max: 2000 })
    return jsonResponse({ entries })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    const { ct, iv } = await req.json()
    if (typeof ct !== 'string' || typeof iv !== 'string') return jsonResponse({ error: 'ct/iv requis' }, { status: 400 })
    if (ct.length > 256 * 1024 || iv.length > 64) return jsonResponse({ error: 'Entrée trop volumineuse' }, { status: 413 })
    await appendLog('audit-app.jsonl', { username: session.u, ct, iv, timestamp: Date.now() })
    return jsonResponse({ ok: true })
  })
}
