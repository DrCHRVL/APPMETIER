/**
 * SIRAL — Attaché de justice · boîte mail dédiée.
 *
 * ENTRÉE (IMAP) : le magistrat transfère depuis sa boîte pro vers la boîte
 * dédiée (ia@…). Le corps du transfert vaut consigne. Chaque message est
 * chiffré (clé globale) dès son arrivée sur le disque, pièces jointes
 * comprises, puis marqué lu côté IMAP.
 *
 * SORTIE (SMTP) : verrou en dur — le destinataire N'EST PAS un paramètre.
 * L'unique adresse possible est SIRAL_ATTACHE_OWNER_EMAIL ; l'expéditeur qui
 * arriverait à injecter autre chose est refusé ici, quel que soit l'appelant.
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { attacheDir, ensureDir, atomicWrite, readJson, readState, writeState, listFiles } from './store.mjs'
import { encryptJson, decryptJson, loadMasterKey, wrapWithMaster, unwrapWithMaster } from './crypto.mjs'
import { audit } from './journal.mjs'

// ── Réglages IMAP/SMTP saisis DANS L'APP (Paramètres → Attaché IA) ──
// Facultatifs : ils PRÉVALENT sur les variables d'environnement quand ils
// sont présents. Stockés chiffrés au repos par la clé-maître (comme le
// trousseau) — l'app ne détient jamais le mot de passe en clair.
const MAIL_OVERRIDE_FILE = () => attacheDir('mail-override.enc.json')
const MAIL_FIELDS = ['imapHost', 'imapPort', 'imapSecure', 'imapUser', 'imapPassword', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPassword', 'from']

export function readMailOverride() {
  const master = loadMasterKey()
  if (!master) return null
  const stored = readJson(MAIL_OVERRIDE_FILE(), null)
  if (!stored?.envelope) return null
  try { return unwrapWithMaster(master, stored.envelope) } catch { return null }
}

export function mailOverrideActive() {
  return Boolean(readJson(MAIL_OVERRIDE_FILE(), null)?.envelope)
}

/**
 * Enregistre/complète les réglages mail saisis dans l'app. Un champ absent
 * du patch reste inchangé ; un mot de passe VIDE est ignoré (on garde
 * l'ancien) — l'admin n'a donc pas à le ressaisir pour changer juste l'hôte.
 */
export function writeMailOverride(patch = {}, by = 'admin') {
  const master = loadMasterKey()
  if (!master) throw new Error('Clé-maître absente (SIRAL_ATTACHE_MASTER_KEY)')
  const next = { ...(readMailOverride() || {}) }
  for (const f of MAIL_FIELDS) {
    if (patch[f] === undefined) continue
    if ((f === 'imapPassword' || f === 'smtpPassword') && patch[f] === '') continue
    next[f] = patch[f]
  }
  next.updatedAt = new Date().toISOString()
  next.updatedBy = by
  ensureDir(attacheDir())
  atomicWrite(MAIL_OVERRIDE_FILE(), JSON.stringify({ updatedAt: next.updatedAt, updatedBy: by, envelope: wrapWithMaster(master, next) }, null, 2))
  return true
}

/** Efface les réglages in-app : retour aux variables d'environnement. */
export function clearMailOverride() {
  const p = MAIL_OVERRIDE_FILE()
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true }
  return false
}

const MAX_ATTACHMENT = 15 * 1024 * 1024   // 15 Mo par pièce
const MAX_TOTAL = 40 * 1024 * 1024        // 40 Mo par message

export function mailConfig(env = process.env) {
  // Réglages in-app prioritaires sur l'environnement (champ par champ).
  const ov = readMailOverride() || {}
  const pick = (o, e) => (o !== undefined && o !== '' ? o : e)
  const owner = (env.SIRAL_ATTACHE_OWNER_EMAIL || '').trim().toLowerCase()

  const imapUser = pick(ov.imapUser, env.SIRAL_ATTACHE_IMAP_USER)
  const imapPass = pick(ov.imapPassword, env.SIRAL_ATTACHE_IMAP_PASSWORD)
  const imapHost = pick(ov.imapHost, env.SIRAL_ATTACHE_IMAP_HOST)
  const imap = {
    host: imapHost,
    port: Number(pick(ov.imapPort, env.SIRAL_ATTACHE_IMAP_PORT) || 993),
    secure: ov.imapSecure !== undefined ? ov.imapSecure !== false : env.SIRAL_ATTACHE_IMAP_SECURE !== '0',
    auth: { user: imapUser, pass: imapPass },
  }
  const smtp = {
    host: pick(ov.smtpHost, env.SIRAL_ATTACHE_SMTP_HOST) || imapHost,
    port: Number(pick(ov.smtpPort, env.SIRAL_ATTACHE_SMTP_PORT) || 465),
    secure: ov.smtpSecure !== undefined ? ov.smtpSecure !== false : env.SIRAL_ATTACHE_SMTP_SECURE !== '0',
    auth: {
      user: pick(ov.smtpUser, env.SIRAL_ATTACHE_SMTP_USER) || imapUser,
      pass: pick(ov.smtpPassword, env.SIRAL_ATTACHE_SMTP_PASSWORD) || imapPass,
    },
  }
  return {
    owner,
    imap,
    smtp,
    from: pick(ov.from, env.SIRAL_ATTACHE_FROM) || smtp.auth.user,
    imapReady: Boolean(imap.host && imap.auth.user && imap.auth.pass),
    smtpReady: Boolean(owner && smtp.host && smtp.auth.user && smtp.auth.pass),
    overrideActive: mailOverrideActive(),
  }
}

