/**
 * Paramètres de dérivation de la clé E2EE (sel + itérations PBKDF2).
 * Le sel est public (il ne protège pas seul), la phrase secrète ne transite jamais.
 * POST : création au premier déverrouillage (un seul jeu de paramètres par serveur).
 */
import crypto from 'crypto'
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { dataDir, readJson, writeJson, withFileLock } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface KdfParams { salt: string, iterations: number, alg: 'PBKDF2-SHA256', createdAt: string, createdBy: string }

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    const kdf = readJson<KdfParams | null>(dataDir('kdf.json'), null)
    return jsonResponse({ exists: !!kdf, kdf })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    return withFileLock('kdf', async () => {
      const existing = readJson<KdfParams | null>(dataDir('kdf.json'), null)
      if (existing) return jsonResponse({ exists: true, kdf: existing })
      const kdf: KdfParams = {
        salt: crypto.randomBytes(16).toString('base64url'),
        iterations: 600_000,
        alg: 'PBKDF2-SHA256',
        createdAt: new Date().toISOString(),
        createdBy: session.u,
      }
      writeJson(dataDir('kdf.json'), kdf)
      return jsonResponse({ exists: true, kdf, created: true })
    })
  })
}
