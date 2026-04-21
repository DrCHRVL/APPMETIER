'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Download, Loader2, AlertTriangle, GitCommit, RefreshCw, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ChangelogCommit {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  url: string | null;
}

interface UpdateChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  localSha: string | null;
  remoteSha: string | null;
  commitsCount: number;
  onApply: () => void;
  isApplying: boolean;
}

export const UpdateChangelogModal = ({
  isOpen,
  onClose,
  localSha,
  remoteSha,
  commitsCount,
  onApply,
  isApplying,
}: UpdateChangelogModalProps) => {
  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<ChangelogCommit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !localSha || !remoteSha) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await (window as any).electronAPI?.getUpdateChangelog?.(localSha, remoteSha);
        if (cancelled) return;
        if (result?.success) {
          setCommits(result.commits || []);
        } else {
          setError(result?.error || 'Impossible de récupérer le changelog');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Erreur réseau');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isOpen, localSha, remoteSha]);

  const formatCommitMessage = (message: string) => {
    const firstLine = message.split('\n')[0];
    return firstLine.length > 140 ? firstLine.slice(0, 140) + '…' : firstLine;
  };

  const formatDate = (date: string | null) => {
    if (!date) return '';
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr });
    } catch { return ''; }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !isApplying) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-violet-600" />
            Mise à jour disponible
            {commitsCount > 0 && (
              <span className="text-sm font-normal text-gray-500">
                · {commitsCount} commit{commitsCount > 1 ? 's' : ''}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 space-y-1">
              <p className="font-medium">Redémarrage requis</p>
              <p>
                L'application va se fermer et redémarrer automatiquement.
                Si la mise à jour modifie le code de l'interface, un <strong>rebuild</strong> sera lancé
                au prochain démarrage (1 à 3 minutes). Vos données ne sont jamais affectées.
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
              <GitCommit className="h-4 w-4" />
              Nouveautés
            </h4>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement du changelog…
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-2 rounded-lg border border-red-200">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {!loading && !error && commits.length === 0 && (
              <p className="text-sm text-gray-500 italic">Aucun détail disponible.</p>
            )}

            {!loading && !error && commits.length > 0 && (
              <ul className="space-y-2">
                {commits.map((c) => (
                  <li
                    key={c.sha}
                    className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm"
                  >
                    <div className="text-gray-800">{formatCommitMessage(c.message)}</div>
                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span className="font-mono">{c.sha.substring(0, 7)}</span>
                      <span>·</span>
                      <span>{c.author}</span>
                      {c.date && <><span>·</span><span>{formatDate(c.date)}</span></>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isApplying}
          >
            Plus tard
          </Button>
          <Button
            onClick={onApply}
            disabled={isApplying}
            className="bg-violet-600 hover:bg-violet-700 text-white flex items-center gap-2"
          >
            {isApplying
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Installation…</>
              : <><RefreshCw className="h-4 w-4" /> Installer et redémarrer</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
