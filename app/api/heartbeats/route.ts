/**
 * Présence des utilisateurs, par TJ. Les payloads sont chiffrés côté client ;
 * le serveur ne voit que { username, ct, iv, updatedAt }.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { tjDataDir, readJson, writeJson, withFileLock } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface HeartbeatRecord { username: string, ct: string, iv: string, updatedAt: string }

function hbPath(tj: string) { return tjDataDir(tj, 'heartbeats.json') }

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const all = readJson<HeartbeatRecord[]>(hbPath(session.tj), [])
    // expire après 10 min
    const cutoff = Date.now() - 10 * 60 * 1000
    return jsonResponse({ heartbeats: all.filter((h) => Date.parse(h.updatedAt) > cutoff) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const { ct, iv } = await req.json()
    if (typeof ct !== 'string' || typeof iv !== 'string') return jsonResponse({ error: 'ct/iv requis' }, { status: 400 })
    if (ct.length > 64 * 1024 || iv.length > 64) return jsonResponse({ error: 'Heartbeat trop volumineux' }, { status: 413 })
    await withFileLock('heartbeats:' + session.tj, async () => {
      const all = readJson<HeartbeatRecord[]>(hbPath(session.tj), [])
      const next = all.filter((h) => h.username !== session.u)
      next.push({ username: session.u, ct, iv, updatedAt: new Date().toISOString() })
      writeJson(hbPath(session.tj), next)
    })
    return jsonResponse({ ok: true })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    await withFileLock('heartbeats:' + session.tj, async () => {
      const all = readJson<HeartbeatRecord[]>(hbPath(session.tj), [])
      writeJson(hbPath(session.tj), all.filter((h) => h.username !== session.u))
    })
    return jsonResponse({ ok: true })
  })
}
