'use client';

/**
 * Paramètres → « Gestion des TJ » — administrateur général uniquement.
 *
 * Chaque TJ est un espace de données STRICTEMENT séparé (enquêtes, carto,
 * instruction, AIR, documents, clés E2EE…). L'administrateur local de chaque
 * TJ y gère normalement comptes, habilitations et invitations ; ce panneau
 * permet en parallèle à l'administrateur général de :
 *  - voir qui est dans quel TJ, avec quel statut et quel accès aux données ;
 *  - lire les indicateurs d'activité de chaque TJ (compteurs scellés pour lui
 *    seul par les postes du TJ — le serveur ne les lit pas) ;
 *  - créer un compte directement dans un TJ (mot de passe provisoire) ;
 *  - changer un statut (membre, administrateur local, suspendu), déplacer un
 *    compte, lui donner un nouveau mot de passe provisoire ;
 *  - créer, renommer un TJ, régénérer son code d'accès, et l'ouvrir.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Landmark, RefreshCw, Copy, Check, Edit2, X, KeyRound, Users, UserPlus, BarChart3, Lock } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { estSuperAdmin } from '@/lib/web/identite';
import { getClePriveeAdmin, ouvrirPourAdmin, type SealedEnvelope } from '@/lib/web/escrow';
import { totaliser, type Indicateurs } from '@/lib/web/indicateurs';

interface TjRow {
  id: string;
  name: string;
  hasCode: boolean;
  codeUpdatedAt: string | null;
  createdAt: string;
  members: number;
  suspendus: number;
  admins: string[];
  initialized: boolean;
  pending: number;
  escrow: { savedAt: string | null, savedBy: string | null } | null;
  myAccess: boolean;
  indicateurs: Array<SealedEnvelope | null>;
}

interface AccountRow {
  username: string;
  displayName: string;
  role: 'admin' | 'member';
  tjs: string[];
  tjAdmins?: string[];
  suspendu?: boolean;
  acces: 'general' | 'actif' | 'invite' | 'en-attente';
  lastLoginAt?: string | null;
}

type Totaux = ReturnType<typeof totaliser>;
type Statut = 'membre' | 'admin' | 'suspendu';

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

const ACCES: Record<AccountRow['acces'], { label: string, cls: string }> = {
  general: { label: 'accès général', cls: 'text-gray-500 bg-gray-50 border-gray-200' },
  actif: { label: 'accès actif', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  invite: { label: 'invité', cls: 'text-sky-700 bg-sky-50 border-sky-200' },
  'en-attente': { label: 'en attente d’invitation', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
};

const statutDe = (a: AccountRow, tjId: string): Statut =>
  a.suspendu ? 'suspendu' : (a.tjAdmins || []).includes(tjId) ? 'admin' : 'membre';

const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

export const AdminTJPanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();
  const { showToast } = useToast();
  const [tjs, setTjs] = useState<TjRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [activeTj, setActiveTj] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [totaux, setTotaux] = useState<Record<string, Totaux | null>>({});

  // secret affiché une seule fois (code d'accès d'un TJ ou mot de passe provisoire)
  const [secret, setSecret] = useState<{ titre: string, valeur: string, aide: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // création / renommage de TJ
  const [showAddTj, setShowAddTj] = useState(false);
  const [newTjName, setNewTjName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmRegenId, setConfirmRegenId] = useState<string | null>(null);
  // création de compte
  const [addUserTj, setAddUserTj] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ username: '', displayName: '', tjAdmin: false });

  const load = useCallback(async () => {
    setLoading(true);
    const { status, json } = await apiJson('/api/tjs');
    if (status === 200) {
      setTjs((json.tjs as TjRow[]) || []);
      setAccounts((json.accounts as AccountRow[]) || []);
      setActiveTj(String(json.activeTj || ''));
    } else {
      showToast(String(json.error || 'Chargement impossible'), 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Indicateurs : ouverts ici, avec la clé d'administration en mémoire vive.
  useEffect(() => {
    const cle = getClePriveeAdmin();
    if (!cle) return;
    let annule = false;
    (async () => {
      const out: Record<string, Totaux | null> = {};
      for (const tj of tjs) {
        const liste: Indicateurs[] = [];
        for (const env of tj.indicateurs) {
          if (!env) continue;
          try { liste.push(await ouvrirPourAdmin<Indicateurs>(cle, env)); } catch { /* scellé pour une autre clé */ }
        }
        out[tj.id] = liste.length ? totaliser(liste) : null;
      }
      if (!annule) setTotaux(out);
    })();
    return () => { annule = true; };
  }, [tjs]);

  if (!checkIsAdmin() || !estSuperAdmin()) {
    return <div className="text-gray-500">Accès réservé à l&apos;administrateur général.</div>;
  }

  const nameOf = (id: string) => tjs.find(t => t.id === id)?.name || id;
  const montrerSecret = (titre: string, valeur: string, aide: string) => { setSecret({ titre, valeur, aide }); setCopied(false); };

  // ── tribunaux ──
  const handleCreateTj = async () => {
    if (newTjName.trim().length < 2) { showToast('Nom du tribunal requis', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs', { name: newTjName.trim() });
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Création refusée'), 'error'); return; }
    const tj = json.tj as { id: string, name: string };
    montrerSecret(`Code d’accès de « ${tj.name} »`, String(json.code),
      'À remettre de vive voix à la personne qui administrera ce tribunal : la première inscrite avec ce code en devient l’administratrice locale. Vous pouvez aussi créer les comptes vous-même ci-dessous.');
    setShowAddTj(false); setNewTjName('');
    load();
  };

  const handleRename = async (id: string) => {
    if (editName.trim().length < 2) { showToast('Nom trop court', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs', { id, name: editName.trim() }, 'PATCH');
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Renommage refusé'), 'error'); return; }
    setEditingId(null);
    load();
  };

  const handleRegenCode = async (id: string) => {
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs', { id, regenerateCode: true }, 'PATCH');
    setBusy(false);
    setConfirmRegenId(null);
    if (status !== 200) { showToast(String(json.error || 'Régénération refusée'), 'error'); return; }
    montrerSecret(`Nouveau code d’accès de « ${nameOf(id)} »`, String(json.code), 'L’ancien code ne fonctionne plus.');
    load();
  };

  const handleSwitch = async (tjId: string) => {
    setBusy(true);
    const { status, json } = await apiJson('/api/auth/switch-tj', { tj: tjId });
    if (status !== 200) { setBusy(false); showToast(String(json.error || 'Bascule refusée'), 'error'); return; }
    window.location.reload();
  };

  // ── comptes ──
  const patch = async (username: string, action: string, extra: Record<string, unknown> = {}) => {
    const { status, json } = await apiJson('/api/tjs/comptes', { username, action, ...extra }, 'PATCH');
    if (status !== 200) throw new Error(String(json.error || 'Modification refusée'));
    return json;
  };

  const handleStatut = async (a: AccountRow, statut: Statut) => {
    if (statut === 'suspendu' && !confirm(`Suspendre ${a.displayName} ? Il ne pourra plus se connecter.`)) return;
    setBusy(true);
    try {
      if (statut === 'suspendu') {
        await patch(a.username, 'suspendre');
      } else {
        if (a.suspendu) await patch(a.username, 'reactiver');
        await patch(a.username, 'admin-local', { valeur: statut === 'admin' });
      }
      showToast(`${a.displayName} : ${statut === 'admin' ? 'administrateur local' : statut}`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Erreur', 'error');
    } finally {
      setBusy(false);
      load();
    }
  };

  const handleMove = async (a: AccountRow, tjId: string) => {
    if (!confirm(`Déplacer ${a.displayName} vers ${nameOf(tjId)} ? Son accès à ${nameOf(a.tjs[0])} sera coupé ; il devra être invité dans ${nameOf(tjId)}.`)) return;
    setBusy(true);
    try { await patch(a.username, 'tribunal', { tj: tjId }); showToast(`${a.displayName} déplacé`, 'success'); }
    catch (e) { showToast(e instanceof Error ? e.message : 'Erreur', 'error'); }
    finally { setBusy(false); load(); }
  };

  const handleResetPassword = async (a: AccountRow) => {
    if (!confirm(`Donner un nouveau mot de passe provisoire à ${a.displayName} ? L'actuel cessera de fonctionner.`)) return;
    setBusy(true);
    try {
      const r = await patch(a.username, 'mot-de-passe');
      montrerSecret(`Mot de passe provisoire de ${a.displayName}`, String(r.motDePasse),
        'À remettre de vive voix. Il le changera dans Paramètres → Mon profil. Ses données ne sont pas touchées.');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Erreur', 'error'); }
    finally { setBusy(false); }
  };

  const handleCreateUser = async (tjId: string) => {
    if (!newUser.username.trim()) { showToast('Identifiant requis', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs/comptes', { ...newUser, tj: tjId });
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Création refusée'), 'error'); return; }
    montrerSecret(`Compte ${newUser.username} créé dans ${nameOf(tjId)}`, String(json.motDePasse),
      'Mot de passe provisoire, à remettre de vive voix. L’accès aux données suit la règle commune : invitation par un administrateur du TJ (ou, TJ vierge et compte administrateur local, création des clés à sa première connexion). Habilitations : dans le TJ, Paramètres → Utilisateurs & accès.');
    setAddUserTj(null);
    setNewUser({ username: '', displayName: '', tjAdmin: false });
    load();
  };

  const copier = () => {
    if (!secret) return;
    navigator.clipboard?.writeText(secret.valeur).then(() => setCopied(true)).catch(() => {});
  };

  const cle = getClePriveeAdmin();
  const membresDe = (tjId: string) => accounts.filter(a => a.role !== 'admin' && a.tjs[0] === tjId);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <Landmark className="h-4 w-4 text-emerald-600" />
          Gestion des TJ
        </h3>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">
          Chaque tribunal est un espace <b>strictement séparé</b>. Son administrateur local y gère comptes, habilitations et
          invitations — c&apos;est la voie normale ; vous pouvez agir ici en parallèle. Vous seul ouvrez n&apos;importe quel
          tribunal (« Ouvrir ») ; chaque ouverture est journalisée. Les indicateurs sont des compteurs scellés pour vous
          par les postes du TJ : le serveur ne les lit pas.
        </p>
      </div>

      {secret && (
        <div className="border-2 border-amber-400 bg-amber-50 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <KeyRound className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-amber-900">{secret.titre}</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-lg font-mono font-bold tracking-wider text-amber-900 bg-white border border-amber-300 rounded px-3 py-1.5">{secret.valeur}</code>
                <button className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 border border-amber-300 rounded px-2 py-1.5 bg-white hover:bg-amber-100" onClick={copier}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copié' : 'Copier'}
                </button>
              </div>
              <p className="text-[11px] text-amber-800 mt-2 leading-relaxed"><b>Notez-le maintenant : il ne sera plus affiché.</b> {secret.aide}</p>
            </div>
            <button className="p-1 rounded hover:bg-amber-100" onClick={() => setSecret(null)} aria-label="Fermer"><X className="h-4 w-4 text-amber-700" /></button>
          </div>
        </div>
      )}

      {!cle && (
        <div className="flex items-start gap-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <Lock className="h-3.5 w-3.5 text-gray-400 mt-0.5" />
          <span>Indicateurs verrouillés : ils s&apos;ouvrent avec votre clé d&apos;administration, chargée lorsque vous
            déverrouillez l&apos;application avec votre phrase personnelle (reconnectez-vous).</span>
        </div>
      )}

      {loading && <div className="text-sm text-gray-400">Chargement…</div>}

      {!loading && tjs.map(tj => {
        const t = totaux[tj.id];
        const membres = membresDe(tj.id);
        return (
          <section key={tj.id} className="border border-gray-200 rounded-lg">
            {/* En-tête du TJ */}
            <div className="p-3 flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 rounded-t-lg">
              <Landmark className={`h-4 w-4 flex-shrink-0 ${tj.id === activeTj ? 'text-emerald-600' : 'text-gray-400'}`} />
              <div className="min-w-0 flex-1">
                {editingId === tj.id ? (
                  <div className="flex items-center gap-2">
                    <input className="border border-gray-300 rounded px-2 py-1 text-sm flex-1" value={editName} autoFocus
                      onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRename(tj.id); }} />
                    <button className="p-1 rounded hover:bg-emerald-50" onClick={() => handleRename(tj.id)} disabled={busy} aria-label="Valider"><Check className="h-4 w-4 text-emerald-600" /></button>
                    <button className="p-1 rounded hover:bg-gray-100" onClick={() => setEditingId(null)} aria-label="Annuler"><X className="h-4 w-4 text-gray-500" /></button>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <span className="truncate">{tj.name}</span>
                      {tj.id === activeTj && <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">ouvert</span>}
                    </div>
                    <div className="text-[11px] text-gray-600 flex flex-wrap items-center gap-x-1.5">
                      <span>Admin local : <b>{tj.admins.length ? tj.admins.join(', ') : (tj.id === 'default' ? 'vous' : 'aucun')}</b></span>
                      <span className="text-gray-300">·</span>
                      <span><Users className="inline h-3 w-3 mr-0.5" />{tj.members} compte{tj.members > 1 ? 's' : ''}{tj.suspendus ? ` (${tj.suspendus} suspendu${tj.suspendus > 1 ? 's' : ''})` : ''}</span>
                      <span className="text-gray-300">·</span>
                      <span>{tj.initialized ? 'clés créées' : <span className="text-amber-700">clés non créées</span>}</span>
                      {tj.pending > 0 && (<><span className="text-gray-300">·</span><span className="text-amber-700">{tj.pending} en attente d&apos;invitation</span></>)}
                      {tj.id !== 'default' && (<>
                        <span className="text-gray-300">·</span>
                        <span>{tj.myAccess ? 'votre accès : ouvert' : tj.escrow ? 'votre accès : prêt' : <span className="text-amber-700">votre accès : pas encore déposé</span>}</span>
                      </>)}
                    </div>
                  </>
                )}
              </div>
              {editingId !== tj.id && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {tj.id !== activeTj && (
                    <button className="text-[11px] font-semibold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded px-2 py-1 disabled:opacity-50"
                      title="Basculer sur ce tribunal (l'application se recharge : rien n'est partagé entre TJ)" onClick={() => handleSwitch(tj.id)} disabled={busy}>
                      Ouvrir
                    </button>
                  )}
                  <button className="p-1.5 rounded hover:bg-gray-100" title="Renommer" onClick={() => { setEditingId(tj.id); setEditName(tj.name); }}>
                    <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                  {confirmRegenId === tj.id ? (
                    <span className="flex items-center gap-1 text-[11px]">
                      <span className="text-red-600 font-semibold">Nouveau code ?</span>
                      <button className="p-1 rounded hover:bg-red-50" onClick={() => handleRegenCode(tj.id)} disabled={busy} aria-label="Confirmer"><Check className="h-3.5 w-3.5 text-red-600" /></button>
                      <button className="p-1 rounded hover:bg-gray-100" onClick={() => setConfirmRegenId(null)} aria-label="Annuler"><X className="h-3.5 w-3.5 text-gray-500" /></button>
                    </span>
                  ) : (
                    <button className="p-1.5 rounded hover:bg-gray-100" title={tj.hasCode ? "Régénérer le code d'accès" : "Générer un code d'accès"} onClick={() => setConfirmRegenId(tj.id)}>
                      <RefreshCw className="h-3.5 w-3.5 text-gray-500" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Indicateurs */}
            <div className="px-3 py-2 border-b border-gray-100 text-[11px] text-gray-600 flex flex-wrap items-center gap-x-4 gap-y-1">
              <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
              {!cle ? <span className="text-gray-400">verrouillés</span>
                : !t ? <span className="text-gray-400">aucun indicateur publié pour l&apos;instant</span>
                  : (<>
                    <span><b>{t.enCours}</b> enquêtes en cours</span>
                    <span><b>{t.misEnCause}</b> mis en cause</span>
                    <span><b>{t.archives}</b> archivées</span>
                    <span><b>{t.enInstruction}</b> passées à l&apos;instruction</span>
                    <span><b>{t.instructionsEnCours}</b> instructions en cours</span>
                    <span><b>{t.misEnExamen}</b> mis en examen</span>
                    <span><b>{t.mesuresAirActives}</b> mesures AIR actives</span>
                    <span className="text-gray-400">maj {date(t.maj)}</span>
                  </>)}
            </div>

            {/* Membres */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-1.5 font-semibold">Compte</th>
                    <th className="px-3 py-1.5 font-semibold">Statut</th>
                    <th className="px-3 py-1.5 font-semibold">Données</th>
                    <th className="px-3 py-1.5 font-semibold">Vu le</th>
                    <th className="px-3 py-1.5 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {membres.map(a => (
                    <tr key={a.username} className={a.suspendu ? 'opacity-60' : ''}>
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-gray-800">{a.displayName}</div>
                        <div className="text-[11px] text-gray-400">{a.username}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <select className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" disabled={busy}
                          value={statutDe(a, tj.id)} onChange={e => handleStatut(a, e.target.value as Statut)}>
                          <option value="membre">Membre</option>
                          <option value="admin">Administrateur local</option>
                          <option value="suspendu">Suspendu</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[10px] font-semibold border rounded-full px-1.5 py-0.5 whitespace-nowrap ${ACCES[a.acces].cls}`}>{ACCES[a.acces].label}</span>
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-gray-500">{date(a.lastLoginAt)}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <select className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" disabled={busy}
                            value="" onChange={e => { if (e.target.value) handleMove(a, e.target.value); }} title="Déplacer vers un autre tribunal">
                            <option value="">Déplacer…</option>
                            {tjs.filter(x => x.id !== tj.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <button className="p-1 rounded hover:bg-gray-100 disabled:opacity-40" disabled={busy}
                            title="Nouveau mot de passe provisoire" onClick={() => handleResetPassword(a)}>
                            <KeyRound className="h-3.5 w-3.5 text-gray-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {membres.length === 0 && (
                    <tr><td className="px-3 py-2 text-[11px] text-gray-400" colSpan={5}>Aucun compte{tj.id === 'default' ? ' (hors vous)' : ''}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Création de compte */}
            <div className="p-3 border-t border-gray-100">
              {addUserTj === tj.id ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[11px] text-gray-500">Identifiant
                    <input className="block border border-gray-300 rounded px-2 py-1 text-sm w-40" placeholder="p.nom" value={newUser.username}
                      onChange={e => setNewUser({ ...newUser, username: e.target.value })} autoFocus />
                  </label>
                  <label className="text-[11px] text-gray-500">Nom affiché
                    <input className="block border border-gray-300 rounded px-2 py-1 text-sm w-44" placeholder="P. Nom" value={newUser.displayName}
                      onChange={e => setNewUser({ ...newUser, displayName: e.target.value })} />
                  </label>
                  <label className="text-[11px] text-gray-600 flex items-center gap-1 pb-1.5">
                    <input type="checkbox" className="accent-emerald-600" checked={newUser.tjAdmin}
                      onChange={e => setNewUser({ ...newUser, tjAdmin: e.target.checked })} />
                    administrateur local
                  </label>
                  <button className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50"
                    onClick={() => handleCreateUser(tj.id)} disabled={busy || !newUser.username.trim()}>Créer</button>
                  <button className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5" onClick={() => setAddUserTj(null)}>Annuler</button>
                </div>
              ) : (
                <button className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                  onClick={() => { setAddUserTj(tj.id); setNewUser({ username: '', displayName: '', tjAdmin: false }); }}>
                  <UserPlus className="h-3.5 w-3.5" /> Créer un compte dans ce TJ
                </button>
              )}
            </div>
          </section>
        );
      })}

      {/* Création de TJ */}
      {showAddTj ? (
        <div className="border border-gray-200 rounded-lg p-3 space-y-2">
          <div className="text-sm font-semibold text-gray-700">Nouveau tribunal</div>
          <input className="border border-gray-300 rounded px-2 py-1.5 text-sm w-full" placeholder="Nom (ex. TJ Lille)" value={newTjName} autoFocus
            onChange={e => setNewTjName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleCreateTj(); }} />
          <p className="text-[11px] text-gray-500 leading-relaxed">
            Un code d&apos;accès sera affiché <b>une seule fois</b>. La première personne inscrite avec ce code devient
            l&apos;administratrice locale et crée les clés du tribunal. Vous pouvez aussi l&apos;ouvrir et l&apos;initialiser
            vous-même, puis y créer les comptes.
          </p>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50"
              onClick={handleCreateTj} disabled={busy || newTjName.trim().length < 2}>
              <Plus className="h-3.5 w-3.5" /> Créer le tribunal
            </button>
            <button className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2" onClick={() => setShowAddTj(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <button className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 hover:bg-emerald-50 rounded px-3 py-1.5"
          onClick={() => setShowAddTj(true)}>
          <Plus className="h-3.5 w-3.5" /> Créer un tribunal
        </button>
      )}
    </div>
  );
};