/**
 * Détail NON secret de la configuration mail, pour l'écran de diagnostic de
 * l'administrateur : hôtes, ports, adresse de la boîte dédiée, présence d'un
 * mot de passe (jamais sa valeur). Rien ici ne permet de se connecter.
 */
export function describeMailConfig(env = process.env) {
  const cfg = mailConfig(env)
  return {
    imapHost: cfg.imap.host || '',
    imapPort: cfg.imap.port,
    imapSecure: cfg.imap.secure,
    imapUser: cfg.imap.auth.user || '',
    imapPasswordSet: Boolean(cfg.imap.auth.pass),
    smtpHost: cfg.smtp.host || '',
    smtpPort: cfg.smtp.port,
    smtpUser: cfg.smtp.auth.user || '',
    smtpPasswordSet: Boolean(cfg.smtp.auth.pass),
    from: cfg.from || '',
    imapReady: cfg.imapReady,
    smtpReady: cfg.smtpReady,
    overrideActive: Boolean(cfg.overrideActive),
  }
}

/**
 * Vérifie la boîte dédiée SANS rien modifier : ouvre INBOX en lecture seule,
 * compte les messages (total et non lus), se déconnecte. Aucun message n'est
 * relevé, chiffré, ni marqué lu. Sert au bouton « Tester la connexion » du
 * panneau d'administration pour distinguer « boîte simplement vide » d'un
 * vrai problème (identifiants, hôte injoignable, TLS…).
 */
export async function testImapConnection() {
  const detail = describeMailConfig()
  if (!detail.imapReady) {
    return {
      ok: false,
      configured: false,
      error: 'Boîte non configurée côté serveur — renseignez SIRAL_ATTACHE_IMAP_HOST / _USER / _PASSWORD (voir docs/ATTACHE.md).',
      ...detail,
    }
  }
  const cfg = mailConfig()
  const client = new ImapFlow({ ...cfg.imap, logger: false })
  const started = Date.now()
  try {
    await client.connect()
    // lecture seule : on ne touche à aucun flag (rien n'est marqué lu)
    const mb = await client.mailboxOpen('INBOX', { readOnly: true })
    const unseenUids = await client.search({ seen: false }, { uid: true })
    const unseen = Array.isArray(unseenUids) ? unseenUids.length : 0
    await client.mailboxClose().catch(() => {})
    await client.logout()
    return {
      ok: true,
      configured: true,
      messages: Number(mb?.exists || 0),
      unseen,
      dureeMs: Date.now() - started,
      ...detail,
    }
  } catch (e) {
    try { await client.logout() } catch {}
    return {
      ok: false,
      configured: true,
      error: String(e?.message || e),
      dureeMs: Date.now() - started,
      ...detail,
    }
  }
}

/**
 * Relève les messages non lus, les chiffre dans inbox/, les marque lus.
 * Retourne les identifiants des messages fraîchement ingérés.
 */
export async function fetchInbox(keys) {
  const cfg = mailConfig()
  if (!cfg.imapReady) return { ok: false, error: 'IMAP non configuré', ingested: [] }
  const client = new ImapFlow({ ...cfg.imap, logger: false })
  const ingested = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // { uid: true } est INDISPENSABLE : sans lui, search() renvoie des
      // numéros de séquence, alors que fetchOne/messageFlagsAdd ci-dessous
      // les traitent comme des UID. Dès que séquence ≠ UID (boîte avec de
      // l'historique), fetchOne ne trouve rien → aucun message ingéré, sans
      // erreur (« rien de nouveau ») bien que la boîte contienne des non-lus.
      const uids = await client.search({ seen: false }, { uid: true })
      for (const uid of uids || []) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true })
        if (!msg?.source) continue
        if (msg.source.length > MAX_TOTAL) {
          await audit(keys, 'mail_ignore', { raison: 'message trop volumineux', taille: msg.source.length, uid })
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
          continue
        }
        const parsed = await simpleParser(msg.source)
        const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex')
        const attachments = []
        for (const att of parsed.attachments || []) {
          if (!att.content || att.content.length > MAX_ATTACHMENT) continue
          attachments.push({
            nom: att.filename || 'piece-jointe',
            type: att.contentType || 'application/octet-stream',
            taille: att.content.length,
            b64: att.content.toString('base64'),
          })
        }
        const record = {
          id,
          recuLe: (parsed.date || new Date()).toISOString(),
          de: parsed.from?.text || '',
          sujet: parsed.subject || '(sans objet)',
          texte: String(parsed.text || '').slice(0, 300_000),
          html: undefined, // le texte suffit à l'agent ; pas de HTML stocké
          attachments,
          traite: false,
          statut: 'recu', // recu → en_cours → traite (affiché dans le widget BAL du tableau de bord)
        }
        const env = encryptJson(keys.global, record, { savedAt: record.recuLe })
        ensureDir(attacheDir('inbox'))
        atomicWrite(attacheDir('inbox', id + '.json'), JSON.stringify(env))
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        ingested.push(id)
        await audit(keys, 'mail_recu', { id, de: record.de, sujet: record.sujet, pieces: attachments.length })
      }
    } finally {
      lock.release()
    }
    await client.logout()
    await writeState({ lastFetchAt: new Date().toISOString(), lastFetchOk: true })
    return { ok: true, ingested }
  } catch (e) {
    try { await client.logout() } catch {}
    await writeState({ lastFetchAt: new Date().toISOString(), lastFetchOk: false, lastFetchError: String(e?.message || e) })
    return { ok: false, error: String(e?.message || e), ingested }
  }
}

