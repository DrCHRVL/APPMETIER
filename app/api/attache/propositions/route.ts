/**
 * Propositions de l'attaché (nouveau MEC détecté, acte pré-construit, CR en
 * prise de notes) — en attente du ✓/✗ de l'administrateur. À la validation,
 * l'écriture est signée de SON nom (aucune trace de l'assistant).
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const numero = new URL(req.url).searchParams.get('numero')
    const res = await attacheFetch('/propositions' + (numero ? '?numero=' + encodeURIComponent(numero) : ''))
    return jsonResponse(await res.json().catch(() => ({ propositions: [] })), { status: res.status })
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { id?: string, action?: string, motif?: string } | null
    if (!body?.id || (body.action !== 'valider' && body.action !== 'refuser')) {
      return jsonResponse({ error: 'id et action (valider|refuser) requis' }, { status: 400 })
    }
    const res = await attacheFetch('/propositions/decide', {
      method: 'POST',
      // motif (facultatif, refus seulement) : capté comme signal d'apprentissage
      body: { id: body.id, action: body.action, par: session.u, motif: typeof body.motif === 'string' ? body.motif.slice(0, 320) : undefined },
      timeoutMs: 60_000,
    })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
