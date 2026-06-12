import { getSession, jsonResponse, findAccount } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = getSession(req)
  if (!session) return jsonResponse({ authenticated: false }, { status: 401 })
  const account = findAccount(session.u)
  return jsonResponse({
    authenticated: true,
    username: session.u,
    displayName: account?.displayName || session.u,
    role: session.r,
  })
}
