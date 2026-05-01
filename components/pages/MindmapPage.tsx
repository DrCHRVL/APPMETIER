// components/pages/MindmapPage.tsx
// Module Cartographie : graphe biparti MEC ↔ Dossier.
// 3 modes :
//   - top10  : entrée par les MEC les plus mentionnés (cartes cliquables)
//   - focus  : sous-graphe centré sur un nœud, à N sauts
//   - overview : graphe complet (tous contentieux accessibles)

'use client';

import React, { useMemo, useState } from 'react';
import { Network, Search, ArrowLeft, ChevronRight, Home, Users, Layers } from 'lucide-react';
import type { ContentieuxDefinition } from '@/types/userTypes';
import type { Enquete } from '@/types/interfaces';
import {
  buildMindmapGraph,
  extractFocusSubgraph,
  getTopMec,
  type DossierNode,
  type EnqueteWithContext,
  type GraphNode,
  type MecNode,
} from '@/utils/mindmapGraph';
import { MindmapCanvas } from '../mindmap/MindmapCanvas';
import { MindmapSidePanel } from '../mindmap/MindmapSidePanel';

// ──────────────────────────────────────────────
// PROPS
// ──────────────────────────────────────────────

interface MindmapPageProps {
  /** Sources d'enquêtes (toutes confondues) avec leur contentieux d'origine */
  sources: EnqueteWithContext[];
  /** Définitions des contentieux pour labels/couleurs */
  contentieuxDefs: ContentieuxDefinition[];
  /** Callback pour ouvrir le modal détail d'une enquête (double-click sur un dossier) */
  onOpenEnquete?: (enquete: Enquete, contentieuxId: string) => void;
}

type Mode = 'top10' | 'focus' | 'overview';

interface BreadcrumbEntry {
  id: string;
  label: string;
  type: 'mec' | 'dossier';
}