export function listInbox(keys, { max = 100 } = {}) {
  const files = listFiles('inbox')
  const out = []
  for (const f of files.slice(0, max)) {
    const env = readJson(attacheDir('inbox', f.name), null)
    if (!env) continue
    try {
      const rec = decryptJson(keys.global, env)
      out.push({
        id: rec.id, recuLe: rec.recuLe, de: rec.de, sujet: rec.sujet,
        pieces: (rec.attachments || []).length, traite: Boolean(rec.traite),
        statut: rec.statut || (rec.traite ? 'traite' : 'recu'),
        traiteLe: rec.traiteLe, resume: rec.resume,
      })
    } catch {}
  }
  return out
}

/** Statut d'avancement d'un message (recu | en_cours | traite | erreur). */
export async function markInboxStatus(keys, id, statut) {
  const rec = readInboxMessage(keys, id)
  if (!rec) return false
  rec.statut = statut
  const env = encryptJson(keys.global, rec, { savedAt: new Date().toISOString() })
  atomicWrite(attacheDir('inbox', id + '.json'), JSON.stringify(env))
  return true
}

export function readInboxMessage(keys, id) {
  if (!/^[\w-]+$/.test(id)) return null
  const env = readJson(attacheDir('inbox', id + '.json'), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

export async function markInboxProcessed(keys, id, resume) {
  const rec = readInboxMessage(keys, id)
  if (!rec) return false
  rec.traite = true
  rec.traiteLe = new Date().toISOString()
  rec.statut = 'traite'
  if (resume) rec.resume = String(resume).slice(0, 2000)
  const env = encryptJson(keys.global, rec, { savedAt: rec.traiteLe })
  atomicWrite(attacheDir('inbox', id + '.json'), JSON.stringify(env))
  return true
}

/**
 * DÉPRÉCIÉ — plus appelé par aucun outil : les livrables se remettent DANS
 * SIRAL (remettre_livrable → fil « pendant votre absence »), les mails
 * sortants ayant été supprimés (rejets de messagerie côté justice.fr).
 * Conservé pour un éventuel retour arrière : destinataire toujours câblé
 * (SIRAL_ATTACHE_OWNER_EMAIL), jamais un paramètre.
 */
export async function sendToOwner(keys, { sujet, corps }) {
  const cfg = mailConfig()
  if (!cfg.smtpReady) throw new Error('SMTP non configuré ou adresse du magistrat absente')
  const to = cfg.owner
  // Garde-fou : une adresse unique, sans virgule ni retour ligne (pas de Cc caché)
  if (!/^[^\s,;<>]+@[^\s,;<>]+$/.test(to)) throw new Error('Adresse du magistrat invalide')
  const transporter = nodemailer.createTransport(cfg.smtp)
  const info = await transporter.sendMail({
    from: cfg.from,
    to,
    subject: `[Attaché SIRAL] ${String(sujet || 'Projet préparé').slice(0, 200)}`,
    text: String(corps || '').slice(0, 500_000),
  })
  const entry = { sujet, envoyeLe: new Date().toISOString(), messageId: info.messageId }
  const env = encryptJson(keys.global, { ...entry, corps: String(corps || '').slice(0, 100_000) })
  await audit(keys, 'mail_envoye_proprietaire', entry)
  const { appendEncryptedLine } = await import('./store.mjs')
  await appendEncryptedLine('outbox.jsonl', { ts: Date.now(), iv: env.iv, ct: env.ct })
  return { ok: true, messageId: info.messageId }
}

/** Nombre de messages en attente + état de santé pour le statut. */
export function inboxStats(keys) {
  try {
    const list = listInbox(keys, { max: 500 })
    return {
      total: list.length,
      nonTraites: list.filter((m) => !m.traite).length,
      state: readState(),
    }
  } catch {
    return { total: 0, nonTraites: 0, state: readState() }
  }
}

export function inboxFileExists(id) {
  return /^[\w-]+$/.test(id) && fs.existsSync(attacheDir('inbox', id + '.json'))
}
