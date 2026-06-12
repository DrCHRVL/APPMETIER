import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { assertVaultAccess } from '@/lib/server/tribunalGuard'
import { readVaultVersion, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string, file: string } }) {
  return handle(async () => {
    const session = requireSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    assertVaultAccess(session.u, params.name)
    const envelope = readVaultVersion(params.name, decodeURIComponent(params.file))
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}
