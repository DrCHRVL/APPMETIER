/**
 * Actes rédigés d'un dossier (« Atelier ») — enveloppes chiffrées déchiffrées
 * par le navigateur de l'administrateur. Admin du TJ confié uniquement.
 * GET  ?numero=      → liste des productions (enveloppes)
 * GET  ?sommaire=1   → dossiers ayant des actes, en une enveloppe (page « Assistant de justice »)
 * PUT  {numero,id,envelope} → édition manuelle (navigateur chiffre, service stocke)
 * DELETE ?numero=&id= → suppression (réversible côté service)
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch, readProductionEnvelopes, readProductionDossiers } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const params = new URL(req.url).searchParams
    // Sommaire de tous les dossiers. Service endormi : un échantillon par
    // répertoire, que le navigateur déchiffre pour nommer le dossier — les actes
    // restent consultables en lecture seule, comme ci-dessous.
    if (params.get('sommaire')) {
      const res = await attacheFetch('/productions/sommaire')
      const data = await res.json().catch(() => ({}))
      if (!res.ok && (data as { injoignable?: boolean })?.injoignable) {
        return jsonResponse({ dossiers: readProductionDossiers(), degrade: true }, { status: 200 })
      }
      return jsonResponse(data, { status: res.status })
    }
    const numero = params.get('numero') || ''
    const res = await attacheFetch('/productions?numero=' + encodeURIComponent(numero))
    const data = await res.json().catch(() => ({ productions: [] }))
    // Service endormi : les enveloppes sont sur le volume partagé, l'app les
    // lit elle-même. Les actes rédigés RESTENT donc consultables (le navigateur
    // les déchiffre) — `degrade` prévient que rien ne peut être modifié tant
    // que le service ne répond pas.
    if (!res.ok && (data as { injoignable?: boolean })?.injoignable) {
      const productions = readProductionEnvelopes(numero)
      return jsonResponse({ productions, degrade: true }, { status: 200 })
    }
    return jsonResponse(data, { status: res.status })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const body = await req.json().catch(() => null) as { numero?: string, id?: string, envelope?: unknown } | null
    if (!body?.numero || !body?.id || !body?.envelope) return jsonResponse({ error: 'numero, id, envelope requis' }, { status: 400 })
    const res = await attacheFetch('/production', { method: 'PUT', body })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const u = new URL(req.url)
    const res = await attacheFetch('/production?numero=' + encodeURIComponent(u.searchParams.get('numero') || '') + '&id=' + encodeURIComponent(u.searchParams.get('id') || ''), { method: 'DELETE' })
    return jsonResponse(await res.json().catch(() => ({ ok: false })), { status: res.status })
  })
}
