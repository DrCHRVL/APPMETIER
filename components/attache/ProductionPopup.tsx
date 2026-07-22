'use client';

/**
 * SIRAL — Attaché de justice · popup d'un document rédigé.
 *
 * Ouvert depuis le journal « pendant votre absence » (dashboard) sur une carte
 * reliée à une production (acte ou livrable). Il donne, dans une seule fenêtre :
 *  - la LECTURE + l'ÉDITION manuelle du texte (textarea serif) ;
 *  - la RETOUCHE par l'attaché via un mini-chat (« ha non, plutôt… ») — même
 *    conversation que le chat du dossier ; après un tour, le texte se recharge ;
 *  - l'EXPORT PDF / Word au gabarit officiel ;
 *  - la VALIDATION (l'acte est marqué traité).
 *
 * C'est la MÊME production que celle de la fiche dossier (« Actes rédigés ») :
 * une modification ici s'y répercute, et inversement — source unique, aucune
 * copie. Chiffrement E2E : le navigateur déchiffre pour afficher, rechiffre à
 * l'enregistrement ; l'app ne voit jamais le texte en clair.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Save, FileDown, FileText, CheckCircle2, Loader2, Scale, Send, RefreshCw, Wrench, Undo2,
} from 'lucide-react';
import { downloadActePdf, downloadActeDocx, acteFileBase } from '@/lib/web/acteExport';
import { AttacheConfig, loadAttacheConfig } from './modelOptions';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import type { ActeMeta } from '@/types/interfaces';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface Production {
  id: string;
  numero: string;
  type: string;
  titre: string;
  contenu: string;
  source?: string;
  /** Objet de l'acte (n° de ligne interceptée, objet géolocalisé…) — dernier segment du nom de fichier. */
  objet?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  traite?: boolean;
  traiteLe?: string;
  acteMeta?: ActeMeta;
}

interface ChatMsg { role: 'user' | 'assistant'; text: string; streaming?: boolean; tools?: string[] }

const TYPE_LABEL: Record<string, string> = {
  requisition: 'Réquisition',
  reponse_dml: 'Réponse DML',
  prolongation_jld: 'Prolongation JLD',
  saisine_jld: 'Saisine JLD',
  projet_reponse: 'Projet de réponse',
  soit_transmis: 'Soit-transmis',
  note: 'Note',
  livrable: 'Livrable',
  autre: 'Acte',
};

