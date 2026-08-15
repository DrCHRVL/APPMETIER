import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { readVaultVersion, isSafeName } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { name: string, file: string } }) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (!isSafeName(params.name)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    // Un pourcentage isolé fait lever URIError : on retombe sur le segment brut,
    // rejeté juste après en 400 plutôt que de remonter en 500.
    let file: string
    try { file = decodeURIComponent(params.file) } catch { file = params.file }
    if (!/^[\w.~-]+\.json$/.test(file) || file.includes('..')) {
      return jsonResponse({ error: 'Fichier invalide' }, { status: 400 })
    }
    // Historique d'un trousseau personnel : réservé au titulaire (le titulaire
    // seul y a accès — les administrateurs en sont volontairement exclus).
    const keyring = /^keyring-(.+)$/.exec(params.name)
    if (keyring && keyring[1] !== session.u) {
      return jsonResponse({ error: 'Lecture non autorisée sur ce trousseau' }, { status: 403 })
    }
    const envelope = readVaultVersion(session.tj, params.name, file)
    if (!envelope) return jsonResponse({ exists: false }, { status: 404 })
    return jsonResponse({ exists: true, envelope })
  })
}
