'use client';

import React, { useState } from 'react';
import { X, Bell, Tags, Save, Shield, Users, Layers, Globe, Settings } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

type SettingsTab = 'alertes' | 'tags' | 'sauvegardes' | 'admin_users' | 'admin_tags' | 'admin_services' | 'admin_snapshots';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // On passe les composants enfants qui sont déjà rendus ailleurs
  // Cela permet de réutiliser les pages existantes telles quelles
  alertesContent: React.ReactNode;
  tagsContent: React.ReactNode;
  sauvegardesContent: React.ReactNode;
  adminContent?: React.ReactNode;
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
  { id: 'alertes',        label: 'Alertes',           icon: Bell },
  { id: 'tags',           label: 'Tags',              icon: Tags },
  { id: 'sauvegardes',    label: 'Sauvegardes',       icon: Save },
  // Séparateur admin
  { id: 'admin_users',    label: 'Utilisateurs',      icon: Users,  isAdmin: true, isSeparator: true },
  { id: 'admin_tags',     label: 'Tags communs',      icon: Globe,  isAdmin: true },
  { id: 'admin_services', label: 'Orga. services',    icon: Layers, isAdmin: true },
  { id: 'admin_snapshots',label: 'Snapshots',         icon: Shield, isAdmin: true },
];

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const SettingsModal = ({
  isOpen,
  onClose,
  alertesContent,
  tagsContent,
  sauvegardesContent,
  adminContent,
}: SettingsModalProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('alertes');
  const { isAdmin: checkIsAdmin } = useUser();
  const userIsAdmin = checkIsAdmin();

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
      case 'admin_tags':
      case 'admin_services':
      case 'admin_snapshots':
        return adminContent || (
          <div className="flex items-center justify-center h-64 text-gray-400">
            Module d'administration — à implémenter
          </div>
        );
      default:
        return null;
    }
  };

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

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs sidebar */}
          <div className="w-52 border-r border-gray-200 py-3 flex flex-col bg-gray-50">
            {visibleTabs.map((tab, idx) => {
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

