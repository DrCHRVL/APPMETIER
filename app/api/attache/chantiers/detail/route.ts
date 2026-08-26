/**
 * Détail d'un chantier d'analyse profonde, à la demande (jamais dans le
 * sondage) : journal complet, pochettes dépliées lot par lot avec leurs
 * fiches. Admin du TJ confié uniquement — simple relais vers le service.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const id = new URL(req.url).searchParams.get('id') || ''
    const res = await attacheFetch('/chantiers/detail?id=' + encodeURIComponent(id))
    return jsonResponse(await res.json().catch(() => ({ error: 'Service injoignable' })), { status: res.status })
  })
}
