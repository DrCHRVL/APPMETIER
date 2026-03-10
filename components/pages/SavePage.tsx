// components/pages/SavePage.tsx
import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Download, Upload, Save, RotateCcw, Clock, Shield, AlertTriangle, CheckCircle, FileText, Wrench, HardDriveDownload } from 'lucide-react';
import { backupManager } from '@/utils/backupManager';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationDialog } from '../ui/confirmation-dialog';

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
  onRepairServer?: () => Promise<boolean>;
  onRestoreFromServerBackup?: (filename: string) => Promise<boolean>;
  onListServerBackups?: () => Promise<string[]>;
  isSyncing?: boolean;
  syncStatus?: { isOnline: boolean } | null;
}

export const SavePage = ({ lastSaveDate, onRepairServer, onRestoreFromServerBackup, onListServerBackups, isSyncing, syncStatus }: SavePageProps) => {
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
  const [selectedBackup, setSelectedBackup] = useState('');
  const [selectedServerBackup, setSelectedServerBackup] = useState('');
  const [serverBackups, setServerBackups] = useState<string[]>([]);
  const [isLoadingServerBackups, setIsLoadingServerBackups] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState<'unknown' | 'good' | 'warning' | 'error'>('unknown');
  const { showToast } = useToast();

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
        showToast('✅ Export de sécurité réussi', 'success');
      } else {
        showToast('❌ Échec de l\'export de sécurité', 'error');
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

  // 🆕 IMPORT DEPUIS FICHIER (remplace l'ancien import)
  const handleImportFromFile = async () => {
    try {
      // 1. Créer une sauvegarde de sécurité avant import
      console.log('🔄 Creating safety backup before import...');
      await backupManager.createBackup();
      
      // 2. Ouvrir le sélecteur de fichier
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        try {
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const importedData = JSON.parse(e.target?.result as string);
              
              // 3. Valider les données importées
              if (!importedData || typeof importedData !== 'object') {
                throw new Error('Format de fichier invalide');
              }
              
              // 4. TODO: Implémenter la restauration depuis les données importées
              // Pour l'instant, afficher un message
              showToast('⚠️ Import de fichier en cours de développement', 'info');
              console.log('📥 Imported data structure:', Object.keys(importedData));
              
            } catch (parseError) {
              console.error('❌ Error parsing imported file:', parseError);
              showToast('❌ Fichier invalide ou corrompu', 'error');
            }
          };
          reader.readAsText(file);
        } catch (error) {
          console.error('❌ Error reading file:', error);
          showToast('❌ Erreur lors de la lecture du fichier', 'error');
        }
      };
      
      input.click();
    } catch (error) {
      console.error('❌ Error during import process:', error);
      showToast('❌ Erreur lors du processus d\'import', 'error');
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
    <div className="p-6 max-w-4xl mx-auto space-y-6">
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
                      <p className="font-medium text-gray-700">data.json</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Button 
              onClick={handleCreateBackupNow} 
              disabled={operations.creating}
              className="h-20 flex flex-col"
            >
              <Save className="h-6 w-6 mb-2" />
              {operations.creating ? 'Création...' : 'Créer sauvegarde'}
              <span className="text-xs opacity-75">Sélective</span>
            </Button>
            
            <Button 
              onClick={handleCopyDataJson} 
              disabled={operations.copyingDataJson}
              className="h-20 flex flex-col bg-green-600 hover:bg-green-700"
            >
              <FileText className="h-6 w-6 mb-2" />
              {operations.copyingDataJson ? 'Copie...' : 'Copier data.json'}
              <span className="text-xs opacity-75">Complète</span>
            </Button>
            
            <Button 
              onClick={handleSecurityExport} 
              variant="outline"
              disabled={operations.exporting}
              className="h-20 flex flex-col"
            >
              <Download className="h-6 w-6 mb-2" />
              {operations.exporting ? 'Export...' : 'Export sélectif'}
              <span className="text-xs opacity-75">Vers fichier</span>
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

      {/* 🔄 RESTAURATION DEPUIS BACKUP SERVEUR */}
      {onRestoreFromServerBackup && (
        <Card className="border-blue-300">
          <CardHeader>
            <CardTitle className="flex items-center text-blue-700">
              <HardDriveDownload className="h-5 w-5 mr-2" />
              Restauration depuis un backup serveur
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 bg-blue-50 rounded text-sm text-blue-800">
              <p className="font-semibold mb-1">Récupération après écrasement accidentel</p>
              <p>
                Permet de restaurer les données depuis un fichier backup automatique présent sur le
                serveur partagé (ex&nbsp;: <code className="bg-blue-100 px-1 rounded">app-data-backup-2026-03-09T14-30-00.json</code>).
              </p>
              <p className="mt-1">
                Cette opération <strong>écrase les données locales ET le fichier serveur principal</strong> avec
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

      {/* 🔧 RÉPARATION DU SERVEUR */}
      {onRepairServer && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="flex items-center text-orange-700">
              <Wrench className="h-5 w-5 mr-2" />
              Réparation du fichier serveur
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
          >
            <Upload className="h-4 w-4 mr-2" />
            Importer depuis un fichier de sauvegarde
          </Button>
          <p className="text-xs text-gray-500 mt-2">
            ⚠️ Une sauvegarde de sécurité sera créée automatiquement avant l'import
          </p>
        </CardContent>
      </Card>
      
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