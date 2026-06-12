import { handle, jsonResponse } from '@/lib/server/auth'
import { authenticationOptions } from '@/lib/server/webauthn'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}))
    try {
      const options = await authenticationOptions(req, body.username ? String(body.username) : undefined)
      return jsonResponse(options)
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'Erreur' }, { status: 400 })
    }
  })
}
