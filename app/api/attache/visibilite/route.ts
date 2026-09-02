/**
 * Interrupteur « fonctionnalités IA » du tribunal ACTIF — administrateur seul.
 *
 * Coché, tout ce qui relève de l'attaché disparaît de l'application (menu,
 * page, raccourci, actes rédigés, chat de dossier, boutons attaché de la
 * cartographie) ; seul l'onglet « Attaché IA » des paramètres demeure, sans
 * quoi l'interrupteur ne pourrait plus être rouvert.
 *
 * Le drapeau est tenu par l'APP, dans l'espace du TJ actif : il se règle même
 * service attaché éteint, et il vaut sur tous les appareils du magistrat.
 */
import { handle, jsonResponse, requireTjSession } from '@/lib/server/auth'
import { readIaMasquee, writeIaMasquee } from '@/lib/server/attache'

export const dynamic = 'force-dynamic'

function requireAdmin(req: Request) {
  const session = requireTjSession(req)
  if (session.r !== 'admin') {
    throw new Response(JSON.stringify({ error: 'Introuvable' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    })
  }
  return session
}

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    return jsonResponse({ masque: readIaMasquee(session.tj) })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireAdmin(req)
    const body = await req.json().catch(() => null) as { masque?: unknown } | null
    if (typeof body?.masque !== 'boolean') return jsonResponse({ error: 'masque (booléen) requis' }, { status: 400 })
    await writeIaMasquee(session.tj, body.masque, session.u)
    return jsonResponse({ ok: true, masque: body.masque })
  })
}
