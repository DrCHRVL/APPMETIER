/**
 * Référentiel NATINF (nomenclature publique des infractions) servi par le serveur.
 *
 * GET  /api/natinf            -> tableau des entrées NatinfEntry (avec ETag/cache)
 * GET  /api/natinf?meta=1     -> métadonnées de la version publiée (sans entrées)
 * POST /api/natinf            -> publication d'un nouveau référentiel (admin)
 *
 * La version publiée par un admin est stockée dans {DATA_DIR}/natinf.json et
 * prime sur le référentiel embarqué avec l'application (repli). Le navigateur
 * interroge cette route ; aucune donnée n'est dans le bundle client.
 */
import fs from 'fs'
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { dataDir, writeJson, withFileLock, appendLog } from '@/lib/server/store'
import bundled from '@/data/natinf/natinf.json'
import type { NatinfEntry } from '@/types/natinf'

export const dynamic = 'force-dynamic'

interface PublishedReferential {
  version: number
  updatedAt: string
  updatedBy: string
  source?: string
  count: number
  entries: NatinfEntry[]
}

const BUNDLED = bundled as unknown as NatinfEntry[]
const filePath = () => dataDir('natinf.json')

// Cache mémoire serveur : évite de relire/parser ~7 Mo à chaque requête.
let cache: { mtimeMs: number; data: PublishedReferential } | null = null

function getPublished(): PublishedReferential | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath())
  } catch {
    cache = null
    return null
  }
  if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data
  try {
    const data = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as PublishedReferential
    cache = { mtimeMs: stat.mtimeMs, data }
    return data
  } catch {
    return null
  }
}

function currentEntries(): { entries: NatinfEntry[]; version: string } {
  const pub = getPublished()
  if (pub && Array.isArray(pub.entries)) return { entries: pub.entries, version: String(pub.version) }
  return { entries: BUNDLED, version: 'bundled' }
}

function currentMeta() {
  const pub = getPublished()
  if (pub) {
    return {
      published: true,
      version: pub.version,
      updatedAt: pub.updatedAt,
      updatedBy: pub.updatedBy,
      source: pub.source || null,
      count: pub.count ?? (Array.isArray(pub.entries) ? pub.entries.length : 0),
    }
  }
  return { published: false, version: null, updatedAt: null, updatedBy: null, source: null, count: BUNDLED.length }
}

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    const url = new URL(req.url)
    if (url.searchParams.get('meta') === '1') {
      return jsonResponse(currentMeta(), { headers: { 'cache-control': 'no-store' } })
    }
    const { entries, version } = currentEntries()
    const etag = `W/"natinf-${version}"`
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag } })
    }
    return new Response(JSON.stringify(entries), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag,
        // Revalidation systématique : le navigateur garde sa copie tant que
        // l'ETag (la version) ne change pas (304 sinon corps complet).
        'cache-control': 'private, max-age=0, must-revalidate',
      },
    })
  })
}

/**
 * Ajoute une seule infraction au référentiel courant (saisie manuelle admin).
 * Le numéro NATINF doit être unique : la vérification et l'écriture se font
 * sous verrou pour éviter toute course entre deux ajouts concurrents.
 */
async function addSingleEntry(session: { u: string }, raw: any) {
  const code = typeof raw?.code === 'string' ? raw.code.trim() : ''
  const libelle = typeof raw?.libelle === 'string' ? raw.libelle.trim() : ''
  const articlesDefinition = typeof raw?.articlesDefinition === 'string' ? raw.articlesDefinition.trim() : ''
  const articlesRepression = typeof raw?.articlesRepression === 'string' ? raw.articlesRepression.trim() : ''

  if (!/^\d{1,7}$/.test(code)) {
    return jsonResponse({ error: 'Numéro NATINF invalide (chiffres uniquement).' }, { status: 400 })
  }
  if (!libelle) {
    return jsonResponse({ error: 'Le nom de l’infraction est obligatoire.' }, { status: 400 })
  }
  if (libelle.length > 300 || articlesDefinition.length > 500 || articlesRepression.length > 500) {
    return jsonResponse({ error: 'Un des champs dépasse la longueur autorisée.' }, { status: 400 })
  }

  const newEntry: NatinfEntry = {
    code,
    libelle,
    nature: 'inconnu',
    quantum: {},
    quantumLabel: '',
    frequent: false,
    ...(articlesDefinition ? { articlesDefinition } : {}),
    ...(articlesRepression ? { articlesRepression } : {}),
  }

  let conflict = false
  let count = 0
  let version = 0
  const updatedAt = new Date().toISOString()
  await withFileLock('natinf', async () => {
    const { entries } = currentEntries()
    if (entries.some((e) => e.code === code)) {
      conflict = true
      return
    }
    version = Date.now()
    const record: PublishedReferential = {
      version,
      updatedAt,
      updatedBy: session.u,
      source: `Ajout manuel — NATINF ${code}`,
      count: entries.length + 1,
      entries: [...entries, newEntry],
    }
    writeJson(filePath(), record)
    count = record.count
    cache = null
  })

  if (conflict) {
    return jsonResponse({ error: `Le numéro NATINF ${code} est déjà utilisé.` }, { status: 409 })
  }

  await appendLog('audit.jsonl', {
    timestamp: updatedAt,
    user: session.u,
    action: 'natinf.addEntry',
    details: { code, libelle, version, count },
  })
  return jsonResponse({ ok: true, version, count })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    if (session.r !== 'admin') {
      return jsonResponse({ error: 'Réservé à l’administrateur' }, { status: 403 })
    }
    const body = await req.json().catch(() => null)

    // Ajout manuel d'une seule infraction (admin). Le numéro doit être unique :
    // la vérification se fait sous verrou, à partir du référentiel courant
    // (version publiée, sinon référentiel embarqué).
    if (body?.addEntry) {
      return addSingleEntry(session, body.addEntry)
    }

    const entries = body?.entries
    if (!Array.isArray(entries) || entries.length === 0) {
      return jsonResponse({ error: 'Référentiel vide ou invalide' }, { status: 400 })
    }
    if (entries.length > 60000) {
      return jsonResponse({ error: 'Référentiel trop volumineux' }, { status: 413 })
    }
    const first = entries[0]
    if (!first || typeof first.code !== 'string' || typeof first.libelle !== 'string') {
      return jsonResponse({ error: 'Format d’entrée NATINF invalide' }, { status: 400 })
    }
    const record: PublishedReferential = {
      version: Date.now(),
      updatedAt: new Date().toISOString(),
      updatedBy: session.u,
      source: typeof body.source === 'string' ? body.source.slice(0, 200) : undefined,
      count: entries.length,
      entries,
    }
    await withFileLock('natinf', async () => {
      writeJson(filePath(), record)
    })
    cache = null
    await appendLog('audit.jsonl', {
      timestamp: record.updatedAt,
      user: session.u,
      action: 'natinf.publish',
      details: { count: record.count, version: record.version, source: record.source },
    })
    return jsonResponse({ ok: true, version: record.version, count: record.count })
  })
}
