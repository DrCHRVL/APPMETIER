'use client';

import React from 'react';
import { WifiOff, ShieldCheck, RefreshCw, Trash2, Info, KeyRound, CheckCircle2 } from 'lucide-react';
import * as offlineMode from '@/lib/web/offlineMode';
import { NetworkStatusManager } from '@/utils/networkStatusManager';
import { useToast } from '@/contexts/ToastContext';
import { Switch } from '../ui/switch';

// ──────────────────────────────────────────────
// PANEL : Mode hors-ligne (« poste préparé », calqué sur PISTE)
// ──────────────────────────────────────────────
//
// Permet de travailler sans réseau : on scelle une copie du trousseau sur le
// poste, chiffrée sous un code de déverrouillage. Au retour sans réseau,
// WebGate propose l'entrée hors-ligne avec ce code. La resynchronisation passe
// par le bouton « Synchroniser » (moteur de sync + arbitrage des conflits
// existants). Fonctionnalité propre à l'édition web.

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const OfflineModePanel: React.FC<{ onSync?: () => void | Promise<void> }> = ({ onSync }) => {
  const { showToast } = useToast();
  const isWeb = typeof window !== 'undefined'
    && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

  const [status, setStatus] = React.useState(() => offlineMode.getOfflineStatus());
  const [code, setCode] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [forcedOffline, setForcedOffline] = React.useState(() => NetworkStatusManager.isForcedOffline());

  const refresh = () => setStatus(offlineMode.getOfflineStatus());
  const canPrepare = offlineMode.canPrepareNow();

  const handlePrepare = async () => {
    if (code.length < 4) { showToast('Code trop court (4 caractères minimum)', 'error'); return; }
    if (code !== confirm) { showToast('Les deux codes ne correspondent pas', 'error'); return; }
    setBusy(true);
    try {
      await offlineMode.prepareOffline(code);
      setCode(''); setConfirm(''); refresh();
      showToast('Poste préparé pour le hors-ligne', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Préparation impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleForget = () => {
    if (!window.confirm('Oublier ce poste ? Le trousseau hors-ligne sera supprimé de cette machine (les données restent intactes).')) return;
    offlineMode.clearOffline();
    refresh();
    showToast('Poste hors-ligne oublié', 'success');
  };

  const toggleOffline = (value: boolean) => {
    NetworkStatusManager.setForcedOffline(value);
    setForcedOffline(value);
  };

  const handleSync = async () => {
    if (!onSync) return;
    setSyncing(true);
    try {
      await onSync();
    } finally {
      setSyncing(false);
    }
  };

  if (!isWeb) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h2 className="text-lg font-semibold text-gray-900">Mode hors-ligne</h2>
        <div className="flex items-start gap-2 text-sm text-gray-600 bg-slate-50 border border-slate-200 rounded-md p-3">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
          <p>Cette préparation est propre à l’édition web (PWA). L’édition bureau travaille déjà en local sur le
            partage réseau du service.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header + état */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Mode hors-ligne</h2>
          {status.prepared ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
              <CheckCircle2 className="h-3 w-3" /> Poste préparé
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2 py-0.5">
              Non préparé
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Préparez ce poste pour consulter et saisir vos dossiers <strong>sans réseau</strong>. Les données sont déjà
          chiffrées sur cette machine ; il reste à sceller votre trousseau sous un code de déverrouillage.
        </p>
      </div>

      {/* Marche à suivre (calquée sur PISTE) */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Comment utiliser le hors-ligne</h3>
        <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
          <li><strong>Préparer</strong> (ici, connecté) : choisissez un code, puis « Préparer le poste ».</li>
          <li><strong>Passer hors-ligne</strong> : activez « Mode hors ligne » avant de vous déconnecter.</li>
          <li><strong>Consulter &amp; saisir</strong> : rouvrez SIRAL sans réseau, saisissez votre code, travaillez normalement.</li>
          <li><strong>Synchroniser au retour</strong> : une fois reconnecté, cliquez « Synchroniser » pour remonter vos saisies et récupérer les mises à jour.</li>
        </ol>
        <div className="mt-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>Reconnectez-vous <strong>sous 48 heures</strong> pour synchroniser et limiter les conflits. Votre code
            chiffre le trousseau sur ce poste et sert à le déverrouiller hors-ligne — ne l’oubliez pas.</p>
        </div>
      </section>

      {/* Préparer ce poste */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-1.5">
          <KeyRound className="h-4 w-4 text-slate-500" /> Préparer ce poste pour le hors-ligne
        </h3>
        {status.prepared && (
          <p className="text-xs text-gray-500 mb-3">
            Préparé le {fmt(status.preparedAt)}{status.identity?.displayName ? ` pour ${status.identity.displayName}` : ''}
            {status.tj?.name ? ` · ${status.tj.name}` : ''}.
            {status.expired
              ? <span className="text-amber-700"> Fenêtre de 48 h dépassée — reconnectez-vous et resynchronisez.</span>
              : <span> Fenêtre conseillée jusqu’au {fmt(status.expiresAt)}.</span>}
            {' '}Re-préparer met à jour le trousseau scellé (utile après un changement de clés ou de code).
          </p>
        )}
        {!canPrepare && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
            Rouvrez et déverrouillez l’application en ligne pour pouvoir préparer ce poste.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Code de déverrouillage</label>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!canPrepare || busy}
              placeholder="4 caractères minimum"
              className="mt-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Confirmer le code</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={!canPrepare || busy}
              onKeyDown={(e) => { if (e.key === 'Enter' && canPrepare) handlePrepare(); }}
              className="mt-1 w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm disabled:bg-slate-50"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handlePrepare}
            disabled={!canPrepare || busy || !code || !confirm}
            className="inline-flex items-center gap-1.5 bg-indigo-900 text-white text-sm font-medium rounded-md px-4 py-2 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            {busy ? 'Préparation…' : (status.prepared ? 'Re-préparer le poste' : 'Préparer le poste')}
          </button>
          {status.prepared && (
            <button
              onClick={handleForget}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-600 rounded-md px-2 py-2"
            >
              <Trash2 className="h-4 w-4" /> Oublier ce poste
            </button>
          )}
        </div>
      </section>

      {/* Activer / Synchroniser */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <WifiOff className="h-4 w-4 text-slate-500" /> Activer le mode hors ligne
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Suspend la synchronisation : vos modifications sont enregistrées localement jusqu’à la reconnexion.
              Non conservé au prochain lancement.
            </p>
          </div>
          <Switch checked={forcedOffline} onCheckedChange={toggleOffline} />
        </div>

        {onSync && (
          <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4 text-slate-500" /> Synchroniser au retour
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Remonte vos saisies hors-ligne et récupère les mises à jour de l’équipe. En cas de divergence, une
                fenêtre d’arbitrage des conflits s’ouvre.
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 bg-white border border-slate-300 text-sm font-medium rounded-md px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Synchronisation…' : 'Synchroniser'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
