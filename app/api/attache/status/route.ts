/**
 * Statut de l'attaché de justice — administrateur du TJ confié uniquement.
 * Si la fonctionnalité n'est pas activée (SIRAL_ATTACHE_URL absent) : 404,
 * indistinguable d'une route inexistante.
 *
 * `?sonde=1` : SONDE DE PRÉSENCE (celle qui décide d'afficher ou non le module
 * dans l'interface). Elle interroge la version brève du /status du service —
 * pas de `claude --version` à lancer, pas de statistiques de boîte à lire — et
 * n'attend que 8 s. Un service occupé par un run de nuit ne faisait sinon plus
 * disparaître l'assistant que par lenteur : 30 s d'attente, abandon, 503.
 */
import { handle, jsonResponse } from '@/lib/server/auth'
import { requireAttacheAdmin, attacheFetch } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    requireAttacheAdmin(req)
    const sonde = new URL(req.url).searchParams.get('sonde') === '1'
    const res = await attacheFetch(sonde ? '/status?bref=1' : '/status', sonde ? { timeoutMs: 8_000 } : undefined)
    const data = await res.json().catch(() => ({ error: 'Réponse illisible' }))
    // Une réponse d'erreur du SERVICE (401 de secret dépareillé, 500 interne)
    // vaut « service présent mais hors d'état » : on le dit explicitement, pour
    // que le navigateur garde le module visible avec son écran de diagnostic.
    if (!res.ok && data && typeof data === 'object' && !('injoignable' in data)) {
      return jsonResponse({ ...data, injoignable: true }, { status: res.status })
    }
    return jsonResponse(data, { status: res.status })
  })
}
