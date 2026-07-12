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
import { encryptJson, decryptJson } from './crypto.mjs'
import { audit } from './journal.mjs'

const MAX_ATTACHMENT = 15 * 1024 * 1024   // 15 Mo par pièce
const MAX_TOTAL = 40 * 1024 * 1024        // 40 Mo par message

export function mailConfig(env = process.env) {
  const owner = (env.SIRAL_ATTACHE_OWNER_EMAIL || '').trim().toLowerCase()
  const imap = {
    host: env.SIRAL_ATTACHE_IMAP_HOST,
    port: Number(env.SIRAL_ATTACHE_IMAP_PORT || 993),
    secure: env.SIRAL_ATTACHE_IMAP_SECURE !== '0',
    auth: { user: env.SIRAL_ATTACHE_IMAP_USER, pass: env.SIRAL_ATTACHE_IMAP_PASSWORD },
  }
  const smtp = {
    host: env.SIRAL_ATTACHE_SMTP_HOST || env.SIRAL_ATTACHE_IMAP_HOST,
    port: Number(env.SIRAL_ATTACHE_SMTP_PORT || 465),
    secure: env.SIRAL_ATTACHE_SMTP_SECURE !== '0',
    auth: { user: env.SIRAL_ATTACHE_SMTP_USER || env.SIRAL_ATTACHE_IMAP_USER, pass: env.SIRAL_ATTACHE_SMTP_PASSWORD || env.SIRAL_ATTACHE_IMAP_PASSWORD },
  }
  return {
    owner,
    imap,
    smtp,
    from: env.SIRAL_ATTACHE_FROM || smtp.auth.user,
    imapReady: Boolean(imap.host && imap.auth.user && imap.auth.pass),
    smtpReady: Boolean(owner && smtp.host && smtp.auth.user && smtp.auth.pass),
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
      const uids = await client.search({ seen: false })
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
      out.push({ id: rec.id, recuLe: rec.recuLe, de: rec.de, sujet: rec.sujet, pieces: (rec.attachments || []).length, traite: Boolean(rec.traite), resume: rec.resume })
    } catch {}
  }
  return out
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
  if (resume) rec.resume = String(resume).slice(0, 2000)
  const env = encryptJson(keys.global, rec, { savedAt: rec.traiteLe })
  atomicWrite(attacheDir('inbox', id + '.json'), JSON.stringify(env))
  return true
}

/**
 * Envoi d'un projet au magistrat — SEULE sortie autorisée du système.
 * Aucun paramètre destinataire : l'adresse vient de la configuration,
 * et un garde-fou final vérifie l'en-tête construit.
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
