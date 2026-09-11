/**
 * SIRAL — Attaché de justice · état du FLUX TENDU pour UN dossier.
 *
 * Le bandeau du détail d'enquête demande ici « où en est l'attaché sur ce
 * dossier ? » tant qu'il est ouvert. Ne relaie que l'état de la file : attente
 * (avec le temps restant avant le passage), passage en cours, bilan chiffré du
 * dernier passage. Jamais un contenu de pièce, de CR ni de description.
 *
 * Administrateur du TJ confié uniquement, comme toute route attaché : les
 * autres comptes reçoivent le 404 d'une route inexistante, et le bandeau
 * disparaît de lui-même.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

interface Attente { numero: string, depuis: string, raisons: string[], pretDansMs: number }
interface Bilan {
  numero: string, at: string, pieces?: number, enAttente?: number, crs?: number, actes?: number,
  crEcrit?: number, mecProposes?: number, actesProposes?: number, descriptionChangee?: boolean,
  run?: boolean, chantier?: boolean, differe?: boolean, message?: string, erreur?: string,
}

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const numero = (new URL(req.url).searchParams.get('numero') || '').trim()
    const res = await attacheFetch('/flux', { timeoutMs: 5_000 })
    const data = await res.json().catch(() => null) as
      { enAttente?: Attente[], enCours?: string | null, derniers?: Bilan[] } | null
    if (!res.ok || !data) {
      return jsonResponse({ error: 'Service attaché injoignable', injoignable: true }, { status: 503 })
    }
    if (!numero) return jsonResponse(data)
    const ceDossier = (n: unknown) => String(n || '').trim() === numero
    return jsonResponse({
      attente: (data.enAttente || []).find((f) => ceDossier(f.numero)) || null,
      enCours: ceDossier(data.enCours),
      dernier: (data.derniers || []).find((b) => ceDossier(b.numero)) || null,
    })
  })
}
