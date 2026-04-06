'use client';

import React from 'react';
import {
  FileText, Archive, BarChart, Settings, Target,
  Plus, Scale, Activity, Eye, PieChart
} from 'lucide-react';
import { AlertBadge } from './AlertBadge';
import { useUser } from '@/contexts/UserContext';
import { ContentieuxId } from '@/types/userTypes';
import { CrossSearchResult } from '@/hooks/useCrossSearch';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

interface MultiSideBarProps {
  isOpen: boolean;
  currentView: string;
  currentContentieux: ContentieuxId | null;
  onViewChange: (view: string, contentieuxId?: ContentieuxId) => void;
  onNewEnquete: () => void;
  onOpenSettings: () => void;
  alertCount: number;
  instructionAlertCount?: number;
  /** Résultats de recherche dans les autres contentieux (pastilles) */
  crossSearchResults?: CrossSearchResult[];
  /** Nombre d'utilisateurs en attente d'approbation (badge sur Paramètres) */
  pendingUsersCount?: number;
}

// ──────────────────────────────────────────────
// COULEURS CONTENTIEUX (Tailwind-safe)
// ──────────────────────────────────────────────

const CONTENTIEUX_COLORS: Record<string, {
  dot: string;
  active: string;
  hover: string;
  label: string;
}> = {
  crimorg: { dot: 'bg-red-500', active: 'bg-red-500/20', hover: 'hover:bg-red-500/10', label: 'text-red-300' },
  ecofi:   { dot: 'bg-blue-500', active: 'bg-blue-500/20', hover: 'hover:bg-blue-500/10', label: 'text-blue-300' },
  enviro:  { dot: 'bg-green-500', active: 'bg-green-500/20', hover: 'hover:bg-green-500/10', label: 'text-green-300' },
};

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const MultiSideBar = ({
  isOpen,
  currentView,
  currentContentieux,
  onViewChange,
  onNewEnquete,
  onOpenSettings,
  alertCount,
  instructionAlertCount = 0,
  crossSearchResults = [],
  pendingUsersCount = 0,
}: MultiSideBarProps) => {
  const { accessibleContentieux, canDo, isAdmin, hasOverboard, hasModule, permissions } = useUser();
  const sidebarWidth = isOpen ? 'w-64' : 'w-16';

  // Déterminer si un contentieux est en lecture seule pour l'utilisateur
  const isReadOnly = (cId: ContentieuxId): boolean => {
    return permissions?.byContentieux.get(cId)?.isReadOnly ?? true;
  };

  // Items de navigation par contentieux
  const getContentieuxItems = (cId: ContentieuxId) => {
    const items: Array<{ view: string; icon: any; label: string; visible: boolean }> = [
      { view: `enquetes_${cId}`, icon: FileText, label: 'Enquêtes', visible: true },
      { view: `archives_${cId}`, icon: Archive, label: 'Archive', visible: true },
      { view: `stats_${cId}`, icon: BarChart, label: 'Statistiques', visible: canDo(cId, 'view_stats') },
    ];
    return items.filter(i => i.visible);
  };

  return (
    <div
      className={`${sidebarWidth} h-screen shadow-xl transition-all duration-300 flex flex-col relative overflow-hidden`}
      style={{
        background: 'linear-gradient(180deg, #2d5f4a 0%, #1e3d2f 100%)',
      }}
    >
      {/* Subtle top accent line */}
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)' }} />

      <div className="p-3 flex flex-col flex-1 pt-4 overflow-y-auto scrollbar-thin">
        {/* ── BLOCS CONTENTIEUX ── */}
        {accessibleContentieux
          .sort((a, b) => a.order - b.order)
          .map((ctxDef, idx) => {
            const colors = CONTENTIEUX_COLORS[ctxDef.id] || CONTENTIEUX_COLORS.crimorg;
            const readOnly = isReadOnly(ctxDef.id);
            const items = getContentieuxItems(ctxDef.id);

            return (
              <div key={ctxDef.id}>
                {/* Séparateur entre blocs (sauf le premier) */}
                {idx > 0 && <div className="my-2 border-t border-white/10" />}

                {/* Header contentieux */}
                {isOpen ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 mb-0.5">
                    <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    <span className={`text-xs font-bold uppercase tracking-wider ${colors.label}`}>
                      {ctxDef.label}
                    </span>
                    {readOnly && (
                      <span title="Lecture seule"><Eye className="h-3 w-3 text-white/40 ml-auto" /></span>
                    )}
                  </div>
                ) : (
                  <div className="flex justify-center py-1.5 mb-0.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} title={ctxDef.label} />
                  </div>
                )}

                {/* Nav items du contentieux */}
                {items.map(({ view, icon: Icon, label }) => {
                  const isActive = currentView === view;
                  // Pastille cross-search : uniquement sur l'item "Enquêtes"
                  const isEnquetesView = view === `enquetes_${ctxDef.id}`;
                  const crossHit = isEnquetesView
                    ? crossSearchResults.find(r => r.contentieuxId === ctxDef.id)
                    : null;

                  return (
                    <button
                      key={view}
                      className={`
                        w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm
                        transition-all duration-150 relative group
                        ${isActive
                          ? `${colors.active} text-white font-semibold shadow-sm`
                          : `font-medium text-white/70 ${colors.hover} hover:text-white`
                        }
                      `}
                      style={isActive ? {
                        boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85), inset 0 1px 0 rgba(255,255,255,0.1)'
                      } : {}}
                      onClick={() => onViewChange(view, ctxDef.id)}
                    >
                      <Icon className={`h-4 w-4 flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white'}`} />
                      {isOpen && <span className="truncate">{label}</span>}
                      {/* Pastille résultat de recherche cross-contentieux */}
                      {crossHit && (
                        <span
                          className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded-full animate-pulse"
                          style={{
                            backgroundColor: ctxDef.color + '33',
                            color: '#fff',
                            border: `1px solid ${ctxDef.color}88`,
                          }}
                          title={`${crossHit.count} résultat${crossHit.count > 1 ? 's' : ''} trouvé${crossHit.count > 1 ? 's' : ''}`}
                        >
                          {crossHit.count}
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Bouton nouvelle enquête — seulement si droit de créer */}
                {canDo(ctxDef.id, 'create') && (
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      transition-all duration-150 text-white/60 hover:text-white hover:bg-white/8 mt-0.5"
                    onClick={() => {
                      onViewChange(`enquetes_${ctxDef.id}`, ctxDef.id);
                      onNewEnquete();
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 flex-shrink-0" />
                    {isOpen && <span className="truncate">Nouvelle enquête</span>}
                  </button>
                )}
              </div>
            );
          })}

        {/* ── MODULES TRANSVERSAUX ── */}

        {/* Instructions — module activable, transversal */}
        {hasModule('instructions') && (
          <>
            <div className="my-2 border-t border-white/10" />
            <button
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                transition-all duration-150 relative group
                ${currentView === 'instructions'
                  ? 'bg-white/20 text-white font-semibold shadow-sm'
                  : 'font-medium text-white/70 hover:bg-white/8 hover:text-white'
                }
              `}
              style={currentView === 'instructions' ? {
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)'
              } : {}}
              onClick={() => onViewChange('instructions')}
            >
              <Scale className={`h-4 w-4 flex-shrink-0 ${currentView === 'instructions' ? 'text-white' : 'text-white/60'}`} />
              {isOpen && <span className="truncate">Instructions</span>}
              {instructionAlertCount > 0 && <AlertBadge count={instructionAlertCount} />}
            </button>
          </>
        )}

        {/* AIR — module activable */}
        {hasModule('air') && (
          <>
            <div className="my-2 border-t border-white/10" />
            <button
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                transition-all duration-150 relative group
                ${currentView === 'air'
                  ? 'bg-white/20 text-white font-semibold shadow-sm'
                  : 'font-medium text-white/70 hover:bg-white/8 hover:text-white'
                }
              `}
              style={currentView === 'air' ? {
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)'
              } : {}}
              onClick={() => onViewChange('air')}
            >
              <Activity className={`h-4 w-4 flex-shrink-0 ${currentView === 'air' ? 'text-white' : 'text-white/60'}`} />
              {isOpen && <span className="truncate">Suivi AIR</span>}
            </button>
          </>
        )}

        {/* ── OVERBOARD ── */}
        {hasOverboard() && (
          <>
            <div className="my-2 border-t border-white/10" />
            <button
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                transition-all duration-150 relative group
                ${currentView === 'overboard'
                  ? 'bg-white/20 text-white font-semibold shadow-sm'
                  : 'font-medium text-white/70 hover:bg-white/8 hover:text-white'
                }
              `}
              style={currentView === 'overboard' ? {
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)'
              } : {}}
              onClick={() => onViewChange('overboard')}
            >
              <Target className={`h-4 w-4 flex-shrink-0 ${currentView === 'overboard' ? 'text-white' : 'text-white/60'}`} />
              {isOpen && <span className="truncate">Overboard</span>}
            </button>
            <button
              className={`
                w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm
                transition-all duration-150 relative group
                ${currentView === 'global_stats'
                  ? 'bg-white/20 text-white font-semibold shadow-sm'
                  : 'font-medium text-white/70 hover:bg-white/8 hover:text-white'
                }
              `}
              style={currentView === 'global_stats' ? {
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)'
              } : {}}
              onClick={() => onViewChange('global_stats')}
            >
              <PieChart className={`h-4 w-4 flex-shrink-0 ${currentView === 'global_stats' ? 'text-white' : 'text-white/60'}`} />
              {isOpen && <span className="truncate">Statistiques globales</span>}
            </button>
          </>
        )}

      </div>

      {/* ── PARAMÈTRES ── */}
      <div className="px-3 pb-1 pt-2 border-t border-white/10 mx-1">
        <button
          className={`
            w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
            transition-all duration-150 relative group
            ${currentView === 'settings'
              ? 'bg-white/20 text-white font-semibold shadow-sm'
              : 'font-medium text-white/70 hover:bg-white/8 hover:text-white'
            }
          `}
          onClick={onOpenSettings}
        >
          <Settings className={`h-4 w-4 flex-shrink-0 ${currentView === 'settings' ? 'text-white' : 'text-white/60'}`} />
          {isOpen && <span className="truncate">Paramètres</span>}
          {pendingUsersCount > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-[16px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full shadow-sm">
              {pendingUsersCount}
            </span>
          )}
        </button>
      </div>

      <div className="copyright">
        <div style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', opacity: 0.7 }}>
          APP MÉTIER
        </div>
        <div>Conçu par A. CHEVALIER — Parquet d&apos;Amiens</div>
        <div style={{ opacity: 0.4 }}>2025–{new Date().getFullYear()}</div>
      </div>
    </div>
  );
};
