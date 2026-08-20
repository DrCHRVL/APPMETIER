'use client';

// components/search/GlobalSearchBox.tsx
//
// LA barre de recherche du header, devenue omnibox : on tape depuis n'importe
// quelle page et un panneau montre TOUTES les possibilités (enquêtes de tous
// les contentieux — y compris terminées —, instructions, AIR, personnes,
// pages, actions), avec accès en un clic ou au clavier (↑↓ + Entrée).
//
// Le comportement historique est conservé : la frappe continue de filtrer la
// liste de la page courante (searchTerm), le panneau s'affiche PAR-DESSUS.
// Échap ferme le panneau ; un second Échap efface le filtre.
//
// Motifs repris d'applications reconnues : palette Ctrl+K (Slack, Linear,
// Notion, VS Code), tolérance aux fautes de frappe (Spotlight, Google),
// récents (Raycard/Spotlight), groupes ordonnés par pertinence, surlignage
// des correspondances.

import {
  useCallback, useEffect, useMemo, useRef, useState, useDeferredValue,
} from 'react';
import {
  Search, FileText, Scale, Activity, Network, ArrowUpRight, Zap, History,
  CornerDownLeft, SearchX, FileSearch, Loader2,
} from 'lucide-react';
import type { GlobalSearchDoc, GlobalHit, GlobalHitGroup } from '@/utils/globalSearch';
import type { GlobalSearchApi } from '@/hooks/useGlobalSearch';
import { useGlobalDocumentSearch, DocumentContentHit } from '@/hooks/useGlobalDocumentSearch';
import type { ContentieuxDefinition } from '@/types/userTypes';
import type { Enquete } from '@/types/interfaces';

// ── Récents (localStorage) ─────────────────────

const RECENTS_KEY = 'siral-global-search-recents-v1';
const RECENTS_MAX = 6;

type RecentDoc = Pick<GlobalSearchDoc, 'key' | 'kind' | 'title' | 'subtitle' | 'ctxId' | 'archived' | 'data'>;

function loadRecents(): RecentDoc[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(r => r && r.key && r.title) : [];
  } catch {
    return [];
  }
}

