/**
 * SIRAL — WebAuthn (passkeys) : enrôlement et connexion.
 * S'appuie sur @simplewebauthn/server. Les credentials sont stockés en
 * base64url dans accounts.json.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types'
import crypto from 'crypto'
import {
  Account, StoredCredential, findAccount, listAccounts, saveAccount,
  storeChallenge, takeChallenge, rpFromRequest, isValidUsername, setupCode,
  getSession, rateLimit, clientIp, safeEqual,
} from './auth'
import { canonicalTribunalLabel } from '@/lib/tribunaux'

const b64u = {
  enc: (buf: Uint8Array | Buffer): string => Buffer.from(buf).toString('base64url'),
  dec: (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64url')),
}

export async function registrationOptions(req: Request, username: string, displayName: string, code: string) {
  rateLimit('reg:' + clientIp(req), 10, 15 * 60 * 1000) // anti force brute du code d'enrôlement
  const expected = setupCode()
  if (!expected) throw new Error("Le code d'enrôlement (SIRAL_SETUP_CODE) n'est pas configuré sur le serveur")
  if (!safeEqual(code, expected)) throw new Error("Code d'enrôlement incorrect")
  if (!isValidUsername(username)) throw new Error("Nom d'utilisateur invalide (lettres, chiffres, . _ -)")

  const existing = findAccount(username)
  // Un compte existant ne peut recevoir une passkey supplémentaire que depuis
  // une session déjà authentifiée de CE compte — sinon le code d'enrôlement
  // suffirait à capturer n'importe quel compte (y compris admin).
  if (existing) {
    const session = getSession(req)
    if (!session || session.u !== existing.username) {
      throw new Error('Ce compte existe déjà — connectez-vous avec votre passkey, ou demandez à un admin')
    }
  }
  const { rpID, rpName } = rpFromRequest(req)
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: username.toLowerCase(),
    userName: username,
    userDisplayName: displayName || username,
    attestationType: 'none',
    excludeCredentials: (existing?.credentials || []).map((c) => ({
      id: b64u.dec(c.credID),
      type: 'public-key' as const,
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })
  storeChallenge('reg:' + username.toLowerCase(), options.challenge)
  return options
}

export async function registrationVerify(req: Request, username: string, displayName: string, response: RegistrationResponseJSON, label?: string, tribunal?: string) {
  const challenge = takeChallenge('reg:' + username.toLowerCase())
  if (!challenge) throw new Error('Défi expiré, recommencez')
  const { rpID, origin } = rpFromRequest(req)
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  })
  if (!verification.verified || !verification.registrationInfo) throw new Error('Vérification de la passkey échouée')
  const info = verification.registrationInfo
  const cred: StoredCredential = {
    credID: b64u.enc(info.credentialID),
    publicKey: b64u.enc(info.credentialPublicKey),
    counter: info.counter,
    transports: response.response.transports,
    label: label || 'Passkey',
    createdAt: new Date().toISOString(),
  }
  const tribunalNorm = tribunal ? canonicalTribunalLabel(tribunal) || undefined : undefined
  let account = findAccount(username)
  if (account) {
    // même garde que registrationOptions : seul le titulaire connecté ajoute une passkey
    const session = getSession(req)
    if (!session || session.u !== account.username) {
      throw new Error('Ce compte existe déjà — connectez-vous avec votre passkey, ou demandez à un admin')
    }
    account.credentials.push(cred)
    if (tribunalNorm && !account.tribunal) account.tribunal = tribunalNorm.slice(0, 80)
  } else {
    account = {
      id: crypto.randomUUID(),
      username,
      displayName: displayName || username,
      role: listAccounts().length === 0 ? 'admin' : 'member',
      tribunal: tribunalNorm ? tribunalNorm.slice(0, 80) : undefined,
      credentials: [cred],
      createdAt: new Date().toISOString(),
    }
  }
  await saveAccount(account)
  return account
}

export async function authenticationOptions(req: Request, username?: string) {
  const { rpID } = rpFromRequest(req)
  const account = username ? findAccount(username) : null
  if (username && !account) throw new Error('Compte inconnu')
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: account
      ? account.credentials.map((c) => ({
          id: b64u.dec(c.credID),
          type: 'public-key' as const,
          transports: c.transports as AuthenticatorTransport[] | undefined,
        }))
      : undefined,
  })
  storeChallenge('auth:' + (username ? username.toLowerCase() : options.challenge), options.challenge)
  return options
}

export async function authenticationVerify(req: Request, response: AuthenticationResponseJSON, username?: string): Promise<Account> {
  // Retrouve le compte par credID (connexion sans username) ou par username
  let account: Account | null = null
  let cred: StoredCredential | null = null
  const credID = response.id
  for (const a of listAccounts()) {
    const c = a.credentials.find((x) => x.credID === credID)
    if (c) { account = a; cred = c; break }
  }
  if (!account || !cred) throw new Error('Passkey inconnue de ce serveur')
  if (username && account.username.toLowerCase() !== username.toLowerCase()) throw new Error('Passkey non rattachée à ce compte')

  const challenge =
    takeChallenge('auth:' + account.username.toLowerCase()) ||
    // mode découverte : le défi a été stocké sous sa propre valeur
    (() => {
      try {
        const clientData = JSON.parse(Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'))
        return takeChallenge('auth:' + clientData.challenge)
      } catch { return null }
    })()
  if (!challenge) throw new Error('Défi expiré, recommencez')

  const { rpID, origin } = rpFromRequest(req)
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    authenticator: {
      credentialID: b64u.dec(cred.credID),
      credentialPublicKey: b64u.dec(cred.publicKey),
      counter: cred.counter,
      transports: cred.transports as AuthenticatorTransport[] | undefined,
    },
  })
  if (!verification.verified) throw new Error('Authentification échouée')
  cred.counter = verification.authenticationInfo.newCounter
  account.lastLoginAt = new Date().toISOString()
  await saveAccount(account)
  return account
}
