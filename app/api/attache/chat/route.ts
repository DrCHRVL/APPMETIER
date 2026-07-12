/**
 * Chat avec l'attaché — relais SSE vers le service attaché (sidecar).
 * Le flux (deltas de texte, outils appelés, fin de run) transite tel quel ;
 * l'app ne stocke rien : le transcript chiffré vit chez le service.
 */
import crypto from 'crypto'
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'
export const maxDuration = 1800

function bridgeSecret(): string | null {
  if (process.env.SIRAL_ATTACHE_BRIDGE_SECRET) return process.env.SIRAL_ATTACHE_BRIDGE_SECRET
  if (process.env.SIRAL_SECRET) {
    return crypto.createHash('sha256').update('attache-bridge:' + process.env.SIRAL_SECRET).digest('hex')
  }
  return null
}

export async function POST(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const secret = bridgeSecret()
    if (!secret) return jsonResponse({ error: 'Service non configuré' }, { status: 503 })
    const body = await req.json().catch(() => null)
    if (!body || typeof body.message !== 'string' || !body.message.trim()) {
      return jsonResponse({ error: 'Message requis' }, { status: 400 })
    }
    const url = (process.env.SIRAL_ATTACHE_URL || '').replace(/\/+$/, '') + '/chat'
    // Pas de timeout court ici : un run d'agent peut durer plusieurs minutes.
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-attache-secret': secret },
      body: JSON.stringify({ message: body.message, convId: body.convId || undefined, dossier: body.dossier || undefined, cadre: body.cadre || undefined, carto: body.carto || undefined }),
      cache: 'no-store',
      // @ts-expect-error duplex requis par Node pour les corps streamés
      duplex: 'half',
    }).catch(() => null)

    if (!upstream) return jsonResponse({ error: 'Service attaché injoignable' }, { status: 503 })
    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({ error: 'Erreur du service attaché' }))
      return jsonResponse(data, { status: upstream.status })
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    })
  })
}
