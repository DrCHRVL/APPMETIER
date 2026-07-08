'use client';

/**
 * Panneau admin « Tribunaux » (multi-TJ).
 *
 * Chaque TJ est un espace de données STRICTEMENT séparé (enquêtes, carto,
 * instruction, AIR, documents, clés E2EE…) : aucun partage possible entre TJ
 * — secret de l'enquête. Ce panneau permet à l'administrateur unique de :
 *  - créer un TJ (le code d'accès est affiché UNE SEULE fois : le transmettre
 *    au premier utilisateur ; il n'est demandé qu'à la première inscription) ;
 *  - renommer un TJ / régénérer son code d'accès ;
 *  - rattacher un compte à un ou plusieurs TJ (double accès, rarissime) — le
 *    rattachement seul n'ouvre aucune donnée : il faut ensuite inviter
 *    l'utilisateur depuis « Accès & clés » EN ÉTANT sur le TJ concerné.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Landmark, RefreshCw, Copy, Check, Edit2, X, KeyRound, AlertTriangle, Users } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';

interface TjRow {
  id: string;
  name: string;
  hasCode: boolean;
  codeUpdatedAt: string | null;
  createdAt: string;
  members: number;
}

interface AccountRow {
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  tjs: string[];
}

async function apiJson(path: string, body?: unknown, method?: string): Promise<{ status: number, json: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* réponse vide */ }
  return { status: res.status, json };
}