const FOCUS_DEPTH = 1;

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const MindmapPage: React.FC<MindmapPageProps> = ({
  sources,
  contentieuxDefs,
  onOpenEnquete,
}) => {
  const [mode, setMode] = useState<Mode>('top10');
  const [focusedId, setFocusedId] = useState<string | undefined>();
  const [sidePanelMecId, setSidePanelMecId] = useState<string | undefined>();
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbEntry[]>([]);
  const [search, setSearch] = useState('');

  // Construction du graphe global (cache memo sur sources)
  const graph = useMemo(() => buildMindmapGraph(sources), [sources]);
  const top10 = useMemo(() => getTopMec(graph, 10), [graph]);

  // Sous-graphe affiché selon le mode
  const visibleGraph = useMemo(() => {
    if (mode === 'overview') return graph;
    if (mode === 'focus' && focusedId) {
      return extractFocusSubgraph(graph, focusedId, FOCUS_DEPTH);
    }
    return null;
  }, [mode, focusedId, graph]);

  // Recherche : filtre les MEC + dossiers par nom/numéro
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [] as GraphNode[];
    const out: GraphNode[] = [];
    for (const m of graph.mecById.values()) {
      if (m.displayName.toLowerCase().includes(q) ||
          m.variants.some(v => v.toLowerCase().includes(q))) {
        out.push(m);
      }
      if (out.length >= 20) break;
    }
    for (const d of graph.dossierById.values()) {
      if (d.numero.toLowerCase().includes(q)) out.push(d);
      if (out.length >= 30) break;
    }
    return out;
  }, [search, graph]);

  // ────────────────────────────────────────────
  // ACTIONS
  // ────────────────────────────────────────────

  const goToFocus = (node: GraphNode) => {
    setFocusedId(node.id);
    setMode('focus');
    setSidePanelMecId(undefined);
    setBreadcrumb(prev => {
      // Évite les doublons consécutifs
      if (prev.length > 0 && prev[prev.length - 1].id === node.id) return prev;
      const label = node.type === 'mec' ? node.displayName : node.numero;
      return [...prev, { id: node.id, label, type: node.type }];
    });
  };

  const goToOverview = () => {
    setMode('overview');
    setFocusedId(undefined);
    setSidePanelMecId(undefined);
  };

  const goHome = () => {
    setMode('top10');
    setFocusedId(undefined);
    setSidePanelMecId(undefined);
    setBreadcrumb([]);
  };

  const goToBreadcrumb = (index: number) => {
    const entry = breadcrumb[index];
    if (!entry) return;
    setBreadcrumb(breadcrumb.slice(0, index + 1));
    setFocusedId(entry.id);
    setMode('focus');
    setSidePanelMecId(undefined);
  };

  const handleNodeClick = (node: GraphNode) => {
    goToFocus(node);
  };

  const handleNodeDoubleClick = (node: GraphNode) => {
    if (node.type === 'mec') {
      setSidePanelMecId(node.id);
      return;
    }
    // dossier : retrouver l'enquête source et déclencher le modal
    const src = sources.find(
      s => s.enquete.id === node.enqueteId && s.contentieuxId === node.contentieuxId,
    );
    if (src && onOpenEnquete) onOpenEnquete(src.enquete, node.contentieuxId);
  };

  const handleSearchSelect = (node: GraphNode) => {
    setSearch('');
    goToFocus(node);
  };

  const handleDossierFromPanel = (dossier: DossierNode) => {
    goToFocus(dossier);
  };

  const handleDossierOpenFromPanel = (dossier: DossierNode) => {
    const src = sources.find(
      s => s.enquete.id === dossier.enqueteId && s.contentieuxId === dossier.contentieuxId,
    );
    if (src && onOpenEnquete) onOpenEnquete(src.enquete, dossier.contentieuxId);
  };

  const sidePanelMec: MecNode | undefined = sidePanelMecId
    ? graph.mecById.get(sidePanelMecId)
    : undefined;

  // ────────────────────────────────────────────
  // RENDU
  // ────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full w-full bg-slate-50">
      {/* HEADER */}
      <div className="border-b border-slate-200 bg-white px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 mr-2">
          <Network className="h-5 w-5 text-slate-600" />
          <h1 className="text-lg font-semibold text-slate-900">Cartographie</h1>
        </div>

        {/* Mode toggle */}
        <div className="flex bg-slate-100 rounded-lg p-1 gap-1">
          <ModeButton active={mode === 'top10'} onClick={goHome} icon={<Home className="h-3.5 w-3.5" />} label="Top 10" />
          <ModeButton
            active={mode === 'focus'}
            onClick={() => focusedId && setMode('focus')}
            icon={<Users className="h-3.5 w-3.5" />}
            label="Focus"
            disabled={!focusedId}
          />
          <ModeButton active={mode === 'overview'} onClick={goToOverview} icon={<Layers className="h-3.5 w-3.5" />} label="Vue d'ensemble" />
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[240px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher un mis en cause ou un n° de dossier…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto z-30">
              {searchResults.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleSearchSelect(r)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100 last:border-b-0"
                >
                  <span className={`text-[10px] uppercase font-semibold rounded px-1.5 py-0.5 ${
                    r.type === 'mec' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {r.type === 'mec' ? 'MEC' : 'Dossier'}
                  </span>
                  <span className="text-sm text-slate-900 truncate">
                    {r.type === 'mec' ? r.displayName : r.numero}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stats sur la droite */}
        <div className="text-xs text-slate-500 hidden md:block">
          {graph.mecById.size} MEC · {graph.dossierById.size} dossiers
        </div>
      </div>

      {/* BREADCRUMB (mode focus) */}
      {mode === 'focus' && breadcrumb.length > 0 && (
        <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-1 text-sm overflow-x-auto">
          <button
            onClick={goHome}
            className="flex items-center gap-1 text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Top 10
          </button>
          {breadcrumb.map((entry, i) => (
            <React.Fragment key={`${entry.id}-${i}`}>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
              <button
                onClick={() => goToBreadcrumb(i)}
                className={`px-2 py-1 rounded whitespace-nowrap ${
                  i === breadcrumb.length - 1
                    ? 'text-slate-900 font-semibold bg-slate-100'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <span className="text-[10px] uppercase mr-1 text-slate-400">
                  {entry.type === 'mec' ? 'MEC' : 'Dossier'}
                </span>
                {entry.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* CONTENU */}
      <div className="flex-1 relative overflow-hidden">
        {mode === 'top10' && (
          <Top10View
            top={top10}
            graph={graph}
            onSelect={goToFocus}
            onShowAll={goToOverview}
          />
        )}

        {(mode === 'focus' || mode === 'overview') && visibleGraph && visibleGraph.nodes.length > 0 && (
          <>
            <MindmapCanvas
              nodes={visibleGraph.nodes}
              edges={visibleGraph.edges}
              contentieuxDefs={contentieuxDefs}
              focusedId={focusedId}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
            />
            {sidePanelMec && (
              <MindmapSidePanel
                mec={sidePanelMec}
                graph={graph}
                contentieuxDefs={contentieuxDefs}
                onClose={() => setSidePanelMecId(undefined)}
                onDossierClick={handleDossierFromPanel}
                onDossierOpen={handleDossierOpenFromPanel}
              />
            )}
          </>
        )}

        {(mode === 'focus' || mode === 'overview') && (!visibleGraph || visibleGraph.nodes.length === 0) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
            <Network className="h-10 w-10" />
            <div className="text-sm">Aucun nœud à afficher.</div>
            <button
              onClick={goHome}
              className="text-xs text-slate-600 hover:text-slate-900 underline"
            >
              Retour au Top 10
            </button>
          </div>
        )}
      </div>

      {/* HINT bas de page */}
      <div className="border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500 flex items-center gap-4 flex-wrap">
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Clic</kbd> recentrer</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Double-clic MEC</kbd> fiche détaillée</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Double-clic dossier</kbd> ouvrir l'enquête</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Molette</kbd> zoom</span>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// SOUS-COMPOSANTS
// ──────────────────────────────────────────────

const ModeButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}> = ({ active, onClick, icon, label, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`
      flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
      ${active
        ? 'bg-white text-slate-900 shadow-sm'
        : disabled
          ? 'text-slate-400 cursor-not-allowed'
          : 'text-slate-600 hover:text-slate-900'
      }
    `}
  >
    {icon}
    {label}
  </button>
);

const Top10View: React.FC<{
  top: MecNode[];
  graph: ReturnType<typeof buildMindmapGraph>;
  onSelect: (mec: MecNode) => void;
  onShowAll: () => void;
}> = ({ top, graph, onSelect, onShowAll }) => {
  if (top.length === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2 p-6">
        <Network className="h-10 w-10" />
        <div className="text-sm">Aucun mis en cause à afficher pour le moment.</div>
        <div className="text-xs text-slate-400 max-w-md text-center">
          La cartographie se peuplera dès qu'au moins un dossier accessible
          contiendra un mis en cause.
        </div>
      </div>
    );
  }
  const maxScore = top[0].rawScore || 1;
  return (
    <div className="absolute inset-0 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Top 10 mis en cause</h2>
            <p className="text-sm text-slate-500 mt-1">
              Triés par score composite (mentions, mises en examen, chefs, activité récente).
              Cliquez pour explorer leur réseau.
            </p>
          </div>
          <button
            onClick={onShowAll}
            className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50"
          >
            <Layers className="h-4 w-4" />
            Voir le réseau complet
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {top.map((mec, i) => {
            const ratio = mec.rawScore / maxScore;
            const dossiers = mec.dossierIds.length;
            return (
              <button
                key={mec.id}
                onClick={() => onSelect(mec)}
                className="text-left bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-400 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 w-5">#{i + 1}</span>
                    <span
                      className="font-semibold text-slate-900 group-hover:text-slate-950 truncate"
                      title={mec.displayName}
                    >
                      {mec.displayName}
                    </span>
                  </div>
                  {mec.recent && (
                    <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded flex-shrink-0">
                      récent
                    </span>
                  )}
                </div>

                {/* Barre de score */}
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-gradient-to-r from-slate-600 to-slate-800 rounded-full"
                    style={{ width: `${Math.max(8, ratio * 100)}%` }}
                  />
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span><strong className="text-slate-900">{dossiers}</strong> dossier{dossiers > 1 ? 's' : ''}</span>
                  {mec.nbMisEnExamen > 0 && (
                    <span><strong className="text-slate-900">{mec.nbMisEnExamen}</strong> ME</span>
                  )}
                  {mec.nbChefs > 0 && (
                    <span><strong className="text-slate-900">{mec.nbChefs}</strong> chef{mec.nbChefs > 1 ? 's' : ''}</span>
                  )}
                  <span className="ml-auto text-slate-400">score {mec.rawScore.toFixed(1)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200 text-xs text-slate-500">
          {graph.mecById.size} mis en cause au total · {graph.dossierById.size} dossiers indexés
        </div>
      </div>
    </div>
  );
};
