'use client';

import React, { useState } from 'react';
import { X, Bell, Tags, Save, Users, Settings, Network, Activity, ClipboardList, Layers, Upload } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { ContentieuxId } from '@/types/userTypes';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

type SettingsTab = 'alertes' | 'tags' | 'sauvegardes' | 'admin_users' | 'admin_contentieux' | 'admin_paths' | 'admin_dashboard' | 'admin_tag_history' | 'admin_update';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alertesContent: React.ReactNode;
  tagsContent: React.ReactNode;
  sauvegardesContent: React.ReactNode;
  adminUsersContent?: React.ReactNode;
  adminContentieuxContent?: React.ReactNode;
  adminPathsContent?: React.ReactNode;
  adminDashboardContent?: React.ReactNode;
  adminTagHistoryContent?: React.ReactNode;
  adminUpdateContent?: React.ReactNode;
  /** Currently active contentieux (used as default) */
  activeContentieuxId?: ContentieuxId;
  /** Called when user switches contentieux tab in settings */
  onContentieuxChange?: (contentieuxId: ContentieuxId) => void;
}

// ──────────────────────────────────────────────
// TAB DEFINITIONS
// ──────────────────────────────────────────────

interface TabDef {
  id: SettingsTab;
  label: string;
  icon: React.ElementType;
  isAdmin?: boolean;
  isSeparator?: boolean;
}

const TABS: TabDef[] = [
  { id: 'alertes',        label: 'Alertes',       icon: Bell },
  { id: 'tags',           label: 'Tags',          icon: Tags },
  { id: 'sauvegardes',    label: 'Sauvegardes',   icon: Save },
  // Séparateur admin
  { id: 'admin_users',       label: 'Utilisateurs',     icon: Users,         isAdmin: true, isSeparator: true },
  { id: 'admin_contentieux', label: 'Contentieux',      icon: Layers,        isAdmin: true },
  { id: 'admin_paths',       label: 'Chemins réseau',   icon: Network,       isAdmin: true },
  { id: 'admin_dashboard',   label: 'Tableau de bord',  icon: Activity,      isAdmin: true },
  { id: 'admin_tag_history', label: 'Historique tags',   icon: ClipboardList, isAdmin: true },
  { id: 'admin_update',      label: 'Mise à jour',      icon: Upload,        isAdmin: true },
];

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
  adminUsersContent,
  adminContentieuxContent,
  adminPathsContent,
  adminDashboardContent,
  adminTagHistoryContent,
  adminUpdateContent,
  activeContentieuxId,
  onContentieuxChange,
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('alertes');
  const { isAdmin: checkIsAdmin, accessibleContentieux } = useUser();
  const userIsAdmin = checkIsAdmin();

  // Contentieux sélectionné dans les paramètres (indépendant du contentieux actif)
  const [selectedCtx, setSelectedCtx] = useState<ContentieuxId>(
    activeContentieuxId || accessibleContentieux[0]?.id || 'crimorg'
  );

  if (!isOpen) return null;

  const visibleTabs = TABS.filter(t => !t.isAdmin || userIsAdmin);

  const renderContent = () => {
    switch (activeTab) {
      case 'alertes':
        return alertesContent;
      case 'tags':
        return tagsContent;
      case 'sauvegardes':
        return sauvegardesContent;
      case 'admin_users':
        return adminUsersContent;
      case 'admin_contentieux':
        return adminContentieuxContent;
      case 'admin_paths':
        return adminPathsContent;
      case 'admin_dashboard':
        return adminDashboardContent;
      case 'admin_tag_history':
        return adminTagHistoryContent;
      case 'admin_update':
        return adminUpdateContent;
      default:
        return null;
    }
  };

  // Onglets contentieux (horizontal en haut)
  const showContentieuxTabs = accessibleContentieux.length > 1 && !activeTab.startsWith('admin_');

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
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <React.Fragment key={tab.id}>
                  {/* Séparateur admin */}
                  {tab.isSeparator && (
                    <div className="mx-3 my-2 border-t border-gray-300">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-2 px-3">
                        Administration
                      </span>
                    </div>
                  )}
                  <button
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
                  </button>
                </React.Fragment>
              );
            })}
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
