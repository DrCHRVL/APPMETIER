'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Check, AlertTriangle, Loader2, XCircle, Globe, Download } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

interface AdminUpdatePanelProps {
  onGithubUpdateChange?: (hasUpdate: boolean, commits: number) => void;
}

export const AdminUpdatePanel = ({ onGithubUpdateChange }: AdminUpdatePanelProps) => {
  const { isAdmin: checkIsAdmin } = useUser();

  const [githubUpdateAvailable, setGithubUpdateAvailable] = useState(false);
  const [githubCommits, setGithubCommits] = useState(0);
  const [githubChecking, setGithubChecking] = useState(false);
  const [githubUpdating, setGithubUpdating] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubLocalSha, setGithubLocalSha] = useState<string | null>(null);
  const [githubRemoteSha, setGithubRemoteSha] = useState<string | null>(null);
  const [logTail, setLogTail] = useState<string>('');
  const [showLog, setShowLog] = useState(false);

  // Référence pour annuler le polling en cas de démontage du composant
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const checkGithubUpdate = useCallback(async (force = false) => {
    setGithubChecking(true);
    setGithubError(null);
    try {
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
    } catch (e: any) {
      setGithubError(e.message || 'Impossible de vérifier les mises à jour GitHub');
    }
    setGithubChecking(false);
  }, [onGithubUpdateChange]);

  // Déclenche un job (pull+rebuild ou simple reconstruction) via l'API, puis
  // interroge le statut jusqu'à 'done' (rechargement) ou 'error'.
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

  useEffect(() => {
    checkGithubUpdate();
  }, [checkGithubUpdate]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-800">Mise à jour de l'application</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Récupère la dernière version du code source depuis GitHub, reconstruit le serveur et le
          redémarre (2 à 5 minutes). Dès la mise à jour appliquée, tous les utilisateurs reçoivent
          la nouvelle version au prochain chargement de la page.
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

          {!githubUpdateAvailable && (
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
              onClick={() => runServerJob('apply')}
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
              Reconstruction du serveur en cours (2 à 5 minutes)... La page se rechargera
              automatiquement. De brèves coupures sont normales pendant le redémarrage.
            </span>
          </div>
        )}

        {/* Journal technique (update.log) — diagnostic d'un échec de mise à jour côté serveur */}
        {logTail && (
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

      <p className="text-xs text-gray-400">
        Les données (enquêtes, documents, résultats) ne sont <strong>jamais</strong> affectées par les mises à jour.
      </p>
    </div>
  );
};
