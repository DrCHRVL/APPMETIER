'use client';

/**
 * SIRAL — Attaché de justice · journal « pendant votre absence » (tableau de bord).
 *
 * Pleine largeur, sous le brief du majordome. Il rassemble CE QUI A ÉTÉ FAIT en
 * l'absence du magistrat — hors décisions, qui restent dans le panneau
 * (« À trancher »). Les cartes sont groupées par dossier ; celles reliées à un
 * document rédigé (acte, livrable — champ `prodId`) s'ouvrent en grand pour
 * lecture / édition / retouche / export (ProductionPopup) ; les autres sont de
 * simples informations à parcourir.
 *
 * Admin only : la route /status renvoie 404 aux autres comptes → le widget se
 * masque de lui-même. Tout est chiffré : le navigateur déchiffre pour afficher.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, FileText, ArrowRight, X } from 'lucide-react';
import { ProductionPopup } from './ProductionPopup';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface FeedCard {
  type: string;
  titre: string;
  resume: string;
  numero?: string;
  at?: string;
  convId?: string;
  qid?: string;
  /** Carte reliée à un document rédigé (production) : ouvre le popup. */
  prodId?: string;
}
type Card = FeedCard & { ts: number };

const FEED_ICONS: Record<string, string> = {
  mail_traite: '📨', synthese: '📋', acte: '⚖️', prolongation: '🕐',
  projet_reponse: '✉️', alerte: '⚠️', note: '📝', livrable: '📦',
};

const JOURNAL_SEEN_KEY = 'attache_journal_seen_ts';
// Cartes masquées par le magistrat (« supprimer » côté client, pour éviter que
// le journal s'entasse) : le fil serveur est en lecture seule et append-only,
// on retient donc localement les cartes rangées — persistant sur ce navigateur.
const JOURNAL_DISMISSED_KEY = 'attache_journal_dismissed';

/** Clé stable d'une carte (le fil n'a pas d'id) : horodatage + titre. */
const cardKey = (c: { ts: number; titre?: string }) => `${c.ts}|${c.titre || ''}`;

/** Résumé assez long pour être coupé par le clamp (2 lignes) → dépliable. */
const resumeIsLong = (s?: string) => !!s && (s.length > 110 || s.includes('\n'));

