/**
 * Journal d'audit applicatif (entrées chiffrées côté client, append-only), par TJ.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { appendLog, readLog, tjFile } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface AuditRecord { username: string, ct: string, iv: string, timestamp: number }

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (session.r !== 'admin') return jsonResponse({ error: 'Accès refusé' }, { status: 403 })
    const entries = readLog<AuditRecord>(tjFile(session.tj, 'audit-app.jsonl'), { max: 2000 })
    return jsonResponse({ entries })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const { ct, iv } = await req.json()
    if (typeof ct !== 'string' || typeof iv !== 'string') return jsonResponse({ error: 'ct/iv requis' }, { status: 400 })
    if (ct.length > 256 * 1024 || iv.length > 64) return jsonResponse({ error: 'Entrée trop volumineuse' }, { status: 413 })
    await appendLog(tjFile(session.tj, 'audit-app.jsonl'), { username: session.u, ct, iv, timestamp: Date.now() })
    return jsonResponse({ ok: true })
  })
}
