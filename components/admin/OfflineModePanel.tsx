'use client';

import React from 'react';
import { WifiOff, ShieldCheck, RefreshCw, Trash2, Info, KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import * as offlineMode from '@/lib/web/offlineMode';
import { useToast } from '@/contexts/ToastContext';

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
  // Test « à froid » du code hors-ligne (vérifie que le plan B fonctionne).
  const [testCode, setTestCode] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<null | 'ok' | 'ko'>(null);

  const refresh = () => setStatus(offlineMode.getOfflineStatus());
  const canPrepare = offlineMode.canPrepareNow();

  const handlePrepare = async () => {
    if (code.length < 8) { showToast('Code trop court (8 caractères minimum)', 'error'); return; }
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

  const handleVerify = async () => {
    if (!testCode) return;
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await offlineMode.verifyOfflineCode(testCode);
      setTestResult(ok ? 'ok' : 'ko');
      if (ok) {
        showToast('Code valide — l’entrée hors-ligne fonctionnera', 'success');
        setTestCode('');
      } else {
        showToast('Ce code n’ouvre pas le trousseau scellé', 'error');
      }
    } finally {
      setTesting(false);
    }
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
          <li><strong>Préparer une fois</strong> (ici, connecté) : choisissez un code, puis « Préparer le poste ».</li>
          <li><strong>Rien à activer</strong> : la copie hors-ligne se met à jour toute seule à chaque connexion. Vous ne « passez » pas hors-ligne, vous <em>tombez</em> hors-ligne — SIRAL prend le relais automatiquement.</li>
          <li><strong>En cas de coupure</strong> : rouvrez SIRAL sans réseau. L’écran hors-ligne s’ouvre de lui-même — saisissez votre code et travaillez normalement.</li>
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
            {' '}Cette copie se rafraîchit automatiquement à chaque connexion en ligne — vous n’avez à re-préparer que pour changer de code.
          </p>
        )}
        {status.prepared && status.stale && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Vos clés ont changé depuis la dernière préparation et n’ont pas pu être remises à jour toutes seules. <strong>Re-préparez le poste</strong> pour que le secours hors-ligne reste utilisable.</span>
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
              placeholder="8 caractères minimum"
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

      {/* Le hors-ligne est automatique + test à froid */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        <div className="flex items-start gap-2">
          <WifiOff className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-gray-800">Le hors-ligne est automatique</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Rien à activer. Si le réseau est injoignable à l’ouverture, SIRAL vous propose directement d’entrer avec
              votre code et travaille sur les données déjà présentes sur ce poste. Vos saisies se synchronisent dès le
              retour du réseau. Le mode hors-ligne se subit — il n’a pas à se déclencher à la main.
            </p>
          </div>
        </div>

        {status.prepared && (
          <div className="border-t border-slate-100 pt-4">
            <div className="text-sm font-medium text-gray-800 flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 text-slate-500" /> Vérifier mon code hors-ligne
            </div>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">
              Testez dès maintenant, au calme : le jour d’une coupure n’est pas le moment de découvrir un code oublié.
              Ce test n’ouvre aucune session — il confirme seulement que le code déverrouille le trousseau scellé.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={testCode}
                onChange={(e) => { setTestCode(e.target.value); setTestResult(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && testCode) handleVerify(); }}
                placeholder="Code de déverrouillage hors-ligne"
                className="flex-1 border border-slate-300 rounded-md px-3 py-1.5 text-sm"
              />
              <button
                onClick={handleVerify}
                disabled={testing || !testCode}
                className="inline-flex items-center gap-1.5 bg-white border border-slate-300 text-sm font-medium rounded-md px-3 py-2 hover:bg-slate-50 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {testing ? 'Vérification…' : 'Tester'}
              </button>
            </div>
            {testResult === 'ok' && (
              <p className="text-[11px] text-emerald-700 mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> Code valide — l’entrée hors-ligne fonctionnera.
              </p>
            )}
            {testResult === 'ko' && (
              <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Ce code n’ouvre pas le trousseau. Re-préparez le poste avec un code dont vous êtes sûr.
              </p>
            )}
          </div>
        )}

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
