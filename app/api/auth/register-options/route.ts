import { handle, jsonResponse } from '@/lib/server/auth'
import { registrationOptions } from '@/lib/server/webauthn'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const { username, displayName, setupCode } = await req.json()
    try {
      const options = await registrationOptions(req, String(username || ''), String(displayName || ''), String(setupCode || ''))
      return jsonResponse(options)
    } catch (e) {
      // rateLimit() lève une Response 429 : la laisser remonter à handle()
      // au lieu de la transformer en 400 générique.
      if (e instanceof Response) throw e
      return jsonResponse({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 400 })
    }
  })
}
