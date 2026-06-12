'use client';

/**
 * Paramètres → Accès & clés (admin, édition web uniquement).
 * Gère le cloisonnement par clé individuelle : qui détient un trousseau,
 * invitations (code à usage unique) et révocations.
 *
 * Source de vérité unique : les périmètres d'un trousseau sont DÉRIVÉS des
 * habilitations contentieux définies dans « Utilisateurs ». On n'invente plus
 * d'accès ici — inviter = livrer exactement les clés des contentieux auxquels
 * le membre est habilité (plus la clé « Données communes », toujours requise).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus, ShieldOff, RefreshCw, Copy, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KNOWN_CONTENTIEUX } from '@/lib/web/keyring';
import type { UsersConfig } from '@/types/userTypes';

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
  // username (minuscule) → identifiants de contentieux habilités (depuis « Utilisateurs »)
  const [entitlements, setEntitlements] = useState<Record<string, string[]>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

  const load = useCallback(async () => {
    setError('');
    try {
      const api = window.electronAPI as unknown as {
        e2ee_listAccounts: () => Promise<AccountRow[]>;
        dataSync_pullUsersConfig?: () => Promise<{ status: string, config?: UsersConfig } | UsersConfig | null>;
      };
      const list = await api.e2ee_listAccounts();
      setAccounts(list);

      // Habilitations contentieux : la seule source de vérité des périmètres.
      const map: Record<string, string[]> = {};
      try {
        const raw = await api.dataSync_pullUsersConfig?.();
        const cfg = (raw && typeof raw === 'object' && 'status' in raw ? (raw as { config?: UsersConfig }).config : raw) as UsersConfig | undefined;
        for (const u of cfg?.users || []) {
          map[u.windowsUsername.toLowerCase()] = (u.contentieux || []).map(c => c.contentieuxId);
        }
      } catch {
        // habilitations indisponibles : on dégrade proprement (périmètres vides + avertissement)
      }
      setEntitlements(map);
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

  /** Périmètres dérivés des habilitations contentieux d'un membre (hors « global »). */
  const ctxScopesFor = (username: string): string[] => {
    const ids = entitlements[username.toLowerCase()] || [];
    // On ne livre que des contentieux connus du trousseau.
    return ids.filter(id => KNOWN_CONTENTIEUX.includes(id)).map(id => `ctx-${id}`);
  };

  const doInvite = async (username: string) => {
    setBusy(username); setError(''); setInvite(null);
    try {
      const scopes = ctxScopesFor(username);
      const api = window.electronAPI as unknown as { e2ee_invite: (u: string, s: string[]) => Promise<{ code: string, scopes: string[] }> };
      const res = await api.e2ee_invite(username, scopes);
      setInvite({ username, code: res.code, scopes: res.scopes });
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

  /** Libellés des périmètres d'un membre, pour aperçu avant invitation. */
  const scopeLabels = (username: string): string[] => {
    const ids = (entitlements[username.toLowerCase()] || []).filter(id => KNOWN_CONTENTIEUX.includes(id));
    return ['Données communes', ...ids.map(id => CTX_LABELS[id] || id)];
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-700" /> Accès &amp; clés individuelles</h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          Chaque membre détient un <b>trousseau personnel</b> (sa propre phrase secrète) contenant les clés des
          contentieux auxquels il est habilité dans « Utilisateurs ». Inviter = lui remettre un <b>code à usage
          unique</b> qui livre exactement ces clés — à transmettre de vive voix ou par canal sûr. Les périmètres ne
          se règlent pas ici : ils suivent les habilitations. Jamais les clés ne transitent en clair par le serveur.
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
              <th className="px-4 py-2.5 font-semibold hidden md:table-cell">Habilitations</th>
              <th className="px-4 py-2.5 font-semibold">Trousseau</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts === null && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Chargement…</td></tr>
            )}
            {accounts?.map((a) => {
              const ctxIds = (entitlements[a.username.toLowerCase()] || []).filter(id => KNOWN_CONTENTIEUX.includes(id));
              const hasEntitlements = ctxIds.length > 0;
              // Incohérence : un trousseau actif mais plus aucune habilitation contentieux.
              const overProvisioned = a.hasKeyring && !hasEntitlements;
              return (
                <tr key={a.username} className="border-t align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.displayName}</div>
                    <div className="text-xs text-gray-400">{a.username} · {a.role === 'admin' ? 'Administrateur' : 'Membre'}{a.tribunal ? ` · ${a.tribunal}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {ctxIds.length > 0 ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {ctxIds.map(id => (
                          <span key={id} className="text-xs font-medium text-gray-700 bg-gray-100 rounded px-1.5 py-0.5">{CTX_LABELS[id] || id}</span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Aucune — à définir dans « Utilisateurs »</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.hasKeyring
                      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">Trousseau actif</span>
                      : a.hasGrant
                        ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2.5 py-1">Invitation en attente</span>
                        : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-100 rounded-full px-2.5 py-1">Sans accès</span>}
                    {overProvisioned && (
                      <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> Trousseau sans habilitation
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                    {confirmRevoke === a.username ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-red-600 font-medium">Révoquer {a.displayName} ?</span>
                        <Button size="sm" variant="destructive" disabled={busy === a.username} onClick={() => doRevoke(a.username)}>
                          {busy === a.username ? '…' : 'Confirmer'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Annuler</Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                        <span className="hidden lg:inline text-[11px] text-gray-400 mr-1" title={scopeLabels(a.username).join(' · ')}>
                          livre : {scopeLabels(a.username).join(' · ')}
                        </span>
                        <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy}
                          onClick={() => { setInvite(null); doInvite(a.username); }}>
                          <UserPlus className="h-3.5 w-3.5" />{busy === a.username ? '…' : (a.hasKeyring || a.hasGrant ? 'Ré-inviter' : 'Inviter')}
                        </Button>
                        {(a.hasKeyring || a.hasGrant) && (
                          <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" disabled={!!busy}
                            onClick={() => setConfirmRevoke(a.username)}>
                            <ShieldOff className="h-3.5 w-3.5" />Révoquer
                          </Button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 leading-relaxed max-w-xl">
          Les périmètres livrés suivent les habilitations contentieux (onglet « Utilisateurs »). Après avoir modifié
          les habilitations d&apos;un membre, <b>ré-invitez-le</b> pour mettre son trousseau à jour. Révoquer supprime
          le trousseau : il ne peut plus rien déchiffrer via l&apos;application. Pour une révocation cryptographique
          (membre parti avec ses clés mémorisées), ré-invitez ensuite les membres restants : les clés seront
          régénérées à la prochaine rotation.
        </p>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={load}><RefreshCw className="h-3.5 w-3.5" />Actualiser</Button>
      </div>
    </div>
  );
};