function persistRecents(recents: RecentDoc[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch {}
}

// ── Aides d'affichage ──────────────────────────

const KIND_ICONS: Record<GlobalSearchDoc['kind'], typeof FileText> = {
  enquete: FileText,
  instruction: Scale,
  air: Activity,
  personne: Network,
  dossier_carto: Network,
  page: ArrowUpRight,
  action: Zap,
  document: FileSearch,
};

/** Un résultat « contenu de document » devient une ligne exécutable :
 *  l'ouverture mène à l'enquête qui porte le document. */
function docHitToDoc(h: DocumentContentHit): GlobalSearchDoc {
  return {
    key: h.key,
    kind: 'document',
    title: h.docNom,
    subtitle: `${h.numero} · ${h.excerpt}`,
    ctxId: h.ctxId,
    archived: h.archived,
    fields: [],
    data: { ctxId: h.ctxId, id: h.enqueteId, numero: h.numero },
  };
}

/** Surligne les plages correspondantes du titre. */
function HighlightedTitle({ title, ranges }: { title: string; ranges: Array<[number, number]> }) {
  if (!ranges || ranges.length === 0) return <>{title}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach(([s, e], i) => {
    if (s > last) parts.push(<span key={`t${i}`}>{title.slice(last, s)}</span>);
    parts.push(
      <mark key={`m${i}`} className="bg-amber-200/70 text-inherit rounded-[2px] px-0">
        {title.slice(s, e)}
      </mark>
    );
    last = e;
  });
  if (last < title.length) parts.push(<span key="fin">{title.slice(last)}</span>);
  return <>{parts}</>;
}

/** Une ligne sélectionnable du panneau. */
interface Row {
  doc: GlobalSearchDoc | RecentDoc;
  hit?: GlobalHit;
  /** Provenance visuelle (récent / navigation rapide). */
  origin?: 'recent' | 'quick';
}

interface GlobalSearchBoxProps {
  searchTerm: string;
  onSearch: (term: string) => void;
  isSearchingDocs?: boolean;
  api: GlobalSearchApi;
  contentieuxDefs: ContentieuxDefinition[];
  /** Exécute un résultat (ouvrir l'enquête, naviguer, lancer l'action…). */
  onExecute: (doc: GlobalSearchDoc | RecentDoc) => void;
  /** Enquêtes par contentieux — active la recherche dans le CONTENU des
   *  documents (groupe « Documents », analyse asynchrone avec cache). */
  docSources?: Map<string, Enquete[]>;
}

const VISIBLE_PER_GROUP = 5;

export const GlobalSearchBox = ({
  searchTerm,
  onSearch,
  isSearchingDocs = false,
  api,
  contentieuxDefs,
  onExecute,
  docSources,
}: GlobalSearchBoxProps) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [expandedKinds, setExpandedKinds] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<RecentDoc[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // La requête du panneau suit la frappe avec une priorité moindre que
  // l'input : jamais de blocage du clavier, même sur un gros index.
  // Panneau fermé → pas de calcul (ex. terme injecté par une navigation).
  const deferredTerm = useDeferredValue(searchTerm);
  const effectiveTerm = open ? deferredTerm : '';
  const groups = useMemo<GlobalHitGroup[]>(
    () => api.search(effectiveTerm),
    [api, effectiveTerm]
  );

  const hasQuery = deferredTerm.trim().length >= 2;

  // Contenu des documents (asynchrone, tous contentieux). Automatiquement :
  // cache seulement (coût nul). L'extraction des documents jamais lus part du
  // bouton « Analyser » — jamais en silence.
  const { docHits, docScan, startFullScan } = useGlobalDocumentSearch(open && hasQuery, effectiveTerm, docSources);
  const docRows = useMemo<GlobalSearchDoc[]>(() => docHits.map(docHitToDoc), [docHits]);

  // Lignes affichées, aplaties dans l'ordre pour la navigation clavier.
  const rows = useMemo<Row[]>(() => {
    if (hasQuery) {
      const out: Row[] = [];
      for (const g of groups) {
        const visible = expandedKinds.has(g.kind) ? g.hits : g.hits.slice(0, VISIBLE_PER_GROUP);
        for (const hit of visible) out.push({ doc: hit.doc, hit });
      }
      const visibleDocs = expandedKinds.has('document') ? docRows : docRows.slice(0, VISIBLE_PER_GROUP);
      for (const doc of visibleDocs) out.push({ doc });
      return out;
    }
    const out: Row[] = recents.map(doc => ({ doc, origin: 'recent' as const }));
    for (const doc of api.quickLinks) {
      if (!recents.some(r => r.key === doc.key)) out.push({ doc, origin: 'quick' });
    }
    return out;
  }, [hasQuery, groups, expandedKinds, recents, api.quickLinks, docRows]);

  // Sélection remise en tête à chaque nouvelle requête.
  useEffect(() => {
    setSelected(0);
    setExpandedKinds(new Set());
  }, [deferredTerm]);

  useEffect(() => {
    if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
  }, [rows.length, selected]);

  // Garder la ligne sélectionnée visible.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, open]);

  // Fermer au clic hors du composant.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Raccourcis globaux : Ctrl/Cmd+K (ou « / » hors saisie) ouvre la recherche
  // depuis n'importe quelle page.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setRecents(loadRecents());
        setOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === '/' && !inField) {
        e.preventDefault();
        setRecents(loadRecents());
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const execute = useCallback((row: Row) => {
    setOpen(false);
    // Mémoriser dans les récents (sauf actions : peu utile à rejouer).
    if (row.doc.kind !== 'action') {
      const entry: RecentDoc = {
        key: row.doc.key,
        kind: row.doc.kind,
        title: row.doc.title,
        subtitle: row.doc.subtitle,
        ctxId: row.doc.ctxId,
        archived: row.doc.archived,
        data: row.doc.data,
      };
      const next = [entry, ...loadRecents().filter(r => r.key !== entry.key)].slice(0, RECENTS_MAX);
      persistRecents(next);
      setRecents(next);
    }
    onExecute(row.doc);
  }, [onExecute]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setRecents(loadRecents()); setOpen(true); return; }
      setSelected(s => Math.min(s + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(s => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && rows[selected]) {
        e.preventDefault();
        execute(rows[selected]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (open) setOpen(false);
      else if (searchTerm) onSearch('');
    }
  };

  const ctxOf = useCallback(
    (id?: string) => (id ? contentieuxDefs.find(c => c.id === id) : undefined),
    [contentieuxDefs]
  );

  const totalHits = useMemo(
    () => groups.reduce((n, g) => n + g.total, 0),
    [groups]
  );

  // ── Rendu d'une ligne ──
  let runningIndex = -1;
  const renderRow = (row: Row) => {
    runningIndex++;
    const index = runningIndex;
    const isSelected = index === selected;
    const Icon = row.origin === 'recent' ? History : (KIND_ICONS[row.doc.kind] || FileText);
    const ctx = ctxOf(row.doc.ctxId);
    const statut = (row.doc.data as { statut?: string })?.statut;

    return (
      <button
        key={row.doc.key + (row.origin || '')}
        type="button"
        data-row-index={index}
        role="option"
        aria-selected={isSelected}
        className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
          isSelected ? 'bg-emerald-50' : 'hover:bg-gray-50'
        }`}
        onMouseEnter={() => setSelected(index)}
        onClick={() => execute(row)}
      >
        <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isSelected ? 'text-emerald-600' : 'text-gray-400'}`} />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-gray-800 truncate">
              {row.hit
                ? <HighlightedTitle title={row.doc.title} ranges={row.hit.titleRanges} />
                : row.doc.title}
            </span>
            {ctx && (
              <span className="flex items-center gap-1 flex-shrink-0 text-[10px] font-semibold text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ctx.color || '#888' }} />
                {ctx.label}
              </span>
            )}
            {row.doc.archived && (
              <span className="flex-shrink-0 text-[9.5px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 rounded-full px-1.5 py-px">
                {statut === 'instruction' ? 'à l’instruction' : 'terminée'}
              </span>
            )}
          </span>
          {(row.hit?.matchLabel || row.doc.subtitle) && (
            <span className="block text-[11px] text-gray-400 truncate">
              {row.hit?.matchLabel || row.doc.subtitle}
            </span>
          )}
        </span>
        {isSelected && <CornerDownLeft className="h-3.5 w-3.5 mt-1 flex-shrink-0 text-emerald-500" />}
      </button>
    );
  };

  const groupHeader = (label: string, extra?: React.ReactNode) => (
    <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
      <span className="text-[10.5px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      {extra}
    </div>
  );

  return (
    <div ref={rootRef} className="relative flex-1 min-w-0 sm:flex-none">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-listbox"
        placeholder="Rechercher partout…  (Ctrl+K)"
        className="h-9 w-full sm:w-64 pl-9 pr-8 rounded-full border border-gray-200 bg-gray-50 text-sm
          focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400
          focus:bg-white transition-all duration-150 placeholder:text-gray-400"
        value={searchTerm}
        onChange={(e) => { onSearch(e.target.value); setOpen(true); }}
        onFocus={() => { setRecents(loadRecents()); setOpen(true); }}
        onKeyDown={onInputKeyDown}
      />
      {/* Indicateur discret de scan des documents */}
      {isSearchingDocs && (
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
          title="Recherche dans les documents..."
        />
      )}

      {open && (rows.length > 0 || hasQuery) && (
        <div className="absolute left-0 top-full mt-2 z-[60] w-[min(640px,calc(100vw-4.5rem))] rounded-xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
          <div
            id="global-search-listbox"
            role="listbox"
            ref={listRef}
            className="max-h-[min(64vh,520px)] overflow-y-auto overscroll-contain"
          >
          {/* preventDefault sur le CONTENU seulement : le focus reste dans
              l'input au clic d'une ligne, sans casser la barre de défilement. */}
          <div className="pb-1" onMouseDown={(e) => e.preventDefault()}>
            {hasQuery ? (
              <>
                {groups.length === 0 && docRows.length === 0 && !docScan.scanning && (
                  <div className="flex flex-col items-center gap-2 py-8 text-gray-400">
                    <SearchX className="h-6 w-6" />
                    <p className="text-sm">Aucun résultat pour « {deferredTerm.trim()} »</p>
                    <p className="text-[11px]">Les fautes de frappe légères sont tolérées — essayez un nom, un numéro, un service…</p>
                  </div>
                )}
                {groups.map(g => (
                  <div key={g.kind}>
                    {groupHeader(g.label, g.total > VISIBLE_PER_GROUP && (
                      <span className="text-[10px] text-gray-300 font-medium">{g.total}</span>
                    ))}
                    {(expandedKinds.has(g.kind) ? g.hits : g.hits.slice(0, VISIBLE_PER_GROUP)).map(hit =>
                      renderRow({ doc: hit.doc, hit })
                    )}
                    {!expandedKinds.has(g.kind) && g.hits.length > VISIBLE_PER_GROUP && (
                      <button
                        type="button"
                        className="w-full px-10 py-1.5 text-left text-[11.5px] font-medium text-emerald-600 hover:bg-emerald-50/60"
                        onClick={() => setExpandedKinds(prev => new Set(prev).add(g.kind))}
                      >
                        Afficher {Math.min(g.total, g.hits.length) - VISIBLE_PER_GROUP} de plus…
                      </button>
                    )}
                  </div>
                ))}
                {/* Contenu des documents — résultats au fil de l'analyse */}
                {(docRows.length > 0 || docScan.scanning || docScan.pending > 0) && (
                  <div>
                    {groupHeader('Documents', docScan.scanning ? (
                      <span className="flex items-center gap-1 text-[10px] text-gray-300 font-medium">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {docScan.done}/{docScan.total}
                      </span>
                    ) : (
                      docRows.length > VISIBLE_PER_GROUP && (
                        <span className="text-[10px] text-gray-300 font-medium">{docRows.length}</span>
                      )
                    ))}
                    {(expandedKinds.has('document') ? docRows : docRows.slice(0, VISIBLE_PER_GROUP)).map(doc =>
                      renderRow({ doc })
                    )}
                    {!expandedKinds.has('document') && docRows.length > VISIBLE_PER_GROUP && (
                      <button
                        type="button"
                        className="w-full px-10 py-1.5 text-left text-[11.5px] font-medium text-emerald-600 hover:bg-emerald-50/60"
                        onClick={() => setExpandedKinds(prev => new Set(prev).add('document'))}
                      >
                        Afficher {docRows.length - VISIBLE_PER_GROUP} de plus…
                      </button>
                    )}
                    {/* Documents jamais analysés : l'extraction (téléchargement +
                        déchiffrement locaux) ne part que d'un geste volontaire. */}
                    {!docScan.scanning && docScan.pending > 0 && (
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11.5px] font-medium text-emerald-700 hover:bg-emerald-50/60"
                        onClick={startFullScan}
                        title="Télécharge et lit ces documents dans votre navigateur (une seule fois : le texte est mémorisé pour les prochaines recherches)."
                      >
                        <FileSearch className="h-3.5 w-3.5" />
                        Chercher aussi dans {docScan.pending} document{docScan.pending > 1 ? 's' : ''} jamais analysé{docScan.pending > 1 ? 's' : ''}…
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {recents.length > 0 && (
                  <div>
                    {groupHeader('Récents', (
                      <button
                        type="button"
                        className="text-[10px] text-gray-300 hover:text-gray-500 font-medium"
                        onClick={() => { persistRecents([]); setRecents([]); }}
                      >
                        effacer
                      </button>
                    ))}
                    {rows.filter(r => r.origin === 'recent').map(renderRow)}
                  </div>
                )}
                <div>
                  {groupHeader('Navigation rapide')}
                  {rows.filter(r => r.origin === 'quick').map(renderRow)}
                </div>
                {/* Opérateurs de ciblage, façon Slack/Gmail */}
                <div className="px-3 pt-2 pb-1.5 mt-1 border-t border-gray-50">
                  <p className="text-[10.5px] text-gray-400 leading-relaxed">
                    <span className="font-semibold text-gray-500">Astuce :</span> ciblez avec{' '}
                    <code className="bg-gray-100 rounded px-1">mec:dupont</code>{' '}
                    <code className="bg-gray-100 rounded px-1">service:bsu</code>{' '}
                    <code className="bg-gray-100 rounded px-1">tag:armes</code>{' '}
                    <code className="bg-gray-100 rounded px-1">no:85103</code>{' '}
                    <code className="bg-gray-100 rounded px-1">doc:pv</code>{' '}
                    <code className="bg-gray-100 rounded px-1">contenu:drone</code>
                  </p>
                </div>
              </>
            )}
          </div>
          </div>

          {/* Pied : rappels clavier */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-100 bg-gray-50/70 text-[10.5px] text-gray-400 select-none">
            <span className="flex items-center gap-2">
              <span><kbd className="font-sans">↑↓</kbd> naviguer</span>
              <span><kbd className="font-sans">↵</kbd> ouvrir</span>
              <span><kbd className="font-sans">échap</kbd> fermer</span>
            </span>
            {hasQuery && docScan.scanning ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Analyse des documents {docScan.done}/{docScan.total}…
              </span>
            ) : hasQuery && (totalHits > 0 || docRows.length > 0) ? (
              <span>{totalHits + docRows.length} résultat{totalHits + docRows.length > 1 ? 's' : ''}</span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
