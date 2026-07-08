import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { readVaultVersion, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string, file: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    // Historique d'un trousseau personnel : réservé au titulaire (ou admin).
    const keyring = /^keyring-(.+)$/.exec(params.name)
    if (keyring && keyring[1] !== session.u) {
      return jsonResponse({ error: 'Lecture non autorisée sur ce trousseau' }, { status: 403 })
    }
    const envelope = readVaultVersion(session.tj, params.name, decodeURIComponent(params.file))
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}
