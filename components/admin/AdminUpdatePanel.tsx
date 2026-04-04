'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Upload, RefreshCw, RotateCcw, Check, AlertTriangle, Loader2, Info, HardDrive, Copy } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';

interface LanVersion {
  version: string;
  publishedAt: string;
  publishedBy: string;
  changelog: string;
}

export const AdminUpdatePanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();
  const { showToast } = useToast();

  const [localVersion, setLocalVersion] = useState<LanVersion | null>(null);
  const [remoteCheck, setRemoteCheck] = useState<{ hasUpdate: boolean; manifest?: LanVersion } | null>(null);
  const [changelog, setChangelog] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState<string>('');
  const [publishProgress, setPublishProgress] = useState<{ current: number; total: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [showConfirmPublish, setShowConfirmPublish] = useState(false);
  const [showConfirmFullPublish, setShowConfirmFullPublish] = useState(false);
  const [lastFullInstallPath, setLastFullInstallPath] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    try {
      const local = await (window as any).electronAPI?.lanUpdateGetLocalVersion?.();
      setLocalVersion(local);
    } catch {}
  }, []);

  const checkForUpdate = useCallback(async () => {
    setChecking(true);
    try {
      const result = await (window as any).electronAPI?.lanUpdateCheck?.();
      setRemoteCheck(result);
    } catch {}
    setChecking(false);
  }, []);

  useEffect(() => {
    loadVersions();
    checkForUpdate();
    // Écouter la progression de la publication
    (window as any).electronAPI?.onPublishProgress?.((data: { step: string; detail: string; current: number; total: number }) => {
      setPublishStep(data.detail);
      if (data.current && data.total) {
        setPublishProgress({ current: data.current, total: data.total });
      }
    });
  }, [loadVersions, checkForUpdate]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const handlePublish = async () => {
    setPublishing(true);
    setShowConfirmPublish(false);
    try {
      const result = await (window as any).electronAPI?.lanUpdatePublish?.(changelog.trim());
      if (result?.success) {
        showToast(`Version ${result.version} publiée sur le réseau (code protégé)`, 'success');
        setChangelog('');
        // Mettre à jour depuis la réponse ET relire le fichier local pour confirmer
        if (result.manifest) {
          setLocalVersion(result.manifest);
        }
        // Toujours relire depuis le fichier pour s'assurer de la cohérence
        await loadVersions();
        checkForUpdate();
      } else {
        showToast(`Erreur: ${result?.error || 'inconnue'}`, 'error');
      }
    } catch (e: any) {
      showToast(`Erreur de publication: ${e.message}`, 'error');
    }
    setPublishing(false);
    setPublishStep('');
    setPublishProgress(null);
  };

  const handleRollback = async () => {
    if (!confirm('Revenir à la version précédente ?\nL\'application va redémarrer.')) return;
    try {
      await (window as any).electronAPI?.lanUpdateRollback?.();
    } catch {
      showToast('Erreur lors du rollback', 'error');
    }
  };

  const handlePublishFull = async () => {
    setPublishing(true);
    setShowConfirmFullPublish(false);
    try {
      const result = await (window as any).electronAPI?.lanUpdatePublishFull?.(changelog.trim());
      if (result?.success) {
        showToast(`Version complète ${result.version} publiée sur le réseau`, 'success');
        setChangelog('');
        setLastFullInstallPath(result.installPath || null);
        if (result.manifest) {
          setLocalVersion(result.manifest);
        }
        await loadVersions();
        checkForUpdate();
      } else {
        showToast(`Erreur: ${result?.error || 'inconnue'}`, 'error');
      }
    } catch (e: any) {
      showToast(`Erreur de publication: ${e.message}`, 'error');
    }
    setPublishing(false);
    setPublishStep('');
    setPublishProgress(null);
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-800">Mise à jour réseau</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Publiez vos mises à jour pour tous les utilisateurs via le lecteur réseau partagé.
        </p>
      </div>

      {/* Infos version actuelle */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
        <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Info className="h-4 w-4 text-gray-400" />
          Dernière version publiée
        </h4>
        {localVersion ? (
          <div className="text-sm text-gray-600 space-y-1">
            <div><span className="font-mono font-medium">{localVersion.version}</span></div>
            <div className="text-xs text-gray-400">
              Publiée par {localVersion.publishedBy} le {formatDate(localVersion.publishedAt)}
            </div>
            {localVersion.changelog && (
              <div className="text-xs text-gray-500 bg-white rounded p-2 border border-gray-100 mt-1">
                {localVersion.changelog}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Aucune publication effectuée depuis ce poste</p>
        )}
      </div>

      {/* Status réseau */}
      <div className="flex items-center gap-2">
        <button
          onClick={checkForUpdate}
          disabled={checking}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
          Vérifier le réseau
        </button>
        {remoteCheck && !remoteCheck.hasUpdate && (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Tous les utilisateurs sont à jour
          </span>
        )}
        {remoteCheck?.hasUpdate && (
          <span className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Version réseau différente de la locale
          </span>
        )}
      </div>

      {/* Section publication */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Publier une mise à jour
        </h4>
        <p className="text-xs text-emerald-700">
          Compile, protège et publie votre version sur le réseau.
          Au prochain démarrage, les autres postes se mettront à jour automatiquement.
          Le code source est automatiquement protégé (compilation + obfuscation).
        </p>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            Changelog (optionnel)
          </label>
          <textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="Ex: Recherche cross-contentieux, correction affichage stats..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none"
            rows={2}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfirmPublish(true)}
              disabled={publishing}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {publishing ? 'Publication en cours...' : 'Publier sur le réseau'}
            </button>
          </div>
          {publishing && (
            <div className="px-3 py-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
              {/* Barre de progression */}
              <div className="w-full bg-emerald-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500 ease-out"
                  style={{ width: publishProgress ? `${Math.round((publishProgress.current / publishProgress.total) * 100)}%` : '5%' }}
                />
              </div>
              {/* Détail étape */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                  <span className="text-xs text-emerald-700">{publishStep || 'Démarrage...'}</span>
                </div>
                {publishProgress && (
                  <span className="text-xs text-emerald-500 font-mono">
                    {publishProgress.current}/{publishProgress.total}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section première installation (package complet) */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          Première installation (package complet)
        </h4>
        <p className="text-xs text-blue-700">
          Publie un <strong>package complet</strong> sur le réseau incluant l'application,
          Electron, Node.js et le launcher. Vos collègues n'ont qu'à <strong>copier le dossier
          "Installation"</strong> sur leur bureau et lancer <strong>launcher.bat</strong>.
        </p>
        <p className="text-xs text-blue-600">
          Les mises à jour suivantes se feront automatiquement via "Publier sur le réseau" ci-dessus.
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfirmFullPublish(true)}
            disabled={publishing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {publishing ? 'Publication en cours...' : 'Publier version complète'}
          </button>
        </div>

        {lastFullInstallPath && (
          <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-blue-800">Package d'installation prêt :</p>
            <p className="text-xs font-mono text-blue-700 break-all">{lastFullInstallPath}</p>
            <p className="text-xs text-blue-600 mt-1">
              Vos collègues peuvent copier ce dossier sur leur poste et lancer <strong>launcher.bat</strong>.
            </p>
          </div>
        )}

        {publishing && (
          <div className="px-3 py-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
            <div className="w-full bg-blue-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-blue-500 h-2.5 rounded-full transition-all duration-500 ease-out"
                style={{ width: publishProgress ? `${Math.round((publishProgress.current / publishProgress.total) * 100)}%` : '5%' }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                <span className="text-xs text-blue-700">{publishStep || 'Démarrage...'}</span>
              </div>
              {publishProgress && (
                <span className="text-xs text-blue-500 font-mono">
                  {publishProgress.current}/{publishProgress.total}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Rollback */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-xs text-amber-800">
            <strong>Rollback :</strong> si une mise à jour pose problème, vous pouvez revenir à la version précédente.
            L'application redémarrera.
          </div>
          <button
            onClick={handleRollback}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Revenir à la version précédente
          </button>
        </div>
      </div>

      {/* Note fonctionnement */}
      <div className="text-xs text-gray-400 space-y-1">
        <p><strong>Fonctionnement :</strong> au démarrage, chaque poste vérifie automatiquement si une nouvelle version est disponible sur le réseau. Si oui, la mise à jour est appliquée silencieusement avant l'affichage de l'application.</p>
        <p>Les données (enquêtes, documents, résultats) ne sont <strong>jamais</strong> affectées par les mises à jour.</p>
        <p><strong>Protection :</strong> le code est compilé et obfusqué avant publication. Les utilisateurs reçoivent uniquement le code protégé, pas les sources.</p>
      </div>

      {/* Confirmation de publication */}
      {showConfirmPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-full">
                <Upload className="h-5 w-5 text-emerald-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-800">Confirmer la publication</h3>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                Votre version actuelle sera copiée sur le réseau partagé.
              </p>
              <p>
                <strong>Tous les utilisateurs</strong> recevront cette mise à jour
                automatiquement à leur prochain démarrage.
              </p>
              {changelog.trim() && (
                <div className="bg-gray-50 rounded p-2 text-xs text-gray-500 border">
                  <strong>Changelog :</strong> {changelog.trim()}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmPublish(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handlePublish}
                className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                Publier
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Confirmation publication complète */}
      {showConfirmFullPublish && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-full">
                <HardDrive className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-800">Publication complète</h3>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                Un <strong>package d'installation complet</strong> sera créé sur le réseau,
                incluant l'application, Electron, Node.js et le launcher.
              </p>
              <p>
                Cette opération peut prendre plusieurs minutes (copie des runtimes).
              </p>
              <p className="text-xs text-gray-500">
                Vos collègues pourront simplement copier le dossier "Installation" sur leur
                bureau et lancer <strong>launcher.bat</strong>.
              </p>
              {changelog.trim() && (
                <div className="bg-gray-50 rounded p-2 text-xs text-gray-500 border">
                  <strong>Changelog :</strong> {changelog.trim()}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmFullPublish(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handlePublishFull}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Publier version complète
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
