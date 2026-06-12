'use client';

import React, { useMemo } from 'react';
import {
  FileText, CheckCircle2, BarChart, Settings, Target,
  Plus, Scale, Activity, Eye, PieChart, Network, LayoutDashboard
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
  /** Création d'un dossier d'instruction (même expérience que « Nouvelle enquête ») */
  onNewInstruction?: () => void;
  onOpenSettings: () => void;
  alertCount: number;
  instructionAlertCount?: number;
  /** Nombre d'enquêtes en cours par contentieux (petit compteur) */
  enqueteCounts?: Record<string, number>;
  /** Nombre d'instructions en cours (petit compteur) */
  instructionCount?: number;
  /** Résultats de recherche dans les autres contentieux (pastilles) */
  crossSearchResults?: CrossSearchResult[];
  /** Nombre d'utilisateurs en attente d'approbation (badge sur Paramètres) */
  pendingUsersCount?: number;
}

/** Petit compteur discret (enquêtes/instructions en cours). */
const CountPill = ({ n }: { n: number }) => (
  <span className="ml-auto text-[10.5px] font-semibold text-white/65 bg-white/10 rounded-full px-1.5 min-w-[18px] text-center">
    {n}
  </span>
);

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
  onNewInstruction,
  onOpenSettings,
  alertCount,
  instructionAlertCount = 0,
  enqueteCounts = {},
  instructionCount = 0,
  crossSearchResults = [],
  pendingUsersCount = 0,
}: MultiSideBarProps) => {
  const { accessibleContentieux, canDo, isAdmin, hasOverboard, hasModule, permissions, user } = useUser();

  // Libellé lisible du rôle global
  const roleLabel = (() => {
    switch (user?.globalRole) {
      case 'admin': return 'Administrateur';
      case 'pra': return 'Procureur de la République adjoint';
      case 'vice_proc': return 'Vice-procureur';
      case 'jld': return 'Juge des libertés et de la détention';
      default: return 'Membre';
    }
  })();
  const initials = (user?.displayName || '?')
    .split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const sortedContentieux = useMemo(
    () => [...accessibleContentieux].sort((a, b) => a.order - b.order),
    [accessibleContentieux]
  );
  const sidebarWidth = isOpen ? 'w-64' : 'w-16';

  // Déterminer si un contentieux est en lecture seule pour l'utilisateur
  const isReadOnly = (cId: ContentieuxId): boolean => {
    return permissions?.byContentieux.get(cId)?.isReadOnly ?? true;
  };

  // Items de navigation par contentieux
  const getContentieuxItems = (cId: ContentieuxId) => {
    const items: Array<{ view: string; icon: any; label: string; visible: boolean; count?: number }> = [
      { view: `enquetes_${cId}`, icon: FileText, label: 'Enquêtes', visible: true, count: enqueteCounts[cId] },
      { view: `archives_${cId}`, icon: CheckCircle2, label: 'Enquêtes terminées', visible: true },
      { view: `stats_${cId}`, icon: BarChart, label: 'Statistiques', visible: canDo(cId, 'view_stats') },
    ];
    return items.filter(i => i.visible);
  };

  return (
    <div
      className={`${sidebarWidth} h-screen transition-all duration-300 flex flex-col relative overflow-hidden`}
      style={{
        // Slate-indigo doux, dans l'esprit macOS/iOS : moderne, reposant,
        // bien moins saturé que le Bleu France pur.
        background: 'linear-gradient(180deg, #4a5578 0%, #353d5c 100%)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Liseré supérieur très discret */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)' }} />

      {/* ── MARQUE : icône constellation ── */}
      <div className={`flex items-center gap-2.5 px-4 pt-4 pb-2 ${isOpen ? '' : 'justify-center px-0'}`}>
        <svg viewBox="0 0 48 48" width="30" height="30" className="flex-shrink-0" style={{ borderRadius: 9 }}>
          <defs>
            <linearGradient id="siralSb" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8585f6" /><stop offset="1" stopColor="#5b63d6" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="48" height="48" rx="11" fill="url(#siralSb)" />
          <g stroke="#fff" strokeWidth="2.1" strokeLinecap="round" fill="none" opacity="0.92"><path d="M31 13 L17 19 L30 27 L17 34" /></g>
          <g fill="#fff"><circle cx="31" cy="13" r="3.1" /><circle cx="17" cy="19" r="2.5" /><circle cx="30" cy="27" r="2.5" /><circle cx="17" cy="34" r="3.1" /></g>
        </svg>
        {isOpen && <span className="text-[15px] font-bold tracking-tight text-white">SIRAL</span>}
      </div>

      <div className="p-3 flex flex-col flex-1 pt-1 overflow-y-auto scrollbar-thin min-h-0">
        {/* ── TABLEAU DE BORD ── */}
        <button
          className={`
            w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-1
            transition-all duration-150
            ${currentView === 'dashboard'
              ? 'bg-white/20 text-white font-semibold'
              : 'font-medium text-white/70 hover:bg-white/10 hover:text-white'
            }
          `}
          style={currentView === 'dashboard' ? { boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)' } : {}}
          onClick={() => onViewChange('dashboard')}
        >
          <LayoutDashboard className={`h-4 w-4 flex-shrink-0 ${currentView === 'dashboard' ? 'text-white' : 'text-white/60'}`} />
          {isOpen && <span className="truncate">Tableau de bord</span>}
        </button>
        <div className="my-2 border-t border-white/10" />

        {/* ── BLOCS CONTENTIEUX ── */}
        {sortedContentieux
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
                {items.map(({ view, icon: Icon, label, count }) => {
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
                      {/* Compteur d'enquêtes en cours (sauf si une pastille de recherche s'affiche) */}
                      {isOpen && !crossHit && typeof count === 'number' && count > 0 && <CountPill n={count} />}
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
              {isOpen && <span className="truncate">Instructions judiciaires</span>}
              {instructionAlertCount > 0 ? <AlertBadge count={instructionAlertCount} />
                : (isOpen && instructionCount > 0 && <CountPill n={instructionCount} />)}
            </button>
            <button
              className={`
                w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm mt-0.5
                transition-all duration-150 relative group
                ${currentView === 'instructions_archives'
                  ? 'bg-white/20 text-white font-semibold shadow-sm'
                  : 'font-medium text-white/65 hover:bg-white/8 hover:text-white'
                }
              `}
              style={currentView === 'instructions_archives' ? {
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)'
              } : {}}
              onClick={() => onViewChange('instructions_archives')}
            >
              <CheckCircle2 className={`h-4 w-4 flex-shrink-0 ${currentView === 'instructions_archives' ? 'text-white' : 'text-white/65'}`} />
              {isOpen && <span className="truncate">Instructions terminées</span>}
            </button>
            {onNewInstruction && (
              <button
                className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-medium
                  transition-all duration-150 text-white/60 hover:text-white hover:bg-white/10 mt-0.5"
                onClick={() => { onViewChange('instructions'); onNewInstruction(); }}
              >
                <Plus className="h-3.5 w-3.5 flex-shrink-0" />
                {isOpen && <span className="truncate">Nouvelle instruction</span>}
              </button>
            )}
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

        {/* Mindmap — module activable, transversal */}
        {hasModule('mindmap') && (
          <>
            <div className="my-2 border-t border-white/10" />
            <button
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm
                transition-all duration-150 relative group
                ${currentView === 'mindmap'
                  ? 'bg-white/20 text-white font-semibold shadow-sm'
                  : 'font-medium text-white/70 hover:bg-white/8 hover:text-white'
                }
              `}
              style={currentView === 'mindmap' ? {
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.85)'
              } : {}}
              onClick={() => onViewChange('mindmap')}
            >
              <Network className={`h-4 w-4 flex-shrink-0 ${currentView === 'mindmap' ? 'text-white' : 'text-white/60'}`} />
              {isOpen && <span className="truncate">Cartographie</span>}
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

      {/* ── UTILISATEUR CONNECTÉ ── */}
      {user && (
        <div className={`px-3 pb-2 pt-1 ${isOpen ? '' : 'flex justify-center'}`}>
          <div className={`flex items-center gap-2.5 ${isOpen ? 'px-2 py-1.5 rounded-lg bg-white/5' : ''}`}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(140deg,#8585f6,#5b63d6)' }} title={user.displayName}>
              {initials}
            </div>
            {isOpen && (
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-white/90 truncate">{user.displayName}</div>
                <div className="text-[10px] text-white/60 truncate">{roleLabel}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="copyright">
        <div>Conçu par A. CHEVALIER — Parquet d&apos;Amiens · {new Date().getFullYear()}</div>
      </div>
    </div>
  );
};
