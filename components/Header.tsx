import { Bell, Search, Save, RefreshCw, Download } from 'lucide-react';
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Alert } from '@/types/interfaces';
import { AlertBadge } from './AlertBadge';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useMemo } from 'react';

import { DataSyncIndicator } from './sync/DataSyncIndicator';
import { SyncStatus } from '@/types/dataSyncTypes';

interface HeaderProps {
  searchTerm: string;
  onSearch: (term: string) => void;
  alerts: Alert[];
  onShowAlerts: () => void;
  onSave: () => void;
  isSaving: boolean;
  lastSaveDate?: string;
  syncStatus?: SyncStatus | null;
  onSync?: () => void;
  isSyncing?: boolean;
  isSearchingDocs?: boolean;
  isAdmin?: boolean;
  updateAvailable?: boolean;
  updateCommits?: number;
  onApplyUpdate?: () => void;
  isUpdating?: boolean;
}

export const Header = ({
  searchTerm,
  onSearch,
  alerts,
  onShowAlerts,
  onSave,
  isSaving,
  lastSaveDate,
  syncStatus,
  onSync,
  isSyncing,
  isSearchingDocs = false,
  isAdmin = false,
  updateAvailable = false,
  updateCommits = 0,
  onApplyUpdate,
  isUpdating = false,
}: HeaderProps) => {
  const activeAlerts = useMemo(() =>
    alerts.filter(alert => alert.status === 'active'),
    [alerts]
  );

  const lastSaveText = useMemo(() => {
    if (!lastSaveDate) return "Aucune sauvegarde locale";
    try {
      const date = new Date(lastSaveDate);
      if (isNaN(date.getTime())) return "Date invalide";
      return `Sauvegarde locale ${formatDistanceToNow(date, {
        addSuffix: true,
        locale: fr
      })}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return "Erreur de date";
    }
  }, [lastSaveDate]);

  return (
    <header
      className="bg-white p-3 px-5"
      style={{
        borderBottom: '1px solid hsl(214 25% 88%)',
        boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          {/* Barre de recherche pill */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="search"
              placeholder="Rechercher..."
              className="h-9 w-64 pl-9 pr-8 rounded-full border border-gray-200 bg-gray-50 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400
                focus:bg-white transition-all duration-150 placeholder:text-gray-400"
              value={searchTerm}
              onChange={(e) => onSearch(e.target.value)}
            />
            {/* Indicateur discret de scan des documents */}
            {isSearchingDocs && (
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
                title="Recherche dans les documents..."
              />
            )}
          </div>

          {/* Titre */}
          <h1 className="text-base font-semibold tracking-tight" style={{ color: 'hsl(155 35% 24%)' }}>
            Suivi des enquêtes
          </h1>
        </div>

        <div className="flex items-center gap-1">
          {/* Sauvegarde locale */}
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative h-8 w-8 p-0 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                  onClick={onSave}
                  disabled={isSaving}
                >
                  <Save className={`h-4 w-4 ${isSaving ? 'animate-bounce text-emerald-500' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{lastSaveText}</p>
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>

          {/* Indicateur de synchronisation */}
          {onSync && (
            <DataSyncIndicator
              syncStatus={syncStatus || null}
              onClick={onSync}
              showDetails={false}
            />
          )}

          {/* Mise à jour disponible (admin uniquement) */}
          {isAdmin && (updateAvailable || isUpdating) && onApplyUpdate && (
            <TooltipProvider>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative h-8 px-2 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 flex items-center gap-1.5"
                    onClick={onApplyUpdate}
                    disabled={isUpdating}
                  >
                    {isUpdating
                      ? <RefreshCw className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />
                    }
                    <span className="text-xs font-medium">
                      {isUpdating ? 'Mise à jour...' : `Mettre à jour${updateCommits > 0 ? ` (${updateCommits})` : ''}`}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{isUpdating ? 'Application de la mise à jour...' : `${updateCommits} nouvelle${updateCommits > 1 ? 's' : ''} version${updateCommits > 1 ? 's' : ''} disponible${updateCommits > 1 ? 's' : ''}. Cliquer pour mettre à jour et redémarrer.`}</p>
                </TooltipContent>
              </TooltipRoot>
            </TooltipProvider>
          )}

          {/* Alertes */}
          {activeAlerts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="relative h-8 w-8 p-0 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              onClick={onShowAlerts}
            >
              <Bell className="h-4 w-4" />
              <AlertBadge count={activeAlerts.length} size="sm" />
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