export function ProductionPopup({ numero, prodId, service, onClose, onChanged }: {
  numero: string;
  prodId: string;
  /** Service d'enquête du dossier — 2ᵉ segment du nom de fichier exporté. */
  service?: string;
  onClose: () => void;
  /** Appelé après tout changement persisté (édition, retouche, validation). */
  onChanged?: () => void;
}) {
  const [prod, setProd] = useState<Production | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Mini-chat de retouche
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AttacheConfig>({});
  const chatRef = useRef<HTMLDivElement>(null);
  const convKey = `attache_dossier_conv_${numero}`;
  // Répercute la validation d'un acte rédigé sur les actes de l'enquête.
  const syncProductionActe = useEnquetesStore((s) => s.syncProductionActe);

  const dirty = prod !== null && draft !== prod.contenu;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/productions?numero=' + encodeURIComponent(numero));
      if (!res.ok) { setNotFound(true); return; }
      const { productions } = await res.json();
      for (const p of (productions || []) as Array<{ id: string; envelope: unknown }>) {
        if (p.id !== prodId) continue;
        const rec = await eapi().attache_decrypt(p.envelope);
        if (rec) {
          setProd(rec as Production);
          setDraft((rec as Production).contenu || '');
          setNotFound(false);
          return;
        }
      }
      setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [numero, prodId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAttacheConfig().then(setCfg); try { setConvId(localStorage.getItem(convKey)); } catch { /* */ } }, [convKey]);

  const scrollChat = useCallback(() => {
    requestAnimationFrame(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }); });
  }, []);

  /** Rechiffre et PUT une version modifiée. */
  const persist = useCallback(async (rec: Production): Promise<boolean> => {
    try {
      const envelope = await eapi().attache_encrypt(rec);
      const res = await fetch('/api/attache/productions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: rec.numero, id: rec.id, envelope }),
      });
      return res.ok;
    } catch { return false; }
  }, []);

  const save = useCallback(async () => {
    if (!prod) return;
    setBusy('save');
    try {
      const rec = { ...prod, contenu: draft, updatedAt: new Date().toISOString() };
      if (await persist(rec)) { setProd(rec); setNotice('Enregistré.'); onChanged?.(); }
      else setNotice('Échec de l\'enregistrement.');
    } finally { setBusy(null); }
  }, [prod, draft, persist, onChanged]);

  const valider = useCallback(async () => {
    if (!prod) return;
    setBusy('val');
    try {
      const now = new Date().toISOString();
      const rec = { ...prod, contenu: draft, traite: !prod.traite, traiteLe: prod.traite ? undefined : now, updatedAt: now };
      if (await persist(rec)) {
        setProd(rec);
        // Crée (validation) ou retire (réouverture) l'acte lié dans l'enquête.
        syncProductionActe(rec.numero, { id: rec.id, type: rec.type, titre: rec.titre, meta: rec.acteMeta }, !!rec.traite);
        setNotice(rec.traite ? 'Validé — acte créé dans l\'enquête.' : 'Remis en attente.');
        onChanged?.();
      } else setNotice('Action impossible (service injoignable ?).');
    } finally { setBusy(null); }
  }, [prod, draft, persist, onChanged, syncProductionActe]);

  const dl = useCallback(async (fmt: 'pdf' | 'docx') => {
    if (!prod) return;
    setBusy(fmt);
    try {
      const p = { ...prod, service, contenu: draft };
      if (fmt === 'pdf') await downloadActePdf(p); else await downloadActeDocx(p);
    } catch { setNotice(`Génération ${fmt.toUpperCase()} impossible.`); }
    finally { setBusy(null); }
  }, [prod, draft, service]);

  // ── Mini-chat de retouche : même conversation que le chat du dossier ──
  const ask = useCallback(async (text: string) => {
    if (!text.trim() || chatBusy) return;
    setInput('');
    setChatBusy(true);
    setMsgs((p) => [...p, { role: 'user', text }, { role: 'assistant', text: '', streaming: true, tools: [] }]);
    scrollChat();
    try {
      const res = await fetch('/api/attache/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text, convId: convId || undefined, dossier: numero,
          model: cfg.model || undefined, effort: cfg.effort || undefined,
        }),
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
            scrollChat();
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
      setChatBusy(false);
      // L'attaché a pu retoucher l'acte (produire_document sur le même id) :
      // on recharge le texte, sauf édition manuelle non enregistrée en cours.
      if (!dirty) await load();
      onChanged?.();
      scrollChat();
    }
  }, [chatBusy, convId, numero, cfg, convKey, scrollChat, dirty, load, onChanged]);

  const label = prod ? (TYPE_LABEL[prod.type] || 'Acte') : '';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">{label}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900">{prod?.titre || 'Document'}</div>
            <div className="text-[11px] text-gray-500">
              {numero && numero !== '_hors-dossier' ? `Dossier ${numero}` : 'Hors dossier'}
              {prod?.traite && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">traité</span>}
            </div>
          </div>
          <button onClick={load} title="Recharger le texte" className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-white hover:text-gray-600">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {notice && <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-1.5 text-[11.5px] text-emerald-800">{notice}</div>}

        {loading ? (
          <div className="grid flex-1 place-items-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : notFound ? (
          <div className="grid flex-1 place-items-center px-6 py-16 text-center text-sm text-gray-500">
            Ce document est introuvable — il a peut-être été supprimé.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.4fr_1fr]">
            {/* Colonne lecture / édition */}
            <div className="flex min-h-0 flex-col border-b border-gray-200 md:border-b-0 md:border-r">
              <div className="px-4 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Texte · éditable</div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="mx-4 my-2 min-h-0 flex-1 resize-none rounded-lg border border-gray-200 p-3 font-serif text-[13px] leading-relaxed text-gray-800 outline-none focus:border-[#2B5746]/40"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-2.5">
                <button
                  onClick={save}
                  disabled={busy === 'save' || !dirty}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Enregistrer
                </button>
                <button onClick={() => dl('pdf')} disabled={busy === 'pdf'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50" title={prod ? `Télécharge « ${acteFileBase({ ...prod, service })}.pdf »` : ''}>
                  {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}PDF
                </button>
                <button onClick={() => dl('docx')} disabled={busy === 'docx'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                  {busy === 'docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Word
                </button>
                <button
                  onClick={valider}
                  disabled={busy === 'val'}
                  className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${prod?.traite ? 'border-gray-200 text-gray-500 hover:bg-gray-50' : 'border-[#2B5746]/40 bg-emerald-50 text-[#2B5746] hover:bg-emerald-100'}`}
                >
                  {busy === 'val' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : prod?.traite ? <Undo2 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {prod?.traite ? 'Rouvrir' : 'Valider'}
                </button>
              </div>
            </div>

            {/* Colonne retouche IA */}
            <div className="flex min-h-0 flex-col bg-gray-50/70">
              <div className="flex items-center gap-1.5 px-4 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                <Scale className="h-3 w-3 text-[#2B5746]" />Retoucher avec l'attaché
              </div>
              <div ref={chatRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
                {msgs.length === 0 && (
                  <p className="mt-6 text-center text-[11.5px] leading-relaxed text-gray-400">
                    Dites ce qu'il faut changer — « ajoute le visa de la requête 3008 », « raccourcis la motivation »…<br />
                    Il réécrit l'acte, le texte se met à jour à gauche.
                  </p>
                )}
                {msgs.map((m, i) => m.role === 'user' ? (
                  <div key={i} className="ml-6 rounded-2xl rounded-br-md border border-gray-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-gray-800">{m.text}</div>
                ) : (
                  <div key={i} className="flex gap-2">
                    <div className="mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white"><Scale className="h-2.5 w-2.5" /></div>
                    <div className="min-w-0 flex-1">
                      {(m.tools?.length ?? 0) > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1">
                          {m.tools!.map((t, j) => (
                            <span key={j} className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-700"><Wrench className="h-2.5 w-2.5" />{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="text-[12px] leading-relaxed text-gray-800 whitespace-pre-wrap">{m.text}</div>
                      {m.streaming && <Loader2 className="mt-1 h-3.5 w-3.5 animate-spin text-gray-400" />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 p-2.5">
                <div className="flex items-end gap-1.5 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 focus-within:border-[#2B5746]/40">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
                    rows={2}
                    placeholder="Ha non, plutôt…"
                    className="max-h-24 min-h-0 flex-1 resize-none bg-transparent text-[12px] text-gray-800 outline-none placeholder:text-gray-400"
                  />
                  <button onClick={() => ask(input)} disabled={chatBusy || !input.trim()} className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-[#2B5746] text-white disabled:opacity-40">
                    {chatBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
          🔗 Même document que dans la fiche dossier (« Actes rédigés ») — une modification ici s'y répercute.
        </div>
      </div>
    </div>
  );
}
