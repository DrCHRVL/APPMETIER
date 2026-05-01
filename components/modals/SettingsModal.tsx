'use client';

import React, { useState } from 'react';
import { X, Bell, Tags, Save, Users, Settings, Network, Activity, ClipboardList, Layers, Upload, Info, User, Gavel } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { ContentieuxId, ModuleId } from '@/types/userTypes';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

type SettingsTab =
  | 'alertes' | 'tags' | 'sauvegardes' | 'mon_profil' | 'a_propos'
  | 'module_instruction'
  | 'admin_users' | 'admin_contentieux' | 'admin_paths' | 'admin_dashboard' | 'admin_tag_history' | 'admin_update';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alertesContent: React.ReactNode;
  tagsContent: React.ReactNode;
  sauvegardesContent: React.ReactNode;
  monProfilContent?: React.ReactNode;
  /** Panneau du module instruction (visible si l'utilisateur a le module activé) */
  moduleInstructionContent?: React.ReactNode;
  adminUsersContent?: React.ReactNode;
  adminContentieuxContent?: React.ReactNode;
  adminPathsContent?: React.ReactNode;
  adminDashboardContent?: React.ReactNode;
  adminTagHistoryContent?: React.ReactNode;
  adminUpdateContent?: React.ReactNode;
  aProposContent?: React.ReactNode;
  /** Currently active contentieux (used as default) */
  activeContentieuxId?: ContentieuxId;
  /** Called when user switches contentieux tab in settings */
  onContentieuxChange?: (contentieuxId: ContentieuxId) => void;
  /** Number of pending user approvals (shown as badge on Utilisateurs tab) */
  pendingUsersCount?: number;
}

// ──────────────────────────────────────────────
// TAB DEFINITIONS
// ──────────────────────────────────────────────

type TabSection = 'general' | 'modules' | 'admin';

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: React.ElementType;
  section: TabSection;
  /** Réservé aux admins (admin = isAdmin()) */
  isAdmin?: boolean;
  /** Module requis pour voir cet onglet (l'utilisateur doit l'avoir activé) */
  requiresModule?: ModuleId;
}

const TABS: TabDef[] = [
  // Général
  { id: 'alertes',     label: 'Alertes',     icon: Bell, section: 'general' },
  { id: 'tags',        label: 'Tags',        icon: Tags, section: 'general' },
  { id: 'sauvegardes', label: 'Sauvegardes', icon: Save, section: 'general' },
  { id: 'mon_profil',  label: 'Mon profil',  icon: User, section: 'general' },
  { id: 'a_propos',    label: 'À propos',    icon: Info, section: 'general' },

  // Modules (visibles selon les modules activés pour l'utilisateur)
  { id: 'module_instruction', label: 'Instruction', icon: Gavel, section: 'modules', requiresModule: 'instructions' },

  // Administration (admin uniquement)
  { id: 'admin_users',       label: 'Utilisateurs',     icon: Users,         section: 'admin', isAdmin: true },
  { id: 'admin_contentieux', label: 'Contentieux',      icon: Layers,        section: 'admin', isAdmin: true },
  { id: 'admin_paths',       label: 'Chemins réseau',   icon: Network,       section: 'admin', isAdmin: true },
  { id: 'admin_dashboard',   label: 'Tableau de bord',  icon: Activity,      section: 'admin', isAdmin: true },
  { id: 'admin_tag_history', label: 'Historique tags',  icon: ClipboardList, section: 'admin', isAdmin: true },
  { id: 'admin_update',      label: 'Mise à jour',      icon: Upload,        section: 'admin', isAdmin: true },
];

const SECTION_LABELS: Record<TabSection, string> = {
  general: 'Général',
  modules: 'Modules',
  admin:   'Administration',
};

