'use client';

/**
 * SIRAL — Attaché de justice · widget « Boîte dédiée » du tableau de bord.
 *
 * Visible du SEUL administrateur (se masque si /api/attache/inbox ≠ 200 —
 * les non-admins reçoivent le même 404 qu'une route inexistante) : le
 * contenu de la boîte mail de l'attaché (crimorg@…), pour VÉRIFIER d'un
 * coup d'œil que chaque message transféré est bien arrivé et bien traité.
 *
 * Statuts par message : Reçu ✉ → En cours ⏳ → Traité ✓ (résumé d'une
 * phrase) ; Erreur ⚠ si un run a échoué. Le widget se rafraîchit tout seul
 * et signale les transitions par des toasts (« bien reçu », « en cours de
 * traitement », « traité ») — plus AUCUNE réponse ne part par mail : tout
 * s'affiche dans l'application.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox, RefreshCw, Loader2, CheckCircle2, Clock3, MailOpen, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useToastStore } from '@/stores/useToastStore';

interface InboxMessage {
  id: string;
  recuLe: string;
  de: string;
  sujet: string;
  pieces: number;
  traite: boolean;
  statut?: 'recu' | 'en_cours' | 'traite' | 'erreur';
  traiteLe?: string;
  resume?: string;
}

const POLL_MS = 60_000;

function statutOf(m: InboxMessage): NonNullable<InboxMessage['statut']> {
  return m.statut || (m.traite ? 'traite' : 'recu');
}

const STATUT_UI: Record<string, { label: string; cls: string; Icon: typeof MailOpen }> = {
  recu: { label: 'Reçu', cls: 'bg-blue-50 text-blue-700 border-blue-200', Icon: MailOpen },
  en_cours: { label: 'En cours de traitement', cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: Clock3 },
  traite: { label: 'Traité', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  // Reprises automatiques à délai croissant ; épuisées → carte d'alerte au fil
  // (« reprises épuisées ») et relance possible depuis la relève manuelle.
  erreur: { label: 'Erreur — reprises automatiques en cours', cls: 'bg-red-50 text-red-600 border-red-200', Icon: AlertTriangle },
};

export function InboxWidget() {
  const [available, setAvailable] = useState(false);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [open, setOpen] = useState(true);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const showToast = useToastStore((s) => s.showToast);
  // dernier statut connu par message — pour ne toaster QUE les transitions
  const lastStatuts = useRef<Map<string, string> | null>(null);
  // coupe le polling dès que la route répond non-admin/désactivé (404) :
  // inutile d'interroger toutes les minutes une fonctionnalité invisible
  const unavailableRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent && (unavailableRef.current || document.hidden)) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/attache/inbox');
      if (!res.ok) { unavailableRef.current = true; setAvailable(false); return; }
      unavailableRef.current = false;
      setAvailable(true);
      const data = (await res.json().catch(() => ({}))) as { messages?: InboxMessage[] };
      const list = (data.messages || []).sort((a: InboxMessage, b: InboxMessage) => String(b.recuLe).localeCompare(String(a.recuLe)));
      // toasts sur transitions (jamais au premier chargement : pas de rafale)
      if (lastStatuts.current) {
        for (const m of list) {
          const prev = lastStatuts.current.get(m.id);
          const cur = statutOf(m);
          if (prev === cur) continue;
          const sujet = m.sujet.length > 60 ? m.sujet.slice(0, 60) + '…' : m.sujet;
          if (prev === undefined) showToast(`📩 Bien reçu : « ${sujet} »`, 'info');
          else if (cur === 'en_cours') showToast(`⏳ En cours de traitement : « ${sujet} »`, 'info');
          else if (cur === 'traite') showToast(`✓ Traité : « ${sujet} »`, 'success');
          else if (cur === 'erreur') showToast(`⚠ Traitement en échec : « ${sujet} »`, 'warning');
        }
      }
      lastStatuts.current = new Map(list.map((m: InboxMessage) => [m.id, statutOf(m)]));
      setMessages(list);
    } catch {
      setAvailable(false);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const releverBoite = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/attache/inbox', { method: 'POST' });
      const data = await res.json().catch(() => ({} as { ok?: boolean; ingested?: string[]; error?: string }));
      if (data.ok) showToast(data.ingested?.length ? `${data.ingested.length} nouveau(x) message(s)` : 'Boîte relevée — rien de nouveau', 'success');
      else showToast(`Relève impossible : ${data.error || 'service injoignable'}`, 'error');
      await load(true);
    } finally {
      setChecking(false);
    }
  }, [load, showToast]);

  if (!available) return null;

  const nonTraites = messages.filter((m) => statutOf(m) !== 'traite').length;

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white shadow-sm">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <Inbox className="h-4 w-4 text-[#2B5746]" />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          Boîte de l&apos;attaché
          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">vous seul</span>
          {nonTraites > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{nonTraites} à traiter</span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); releverBoite(); }}
          disabled={checking}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          title="Relever la boîte maintenant (relevée automatiquement toutes les 5 min)"
        >
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Relever
        </button>
        <button onClick={(e) => { e.stopPropagation(); load(); }} className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser l'affichage">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          {messages.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-400">
              Boîte vide. Transférez un mail à la boîte dédiée de l&apos;attaché : il apparaîtra ici avec son statut
              (reçu → en cours → traité) — la réponse s&apos;affiche dans l&apos;application, jamais par mail.
            </p>
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto">
              {messages.map((m) => {
                const st = statutOf(m);
                const ui = STATUT_UI[st] || STATUT_UI.recu;
                return (
                  <div key={m.id} className="flex items-start gap-2 rounded-lg border border-gray-100 px-2.5 py-2">
                    <span className={`mt-0.5 inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${ui.cls}`}>
                      <ui.Icon className="h-3 w-3" />{ui.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-gray-800" title={m.sujet}>{m.sujet}</div>
                      <div className="truncate text-[10.5px] text-gray-400">
                        {m.de} · reçu le {new Date(m.recuLe).toLocaleString('fr-FR')}
                        {m.pieces > 0 && ` · ${m.pieces} pièce(s) jointe(s)`}
                        {m.traiteLe && ` · traité le ${new Date(m.traiteLe).toLocaleString('fr-FR')}`}
                      </div>
                      {m.resume && (
                        <div className="mt-0.5 rounded bg-gray-50 px-1.5 py-1 text-[11px] leading-snug text-gray-600">{m.resume}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-center text-[10px] text-gray-400">
            Boîte relevée automatiquement toutes les 5 min · les réponses et livrables s&apos;affichent dans l&apos;application
            (fil « pendant votre absence », actes rédigés) — plus aucun mail sortant.
          </p>
        </div>
      )}
    </div>
  );
}
