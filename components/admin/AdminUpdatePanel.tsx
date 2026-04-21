'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Check, AlertTriangle, Loader2, XCircle, Globe, Download, Send, Users, Ban } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

interface AdminUpdatePanelProps {
  onGithubUpdateChange?: (hasUpdate: boolean, commits: number) => void;
}

export const AdminUpdatePanel = ({ onGithubUpdateChange }: AdminUpdatePanelProps) => {
  const { isAdmin: checkIsAdmin, user } = useUser();

  const [githubUpdateAvailable, setGithubUpdateAvailable] = useState(false);
  const [githubCommits, setGithubCommits] = useState(0);
  const [githubChecking, setGithubChecking] = useState(false);
  const [githubUpdating, setGithubUpdating] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubLocalSha, setGithubLocalSha] = useState<string | null>(null);
  const [githubRemoteSha, setGithubRemoteSha] = useState<string | null>(null);

  const [approvedSha, setApprovedSha] = useState<string | null>(null);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const checkGithubUpdate = useCallback(async (force = false) => {
    setGithubChecking(true);
    setGithubError(null);
    try {
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
            onClick={() => checkGithubUpdate(true)}
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

      {/* Publication aux utilisateurs (écrit update-approved.json sur le serveur commun) */}
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

      <p className="text-xs text-gray-400">
        Les données (enquêtes, documents, résultats) ne sont <strong>jamais</strong> affectées par les mises à jour.
      </p>
    </div>
  );
};
