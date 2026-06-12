'use client'

/**
 * SIRAL — porte d'entrée web.
 * Affichée uniquement en mode navigateur (jamais dans Electron ni en mode
 * consultation). Enchaîne : connexion passkey → déverrouillage E2EE →
 * installation du pont electronAPI → rendu de l'application.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { startRegistration, startAuthentication } from '@simplewebauthn/browser'
import { deriveKey, encryptJson, decryptJson, CipherEnvelope } from '@/lib/web/crypto'
import { buildWebBridge, BridgeIdentity } from '@/lib/web/bridge'
import { idb } from '@/lib/web/idb'

type Phase = 'boot' | 'login' | 'register' | 'unlock' | 'create-passphrase' | 'ready'

const KEY_STORE = '__siral_cryptokey__'

declare global {
  interface Window {
    __SIRAL_WEB__?: boolean
    __SIRAL_BRIDGE_SET__?: (bridge: Record<string, unknown>) => void
    __APP_READONLY__?: boolean
    electronAPI?: Record<string, unknown>
  }
}

async function apiJson(path: string, body?: unknown, method?: string): Promise<{ status: number, json: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  let json: Record<string, unknown> = {}
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

export function WebGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('boot')
  // Rendu initial identique côté serveur et client (sinon erreur d'hydratation) :
  // tant que `mounted` est faux, on rend un voile neutre, jamais l'app.
  const [mounted, setMounted] = useState(false)
  const [me, setMe] = useState<BridgeIdentity | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [kdfExists, setKdfExists] = useState(true)
  // formulaire d'enrôlement
  const [regUsername, setRegUsername] = useState('')
  const [regDisplay, setRegDisplay] = useState('')
  const [regCode, setRegCode] = useState('')
  // phrase secrète
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [remember, setRemember] = useState(true)
  const installedRef = useRef(false)

  const isWeb = mounted && window.__SIRAL_WEB__ === true && window.__APP_READONLY__ !== true

  const installBridge = useCallback((key: CryptoKey, identity: BridgeIdentity) => {
    if (installedRef.current) return
    installedRef.current = true
    const bridge = buildWebBridge({ key, me: identity })
    if (window.__SIRAL_BRIDGE_SET__) window.__SIRAL_BRIDGE_SET__(bridge as Record<string, unknown>)
    // enregistre le service worker (PWA / hors-ligne)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    setPhase('ready')
  }, [])

  /** Vérifie la phrase via le coffre-témoin e2ee-check (le crée au premier déverrouillage). */
  const verifyOrCreateCanary = useCallback(async (key: CryptoKey, identity: BridgeIdentity): Promise<true | string> => {
    const { status, json } = await apiJson('/api/vaults/e2ee-check')
    if (status === 404) {
      const envelope = await encryptJson(key, { check: 'siral', createdAt: new Date().toISOString() }, { savedBy: identity.username })
      const put = await fetch('/api/vaults/e2ee-check', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope), credentials: 'same-origin',
      })
      return put.ok ? true : 'Impossible d\'initialiser le coffre sur le serveur'
    }
    if (status !== 200) return 'Serveur injoignable'
    try {
      const payload = await decryptJson<{ check: string }>(key, json.envelope as unknown as CipherEnvelope)
      return payload.check === 'siral' ? true : 'Phrase secrète incorrecte'
    } catch {
      return 'Phrase secrète incorrecte'
    }
  }, [])

  // Boot : session existante ? clé mémorisée ?
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!mounted) return
    if (!isWeb) { setPhase('ready'); return }
    let cancelled = false
    ;(async () => {
      const { status, json } = await apiJson('/api/me')
      if (cancelled) return
      if (status !== 200) { setPhase('login'); return }
      const identity: BridgeIdentity = { username: String(json.username), displayName: String(json.displayName), role: String(json.role) }
      setMe(identity)
      const kdf = await apiJson('/api/kdf')
      if (cancelled) return
      setKdfExists(Boolean(kdf.json.exists))
      // clé mémorisée sur cet appareil ?
      try {
        const stored = await idb.get<CryptoKey>('kv', KEY_STORE)
        if (stored) {
          const ok = await verifyOrCreateCanary(stored, identity)
          if (ok === true) { installBridge(stored, identity); return }
          await idb.del('kv', KEY_STORE)
        }
      } catch {}
      setPhase(kdf.json.exists ? 'unlock' : 'create-passphrase')
    })()
    return () => { cancelled = true }
  }, [mounted, isWeb, installBridge, verifyOrCreateCanary])

  // Session expirée pendant l'utilisation
  useEffect(() => {
    if (!isWeb) return
    const onExpired = () => { window.location.reload() }
    window.addEventListener('siral:session-expired', onExpired)
    return () => window.removeEventListener('siral:session-expired', onExpired)
  }, [isWeb])

  const doLogin = async () => {
    setBusy(true); setError('')
    try {
      const { status, json } = await apiJson('/api/auth/login-options', {})
      if (status !== 200) throw new Error(String(json.error || 'Erreur serveur'))
      const assertion = await startAuthentication(json as never)
      const verify = await apiJson('/api/auth/login-verify', { response: assertion })
      if (verify.status !== 200) throw new Error(String(verify.json.error || 'Authentification refusée'))
      const identity: BridgeIdentity = { username: String(verify.json.username), displayName: String(verify.json.displayName), role: String(verify.json.role) }
      setMe(identity)
      const kdf = await apiJson('/api/kdf')
      setKdfExists(Boolean(kdf.json.exists))
      setPhase(kdf.json.exists ? 'unlock' : 'create-passphrase')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la connexion')
    } finally { setBusy(false) }
  }

  const doRegister = async () => {
    setBusy(true); setError('')
    try {
      const { status, json } = await apiJson('/api/auth/register-options', {
        username: regUsername.trim(), displayName: regDisplay.trim() || regUsername.trim(), setupCode: regCode.trim(),
      })
      if (status !== 200) throw new Error(String(json.error || 'Enrôlement refusé'))
      const attestation = await startRegistration(json as never)
      const verify = await apiJson('/api/auth/register-verify', {
        username: regUsername.trim(), displayName: regDisplay.trim() || regUsername.trim(), response: attestation,
      })
      if (verify.status !== 200) throw new Error(String(verify.json.error || 'Vérification échouée'))
      const identity: BridgeIdentity = { username: String(verify.json.username), displayName: String(verify.json.displayName), role: String(verify.json.role) }
      setMe(identity)
      const kdf = await apiJson('/api/kdf')
      setKdfExists(Boolean(kdf.json.exists))
      setPhase(kdf.json.exists ? 'unlock' : 'create-passphrase')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enrôlement")
    } finally { setBusy(false) }
  }

  const doUnlock = async (creating: boolean) => {
    if (!me) return
    setBusy(true); setError('')
    try {
      if (creating) {
        if (pass1.length < 12) throw new Error('12 caractères minimum — choisissez une vraie phrase (ex. quatre mots aléatoires)')
        if (pass1 !== pass2) throw new Error('Les deux saisies ne correspondent pas')
        await apiJson('/api/kdf', {})
      }
      const kdf = await apiJson('/api/kdf')
      const params = kdf.json.kdf as { salt: string, iterations: number } | null
      if (!params) throw new Error('Paramètres de chiffrement indisponibles')
      const key = await deriveKey(pass1, params.salt, params.iterations)
      const ok = await verifyOrCreateCanary(key, me)
      if (ok !== true) throw new Error(ok)
      if (remember) { try { await idb.set('kv', KEY_STORE, key) } catch {} }
      setPass1(''); setPass2('')
      installBridge(key, me)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Déverrouillage impossible')
    } finally { setBusy(false) }
  }

  if (!mounted) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(900px 600px at 30% 20%, #224636, #0e1c14 70%)' }} />
    )
  }
  if (!isWeb || phase === 'ready') return <>{children}</>

  return (
    <div className="siral-gate">
      <style>{`
        .siral-gate { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(900px 600px at 30% 20%, #224636, #0e1c14 70%); font-family: Inter, 'Segoe UI', sans-serif; }
        .siral-card { width: 400px; max-width: calc(100vw - 32px); background: #fbfcfb; border-radius: 18px; padding: 30px 30px 24px;
          box-shadow: 0 30px 70px rgba(0,0,0,.5); }
        .siral-brand { display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }
        .siral-mark { width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(140deg,#4d8a6c,#2B5746);
          display: flex; align-items: center; justify-content: center; color: #fff; font-size: 21px; font-weight: 700; font-family: Georgia, serif; }
        .siral-name { font-size: 17px; font-weight: 800; color: #15201b; }
        .siral-sub { font-size: 11px; color: #5b6b63; }
        .siral-title { font-size: 15px; font-weight: 700; color: #15201b; margin: 4px 0 2px; }
        .siral-text { font-size: 12.5px; color: #5b6b63; line-height: 1.5; margin-bottom: 14px; }
        .siral-btn { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px; background: #1c3a2c; color: #fff;
          border: none; border-radius: 11px; padding: 13px 16px; font-size: 13.5px; font-weight: 700; cursor: pointer; margin-top: 8px; }
        .siral-btn:disabled { opacity: .6; cursor: wait; }
        .siral-btn.ghost { background: #fff; color: #15201b; border: 1px solid #e3e8e4; font-weight: 600; }
        .siral-input { width: 100%; box-sizing: border-box; border: 1px solid #d8e0da; border-radius: 10px; padding: 11px 13px;
          font-size: 13.5px; margin-top: 8px; background: #fff; color: #15201b; }
        .siral-input:focus { outline: 2px solid #2B5746; border-color: transparent; }
        .siral-error { background: #fde8e8; color: #b91c1c; border-radius: 9px; padding: 9px 12px; font-size: 12px; margin-top: 10px; }
        .siral-note { display: flex; gap: 9px; background: #f1f7f3; border: 1px solid #d6e6dc; border-radius: 10px; padding: 10px 12px;
          font-size: 11px; color: #3c5247; line-height: 1.45; margin-top: 12px; }
        .siral-link { font-size: 12px; color: #2B5746; font-weight: 600; cursor: pointer; text-align: center; display: block; margin-top: 14px; background: none; border: none; width: 100%; }
        .siral-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #5b6b63; margin-top: 12px; }
        .siral-foot { text-align: center; font-size: 10px; color: #93a29a; margin-top: 16px; }
        .siral-user { font-size: 12px; color: #5b6b63; background: #f1f7f3; border-radius: 99px; padding: 4px 12px; display: inline-block; margin-bottom: 10px; }
      `}</style>
      <div className="siral-card">
        <div className="siral-brand">
          <div className="siral-mark">S</div>
          <div>
            <div className="siral-name">SIRAL</div>
            <div className="siral-sub">Suivi Intégré des Réseaux criminels et Affaires Liées</div>
          </div>
        </div>

        {phase === 'boot' && <div className="siral-text">Chargement…</div>}

        {phase === 'login' && (
          <>
            <div className="siral-title">Connexion</div>
            <div className="siral-text">Espace réservé aux membres habilités. Authentification par passkey (Windows Hello, Face ID ou clé de sécurité).</div>
            <button className="siral-btn" onClick={doLogin} disabled={busy}>
              {busy ? 'Vérification…' : 'Se connecter avec une passkey'}
            </button>
            <button className="siral-link" onClick={() => { setError(''); setPhase('register') }}>
              Premier accès sur cet appareil ? Enrôler une passkey
            </button>
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'register' && (
          <>
            <div className="siral-title">Enrôlement</div>
            <div className="siral-text">Réservé aux membres du service munis du code d&apos;enrôlement. Utilisez votre identifiant habituel (le même que dans l&apos;app du service).</div>
            <input className="siral-input" placeholder="Identifiant (ex. a.chevalier)" value={regUsername} onChange={(e) => setRegUsername(e.target.value)} autoCapitalize="none" />
            <input className="siral-input" placeholder="Nom affiché (ex. A. Chevalier)" value={regDisplay} onChange={(e) => setRegDisplay(e.target.value)} />
            <input className="siral-input" placeholder="Code d'enrôlement" value={regCode} onChange={(e) => setRegCode(e.target.value)} />
            <button className="siral-btn" onClick={doRegister} disabled={busy || !regUsername.trim() || !regCode.trim()}>
              {busy ? 'Création…' : 'Créer ma passkey'}
            </button>
            <button className="siral-link" onClick={() => { setError(''); setPhase('login') }}>← Retour à la connexion</button>
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {(phase === 'unlock' || phase === 'create-passphrase') && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}</span>}
            <div className="siral-title">{phase === 'unlock' ? 'Déverrouillage du coffre chiffré' : 'Création du coffre chiffré'}</div>
            <div className="siral-text">
              {phase === 'unlock'
                ? 'Votre phrase secrète déchiffre les données localement, dans ce navigateur. Elle n’est jamais transmise au serveur.'
                : 'Choisissez la phrase secrète du service. Elle chiffrera toutes les données avant leur envoi au serveur. Elle est partagée par les membres du service.'}
            </div>
            <input className="siral-input" type="password" placeholder="Phrase secrète" value={pass1}
              onChange={(e) => setPass1(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && phase === 'unlock') doUnlock(false) }} />
            {phase === 'create-passphrase' && (
              <input className="siral-input" type="password" placeholder="Confirmez la phrase secrète" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            )}
            <label className="siral-check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Rester déverrouillé sur cet appareil
            </label>
            <button className="siral-btn" onClick={() => doUnlock(phase === 'create-passphrase')} disabled={busy || !pass1}>
              {busy ? 'Déchiffrement…' : phase === 'unlock' ? 'Déverrouiller' : 'Créer le coffre'}
            </button>
            {phase === 'create-passphrase' && (
              <div className="siral-note">
                <span><b>Cette phrase est irrécupérable.</b> Personne — ni l&apos;hébergeur, ni le développeur — ne peut la réinitialiser.
                Notez-la sur le kit de récupération papier et conservez-le sous scellé au service.</span>
              </div>
            )}
            {!kdfExists && phase === 'unlock' && (
              <div className="siral-note"><span>Premier démarrage : le coffre n&apos;existe pas encore sur ce serveur.</span></div>
            )}
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        <div className="siral-foot">Chiffrement de bout en bout · hébergement UE · journal d&apos;accès</div>
      </div>
    </div>
  )
}
