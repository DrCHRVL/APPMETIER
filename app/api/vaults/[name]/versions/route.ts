import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { listVaultVersions, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string } }) {
  return handle(async () => {
    const session = requireSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    // Historique d'un trousseau personnel : réservé au titulaire (ou admin).
    const keyring = /^keyring-(.+)$/.exec(params.name)
    if (keyring && keyring[1] !== session.u && session.r !== 'admin') {
      return jsonResponse({ error: 'Lecture non autorisée sur ce trousseau' }, { status: 403 })
    }
    return jsonResponse({ versions: listVaultVersions(params.name) })
  })
}
