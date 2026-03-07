import React from 'react';
import { FileText, Plus, Archive, Timer, Tags, Bell, Save, BarChart, Activity, Scale } from 'lucide-react';

import { Button } from './ui/button';
import { AlertBadge } from './AlertBadge';

interface SideBarProps {
  isOpen: boolean;
  currentView: string;
  onViewChange: (view: string) => void;
  onNewEnquete: () => void;
  alertCount: number;
}

const navItems = [
  { view: 'enquetes', icon: FileText, label: 'Enquêtes préliminaires' },
  { view: 'instructions', icon: Scale, label: 'Instructions judiciaires' },
  { view: 'archives', icon: Archive, label: 'Enquêtes terminées' },
  { view: 'air', icon: Activity, label: 'Suivi AIR' },
  { view: 'tags', icon: Tags, label: 'Tags' },
  { view: 'alertes', icon: Bell, label: 'Alertes' },
  { view: 'statistiques', icon: BarChart, label: 'Statistiques' },
  { view: 'sauvegardes', icon: Save, label: 'Sauvegardes' },
];

export const SideBar = ({
  isOpen,
  currentView,
  onViewChange,
  onNewEnquete,
  alertCount
}: SideBarProps) => {
  const sidebarWidth = isOpen ? 'w-64' : 'w-16';

  return (
    <div
      className={`${sidebarWidth} h-screen shadow-xl transition-all duration-300 flex flex-col relative overflow-hidden`}
      style={{
        background: 'linear-gradient(180deg, #2d5f4a 0%, #1e3d2f 100%)',
      }}
    >
      {/* Subtle top accent line */}
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)' }} />

      <div className="p-3 flex flex-col space-y-0.5 flex-1 pt-4">
        {navItems.map(({ view, icon: Icon, label }) => {
          const isActive = currentView === view;
          const showAlertBadge = view === 'instructions' && alertCount > 0 && isActive;

          return (
            <div key={view} className="relative">
              <button
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium
                  transition-all duration-150 relative group
                  ${isActive
                    ? 'bg-white/15 text-white shadow-sm'
                    : 'text-white/70 hover:bg-white/8 hover:text-white'
                  }
                `}
                style={isActive ? {
                  boxShadow: 'inset 3px 0 0 rgba(255,255,255,0.6), inset 0 1px 0 rgba(255,255,255,0.1)'
                } : {}}
                onClick={() => onViewChange(view)}
              >
                <Icon className={`h-4 w-4 flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white'}`} />
                {isOpen && (
                  <span className="truncate">{label}</span>
                )}
              </button>
              {showAlertBadge && <AlertBadge count={alertCount} />}
            </div>
          );
        })}

        {/* Séparateur */}
        <div className="my-2 border-t border-white/10" />

        {/* Bouton nouvelle enquête */}
        <button
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold
            transition-all duration-150 text-white
            hover:brightness-110 active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%)',
            border: '1px solid rgba(255,255,255,0.2)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
          onClick={onNewEnquete}
        >
          <Plus className="h-4 w-4 flex-shrink-0" />
          {isOpen && (
            <span className="truncate">
              {currentView === 'instructions' ? 'Nouveau dossier' : 'Nouvelle enquête'}
            </span>
          )}
        </button>
      </div>

      <div className="copyright">
        Propriété de Audran CHEVALIER, Parquet d&apos;AMIENS
      </div>
    </div>
  );
};
