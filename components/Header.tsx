import { Bell, Search, Save } from 'lucide-react';
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Alert } from '@/types/interfaces';
import { AlertBadge } from './AlertBadge';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useMemo } from 'react';

// 🆕 Imports pour la synchronisation des données
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
  // 🆕 Props pour la synchronisation des données
  syncStatus?: SyncStatus | null;
  onSync?: () => void;
  isSyncing?: boolean;
}

export const Header = ({ 
  searchTerm, 
  onSearch, 
  alerts, 
  onShowAlerts,
  onSave,
  isSaving,
  lastSaveDate,
  // 🆕 Props de synchronisation
  syncStatus,
  onSync,
  isSyncing
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
    <header className="bg-white shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Rechercher..."
              className="w-64 pl-8"
              value={searchTerm}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
          <h1 className="text-lg font-semibold text-primary">Suivi des enquêtes</h1>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Sauvegarde locale */}
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="relative"
                  onClick={onSave}
                  disabled={isSaving}
                >
                  <Save className={`h-4 w-4 ${isSaving ? 'animate-bounce text-green-500' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{lastSaveText}</p>
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>

          {/* 🆕 Indicateur de synchronisation des données */}
          {onSync && (
            <DataSyncIndicator
              syncStatus={syncStatus || null}
              onClick={onSync}
              showDetails={false}
            />
          )}

          {/* Alertes */}
          {activeAlerts.length > 0 && (
            <Button 
              variant="ghost" 
              className="relative"
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
