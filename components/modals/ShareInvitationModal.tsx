'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Share2, Check, X, Clock, Loader2, Users } from 'lucide-react';
import { airSyncService } from '@/utils/dataSync/AIRSyncService';
import { instructionSyncService } from '@/utils/dataSync/InstructionSyncService';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { UserManager } from '@/utils/userManager';

type InviteModule = 'air' | 'instruction';
interface Invite { module: InviteModule; username: string }

const MODULE_LABEL: Record<InviteModule, string> = {
  air: 'Suivi AIR',
  instruction: 'Instruction',
};

const serviceFor = (m: InviteModule) =>
  m === 'air' ? airSyncService : instructionSyncService;

const inviteKey = (i: Invite) => `${i.module}:${i.username}`;

/**
 * Surveille les invitations de partage entrantes (modules AIR et instruction) et
 * affiche une fenêtre pour chacune : « Oui, partager » active le partage en un
 * clic (acceptInvite), « Refuser » la masque définitivement, « Plus tard » la
 * remet à la prochaine détection. Monté une seule fois, au niveau de l'app.
 */
export const ShareInvitationModal = () => {
  const { hasModule } = useUser();
  const { showToast } = useToast();
  const [queue, setQueue] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  // Invitations repoussées (« Plus tard ») pour cette session uniquement.
  const snoozedRef = useRef<Set<string>>(new Set());

  const collect = useCallback(() => {
    const found: Invite[] = [];
    if (hasModule('air')) {
      for (const u of airSyncService.getShareState().incoming) found.push({ module: 'air', username: u });
    }
    if (hasModule('instructions')) {
      for (const u of instructionSyncService.getShareState().incoming) found.push({ module: 'instruction', username: u });
    }
    const seen = new Set<string>();
    const next: Invite[] = [];
    for (const inv of found) {
      const k = inviteKey(inv);
      if (seen.has(k) || snoozedRef.current.has(k)) continue;
      seen.add(k);
      next.push(inv);
    }
    setQueue(next);
  }, [hasModule]);

  useEffect(() => {
    collect();
    window.addEventListener('air-share-changed', collect);
    window.addEventListener('instruction-share-changed', collect);
    window.addEventListener('air-sync-completed', collect);
    window.addEventListener('instructions-sync-completed', collect);
    const id = setInterval(collect, 10000);
    return () => {
      window.removeEventListener('air-share-changed', collect);
      window.removeEventListener('instruction-share-changed', collect);
      window.removeEventListener('air-sync-completed', collect);
      window.removeEventListener('instructions-sync-completed', collect);
      clearInterval(id);
    };
  }, [collect]);

  const current = queue[0];
  if (!current) return null;

  const label = MODULE_LABEL[current.module];
  const svc = serviceFor(current.module);
  const displayName =
    UserManager.getInstance().getAllUsers().find(u => u.windowsUsername === current.username)?.displayName
    || current.username;

  const accept = async () => {
    setBusy(true);
    try {
      await svc.acceptInvite(current.username);
      showToast(`Partage « ${label} » activé avec ${displayName}`, 'success');
    } catch {
      showToast('Activation du partage impossible', 'error');
    } finally {
      setBusy(false);
      collect();
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await svc.declineInvite(current.username);
    } catch {
      /* non bloquant */
    } finally {
      setBusy(false);
      collect();
    }
  };

  const later = () => {
    snoozedRef.current.add(inviteKey(current));
    setQueue(q => q.slice(1));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200 bg-emerald-50">
          <Share2 className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-semibold text-gray-800">Invitation de partage</h2>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Users className="h-4 w-4 text-gray-400 shrink-0" />
            <span>
              <strong>{displayName}</strong>
              {displayName !== current.username && (
                <span className="text-gray-400"> ({current.username})</span>
              )}{' '}
              souhaite partager le module <strong>{label}</strong> avec vous.
            </span>
          </div>
          <p className="text-xs text-gray-500">
            En acceptant, vos {current.module === 'air' ? 'mesures AIR' : "dossiers d'instruction"} et
            les siens seront <strong>fusionnés</strong> en un module commun. Vous pourrez retirer ce
            partage à tout moment dans les Paramètres.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button
            onClick={decline}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" /> Refuser
          </button>
          <button
            onClick={later}
            disabled={busy}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg disabled:opacity-50"
          >
            <Clock className="h-3.5 w-3.5" /> Plus tard
          </button>
          <button
            onClick={accept}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Oui, partager
          </button>
        </div>
      </div>
    </div>
  );
};
