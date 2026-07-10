'use client';

/**
 * SIRAL — Attaché de justice · panneau d'administration.
 *
 * - État du service (clé-maître, trousseau, Claude Code, boîte mail).
 * - Remise des clés : depuis CE navigateur déverrouillé, les clés brutes des
 *   seuls périmètres confiés partent en HTTPS vers le service attaché, qui
 *   les enveloppe aussitôt avec sa clé-maître. L'app ne les stocke jamais.
 * - Révocation : suppression du trousseau — l'attaché est aveugle aussitôt.
 * - Journal d'audit : chaque action de l'attaché, déchiffrée ici.
 */
import { useCallback, useEffect, useState } from 'react';
import { Scale, KeyRound, ShieldOff, RefreshCw, CheckCircle2, XCircle, Loader2, ScrollText } from 'lucide-react';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface AuditEntry { action: string; at?: string; outil?: string; contexte?: string; [k: string]: unknown }

function Dot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
      <span className={ok ? 'text-gray-700' : 'text-red-600'}>{label}</span>
    </span>
  );
}

export function AdminAttachePanel() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<Array<AuditEntry & { ts: number }>>([]);
  const [showAudit, setShowAudit] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/status');
      setStatus(res.ok ? await res.json() : { unavailable: true, code: res.status });
    } catch {
      setStatus({ unavailable: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const grantKeys = useCallback(async () => {
    if (!status?.scopesAttendus?.length) return;
    if (!window.confirm(
      'Remettre les clés à l\'attaché ?\n\n' +
      `Périmètres : ${status.scopesAttendus.join(', ')}.\n` +
      'Le service attaché pourra déchiffrer ces données pour travailler en votre absence. ' +
      'Révocable à tout moment depuis ce panneau.'
    )) return;
    setWorking('grant');
    setNotice(null);
    try {
      const keys = await eapi().attache_exportKeys(status.scopesAttendus);
      const missing = (status.scopesAttendus as string[]).filter((s) => !keys[s]);
      if (missing.length) {
        setNotice(`Votre trousseau ne contient pas : ${missing.join(', ')} — impossible de remettre ces clés.`);
        return;
      }
      const res = await fetch('/api/attache/keyring', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json().catch(() => ({}));
      setNotice(res.ok ? 'Clés remises — l\'attaché peut travailler.' : `Refusé : ${data.error || res.status}`);
      refresh();
    } finally {
      setWorking(null);
    }
  }, [status, refresh]);

  const revoke = useCallback(async () => {
    if (!window.confirm('Révoquer le trousseau de l\'attaché ?\nIl ne pourra plus rien déchiffrer, immédiatement. Les données ne sont pas touchées.')) return;
    setWorking('revoke');
    try {
      await fetch('/api/attache/keyring', { method: 'DELETE' });
      setNotice('Trousseau révoqué — l\'attaché est aveugle.');
      refresh();
    } finally {
      setWorking(null);
    }
  }, [refresh]);

  const checkMail = useCallback(async () => {
    setWorking('mail');
    try {
      const res = await fetch('/api/attache/inbox', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setNotice(data.ok ? `Relève effectuée${data.ingested?.length ? ` — ${data.ingested.length} nouveau(x) message(s)` : ' — rien de nouveau'}` : `Relève impossible : ${data.error || ''}`);
      refresh();
    } finally {
      setWorking(null);
    }
  }, [refresh]);

  const loadAudit = useCallback(async () => {
    setShowAudit(true);
    try {
      const res = await fetch('/api/attache/audit');
      if (!res.ok) return;
      const { entries } = await res.json();
      const out: Array<AuditEntry & { ts: number }> = [];
      for (const e of entries as Array<{ ts: number; iv: string; ct: string }>) {
        const payload = await eapi().attache_decrypt({ v: 1, encrypted: true, iv: e.iv, ct: e.ct });
        if (payload) out.push({ ...(payload as AuditEntry), ts: e.ts });
      }
      setAudit(out.reverse());
    } catch { /* silencieux */ }
  }, []);

  if (loading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Interrogation du service attaché…</div>;
  }

  if (status?.unavailable) {
    return (
      <div className="space-y-3 p-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-[#2B5746]" />
          <h3 className="text-base font-semibold text-gray-900">Attaché de justice (IA)</h3>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Le service attaché n'est pas joignable. Vérifiez sur le serveur :
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-500">
            <li><code>SIRAL_ATTACHE_URL</code> défini pour l'app (ex. <code>http://attache:8787</code>)</li>
            <li>le conteneur <code>attache</code> démarré (<code>docker compose up -d attache</code>)</li>
            <li><code>SIRAL_ATTACHE_MASTER_KEY</code> défini (générer : <code>openssl rand -hex 32</code>)</li>
          </ul>
          Guide complet : <code>docs/ATTACHE.md</code>
        </div>
      </div>
    );
  }

  const kr = status?.keyring;

  return (
    <div className="space-y-4 p-2">
      <div className="flex items-center gap-2">
        <Scale className="h-5 w-5 text-[#2B5746]" />
        <h3 className="text-base font-semibold text-gray-900">Attaché de justice (IA)</h3>
        <button onClick={refresh} className="ml-auto rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-gray-500">
        Assistant réservé à l'administrateur — invisible des autres utilisateurs. TJ : <b>{status?.tj}</b> ·
        contentieux confié : <b>{status?.contentieux}</b>. Il prépare et agit dans SIRAL (réversible, journalisé) ;
        son unique sortie est un mail vers <b>{status?.mail?.owner || 'votre adresse (non configurée)'}</b>.
      </p>

      {/* État */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
        <Dot ok={status?.masterKey} label="Clé-maître du service" />
        <Dot ok={kr?.granted} label={kr?.granted ? `Trousseau remis (${(kr.scopes || []).join(', ')})` : 'Trousseau non remis'} />
        <Dot ok={status?.claude?.ok} label={status?.claude?.ok ? `Claude Code ${status.claude.version || ''}` : 'Claude Code non authentifié'} />
        <Dot ok={status?.mail?.imap} label="Boîte dédiée (IMAP)" />
        <Dot ok={status?.mail?.smtp} label="Envoi au magistrat (SMTP)" />
        <span className="text-xs text-gray-500">
          Boîte : {status?.inbox ? `${status.inbox.nonTraites} à traiter / ${status.inbox.total}` : '—'}
          {status?.state?.lastFetchAt ? ` · relevée ${new Date(status.state.lastFetchAt).toLocaleString('fr-FR')}` : ''}
        </span>
      </div>

      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={grantKeys}
          disabled={working !== null || !status?.masterKey}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {working === 'grant' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {kr?.granted ? 'Renouveler les clés' : 'Remettre les clés'}
        </button>
        <button
          onClick={revoke}
          disabled={working !== null || !kr?.granted}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          {working === 'revoke' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
          Révoquer
        </button>
        <button
          onClick={checkMail}
          disabled={working !== null || !kr?.granted}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {working === 'mail' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Relever la boîte
        </button>
        <button
          onClick={loadAudit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <ScrollText className="h-3.5 w-3.5" />
          Journal d'audit
        </button>
      </div>

      {kr?.granted && (
        <p className="text-[11px] text-gray-400">
          Clés remises par <b>{kr.grantedBy}</b> le {kr.grantedAt ? new Date(kr.grantedAt).toLocaleString('fr-FR') : '?'}.
          Pour les périmètres confiés, le serveur de l'attaché peut déchiffrer — révoquez au moindre doute.
        </p>
      )}

      {/* Journal d'audit */}
      {showAudit && (
        <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-200">
          <table className="w-full text-left text-[11.5px]">
            <thead className="sticky top-0 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Quand</th>
                <th className="px-2.5 py-1.5 font-medium">Action</th>
                <th className="px-2.5 py-1.5 font-medium">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {audit.length === 0 && (
                <tr><td colSpan={3} className="px-2.5 py-3 text-center text-gray-400">Journal vide (ou déchiffrement en cours)</td></tr>
              )}
              {audit.map((a, i) => (
                <tr key={i} className="align-top">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-400">{new Date(a.ts).toLocaleString('fr-FR')}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-gray-700">{a.action}{a.outil ? ` · ${a.outil}` : ''}</td>
                  <td className="px-2.5 py-1.5 text-gray-500">
                    {Object.entries(a)
                      .filter(([k]) => !['action', 'at', 'ts', 'outil'].includes(k))
                      .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
