// components/pages/MindmapPage.tsx
// Module Cartographie : graphe biparti MEC ↔ Dossier en vue unique.
// La barre de recherche et le panneau "Top 10" recentrent la caméra sur
// le nœud choisi sans changer de graphe — l'utilisateur garde son
// contexte visuel à tout moment.

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText, Layers, Link as LinkIcon, Network, Pin, PinOff, Plus, Search, Trophy, User, X } from 'lucide-react';
import type { ContentieuxDefinition } from '@/types/userTypes';
import type { Enquete } from '@/types/interfaces';
import {
  buildMindmapGraph,
  getTopMec,
  type DossierNode,
  type EnqueteWithContext,
  type GraphNode,
  type MecNode,
} from '@/utils/mindmapGraph';
import {
  useCartographieOverlayStore,
  type DossierExNihilo,
  type LienRenseignement,
  type MecExNihilo,
} from '@/stores/useCartographieOverlayStore';
import { MindmapCanvas } from '../mindmap/MindmapCanvas';
import { MindmapSidePanel } from '../mindmap/MindmapSidePanel';
import { AddDossierModal, AddLienModal, AddMecModal } from '../mindmap/OverlayModals';
import { ManageOverlayPanel } from '../mindmap/ManageOverlayPanel';

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

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const MindmapPage: React.FC<MindmapPageProps> = ({
  sources,
  contentieuxDefs,
  onOpenEnquete,
}) => {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [sidePanelMecId, setSidePanelMecId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [showTop10, setShowTop10] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [editingMec, setEditingMec] = useState<MecExNihilo | null | undefined>(undefined); // null = nouveau, undefined = fermé
  const [editingDossier, setEditingDossier] = useState<DossierExNihilo | null | undefined>(undefined);
  const [editingLien, setEditingLien] = useState<LienRenseignement | null | undefined>(undefined);
  // centerRequest change → MindmapCanvas anime la caméra vers le nœud.
  // Le compteur force le re-trigger même si on cible deux fois le même id.
  const [centerRequest, setCenterRequest] = useState<{ id: string; seq: number } | undefined>();

  const pinnedMecIds = useCartographieOverlayStore(s => s.pinnedMecIds);
  const mecsExNihilo = useCartographieOverlayStore(s => s.mecsExNihilo);
  const dossiersExNihilo = useCartographieOverlayStore(s => s.dossiersExNihilo);
  const liensRenseignement = useCartographieOverlayStore(s => s.liensRenseignement);
  const overlayLoaded = useCartographieOverlayStore(s => s.isLoaded);
  const loadOverlay = useCartographieOverlayStore(s => s.load);
  const togglePinMec = useCartographieOverlayStore(s => s.togglePinMec);
  const addMec = useCartographieOverlayStore(s => s.addMec);
  const updateMec = useCartographieOverlayStore(s => s.updateMec);
  const removeMec = useCartographieOverlayStore(s => s.removeMec);
  const addDossier = useCartographieOverlayStore(s => s.addDossier);
  const updateDossier = useCartographieOverlayStore(s => s.updateDossier);
  const removeDossier = useCartographieOverlayStore(s => s.removeDossier);
  const addLien = useCartographieOverlayStore(s => s.addLien);
  const updateLien = useCartographieOverlayStore(s => s.updateLien);
  const removeLien = useCartographieOverlayStore(s => s.removeLien);

  useEffect(() => {
    if (!overlayLoaded) loadOverlay();
  }, [overlayLoaded, loadOverlay]);

  const overlayInput = useMemo(() => ({
    mecsExNihilo,
    dossiersExNihilo,
    liensRenseignement,
  }), [mecsExNihilo, dossiersExNihilo, liensRenseignement]);

  const graph = useMemo(
    () => buildMindmapGraph(sources, overlayInput),
    [sources, overlayInput],
  );
  const top10 = useMemo(() => getTopMec(graph, 10, pinnedMecIds), [graph, pinnedMecIds]);

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

  const focusOnNode = (node: GraphNode) => {
    setSelectedId(node.id);
    setCenterRequest(prev => ({ id: node.id, seq: (prev?.seq ?? 0) + 1 }));
    if (node.type === 'mec') setSidePanelMecId(node.id);
  };

  const handleNodeClick = (node: GraphNode) => {
    setSelectedId(node.id);
    if (node.type === 'mec') setSidePanelMecId(node.id);
  };

  const handleNodeDoubleClick = (node: GraphNode) => {
    if (node.type === 'mec') {
      setSidePanelMecId(node.id);
      return;
    }
    if (node.isExNihilo) {
      // Dossier manuel : pas d'enquête source à ouvrir, on permet l'édition.
      const found = dossiersExNihilo.find(d => d.id === node.id);
      if (found) setEditingDossier(found);
      return;
    }
    const src = sources.find(
      s => s.enquete.id === node.enqueteId && s.contentieuxId === node.contentieuxId,
    );
    if (src && onOpenEnquete) onOpenEnquete(src.enquete, node.contentieuxId);
  };

  const centerOnId = (nodeId: string) => {
    const node: GraphNode | undefined = graph.mecById.get(nodeId) || graph.dossierById.get(nodeId);
    if (node) focusOnNode(node);
  };

  const handleSearchSelect = (node: GraphNode) => {
    setSearch('');
    focusOnNode(node);
  };

  const handleDossierFromPanel = (dossier: DossierNode) => {
    focusOnNode(dossier);
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

        {/* Ajouter (dropdown) */}
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(o => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Ajouter
            <ChevronDown className="h-3 w-3" />
          </button>
          {addMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAddMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-40 min-w-[200px]">
                <button
                  onClick={() => { setAddMenuOpen(false); setEditingMec(null); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                >
                  <User className="h-3.5 w-3.5 text-slate-500" />
                  Mis en cause
                </button>
                <button
                  onClick={() => { setAddMenuOpen(false); setEditingDossier(null); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                >
                  <FileText className="h-3.5 w-3.5 text-slate-500" />
                  Dossier
                </button>
                <button
                  onClick={() => { setAddMenuOpen(false); setEditingLien(null); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                >
                  <LinkIcon className="h-3.5 w-3.5 text-slate-500" />
                  Lien renseignement
                </button>
              </div>
            </>
          )}
        </div>

        {/* Mes ajouts toggle */}
        <button
          onClick={() => setShowManage(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showManage
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
          title="Voir mes ajouts manuels"
        >
          <Layers className="h-3.5 w-3.5" />
          Mes ajouts
          {(mecsExNihilo.length + dossiersExNihilo.length + liensRenseignement.length) > 0 && (
            <span className={`text-[10px] rounded px-1 ${
              showManage ? 'bg-white/20' : 'bg-slate-200'
            }`}>
              {mecsExNihilo.length + dossiersExNihilo.length + liensRenseignement.length}
            </span>
          )}
        </button>

        {/* Top 10 toggle */}
        <button
          onClick={() => setShowTop10(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            showTop10
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Trophy className="h-3.5 w-3.5" />
          Top 10
        </button>

        <div className="text-xs text-slate-500 hidden md:block">
          {graph.mecById.size} MEC · {graph.dossierById.size} dossiers
        </div>
      </div>

      {/* CONTENU */}
      <div className="flex-1 relative overflow-hidden">
        {graph.nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
            <Network className="h-10 w-10" />
            <div className="text-sm">Aucun mis en cause à afficher pour le moment.</div>
            <div className="text-xs text-slate-400 max-w-md text-center">
              La cartographie se peuplera dès qu'au moins un dossier accessible
              contiendra un mis en cause.
            </div>
          </div>
        )}

        {graph.nodes.length > 0 && (
          <MindmapCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            contentieuxDefs={contentieuxDefs}
            focusedId={selectedId}
            centerRequest={centerRequest}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        )}

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

        {showTop10 && (
          <Top10Panel
            top={top10}
            pinnedIds={pinnedMecIds}
            onClose={() => setShowTop10(false)}
            onSelect={(mec) => {
              focusOnNode(mec);
            }}
            onTogglePin={togglePinMec}
          />
        )}

        {showManage && (
          <ManageOverlayPanel
            mecs={mecsExNihilo}
            dossiers={dossiersExNihilo}
            liens={liensRenseignement}
            graph={graph}
            onClose={() => setShowManage(false)}
            onCenterNode={centerOnId}
            onEditMec={(m) => setEditingMec(m)}
            onEditDossier={(d) => setEditingDossier(d)}
            onEditLien={(l) => setEditingLien(l)}
            onDeleteMec={(id) => removeMec(id)}
            onDeleteDossier={(id) => removeDossier(id)}
            onDeleteLien={(id) => removeLien(id)}
          />
        )}
      </div>

      {/* MODALES */}
      <AddMecModal
        isOpen={editingMec !== undefined}
        onClose={() => setEditingMec(undefined)}
        initial={editingMec || undefined}
        onSubmit={(data) => {
          if (editingMec) {
            updateMec(editingMec.id, data);
          } else {
            addMec(data);
          }
        }}
      />

      <AddDossierModal
        isOpen={editingDossier !== undefined}
        onClose={() => setEditingDossier(undefined)}
        graph={graph}
        initial={editingDossier || undefined}
        onSubmit={(data) => {
          if (editingDossier) {
            updateDossier(editingDossier.id, data);
          } else {
            addDossier(data);
          }
        }}
      />

      <AddLienModal
        isOpen={editingLien !== undefined}
        onClose={() => setEditingLien(undefined)}
        graph={graph}
        initial={editingLien || undefined}
        onSubmit={(data) => {
          if (editingLien) {
            updateLien(editingLien.id, data);
          } else {
            addLien(data);
          }
        }}
      />

      {/* HINT bas de page */}
      <div className="border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500 flex items-center gap-4 flex-wrap">
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Clic MEC</kbd> fiche détaillée</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Double-clic dossier</kbd> ouvrir l'enquête</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Recherche</kbd> centre la caméra sur le nœud</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Molette</kbd> zoom</span>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// SOUS-COMPOSANT : Panneau Top 10 flottant
// ──────────────────────────────────────────────

const Top10Panel: React.FC<{
  top: MecNode[];
  pinnedIds: string[];
  onSelect: (mec: MecNode) => void;
  onClose: () => void;
  onTogglePin: (mecId: string) => void;
}> = ({ top, pinnedIds, onSelect, onClose, onTogglePin }) => {
  const maxScore = top.reduce((m, mec) => Math.max(m, mec.rawScore), 0) || 1;
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  return (
    <div className="absolute top-3 left-3 z-20 w-72 max-h-[calc(100%-1.5rem)] flex flex-col bg-white border border-slate-200 rounded-lg shadow-lg">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Trophy className="h-4 w-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-900">Top mis en cause</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {top.length === 0 ? (
          <div className="text-xs text-slate-400 px-2 py-3 text-center">
            Aucun mis en cause indexé.
          </div>
        ) : (
          top.map((mec, i) => {
            const ratio = mec.rawScore / maxScore;
            const dossiers = mec.dossierIds.length;
            const isPinned = pinnedSet.has(mec.id);
            return (
              <div
                key={mec.id}
                className={`group flex items-start gap-1 px-2 py-2 rounded ${
                  isPinned ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  onClick={() => onSelect(mec)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-slate-400 w-4">#{i + 1}</span>
                    <span
                      className="text-sm font-medium text-slate-900 truncate flex-1"
                      title={mec.displayName}
                    >
                      {mec.displayName}
                    </span>
                    {mec.recent && (
                      <span className="text-[9px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 rounded flex-shrink-0">
                        récent
                      </span>
                    )}
                  </div>
                  <div className="h-1 bg-slate-100 rounded-full overflow-hidden mb-1 ml-6">
                    <div
                      className="h-full bg-gradient-to-r from-slate-600 to-slate-800 rounded-full"
                      style={{ width: `${Math.max(8, ratio * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 ml-6">
                    <span>{dossiers} dossier{dossiers > 1 ? 's' : ''}</span>
                    {mec.contentieuxIds.length > 1 && (
                      <span>· {mec.contentieuxIds.length} contentieux</span>
                    )}
                    {mec.nbMisEnExamen > 0 && <span>· {mec.nbMisEnExamen} ME</span>}
                    {mec.nbChefs > 0 && <span>· {mec.nbChefs} chef{mec.nbChefs > 1 ? 's' : ''}</span>}
                  </div>
                </button>
                <button
                  onClick={() => onTogglePin(mec.id)}
                  title={isPinned ? 'Désépingler' : 'Épingler en tête du Top'}
                  className={`p-1 rounded flex-shrink-0 transition-colors ${
                    isPinned
                      ? 'text-amber-600 hover:text-amber-800'
                      : 'text-slate-300 hover:text-slate-700 opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {isPinned ? <Pin className="h-3.5 w-3.5 fill-current" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })
        )}
      </div>
      <div className="px-3 py-2 border-t border-slate-200 text-[10px] text-slate-400">
        Score : dossiers × 2 + contentieux × 3 + ME × 1 + chefs × 0.3 (×1.2 si récent).
        Les épinglés restent en tête.
      </div>
    </div>
  );
};
