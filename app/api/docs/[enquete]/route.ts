/**
 * Documents d'enquête (chiffrés côté client).
 * GET  : index des documents d'une enquête.
 * POST : dépôt d'un document { rel, b64, category?, originalName? }.
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { listDocs, saveDoc, appendLog, isSafeName, isSafeRelPath } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { enquete: string } }) {
  return handle(async () => {
    requireSession(req)
    if (!isSafeName(params.enquete)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    return jsonResponse({ documents: listDocs(params.enquete) })
  })
}

export async function POST(req: Request, { params }: { params: { enquete: string } }) {
  return handle(async () => {
    const session = requireSession(req)
    if (!isSafeName(params.enquete)) return jsonResponse({ error: 'Nom invalide' }, { status: 400 })
    const { rel, b64, category, originalName } = await req.json()
    if (typeof rel !== 'string' || typeof b64 !== 'string') {
      return jsonResponse({ error: 'rel et b64 requis' }, { status: 400 })
    }
    // Valide le chemin relatif dès la route (400 explicite), comme GET/DELETE,
    // plutôt que de laisser docPath() lever une 500 générique plus loin.
    if (!isSafeRelPath(rel)) return jsonResponse({ error: 'Chemin invalide' }, { status: 400 })
    if (b64.length > 70 * 1024 * 1024) return jsonResponse({ error: 'Document trop volumineux (50 Mo max)' }, { status: 413 })
    const content = Buffer.from(b64, 'base64')
    const meta = await saveDoc(params.enquete, rel, content, { savedBy: session.u, category, originalName })
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'doc.save', details: { enquete: params.enquete, rel } })
    return jsonResponse({ ok: true, meta })
  })
}
