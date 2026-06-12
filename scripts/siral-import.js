#!/usr/bin/env node
/**
 * SIRAL — import des données existantes vers le serveur web (E2EE).
 *
 * Prend les fichiers de l'app Electron (partage réseau et/ou dossier data/)
 * et produit l'arborescence chiffrée `srv-data/` du serveur SIRAL.
 * Le chiffrement est fait ICI, avec la phrase secrète : le serveur ne reçoit
 * que des enveloppes opaques. À exécuter sur un poste de confiance.
 *
 * Usage :
 *   node scripts/siral-import.js --source <dossier_serveur_P> [--docs <dossier_documentenquete>] --out <srv-data> --passphrase "..."
 *
 * Produit un RAPPORT DE COMPLÉTUDE (comptages source/destination) et refuse
 * de conclure si un compteur diverge.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : fallback
}

const SOURCE = arg('source')
const DOCS = arg('docs')
const OUT = arg('out', './srv-data')
const PASSPHRASE = arg('passphrase')
const USER = arg('user', 'import')

if (!SOURCE || !PASSPHRASE) {
  console.error('Usage: node scripts/siral-import.js --source <dossier> [--docs <dossier>] --out <srv-data> --passphrase "..."')
  process.exit(1)
}

const report = { vaults: [], docs: { source: 0, written: 0 }, errors: [] }

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }) }
function readJsonFile(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8')
    if (!raw.trim()) return null
    return JSON.parse(raw)
  } catch (e) {
    report.errors.push(`Lecture ${p} : ${e.message}`)
    return null
  }
}

// ── KDF identique au navigateur : PBKDF2-SHA256 600k itérations ──
function loadOrCreateKdf() {
  const p = path.join(OUT, 'kdf.json')
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'))
  const kdf = {
    salt: crypto.randomBytes(16).toString('base64url'),
    iterations: 600000,
    alg: 'PBKDF2-SHA256',
    createdAt: new Date().toISOString(),
    createdBy: USER,
  }
  ensureDir(OUT)
  fs.writeFileSync(p, JSON.stringify(kdf, null, 2))
  return kdf
}

function deriveKey(passphrase, kdf) {
  return crypto.pbkdf2Sync(passphrase, Buffer.from(kdf.salt, 'base64url'), kdf.iterations, 32, 'sha256')
}

function encryptJson(key, payload, meta = {}) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  const ct = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
  return {
    v: 1, encrypted: true,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    savedAt: meta.savedAt || new Date().toISOString(),
    savedBy: meta.savedBy || USER,
    receivedAt: new Date().toISOString(),
  }
}

function encryptBytes(key, bytes) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()])
  // format du pont web : 'SIR1' + iv(12) + ct
  return Buffer.concat([Buffer.from('SIR1'), iv, ct])
}

function writeVault(key, name, payload, meta) {
  const p = path.join(OUT, 'vaults', name + '.json')
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, JSON.stringify(encryptJson(key, payload, meta), null, 2))
  report.vaults.push({ name, ok: true })
  console.log(`  ✓ coffre ${name}`)
}

function main() {
  console.log('SIRAL — import E2EE')
  console.log('Source  :', SOURCE)
  console.log('Sortie  :', OUT)
  const kdf = loadOrCreateKdf()
  const key = deriveKey(PASSPHRASE, kdf)

  // Coffre-témoin (vérification de la phrase au déverrouillage)
  writeVault(key, 'e2ee-check', { check: 'siral', createdAt: new Date().toISOString() })

  // ── Fichiers racine du partage ──
  const rootFiles = [
    ['users.json', 'users-config'],
    ['tag-data.json', 'tags'],
    ['audience-data.json', 'audience'],
    ['alerts-data.json', 'alerts'],
    ['deleted-ids.json', 'deleted-ids'],
    ['cartographie-overlays.json', 'cartographie'],
  ]
  for (const [file, vault] of rootFiles) {
    const p = path.join(SOURCE, file)
    if (!fs.existsSync(p)) { console.log(`  – ${file} absent (ignoré)`); continue }
    const payload = readJsonFile(p)
    if (payload !== null) writeVault(key, vault, payload)
  }

  // app-data.json racine (legacy) + métadonnées
  const legacyData = path.join(SOURCE, 'app-data.json')
  if (fs.existsSync(legacyData)) {
    const data = readJsonFile(legacyData)
    const metadata = readJsonFile(path.join(SOURCE, 'app-data-metadata.json'))
    if (data !== null) {
      writeVault(key, 'app-data', { data, metadata }, metadata || {})
      writeVault(key, 'legacy-app-data', data)
    }
  }

  // ── Contentieux : tout sous-dossier contenant app-data.json ──
  for (const entry of fs.readdirSync(SOURCE, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const ctxData = path.join(SOURCE, entry.name, 'app-data.json')
    if (!fs.existsSync(ctxData)) continue
    const payload = readJsonFile(ctxData)
    if (payload !== null) {
      // le fichier contentieux contient déjà { data, metadata }
      const normalized = payload.data !== undefined ? payload : { data: payload, metadata: null }
      writeVault(key, `ctx-${entry.name}`, normalized, normalized.metadata || {})
    }
  }

  // ── Instructions par utilisateur : *-instructions.json (racine + sous-dossiers) ──
  const instrDirs = [SOURCE, ...fs.readdirSync(SOURCE, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(SOURCE, e.name))]
  const seenInstr = new Set()
  for (const dir of instrDirs) {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('-instructions.json'))) {
      const username = f.slice(0, -'-instructions.json'.length).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
      if (seenInstr.has(username)) continue
      seenInstr.add(username)
      const payload = readJsonFile(path.join(dir, f))
      if (payload !== null) writeVault(key, `instructions-${username}`, payload)
    }
  }

  // ── Préférences utilisateur ──
  const prefsDir = path.join(SOURCE, 'user-preferences')
  if (fs.existsSync(prefsDir)) {
    for (const f of fs.readdirSync(prefsDir).filter((f) => f.endsWith('.json'))) {
      const payload = readJsonFile(path.join(prefsDir, f))
      if (payload !== null) writeVault(key, `user-prefs-${f.slice(0, -5)}`, payload)
    }
  }

  // ── Alertes par contentieux ──
  const ctxAlertsDir = path.join(SOURCE, 'contentieux-alerts')
  if (fs.existsSync(ctxAlertsDir)) {
    for (const f of fs.readdirSync(ctxAlertsDir).filter((f) => f.endsWith('.json'))) {
      const payload = readJsonFile(path.join(ctxAlertsDir, f))
      if (payload !== null) writeVault(key, `ctx-alerts-${f.slice(0, -5)}`, payload)
    }
  }

  // ── Documents d'enquête ──
  if (DOCS && fs.existsSync(DOCS)) {
    for (const enq of fs.readdirSync(DOCS, { withFileTypes: true })) {
      if (!enq.isDirectory()) continue
      const enqSafe = enq.name.replace(/[^a-zA-Z0-9._@-]/g, '_')
      const index = []
      const walk = (dir, prefix) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) { walk(full, prefix ? `${prefix}/${e.name}` : e.name); continue }
          report.docs.source++
          try {
            const bytes = fs.readFileSync(full)
            const enc = encryptBytes(key, bytes)
            const rel = prefix ? `${prefix}/${e.name}` : e.name
            const outPath = path.join(OUT, 'docs', enqSafe, rel + '.enc')
            ensureDir(path.dirname(outPath))
            fs.writeFileSync(outPath, enc)
            index.push({
              rel, size: enc.length,
              savedAt: new Date().toISOString(), savedBy: USER,
              category: prefix ? prefix.split('/')[0] : undefined,
              originalName: e.name,
            })
            report.docs.written++
          } catch (err) {
            report.errors.push(`Document ${full} : ${err.message}`)
          }
        }
      }
      walk(path.join(DOCS, enq.name), '')
      if (index.length) {
        ensureDir(path.join(OUT, 'docs', enqSafe))
        fs.writeFileSync(path.join(OUT, 'docs', enqSafe, '.index.json'), JSON.stringify(index, null, 2))
        console.log(`  ✓ documents ${enq.name} (${index.length})`)
      }
    }
  }

  // ── Rapport de complétude ──
  console.log('\n══ RAPPORT DE COMPLÉTUDE ══')
  console.log(`Coffres écrits     : ${report.vaults.length}`)
  console.log(`Documents source   : ${report.docs.source}`)
  console.log(`Documents écrits   : ${report.docs.written}`)
  console.log(`Erreurs            : ${report.errors.length}`)
  report.errors.forEach((e) => console.log('  ✗', e))
  fs.writeFileSync(path.join(OUT, 'import-report.json'), JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2))
  if (report.errors.length || report.docs.source !== report.docs.written) {
    console.error('\n❌ IMPORT INCOMPLET — ne pas mettre en service. Corrigez et relancez (idempotent).')
    process.exit(2)
  }
  console.log('\n✅ Import complet. Rapport : ' + path.join(OUT, 'import-report.json'))
}

main()
