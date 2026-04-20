'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
    } catch (e: any) {
      setGithubError(`Erreur : ${e.message}`);
      setGithubUpdating(false);
    }
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
          Récupère la dernière version du code source depuis GitHub.
          L'application redémarrera automatiquement après la mise à jour.
        </p>
      </div>

      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-violet-800 flex items-center gap-2">
          <Globe className="h-4 w-4" />
          GitHub
        </h4>

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

      <p className="text-xs text-gray-400">
        Les données (enquêtes, documents, résultats) ne sont <strong>jamais</strong> affectées par les mises à jour.
      </p>
    </div>
  );
};
