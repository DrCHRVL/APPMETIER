/**
 * Présence des utilisateurs. Les payloads sont chiffrés côté client ;
 * le serveur ne voit que { username, ct, iv, updatedAt }.
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { dataDir, readJson, writeJson, withFileLock } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface HeartbeatRecord { username: string, ct: string, iv: string, updatedAt: string }

function hbPath() { return dataDir('heartbeats.json') }

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    const all = readJson<HeartbeatRecord[]>(hbPath(), [])
    // expire après 10 min
    const cutoff = Date.now() - 10 * 60 * 1000
    return jsonResponse({ heartbeats: all.filter((h) => Date.parse(h.updatedAt) > cutoff) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    const { ct, iv } = await req.json()
    if (typeof ct !== 'string' || typeof iv !== 'string') return jsonResponse({ error: 'ct/iv requis' }, { status: 400 })
    await withFileLock('heartbeats', async () => {
      const all = readJson<HeartbeatRecord[]>(hbPath(), [])
      const next = all.filter((h) => h.username !== session.u)
      next.push({ username: session.u, ct, iv, updatedAt: new Date().toISOString() })
      writeJson(hbPath(), next)
    })
    return jsonResponse({ ok: true })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    await withFileLock('heartbeats', async () => {
      const all = readJson<HeartbeatRecord[]>(hbPath(), [])
      writeJson(hbPath(), all.filter((h) => h.username !== session.u))
    })
    return jsonResponse({ ok: true })
  })
}
