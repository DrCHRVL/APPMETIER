/**
 * SIRAL — mise à jour du serveur depuis l'app (admin uniquement).
 *
 * Le serveur web ne touche ni au dépôt git ni à Docker : il dialogue par
 * fichiers avec le conteneur « updater » (volume partagé, SIRAL_UPDATER_DIR),
 * seul détenteur de l'accès au démon Docker. Voir scripts/updater.sh.
 *
 *   GET  /api/update           → état (SHA local/distant, retard, changelog, journal, progression)
 *   GET  /api/update?force=1   → idem, après avoir fait re-vérifier GitHub par l'updater
 *   POST /api/update {action:'apply'}   → déclenche pull + rebuild + redémarrage
 *   POST /api/update {action:'rebuild'} → reconstruit le conteneur sur le code déjà présent
 */
import fs from 'fs'
import path from 'path'
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

const UPDATER_DIR = process.env.SIRAL_UPDATER_DIR || ''

interface CheckFile { localSha: string, remoteSha: string, commits: number, fetchOk: boolean, checkedAt: string }
interface StatusFile { state: string, step: string, message: string, at: string }

function readStateFile<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(UPDATER_DIR, name), 'utf8')) as T
  } catch { return null }
}

/** commits.tsv : une ligne par commit « sha ⇥ auteur ⇥ date ISO ⇥ sujet » (du plus récent au plus ancien). */
function readCommitList(): Array<{ sha: string, message: string, author: string, date: string | null, url: null }> {
  try {
    const raw = fs.readFileSync(path.join(UPDATER_DIR, 'commits.tsv'), 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => {
      const [sha, author, date, ...subject] = line.split('\t')
      return { sha: sha || '', author: author || 'inconnu', date: date || null, message: subject.join('\t'), url: null }
    }).filter((c) => c.sha)
  } catch { return [] }
}

/** Dernières lignes d'update.log — pour diagnostiquer un échec depuis l'app (admin). */
function readLogTail(maxBytes = 6000): string {
  try {
    const full = fs.readFileSync(path.join(UPDATER_DIR, 'update.log'), 'utf8')
    return full.length > maxBytes ? full.slice(-maxBytes) : full
  } catch { return '' }
}

function writeRequest(action: 'check' | 'apply' | 'rebuild', requestedBy: string) {
  fs.writeFileSync(
    path.join(UPDATER_DIR, 'request.json'),
    JSON.stringify({ action, requestedBy, requestedAt: new Date().toISOString() })
  )
}

function updaterMissing(): boolean {
  return !UPDATER_DIR || !fs.existsSync(UPDATER_DIR) || !fs.existsSync(path.join(UPDATER_DIR, 'status.json'))
}

function snapshot() {
  const check = readStateFile<CheckFile>('check.json')
  const status = readStateFile<StatusFile>('status.json')
  return {
    available: true,
    localSha: check?.localSha || null,
    remoteSha: check?.remoteSha || null,
    commits: check?.commits || 0,
    fetchOk: check?.fetchOk !== false,
    checkedAt: check?.checkedAt || null,
    commitList: readCommitList(),
    status: status || { state: 'idle', step: '', message: '', at: null },
    logTail: readLogTail(),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NOT_INSTALLED =
  'Service de mise à jour non installé — relancez une fois « docker compose up -d --build » sur le serveur pour l\'activer'

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    if (session.r !== 'admin') return jsonResponse({ error: 'Réservé aux administrateurs' }, { status: 403 })
    if (updaterMissing()) return jsonResponse({ available: false, error: NOT_INSTALLED })

    if (new URL(req.url).searchParams.get('force') === '1') {
      const before = readStateFile<CheckFile>('check.json')?.checkedAt || ''
      writeRequest('check', session.u)
      // l'updater consomme la demande en ~3 s ; on attend le rafraîchissement (≤ 20 s)
      for (let i = 0; i < 40; i++) {
        await sleep(500)
        const cur = readStateFile<CheckFile>('check.json')?.checkedAt || ''
        if (cur && cur !== before) break
      }
    }
    return jsonResponse(snapshot())
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    if (session.r !== 'admin') return jsonResponse({ error: 'Réservé aux administrateurs' }, { status: 403 })
    if (updaterMissing()) return jsonResponse({ success: false, error: NOT_INSTALLED }, { status: 503 })

    const body = await req.json().catch(() => ({})) as { action?: string }
    if (body.action !== 'apply' && body.action !== 'rebuild') {
      return jsonResponse({ success: false, error: 'Action inconnue' }, { status: 400 })
    }

    const status = readStateFile<StatusFile>('status.json')
    if (status?.state === 'updating') {
      return jsonResponse({ success: false, error: 'Une mise à jour est déjà en cours' }, { status: 409 })
    }
    writeRequest(body.action, session.u)
    return jsonResponse({ success: true, started: true })
  })
}
