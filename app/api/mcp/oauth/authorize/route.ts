/**
 * Endpoint d'autorisation OAuth du connecteur Claude web.
 *
 * GET  : ouvre la page d'autorisation dans le navigateur du magistrat —
 *        session ADMIN du TJ confié exigée (sinon invitation à se connecter
 *        dans SIRAL), puis écran de consentement explicite.
 * POST : approbation (fetch depuis la page, même origine) — vérifie la
 *        capsule HMAC anti-CSRF puis répond { redirect } ; la page navigue
 *        elle-même vers claude.ai (compatible avec la CSP stricte : un 302
 *        vers un domaine tiers après un POST de formulaire serait bloqué
 *        par form-action 'self').
 *
 * Aucune redirection vers un redirect_uri non enregistré, jamais.
 */
import { handle, jsonResponse, getSession, findAccount, accountTjs, rateLimit, clientIp } from '@/lib/server/auth'
import { attacheTjId } from '@/lib/server/attache'
import {
  connectorActive, findClient, createAuthCode, signConsent, verifyConsent, logAuthorization,
} from '@/lib/server/mcpConnector'

export const dynamic = 'force-dynamic'

const esc = (s: string) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Valeur sûre pour un littéral JS embarqué dans une balise <script>. */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

function page(title: string, body: string, script = ''): Response {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — SIRAL</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background: #f3f4f6; color: #111827; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,.06); max-width: 460px; width: 100%; padding: 28px; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
  .brand .logo { width: 34px; height: 34px; border-radius: 9px; background: #2B5746; color: #fff;
                 display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .brand b { font-size: 15px; letter-spacing: .02em; }
  h1 { font-size: 17px; margin-bottom: 10px; }
  p { font-size: 13px; line-height: 1.55; color: #4b5563; margin-bottom: 10px; }
  ul { margin: 10px 0 14px 18px; }
  li { font-size: 12.5px; color: #4b5563; margin-bottom: 5px; }
  .who { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px;
         padding: 10px 12px; font-size: 12.5px; color: #374151; margin-bottom: 14px; }
  .row { display: flex; gap: 10px; margin-top: 16px; }
  button, .btn { flex: 1; border: 0; border-radius: 10px; padding: 11px 14px; font-size: 13.5px;
          font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; display: block; }
  .ok { background: #2B5746; color: #fff; }
  .ok:hover { background: #234737; }
  .no { background: #fff; color: #374151; border: 1px solid #d1d5db; }
  .no:hover { background: #f9fafb; }
  .note { font-size: 11px; color: #9ca3af; margin-top: 14px; }
  .err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
         border-radius: 10px; padding: 10px 12px; font-size: 12.5px; display: none; margin-top: 12px; }
</style>
</head>
<body>
<div class="card">
  <div class="brand"><div class="logo">S</div><b>SIRAL</b></div>
  ${body}
</div>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  })
}

/** Session ADMIN du TJ confié à l'attaché — même exigence que requireAttacheAdmin, sans lever. */
function adminSession(req: Request): { u: string } | null {
  const s = getSession(req)
  if (!s || s.r !== 'admin' || s.tj !== attacheTjId()) return null
  const account = findAccount(s.u)
  if (!account || account.role !== 'admin' || !accountTjs(account).includes(attacheTjId())) return null
  return { u: s.u }
}

export async function GET(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    rateLimit('mcp-authorize:' + clientIp(req), 60, 5 * 60 * 1000)

    const url = new URL(req.url)
    const q = url.searchParams
    const clientId = q.get('client_id') || ''
    const redirectUri = q.get('redirect_uri') || ''
    const state = q.get('state') || ''
    const challenge = q.get('code_challenge') || ''
    const method = q.get('code_challenge_method') || ''
    const responseType = q.get('response_type') || ''

    // Client et redirect_uri d'abord : sans correspondance EXACTE avec
    // l'enregistrement, on ne redirige jamais (page d'erreur neutre).
    const client = clientId ? findClient(clientId) : null
    if (!client || !client.redirectUris.includes(redirectUri)) {
      return page('Demande invalide', `
        <h1>Demande d'autorisation invalide</h1>
        <p>Le client OAuth est inconnu ou l'adresse de retour ne correspond pas à son enregistrement.
        Relancez la connexion depuis Claude ; si le problème persiste, révoquez puis recréez le
        connecteur dans les paramètres de Claude.</p>`)
    }

    // redirect_uri valide : les autres erreurs remontent au client en OAuth standard.
    const back = (error: string, description: string) => {
      const target = new URL(redirectUri)
      target.searchParams.set('error', error)
      target.searchParams.set('error_description', description)
      if (state) target.searchParams.set('state', state)
      return Response.redirect(target.toString(), 302)
    }
    if (responseType !== 'code') return back('unsupported_response_type', 'response_type=code requis')
    if (!challenge || (method && method !== 'S256')) return back('invalid_request', 'PKCE S256 requis (code_challenge)')

    const admin = adminSession(req)
    if (!admin) {
      // Pas de session admin sur le TJ confié : on invite à ouvrir SIRAL dans
      // un autre onglet (même navigateur → cookie posé), puis à réessayer ici.
      return page('Connexion requise', `
        <h1>Connexion administrateur requise</h1>
        <p><b>Claude</b> demande à se connecter à SIRAL. Cette autorisation est réservée à
        l'<b>administrateur</b>, connecté sur le tribunal confié à l'attaché.</p>
        <p>Ouvrez SIRAL dans un nouvel onglet, connectez-vous (passkey), puis revenez ici et réessayez.</p>
        <div class="row">
          <a class="btn no" href="/" target="_blank" rel="opener">Ouvrir SIRAL</a>
          <button class="ok" onclick="location.reload()">J'ai ouvert ma session — réessayer</button>
        </div>
        <p class="note">Si vous n'êtes pas l'administrateur de SIRAL, fermez simplement cette page.</p>`)
    }

    const consent = signConsent({ c: client.id, r: redirectUri, ch: challenge, st: state })
    const params = { decision: '', consent, client_id: client.id, redirect_uri: redirectUri, state, code_challenge: challenge }
    return page('Autoriser Claude', `
      <h1>Autoriser « ${esc(client.name)} » ?</h1>
      <div class="who">Compte : <b>${esc(admin.u)}</b> · tribunal confié : <b>${esc(attacheTjId())}</b></div>
      <p>Claude (claude.ai) obtiendra, <b>en votre nom</b>, les outils de l'attaché sur le contentieux confié :</p>
      <ul>
        <li>lecture des dossiers, pièces, chronologies, statistiques ;</li>
        <li>écritures <b>réversibles et versionnées</b> (actes, CR, à-faire, NATINF…) — signées de votre nom ;</li>
        <li>chaque écriture est <b>journalisée</b> dans votre audit (contexte « connecteur »).</li>
      </ul>
      <p>Personne d'autre que vous ne peut accorder ni utiliser cet accès. Révocable à tout moment :
      Paramètres → Attaché → Connecteur Claude web.</p>
      <div class="row">
        <button class="no" id="deny">Refuser</button>
        <button class="ok" id="allow">Autoriser</button>
      </div>
      <div class="err" id="err"></div>
      <p class="note">En autorisant, un code à usage unique est remis à Claude, puis échangé contre des
      jetons propres à ce connecteur (révocables, expirants).</p>`,
      `
      var P = ${js(params)};
      function decide(decision) {
        document.getElementById('allow').disabled = true;
        document.getElementById('deny').disabled = true;
        fetch(location.pathname, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(Object.assign({}, P, { decision: decision })),
        }).then(function (r) { return r.json(); }).then(function (out) {
          if (out && out.redirect) { location.href = out.redirect; return; }
          throw new Error(out && out.error ? out.error : 'Réponse inattendue');
        }).catch(function (e) {
          var el = document.getElementById('err');
          el.textContent = 'Échec : ' + e.message + ' — rechargez la page et réessayez.';
          el.style.display = 'block';
          document.getElementById('allow').disabled = false;
          document.getElementById('deny').disabled = false;
        });
      }
      document.getElementById('allow').addEventListener('click', function () { decide('allow'); });
      document.getElementById('deny').addEventListener('click', function () { decide('deny'); });
      `)
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!connectorActive()) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    rateLimit('mcp-authorize:' + clientIp(req), 60, 5 * 60 * 1000)

    const admin = adminSession(req)
    if (!admin) return jsonResponse({ error: 'Session administrateur requise — rechargez la page' }, { status: 401 })

    const body = await req.json().catch(() => null) as {
      decision?: string, consent?: string, client_id?: string,
      redirect_uri?: string, state?: string, code_challenge?: string,
    } | null
    if (!body) return jsonResponse({ error: 'Corps JSON requis' }, { status: 400 })

    // La capsule signée doit correspondre EXACTEMENT aux paramètres re-soumis.
    const sealed = verifyConsent(String(body.consent || ''))
    if (!sealed
      || sealed.c !== String(body.client_id || '')
      || sealed.r !== String(body.redirect_uri || '')
      || sealed.ch !== String(body.code_challenge || '')
      || sealed.st !== String(body.state || '')) {
      return jsonResponse({ error: 'Demande expirée ou altérée — rechargez la page' }, { status: 400 })
    }
    const client = findClient(sealed.c)
    if (!client || !client.redirectUris.includes(sealed.r)) {
      return jsonResponse({ error: 'Client inconnu ou adresse de retour non enregistrée' }, { status: 400 })
    }

    const target = new URL(sealed.r)
    if (body.decision !== 'allow') {
      target.searchParams.set('error', 'access_denied')
      target.searchParams.set('error_description', 'Refusé par l\'administrateur')
      if (sealed.st) target.searchParams.set('state', sealed.st)
      return jsonResponse({ redirect: target.toString() })
    }

    const code = await createAuthCode({
      clientId: client.id,
      redirectUri: sealed.r,
      challenge: sealed.ch,
      user: admin.u,
    })
    await logAuthorization(admin.u, client.name)
    target.searchParams.set('code', code)
    if (sealed.st) target.searchParams.set('state', sealed.st)
    return jsonResponse({ redirect: target.toString() })
  })
}
