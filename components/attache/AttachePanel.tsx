'use client';

/**
 * SIRAL — Attaché de justice · panneau de discussion.
 *
 * Volet latéral droit, réservé à l'administrateur du TJ confié (invisible de
 * tout autre utilisateur). Interface volontairement sobre, calquée sur Claude
 * web : messages en prose, streaming, composer bas. En tête, le fil
 * « pendant votre absence » — ce que l'attaché a préparé proactivement.
 *
 * Tout ce qui est chiffré (fil, transcripts, mémoire) est déchiffré ICI,
 * dans le navigateur, avec la clé globale du trousseau de l'admin.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Send, Plus, Scale, BookOpen, RefreshCw, Loader2, Inbox,
  History, ChevronDown, ChevronUp, Wrench, AlertTriangle, Sparkles,
} from 'lucide-react';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface ChatMessage { role: 'user' | 'assistant'; text: string; at?: string; run?: string; streaming?: boolean; tools?: string[] }
interface FeedCard { type: string; titre: string; resume: string; numero?: string; at?: string }
interface ConvMeta { id: string; mtime: string }

const FEED_SEEN_KEY = 'attache_feed_seen_ts';

const FEED_ICONS: Record<string, string> = {
  mail_traite: '📨', synthese: '📋', acte: '⚖️', prolongation: '🕐',
  projet_reponse: '✉️', alerte: '⚠️', note: '📝',
};

export function AttachePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConvMeta[]>([]);
  const [showConvList, setShowConvList] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [feed, setFeed] = useState<Array<FeedCard & { ts: number }>>([]);
  const [feedOpen, setFeedOpen] = useState(true);
  const [status, setStatus] = useState<any>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const [memorySaving, setMemorySaving] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => {
      streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
    });
  }, []);

  // ── Chargement à l'ouverture : statut, fil, conversations ──
  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/feed');
      if (!res.ok) return;
      const { entries } = await res.json();
      const out: Array<FeedCard & { ts: number }> = [];
      for (const e of entries as Array<{ ts: number; iv: string; ct: string }>) {
        const card = await eapi().attache_decrypt({ v: 1, encrypted: true, iv: e.iv, ct: e.ct });
        if (card) out.push({ ...(card as FeedCard), ts: e.ts });
      }
      setFeed(out.reverse());
    } catch { /* silencieux */ }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/conversations');
      if (!res.ok) return;
      const { conversations: list } = await res.json();
      setConversations(list || []);
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetch('/api/attache/status').then(async (r) => setStatus(r.ok ? await r.json() : { error: true })).catch(() => setStatus({ error: true }));
    loadFeed();
    loadConversations();
  }, [open, loadFeed, loadConversations]);

  // ── Conversation ──
  const openConversation = useCallback(async (id: string) => {
    setShowConvList(false);
    try {
      const res = await fetch('/api/attache/conversations/' + encodeURIComponent(id));
      if (!res.ok) return;
      const { envelope } = await res.json();
      const conv = await eapi().attache_decrypt(envelope);
      if (!conv) return;
      setConvId(id);
      setMessages((conv.messages || []).map((m: ChatMessage) => ({ role: m.role, text: m.text, at: m.at, run: m.run })));
      scrollDown();
    } catch { /* silencieux */ }
  }, [scrollDown]);

  const newConversation = useCallback(() => {
    setConvId(null);
    setMessages([]);
    setShowConvList(false);
  }, []);

  // ── Envoi + streaming SSE ──
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMessages((prev) => [...prev, { role: 'user', text }, { role: 'assistant', text: '', streaming: true, tools: [] }]);
    scrollDown();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch('/api/attache/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, convId: convId || undefined }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', text: `⚠️ ${err.error || 'Le service attaché ne répond pas.'}`, streaming: false };
          return next;
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let ev: any;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'delta' && ev.text) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, text: (last.text || '') + ev.text };
              return next;
            });
            scrollDown();
          } else if (ev.type === 'tool' && ev.name) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              const label = String(ev.name).replace(/^mcp__siral__/, '');
              next[next.length - 1] = { ...last, tools: [...(last.tools || []), label] };
              return next;
            });
          } else if (ev.type === 'final') {
            if (ev.convId) setConvId(ev.convId);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = {
                ...last,
                streaming: false,
                text: last.text || (ev.ok ? '' : `⚠️ ${ev.error || 'Run interrompu.'}`),
              };
              return next;
            });
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) next[next.length - 1] = { ...last, streaming: false, text: last.text || '⚠️ Connexion interrompue.' };
        return next;
      });
    } finally {
      setBusy(false);
      abortRef.current = null;
      loadConversations();
      loadFeed();
      scrollDown();
    }
  }, [input, busy, convId, scrollDown, loadConversations, loadFeed]);

  // ── Mémoire ──
  const openMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/memory');
      const { envelope } = await res.json();
      if (envelope) {
        const payload = await eapi().attache_decrypt(envelope);
        setMemoryText(payload?.content || '');
      } else {
        setMemoryText('');
      }
      setShowMemory(true);
    } catch { /* silencieux */ }
  }, []);

  const saveMemory = useCallback(async () => {
    setMemorySaving(true);
    try {
      const envelope = await eapi().attache_encrypt({ content: memoryText });
      const res = await fetch('/api/attache/memory', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope }),
      });
      if (res.ok) setShowMemory(false);
    } finally {
      setMemorySaving(false);
    }
  }, [memoryText]);

  // fil : marquer vu à la fermeture du bloc
  const unseenCount = feed.filter((f) => f.ts > Number(localStorage.getItem(FEED_SEEN_KEY) || 0)).length;
  const markFeedSeen = useCallback(() => {
    if (feed.length) localStorage.setItem(FEED_SEEN_KEY, String(feed[0].ts));
  }, [feed]);

  if (!open) return null;

  const keyringOk = status?.keyring?.granted;
  const claudeOk = status?.claude?.ok;

  return (
    <div className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[440px] flex-col border-l border-gray-200 bg-white shadow-2xl">
      {/* En-tête */}
      <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3">
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
          <Scale className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900">Attaché de justice</div>
          <div className="truncate text-[11px] text-gray-500">
            {status?.error ? 'service injoignable' :
              !keyringOk ? 'clés non remises — voir Paramètres' :
              !claudeOk ? 'Claude non connecté sur le serveur' :
              'administrateur · ' + (status?.contentieux || '')}
          </div>
        </div>
        <button onClick={openMemory} title="Mémoire de l'attaché" className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50">
          <BookOpen className="h-4 w-4" />
        </button>
        <div className="relative">
          <button onClick={() => setShowConvList((v) => !v)} title="Conversations" className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50">
            <History className="h-4 w-4" />
          </button>
          {showConvList && (
            <div className="absolute right-0 top-9 z-10 max-h-72 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
              {conversations.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Aucune conversation</div>}
              {conversations.map((c) => (
                <button key={c.id} onClick={() => openConversation(c.id)} className="block w-full truncate px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50">
                  {c.id} <span className="text-gray-400">· {new Date(c.mtime).toLocaleDateString('fr-FR')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={newConversation} title="Nouvelle conversation" className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50">
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Alerte de configuration */}
      {status && !status.error && (!keyringOk || !claudeOk) && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            {!keyringOk && 'Le trousseau n\'a pas été remis : Paramètres → Attaché IA → « Remettre les clés ». '}
            {!claudeOk && 'Claude Code n\'est pas authentifié sur le serveur (claude login).'}
          </span>
        </div>
      )}

      {/* Fil « pendant votre absence » */}
      {feed.length > 0 && (
        <div className="border-b border-gray-200 bg-gray-50/70">
          <button
            onClick={() => { setFeedOpen((v) => !v); if (feedOpen) markFeedSeen(); }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#2B5746]" />
            <span className="flex-1 text-xs font-semibold text-gray-700">
              Pendant votre absence
              {unseenCount > 0 && <span className="ml-2 rounded-full bg-[#2B5746] px-1.5 py-0.5 text-[10px] font-bold text-white">{unseenCount}</span>}
            </span>
            {feedOpen ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
          </button>
          {feedOpen && (
            <div className="max-h-56 space-y-2 overflow-y-auto px-4 pb-3">
              {feed.slice(0, 20).map((f, i) => (
                <div key={i} className="rounded-lg border border-gray-200 bg-white p-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
                    <span>{FEED_ICONS[f.type] || '•'}</span>
                    <span className="flex-1 truncate">{f.titre}</span>
                    {f.numero && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{f.numero}</span>}
                  </div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{f.resume}</div>
                  <div className="mt-1 text-[10px] text-gray-400">{f.at ? new Date(f.at).toLocaleString('fr-FR') : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={streamRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-8 space-y-3 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
              <Scale className="h-6 w-6" />
            </div>
            <p className="text-sm text-gray-600">Votre attaché est prêt.</p>
            <div className="mx-auto flex max-w-xs flex-wrap justify-center gap-1.5">
              {['Fais la synthèse d\'un dossier', 'Vérifie les échéances de tous les dossiers', 'Quoi de neuf dans la boîte ?'].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-gray-100">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === 'user' ? (
          <div key={i} className="ml-8 rounded-2xl rounded-br-md border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap">
            {m.text}
          </div>
        ) : (
          <div key={i} className="flex gap-2.5">
            <div className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-md bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
              <Scale className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1">
              {(m.tools?.length ?? 0) > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {m.tools!.map((t, j) => (
                    <span key={j} className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                      <Wrench className="h-2.5 w-2.5" />{t}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[13px] leading-relaxed text-gray-800 whitespace-pre-wrap">{m.text}</div>
              {m.streaming && <Loader2 className="mt-1 h-3.5 w-3.5 animate-spin text-gray-400" />}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 p-3">
        <div className="rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm focus-within:border-[#2B5746]/40">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Parlez à votre attaché…"
            rows={2}
            className="w-full resize-none bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
          />
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10.5px] text-gray-400">Claude · votre abonnement</span>
            {status?.inbox?.nonTraites > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-600"><Inbox className="h-3 w-3" />{status.inbox.nonTraites} mail(s) en cours</span>
            )}
            <button
              onClick={() => { fetch('/api/attache/inbox', { method: 'POST' }).then(() => loadFeed()); }}
              title="Relever la boîte maintenant"
              className="ml-auto rounded-md p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={send}
              disabled={busy || !input.trim()}
              className="grid h-7 w-7 place-items-center rounded-lg bg-[#2B5746] text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-gray-400">
          Il agit dans SIRAL (réversible, journalisé) · seule sortie : votre adresse mail
        </p>
      </div>

      {/* Modale mémoire */}
      {showMemory && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
            <BookOpen className="h-4 w-4 text-[#2B5746]" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900">Mémoire de l'attaché</div>
              <div className="text-[11px] text-gray-500">Tout ce qu'il sait de vous — lisible, corrigeable, effaçable</div>
            </div>
            <button onClick={() => setShowMemory(false)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={memoryText}
            onChange={(e) => setMemoryText(e.target.value)}
            className="flex-1 resize-none p-4 font-mono text-[12px] leading-relaxed text-gray-800 outline-none"
            placeholder="(mémoire vide)"
          />
          <div className="flex justify-end gap-2 border-t border-gray-200 p-3">
            <button onClick={() => setShowMemory(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
            <button onClick={saveMemory} disabled={memorySaving} className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {memorySaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
