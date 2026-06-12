import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { listVaultVersions, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    requireSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    return jsonResponse({ versions: listVaultVersions(params.name) })
  })
}
