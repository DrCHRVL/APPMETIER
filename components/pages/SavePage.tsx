// components/pages/SavePage.tsx
import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Download, Upload, Save, RotateCcw, Clock, Shield, AlertTriangle, CheckCircle, FileText, Wrench, HardDriveDownload, Lock } from 'lucide-react';
import { backupManager } from '@/utils/backupManager';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationDialog } from '../ui/confirmation-dialog';
import { DesktopImportPanel } from '../DesktopImportPanel';

interface BackupStats {
  totalBackups: number;
  latestBackup: string | null;
  totalSize: string;
  dataTypes: string[];
  dataJsonInfo?: {
    exists: boolean;
    size: string;
    lastModified?: string;
  };
  comparison?: {
    sizeDifference: string;
    percentage: number;
  };
}

interface SavePageProps {
  lastSaveDate?: string;
  /** Contentieux actuellement actif : les outils de récupération agissent dessus. */
  contentieuxLabel?: string;
  onRepairServer?: () => Promise<boolean>;
  onRestoreFromServerBackup?: (filename: string) => Promise<boolean>;
  onListServerBackups?: () => Promise<string[]>;
  isSyncing?: boolean;
  syncStatus?: { isOnline: boolean } | null;
}

export const SavePage = ({ lastSaveDate, contentieuxLabel, onRepairServer, onRestoreFromServerBackup, onListServerBackups, isSyncing, syncStatus }: SavePageProps) => {
  const [backups, setBackups] = useState<string[]>([]);
  const [backupStats, setBackupStats] = useState<BackupStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [operations, setOperations] = useState({
    creating: false,
    exporting: false,
    checking: false,
    restoring: false,
    copyingDataJson: false,
    restoringServerBackup: false
  });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showRepairConfirm, setShowRepairConfirm] = useState(false);
  const [showServerRestoreConfirm, setShowServerRestoreConfirm] = useState(false);
  // Outils techniques de récupération : repliés dans « Paramètres avancés ».
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState('');
  const [selectedServerBackup, setSelectedServerBackup] = useState('');
  const [serverBackups, setServerBackups] = useState<string[]>([]);
  const [isLoadingServerBackups, setIsLoadingServerBackups] = useState(false);

  // Backups admin (admin/backups/) : per-user prefs + per-contentieux alerts
  // + autres fichiers globaux (tag-data, audience-data, etc.).
  type AdminBackup = {
    filename: string;
    kind: 'user-preferences' | 'contentieux-alerts' | 'tag-data' | 'audience-data' | 'alerts-data' | 'deleted-ids';
    identifier: string | null;
    rawTimestamp: string;
  };
  const [adminBackups, setAdminBackups] = useState<AdminBackup[]>([]);
  const [isLoadingAdminBackups, setIsLoadingAdminBackups] = useState(false);
  const [showAdminRestoreConfirm, setShowAdminRestoreConfirm] = useState(false);
  const [selectedAdminBackup, setSelectedAdminBackup] = useState<AdminBackup | null>(null);
  const [isRestoringAdmin, setIsRestoringAdmin] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState<'unknown' | 'good' | 'warning' | 'error'>('unknown');
  // Import depuis un fichier d'export : contenu lu + aperçu, confirmé avant écrasement
  const [pendingImport, setPendingImport] = useState<{ name: string; content: string; keys: string[] } | null>(null);
  const [isImportingFile, setIsImportingFile] = useState(false);
  // Snapshot complet serveur (web) : sauvegarde ponctuelle de tout le local
  const [serverSnapshotInfo, setServerSnapshotInfo] = useState<{ exists: boolean; savedAt?: string | null } | null>(null);
  const [snapshotVersions, setSnapshotVersions] = useState<string[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [pendingSnapshotRestore, setPendingSnapshotRestore] = useState<{ filename: string | null; label: string } | null>(null);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);
  const { showToast } = useToast();

  // Édition web : E2EE actif, data.json ≙ cache navigateur, import bureau disponible
  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

  // Charger les informations au démarrage
  useEffect(() => {
    loadBackupInfo();
  }, []);

  const loadBackupInfo = async () => {
    setIsLoading(true);
    try {
      const [backupList, stats] = await Promise.all([
        backupManager.listBackups(),
        backupManager.getBackupStats()
      ]);
      
      setBackups(backupList);
      setBackupStats(stats);
      console.log('📊 Backup stats loaded:', stats);
    } catch (error) {
      console.error('❌ Error loading backup info:', error);
      showToast('Erreur lors du chargement des informations de sauvegarde', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // 🆕 SAUVEGARDE MAINTENANT (remplace la sauvegarde manuelle)
  const handleCreateBackupNow = async () => {
    setOperations(prev => ({ ...prev, creating: true }));
    try {
      const success = await backupManager.createBackup();
      
      if (success) {
        await loadBackupInfo(); // Rafraîchir les infos
        showToast('✅ Sauvegarde créée avec succès', 'success');
      } else {
        showToast('⚠️ La sauvegarde n\'était pas nécessaire (sauvegarde récente déjà présente)', 'info');
      }
    } catch (error) {
      console.error('❌ Error creating backup:', error);
      showToast('Erreur lors de la création de la sauvegarde', 'error');
    } finally {
      setOperations(prev => ({ ...prev, creating: false }));
    }
  };

  // 🆕 COPIE DIRECTE DE DATA.JSON
  const handleCopyDataJson = async () => {
    setOperations(prev => ({ ...prev, copyingDataJson: true }));
    try {
      const success = await backupManager.copyDataJsonToBackups();
      
      if (success) {
        await loadBackupInfo(); // Rafraîchir les infos
        showToast('✅ Copie directe de data.json réussie', 'success');
      } else {
        showToast('❌ Échec de la copie de data.json', 'error');
      }
    } catch (error) {
      console.error('❌ Error copying data.json:', error);
      showToast('Erreur lors de la copie de data.json', 'error');
    } finally {
      setOperations(prev => ({ ...prev, copyingDataJson: false }));
    }
  };
  const handleSecurityExport = async () => {
    setOperations(prev => ({ ...prev, exporting: true }));
    try {
      const success = await backupManager.exportToFile();

      if (success) {
        showToast('✅ Export complet réussi (tout sauf les documents d\'enquête)', 'success');
      } else {
        showToast('❌ Échec de l\'export complet', 'error');
      }
    } catch (error) {
      console.error('❌ Error during security export:', error);
      showToast('Erreur lors de l\'export de sécurité', 'error');
    } finally {
      setOperations(prev => ({ ...prev, exporting: false }));
    }
  };

  // 🆕 VÉRIFICATION D'INTÉGRITÉ AMÉLIORÉE
  const handleIntegrityCheck = async () => {
    setOperations(prev => ({ ...prev, checking: true }));
    setIntegrityStatus('unknown');
    
    try {
      const isIntact = await backupManager.checkDataIntegrity();
      
      if (isIntact) {
        setIntegrityStatus('good');
        showToast('✅ Intégrité des données confirmée', 'success');
      } else {
        setIntegrityStatus('error');
        showToast('⚠️ Problèmes d\'intégrité détectés ! Restauration recommandée', 'error');
      }
    } catch (error) {
      console.error('❌ Error checking integrity:', error);
      setIntegrityStatus('error');
      showToast('❌ Erreur lors de la vérification d\'intégrité', 'error');
    } finally {
      setOperations(prev => ({ ...prev, checking: false }));
    }
  };

  // 🆕 RESTAURATION SÉCURISÉE
  const handleSecureRestore = async () => {
    setOperations(prev => ({ ...prev, restoring: true }));
    
    try {
      // 1. Créer une sauvegarde avant restauration
      console.log('🔄 Creating safety backup before restore...');
      await backupManager.createBackup();
      
      // 2. Effectuer la restauration
      console.log('🔄 Restoring from backup:', selectedBackup);
      const success = await backupManager.restoreFromBackup(selectedBackup);
      
      if (success) {
        showToast('✅ Restauration réussie. Rechargement...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast('❌ Échec de la restauration', 'error');
      }
    } catch (error) {
      console.error('❌ Error during secure restore:', error);
      showToast('❌ Erreur lors de la restauration sécurisée', 'error');
    } finally {
      setOperations(prev => ({ ...prev, restoring: false }));
      setShowConfirmDialog(false);
    }
  };

  // 🆕 IMPORT DEPUIS FICHIER — lecture + validation, puis confirmation avant écrasement
  const handleImportFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const content = await file.text();
        let keys: string[];
        try {
          const parsed = JSON.parse(content);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
          keys = Object.keys(parsed);
        } catch {
          showToast('❌ Fichier invalide ou corrompu (JSON attendu)', 'error');
          return;
        }
        setPendingImport({ name: file.name, content, keys });
      } catch (error) {
        console.error('❌ Error reading file:', error);
        showToast('❌ Erreur lors de la lecture du fichier', 'error');
      }
    };
    input.click();
  };

  const handleConfirmImportFromFile = async () => {
    if (!pendingImport) return;
    setIsImportingFile(true);
    try {
      const result = await backupManager.importFromFile(pendingImport.content);
      if (result.success) {
        showToast(`✅ ${result.restoredKeys.length} type(s) de données importé(s). Rechargement...`, 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast(`❌ Import refusé : ${result.error || 'erreur inconnue'}`, 'error');
      }
    } catch (error) {
      console.error('❌ Error during import process:', error);
      showToast('❌ Erreur lors du processus d\'import', 'error');
    } finally {
      setIsImportingFile(false);
      setPendingImport(null);
    }
  };

  // ── Snapshot complet sur le serveur (web) ──
  const loadServerSnapshots = async () => {
    setIsLoadingSnapshots(true);
    try {
      const [info, versions] = await Promise.all([
        backupManager.getServerSnapshotInfo(),
        backupManager.listServerSnapshots(),
      ]);
      setServerSnapshotInfo(info);
      setSnapshotVersions(versions);
    } catch (error) {
      console.error('Erreur chargement snapshots serveur:', error);
    } finally {
      setIsLoadingSnapshots(false);
    }
  };

  const handleCreateServerSnapshot = async () => {
    setIsCreatingSnapshot(true);
    try {
      const ok = await backupManager.createServerSnapshot();
      if (ok) {
        showToast('✅ Snapshot complet envoyé sur le serveur', 'success');
        await loadServerSnapshots();
      } else {
        showToast('❌ Échec de l\'envoi du snapshot — vérifiez la connexion', 'error');
      }
    } catch (error) {
      console.error('❌ Error creating server snapshot:', error);
      showToast('❌ Erreur lors de la création du snapshot serveur', 'error');
    } finally {
      setIsCreatingSnapshot(false);
    }
  };

  const handleRestoreServerSnapshot = async () => {
    if (!pendingSnapshotRestore) return;
    setIsRestoringSnapshot(true);
    try {
      const res = await backupManager.restoreServerSnapshot(pendingSnapshotRestore.filename);
      if (res.success) {
        showToast(`✅ ${res.restoredKeys.length} type(s) de données restauré(s). Rechargement...`, 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast(`❌ Restauration refusée : ${res.error || 'erreur inconnue'}`, 'error');
      }
    } catch (error) {
      console.error('❌ Error restoring server snapshot:', error);
      showToast('❌ Erreur lors de la restauration du snapshot', 'error');
    } finally {
      setIsRestoringSnapshot(false);
      setPendingSnapshotRestore(null);
    }
  };

  // Affiche un nom de version serveur (« 2026-06-15T09_25_02.123Z~user.json ») lisiblement.
  const formatSnapshotVersion = (filename: string) => {
    try {
      const stamp = filename.split('~')[0];
      const iso = stamp.replace(/T(\d{2})_(\d{2})_(\d{2})/, 'T$1:$2:$3');
      const d = new Date(iso);
      const who = filename.includes('~') ? ' — ' + filename.split('~')[1].replace(/\.json$/, '') : '';
      return isNaN(d.getTime())
        ? filename
        : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + who;
    } catch {
      return filename;
    }
  };

  const loadServerBackups = async () => {
    if (!onListServerBackups) return;
    setIsLoadingServerBackups(true);
    try {
      const list = await onListServerBackups();
      setServerBackups(list);
    } catch (error) {
      console.error('Erreur chargement backups serveur:', error);
    } finally {
      setIsLoadingServerBackups(false);
    }
  };

  const handleRestoreFromServerBackup = async () => {
    setShowServerRestoreConfirm(false);
    if (!onRestoreFromServerBackup || !selectedServerBackup) return;
    setOperations(prev => ({ ...prev, restoringServerBackup: true }));
    try {
      const success = await onRestoreFromServerBackup(selectedServerBackup);
      if (success) {
        showToast('✅ Données restaurées depuis le backup serveur. Rechargement...', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast('❌ Échec de la restauration — vérifiez l\'accès au serveur', 'error');
      }
    } catch (error) {
      showToast('❌ Erreur lors de la restauration depuis le backup serveur', 'error');
    } finally {
      setOperations(prev => ({ ...prev, restoringServerBackup: false }));
    }
  };

  const loadAdminBackups = async () => {
    if (!window.electronAPI?.dataSync_listAdminBackups) return;
    setIsLoadingAdminBackups(true);
    try {
      const list = await window.electronAPI.dataSync_listAdminBackups();
      setAdminBackups(list);
    } catch (error) {
      console.error('Erreur chargement admin backups:', error);
    } finally {
      setIsLoadingAdminBackups(false);
    }
  };

  const handleRestoreAdminBackup = async () => {
    setShowAdminRestoreConfirm(false);
    if (!window.electronAPI?.dataSync_restoreAdminBackup || !selectedAdminBackup) return;
    setIsRestoringAdmin(true);
    try {
      const ok = await window.electronAPI.dataSync_restoreAdminBackup(selectedAdminBackup.filename);
      if (ok) {
        showToast('✅ Backup restauré. Rechargement…', 'success');
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showToast('❌ Échec de la restauration du backup admin', 'error');
      }
    } catch (error) {
      showToast('❌ Erreur lors de la restauration', 'error');
    } finally {
      setIsRestoringAdmin(false);
    }
  };

  const handleRepairServer = async () => {
    setShowRepairConfirm(false);
    if (!onRepairServer) return;
    try {
      const success = await onRepairServer();
      if (success) {
        showToast('✅ Serveur réparé avec vos données locales', 'success');
      } else {
        showToast('❌ Échec de la réparation — vérifiez l\'accès au serveur', 'error');
      }
    } catch (error) {
      showToast('❌ Erreur lors de la réparation du serveur', 'error');
    }
  };

  const formatDateTime = (dateTimeStr: string) => {
    try {
      let date: Date;
      
      if (dateTimeStr.endsWith('.json')) {
        const dateStr = dateTimeStr.replace('backup_', '').replace('.json', '');
        if (dateStr.includes('T')) {
          const [datePart, timePart] = dateStr.split('T');
          const timeWithColons = timePart.split('.')[0].replace(/-/g, ':');
          date = new Date(`${datePart}T${timeWithColons}`);
        } else {
          return dateStr;
        }
      } else {
        date = new Date(dateTimeStr.replace('backup_', ''));
      }
      
      return date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateTimeStr.replace('backup_', '').replace('.json', '');
    }
  };

  const getIntegrityIcon = () => {
    switch (integrityStatus) {
      case 'good': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error': return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      default: return <Shield className="h-5 w-5 text-gray-400" />;
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Sauvegardes & Sécurité</h2>
        {getIntegrityIcon()}
      </div>
      
      {/* 📊 STATUT DES SAUVEGARDES */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Shield className="h-5 w-5 mr-2 text-blue-600" />
            Statut de la protection des données
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-gray-500">Chargement des statistiques...</p>
          ) : backupStats ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="font-medium text-gray-700">Sauvegardes</p>
                  <p className="text-xl font-bold text-blue-600">{backupStats.totalBackups}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Données sauvegardées</p>
                  <p className="text-xl font-bold text-blue-600">{backupStats.totalSize}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Types de données</p>
                  <p className="text-xl font-bold text-blue-600">{backupStats.dataTypes.length}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Dernière sauvegarde</p>
                  <p className="text-sm text-blue-600">{backupStats.latestBackup || 'Aucune'}</p>
                </div>
              </div>
              
              {/* 🆕 COMPARAISON DATA.JSON */}
              {backupStats.dataJsonInfo && (
                <div className="border-t pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="font-medium text-gray-700">{isWeb ? 'Données locales (navigateur)' : 'data.json'}</p>
                      <p className="text-lg font-bold text-green-600">
                        {backupStats.dataJsonInfo.exists ? backupStats.dataJsonInfo.size : 'Non trouvé'}
                      </p>
                    </div>
                    {backupStats.comparison && (
                      <>
                        <div>
                          <p className="font-medium text-gray-700">Différence</p>
                          <p className={`text-lg font-bold ${
                            backupStats.comparison.percentage > 10 ? 'text-red-600' : 
                            backupStats.comparison.percentage > 0 ? 'text-yellow-600' : 'text-green-600'
                          }`}>
                            {backupStats.comparison.sizeDifference}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium text-gray-700">% de différence</p>
                          <p className={`text-lg font-bold ${
                            backupStats.comparison.percentage > 10 ? 'text-red-600' : 
                            backupStats.comparison.percentage > 0 ? 'text-yellow-600' : 'text-green-600'
                          }`}>
                            {backupStats.comparison.percentage}%
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                  {backupStats.comparison && backupStats.comparison.percentage > 10 && (
                    <div className="mt-2 p-2 bg-blue-50 rounded text-sm text-blue-700">
                      ℹ️ data.json contient également des données système (UI, paramètres Electron) non incluses dans la sauvegarde sélective — c'est normal.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-red-500">Erreur lors du chargement des statistiques</p>
          )}
        </CardContent>
      </Card>

      {/* 🔧 ACTIONS PRINCIPALES */}
      <Card>
        <CardHeader>
          <CardTitle>Actions de sauvegarde</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`grid grid-cols-1 ${isWeb ? 'md:grid-cols-3' : 'md:grid-cols-4'} gap-4`}>
            <Button
              onClick={handleCreateBackupNow}
              disabled={operations.creating}
              className="h-20 flex flex-col"
            >
              <Save className="h-6 w-6 mb-2" />
              {operations.creating ? 'Création...' : 'Créer sauvegarde'}
              <span className="text-xs opacity-75">Sélective</span>
            </Button>

            {/* « Copier data.json » : version bureau uniquement (sans objet en web). */}
            {!isWeb && (
            <Button
              onClick={handleCopyDataJson}
              disabled={operations.copyingDataJson}
              className="h-20 flex flex-col bg-green-600 hover:bg-green-700"
            >
              <FileText className="h-6 w-6 mb-2" />
              {operations.copyingDataJson ? 'Copie...' : 'Copier data.json'}
              <span className="text-xs opacity-75">Complète</span>
            </Button>
            )}

            <Button
              onClick={handleSecurityExport} 
              variant="outline"
              disabled={operations.exporting}
              className="h-20 flex flex-col"
            >
              <Download className="h-6 w-6 mb-2" />
              {operations.exporting ? 'Export...' : 'Export complet'}
              <span className="text-xs opacity-75">Tout sauf documents</span>
            </Button>
            
            <Button 
              onClick={handleIntegrityCheck} 
              variant="outline"
              disabled={operations.checking}
              className="h-20 flex flex-col"
            >
              <Shield className="h-6 w-6 mb-2" />
              {operations.checking ? 'Vérification...' : 'Vérifier intégrité'}
              <span className="text-xs opacity-75">Diagnostic</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 🖥️→☁️ IMPORT DEPUIS L'APP BUREAU (édition web uniquement) */}
      {isWeb && <DesktopImportPanel />}

      {/* 📂 SAUVEGARDES DISPONIBLES */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des sauvegardes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-gray-500">Chargement...</p>
          ) : backups.length === 0 ? (
            <div className="p-4 bg-yellow-50 rounded-md flex items-center">
              <AlertTriangle className="h-5 w-5 text-yellow-500 mr-2" />
              <p className="text-yellow-700">Aucune sauvegarde trouvée. Créez-en une maintenant !</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {backups.slice(0, 10).map(backup => (
                <div key={backup} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors">
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 text-gray-400 mr-3" />
                    <div>
                      <p className="font-medium text-gray-900">{formatDateTime(backup)}</p>
                      <p className="text-xs text-gray-500">
                        {backup.endsWith('.json') ? 'Fichier de sauvegarde' : 'Sauvegarde interne'}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setSelectedBackup(backup);
                      setShowConfirmDialog(true);
                    }}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  >
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Restaurer
                  </Button>
                </div>
              ))}
              {backups.length > 10 && (
                <p className="text-center text-gray-500 text-sm pt-2">
                  ... et {backups.length - 10} sauvegardes plus anciennes
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ☁️ SAUVEGARDE COMPLÈTE SUR LE SERVEUR (web) */}
      {isWeb && (
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="flex items-center text-emerald-700">
              <HardDriveDownload className="h-5 w-5 mr-2" />
              Sauvegarde complète sur le serveur
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-emerald-50 rounded text-sm text-emerald-800">
              Envoie une copie chiffrée de <strong>toutes vos données</strong> (paramètres, préférences,
              cartographie, module instruction, enquêtes, AIR…) dans un coffre personnel sur le serveur.
              Les <strong>documents d'enquête</strong> en sont exclus (déjà stockés à part, chiffrés).
              Chaque envoi <strong>archive automatiquement le précédent</strong> : vous pouvez restaurer
              une version ancienne à tout moment, même depuis un autre poste.
            </div>

            <Button
              onClick={handleCreateServerSnapshot}
              disabled={isCreatingSnapshot || !syncStatus?.isOnline}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Save className="h-4 w-4 mr-2" />
              {isCreatingSnapshot ? 'Envoi en cours...' : 'Créer un snapshot complet sur le serveur'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={loadServerSnapshots}
              disabled={isLoadingSnapshots}
            >
              {isLoadingSnapshots ? 'Chargement...' : serverSnapshotInfo ? 'Rafraîchir la liste' : 'Voir les snapshots disponibles'}
            </Button>

            {serverSnapshotInfo && (
              <div className="space-y-1 max-h-64 overflow-y-auto border rounded divide-y">
                {serverSnapshotInfo.exists && (
                  <div className="px-3 py-2 flex items-center justify-between gap-3 text-sm bg-emerald-50/60">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-800">Snapshot actuel</span>
                      {serverSnapshotInfo.savedAt && (
                        <span className="text-gray-500 ml-2">
                          {new Date(serverSnapshotInfo.savedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-700 border-emerald-300 hover:bg-emerald-100 flex-shrink-0"
                      disabled={isRestoringSnapshot}
                      onClick={() => setPendingSnapshotRestore({ filename: null, label: 'le snapshot actuel' })}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Restaurer
                    </Button>
                  </div>
                )}
                {snapshotVersions.map(filename => (
                  <div key={filename} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-600 min-w-0 truncate">{formatSnapshotVersion(filename)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-shrink-0"
                      disabled={isRestoringSnapshot}
                      onClick={() => setPendingSnapshotRestore({ filename, label: formatSnapshotVersion(filename) })}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      Restaurer
                    </Button>
                  </div>
                ))}
                {!serverSnapshotInfo.exists && snapshotVersions.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    Aucun snapshot sur le serveur pour l'instant — cliquez « Créer un snapshot complet ».
                  </div>
                )}
              </div>
            )}

            {!syncStatus?.isOnline && (
              <p className="text-xs text-gray-500 text-center">Serveur inaccessible — connexion requise</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── PARAMÈTRES AVANCÉS (outils techniques de récupération) ── */}
      <button
        onClick={() => setShowAdvanced(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        <span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-gray-500" /> Paramètres avancés</span>
        <span className="text-gray-400 text-xs">{showAdvanced ? 'Masquer' : 'Afficher'}</span>
      </button>

      {showAdvanced && (
      <div className="space-y-6">

      {/* 🔄 RESTAURATION DEPUIS BACKUP SERVEUR */}
      {onRestoreFromServerBackup && (
        <Card className="border-blue-300">
          <CardHeader>
            <CardTitle className="flex items-center text-blue-700">
              <HardDriveDownload className="h-5 w-5 mr-2" />
              Restauration depuis un backup serveur{contentieuxLabel ? ` — ${contentieuxLabel}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-blue-50 rounded text-sm text-blue-800">
              <p className="font-semibold mb-1">Récupération après écrasement accidentel</p>
              <p>
                Permet de restaurer les données du contentieux <strong>{contentieuxLabel || 'actif'}</strong> depuis
                un fichier backup automatique présent sur le serveur partagé
                (ex&nbsp;: <code className="bg-blue-100 px-1 rounded">{contentieuxLabel || 'crimorg'}-backup-2026-03-09T14-30-00.json</code>).
              </p>
              <p className="mt-1">
                Cette opération <strong>écrase les données locales ET le fichier serveur de ce contentieux</strong> avec
                le contenu du backup sélectionné.
              </p>
            </div>

            {serverBackups.length === 0 ? (
              <Button
                variant="outline"
                onClick={loadServerBackups}
                disabled={isLoadingServerBackups || !syncStatus?.isOnline}
                className="w-full"
              >
                <HardDriveDownload className="h-4 w-4 mr-2" />
                {isLoadingServerBackups ? 'Chargement...' : 'Lister les backups disponibles sur le serveur'}
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">
                    {serverBackups.length} backup(s) trouvé(s) sur le serveur
                  </p>
                  <Button variant="ghost" size="sm" onClick={loadServerBackups} disabled={isLoadingServerBackups}>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Actualiser
                  </Button>
                </div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {serverBackups.map(filename => (
                    <div key={filename} className="flex items-center justify-between p-2 bg-gray-50 rounded border hover:bg-blue-50 transition-colors">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="text-sm font-mono text-gray-700">{filename}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-blue-700 border-blue-300 hover:bg-blue-100 flex-shrink-0"
                        disabled={operations.restoringServerBackup}
                        onClick={() => {
                          setSelectedServerBackup(filename);
                          setShowServerRestoreConfirm(true);
                        }}
                      >
                        <HardDriveDownload className="h-3 w-3 mr-1" />
                        Restaurer
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!syncStatus?.isOnline && (
              <p className="text-xs text-gray-500 text-center">Serveur inaccessible — connexion requise</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 🗂️ BACKUPS ADMIN (préfs utilisateur + alertes par contentieux + globaux) */}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center text-slate-700">
            <HardDriveDownload className="h-5 w-5 mr-2" />
            Sauvegardes serveur (admin/backups/)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">
            Copies horodatées créées automatiquement à chaque écriture des fichiers
            partagés (préférences utilisateur, règles d'alertes par contentieux, tags,
            audiences). 10 versions retenues par fichier.
          </p>
          <Button
            onClick={loadAdminBackups}
            variant="outline"
            size="sm"
            disabled={isLoadingAdminBackups}
          >
            {isLoadingAdminBackups ? 'Chargement…' : adminBackups.length > 0 ? 'Rafraîchir la liste' : 'Charger la liste'}
          </Button>
          {adminBackups.length > 0 && (
            <div className="max-h-96 overflow-y-auto border rounded divide-y">
              {(['user-preferences', 'contentieux-alerts', 'tag-data', 'audience-data', 'alerts-data', 'deleted-ids'] as const).map(kind => {
                const items = adminBackups.filter(b => b.kind === kind);
                if (items.length === 0) return null;
                const kindLabel = {
                  'user-preferences': 'Préférences utilisateur',
                  'contentieux-alerts': 'Alertes par contentieux',
                  'tag-data': 'Tags partagés',
                  'audience-data': 'Audiences partagées',
                  'alerts-data': 'Alertes (legacy)',
                  'deleted-ids': 'Tombstones (suppressions)',
                }[kind];
                return (
                  <div key={kind}>
                    <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 sticky top-0">
                      {kindLabel} ({items.length})
                    </div>
                    {items.map(b => {
                      const iso = b.rawTimestamp.replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
                      const d = new Date(iso);
                      const human = isNaN(d.getTime())
                        ? b.rawTimestamp
                        : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                      return (
                        <div key={b.filename} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            {b.identifier && (
                              <span className="font-medium text-gray-700">{b.identifier}</span>
                            )}
                            <span className="text-gray-500 ml-2">{human}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => { setSelectedAdminBackup(b); setShowAdminRestoreConfirm(true); }}
                            disabled={isRestoringAdmin}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Restaurer
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 🔧 RÉPARATION DU SERVEUR — sans objet en web (le serveur versionne
          automatiquement chaque coffre : la restauration suffit) */}
      {onRepairServer && !isWeb && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="flex items-center text-orange-700">
              <Wrench className="h-5 w-5 mr-2" />
              Réparation du fichier serveur{contentieuxLabel ? ` — ${contentieuxLabel}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-orange-50 rounded text-sm text-orange-800">
              <p className="font-semibold mb-1">⚠️ Réservé à la machine qui possède la version correcte</p>
              <p>
                Si le fichier serveur est corrompu et que <strong>vos données locales sont la bonne version</strong>,
                ce bouton écrase le fichier serveur avec vos données — même si la lecture du serveur échoue.
              </p>
              <p className="mt-1">
                Si c'est votre <strong>collègue</strong> qui a la bonne version, demandez-lui de cliquer ce bouton
                sur <strong>sa machine</strong>.
              </p>
            </div>
            <Button
              onClick={() => setShowRepairConfirm(true)}
              disabled={isSyncing || !syncStatus?.isOnline}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white"
            >
              <Wrench className="h-4 w-4 mr-2" />
              {isSyncing ? 'Réparation en cours...' : 'Réparer le serveur avec mes données locales'}
            </Button>
            {!syncStatus?.isOnline && (
              <p className="text-xs text-gray-500 text-center">Serveur inaccessible — connexion requise</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 📥 IMPORT / EXPORT */}
      <Card>
        <CardHeader>
          <CardTitle>Import depuis fichier externe</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleImportFromFile}
            variant="outline"
            className="w-full"
            disabled={isImportingFile}
          >
            <Upload className="h-4 w-4 mr-2" />
            {isImportingFile ? 'Import en cours…' : 'Importer depuis un fichier de sauvegarde'}
          </Button>
          <p className="text-xs text-gray-500 mt-2">
            Accepte un « Export complet » ou une sauvegarde SIRAL (.json). Le contenu est
            vérifié et affiché avant import, et une sauvegarde de sécurité est créée automatiquement.
          </p>
        </CardContent>
      </Card>

      </div>
      )}

      {/* 🔐 CHIFFREMENT (édition web : E2EE) */}
      {isWeb && (
        <Card className="border-slate-300 bg-slate-50">
          <CardHeader>
            <CardTitle className="flex items-center text-slate-800">
              <Lock className="h-5 w-5 mr-2" />
              Chiffrement de bout en bout — ce que protège SIRAL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-slate-700 space-y-2 list-disc list-inside">
              <li>
                <b>Chiffré dans votre navigateur, jamais sur le serveur</b> : chaque donnée est scellée
                en AES-256-GCM avant l&apos;envoi. Le serveur ne stocke que des enveloppes opaques
                (illisibles même pour l&apos;hébergeur ou un attaquant qui prendrait la machine).
              </li>
              <li>
                <b>Votre phrase personnelle ne quitte pas cet appareil</b> : elle déverrouille votre
                trousseau de clés localement (dérivation PBKDF2-SHA256, 600&nbsp;000 itérations).
                Elle est irrécupérable — conservez le kit de récupération sous enveloppe scellée.
              </li>
              <li>
                <b>Cloisonnement par contentieux</b> : une clé distincte par périmètre (CRIM ORG, ECOFI,
                ENVIRO). Vous ne pouvez déchiffrer que les contentieux auxquels un collègue vous a invité
                (Paramètres → Accès &amp; clés).
              </li>
              <li>
                <b>Historique immuable</b> : chaque écriture archive la version précédente du coffre
                sur le serveur — c&apos;est le premier niveau de sauvegarde, automatique.
              </li>
              <li>
                <b>En cas d&apos;oubli de la phrase</b> : aucune réinitialisation possible, mais un
                administrateur peut vous ré-inviter — l&apos;accès est recréé sans perte de données.
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 📥 DIALOGUE DE CONFIRMATION IMPORT FICHIER */}
      <ConfirmationDialog
        isOpen={pendingImport !== null}
        onClose={() => setPendingImport(null)}
        onConfirm={handleConfirmImportFromFile}
        title="Importer ce fichier de sauvegarde"
        message={pendingImport
          ? `Fichier : ${pendingImport.name}\n\nTypes de données détectés (${pendingImport.keys.length}) :\n${pendingImport.keys.slice(0, 12).join(', ')}${pendingImport.keys.length > 12 ? '…' : ''}\n\n⚠️ Ces données remplaceront les données locales correspondantes. Une sauvegarde de sécurité sera créée avant l'import.`
          : ''}
        confirmLabel={isImportingFile ? 'Import…' : 'Importer'}
        cancelLabel="Annuler"
      />
      {/* 🔄 DIALOGUE DE CONFIRMATION RESTAURATION DEPUIS BACKUP SERVEUR */}
      <ConfirmationDialog
        isOpen={showServerRestoreConfirm}
        onClose={() => setShowServerRestoreConfirm(false)}
        onConfirm={handleRestoreFromServerBackup}
        title="Restauration depuis backup serveur"
        message={`⚠️ Cette action va écraser vos données locales ET le fichier serveur principal avec le contenu du backup :\n\n"${selectedServerBackup}"\n\nÀ effectuer depuis la machine de la personne dont les données ont été perdues.`}
        confirmLabel={operations.restoringServerBackup ? 'Restauration...' : 'Restaurer depuis ce backup'}
        cancelLabel="Annuler"
      />

      {/* ☁️ DIALOGUE DE CONFIRMATION RESTAURATION SNAPSHOT SERVEUR */}
      <ConfirmationDialog
        isOpen={pendingSnapshotRestore !== null}
        onClose={() => setPendingSnapshotRestore(null)}
        onConfirm={handleRestoreServerSnapshot}
        title="Restaurer ce snapshot complet"
        message={pendingSnapshotRestore
          ? `⚠️ Cette action va remplacer vos données locales par ${pendingSnapshotRestore.label}.\n\nVos données locales actuelles seront elles-mêmes sauvegardées (historique local) avant l'écrasement. L'application se rechargera ensuite.`
          : ''}
        confirmLabel={isRestoringSnapshot ? 'Restauration...' : 'Restaurer ce snapshot'}
        cancelLabel="Annuler"
      />

      {/* 🗂️ DIALOGUE DE CONFIRMATION RESTAURATION BACKUP ADMIN */}
      <ConfirmationDialog
        isOpen={showAdminRestoreConfirm}
        onClose={() => setShowAdminRestoreConfirm(false)}
        onConfirm={handleRestoreAdminBackup}
        title="Restaurer ce backup"
        message={selectedAdminBackup
          ? `⚠️ Cette action va écraser le fichier serveur correspondant avec le contenu de ce backup :\n\n${selectedAdminBackup.filename}\n\nL'état actuel sera lui-même sauvegardé dans admin/backups/ avant écrasement.`
          : ''}
        confirmLabel={isRestoringAdmin ? 'Restauration…' : 'Restaurer ce backup'}
        cancelLabel="Annuler"
      />

      {/* 🔧 DIALOGUE DE CONFIRMATION RÉPARATION SERVEUR */}
      <ConfirmationDialog
        isOpen={showRepairConfirm}
        onClose={() => setShowRepairConfirm(false)}
        onConfirm={handleRepairServer}
        title="Réparer le fichier serveur"
        message={`⚠️ Cette action va écraser le fichier serveur avec VOS données locales.\n\nÀ n'effectuer QUE si vos données locales sont la version correcte.\n\nSi la bonne version est sur la machine d'un collègue, demandez-lui de faire la réparation depuis sa machine.`}
        confirmLabel="Écraser le serveur avec mes données"
        cancelLabel="Annuler"
      />

      {/* 🔄 DIALOGUE DE CONFIRMATION */}
      <ConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={handleSecureRestore}
        title="Restauration sécurisée"
        message={`Êtes-vous sûr de vouloir restaurer cette sauvegarde ?\n\n⚠️ Une sauvegarde de sécurité sera créée automatiquement avant la restauration.\n\nSauvegarde sélectionnée : ${formatDateTime(selectedBackup)}`}
        confirmLabel={operations.restoring ? "Restauration..." : "Restaurer"}
        cancelLabel="Annuler"
      />
    </div>
  );
};