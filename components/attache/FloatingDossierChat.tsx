'use client';

/**
 * SIRAL — Attaché de justice · chat flottant par dossier.
 *
 * Bulle déplaçable (drag), ancrée en bas à droite par défaut — décalée du
 * bouton flottant d'ajout de CR pour éviter tout conflit, et TOUJOURS
 * accessible, y compris pendant la rédaction d'un CR. Réservé à
 * l'administrateur (auto-masqué : la route /status répond 404 sinon).
 *
 * Chaque dossier a SA conversation (persistée par numéro) : on discute du
 * dossier, on demande un diagnostic (éparpillement des enquêteurs,
 * cohérence actes demandés/réalisés, délais TSE en préliminaire).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Scale, X, Send, Loader2, Minus, Stethoscope, GripHorizontal, Wrench, BookOpen } from 'lucide-react';

interface Msg { role: 'user' | 'assistant'; text: string; streaming?: boolean; tools?: string[] }

export function FloatingDossierChat({
  numero,
  cadre = 'preliminaire',
  label,
  carto = false,
}: {
  numero: string;
  cadre?: 'preliminaire' | 'instruction';
  label?: string;
  /** Mode cartographie : chat rattaché au réseau, pas à un dossier. */
  carto?: boolean;
}) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // null = ancrage bas-droite
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [showMem, setShowMem] = useState(false);
  const [mem, setMem] = useState('');
  const [memSaving, setMemSaving] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const convKey = carto ? 'attache_carto_conv' : `attache_dossier_conv_${numero}`;

  // Disponibilité (admin + service actif)
  useEffect(() => {
    fetch('/api/attache/status').then((r) => setAvailable(r.ok)).catch(() => setAvailable(false));
  }, []);

  // reprise de la conversation de CE dossier
  useEffect(() => {
    try { const v = localStorage.getItem(convKey); if (v) setConvId(v); } catch { /* */ }
  }, [convKey]);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }));
  }, []);

  // ── Drag ──
  const onPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget.closest('[data-chatwin]') as HTMLElement)?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const w = 380, h = 520;
    const x = Math.min(Math.max(8, e.clientX - dragRef.current.dx), window.innerWidth - w - 8);
    const y = Math.min(Math.max(8, e.clientY - dragRef.current.dy), window.innerHeight - 60);
    setPos({ x, y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
  };

  // ── Envoi + streaming ──
  const ask = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    setBusy(true);
    setMsgs((p) => [...p, { role: 'user', text }, { role: 'assistant', text: '', streaming: true, tools: [] }]);
    scrollDown();
    try {
      const res = await fetch('/api/attache/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(carto
          ? { message: text, convId: convId || undefined, carto: true }
          : { message: text, convId: convId || undefined, dossier: numero, cadre }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Service indisponible' }));
        setMsgs((p) => { const n = [...p]; n[n.length - 1] = { role: 'assistant', text: `⚠️ ${err.error || 'Erreur'}` }; return n; });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, idx).split('\n').find((l) => l.startsWith('data: '));
          buf = buf.slice(idx + 2);
          if (!line) continue;
          let ev: { type?: string; text?: string; name?: string; convId?: string; ok?: boolean; error?: string };
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === 'delta' && ev.text) {
            setMsgs((p) => { const n = [...p]; const l = n[n.length - 1]; n[n.length - 1] = { ...l, text: (l.text || '') + ev.text }; return n; });
            scrollDown();
          } else if (ev.type === 'tool' && ev.name) {
            setMsgs((p) => { const n = [...p]; const l = n[n.length - 1]; n[n.length - 1] = { ...l, tools: [...(l.tools || []), String(ev.name).replace(/^mcp__siral__/, '')] }; return n; });
          } else if (ev.type === 'final') {
            if (ev.convId) { setConvId(ev.convId); try { localStorage.setItem(convKey, ev.convId); } catch { /* */ } }
            setMsgs((p) => { const n = [...p]; const l = n[n.length - 1]; n[n.length - 1] = { ...l, streaming: false, text: l.text || (ev.ok ? '' : `⚠️ ${ev.error || 'Interrompu'}`) }; return n; });
          }
        }
      }
    } catch {
      setMsgs((p) => { const n = [...p]; const l = n[n.length - 1]; if (l?.streaming) n[n.length - 1] = { ...l, streaming: false, text: l.text || '⚠️ Connexion interrompue' }; return n; });
    } finally {
      setBusy(false); scrollDown();
    }
  }, [busy, convId, numero, cadre, carto, convKey, scrollDown]);

  const openMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/dossier-memoire?numero=' + encodeURIComponent(numero));
      setMem(res.ok ? ((await res.json()).memoire || '') : '');
    } catch { setMem(''); }
    setShowMem(true);
  }, [numero]);

  const saveMemory = useCallback(async () => {
    setMemSaving(true);
    try {
      await fetch('/api/attache/dossier-memoire', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero, contenu: mem }),
      });
      setShowMem(false);
    } finally { setMemSaving(false); }
  }, [numero, mem]);

  if (!available) return null;

  // Bouton fermé — décalé vers le haut pour ne pas heurter le flottant « + CR »
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Discuter de ce dossier avec l'attaché"
        className="fixed bottom-24 right-5 z-[60] flex items-center gap-2 rounded-full bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] px-3.5 py-2.5 text-white shadow-lg hover:brightness-110"
      >
        <Scale className="h-4 w-4" />
        <span className="text-xs font-semibold">Attaché</span>
      </button>
    );
  }

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : { right: 20, bottom: 96 };

  return (
    <div
      data-chatwin
      style={style}
      className="fixed z-[60] flex h-[520px] w-[380px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
    >
      {/* Barre de titre — poignée de déplacement */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-grab items-center gap-2 border-b border-gray-200 bg-gray-50/80 px-3 py-2 active:cursor-grabbing"
      >
        <GripHorizontal className="h-3.5 w-3.5 text-gray-300" />
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
          <Scale className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-gray-800">Attaché · {carto ? 'Cartographie' : (label || numero)}</div>
          <div className="text-[10px] text-gray-400">{carto ? 'réseau' : (cadre === 'instruction' ? 'instruction' : 'préliminaire')} · vous seul</div>
        </div>
        {!carto && <button onClick={openMemory} title="Mémoire du dossier" className="rounded p-1 text-gray-400 hover:bg-gray-100"><BookOpen className="h-3.5 w-3.5" /></button>}
        <button onClick={() => setOpen(false)} title="Réduire" className="rounded p-1 text-gray-400 hover:bg-gray-100"><Minus className="h-3.5 w-3.5" /></button>
        <button onClick={() => { setOpen(false); }} title="Fermer" className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-3.5 w-3.5" /></button>
      </div>

      {/* Fil */}
      <div ref={streamRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && (
          <div className="mt-4 space-y-2 text-center">
            <p className="text-xs text-gray-500">{carto ? 'Questions sur le réseau, ou analyse.' : 'Questions sur ce dossier, ou diagnostic.'}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {(carto
                ? ['Qui sont les figures centrales ?', 'Quels ponts entre affaires ?', 'Quels liens manquent ?']
                : ['Fais le point du dossier', 'Les délais sont-ils tenus ?', 'Cohérence des actes ?']).map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10.5px] text-gray-600 hover:bg-gray-100">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? (
          <div key={i} className="ml-6 rounded-xl rounded-br-sm border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[12.5px] text-gray-800 whitespace-pre-wrap">{m.text}</div>
        ) : (
          <div key={i} className="flex gap-1.5">
            <div className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white"><Scale className="h-2.5 w-2.5" /></div>
            <div className="min-w-0 flex-1">
              {(m.tools?.length ?? 0) > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {m.tools!.map((t, j) => (
                    <span key={j} className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-medium text-emerald-700"><Wrench className="h-2 w-2" />{t}</span>
                  ))}
                </div>
              )}
              <div className="text-[12.5px] leading-relaxed text-gray-800 whitespace-pre-wrap">{m.text}</div>
              {m.streaming && <Loader2 className="mt-1 h-3 w-3 animate-spin text-gray-400" />}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-200 p-2">
        <div className="mb-1.5 flex">
          <button
            onClick={() => ask(carto
              ? 'Analyse le réseau : figures centrales, ponts entre affaires, cloisonnements, et liens de renseignement qui semblent manquer. Propose ceux que tu détectes (avec la source).'
              : 'Fais un diagnostic du dossier : éparpillement des enquêteurs, cohérence entre actes demandés et réalisés, et respect des délais (TSE en préliminaire). Sois concret et chiffré.')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2B5746]/25 bg-emerald-50/50 px-2.5 py-1.5 text-[11px] font-semibold text-[#2B5746] hover:bg-emerald-50 disabled:opacity-50"
          >
            <Stethoscope className="h-3.5 w-3.5" />{carto ? 'Analyser le réseau' : 'Diagnostic du dossier'}
          </button>
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 focus-within:border-[#2B5746]/40">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            placeholder={carto ? 'Question sur le réseau…' : 'Question sur ce dossier…'}
            rows={1}
            className="max-h-24 flex-1 resize-none bg-transparent text-[12.5px] text-gray-800 outline-none placeholder:text-gray-400"
          />
          <button onClick={() => ask(input)} disabled={busy || !input.trim()} className="grid h-6 w-6 place-items-center rounded-lg bg-[#2B5746] text-white disabled:opacity-40">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Mémoire du dossier — petit md, relu et enrichi par l'attaché,
          éditable à la main. Volontairement court (plafonné côté serveur). */}
      {showMem && (
        <div className="absolute inset-0 z-10 flex flex-col bg-white">
          <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
            <BookOpen className="h-3.5 w-3.5 text-[#2B5746]" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-gray-800">Mémoire du dossier</div>
              <div className="text-[10px] text-gray-400">l'essentiel de vos échanges — court par choix</div>
            </div>
            <button onClick={() => setShowMem(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X className="h-3.5 w-3.5" /></button>
          </div>
          <textarea
            value={mem}
            onChange={(e) => setMem(e.target.value)}
            placeholder="(vide — l'attaché la remplira au fil des échanges)"
            className="flex-1 resize-none p-3 font-mono text-[11.5px] leading-relaxed text-gray-800 outline-none"
          />
          <div className="flex justify-end gap-2 border-t border-gray-200 p-2">
            <button onClick={() => setShowMem(false)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50">Fermer</button>
            <button onClick={saveMemory} disabled={memSaving} className="rounded-lg bg-[#2B5746] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">{memSaving ? '…' : 'Enregistrer'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