export const AdminTJPanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();
  const { showToast } = useToast();
  const [tjs, setTjs] = useState<TjRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [activeTj, setActiveTj] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // création
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  // code affiché une seule fois (création ou régénération)
  const [freshCode, setFreshCode] = useState<{ tjName: string, code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // renommage
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  // régénération de code (confirmation)
  const [confirmRegenId, setConfirmRegenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { status, json } = await apiJson('/api/tjs');
    if (status === 200) {
      setTjs((json.tjs as TjRow[]) || []);
      setAccounts((json.accounts as AccountRow[]) || []);
      setActiveTj(String(json.activeTj || ''));
    } else {
      showToast(String(json.error || 'Chargement des tribunaux impossible'), 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l&apos;administrateur.</div>;
  }

  const handleCreate = async () => {
    if (newName.trim().length < 2) { showToast('Nom du tribunal requis', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs', { name: newName.trim() });
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Création refusée'), 'error'); return; }
    const tj = json.tj as { id: string, name: string };
    setFreshCode({ tjName: tj.name, code: String(json.code) });
    setCopied(false);
    setShowAddForm(false);
    setNewName('');
    showToast(`Tribunal « ${tj.name} » créé`, 'success');
    load();
  };

  const handleRename = async (id: string) => {
    if (editName.trim().length < 2) { showToast('Nom trop court', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs', { id, name: editName.trim() }, 'PATCH');
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Renommage refusé'), 'error'); return; }
    setEditingId(null);
    showToast('Tribunal renommé', 'success');
    load();
  };

  const handleRegenCode = async (id: string) => {
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs', { id, regenerateCode: true }, 'PATCH');
    setBusy(false);
    setConfirmRegenId(null);
    if (status !== 200) { showToast(String(json.error || 'Régénération refusée'), 'error'); return; }
    const tj = json.tj as { id: string, name: string };
    setFreshCode({ tjName: tj.name, code: String(json.code) });
    setCopied(false);
    showToast('Nouveau code d’accès généré — l’ancien ne fonctionne plus', 'success');
    load();
  };

  const handleToggleAccess = async (account: AccountRow, tjId: string) => {
    const has = account.tjs.includes(tjId);
    const next = has ? account.tjs.filter(t => t !== tjId) : [...account.tjs, tjId];
    if (next.length === 0) { showToast('Un compte doit rester rattaché à au moins un tribunal', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/accounts/tjs', { username: account.username, tjs: next });
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Modification refusée'), 'error'); return; }
    showToast(
      has
        ? `Accès de ${account.displayName} au TJ retiré`
        : `${account.displayName} rattaché — invitez-le ensuite depuis « Accès & clés » en étant sur ce TJ`,
      'success'
    );
    load();
  };

  const copyCode = () => {
    if (!freshCode) return;
    navigator.clipboard?.writeText(freshCode.code).then(() => setCopied(true)).catch(() => {});
  };

  const nameOf = (id: string) => tjs.find(t => t.id === id)?.name || id;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Landmark className="h-4 w-4 text-emerald-600" />
          Tribunaux (multi-TJ)
        </h3>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          Chaque tribunal dispose d&apos;un espace de données <b>strictement séparé</b> : enquêtes, cartographie,
          instruction, AIR, documents et clés de chiffrement. Aucun partage n&apos;est possible entre tribunaux
          (secret de l&apos;enquête). Le code d&apos;accès d&apos;un TJ n&apos;est demandé qu&apos;à la <b>première inscription</b> d&apos;un
          utilisateur ; la validation de son accès aux données passe ensuite, comme aujourd&apos;hui, par votre
          invitation (Accès &amp; clés).
        </p>
      </div>

      {/* Code fraîchement généré — affiché une seule fois */}
      {freshCode && (
        <div className="border-2 border-amber-400 bg-amber-50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <KeyRound className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-900">Code d&apos;accès de « {freshCode.tjName} »</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-lg font-mono font-bold tracking-wider text-amber-900 bg-white border border-amber-300 rounded px-3 py-1.5">
                  {freshCode.code}
                </code>
                <button
                  className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 hover:text-amber-900 border border-amber-300 rounded px-2 py-1.5 bg-white hover:bg-amber-100"
                  onClick={copyCode}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copié' : 'Copier'}
                </button>
              </div>
              <p className="text-[11px] text-amber-800 mt-2 leading-relaxed">
                <b>Notez-le maintenant : il ne sera plus jamais affiché</b> (seule son empreinte est conservée).
                Transmettez-le hors-ligne aux futurs utilisateurs de ce tribunal — il leur sera demandé une seule
                fois, à l&apos;inscription. En cas de perte, régénérez-en un nouveau ci-dessous.
              </p>
            </div>
            <button className="p-1 rounded hover:bg-amber-100" onClick={() => setFreshCode(null)} aria-label="Fermer">
              <X className="h-4 w-4 text-amber-700" />
            </button>
          </div>
        </div>
      )}

      {/* Liste des TJ */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {loading && <div className="p-4 text-sm text-gray-400">Chargement…</div>}
        {!loading && tjs.map(tj => (
          <div key={tj.id} className="p-3 flex items-center gap-3">
            <Landmark className={`h-4 w-4 flex-shrink-0 ${tj.id === activeTj ? 'text-emerald-600' : 'text-gray-400'}`} />
            <div className="min-w-0 flex-1">
              {editingId === tj.id ? (
                <div className="flex items-center gap-2">
                  <input
                    className="border border-gray-300 rounded px-2 py-1 text-sm flex-1"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(tj.id); }}
                    autoFocus
                  />
                  <button className="p-1 rounded hover:bg-emerald-50" onClick={() => handleRename(tj.id)} disabled={busy} aria-label="Valider">
                    <Check className="h-4 w-4 text-emerald-600" />
                  </button>
                  <button className="p-1 rounded hover:bg-gray-100" onClick={() => setEditingId(null)} aria-label="Annuler">
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    <span className="truncate">{tj.name}</span>
                    {tj.id === activeTj && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">actif</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
                    <Users className="h-3 w-3" />
                    {tj.members} compte{tj.members > 1 ? 's' : ''}
                    <span className="text-gray-300">·</span>
                    {tj.hasCode
                      ? `code d'accès défini${tj.codeUpdatedAt ? ` le ${new Date(tj.codeUpdatedAt).toLocaleDateString('fr-FR')}` : ''}`
                      : 'pas de code propre (code d’enrôlement du serveur accepté)'}
                  </div>
                </>
              )}
            </div>
            {editingId !== tj.id && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  className="p-1.5 rounded hover:bg-gray-100"
                  title="Renommer"
                  onClick={() => { setEditingId(tj.id); setEditName(tj.name); }}
                >
                  <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                </button>
                {confirmRegenId === tj.id ? (
                  <span className="flex items-center gap-1 text-[11px]">
                    <span className="text-red-600 font-semibold">Confirmer ?</span>
                    <button className="p-1 rounded hover:bg-red-50" onClick={() => handleRegenCode(tj.id)} disabled={busy} aria-label="Confirmer la régénération">
                      <Check className="h-3.5 w-3.5 text-red-600" />
                    </button>
                    <button className="p-1 rounded hover:bg-gray-100" onClick={() => setConfirmRegenId(null)} aria-label="Annuler">
                      <X className="h-3.5 w-3.5 text-gray-500" />
                    </button>
                  </span>
                ) : (
                  <button
                    className="p-1.5 rounded hover:bg-gray-100"
                    title={tj.hasCode ? "Régénérer le code d'accès (l'ancien cessera de fonctionner)" : "Générer un code d'accès"}
                    onClick={() => setConfirmRegenId(tj.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Création */}
      {showAddForm ? (
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-700">Nouveau tribunal</div>
          <input
            className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full"
            placeholder="Nom (ex. TJ Lille)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            autoFocus
          />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Un code d&apos;accès sera généré et affiché <b>une seule fois</b>. Vous serez rattaché d&apos;office à ce
            tribunal : basculez ensuite dessus (sélecteur en bas de la barre latérale) pour initialiser ses clés de
            chiffrement, puis invitez ses utilisateurs depuis « Accès &amp; clés ».
          </p>
          <div className="flex gap-2">
            <button
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50"
              onClick={handleCreate}
              disabled={busy || newName.trim().length < 2}
            >
              <Plus className="h-3.5 w-3.5" /> Créer le tribunal
            </button>
            <button className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2" onClick={() => setShowAddForm(false)}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:bg-emerald-50 rounded px-3 py-1.5"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="h-3.5 w-3.5" /> Créer un tribunal
        </button>
      )}

      {/* Rattachement des comptes */}
      <div>
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Users className="h-4 w-4 text-emerald-600" />
          Rattachement des comptes aux tribunaux
        </h4>
        <p className="text-[11px] text-gray-500 mt-1 mb-2 leading-relaxed">
          Autoriser un compte sur plusieurs TJ est exceptionnel. Le rattachement seul n&apos;ouvre <b>aucune donnée</b> :
          l&apos;utilisateur doit ensuite recevoir votre invitation E2EE depuis « Accès &amp; clés », <b>en étant vous-même
          sur le TJ concerné</b>. Retirer un rattachement bloque immédiatement l&apos;accès à ce TJ&nbsp;; pensez aussi à
          révoquer son trousseau (Accès &amp; clés) sur ce TJ.
        </p>
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 font-semibold">Compte</th>
                {tjs.map(tj => (
                  <th key={tj.id} className="px-3 py-2 font-semibold whitespace-nowrap">{tj.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map(a => (
                <tr key={a.username}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-800">{a.displayName}</div>
                    <div className="text-[11px] text-gray-400">{a.username}{a.role === 'admin' ? ' · admin' : ''}</div>
                  </td>
                  {tjs.map(tj => (
                    <td key={tj.id} className="px-3 py-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-600 disabled:opacity-40"
                        checked={a.tjs.includes(tj.id)}
                        disabled={busy || a.role === 'admin'}
                        title={a.role === 'admin' ? 'L’admin est rattaché automatiquement aux TJ qu’il crée' : undefined}
                        onChange={() => handleToggleAccess(a, tj.id)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {accounts.length === 0 && !loading && (
                <tr><td className="px-3 py-3 text-gray-400 text-xs" colSpan={1 + tjs.length}>Aucun compte</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3 leading-relaxed">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
        <span>
          Rappel : les modules (cartographie, instruction, enquêtes/AIR) et leurs partages entre collègues restent
          internes à chaque tribunal. Un utilisateur rattaché à deux TJ voit deux espaces totalement disjoints et
          bascule de l&apos;un à l&apos;autre via le sélecteur de la barre latérale — jamais les deux à la fois.
        </span>
      </div>
    </div>
  );
};
