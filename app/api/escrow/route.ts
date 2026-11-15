/**
 * Paire de clés de l'administrateur général (séquestre — voir lib/web/escrow.ts).
 *  GET            : clé publique (tout membre connecté : l'administrateur d'un
 *                   TJ en a besoin pour sceller le séquestre de son TJ).
 *  GET ?prive=1   : clé privée CHIFFRÉE par la phrase de l'administrateur
 *                   général — à lui seul.
 *  PUT            : publie la paire — administrateur général, UNE SEULE FOIS.
 *                   Aucun remplacement par l'API : un cookie volé ne doit pas
 *                   permettre de substituer une autre clé (les postes des TJ
 *                   épinglent d'ailleurs la première qu'ils voient). Changer de
 *                   paire est une opération serveur délibérée (fichier
 *                   escrow-keypair.json), suivie d'une confirmation dans chaque TJ.
 * Le serveur ne détient jamais la clé privée en clair.
 */
import { requireTjSession, handle, jsonResponse } from '@/lib/server/auth'
import { dataDir, readJson, writeJson, withFileLock, appendLog } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

interface EscrowKeypair {
  publicSpki: string
  publicId: string
  privateEnvelope: { encrypted: true, ct: string, iv: string, kdfSalt: string, kdfIterations: number }
  createdAt: string
  createdBy: string
}

const fichier = () => dataDir('escrow-keypair.json')

export async function GET(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    const pair = readJson<EscrowKeypair | null>(fichier(), null)
    if (!pair) return jsonResponse({ exists: false }, { status: 404 })
    const prive = new URL(req.url).searchParams.get('prive') === '1'
    if (prive) {
      if (session.r !== 'admin') return jsonResponse({ error: 'Réservé à l’administrateur général' }, { status: 403 })
      await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'escrow.private.read', details: { publicId: pair.publicId } })
      return jsonResponse({ exists: true, publicId: pair.publicId, privateEnvelope: pair.privateEnvelope })
    }
    return jsonResponse({ exists: true, publicSpki: pair.publicSpki, publicId: pair.publicId })
  })
}

export async function PUT(req: Request) {
  return handle(async () => {
    const session = requireTjSession(req)
    if (session.r !== 'admin') return jsonResponse({ error: 'Réservé à l’administrateur général' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const env = body?.privateEnvelope
    if (typeof body?.publicSpki !== 'string' || typeof body?.publicId !== 'string'
      || !env || env.encrypted !== true || typeof env.ct !== 'string' || typeof env.iv !== 'string'
      || typeof env.kdfSalt !== 'string' || typeof env.kdfIterations !== 'number') {
      return jsonResponse({ error: 'Paire de clés invalide' }, { status: 400 })
    }
    return withFileLock('escrow-keypair', async () => {
      if (readJson<EscrowKeypair | null>(fichier(), null)) {
        return jsonResponse({ error: 'Une paire existe déjà (remplacement impossible par l’application)' }, { status: 409 })
      }
      const pair: EscrowKeypair = {
        publicSpki: body.publicSpki, publicId: body.publicId, privateEnvelope: env,
        createdAt: new Date().toISOString(), createdBy: session.u,
      }
      writeJson(fichier(), pair)
      await appendLog('audit.jsonl', { timestamp: pair.createdAt, user: session.u, action: 'escrow.keypair', details: { publicId: pair.publicId } })
      return jsonResponse({ ok: true, publicId: pair.publicId })
    })
  })
}
