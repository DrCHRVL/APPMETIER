import { requireSession, handle, jsonResponse } from '@/lib/server/auth'
import { readDoc, deleteDoc, appendLog, isSafeName, isSafeRelPath } from '@/lib/server/store'

export const dynamic = 'force-dynamic'

function relOf(parts: string[]): string {
  return parts.map(decodeURIComponent).join('/')
}

export async function GET(req: Request, { params }: { params: { enquete: string, path: string[] } }) {
  return handle(async () => {
    requireSession(req)
    const rel = relOf(params.path)
    if (!isSafeName(params.enquete) || !isSafeRelPath(rel)) return jsonResponse({ error: 'Chemin invalide' }, { status: 400 })
    const content = readDoc(params.enquete, rel)
    if (!content) return jsonResponse({ error: 'Introuvable' }, { status: 404 })
    return new Response(new Uint8Array(content), {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
    })
  })
}

export async function DELETE(req: Request, { params }: { params: { enquete: string, path: string[] } }) {
  return handle(async () => {
    const session = requireSession(req)
    const rel = relOf(params.path)
    if (!isSafeName(params.enquete) || !isSafeRelPath(rel)) return jsonResponse({ error: 'Chemin invalide' }, { status: 400 })
    const deleted = await deleteDoc(params.enquete, rel)
    await appendLog('audit.jsonl', { timestamp: new Date().toISOString(), user: session.u, action: 'doc.delete', details: { enquete: params.enquete, rel } })
    return jsonResponse({ ok: deleted })
  })
}
