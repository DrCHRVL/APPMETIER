import { Bell, Search, Save, RefreshCw, Download, Scale } from 'lucide-react';
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Alert } from '@/types/interfaces';
import { AlertBadge } from './AlertBadge';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useEffect, useMemo, useRef } from 'react';

import { DataSyncIndicator } from './sync/DataSyncIndicator';
import { NetworkStatusIndicator } from './NetworkStatusIndicator';
import { SyncStatus } from '@/types/dataSyncTypes';

interface HeaderProps {
  searchTerm: string;
  onSearch: (term: string) => void;
  alerts: Alert[];
  onShowAlerts: () => void;
  unseenAlertCount?: number;   // « nouveautés » : alertes actives jamais vues
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
  onShowUpdate?: () => void;
  isUpdating?: boolean;
  remoteSha?: string | null;
  approvedSha?: string | null;
  /** Mode épuré (profil JLD) : masque la recherche et les actions (sauvegarde, sync, alertes). */
  minimal?: boolean;
  /** Attaché de justice IA — fourni UNIQUEMENT en session admin quand la fonctionnalité est active. */
  onShowAttache?: () => void;
}

export const Header = ({
  searchTerm,
  onSearch,
  alerts,
  onShowAlerts,
  unseenAlertCount = 0,
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
  onShowUpdate,
  isUpdating = false,
  remoteSha = null,
  approvedSha = null,
  minimal = false,
  onShowAttache,
}: HeaderProps) => {
  // L'icône est visible :
  //  - pour l'admin : dès qu'une MAJ existe
  //  - pour les autres : seulement si l'admin a publié exactement cette version (remoteSha === approvedSha)
  const showUpdateIcon =
    (updateAvailable || isUpdating) && (
      isAdmin || (remoteSha != null && approvedSha != null && remoteSha === approvedSha)
    );
  const activeAlerts = useMemo(() =>
    alerts.filter(alert => alert.status === 'active'),
    [alerts]
  );

  // Raccourci clavier : Ctrl/Cmd+K (ou « / ») focalise la recherche. La recherche
  // est l'action la plus fréquente ; elle n'exige plus la souris.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (minimal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === '/' && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [minimal]);

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

  // Profil JLD : en-tête épuré, sans recherche ni actions. On conserve le
  // seul indicateur d'état réseau, utile en consultation.
  if (minimal) {
    return (
      <header
        className="bg-white p-3 px-5"
        style={{
          borderBottom: '1px solid hsl(214 25% 88%)',
          boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-gray-700">Tableau de bord</span>
          <NetworkStatusIndicator />
        </div>
      </header>
    );
  }

  return (
    <header
      className="bg-white p-3 px-5"
      style={{
        borderBottom: '1px solid hsl(214 25% 88%)',
        boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-5 flex-1 min-w-0 sm:flex-none">
          {/* Barre de recherche pill */}
          <div className="relative flex-1 min-w-0 sm:flex-none">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Rechercher…  (Ctrl+K)"
              className="h-9 w-full sm:w-64 pl-9 pr-8 rounded-full border border-gray-200 bg-gray-50 text-sm
                focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400
                focus:bg-white transition-all duration-150 placeholder:text-gray-400"
              value={searchTerm}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchTerm) {
                  e.preventDefault();
                  onSearch('');
                }
              }}
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
        </div>

        <div className="flex items-center gap-1">
          {/* Pastille d'état : enregistré / synchro / hors-ligne (discrète, lisible) */}
          <span
            className={`hidden sm:flex items-center gap-1.5 mr-1 px-2.5 py-1 rounded-full text-[11px] font-medium select-none transition-colors ${
              isSaving || isSyncing
                ? 'bg-blue-50 text-blue-600'
                : syncStatus && !syncStatus.isOnline
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-gray-50 text-gray-400'
            }`}
            title={syncStatus?.lastSuccessfulSync
              ? `Dernière synchronisation : ${new Date(syncStatus.lastSuccessfulSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
              : undefined}
          >
            {isSaving || isSyncing ? (
              <><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />Synchronisation…</>
            ) : syncStatus && !syncStatus.isOnline ? (
              <><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Hors-ligne — travail local</>
            ) : (
              <>✓ Enregistré</>
            )}
          </span>

          {/* État de la cible de synchro : partage P:\ (bureau) ou serveur SIRAL (web) */}
          <NetworkStatusIndicator />

          {/* Attaché de justice IA — admin uniquement, fonctionnalité activée */}
          {onShowAttache && (
            <TooltipProvider>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative h-8 w-8 p-0 rounded-lg text-gray-500 hover:text-[#2B5746] hover:bg-emerald-50"
                    onClick={onShowAttache}
                  >
                    <Scale className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Attaché de justice (IA)</p>
                </TooltipContent>
              </TooltipRoot>
            </TooltipProvider>
          )}

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

          {/* Mise à jour disponible — visible pour tous si l'admin a publié la MAJ */}
          {showUpdateIcon && onShowUpdate && (
            <TooltipProvider>
              <TooltipRoot>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative h-8 px-2 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 flex items-center gap-1.5"
                    onClick={onShowUpdate}
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
                  <p>{isUpdating ? 'Application de la mise à jour...' : `${updateCommits} nouvelle${updateCommits > 1 ? 's' : ''} version${updateCommits > 1 ? 's' : ''} disponible${updateCommits > 1 ? 's' : ''}. Cliquer pour voir le détail.`}</p>
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
              {/* Badge = nouveautés (alertes jamais vues). 0 → pas de pastille
                  chiffrée : la cloche reste accessible sans « crier ». */}
              {unseenAlertCount > 0 && <AlertBadge count={unseenAlertCount} size="sm" />}
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
