'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Upload, RefreshCw, RotateCcw, Check, AlertTriangle, Loader2, Info, HardDrive, Copy, ShieldCheck, X, CheckCircle, XCircle, Globe, ArrowRight, Download } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';

interface LanVersion {
  version: string;
  publishedAt: string;
  publishedBy: string;
  changelog: string;
}

interface AdminUpdatePanelProps {
  onGithubUpdateChange?: (hasUpdate: boolean, commits: number) => void;
}

export const AdminUpdatePanel = ({ onGithubUpdateChange }: AdminUpdatePanelProps) => {
  const { isAdmin: checkIsAdmin } = useUser();
  const { showToast } = useToast();

  const [localVersion, setLocalVersion] = useState<LanVersion | null>(null);
  const [remoteCheck, setRemoteCheck] = useState<{ hasUpdate: boolean; manifest?: LanVersion } | null>(null);
  const [changelog, setChangelog] = useState('');
  const [publishingUpdate, setPublishingUpdate] = useState(false);
  const [publishingFull, setPublishingFull] = useState(false);
  const [publishStep, setPublishStep] = useState<string>('');
  const [publishProgress, setPublishProgress] = useState<{ current: number; total: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [showConfirmPublish, setShowConfirmPublish] = useState(false);
  const [showConfirmFullPublish, setShowConfirmFullPublish] = useState(false);
  const [lastFullInstallPath, setLastFullInstallPath] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [integrityResult, setIntegrityResult] = useState<any>(null);
  const [publishSuccessResult, setPublishSuccessResult] = useState<{ version: string; type: 'update' | 'full'; installPath?: string; zipFile?: string; zipSizeMB?: string } | null>(null);

  // GitHub update states
  const [githubUpdateAvailable, setGithubUpdateAvailable] = useState(false);
  const [githubCommits, setGithubCommits] = useState(0);
  const [githubChecking, setGithubChecking] = useState(false);
  const [githubUpdating, setGithubUpdating] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubLocalSha, setGithubLocalSha] = useState<string | null>(null);
  const [githubRemoteSha, setGithubRemoteSha] = useState<string | null>(null);

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

  const checkGithubUpdate = useCallback(async () => {
    setGithubChecking(true);
    setGithubError(null);
    try {
      const result = await (window as any).electronAPI?.checkAppUpdate?.();
      const hasUpdate = result?.hasUpdate || false;
      const commits = result?.commits || 0;
      setGithubUpdateAvailable(hasUpdate);
      setGithubCommits(commits);
      setGithubLocalSha(result?.localSha || null);
      setGithubRemoteSha(result?.remoteSha || null);
      if (result?.error) setGithubError(result.error);
      // Notifier le parent (header) du nouvel état
      onGithubUpdateChange?.(hasUpdate, commits);
    } catch {
      setGithubError('Impossible de vérifier les mises à jour GitHub');
    }
    setGithubChecking(false);
  }, [onGithubUpdateChange]);

  const applyGithubUpdate = async () => {
    setGithubUpdating(true);
    setGithubError(null);
    try {
      const result = await (window as any).electronAPI?.applyAppUpdate?.();
      if (result && !result.success) {
        setGithubError(`Erreur : ${result.error}`);
        setGithubUpdating(false);
      }
      // Si succès, l'app redémarre
    } catch (e: any) {
      setGithubError(`Erreur : ${e.message}`);
      setGithubUpdating(false);
    }
  };

  useEffect(() => {
    loadVersions();
    checkForUpdate();
    checkGithubUpdate();
    // Écouter la progression de la publication
    (window as any).electronAPI?.onPublishProgress?.((data: { step: string; detail: string; current: number; total: number }) => {
      setPublishStep(data.detail);
      if (data.current && data.total) {
        setPublishProgress({ current: data.current, total: data.total });
      }
    });
  }, [loadVersions, checkForUpdate, checkGithubUpdate]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const handlePublish = async () => {
    setPublishingUpdate(true);
    setShowConfirmPublish(false);
    try {
      const result = await (window as any).electronAPI?.lanUpdatePublish?.(changelog.trim());
      if (result?.success) {
        setPublishSuccessResult({ version: result.version, type: 'update' });
        setChangelog('');
        if (result.manifest) setLocalVersion(result.manifest);
        await loadVersions();
        checkForUpdate();
      } else {
        showToast(`Erreur: ${result?.error || 'inconnue'}`, 'error');
      }
    } catch (e: any) {
      showToast(`Erreur de publication: ${e.message}`, 'error');
    }
    setPublishingUpdate(false);
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

  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    setIntegrityResult(null);
    try {
      const result = await (window as any).electronAPI?.lanUpdateVerifyIntegrity?.();
      setIntegrityResult(result);
    } catch (e: any) {
      setIntegrityResult({ success: false, error: e.message });
    }
    setVerifying(false);
  };

  const handlePublishFull = async () => {
    setPublishingFull(true);
    setShowConfirmFullPublish(false);
    try {
      const result = await (window as any).electronAPI?.lanUpdatePublishFull?.(changelog.trim());
      if (result?.success) {
        setPublishSuccessResult({ version: result.version, type: 'full', installPath: result.installPath, zipFile: result.zipFile, zipSizeMB: result.zipSizeMB });
        setChangelog('');
        setLastFullInstallPath(result.installPath || null);
        if (result.manifest) setLocalVersion(result.manifest);
        await loadVersions();
        checkForUpdate();
      } else {
        showToast(`Erreur: ${result?.error || 'inconnue'}`, 'error');
      }
    } catch (e: any) {
      showToast(`Erreur de publication: ${e.message}`, 'error');
    }
    setPublishingFull(false);
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
      {/* Workflow global */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-base font-semibold text-gray-800 mb-2">Gestion des mises à jour</h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1 px-2 py-1 bg-violet-100 text-violet-700 rounded font-medium"><Globe className="h-3 w-3" /> GitHub</span>
          <ArrowRight className="h-3 w-3 text-gray-400" />
          <span className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded font-medium">Votre poste</span>
          <ArrowRight className="h-3 w-3 text-gray-400" />
          <span className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded font-medium"><Upload className="h-3 w-3" /> Réseau LAN</span>
          <ArrowRight className="h-3 w-3 text-gray-400" />
          <span className="flex items-center gap-1 px-2 py-1 bg-gray-200 text-gray-600 rounded font-medium">Utilisateurs</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Mettez à jour votre poste depuis GitHub, puis publiez sur le réseau pour les autres utilisateurs.
        </p>
      </div>

      {/* Section GitHub */}
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Mise à jour depuis GitHub
        </h4>
        <p className="text-xs text-violet-700">
          Récupère la dernière version du code source depuis le dépôt GitHub.
          Votre poste sera mis à jour et l'application redémarrera.
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={checkGithubUpdate}
            disabled={githubChecking || githubUpdating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${githubChecking ? 'animate-spin' : ''}`} />
            Vérifier GitHub
          </button>

          {githubUpdateAvailable && (
            <button
              onClick={applyGithubUpdate}
              disabled={githubUpdating}
              className="flex items-center gap-2 px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {githubUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {githubUpdating ? 'Mise à jour en cours...' : 'Mettre à jour depuis GitHub'}
            </button>
          )}

          {!githubChecking && !githubUpdateAvailable && !githubError && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Vous êtes à jour
            </span>
          )}

          {githubUpdateAvailable && !githubUpdating && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Nouvelle version disponible
            </span>
          )}
        </div>

        {/* Debug SHA info */}
        {(githubLocalSha || githubRemoteSha) && (
          <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-2 space-y-1 font-mono">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-14">Local :</span>
              <span className={githubLocalSha ? 'text-gray-700' : 'text-red-500 italic font-sans'}>{githubLocalSha ? githubLocalSha.substring(0, 12) : 'non trouvé'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 w-14">GitHub :</span>
              <span className="text-gray-700">{githubRemoteSha ? githubRemoteSha.substring(0, 12) : '—'}</span>
            </div>
            {githubUpdateAvailable && githubCommits > 0 && (
              <div className="text-amber-600 font-sans font-medium pt-1 border-t border-gray-200">
                {githubCommits} commit{githubCommits > 1 ? 's' : ''} de retard
              </div>
            )}
          </div>
        )}

        {githubError && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{githubError}</span>
          </div>
        )}

        {githubUpdating && (
          <div className="px-3 py-2 bg-violet-100 border border-violet-200 rounded-lg flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600" />
            <span className="text-xs text-violet-700">Téléchargement et installation en cours... L'application va redémarrer.</span>
          </div>
        )}
      </div>

      {/* Séparateur */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-xs text-gray-400 font-medium">Publication réseau (LAN)</span>
        </div>
      </div>

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

        {/* Bouton vérification intégrité */}
        <div className="pt-2 border-t border-gray-100">
          <button
            onClick={handleVerifyIntegrity}
            disabled={verifying}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {verifying ? 'Vérification...' : 'Vérifier l\'intégrité sur le serveur'}
          </button>
        </div>

        {/* Résultat vérification */}
        {integrityResult && (
          <div className="mt-2 space-y-2">
            {!integrityResult.success ? (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>Erreur : {integrityResult.error}</span>
              </div>
            ) : (
              <>
                {/* Package complet */}
                <IntegrityBlock
                  title="Package complet (Installation)"
                  data={integrityResult.results.fullInstall}
                />
                {/* Mise à jour réseau */}
                <IntegrityBlock
                  title="Mise à jour réseau (updates)"
                  data={integrityResult.results.update}
                />
              </>
            )}
          </div>
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
          Compile et publie votre version sur le réseau.
          Au prochain démarrage, les autres postes se mettront à jour automatiquement.
          Une signature SHA-256 (.integrity) est générée : toute modification du
          code est détectée au lancement.
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
              disabled={publishingUpdate || publishingFull}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {publishingUpdate ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {publishingUpdate ? 'Publication en cours...' : 'Publier sur le réseau'}
            </button>
          </div>
          {publishingUpdate && (
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
          Publie un <strong>package complet</strong> (ZIP) sur le réseau incluant l'application,
          Electron, Node.js et le launcher. Vos collègues n'ont qu'à <strong>télécharger
          Installation.zip</strong>, le dézipper et lancer <strong>launcher.bat</strong>.
        </p>
        <p className="text-xs text-blue-600">
          Le package est préparé localement puis transféré en un seul fichier ZIP — rapide et fiable.
          Les mises à jour suivantes se feront automatiquement via "Publier sur le réseau" ci-dessus.
        </p>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfirmFullPublish(true)}
            disabled={publishingUpdate || publishingFull}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {publishingFull ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {publishingFull ? 'Publication en cours...' : 'Publier version complète'}
          </button>
        </div>

        {lastFullInstallPath && (
          <div className="bg-blue-100 border border-blue-300 rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-blue-800">Package d'installation prêt :</p>
            <p className="text-xs font-mono text-blue-700 break-all">{lastFullInstallPath}/Installation.zip</p>
            <p className="text-xs text-blue-600 mt-1">
              Vos collègues peuvent télécharger <strong>Installation.zip</strong>, le dézipper et lancer <strong>launcher.bat</strong>.
            </p>
          </div>
        )}

        {publishingFull && (
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

      {/* Modal succès publication */}
      {publishSuccessResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-full">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-800">
                  {publishSuccessResult.type === 'full' ? 'Package complet publié' : 'Mise à jour publiée'}
                </h3>
                <p className="text-xs text-gray-400 font-mono">{publishSuccessResult.version}</p>
              </div>
            </div>
            <div className="text-sm text-gray-600 space-y-2">
              {publishSuccessResult.type === 'full' ? (
                <>
                  <p>Le package d'installation (ZIP) est disponible sur le réseau.</p>
                  {publishSuccessResult.installPath && (
                    <div className="bg-gray-50 rounded p-2 text-xs font-mono text-gray-500 border break-all">
                      {publishSuccessResult.installPath}
                      {publishSuccessResult.zipFile && <><br />{publishSuccessResult.zipFile}</>}
                      {publishSuccessResult.zipSizeMB && <span className="text-gray-400"> ({publishSuccessResult.zipSizeMB} Mo)</span>}
                    </div>
                  )}
                  <p className="text-xs text-gray-500">
                    Vos collègues peuvent télécharger <strong>Installation.zip</strong>, le dézipper et lancer <strong>launcher.bat</strong>.
                  </p>
                </>
              ) : (
                <p>La mise à jour est disponible sur le réseau. Les autres postes se mettront à jour au prochain démarrage.</p>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setPublishSuccessResult(null)}
                className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

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
                Un <strong>package d'installation complet</strong> (ZIP) sera créé et déposé sur le réseau,
                incluant l'application, Electron, Node.js et le launcher.
              </p>
              <p>
                Le package est préparé localement puis transféré en un seul fichier — plus rapide et fiable.
              </p>
              <p className="text-xs text-gray-500">
                Vos collègues pourront télécharger <strong>Installation.zip</strong>, le dézipper
                et lancer <strong>launcher.bat</strong>.
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

// ──────────────────────────────────────────────
// SOUS-COMPOSANT : Bloc de vérification d'intégrité
// ──────────────────────────────────────────────

const IntegrityBlock = ({ title, data }: { title: string; data: any }) => {
  if (!data) return null;

  const hasIssues = data.issues && data.issues.length > 0;
  const isOk = data.exists && !hasIssues;

  return (
    <div className={`text-xs rounded-lg p-3 border ${isOk ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
      <div className="flex items-center gap-2 font-semibold mb-1.5">
        {isOk ? (
          <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        )}
        <span className={isOk ? 'text-emerald-800' : 'text-red-800'}>{title}</span>
      </div>

      {!data.exists ? (
        <p className="text-red-600 ml-5">Non trouvé sur le serveur</p>
      ) : (
        <div className="ml-5 space-y-1">
          {/* Fichiers vérifiés */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {Object.entries(data.files || {}).map(([file, ok]) => (
              <span key={file} className={`flex items-center gap-0.5 ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
                {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                <span className="font-mono">{file}</span>
              </span>
            ))}
            {data.zipSizeMB && (
              <span className="text-gray-400 text-xs">({data.zipSizeMB} Mo)</span>
            )}
          </div>

          {/* Intégrité SHA256 */}
          {data.integrity && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1 border-t border-gray-200 mt-1">
              {Object.entries(data.integrity).map(([file, ok]) => (
                <span key={file} className={`flex items-center gap-0.5 ${ok ? 'text-emerald-700' : 'text-red-600 font-semibold'}`}>
                  {ok ? <ShieldCheck className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  <span className="font-mono">{file}</span>
                  <span className="text-gray-400">{ok ? 'SHA256 OK' : 'MODIFIÉ'}</span>
                </span>
              ))}
            </div>
          )}

          {/* Version */}
          {data.manifest && (
            <div className="text-gray-500 pt-1">
              Version : <span className="font-mono font-medium">{data.manifest.version}</span>
              {data.manifest.publishedAt && ` — ${new Date(data.manifest.publishedAt).toLocaleDateString('fr-FR')}`}
            </div>
          )}

          {/* Problèmes */}
          {hasIssues && (
            <div className="pt-1 space-y-0.5">
              {data.issues.map((issue: string, i: number) => (
                <div key={i} className="text-red-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {issue}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
