/**
 * Rappels d'échéances par notification push.
 *  GET    : clé publique VAPID + état de l'abonnement de l'utilisateur
 *  POST   : enregistrer la souscription du navigateur/iPhone
 *  PUT    : remplacer le calendrier de rappels (horodatages SEULEMENT — E2EE)
 *  DELETE : désactiver les rappels sur tous les appareils de l'utilisateur
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { pushPublicKey, saveSubscription, saveSchedule, removeSubscriptions, hasSubscription, ensurePushLoop } from '@/lib/server/push'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    ensurePushLoop()
    return jsonResponse({ publicKey: pushPublicKey(), subscribed: hasSubscription(session.u) })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    ensurePushLoop()
    const { subscription } = await req.json()
    await saveSubscription(session.u, subscription)
    return jsonResponse({ ok: true })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    ensurePushLoop()
    const { times } = await req.json()
    if (!Array.isArray(times) || times.length > 1000) return jsonResponse({ error: 'times invalide' }, { status: 400 })
    const kept = await saveSchedule(session.u, times.map(Number))
    return jsonResponse({ ok: true, kept })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    await removeSubscriptions(session.u)
    return jsonResponse({ ok: true })
  })
}
