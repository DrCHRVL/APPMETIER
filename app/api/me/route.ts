import { getSession, jsonResponse, findAccount, accountTjs, handle, isTjAdmin } from '@/lib/server/auth'
import { findTj, listTjs } from '@/lib/server/tj'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handle(async () => {
    const session = getSession(req)
    if (!session) return jsonResponse({ authenticated: false }, { status: 401 })
    const account = findAccount(session.u)
    // compte supprimé ou suspendu : la session ne vaut plus rien (retour à la connexion)
    if (!account || account.suspendu) return jsonResponse({ authenticated: false, suspendu: !!account?.suspendu }, { status: 401 })
    const registry = listTjs()
    const nameOf = (id: string) => registry.find((t) => t.id === id)?.name || id
    const myTjs = account ? accountTjs(account) : [session.tj]
    const activeTj = findTj(session.tj)
    return jsonResponse({
      authenticated: true,
      username: session.u,
      displayName: account?.displayName || session.u,
      role: session.r,
      tjAdmin: isTjAdmin(account, session.tj),
      tj: { id: session.tj, name: activeTj?.name || session.tj },
      tjs: myTjs.map((id) => ({ id, name: nameOf(id) })),
    })
  })
}
