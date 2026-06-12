'use client';

/**
 * Paramètres → Accès & clés (admin, édition web uniquement).
 * Gère le cloisonnement par clé individuelle : qui détient un trousseau,
 * invitations (code à usage unique) et révocations.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus, ShieldOff, RefreshCw, Copy, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KNOWN_CONTENTIEUX } from '@/lib/web/keyring';

interface AccountRow {
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  tribunal: string | null;
  lastLoginAt: string | null;
  hasKeyring: boolean;
  hasGrant: boolean;
}

interface InviteResult { username: string, code: string, scopes: string[] }

const CTX_LABELS: Record<string, string> = { crimorg: 'CRIM ORG', ecofi: 'ECOFI', enviro: 'ENVIRO' };

export const AdminAccessPanel = () => {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [scopeSel, setScopeSel] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(KNOWN_CONTENTIEUX.map(id => [id, true])));
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

  const load = useCallback(async () => {
    setError('');
    try {
      const api = window.electronAPI as unknown as { e2ee_listAccounts: () => Promise<AccountRow[]> };
      setAccounts(await api.e2ee_listAccounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => { if (isWeb) load(); }, [isWeb, load]);

  if (!isWeb) {
    return (
      <div className="p-6 text-sm text-gray-500">
        La gestion des trousseaux de clés individuels est disponible dans l&apos;édition web de SIRAL.
        Dans l&apos;app de bureau, les accès restent gérés par l&apos;onglet « Utilisateurs ».
      </div>
    );
  }

  const doInvite = async (username: string) => {
    setBusy(username); setError(''); setInvite(null);
    try {
      const scopes = KNOWN_CONTENTIEUX.filter(id => scopeSel[id]).map(id => `ctx-${id}`);
      const api = window.electronAPI as unknown as { e2ee_invite: (u: string, s: string[]) => Promise<{ code: string, scopes: string[] }> };
      const res = await api.e2ee_invite(username, scopes);
      setInvite({ username, code: res.code, scopes: res.scopes });
      setInviteTarget(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invitation impossible');
    } finally { setBusy(null); }
  };

  const doRevoke = async (username: string) => {
    setBusy(username); setError('');
    try {
      const api = window.electronAPI as unknown as { e2ee_revoke: (u: string) => Promise<boolean> };
      await api.e2ee_revoke(username);
      setConfirmRevoke(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Révocation impossible');
    } finally { setBusy(null); }
  };

  const copyCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-700" /> Accès &amp; clés individuelles</h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Chaque membre détient un <b>trousseau personnel</b> (sa propre phrase secrète) contenant les clés des
          contentieux auxquels il a accès. Inviter = lui remettre un <b>code à usage unique</b> à transmettre
          de vive voix ou par canal sûr — jamais les clés ne transitent en clair par le serveur.
        </p>
      </div>

      {invite && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <div className="text-sm font-semibold text-emerald-900">Invitation prête pour {invite.username}</div>
          <div className="flex items-center gap-2">
            <code className="text-base font-mono font-bold tracking-wider bg-white border border-emerald-200 rounded px-3 py-1.5">{invite.code}</code>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copyCode(invite.code)}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copié' : 'Copier'}
            </Button>
          </div>
          <p className="text-xs text-emerald-800">
            Périmètres : {invite.scopes.map(s => s === 'global' ? 'Données communes' : (CTX_LABELS[s.replace('ctx-', '')] || s)).join(' · ')}.
            Ce code ne sera <b>plus jamais affiché</b> — transmettez-le maintenant. Il est à usage unique.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2.5 font-semibold">Membre</th>
              <th className="px-4 py-2.5 font-semibold hidden sm:table-cell">Tribunal</th>
              <th className="px-4 py-2.5 font-semibold">Accès</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts === null && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Chargement…</td></tr>
            )}
            {accounts?.map((a) => (
              <tr key={a.username} className="border-t">
                <td className="px-4 py-3">
                  <div className="font-medium">{a.displayName}</div>
                  <div className="text-xs text-gray-400">{a.username} · {a.role === 'admin' ? 'Administrateur' : 'Membre'}</div>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell text-gray-600">{a.tribunal || '—'}</td>
                <td className="px-4 py-3">
                  {a.hasKeyring
                    ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">Trousseau actif</span>
                    : a.hasGrant
                      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2.5 py-1">Invitation en attente</span>
                      : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">Sans accès</span>}
                </td>
                <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                  {inviteTarget === a.username ? (
                    <span className="inline-flex items-center gap-2 flex-wrap justify-end">
                      {KNOWN_CONTENTIEUX.map(id => (
                        <label key={id} className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <input type="checkbox" checked={!!scopeSel[id]} onChange={(e) => setScopeSel(s => ({ ...s, [id]: e.target.checked }))} />
                          {CTX_LABELS[id] || id}
                        </label>
                      ))}
                      <Button size="sm" className="gap-1.5" disabled={busy === a.username} onClick={() => doInvite(a.username)}>
                        <UserPlus className="h-3.5 w-3.5" />{busy === a.username ? '…' : 'Générer le code'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setInviteTarget(null)}>Annuler</Button>
                    </span>
                  ) : confirmRevoke === a.username ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-xs text-red-600 font-medium">Révoquer {a.displayName} ?</span>
                      <Button size="sm" variant="destructive" disabled={busy === a.username} onClick={() => doRevoke(a.username)}>
                        {busy === a.username ? '…' : 'Confirmer'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Annuler</Button>
                    </span>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy}
                        onClick={() => { setInvite(null); setInviteTarget(a.username); }}>
                        <UserPlus className="h-3.5 w-3.5" />{a.hasKeyring || a.hasGrant ? 'Ré-inviter' : 'Inviter'}
                      </Button>
                      {(a.hasKeyring || a.hasGrant) && (
                        <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" disabled={!!busy}
                          onClick={() => setConfirmRevoke(a.username)}>
                          <ShieldOff className="h-3.5 w-3.5" />Révoquer
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 leading-relaxed max-w-xl">
          Révoquer supprime le trousseau du membre : il ne peut plus rien déchiffrer via l&apos;application.
          Pour une révocation au niveau cryptographique (membre parti avec ses clés mémorisées),
          ré-invitez ensuite les membres restants : les clés de contentieux seront régénérées à la prochaine rotation.
        </p>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" />Actualiser</Button>
      </div>
    </div>
  );
};
