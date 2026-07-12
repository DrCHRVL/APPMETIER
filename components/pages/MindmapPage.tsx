// components/pages/MindmapPage.tsx
// Module Cartographie : graphe biparti MEC ↔ Dossier en vue unique.
// La barre de recherche et le panneau "Top 10" recentrent la caméra sur
// le nœud choisi sans changer de graphe — l'utilisateur garde son
// contexte visuel à tout moment.

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileDown, FileText, Filter, Layers, Link as LinkIcon, Loader2, Network, Pin, PinOff, Plus, RefreshCw, Save, Search, Shrink, Trophy, User, X } from 'lucide-react';
import type { ContentieuxDefinition, ContentieuxId } from '@/types/userTypes';
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
  type ClusterAnnotation,
  type DossierExNihilo,
  type LienRenseignement,
  type MecExNihilo,
} from '@/stores/useCartographieOverlayStore';
import { cartographieOverlaySyncService } from '@/utils/dataSync/CartographieOverlaySyncService';
import { cartographieContributionsSyncService } from '@/utils/dataSync/CartographieContributionsSyncService';
import { useCartographieContributionsStore } from '@/stores/useCartographieContributionsStore';
import { CartographieConfigManager } from '@/utils/cartographieConfigManager';
import { useCartographieConfig } from '@/hooks/useCartographieConfig';
import { useTags } from '@/hooks/useTags';
import { useNatinf } from '@/hooks/useNatinf';
import { categoryForEntry } from '@/lib/natinf/nataff';
import { useUser } from '@/contexts/UserContext';
import { FloatingDossierChat } from '../attache/FloatingDossierChat';
import { useToast } from '@/contexts/ToastContext';
import type { InfluenceCluster } from '../mindmap/influenceHull';
import { MindmapCanvas } from '../mindmap/MindmapCanvas';
import { MindmapSidePanel } from '../mindmap/MindmapSidePanel';
import { AddClusterAnnotationModal, AddDossierModal, AddLienModal, AddMecModal } from '../mindmap/OverlayModals';
import { ManageOverlayPanel } from '../mindmap/ManageOverlayPanel';
import { clearLayoutCache } from '../mindmap/useForceLayout';

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
  /** Optionnel : appelé quand l'utilisateur clique "Actualiser". Le parent peut
   *  recharger les sources depuis le disque (utile en mode offline). Le bump
   *  interne de refreshKey relance le layout dans tous les cas. */
  onRefresh?: () => void;
  /** Recherche unifiée : pilotée par la barre globale du header */
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
}

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const MindmapPage: React.FC<MindmapPageProps> = ({
  sources,
  contentieuxDefs,
  onOpenEnquete,
  onRefresh,
  searchTerm = '',
  onSearchChange,
}) => {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [sidePanelMecId, setSidePanelMecId] = useState<string | undefined>();
  // Mode ego-network : id du nœud focus, ou undefined pour vue globale.
  // Toggle en single click sur un nœud (re-clic même nœud → désactive).
  const [egoNodeId, setEgoNodeId] = useState<string | undefined>();
  // recherche unifiée : la barre globale du header alimente la cartographie
  const search = searchTerm;
  const setSearch = (v: string) => onSearchChange?.(v);
  const [showTop10, setShowTop10] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [editingMec, setEditingMec] = useState<MecExNihilo | null | undefined>(undefined); // null = nouveau, undefined = fermé
  const [editingDossier, setEditingDossier] = useState<DossierExNihilo | null | undefined>(undefined);
  const [editingLien, setEditingLien] = useState<LienRenseignement | null | undefined>(undefined);
  // Annotation d'aire en cours d'édition. cluster = cible (toujours présent
  // quand le modal est ouvert) ; existing = annotation déjà attachée si on édite.
  const [editingClusterAnnotation, setEditingClusterAnnotation] = useState<
    { cluster: InfluenceCluster; existing?: ClusterAnnotation } | undefined
  >(undefined);
  // centerRequest change → MindmapCanvas anime la caméra vers le nœud.
  // Le compteur force le re-trigger même si on cible deux fois le même id.
  const [centerRequest, setCenterRequest] = useState<{ id: string; seq: number } | undefined>();
  // Compteur "actualiser" : incrémenté à chaque clic sur le bouton refresh
  // pour forcer le recalcul du layout (utile en mode offline quand des liens
  // ont été ajoutés ailleurs sans changement d'identité de la source).
  const [refreshKey, setRefreshKey] = useState(0);
  // État du bouton Enregistrer : "idle" (rien à faire ou rien fait), "saving"
  // (flush en cours), "saved" (vient de réussir, retombe en idle après 2s).
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // Re-render quand le drapeau dirty change pour mettre à jour le badge.
  // hasPendingChanges() lit un module-level flag, donc on tick à chaque action.
  const [, forceTick] = useState(0);
  // Filtre contentieux : sélection multiple, tout coché par défaut. Un set
  // vide = aucun filtre actif (équivalent tout coché) pour rester safe.
  const [selectedContentieux, setSelectedContentieux] = useState<Set<ContentieuxId>>(
    () => new Set(contentieuxDefs.map(d => d.id)),
  );

  const pinnedMecIds = useCartographieOverlayStore(s => s.pinnedMecIds);
  const mecsExNihilo = useCartographieOverlayStore(s => s.mecsExNihilo);
  const dossiersExNihilo = useCartographieOverlayStore(s => s.dossiersExNihilo);
  const liensRenseignement = useCartographieOverlayStore(s => s.liensRenseignement);
  const overlayLoaded = useCartographieOverlayStore(s => s.isLoaded);
  const loadOverlay = useCartographieOverlayStore(s => s.load);
  const flushOverlay = useCartographieOverlayStore(s => s.flush);
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
  const clusterAnnotations = useCartographieOverlayStore(s => s.clusterAnnotations);
  const addClusterAnnotation = useCartographieOverlayStore(s => s.addClusterAnnotation);
  const updateClusterAnnotation = useCartographieOverlayStore(s => s.updateClusterAnnotation);
  const removeClusterAnnotation = useCartographieOverlayStore(s => s.removeClusterAnnotation);
  const mecScoreBoosts = useCartographieOverlayStore(s => s.mecScoreBoosts);
  const setMecScoreBoost = useCartographieOverlayStore(s => s.setMecScoreBoost);

  const { showToast } = useToast();
  const { user, isAdmin } = useUser();
  const { getByCode: getNatinfByCode } = useNatinf();
  // Sources distantes : projection des dossiers de TOUTE l'équipe (tous
  // contentieux confondus), rapatriée par le service de contributions. Rend la
  // cartographie « commune à tous ».
  const remoteSources = useCartographieContributionsStore(s => s.remoteSources);

  useEffect(() => {
    if (!overlayLoaded) loadOverlay();
  }, [overlayLoaded, loadOverlay]);

  // Démarre le service de sync au montage du module : pull initial du serveur
  // commun + listener pour pousser après chaque mutation. Stop au unmount
  // pour ne pas continuer à pinger inutilement quand l'utilisateur a quitté
  // la cartographie.
  useEffect(() => {
    cartographieOverlaySyncService.start();
    // La config de scoring (pondérations Top 10, coeff. par tag) est elle
    // aussi partagée par toute l'équipe : pull initial + sync périodique.
    CartographieConfigManager.start();
    // Contributions communes : pull des projections de tous les collègues
    // (enquêtes + instructions rattachées à un contentieux), tous contentieux
    // confondus. C'est ce qui rend le module réellement commun à tous.
    cartographieContributionsSyncService.start();
    return () => {
      cartographieOverlaySyncService.stop();
      CartographieConfigManager.stop();
      cartographieContributionsSyncService.stop();
    };
  }, []);

  // Publie la contribution locale de l'utilisateur (projection de ses sources :
  // ses enquêtes accessibles + ses dossiers d'instruction rattachés à un
  // contentieux) dès qu'elle change. Le service déduplique et débounce le push.
  useEffect(() => {
    cartographieContributionsSyncService.setLocalContribution(
      user?.windowsUsername,
      user?.displayName,
      sources,
    );
  }, [user?.windowsUsername, user?.displayName, sources]);

  // Mode offline : on persiste à la fermeture du module (ou de l'app), pas
  // pendant l'utilisation, pour ne pas faire ramer la cartographie. ATTENTION :
  // le flush async lancé sur beforeunload n'est PAS garanti d'avoir le temps
  // de finir. Si le store est dirty, on prévient l'utilisateur via la dialog
  // native — il peut alors annuler et cliquer Enregistrer explicitement.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void flushOverlay();
      if (useCartographieOverlayStore.getState().hasPendingChanges()) {
        e.preventDefault();
        e.returnValue = ''; // requis par certains navigateurs
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flushOverlay();
    };
  }, [flushOverlay]);

  const overlayInput = useMemo(() => ({
    mecsExNihilo,
    dossiersExNihilo,
    liensRenseignement,
    mecScoreBoosts,
  }), [mecsExNihilo, dossiersExNihilo, liensRenseignement, mecScoreBoosts]);

  // Configuration de scoring (pondérations éditables + poids par tag d'infraction).
  // Reconstruite quand la config carto change ou que la liste des tags
  // d'infraction évolue (utile pour le matching qualifications ↔ valeur de tag).
  const { config: cartoConfig } = useCartographieConfig();
  const { getTagsByCategory } = useTags();
  // Résolveur code NATINF → code de catégorie d'infraction (Mémento parquet),
  // mémoïsé : le score hérite du poids de la catégorie, affinable par NATINF.
  const natinfCategoryOf = useMemo(() => {
    const cache = new Map<string, string | undefined>();
    return (code: string): string | undefined => {
      if (cache.has(code)) return cache.get(code);
      const res = categoryForEntry(getNatinfByCode(code))?.category.code;
      cache.set(code, res);
      return res;
    };
  }, [getNatinfByCode]);
  const scoreConfig = useMemo(() => {
    const valueById: Record<string, string> = {};
    for (const tag of getTagsByCategory('infractions')) {
      valueById[tag.id] = tag.value;
    }
    return {
      weights: cartoConfig.weights,
      tagInfractionWeights: cartoConfig.tagInfractionWeights,
      tagInfractionValueById: valueById,
      categoryWeights: cartoConfig.categoryWeights,
      natinfCategoryOf,
      natinfWeights: cartoConfig.natinfWeights,
    };
  }, [cartoConfig, getTagsByCategory, natinfCategoryOf]);

  // Contentieux effectifs : on enrichit la liste des defs reçue en prop avec
  // les ids présents dans les sources mais inconnus des defs (typiquement
  // les dossiers d'instruction sans contentieuxId qui retombent sur l'id
  // virtuel "instructions"). Sans ça, leur filtre serait absent et ils
  // disparaîtraient du graphe. Couleur indigo distinctive pour qu'ils
  // soient repérables tels quels.
  // Sources effectives = sources locales + contributions distantes des
  // collègues, dédupliquées par dossier (`${contentieuxId}_${enqueteId}`). La
  // version locale prime (données complètes, ouvrables) ; la contribution
  // distante ne sert qu'à faire APPARAÎTRE les dossiers que ce poste n'a pas
  // (autres contentieux, instructions d'un collègue).
  const allSources = useMemo<EnqueteWithContext[]>(() => {
    if (remoteSources.length === 0) return sources;
    const seen = new Set<string>();
    const out: EnqueteWithContext[] = [];
    for (const s of sources) {
      seen.add(`${s.contentieuxId}_${s.enquete.id}`);
      out.push(s);
    }
    for (const s of remoteSources) {
      const key = `${s.contentieuxId}_${s.enquete.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }, [sources, remoteSources]);

  const effectiveContentieuxDefs = useMemo<ContentieuxDefinition[]>(() => {
    const known = new Set(contentieuxDefs.map(d => d.id));
    const orphans = new Set<ContentieuxId>();
    for (const s of allSources) {
      if (!known.has(s.contentieuxId)) orphans.add(s.contentieuxId);
    }
    if (orphans.size === 0) return contentieuxDefs;
    const virtuals: ContentieuxDefinition[] = [];
    for (const id of orphans) {
      virtuals.push({
        id,
        label: id === 'instructions' ? 'Instructions (non triées)' : id,
        color: '#6366f1',
      } as ContentieuxDefinition);
    }
    return [...contentieuxDefs, ...virtuals];
  }, [contentieuxDefs, allSources]);

  // Si un nouveau contentieux apparaît dans les defs (ex. ajouté par l'admin),
  // on l'ajoute au filtre actif pour ne rien masquer par surprise. On utilise
  // un ref "seen" pour ne le faire qu'une seule fois par id : sinon, à chaque
  // re-render des props (très fréquent vu le nombre de syncs/refreshs), on
  // ré-ajoutait tous les ids — ce qui ressuscitait silencieusement les filtres
  // que l'utilisateur venait de décocher.
  const seenContentieuxRef = useRef<Set<ContentieuxId>>(new Set());
  useEffect(() => {
    setSelectedContentieux(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const def of effectiveContentieuxDefs) {
        if (seenContentieuxRef.current.has(def.id)) continue;
        seenContentieuxRef.current.add(def.id);
        if (!next.has(def.id)) { next.add(def.id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [effectiveContentieuxDefs]);

  // Compte de dossiers par contentieux (pour les badges du filtre).
  const sourcesCountByContentieux = useMemo(() => {
    const m = new Map<ContentieuxId, number>();
    for (const s of allSources) {
      m.set(s.contentieuxId, (m.get(s.contentieuxId) || 0) + 1);
    }
    return m;
  }, [allSources]);

  // Sources filtrées : recalculé → graph rebuild → layout rebuild.
  const filteredSources = useMemo(
    () => allSources.filter(s => selectedContentieux.has(s.contentieuxId)),
    [allSources, selectedContentieux],
  );

  const graph = useMemo(
    () => buildMindmapGraph(filteredSources, overlayInput, scoreConfig),
    [filteredSources, overlayInput, scoreConfig],
  );
  const top10 = useMemo(() => getTopMec(graph, 10), [graph]);

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

  // Actualiser : rafraîchit uniquement les données sources, sans toucher au
  // layout. On NE bump PAS `refreshKey` — sinon useForceLayout repasse en
  // `warmFull` (re-simulation qui fait pivoter/écarter les nœuds) et la
  // caméra se recadre via fitView. Les positions existantes restent figées ;
  // les éventuels nouveaux nœuds sont placés de façon incrémentale.
  const handleRefresh = () => {
    if (onRefresh) onRefresh();
  };

  // Recompacter : vide complètement le cache de positions puis relance
  // un layout à froid (alpha=1, 300 ticks). Utile quand l'ajout
  // progressif a saturé la carte ou laissé des trous, et qu'on veut
  // retrouver une disposition optimale.
  const handleRecompact = () => {
    if (!window.confirm(
      'Recompacter la carte va recalculer toutes les positions depuis zéro. '
      + 'Les nœuds que tu as déplacés manuellement seront repositionnés. Continuer ?',
    )) return;
    clearLayoutCache();
    setRefreshKey(k => k + 1);
  };

  // Exporter la liste des noms au format txt brut (un nom par ligne, trié par
  // score décroissant, dédupliqué). On part des nœuds MEC de la carte — qui
  // regroupent déjà mis en cause, mis en examen, suspects et « mis en cause »
  // ajoutés à la main — en excluant les victimes projetées (drapeau isVictime).
  // On exporte ce qui est réellement affiché : le filtre contentieux actif est
  // donc respecté.
  const handleExportNames = async () => {
    // Tri par score décroissant (même rawScore que le Top), pour sortir les
    // profils les plus saillants en tête ; le nom départage à score égal.
    const ranked = Array.from(graph.mecById.values())
      .filter(mec => !mec.isVictime && mec.displayName.trim())
      .sort((a, b) =>
        b.rawScore - a.rawScore ||
        a.displayName.localeCompare(b.displayName, 'fr', { sensitivity: 'base' }),
      );
    // Déduplication par nom affiché : la première occurrence (meilleur score) gagne.
    const seen = new Set<string>();
    const sorted: string[] = [];
    for (const mec of ranked) {
      const nom = mec.displayName.trim();
      if (seen.has(nom)) continue;
      seen.add(nom);
      sorted.push(nom);
    }
    if (sorted.length === 0) {
      showToast('Aucun nom à exporter', 'info');
      return;
    }
    const filename = `mis-en-cause_${new Date().toISOString().split('T')[0]}.txt`;
    const content = sorted.join('\n') + '\n';
    try {
      if (window.electronAPI?.saveFileDialog) {
        await window.electronAPI.saveFileDialog(filename, content);
      } else {
        // Filet de sécurité hors contexte Electron/bridge : download direct.
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
      showToast(
        `${sorted.length} nom${sorted.length > 1 ? 's' : ''} exporté${sorted.length > 1 ? 's' : ''}`,
        'success',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export impossible', 'error');
    }
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      // Persistance locale d'abord (rapide, garantie même hors ligne).
      await flushOverlay();
      // Puis push immédiat vers le serveur commun (peut échouer silencieusement
      // si le partage est injoignable — la prochaine sync périodique
      // retentera dès que le réseau revient).
      await cartographieOverlaySyncService.flushPending();
      await CartographieConfigManager.flushPending();
      await cartographieContributionsSyncService.flushPending();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('idle');
    }
  };

  // Tick toutes les 1.5s pour rafraîchir l'indicateur "modifs en attente".
  // Le store n'expose pas de subscription pour le drapeau dirty (c'est un
  // module-level flag), un poll léger est largement suffisant pour cet usage.
  useEffect(() => {
    const i = setInterval(() => forceTick(t => t + 1), 1500);
    return () => clearInterval(i);
  }, []);

  const hasPendingChanges = useCartographieOverlayStore.getState().hasPendingChanges();

  const handleAnnotateCluster = (cluster: InfluenceCluster, existing?: ClusterAnnotation) => {
    setEditingClusterAnnotation({ cluster, existing });
  };

  const toggleContentieux = (id: ContentieuxId) => {
    setSelectedContentieux(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allContentieuxSelected = selectedContentieux.size === effectiveContentieuxDefs.length;

  // Single-click et double-click sur un nœud doivent cohabiter : le simple-clic
  // toggle l'ego-network (changement d'état → re-render de Canvas → React Flow
  // peut remonter le DOM du nœud entre les deux clics, ce qui empêche le
  // navigateur d'émettre l'événement `dblclick`). On diffère donc le simple-clic
  // d'un délai standard ; un double-clic survenu dans cette fenêtre l'annule.
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };
  useEffect(() => () => cancelPendingClick(), []);

  const handleNodeClick = (node: GraphNode) => {
    cancelPendingClick();
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setSelectedId(node.id);
      if (node.type === 'mec') setSidePanelMecId(node.id);
      // Toggle ego-network : re-cliquer sur le même nœud sort du mode.
      setEgoNodeId(prev => prev === node.id ? undefined : node.id);
    }, 220);
  };

  const handleNodeDoubleClick = (node: GraphNode) => {
    cancelPendingClick();
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

        {/* Résultats de la recherche unifiée (saisie dans la barre du header) */}
        <div className="flex-1 min-w-[240px] relative">
          {search.trim() !== '' && (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
              <Search className="h-3.5 w-3.5" />
              {searchResults.length > 0
                ? <>Résultats pour « {search} »</>
                : <>Aucun mis en cause ni dossier pour « {search} »</>}
            </div>
          )}
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

        {/* Filtre contentieux */}
        <div className="relative">
          <button
            onClick={() => setFilterMenuOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              !allContentieuxSelected
                ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
            title="Filtrer par contentieux"
          >
            <Filter className="h-3.5 w-3.5" />
            Contentieux
            <span className={`text-[10px] rounded px-1 ${
              !allContentieuxSelected ? 'bg-amber-200 text-amber-900' : 'bg-slate-200'
            }`}>
              {selectedContentieux.size}/{effectiveContentieuxDefs.length}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {filterMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-40 min-w-[240px] py-1">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
                  <span className="text-[10px] uppercase font-semibold text-slate-500">Contentieux affichés</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedContentieux(new Set(effectiveContentieuxDefs.map(d => d.id)))}
                      className="text-[10px] text-slate-600 hover:text-slate-900 underline"
                    >
                      tout
                    </button>
                    <button
                      onClick={() => setSelectedContentieux(new Set())}
                      className="text-[10px] text-slate-600 hover:text-slate-900 underline"
                    >
                      aucun
                    </button>
                  </div>
                </div>
                {effectiveContentieuxDefs.map(def => {
                  const checked = selectedContentieux.has(def.id);
                  const count = sourcesCountByContentieux.get(def.id) || 0;
                  return (
                    <button
                      key={def.id}
                      onClick={() => toggleContentieux(def.id)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-left"
                    >
                      <span
                        className={`flex items-center justify-center h-4 w-4 rounded border ${
                          checked ? 'border-transparent' : 'border-slate-300 bg-white'
                        }`}
                        style={{ background: checked ? def.color : undefined }}
                      >
                        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                      </span>
                      <span className="text-sm text-slate-800 flex-1">{def.label}</span>
                      <span className="text-[10px] text-slate-400">{count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Actualiser : recalcule la cartographie (utile en mode offline après
            un ajout de MEC à un dossier, ou si les sources ont changé en arrière-plan). */}
        <button
          onClick={handleRefresh}
          title="Actualiser la cartographie"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualiser
        </button>

        {/* Recompacter : layout à froid complet. Vide le cache des positions
            et reconstruit la carte depuis zéro. Plus radical qu'Actualiser. */}
        <button
          onClick={handleRecompact}
          title="Recompacter la carte (recalcul complet des positions)"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <Shrink className="h-3.5 w-3.5" />
          Recompacter
        </button>

        {/* Exporter : liste des noms (mis en cause, mis en examen, suspects et
            ajouts manuels — hors victimes) en .txt brut, un nom par ligne. */}
        <button
          onClick={handleExportNames}
          title="Exporter la liste des noms (mis en cause, mis en examen, suspects… hors victimes) au format texte"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          <FileDown className="h-3.5 w-3.5" />
          Exporter
        </button>

        {/* Enregistrer : flush explicite des overlays sur disque. Indispensable
            avant une sync globale ou avant de fermer l'onglet — la sauvegarde
            auto sur beforeunload n'est pas garantie de s'exécuter à temps
            (le navigateur peut couper la promise async). */}
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          title={
            saveState === 'saved' ? 'Modifications enregistrées'
            : hasPendingChanges ? 'Modifications en attente — cliquer pour enregistrer'
            : 'Tout est à jour'
          }
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            saveState === 'saved'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
              : hasPendingChanges
                ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600 animate-pulse'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
          }`}
        >
          {saveState === 'saving' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saveState === 'saved' ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saveState === 'saving' ? 'Enregistrement…'
            : saveState === 'saved' ? 'Enregistré'
            : hasPendingChanges ? 'Enregistrer*'
            : 'Enregistrer'}
        </button>

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
              {selectedContentieux.size < effectiveContentieuxDefs.length
                ? "Aucun dossier ne correspond au filtre contentieux actif. Élargissez la sélection."
                : "La cartographie se peuplera dès qu'au moins un dossier accessible contiendra un mis en cause."}
            </div>
          </div>
        )}

        {graph.nodes.length > 0 && (
          <MindmapCanvas
            nodes={graph.nodes}
            edges={graph.edges}
            contentieuxDefs={effectiveContentieuxDefs}
            focusedId={selectedId}
            centerRequest={centerRequest}
            refreshKey={refreshKey}
            clusterAnnotations={clusterAnnotations}
            onAnnotateCluster={handleAnnotateCluster}
            egoNodeId={egoNodeId}
            pinnedIds={pinnedMecIds}
            groupByService={cartoConfig.groupByService}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
          />
        )}

        {sidePanelMec && (
          <MindmapSidePanel
            mec={sidePanelMec}
            graph={graph}
            contentieuxDefs={effectiveContentieuxDefs}
            onClose={() => setSidePanelMecId(undefined)}
            onDossierClick={handleDossierFromPanel}
            onDossierOpen={handleDossierOpenFromPanel}
            onSetScoreBoost={setMecScoreBoost}
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
        onCreateMec={(data) => addMec(data)}
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

      <AddClusterAnnotationModal
        isOpen={editingClusterAnnotation !== undefined}
        onClose={() => setEditingClusterAnnotation(undefined)}
        cluster={editingClusterAnnotation ? {
          nodeIds: editingClusterAnnotation.cluster.nodeIds,
          color: editingClusterAnnotation.cluster.color,
          nbMembers: editingClusterAnnotation.cluster.nodeIds.length,
        } : undefined}
        initial={editingClusterAnnotation?.existing}
        onSubmit={(data) => {
          if (editingClusterAnnotation?.existing) {
            updateClusterAnnotation(editingClusterAnnotation.existing.id, data);
          } else {
            addClusterAnnotation(data);
          }
        }}
        onDelete={editingClusterAnnotation?.existing ? () => {
          removeClusterAnnotation(editingClusterAnnotation.existing!.id);
        } : undefined}
      />

      {/* HINT bas de page */}
      <div className="border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500 flex items-center gap-4 flex-wrap">
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Clic MEC</kbd> fiche détaillée</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Double-clic dossier</kbd> ouvrir l'enquête</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Recherche</kbd> centre la caméra sur le nœud</span>
        <span><kbd className="px-1 bg-slate-100 rounded border border-slate-200">Molette</kbd> zoom</span>
      </div>

      {/* Chat carto de l'attaché — admin only : analyse du réseau, propose
          les liens de renseignement manquants (auto-masqué si inactif). */}
      {isAdmin() && <FloatingDossierChat numero="carto" carto label="Cartographie" />}
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
                  isPinned ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-slate-50'
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
                  title={isPinned ? 'Retirer le marqueur sur la carte' : 'Marquer ce MEC sur la carte (anneau rouge)'}
                  className={`p-1 rounded flex-shrink-0 transition-colors ${
                    isPinned
                      ? 'text-red-600 hover:text-red-800'
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
        Les MEC marqués sont entourés en rouge sur la carte.
      </div>
    </div>
  );
};
