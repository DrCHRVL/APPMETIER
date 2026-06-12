import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { 
  FolderOpen, 
  AlertTriangle, 
  CheckCircle, 
  Info,
  HardDrive,
  Folder
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface DocumentPathModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  onSave: (path: string, useSubfolder: boolean) => void; // Modifié pour inclure l'option
  enqueteNumero: string;
  currentUseSubfolder?: boolean; // Nouvel prop pour l'état actuel
}

export const DocumentPathModal = ({
  isOpen,
  onClose,
  currentPath,
  onSave,
  enqueteNumero,
  currentUseSubfolder = true // Par défaut, utilise un sous-dossier (comportement actuel)
}: DocumentPathModalProps) => {
  const [selectedPath, setSelectedPath] = useState(currentPath);
  const [useSubfolder, setUseSubfolder] = useState(currentUseSubfolder);
  const [isValidating, setIsValidating] = useState(false);
  const [pathStatus, setPathStatus] = useState<'valid' | 'invalid' | 'unknown'>('unknown');
  const [errorMessage, setErrorMessage] = useState('');
  const { showToast } = useToast();

  // En web, un « chemin » est une poignée de dossier choisie via le navigateur
  // (jeton fsa://…). Taper un chemin Windows au clavier n'a aucun effet : on masque
  // donc le champ texte et on ne propose que le bouton de sélection.
  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;
  const isFsaToken = (p: string) => p.startsWith('fsa://');
  // Nom lisible du dossier : on retire le préfixe technique fsa://
  const friendlyFolder = (p: string) => (p.startsWith('fsa://') ? p.slice('fsa://'.length) : p);
  // En web, un ancien chemin Windows (P:\…) posé depuis la version bureau n'est pas
  // exploitable : il faut re-sélectionner le dossier dans le navigateur.
  const needsReselect = isWeb && !!selectedPath.trim() && !isFsaToken(selectedPath);

  useEffect(() => {
    setSelectedPath(currentPath);
    setUseSubfolder(currentUseSubfolder);
    setPathStatus('unknown');
    setErrorMessage('');
  }, [currentPath, currentUseSubfolder, isOpen]);

  const validatePath = async (path: string) => {
    if (!path.trim()) {
      setPathStatus('unknown');
      setErrorMessage('');
      return;
    }

    if (!window.electronAPI) {
      setPathStatus('invalid');
      setErrorMessage('API Electron non disponible');
      return;
    }

    setIsValidating(true);
    try {
      const isValid = await window.electronAPI.validatePath(path);
      setPathStatus(isValid ? 'valid' : 'invalid');
      setErrorMessage(isValid ? '' : 'Chemin inaccessible ou en lecture seule');
    } catch (error) {
      setPathStatus('invalid');
      setErrorMessage('Erreur lors de la validation du chemin');
    } finally {
      setIsValidating(false);
    }
  };

  const handleBrowseFolder = async () => {
    if (!window.electronAPI) {
      showToast('API Electron non disponible', 'error');
      return;
    }

    try {
      const selectedFolder = await window.electronAPI.selectFolder();
      if (selectedFolder) {
        setSelectedPath(selectedFolder);
        validatePath(selectedFolder);
      }
    } catch (error) {
      console.error('Erreur sélection dossier:', error);
      showToast('Erreur lors de la sélection du dossier', 'error');
    }
  };

  const handleSave = () => {
    if (!selectedPath.trim()) {
      // Supprimer le chemin externe
      onSave('', false);
      onClose();
      return;
    }

    if (pathStatus === 'invalid') {
      showToast('Veuillez sélectionner un chemin valide', 'error');
      return;
    }

    if (needsReselect) {
      showToast('Re-sélectionnez le dossier via « Choisir le dossier »', 'error');
      return;
    }

    onSave(selectedPath, useSubfolder);
    onClose();
  };

  const handleCancel = () => {
    setSelectedPath(currentPath);
    setUseSubfolder(currentUseSubfolder);
    setPathStatus('unknown');
    setErrorMessage('');
    onClose();
  };

  const hasChanges = selectedPath !== currentPath || useSubfolder !== currentUseSubfolder;
  const isCurrentPathSet = currentPath.length > 0;

  // Calcul du chemin final selon l'option choisie
  const getFinalPath = () => {
    if (!selectedPath.trim()) return '';
    return useSubfolder ? `${selectedPath}/${enqueteNumero}` : selectedPath;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-[600px] max-h-[90svh] flex flex-col max-sm:left-0 max-sm:right-0 max-sm:top-[env(safe-area-inset-top)] max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-w-full max-sm:max-h-none max-sm:rounded-none max-sm:border-0">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Configuration du chemin de sauvegarde externe
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Information sur l'enquête */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <Info className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-900">Enquête : {enqueteNumero}</span>
            </div>
            <p className="text-xs text-blue-800">
              Choisissez où sauvegarder les documents et l'organisation souhaitée
            </p>
          </div>

          {/* Sélection du chemin */}
          {isWeb ? (
            // ── Version web : un seul bouton, pas de champ texte (un chemin tapé
            //    au clavier n'est pas exploitable par le navigateur). ──
            <div className="space-y-2">
              <label className="text-sm font-medium">Dossier commun (sur votre poste)</label>
              <p className="text-xs text-gray-600">
                Choisissez le dossier (par exemple sur <strong>P:\</strong>) dans lequel une copie des
                documents sera déposée. Le navigateur vous demandera de le sélectionner une fois.
              </p>

              {selectedPath.trim() && !needsReselect && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                  <CheckCircle className="h-4 w-4 flex-shrink-0" />
                  <span className="text-xs break-all">Dossier sélectionné : <strong>{friendlyFolder(selectedPath)}</strong></span>
                </div>
              )}

              {needsReselect && (
                <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span className="text-xs">
                    Ce dossier vient de la version bureau et n'est pas reconnu par le navigateur.
                    Cliquez sur « Choisir le dossier » pour le re-sélectionner.
                  </span>
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={handleBrowseFolder}
                className="flex items-center gap-2"
              >
                <FolderOpen className="h-4 w-4" />
                {selectedPath.trim() && !needsReselect ? 'Choisir un autre dossier' : 'Choisir le dossier'}
              </Button>

              {selectedPath.trim() && !needsReselect && (
                <button
                  type="button"
                  onClick={() => { setSelectedPath(''); setPathStatus('unknown'); setErrorMessage(''); }}
                  className="block text-xs text-gray-500 underline hover:text-gray-700"
                >
                  Retirer le dossier (sauvegarde sur le serveur uniquement)
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">Chemin de sauvegarde externe</label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Sélectionnez un dossier ou laissez vide pour désactiver"
                  value={selectedPath}
                  onChange={(e) => {
                    setSelectedPath(e.target.value);
                    validatePath(e.target.value);
                  }}
                  className={`flex-1 ${
                    pathStatus === 'valid' ? 'border-green-500' :
                    pathStatus === 'invalid' ? 'border-red-500' : ''
                  }`}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowseFolder}
                  className="flex items-center gap-2"
                >
                  <FolderOpen className="h-4 w-4" />
                  Parcourir
                </Button>
              </div>

              {/* Indicateur de validation */}
              {isValidating && (
                <p className="text-xs text-gray-600">Validation du chemin...</p>
              )}

              {pathStatus === 'valid' && (
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-xs">Chemin valide et accessible en écriture</span>
                </div>
              )}

              {pathStatus === 'invalid' && (
                <div className="flex items-center gap-2 text-red-700">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-xs">{errorMessage}</span>
                </div>
              )}
            </div>
          )}

          {/* Option d'organisation */}
          {selectedPath.trim() && (
            <div className="space-y-3 p-3 bg-gray-50 rounded-lg border">
              <label className="text-sm font-medium text-gray-800">Organisation des fichiers :</label>
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="folderStructure"
                    checked={useSubfolder}
                    onChange={() => setUseSubfolder(true)}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-medium">Créer un sous-dossier avec le numéro d'enquête</div>
                    <div className="text-xs text-gray-600">
                      Recommandé si vous gérez plusieurs enquêtes dans le même dossier parent
                    </div>
                    <div className="text-xs font-mono text-gray-500 mt-1">
                      {selectedPath} → {enqueteNumero} → [Geoloc, Ecoutes, Actes, PV]
                    </div>
                  </div>
                </label>
                
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="folderStructure"
                    checked={!useSubfolder}
                    onChange={() => setUseSubfolder(false)}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-medium">Utiliser directement le dossier sélectionné</div>
                    <div className="text-xs text-gray-600">
                      Utile si le dossier sélectionné est déjà dédié à cette enquête
                    </div>
                    <div className="text-xs font-mono text-gray-500 mt-1">
                      {selectedPath} → [Geoloc, Ecoutes, Actes, PV]
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Avertissement si modification du chemin existant */}
          {isCurrentPathSet && hasChanges && selectedPath.trim() && (
            <Alert className="border-yellow-500 bg-yellow-50">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium text-yellow-800">Attention : Modification de la configuration</p>
                  <p className="text-sm text-yellow-700">
                    Vous modifiez la configuration de sauvegarde. Les documents existants ne seront pas déplacés automatiquement.
                  </p>
                  <p className="text-sm text-yellow-700">
                    <strong>Action requise :</strong> Déplacez manuellement les fichiers existants vers le nouveau dossier 
                    si vous souhaitez conserver l'historique des documents.
                  </p>
                  <div className="bg-white p-2 rounded border border-yellow-300 mt-2">
                    <p className="text-xs text-yellow-800">
                      <strong>Configuration actuelle :</strong> {currentPath}
                      {currentUseSubfolder ? ` / ${enqueteNumero}` : ''}
                    </p>
                    <p className="text-xs text-yellow-800">
                      <strong>Nouvelle configuration :</strong> {getFinalPath()}
                    </p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Information sur la désactivation */}
          {!selectedPath.trim() && isCurrentPathSet && (
            <Alert className="border-orange-500 bg-orange-50">
              <Info className="h-4 w-4" />
              <AlertDescription>
                <p className="text-sm text-orange-800">
                  <strong>Désactivation de la sauvegarde externe</strong>
                </p>
                <p className="text-xs text-orange-700 mt-1">
                  Les nouveaux documents seront uniquement sauvegardés en interne. 
                  Les documents existants dans le dossier externe ne seront pas supprimés.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Exemple d'architecture finale */}
          {selectedPath.trim() && pathStatus === 'valid' && (
            <div className="bg-gray-50 p-3 rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <Folder className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-800">Architecture qui sera créée :</span>
              </div>
              <div className="text-xs font-mono text-gray-700 space-y-1">
                <div>{friendlyFolder(selectedPath)}</div>
                {useSubfolder && (
                  <div className="ml-4">└── {enqueteNumero}/</div>
                )}
                <div className={useSubfolder ? "ml-8" : "ml-4"}>├── Geoloc/</div>
                <div className={useSubfolder ? "ml-8" : "ml-4"}>├── Ecoutes/</div>
                <div className={useSubfolder ? "ml-8" : "ml-4"}>├── Actes/</div>
                <div className={useSubfolder ? "ml-8" : "ml-4"}>└── PV/</div>
              </div>
            </div>
          )}

          {/* Avantages/informations */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <h4 className="text-sm font-medium text-blue-900 mb-2">Fonctionnement de la sauvegarde externe :</h4>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Documents sauvegardés en double : serveur (chiffré) + dossier choisi (en clair)</li>
              <li>• Organisation automatique par catégorie dans des sous-dossiers</li>
              {!isWeb && <li>• Bouton pour ouvrir directement le dossier externe depuis l'application</li>}
              {isWeb && <li>• Bouton « Synchroniser » pour réconcilier serveur et dossier dans les deux sens</li>}
              <li>• Suppression synchronisée (interne et externe)</li>
              <li>• Indicateur visuel en cas d'échec de copie externe</li>
            </ul>
          </div>
        </div>

        <DialogFooter style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex justify-between items-center w-full">
            <div className="text-xs text-gray-500">
              {!selectedPath.trim() ? 'Sauvegarde interne uniquement' : 
               pathStatus === 'valid' ? 'Sauvegarde double (interne + externe)' : 
               'Validation requise'}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Annuler
              </Button>
              <Button 
                onClick={handleSave}
                disabled={!!(selectedPath.trim() && pathStatus === 'invalid')}
                className={selectedPath.trim() && pathStatus === 'valid' ? 'bg-green-600 hover:bg-green-700' : ''}
              >
                {!selectedPath.trim() ? 'Désactiver' : 'Enregistrer'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};