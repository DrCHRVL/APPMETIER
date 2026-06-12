/**
 * SIRAL — synthèse IA locale.
 *
 * Relaye vers un serveur LLM AUTO-HÉBERGÉ (Ollama sur le même VPS ou le même
 * réseau : SIRAL_IA_URL). Aucune donnée n'est envoyée à un service tiers.
 *
 * Note de sécurité assumée : pour être analysé, le texte du dossier (déchiffré
 * dans le navigateur) transite vers le serveur IA en HTTPS puis est traité en
 * mémoire — il n'est JAMAIS écrit sur disque ni journalisé ici. C'est un
 * compromis volontaire avec l'E2EE, désactivé par défaut (la fonctionnalité
 * n'existe que si l'admin configure SIRAL_IA_URL).
 */
import { requireSession, handle, jsonResponse } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

const IA_URL = () => process.env.SIRAL_IA_URL || ''
const IA_MODEL = () => process.env.SIRAL_IA_MODEL || 'qwen2.5:7b-instruct'
const MAX_CONTENT = 400_000 // ~100k tokens : borne dure côté serveur

export async function GET(req: Request) {
  return handle(async () => {
    requireSession(req)
    if (!IA_URL()) return jsonResponse({ enabled: false })
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 4000)
      const res = await fetch(IA_URL() + '/api/tags', { signal: ctl.signal })
      clearTimeout(t)
      return jsonResponse({ enabled: res.ok, model: IA_MODEL() })
    } catch {
      return jsonResponse({ enabled: false, model: IA_MODEL(), unreachable: true })
    }
  })
}

export async function POST(req: Request) {
  return handle(async () => {
    const session = requireSession(req)
    if (!IA_URL()) return jsonResponse({ error: "Synthèse IA non configurée sur ce serveur (SIRAL_IA_URL)" }, { status: 503 })
    const { system, content } = await req.json()
    if (typeof content !== 'string' || !content.trim()) return jsonResponse({ error: 'Contenu vide' }, { status: 400 })
    if (content.length > MAX_CONTENT || (typeof system === 'string' && system.length > 20_000)) {
      return jsonResponse({ error: 'Dossier trop volumineux pour la synthèse' }, { status: 413 })
    }
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 600_000)
    try {
      const res = await fetch(IA_URL() + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({
          model: IA_MODEL(),
          stream: false,
          options: { temperature: 0.2, num_ctx: 32768 },
          messages: [
            ...(typeof system === 'string' && system.trim() ? [{ role: 'system', content: system }] : []),
            { role: 'user', content },
          ],
        }),
      })
      if (!res.ok) return jsonResponse({ error: 'Serveur IA en erreur (' + res.status + ')' }, { status: 502 })
      const data = await res.json()
      const text = data?.message?.content || ''
      // trace d'usage sans contenu (qui, quand, volume) — jamais le texte
      console.log(`[ia] synthèse par ${session.u} — ${content.length} caractères en entrée, ${text.length} en sortie`)
      return jsonResponse({ ok: true, text, model: IA_MODEL() })
    } catch {
      return jsonResponse({ error: 'Serveur IA injoignable ou délai dépassé' }, { status: 504 })
    } finally {
      clearTimeout(t)
    }
  })
}
