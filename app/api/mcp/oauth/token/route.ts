/**
 * Endpoint de jetons OAuth du connecteur Claude web : échange du code
 * d'autorisation (PKCE S256 obligatoire) et rafraîchissement à rotation
 * stricte. Les jetons sont opaques et stockés hashés côté serveur.
 */
import { handle, jsonResponse, rateLimit, clientIp } from '@/lib/server/auth'
import { connectorActive, findClient, clientAuthOk, exchangeCode, refreshAccess, IssuedTokens } from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

/** Corps form-urlencoded (standard OAuth) ou JSON, au choix du client. */
async function readParams(req: Request): Promise<Record<string, string>> {
  const type = (req.headers.get('content-type') || '').toLowerCase()
  if (type.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(body || {})) out[k] = String(v)
    return out
  }
  const text = await req.text().catch(() => '')
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(text)) out[k] = v
  return out
}

function oauthError(error: string, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description }, {
    status,
    headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
  })
}

function tokenResponse(issued: IssuedTokens): Response {
  return jsonResponse({
    access_token: issued.accessToken,
    token_type: 'Bearer',
    expires_in: issued.expiresIn,
    refresh_token: issued.refreshToken,
    scope: 'siral',
  }, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } })
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    rateLimit('mcp-token:' + clientIp(req), 60, 5 * 60 * 1000)
    const p = await readParams(req)

    // client_secret_basic : identifiants dans l'en-tête Authorization
    let clientId = p.client_id || ''
    let clientSecret = p.client_secret || ''
    const basic = req.headers.get('authorization') || ''
    if (basic.toLowerCase().startsWith('basic ')) {
      try {
        const [id, secret] = Buffer.from(basic.slice(6), 'base64').toString('utf8').split(':')
        if (id) clientId = decodeURIComponent(id)
        if (secret) clientSecret = decodeURIComponent(secret)
      } catch { /* en-tête illisible : les champs du corps font foi */ }
    }

    const client = clientId ? findClient(clientId) : null
    if (!client) return oauthError('invalid_client', 'Client inconnu', 401)
    if (!clientAuthOk(client, clientSecret || null)) {
      return oauthError('invalid_client', 'Authentification du client refusée', 401)
    }

    if (p.grant_type === 'authorization_code') {
      if (!p.code) return oauthError('invalid_request', 'code requis')
      if (!p.code_verifier) return oauthError('invalid_request', 'code_verifier requis (PKCE S256 obligatoire)')
      const out = await exchangeCode({
        code: p.code,
        clientId: client.id,
        redirectUri: p.redirect_uri || '',
        verifier: p.code_verifier,
      })
      if ('error' in out) return oauthError('invalid_grant', out.error)
      return tokenResponse(out)
    }

    if (p.grant_type === 'refresh_token') {
      if (!p.refresh_token) return oauthError('invalid_request', 'refresh_token requis')
      const out = await refreshAccess({ refreshToken: p.refresh_token, clientId: client.id })
      if ('error' in out) return oauthError('invalid_grant', out.error)
      return tokenResponse(out)
    }

    return oauthError('unsupported_grant_type', 'grant_type non géré')
  })
}
