'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Check, X, Trash2, Loader2, RefreshCw, Users, UserPlus, Share2, Mail, Activity, RotateCcw } from 'lucide-react';
import type { AIRShareState } from '@/utils/dataSync/AIRSyncService';
import { airSyncService } from '@/utils/dataSync/AIRSyncService';
import { useToast } from '@/contexts/ToastContext';
import { UserManager } from '@/utils/userManager';

const isWebApp = () =>
  typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

/**
 * Panneau de paramètres du module AIR : synchronisation réseau privée par
 * utilisateur + partage réciproque optionnel avec d'autres utilisateurs
 * (même mécanique que le module instruction).
 */
export const AdminAIRPanel = () => {
  const { showToast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState(() => airSyncService.getStatus());

  useEffect(() => {
    const refresh = () => setStatus(airSyncService.getStatus());
    refresh();
    window.addEventListener('air-sync-completed', refresh);
    window.addEventListener('air-share-changed', refresh);
    const id = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('air-sync-completed', refresh);
      window.removeEventListener('air-share-changed', refresh);
      clearInterval(id);
    };
  }, []);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await airSyncService.triggerSync();
      if (res.success) {
        showToast('Synchronisation AIR effectuée', 'success');
      } else {
        showToast(res.error || 'Synchronisation impossible', 'error');
      }
    } finally {
      setSyncing(false);
      setStatus(airSyncService.getStatus());
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Activity className="h-5 w-5 text-gray-500" />
          Module AIR — sauvegarde & partage
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          Vos mesures AIR sont <strong>privées</strong> et sauvegardées de façon chiffrée
          sur le serveur. Elles se synchronisent automatiquement entre vos appareils et
          peuvent, si vous le souhaitez, être <strong>partagées</strong> avec d'autres
          utilisateurs.
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Synchroniser maintenant
          </button>
          <span className="text-xs text-gray-500">
            {status.lastSuccessfulSync
              ? `Dernière synchro : ${new Date(status.lastSuccessfulSync).toLocaleString('fr-FR')}`
              : 'Aucune synchro effectuée pour le moment'}
          </span>
        </div>
      </section>

      <AIRPartageSection />

      <AIRBackupsSection />
    </div>
  );
};

const AIRPartageSection = () => {
  const { showToast } = useToast();
  const [state, setState] = useState<AIRShareState>(() => airSyncService.getShareState());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ windowsUsername: string; displayName: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setState(airSyncService.getShareState());
    refresh();
    window.addEventListener('air-share-changed', refresh);
    window.addEventListener('air-sync-completed', refresh);
    const id = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('air-share-changed', refresh);
      window.removeEventListener('air-sync-completed', refresh);
      clearInterval(id);
    };
  }, []);

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      setState(airSyncService.getShareState());
      if (okMsg) showToast(okMsg, 'success');
    } catch {
      showToast('Action de partage impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (value.trim().length >= 3) {
      const q = value.trim().toLowerCase();
      const all = UserManager.getInstance().getAllUsers();
      const filtered = all
        .filter(u =>
          u.windowsUsername.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map(u => ({ windowsUsername: u.windowsUsername, displayName: u.displayName }));
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (username: string) => {
    setDraft(username);
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleAdd = () => {
    const u = draft.trim();
    if (!u) return;
    setDraft('');
    setSuggestions([]);
    setShowSuggestions(false);
    void run(() => airSyncService.addPartner(u), 'Invitation de partage envoyée');
  };

  // En mode web, le serveur tient lieu de dossier commun : le partage est
  // toujours disponible dès que la synchro est active.
  const networkReady = isWebApp() || state.enabled;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
          <Share2 className="h-4 w-4 text-gray-500" />
          Partage du module avec d'autres utilisateurs
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Indiquez les utilisateurs avec qui partager vos mesures AIR. Le partage{' '}
          <strong>fusionne</strong> vos mesures en un module commun. Ajouter une personne lui
          envoie une <strong>invitation</strong> : dès qu'elle l'<strong>accepte</strong> (un
          clic), le partage est actif. Inutile que chacun invite l'autre — accepter suffit.
          Une invitation reçue peut aussi être refusée.
        </p>
      </div>

      {!networkReady && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2.5 py-2">
          La synchronisation réseau n'est pas disponible : le partage est inactif.
        </div>
      )}

      {/* Invitations entrantes */}
      {state.incoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-emerald-600" />
            Invitations reçues
          </div>
          {state.incoming.map(u => (
            <div key={u} className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 py-1.5">
              <Users className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="text-sm text-gray-800 flex-1 truncate">{u}</span>
              <button
                disabled={busy}
                onClick={() => run(() => airSyncService.acceptInvite(u), 'Partage accepté')}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Accepter
              </button>
              <button
                disabled={busy}
                onClick={() => run(() => airSyncService.declineInvite(u))}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Refuser
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Partenaires déclarés */}
      <div className="space-y-1.5">
        {state.partners.length === 0 && (
          <div className="text-xs text-gray-400 italic">Aucun partenaire de partage déclaré.</div>
        )}
        {state.partners.map(p => (
          <div key={p.username} className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5">
            <Users className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-800 flex-1 truncate">{p.username}</span>
            {p.status === 'shared' ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                Partagé ✓
              </span>
            ) : (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                En attente d'acceptation
              </span>
            )}
            <button
              disabled={busy}
              onClick={() => run(() => airSyncService.removePartner(p.username))}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
              title="Retirer ce partenaire"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Ajout */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { handleAdd(); }
              if (e.key === 'Escape') { setShowSuggestions(false); }
            }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="Nom d'utilisateur du partenaire (dès 3 caractères)"
            disabled={!networkReady || busy}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:bg-gray-50 disabled:opacity-60"
          />
          {showSuggestions && (
            <ul className="absolute z-20 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map(s => (
                <li
                  key={s.windowsUsername}
                  onMouseDown={() => selectSuggestion(s.windowsUsername)}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-emerald-50 text-sm"
                >
                  <Users className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-800">{s.windowsUsername}</span>
                  {s.displayName && s.displayName !== s.windowsUsername && (
                    <span className="text-gray-400 truncate">{s.displayName}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={handleAdd}
          disabled={!networkReady || busy || !draft.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Inviter
        </button>
      </div>
    </section>
  );
};

const AIRBackupsSection = () => {
  const { showToast } = useToast();
  const [backups, setBackups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBackups(await airSyncService.listBackups());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRestore = async (filename: string) => {
    if (!window.confirm(`Restaurer la sauvegarde « ${filename} » ? Vos mesures AIR actuelles seront remplacées.`)) return;
    setRestoring(filename);
    try {
      const ok = await airSyncService.restoreFromBackup(filename);
      showToast(ok ? 'Sauvegarde restaurée' : 'Restauration impossible', ok ? 'success' : 'error');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
          <RotateCcw className="h-4 w-4 text-gray-500" />
          Sauvegardes
        </h3>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Actualiser
        </button>
      </div>
      {backups.length === 0 ? (
        <div className="text-xs text-gray-400 italic">Aucune version archivée.</div>
      ) : (
        <ul className="space-y-1 max-h-48 overflow-y-auto">
          {backups.map(f => (
            <li key={f} className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5">
              <span className="text-xs text-gray-700 flex-1 truncate">{f}</span>
              <button
                disabled={restoring !== null}
                onClick={() => handleRestore(f)}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 rounded-md disabled:opacity-50"
              >
                {restoring === f ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Restaurer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
