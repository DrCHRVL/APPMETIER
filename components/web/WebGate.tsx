'use client'

/**
 * SIRAL — porte d'entrée web.
 * Affichée uniquement en mode navigateur (jamais dans Electron ni en mode
 * consultation). Enchaîne : connexion par mot de passe → déverrouillage du
 * trousseau individuel (cloisonnement par clé) → installation du pont
 * electronAPI → rendu de l'application.
 *
 * Parcours possibles après authentification :
 *  - unlock        : mon trousseau existe → phrase personnelle
 *  - redeem        : une invitation m'attend → code + création de ma phrase
 *  - migrate       : serveur historique « phrase de service » sans trousseau
 *                    → migration vers le modèle individuel (+ rotation des
 *                    clés de contentieux pour un vrai cloisonnement)
 *  - create-fresh  : serveur vierge → je suis le premier, clés neuves
 *  - no-access     : pas de trousseau ni d'invitation → demander un accès
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { encryptJson, decryptJson, b64, CipherEnvelope } from '@/lib/web/crypto'
import { buildWebBridge, BridgeIdentity } from '@/lib/web/bridge'
import {
  ScopedKeys, KeyringPayload, buildScopedKeys, freshKeyringPayload, deriveRawKey,
  importAesKey, randomRawKey, newKdfParams, normalizeInvitationCode, KNOWN_CONTENTIEUX, SCOPE_GLOBAL,
} from '@/lib/web/keyring'
import { idb, setIdbNamespace } from '@/lib/web/idb'
import * as offlineMode from '@/lib/web/offlineMode'
import { NetworkStatusManager } from '@/utils/networkStatusManager'

type Phase = 'boot' | 'login' | 'register' | 'unlock' | 'create-fresh' | 'migrate' | 'redeem' | 'no-access' | 'recovery-kit' | 'offline-unlock' | 'ready'

export interface TjInfo { id: string, name: string }

const KEYRING_STORE = '__siral_keyring__'
const LEGACY_KEY_STORE = '__siral_cryptokey__'

interface E2eeState {
  legacyKdf: boolean
  legacyKdfParams: { salt: string, iterations: number } | null
  hasKeyring: boolean
  hasGrant: boolean
  grantKdf: { salt: string, iterations: number, grantedBy?: string } | null
  anyKeyrings: boolean
}

declare global {
  interface Window {
    __SIRAL_WEB__?: boolean
    __SIRAL_BRIDGE_SET__?: (bridge: Record<string, unknown>) => void
    /** TJ actif + TJ accessibles du compte (lu par la sidebar pour le sélecteur). */
    __SIRAL_TJ__?: { active: TjInfo, tjs: TjInfo[] }
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
  const [tj, setTj] = useState<TjInfo | null>(null)
  const [e2ee, setE2ee] = useState<E2eeState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // formulaire d'enrôlement
  const [regUsername, setRegUsername] = useState('')
  const [regDisplay, setRegDisplay] = useState('')
  const [regCode, setRegCode] = useState('')
  // connexion / enrôlement par mot de passe (postes sans Windows Hello)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [regPassword, setRegPassword] = useState('')
  // phrases et code d'invitation
  const [servicePass, setServicePass] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  // Code de déverrouillage hors-ligne (mode « poste préparé », cf. offlineMode)
  const [offlineCode, setOfflineCode] = useState('')
  const installedRef = useRef(false)
  // trousseau prêt mais porte retenue le temps d'imprimer le kit de récupération
  const pendingEntryRef = useRef<{ keys: ScopedKeys, identity: BridgeIdentity, scopes: string[] } | null>(null)

  const isWeb = mounted && window.__SIRAL_WEB__ === true

  const installBridge = useCallback((keys: ScopedKeys, identity: BridgeIdentity) => {
    if (installedRef.current) return
    installedRef.current = true
    const bridge = buildWebBridge({ keys, me: identity })
    if (window.__SIRAL_BRIDGE_SET__) window.__SIRAL_BRIDGE_SET__(bridge as Record<string, unknown>)
    // enregistre le service worker (PWA / hors-ligne)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    // stockage persistant : sans ça, Safari peut effacer IndexedDB (données
    // locales ET sauvegardes) après 7 jours sans visite
    if (navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {})
    }
    setPhase('ready')
  }, [])

  /** Vérifie la clé globale via le coffre-témoin e2ee-check (le crée au premier déverrouillage). */
  const verifyOrCreateCanary = useCallback(async (globalKey: CryptoKey, identity: BridgeIdentity): Promise<true | string> => {
    const { status, json } = await apiJson('/api/vaults/e2ee-check')
    if (status === 404) {
      const envelope = await encryptJson(globalKey, { check: 'siral', createdAt: new Date().toISOString() }, { savedBy: identity.username })
      const put = await fetch('/api/vaults/e2ee-check', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope), credentials: 'same-origin',
      })
      return put.ok ? true : 'Impossible d\'initialiser le coffre sur le serveur'
    }
    if (status !== 200) return 'Serveur injoignable'
    try {
      const payload = await decryptJson<{ check: string }>(globalKey, json.envelope as unknown as CipherEnvelope)
      return payload.check === 'siral' ? true : 'Phrase secrète incorrecte'
    } catch {
      return 'Phrase secrète incorrecte'
    }
  }, [])

  const tryStoredKeyring = useCallback(async (_identity: BridgeIdentity): Promise<boolean> => {
    try {
      await idb.del('kv', LEGACY_KEY_STORE)
      await idb.del('kv', KEYRING_STORE)
    } catch {}
    return false
  }, [])

  /** Chiffre et dépose mon trousseau, verrouillé par ma phrase personnelle. */
  const pushKeyring = useCallback(async (payload: KeyringPayload, personalPhrase: string, identity: BridgeIdentity): Promise<void> => {
    const kdf = newKdfParams()
    const userKey = await importAesKey(await deriveRawKey(personalPhrase, kdf.salt, kdf.iterations))
    const envelope = await encryptJson(userKey, payload, { savedBy: identity.username })
    const res = await fetch(`/api/vaults/keyring-${encodeURIComponent(identity.username)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...envelope, kdfSalt: kdf.salt, kdfIterations: kdf.iterations }),
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error('Dépôt du trousseau refusé (' + res.status + ')')
  }, [])

  const finishUnlock = useCallback(async (payload: KeyringPayload, identity: BridgeIdentity, offerKit = false) => {
    const scoped = await buildScopedKeys(payload)
    const ok = await verifyOrCreateCanary(scoped.global, identity)
    if (ok !== true) throw new Error(ok)
    // Mémoriser la session en mémoire vive : permet de « préparer ce poste »
    // (mode hors-ligne) sans redemander la phrase personnelle. Prolonge aussi
    // la fenêtre hors-ligne si un poste a déjà été préparé.
    const tjState = window.__SIRAL_TJ__
    offlineMode.rememberSession(
      payload,
      { username: identity.username, displayName: identity.displayName, role: identity.role },
      tjState?.active ?? null,
      tjState?.tjs ?? [],
    )
    // Garde la copie hors-ligne à jour tant qu'on se connecte normalement :
    // repousse la fenêtre, rafraîchit les métadonnées et re-scelle le trousseau
    // si les clés ont changé (sinon marque « à re-préparer »). Best-effort.
    offlineMode.autoRefreshOffline().catch(() => {})
    setServicePass(''); setInviteCode(''); setPass1(''); setPass2('')
    if (offerKit) {
      // trousseau tout neuf : proposer le kit de récupération avant d'entrer
      pendingEntryRef.current = { keys: scoped, identity, scopes: Object.keys(payload.keys) }
      setPhase('recovery-kit')
      return
    }
    installBridge(scoped, identity)
  }, [verifyOrCreateCanary, installBridge])

  /** Ouvre la version imprimable du kit de récupération (à compléter à la main). */
  const printRecoveryKit = useCallback(() => {
    const entry = pendingEntryRef.current
    if (!entry) return
    const ctxLabels: Record<string, string> = { 'ctx-crimorg': 'CRIM ORG', 'ctx-ecofi': 'ECOFI', 'ctx-enviro': 'ENVIRO' }
    const scopes = entry.scopes.filter((s) => s !== 'global').map((s) => ctxLabels[s] || s).join(' · ') || '—'
    const w = window.open('', '_blank', 'width=720,height=900')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>SIRAL — Kit de récupération</title>
      <style>
        body { font-family: Georgia, serif; color: #15201b; max-width: 600px; margin: 40px auto; line-height: 1.5; }
        h1 { font-size: 22px; border-bottom: 3px double #15201b; padding-bottom: 10px; }
        .warn { border: 2px solid #b91c1c; padding: 12px 16px; font-weight: bold; margin: 18px 0; }
        table { width: 100%; border-collapse: collapse; margin: 18px 0; }
        td { border: 1px solid #888; padding: 9px 12px; font-size: 14px; }
        td:first-child { width: 38%; background: #f4f4f0; font-weight: bold; }
        .lines { margin: 6px 0 0; }
        .lines div { border-bottom: 1.5px solid #15201b; height: 30px; }
        .foot { font-size: 11.5px; color: #555; margin-top: 24px; }
        @media print { body { margin: 10mm; } }
      </style></head><body>
      <h1>SIRAL — Kit de récupération du trousseau</h1>
      <div class="warn">À compléter À LA MAIN, sous enveloppe scellée, coffre du service.<br>Ne jamais photographier, scanner ou envoyer par e-mail.</div>
      <table>
        <tr><td>Serveur</td><td>${location.origin}</td></tr>
        <tr><td>Identifiant</td><td>${entry.identity.username}</td></tr>
        <tr><td>Titulaire</td><td>${entry.identity.displayName}</td></tr>
        <tr><td>Contentieux accordés</td><td>${scopes}</td></tr>
        <tr><td>Trousseau créé le</td><td>${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
      </table>
      <p><b>Phrase personnelle</b> (écrire lisiblement, mot par mot) :</p>
      <div class="lines"><div></div><div></div><div></div></div>
      <p class="foot">Cette phrase déverrouille le trousseau de <b>${entry.identity.username}</b>. Elle est irrécupérable :
      personne — ni l'hébergeur, ni le développeur — ne peut la réinitialiser. En cas de perte du kit ET de la phrase,
      un administrateur de SIRAL peut générer une nouvelle invitation (Paramètres → Accès &amp; clés) : l'accès est alors
      recréé, sans perte de données. Détruire ce kit si le trousseau est révoqué.</p>
      <script>window.print()<\/script></body></html>`)
    w.document.close()
  }, [])

  /** Choisit le parcours selon l'état E2EE du serveur pour cet utilisateur. */
  const routeByState = useCallback((state: E2eeState) => {
    if (state.hasKeyring) setPhase('unlock')
    else if (state.hasGrant) setPhase('redeem')
    else if (state.legacyKdf && !state.anyKeyrings) setPhase('migrate')
    else if (!state.legacyKdf && !state.anyKeyrings) setPhase('create-fresh')
    else setPhase('no-access')
  }, [])

  const loadStateAndRoute = useCallback(async (): Promise<E2eeState | null> => {
    const { status, json } = await apiJson('/api/e2ee/state')
    if (status !== 200) { setError('État du serveur indisponible'); return null }
    const state = json as unknown as E2eeState
    setE2ee(state)
    routeByState(state)
    return state
  }, [routeByState])

  /**
   * Adopte l'identité de la session : TJ actif (cache local cloisonné par TJ,
   * à définir AVANT toute lecture IndexedDB) + liste des TJ pour la sidebar.
   */
  const adoptMe = useCallback(async (): Promise<BridgeIdentity | null> => {
    const { status, json } = await apiJson('/api/me')
    if (status !== 200) return null
    const identity: BridgeIdentity = { username: String(json.username), displayName: String(json.displayName), role: String(json.role) }
    const active = (json.tj as TjInfo | undefined) || { id: 'default', name: '' }
    setIdbNamespace(active.id)
    window.__SIRAL_TJ__ = { active, tjs: (json.tjs as TjInfo[] | undefined) || [active] }
    setTj(active)
    setMe(identity)
    return identity
  }, [])

  // Boot : session existante ? trousseau mémorisé ?
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!mounted) return
    if (!isWeb) { setPhase('ready'); return }
    let cancelled = false
    ;(async () => {
      // adoptMe() lève si le réseau est injoignable (fetch rejeté) et renvoie
      // null si la session est simplement absente (non connecté).
      let identity: BridgeIdentity | null = null
      let networkDown = false
      try {
        identity = await adoptMe()
      } catch {
        networkDown = true
      }
      if (cancelled) return
      if (!identity) {
        // Réseau injoignable + poste préparé → entrée hors-ligne locale, sans
        // serveur (les données sont déjà dans IndexedDB). Sinon, connexion.
        if (networkDown && offlineMode.hasOfflineBundle()) { setPhase('offline-unlock'); return }
        setPhase('login'); return
      }
      // trousseau mémorisé sur cet appareil ? (case « Rester déverrouillé »)
      if (await tryStoredKeyring(identity)) return
      if (!cancelled) await loadStateAndRoute()
    })()
    return () => { cancelled = true }
  }, [mounted, isWeb, adoptMe, tryStoredKeyring, loadStateAndRoute])

  // Session expirée pendant l'utilisation
  useEffect(() => {
    if (!isWeb) return
    const onExpired = () => { window.location.reload() }
    window.addEventListener('siral:session-expired', onExpired)
    return () => window.removeEventListener('siral:session-expired', onExpired)
  }, [isWeb])

  const doPasswordLogin = async () => {
    setBusy(true); setError('')
    try {
      const { status, json } = await apiJson('/api/auth/password-login', {
        username: loginUsername.trim(), password: loginPassword,
      })
      if (status !== 200) throw new Error(String(json.error || 'Connexion refusée'))
      // /api/me apporte le TJ actif (cloisonnement du cache local par TJ)
      const identity = await adoptMe()
      if (!identity) throw new Error('Session indisponible — réessayez')
      setLoginPassword('')
      // clé mémorisée sur cet appareil ? on évite de redemander la phrase
      if (await tryStoredKeyring(identity)) return
      await loadStateAndRoute()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la connexion')
    } finally { setBusy(false) }
  }

  const doPasswordRegister = async () => {
    setBusy(true); setError('')
    try {
      const { status, json } = await apiJson('/api/auth/password-register', {
        username: regUsername.trim(), displayName: regDisplay.trim() || regUsername.trim(),
        password: regPassword, setupCode: regCode.trim(),
      })
      if (status !== 200) throw new Error(String(json.error || 'Enrôlement refusé'))
      const identity = await adoptMe()
      if (!identity) throw new Error('Session indisponible — réessayez')
      setRegPassword('')
      await loadStateAndRoute()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enrôlement")
    } finally { setBusy(false) }
  }

  const requirePersonalPhrase = () => {
    if (pass1.length < 12) throw new Error('12 caractères minimum — choisissez une vraie phrase (ex. quatre mots aléatoires)')
    if (pass1 !== pass2) throw new Error('Les deux saisies ne correspondent pas')
  }

  /** Déverrouillage : mon trousseau existe, ma phrase personnelle l'ouvre. */
  const doUnlock = async () => {
    if (!me) return
    setBusy(true); setError('')
    try {
      const { status, json } = await apiJson(`/api/vaults/keyring-${encodeURIComponent(me.username)}`)
      if (status !== 200) throw new Error('Trousseau introuvable sur le serveur')
      const envelope = json.envelope as unknown as CipherEnvelope & { kdfSalt?: string, kdfIterations?: number }
      if (!envelope.kdfSalt || !envelope.kdfIterations) throw new Error('Trousseau invalide')
      const userKey = await importAesKey(await deriveRawKey(pass1, envelope.kdfSalt, envelope.kdfIterations))
      let payload: KeyringPayload
      try {
        payload = await decryptJson<KeyringPayload>(userKey, envelope)
      } catch {
        throw new Error('Phrase personnelle incorrecte')
      }
      await finishUnlock(payload, me)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Déverrouillage impossible')
    } finally { setBusy(false) }
  }

  /**
   * Entrée hors-ligne : ouvre le trousseau scellé sur ce poste avec le code de
   * déverrouillage hors-ligne, sans aucun appel serveur. L'app tourne alors
   * contre le cache IndexedDB ; la sync est suspendue (mode hors-ligne forcé).
   */
  const doOfflineUnlock = async () => {
    setBusy(true); setError('')
    try {
      const { keys, identity, tj, tjs } = await offlineMode.unlockOffline(offlineCode)
      // Fixer le namespace IndexedDB (cloisonnement par TJ) AVANT toute lecture.
      setIdbNamespace(tj.id)
      window.__SIRAL_TJ__ = { active: tj, tjs: tjs.length ? tjs : [tj] }
      setTj(tj)
      setMe(identity)
      // Suspendre la synchronisation : on travaille en local jusqu'au retour réseau.
      NetworkStatusManager.setForcedOffline(true)
      setOfflineCode('')
      installBridge(keys, identity)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Déverrouillage hors-ligne impossible')
    } finally { setBusy(false) }
  }

  /** Serveur vierge : je suis le premier — clés neuves pour tous les périmètres. */
  const doCreateFresh = async () => {
    if (!me) return
    setBusy(true); setError('')
    try {
      requirePersonalPhrase()
      const payload = freshKeyringPayload()
      await pushKeyring(payload, pass1, me)
      await finishUnlock(payload, me, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Création impossible')
    } finally { setBusy(false) }
  }

  /**
   * Migration depuis la phrase de service : vérifie l'ancienne phrase, génère
   * des clés NEUVES par contentieux (rotation = vrai cloisonnement), re-chiffre
   * les coffres de contentieux, puis scelle le tout dans mon trousseau.
   */
  const doMigrate = async () => {
    if (!me || !e2ee?.legacyKdfParams) return
    setBusy(true); setError('')
    try {
      requirePersonalPhrase()
      if (!servicePass) throw new Error('Saisissez la phrase du service (ancien système)')
      const { salt, iterations } = e2ee.legacyKdfParams
      const serviceRaw = await deriveRawKey(servicePass, salt, iterations)
      const serviceKey = await importAesKey(serviceRaw)
      const ok = await verifyOrCreateCanary(serviceKey, me)
      if (ok !== true) throw new Error('Phrase du service incorrecte')

      const keys: Record<string, string> = { [SCOPE_GLOBAL]: b64.encode(serviceRaw) }
      for (const id of KNOWN_CONTENTIEUX) {
        const newRaw = randomRawKey()
        const newKey = await importAesKey(newRaw)
        for (const vaultName of [`ctx-${id}`, `ctx-alerts-${id}`]) {
          const { status, json } = await apiJson(`/api/vaults/${vaultName}`)
          if (status !== 200) continue
          const env = json.envelope as unknown as CipherEnvelope
          const data = await decryptJson(serviceKey, env)
          const reEnc = await encryptJson(newKey, data, { savedAt: env.savedAt, savedBy: env.savedBy || me.username })
          const put = await fetch(`/api/vaults/${vaultName}`, {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(reEnc), credentials: 'same-origin',
          })
          if (!put.ok) throw new Error(`Rotation de ${vaultName} refusée (${put.status})`)
        }
        keys[`ctx-${id}`] = b64.encode(newRaw)
      }
      const now = new Date().toISOString()
      const payload: KeyringPayload = { v: 1, keys, createdAt: now, updatedAt: now }
      await pushKeyring(payload, pass1, me)
      await finishUnlock(payload, me, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Migration impossible')
    } finally { setBusy(false) }
  }

  /** Invitation : le code à usage unique ouvre la copie des clés déposée pour moi. */
  const doRedeem = async () => {
    if (!me) return
    setBusy(true); setError('')
    try {
      requirePersonalPhrase()
      const code = normalizeInvitationCode(inviteCode)
      if (code.replace(/-/g, '').length < 20) throw new Error("Code d'invitation incomplet")
      const { status, json } = await apiJson(`/api/vaults/grant-${encodeURIComponent(me.username)}`)
      if (status !== 200) throw new Error('Invitation introuvable — demandez-en une nouvelle')
      const envelope = json.envelope as unknown as CipherEnvelope & { kdfSalt?: string, kdfIterations?: number }
      if (!envelope.kdfSalt || !envelope.kdfIterations) throw new Error('Invitation invalide')
      const codeKey = await importAesKey(await deriveRawKey(code, envelope.kdfSalt, envelope.kdfIterations))
      let grant: { keys: Record<string, string> }
      try {
        grant = await decryptJson<{ keys: Record<string, string> }>(codeKey, envelope)
      } catch {
        throw new Error("Code d'invitation incorrect")
      }
      const now = new Date().toISOString()
      const payload: KeyringPayload = { v: 1, keys: grant.keys, createdAt: now, updatedAt: now }
      await pushKeyring(payload, pass1, me)
      // invitation consommée : on la supprime (best effort)
      fetch(`/api/vaults/grant-${encodeURIComponent(me.username)}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
      await finishUnlock(payload, me, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invitation invalide')
    } finally { setBusy(false) }
  }

  if (!mounted) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(900px 600px at 30% 20%, #224636, #0e1c14 70%)' }} />
    )
  }
  if (!isWeb || phase === 'ready') return <>{children}</>

  const phraseFields = (withConfirm: boolean) => (
    <>
      <input className="siral-input" type="password" placeholder={withConfirm ? 'Votre phrase personnelle (nouvelle)' : 'Phrase personnelle'} value={pass1}
        onChange={(e) => setPass1(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && phase === 'unlock') doUnlock() }} />
      {withConfirm && (
        <input className="siral-input" type="password" placeholder="Confirmez votre phrase personnelle" value={pass2} onChange={(e) => setPass2(e.target.value)} />
      )}
    </>
  )

  const irrecoverableNote = (
    <div className="siral-note">
      <span><b>Votre phrase personnelle est irrécupérable.</b> Personne — ni l&apos;hébergeur, ni le développeur — ne peut la réinitialiser.
      En cas d&apos;oubli, un collègue pourra vous ré-inviter. Notez-la et conservez-la en lieu sûr.</span>
    </div>
  )

  return (
    <div className="siral-gate">
      <style>{`
        .siral-gate { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(900px 600px at 30% 20%, #224636, #0e1c14 70%); font-family: Inter, 'Segoe UI', sans-serif;
          padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
        .siral-card { width: 400px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow-y: auto;
          background: #fbfcfb; border-radius: 18px; padding: 30px 30px 24px; box-shadow: 0 30px 70px rgba(0,0,0,.5); }
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
        .siral-foot { text-align: center; font-size: 10px; color: #93a29a; margin-top: 16px; }
        .siral-user { font-size: 12px; color: #5b6b63; background: #f1f7f3; border-radius: 99px; padding: 4px 12px; display: inline-block; margin-bottom: 10px; }
        .siral-sep { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #93a29a; margin-top: 16px; }
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
            <div className="siral-text">Espace réservé aux membres habilités.</div>
            <input className="siral-input" placeholder="Identifiant" value={loginUsername} autoCapitalize="none"
              onChange={(e) => setLoginUsername(e.target.value)} />
            <input className="siral-input" type="password" placeholder="Mot de passe" value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && loginUsername.trim() && loginPassword) doPasswordLogin() }} />
            <button className="siral-btn" onClick={doPasswordLogin} disabled={busy || !loginUsername.trim() || !loginPassword}>
              {busy ? 'Vérification…' : 'Se connecter'}
            </button>
            <button className="siral-link" onClick={() => { setError(''); setPhase('register') }}>
              Premier accès sur cet appareil ? Enrôler
            </button>
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'register' && (
          <>
            <div className="siral-title">Enrôlement</div>
            <div className="siral-text">Réservé aux membres munis du <b>code d&apos;accès de leur tribunal</b> (remis par l&apos;administrateur — il identifie
              votre TJ et n&apos;est demandé qu&apos;à cette première inscription). Utilisez votre identifiant habituel.</div>
            <input className="siral-input" placeholder="Identifiant (ex. a.chevalier)" value={regUsername} onChange={(e) => setRegUsername(e.target.value)} autoCapitalize="none" />
            <input className="siral-input" placeholder="Nom affiché (ex. A. Chevalier)" value={regDisplay} onChange={(e) => setRegDisplay(e.target.value)} />
            <input className="siral-input" placeholder="Code d'accès du tribunal" value={regCode} onChange={(e) => setRegCode(e.target.value)} autoCapitalize="characters" />
            <input className="siral-input" type="password" placeholder="Mot de passe (10 caractères minimum)" value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)} />
            <button className="siral-btn" onClick={doPasswordRegister} disabled={busy || !regUsername.trim() || !regCode.trim() || regPassword.length < 10}>
              {busy ? 'Création…' : 'Créer mon compte'}
            </button>
            <button className="siral-link" onClick={() => { setError(''); setPhase('login') }}>← Retour à la connexion</button>
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'unlock' && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}{tj?.name ? ` · ${tj.name}` : ''}</span>}
            <div className="siral-title">Déverrouillage de votre trousseau</div>
            <div className="siral-text">Votre phrase personnelle déchiffre vos clés localement, dans ce navigateur. Elle n&apos;est jamais transmise au serveur.</div>
            {phraseFields(false)}
            <button className="siral-btn" onClick={doUnlock} disabled={busy || !pass1}>
              {busy ? 'Déchiffrement…' : 'Déverrouiller'}
            </button>
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'offline-unlock' && (() => {
          const st = offlineMode.getOfflineStatus()
          return (
            <>
              <span className="siral-user">Hors ligne{st.identity?.displayName ? ` · ${st.identity.displayName}` : ''}{st.tj?.name ? ` · ${st.tj.name}` : ''}</span>
              <div className="siral-title">Mode hors-ligne</div>
              <div className="siral-text">Réseau injoignable. Saisissez votre <b>code de déverrouillage hors-ligne</b>
                {' '}(choisi lors de la préparation du poste) pour travailler sur les données déjà présentes sur cette
                machine. Vos saisies seront synchronisées à la reconnexion.</div>
              {st.expired && (
                <div className="siral-error">Poste préparé il y a plus de 48 h — reconnectez-vous dès que possible
                  pour resynchroniser et limiter les conflits.</div>
              )}
              <input className="siral-input" type="password" placeholder="Code de déverrouillage hors-ligne" value={offlineCode}
                onChange={(e) => setOfflineCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && offlineCode) doOfflineUnlock() }} />
              <button className="siral-btn" onClick={doOfflineUnlock} disabled={busy || !offlineCode}>
                {busy ? 'Déverrouillage…' : 'Travailler hors-ligne'}
              </button>
              <button className="siral-link" onClick={() => { setError(''); setOfflineCode(''); setPhase('login') }}>
                Réessayer la connexion en ligne
              </button>
              {error && <div className="siral-error">{error}</div>}
            </>
          )
        })()}

        {phase === 'create-fresh' && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}{tj?.name ? ` · ${tj.name}` : ''}</span>}
            <div className="siral-title">Initialisation du chiffrement</div>
            <div className="siral-text">Vous êtes le premier utilisateur de {tj?.name ? <b>{tj.name}</b> : 'ce tribunal'} sur ce serveur.
              Des clés de chiffrement neuves, propres à ce tribunal, vont être générées et scellées
              dans votre trousseau personnel. Vous pourrez ensuite inviter vos collègues depuis Paramètres → Accès &amp; clés.</div>
            {phraseFields(true)}
            <button className="siral-btn" onClick={doCreateFresh} disabled={busy || !pass1}>
              {busy ? 'Génération des clés…' : 'Créer mon trousseau'}
            </button>
            {irrecoverableNote}
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'migrate' && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}{tj?.name ? ` · ${tj.name}` : ''}</span>}
            <div className="siral-title">Passage aux clés individuelles</div>
            <div className="siral-text">Ce serveur utilise encore la phrase de service partagée. Saisissez-la une dernière fois, puis choisissez
              votre phrase personnelle : les clés des contentieux seront régénérées (cloisonnement) et scellées dans votre trousseau.
              Vos collègues recevront ensuite une invitation chacun.</div>
            <input className="siral-input" type="password" placeholder="Phrase du service (ancien système)" value={servicePass} onChange={(e) => setServicePass(e.target.value)} />
            <div className="siral-sep">Votre nouvelle phrase</div>
            {phraseFields(true)}
            <button className="siral-btn" onClick={doMigrate} disabled={busy || !servicePass || !pass1}>
              {busy ? 'Migration des clés…' : 'Migrer vers mon trousseau'}
            </button>
            {irrecoverableNote}
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'redeem' && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}{tj?.name ? ` · ${tj.name}` : ''}</span>}
            <div className="siral-title">Activer votre invitation</div>
            <div className="siral-text">{e2ee?.grantKdf?.grantedBy ? `${e2ee.grantKdf.grantedBy} vous a invité.` : 'Une invitation vous attend.'} Saisissez
              le code d&apos;invitation qui vous a été transmis, puis choisissez votre phrase personnelle.</div>
            <input className="siral-input" placeholder="Code d'invitation (ex. 7K2MQ-…)" value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)} autoCapitalize="characters" />
            <div className="siral-sep">Votre phrase personnelle</div>
            {phraseFields(true)}
            <button className="siral-btn" onClick={doRedeem} disabled={busy || !inviteCode.trim() || !pass1}>
              {busy ? 'Activation…' : 'Activer mon accès'}
            </button>
            {irrecoverableNote}
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'no-access' && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}{tj?.name ? ` · ${tj.name}` : ''}</span>}
            <div className="siral-title">Accès en attente</div>
            <div className="siral-text">Votre compte est créé mais aucun trousseau de clés ne vous a encore été remis.
              Demandez à un membre du service de vous inviter (Paramètres → Accès &amp; clés), puis revenez ici.</div>
            <button className="siral-btn ghost" onClick={() => { setError(''); loadStateAndRoute() }} disabled={busy}>
              J&apos;ai reçu mon invitation — vérifier
            </button>
            {error && <div className="siral-error">{error}</div>}
          </>
        )}

        {phase === 'recovery-kit' && (
          <>
            {me && <span className="siral-user">Connecté : {me.displayName}{tj?.name ? ` · ${tj.name}` : ''}</span>}
            <div className="siral-title">Votre trousseau est prêt — imprimez le kit de récupération</div>
            <div className="siral-text">Une page à imprimer, où vous écrirez votre phrase personnelle <b>à la main</b>.
              Sous enveloppe scellée, au coffre du service : c&apos;est votre seule porte de sortie en cas d&apos;oubli
              (avec la ré-invitation par un admin).</div>
            <button className="siral-btn" onClick={printRecoveryKit}>
              Imprimer le kit de récupération
            </button>
            <button className="siral-btn ghost" onClick={() => {
              const entry = pendingEntryRef.current
              if (entry) installBridge(entry.keys, entry.identity)
            }}>
              Continuer vers l&apos;application
            </button>
            <div className="siral-note"><span>Vous pourrez le réimprimer plus tard uniquement en recréant votre
              trousseau — faites-le maintenant.</span></div>
          </>
        )}

        <div className="siral-foot">Chiffrement de bout en bout · clés individuelles · hébergement UE · journal d&apos;accès</div>
      </div>
    </div>
  )
}
