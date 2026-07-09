/**
 * Paramètres de dérivation de la clé E2EE (sel + itérations PBKDF2), par TJ.
 * Le sel est public (il ne protège pas seul), la phrase secrète ne transite jamais.
 * POST : création au premier déverrouillage (un seul jeu de paramètres par TJ).
 */
import crypto from 'crypto'
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { tjDataDir, readJson, writeJson, withFileLock } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface KdfParams { salt: string, iterations: number, alg: 'PBKDF2-SHA256', createdAt: string, createdBy: string }

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const kdf = readJson<KdfParams | null>(tjDataDir(session.tj, 'kdf.json'), null)
    return jsonResponse({ exists: !!kdf, kdf })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    return withFileLock('kdf:' + session.tj, async () => {
      const existing = readJson<KdfParams | null>(tjDataDir(session.tj, 'kdf.json'), null)
      if (existing) return jsonResponse({ exists: true, kdf: existing })
      const kdf: KdfParams = {
        salt: crypto.randomBytes(16).toString('base64url'),
        iterations: 600_000,
        alg: 'PBKDF2-SHA256',
        createdAt: new Date().toISOString(),
        createdBy: session.u,
      }
      writeJson(tjDataDir(session.tj, 'kdf.json'), kdf)
      return jsonResponse({ exists: true, kdf, created: true })
    })
  })
}