// Couleurs contentieux
const CTX_TAB_COLORS: Record<string, { active: string; dot: string }> = {
  crimorg: { active: 'border-red-500 text-red-700', dot: 'bg-red-500' },
  ecofi:   { active: 'border-blue-500 text-blue-700', dot: 'bg-blue-500' },
  enviro:  { active: 'border-green-500 text-green-700', dot: 'bg-green-500' },
};

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const SettingsModal = ({
  isOpen,
  onClose,
  alertesContent,
  tagsContent,
  sauvegardesContent,
  monProfilContent,
  moduleInstructionContent,
  adminUsersContent,
  adminContentieuxContent,
  adminPathsContent,
  adminDashboardContent,
  adminTagHistoryContent,
  adminUpdateContent,
  aProposContent,
  activeContentieuxId,
  onContentieuxChange,
  pendingUsersCount = 0,
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('alertes');
  const { isAdmin: checkIsAdmin, accessibleContentieux, hasModule } = useUser();
  const userIsAdmin = checkIsAdmin();

  // Contentieux sélectionné dans les paramètres (indépendant du contentieux actif)
  const [selectedCtx, setSelectedCtx] = useState<ContentieuxId>(
    activeContentieuxId || accessibleContentieux[0]?.id || 'crimorg'
  );

  if (!isOpen) return null;

  // Filtrer les onglets selon les droits + modules activés
  const visibleTabs = TABS.filter(t => {
    if (t.isAdmin && !userIsAdmin) return false;
    if (t.requiresModule && !hasModule(t.requiresModule)) return false;
    return true;
  });

  // Regrouper par section pour insérer les séparateurs
  const sectionOrder: TabSection[] = ['general', 'modules', 'admin'];
  const tabsBySection: Record<TabSection, TabDef[]> = { general: [], modules: [], admin: [] };
  for (const t of visibleTabs) tabsBySection[t.section].push(t);

  const renderContent = () => {
    switch (activeTab) {
      case 'alertes':            return alertesContent;
      case 'tags':               return tagsContent;
      case 'sauvegardes':        return sauvegardesContent;
      case 'mon_profil':         return monProfilContent;
      case 'a_propos':           return aProposContent;
      case 'module_instruction': return moduleInstructionContent;
      case 'admin_users':        return adminUsersContent;
      case 'admin_contentieux':  return adminContentieuxContent;
      case 'admin_paths':        return adminPathsContent;
      case 'admin_dashboard':    return adminDashboardContent;
      case 'admin_tag_history':  return adminTagHistoryContent;
      case 'admin_update':       return adminUpdateContent;
      default:                   return null;
    }
  };

  // Onglets contentieux (horizontal en haut) — pas pour les onglets admin/module/profil/à propos
  const showContentieuxTabs =
    accessibleContentieux.length > 1
    && !activeTab.startsWith('admin_')
    && !activeTab.startsWith('module_')
    && activeTab !== 'a_propos'
    && activeTab !== 'mon_profil';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-[1200px] h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Settings className="h-5 w-5 text-gray-500" />
            Paramètres
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Onglets contentieux (horizontal) */}
        {showContentieuxTabs && (
          <div className="flex items-center gap-1 px-6 pt-3 pb-0 border-b border-gray-100">
            {accessibleContentieux
              .sort((a, b) => a.order - b.order)
              .map(ctxDef => {
                const isActive = selectedCtx === ctxDef.id;
                const colors = CTX_TAB_COLORS[ctxDef.id] || { active: 'border-gray-500 text-gray-700', dot: 'bg-gray-500' };
                return (
                  <button
                    key={ctxDef.id}
                    className={`
                      flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider
                      border-b-2 transition-all
                      ${isActive
                        ? `${colors.active} border-b-2`
                        : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-300'
                      }
                    `}
                    onClick={() => {
                      setSelectedCtx(ctxDef.id);
                      onContentieuxChange?.(ctxDef.id);
                    }}
                  >
                    <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                    {ctxDef.label}
                  </button>
                );
              })}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs sidebar */}
          <div className="w-52 border-r border-gray-200 py-3 flex flex-col bg-gray-50">
            {sectionOrder.map((section, sectionIdx) => {
              const tabs = tabsBySection[section];
              if (tabs.length === 0) return null;
              const showSeparator = sectionIdx > 0;
              return (
                <React.Fragment key={section}>
                  {showSeparator && (
                    <div className="mx-3 my-2 border-t border-gray-300">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-2 px-3">
                        {SECTION_LABELS[section]}
                      </span>
                    </div>
                  )}
                  {tabs.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        className={`
                          flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-sm transition-all
                          ${isActive
                            ? 'bg-white shadow-sm font-semibold text-gray-800 border border-gray-200'
                            : 'text-gray-600 hover:bg-white/60 hover:text-gray-800'
                          }
                        `}
                        onClick={() => setActiveTab(tab.id)}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? 'text-emerald-600' : 'text-gray-400'}`} />
                        <span>{tab.label}</span>
                        {tab.id === 'admin_users' && pendingUsersCount > 0 && (
                          <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full">
                            {pendingUsersCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* Footer propriété intellectuelle */}
            <div className="mt-auto px-4 pt-3 border-t border-gray-200 mx-2">
              <p className="text-[10px] leading-tight text-gray-400 font-medium uppercase tracking-wide">APP METIER</p>
              <p className="text-[10px] leading-tight text-gray-400 mt-0.5">
                {"Conçu par A. CHEVALIER — Parquet d'Amiens"}
              </p>
              <p className="text-[9px] leading-tight text-red-400 font-semibold mt-1">NE PAS DIFFUSER</p>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};
