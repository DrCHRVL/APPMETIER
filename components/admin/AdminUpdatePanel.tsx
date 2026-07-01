'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Check, AlertTriangle, Loader2, XCircle, Globe, Download, Send, Users, Ban } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

interface AdminUpdatePanelProps {
  onGithubUpdateChange?: (hasUpdate: boolean, commits: number) => void;
}

export const AdminUpdatePanel = ({ onGithubUpdateChange }: AdminUpdatePanelProps) => {
  const { isAdmin: checkIsAdmin, user } = useUser();

  // Version serveur (V2) : la mise à jour reconstruit le serveur pour tout le
  // monde — pas de cycle « tester puis publier » poste par poste comme en Electron.
  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

  const [githubUpdateAvailable, setGithubUpdateAvailable] = useState(false);
  const [githubCommits, setGithubCommits] = useState(0);
  const [githubChecking, setGithubChecking] = useState(false);
  const [githubUpdating, setGithubUpdating] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubLocalSha, setGithubLocalSha] = useState<string | null>(null);
  const [githubRemoteSha, setGithubRemoteSha] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<string>('');
  const [showLog, setShowLog] = useState(false);

  const [approvedSha, setApprovedSha] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Référence pour annuler le polling en cas de démontage du composant
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const checkGithubUpdate = useCallback(async (force = false) => {
    setGithubChecking(true);
    setGithubError(null);
    try {
      if (isWeb) {
        // Version serveur : appel de l'API web (admin uniquement côté serveur)
        const res = await fetch(`/api/update${force ? '?force=1' : ''}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || `Erreur ${res.status}`);
        }
        const data = await res.json() as {
          commits?: number; localSha?: string | null; remoteSha?: string | null; fetchOk?: boolean;
          logTail?: string;
        };
        const hasUpdate = (data.commits || 0) > 0;
        setGithubUpdateAvailable(hasUpdate);
        setGithubCommits(data.commits || 0);
        setGithubLocalSha(data.localSha || null);
        setGithubRemoteSha(data.remoteSha || null);
        if (typeof data.logTail === 'string') setLogTail(data.logTail);
        onGithubUpdateChange?.(hasUpdate, data.commits || 0);
      } else {
        // Version Electron
        const result = await (window as any).electronAPI?.checkAppUpdate?.(force);
        const hasUpdate = result?.hasUpdate || false;
        const commits = result?.commits || 0;
        setGithubUpdateAvailable(hasUpdate);
        setGithubCommits(commits);
        setGithubLocalSha(result?.localSha || null);
        setGithubRemoteSha(result?.remoteSha || null);
        setApprovedSha(result?.approvedSha || null);
        setApprovedBy(result?.approvedBy || null);
        setApprovedAt(result?.approvedAt || null);
        if (result?.error) setGithubError(result.error);
        onGithubUpdateChange?.(hasUpdate, commits);
      }
    } catch (e: any) {
      setGithubError(e.message || 'Impossible de vérifier les mises à jour GitHub');
    }
    setGithubChecking(false);
  }, [onGithubUpdateChange, isWeb]);

  // Version serveur : déclenche un job (pull+rebuild ou simple reconstruction) via
  // l'API, puis interroge le statut jusqu'à 'done' (rechargement) ou 'error'.
  const runServerJob = (action: 'apply' | 'rebuild') => {
    setGithubUpdating(true);
    setGithubError(null);
    (async () => {
      try {
        const postRes = await fetch('/api/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!postRes.ok) {
          const data = await postRes.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || `Erreur ${postRes.status}`);
        }
        // Interroge le statut toutes les 3 s jusqu'à 'done' ou 'error'
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const res = await fetch('/api/update');
            if (!res.ok) return; // serveur en cours de redémarrage, on continue à attendre
            const data = await res.json() as { status?: { state: string; message?: string }; logTail?: string };
            if (typeof data.logTail === 'string') setLogTail(data.logTail);
            if (data.status?.state === 'done') {
              clearInterval(pollRef.current!); pollRef.current = null;
              window.location.reload();
            } else if (data.status?.state === 'error') {
              clearInterval(pollRef.current!); pollRef.current = null;
              setGithubError(data.status?.message || 'Erreur lors de la mise à jour');
              setShowLog(true);
              setGithubUpdating(false);
            }
          } catch { /* erreur réseau transitoire pendant le redémarrage, on réessaie */ }
        }, 3000);
      } catch (e: any) {
        setGithubError(`Erreur : ${e.message}`);
        setGithubUpdating(false);
      }
    })();
  };

  const applyGithubUpdate = async () => {
    setGithubUpdating(true);
    setGithubError(null);
    try {
      if (isWeb) {
        runServerJob('apply');
      } else {
        // Version Electron
        const result = await (window as any).electronAPI?.applyAppUpdate?.();
        if (result && !result.success) {
          setGithubError(`Erreur : ${result.error}`);
          setGithubUpdating(false);
        }
        // en Electron, l'app redémarre d'elle-même — rien à faire ici
      }
    } catch (e: any) {
      setGithubError(`Erreur : ${e.message}`);
      setGithubUpdating(false);
    }
  };

  const publishToUsers = async () => {
    if (!githubLocalSha) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await (window as any).electronAPI?.approveAppUpdate?.(
        githubLocalSha,
        user?.displayName || user?.windowsUsername || 'admin'
      );
      if (result?.success) {
        setApprovedSha(result.approvedSha);
        setApprovedBy(result.approvedBy);
        setApprovedAt(result.approvedAt);
      } else {
        setPublishError(result?.error || 'Échec de la publication');
      }
    } catch (e: any) {
      setPublishError(e?.message || 'Erreur publication');
    }
    setPublishing(false);
  };

  const unpublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await (window as any).electronAPI?.unapproveAppUpdate?.();
      if (result?.success) {
        setApprovedSha(null);
        setApprovedBy(null);
        setApprovedAt(null);
      } else {
        setPublishError(result?.error || 'Échec du retrait');
      }
    } catch (e: any) {
      setPublishError(e?.message || 'Erreur');
    }
    setPublishing(false);
  };

  useEffect(() => {
    checkGithubUpdate();
  }, [checkGithubUpdate]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const currentPublished = approvedSha && githubLocalSha && approvedSha === githubLocalSha;
  const canPublishCurrent = !!githubLocalSha && !currentPublished;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-800">Mise à jour de l'application</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          {isWeb
            ? 'Récupère la dernière version du code source depuis GitHub, reconstruit le serveur et le redémarre (2 à 5 minutes). La mise à jour s\'applique à tous les utilisateurs.'
            : 'Récupère la dernière version du code source depuis GitHub. L\'application redémarrera automatiquement après la mise à jour.'}
        </p>
      </div>

      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
          <Globe className="h-4 w-4" />
          GitHub
        </h4>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => checkGithubUpdate(true)}
            disabled={githubChecking || githubUpdating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${githubChecking ? 'animate-spin' : ''}`} />
            Vérifier GitHub
          </button>

          {isWeb && !githubUpdateAvailable && (
            <button
              onClick={() => runServerJob('rebuild')}
              disabled={githubChecking || githubUpdating}
              title="Reconstruit et redémarre le serveur sur la version déjà récupérée — utile si une mise à jour a échoué au build alors que GitHub est déjà à jour."
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-100 hover:bg-violet-200 text-violet-800 rounded-lg transition-colors disabled:opacity-50"
            >
              {githubUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Forcer la reconstruction
            </button>
          )}

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
            <span className="text-xs text-violet-700">
              {isWeb
                ? 'Reconstruction du serveur en cours (2 à 5 minutes)... La page se rechargera automatiquement. De brèves coupures sont normales pendant le redémarrage.'
                : 'Téléchargement et installation en cours... L\'application va redémarrer.'}
            </span>
          </div>
        )}

        {/* Journal technique (update.log) — diagnostic d'un échec de mise à jour côté serveur */}
        {isWeb && logTail && (
          <div className="pt-1">
            <button
              onClick={() => setShowLog((v) => !v)}
              className="text-xs text-violet-700 hover:text-violet-900 underline underline-offset-2"
            >
              {showLog ? 'Masquer le journal technique (update.log)' : 'Afficher le journal technique (update.log)'}
            </button>
            {showLog && (
              <pre className="mt-2 max-h-64 overflow-auto text-[11px] leading-snug bg-gray-900 text-gray-100 rounded-lg p-3 whitespace-pre-wrap break-words">
                {logTail}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* Version serveur : pas de cycle « publication » — la MAJ vaut pour tous */}
      {isWeb && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-2">
          <h4 className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Publication aux utilisateurs
          </h4>
          <p className="text-xs text-emerald-700">
            Sans objet sur la version serveur : dès que la mise à jour est appliquée,
            <strong> tous les utilisateurs</strong> reçoivent la nouvelle version au prochain
            chargement de la page — il n'y a rien à publier séparément.
          </p>
        </div>
      )}

      {/* Publication aux utilisateurs (Electron : écrit update-approved.json sur le serveur commun) */}
      {!isWeb && (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
          <Users className="h-4 w-4" />
          Publication aux utilisateurs
        </h4>
        <p className="text-xs text-emerald-700">
          Tant que vous n'avez pas validé, les autres utilisateurs <strong>ne voient pas</strong> la notification de MAJ.
          Testez la version sur votre poste avant de la publier.
        </p>

        <div className="text-xs bg-white border border-emerald-200 rounded-lg p-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 w-24">Publiée :</span>
            <span className={approvedSha ? 'text-gray-800 font-mono' : 'text-gray-400 italic'}>
              {approvedSha ? approvedSha.substring(0, 12) : 'aucune'}
            </span>
          </div>
          {approvedSha && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">Par :</span>
                <span className="text-gray-700">{approvedBy || '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 w-24">Date :</span>
                <span className="text-gray-700">
                  {approvedAt ? new Date(approvedAt).toLocaleString('fr-FR') : '—'}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={publishToUsers}
            disabled={publishing || !canPublishCurrent}
            className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={currentPublished ? 'Cette version est déjà publiée' : 'Publier la version installée localement'}
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {currentPublished ? 'Version publiée' : 'Publier cette version aux utilisateurs'}
          </button>

          {approvedSha && (
            <button
              onClick={unpublish}
              disabled={publishing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              Retirer la publication
            </button>
          )}
        </div>

        {publishError && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>{publishError}</span>
          </div>
        )}

        {currentPublished && (
          <div className="text-xs text-emerald-700 flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />
            Les utilisateurs voient désormais la notification de mise à jour.
          </div>
        )}
      </div>
      )}

      <p className="text-xs text-gray-400">
        Les données (enquêtes, documents, résultats) ne sont <strong>jamais</strong> affectées par les mises à jour.
      </p>
    </div>
  );
};