export function AbsenceJournal() {
  const [available, setAvailable] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [qStatuses, setQStatuses] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [popup, setPopup] = useState<{ numero: string; prodId: string } | null>(null);
  const [seenTs, setSeenTs] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/feed');
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      const { entries } = await res.json();
      const out: Card[] = [];
      for (const e of entries as Array<{ ts: number; iv: string; ct: string }>) {
        const card = await eapi().attache_decrypt({ v: 1, encrypted: true, iv: e.iv, ct: e.ct });
        if (card) out.push({ ...(card as FeedCard), ts: e.ts });
      }
      out.reverse(); // plus récent d'abord
      setCards(out);
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Statuts des questions (répondu / ignoré) — pour compter les décisions restantes.
  const loadStatuses = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/questions');
      if (res.ok) setQStatuses((await res.json()).statuses || {});
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => {
    loadFeed();
    loadStatuses();
    try { setSeenTs(Number(localStorage.getItem(JOURNAL_SEEN_KEY) || 0)); } catch { /* */ }
    try {
      const raw = localStorage.getItem(JOURNAL_DISMISSED_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch { /* */ }
  }, [loadFeed, loadStatuses]);

  // Ranger une carte (client-side) : elle disparaît du journal et ne reviendra
  // plus au rechargement sur ce navigateur.
  const dismiss = useCallback((c: Card) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(cardKey(c));
      try { localStorage.setItem(JOURNAL_DISMISSED_KEY, JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
  }, []);

  const reload = useCallback(() => { loadFeed(); loadStatuses(); }, [loadFeed, loadStatuses]);

  // Décisions en attente = questions du fil non encore répondues/ignorées.
  const decisions = useMemo(
    () => cards.filter((c) => c.type === 'question' && (!c.qid || !qStatuses[c.qid])).length,
    [cards, qStatuses],
  );

  const openPanel = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent('siral:open-attache')); } catch { /* */ }
  }, []);

  // Journal = tout sauf les questions (qui vivent dans « À trancher ») et les
  // cartes rangées par le magistrat.
  const journal = cards.filter((c) => c.type !== 'question' && !dismissed.has(cardKey(c)));

  const markSeen = useCallback(() => {
    if (journal.length) {
      try { localStorage.setItem(JOURNAL_SEEN_KEY, String(journal[0].ts)); setSeenTs(journal[0].ts); } catch { /* */ }
    }
  }, [journal]);

  if (!available) return null;
  if (journal.length === 0 && decisions === 0) return null;

  // Groupement par dossier, dossiers triés par activité la plus récente.
  const groups = new Map<string, Card[]>();
  for (const c of journal) {
    const key = c.numero || '__sans__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => b[1][0].ts - a[1][0].ts);
  const nouveaux = journal.filter((c) => c.ts > seenTs).length;

  return (
    <div className="rounded-2xl border border-[#2B5746]/20 bg-white shadow-[0_1px_2px_rgba(20,32,27,0.04)]">
      {/* Bandeau de reprise */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[13.5px] font-bold text-gray-900">Pendant votre absence</div>
            <div className="text-[11px] text-gray-500">
              {journal.length} action{journal.length > 1 ? 's' : ''} préparée{journal.length > 1 ? 's' : ''}
              {nouveaux > 0 && <span className="ml-1 text-[#2B5746]">· {nouveaux} nouvelle{nouveaux > 1 ? 's' : ''}</span>}
            </div>
          </div>
        </div>

        {decisions > 0 && (
          <button
            onClick={openPanel}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white">{decisions}</span>
            décision{decisions > 1 ? 's' : ''} vous attend{decisions > 1 ? 'ent' : ''}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button onClick={reload} disabled={loading} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { if (!collapsed) markSeen(); setCollapsed((v) => !v); }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Journal groupé par dossier */}
      {!collapsed && journal.length > 0 && (
        <div className="grid gap-3 px-5 pb-4 lg:grid-cols-2">
          {orderedGroups.map(([key, list]) => (
            <div key={key} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <span className="rounded bg-[#2B5746]/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#2B5746]">
                  {key === '__sans__' ? 'Sans dossier' : key}
                </span>
                <span className="ml-auto text-[10.5px] text-gray-400">{list.length} action{list.length > 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {list.map((c) => {
                  const isDoc = !!c.prodId;
                  const isNew = c.ts > seenTs;
                  const k = cardKey(c);
                  const isExpanded = expandedKey === k;
                  return (
                    <div key={k} className={`flex items-start gap-2.5 px-3 py-2.5 ${isDoc ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      onClick={isDoc ? () => setPopup({ numero: c.numero || '_hors-dossier', prodId: c.prodId! }) : undefined}
                    >
                      <span className="mt-0.5 text-[15px] leading-none">{FEED_ICONS[c.type] || '•'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-800">
                          <span className="truncate">{c.titre}</span>
                          {isNew && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2B5746]" title="Nouveau" />}
                        </div>
                        {!isDoc && c.resume && (
                          <>
                            <div className={`mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-500 ${isExpanded ? '' : 'line-clamp-2'}`}>{c.resume}</div>
                            {resumeIsLong(c.resume) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedKey(isExpanded ? null : k); }}
                                className="mt-0.5 text-[10.5px] font-medium text-gray-400 hover:text-gray-600"
                              >
                                {isExpanded ? '▲ replier' : '▼ voir tout le détail'}
                              </button>
                            )}
                          </>
                        )}
                        <div className="mt-0.5 text-[10px] text-gray-400">{c.at ? new Date(c.at).toLocaleString('fr-FR') : ''}</div>
                      </div>
                      {isDoc && (
                        <span className="mt-0.5 inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-[#2B5746]/30 bg-emerald-50 px-2 py-1 text-[10.5px] font-semibold text-[#2B5746]">
                          <FileText className="h-3 w-3" />Ouvrir
                        </span>
                      )}
                      {/* Ranger la carte pour éviter l'entassement (masquage local). */}
                      <button
                        onClick={(e) => { e.stopPropagation(); dismiss(c); }}
                        title="Ranger cette carte"
                        className="mt-0.5 flex-shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!collapsed && (
        <div className="border-t border-gray-100 px-5 py-1.5 text-center text-[10px] text-gray-400">
          Documents éditables et exportables ici comme dans le dossier · décisions dans le panneau Attaché · visible de vous seul
        </div>
      )}

      {popup && (
        <ProductionPopup
          numero={popup.numero}
          prodId={popup.prodId}
          onClose={() => { setPopup(null); reload(); }}
          onChanged={reload}
        />
      )}
    </div>
  );
}
