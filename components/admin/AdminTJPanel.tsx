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
import { Plus, Landmark, RefreshCw, Copy, Check, Edit2, X, KeyRound, Users, UserPlus, Lock, Unlock, ChevronRight, Search, HelpCircle, Network, AlertTriangle } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { estSuperAdmin } from '@/lib/web/identite';
import { getClePriveeAdmin, ouvrirPourAdmin, type SealedEnvelope } from '@/lib/web/escrow';
import { totaliser, type Indicateurs } from '@/lib/web/indicateurs';
import { debloquerCompte, perimetresDeblocage, type AdminHttp } from '@/lib/web/adminGeneral';
import { CartographieInterTj } from '@/components/admin/CartographieInterTj';
import { identiteSession } from '@/lib/web/identite';

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
  let res: Response;
  try {
    res = await fetch(path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    return { status: 0, json: { error: 'Serveur injoignable' } };
  }
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

/** Accès HTTP de l'administrateur général aux autres TJ (route /api/tjs/donnees). */
const httpAdmin: AdminHttp = {
  get: async (p) => {
    const res = await fetch(p, { credentials: 'same-origin' });
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
  },
  put: async (p, body) => (await fetch(p, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin',
  })).status,
  del: async (p) => (await fetch(p, { method: 'DELETE', credentials: 'same-origin' })).status,
};

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
  // clé d'administration : chargée en arrière-plan après le déverrouillage
  const [cle, setCle] = useState<CryptoKey | null>(() => getClePriveeAdmin());
  useEffect(() => {
    const maj = () => setCle(getClePriveeAdmin());
    window.addEventListener('siral-cle-admin', maj);
    return () => window.removeEventListener('siral-cle-admin', maj);
  }, []);

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
  // affichage : filtre par TJ, recherche transversale, cartes repliées
  const [filtre, setFiltre] = useState<string>('tous');
  const [recherche, setRecherche] = useState('');
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({});
  const [aide, setAide] = useState(false);
  const [cartoOuverte, setCartoOuverte] = useState(false);
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
  }, [tjs, cle]);

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
      'À remettre à la personne qui administrera ce tribunal : la première inscrite avec ce code en devient l’administratrice locale. Vous pouvez aussi créer les comptes vous-même ci-dessous.');
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
        'À remettre à l’intéressé. Il le changera dans Paramètres → Mon profil. Ses données ne sont pas touchées.');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Erreur', 'error'); }
    finally { setBusy(false); }
  };

  /** Débloque l'accès aux données d'un compte : nouvelle invitation (et réinitialisation de son trousseau). */
  const handleDebloquer = async (a: AccountRow, tjId: string) => {
    const cleAdmin = getClePriveeAdmin();
    if (!cleAdmin) { showToast('Clé d’administration non chargée : reconnectez-vous avec votre phrase', 'error'); return; }
    setBusy(true);
    try {
      const proposes = await perimetresDeblocage(tjId, a.username, cleAdmin, httpAdmin);
      const ctx = proposes.filter(s => s.startsWith('ctx-')).map(s => s.slice(4));
      // Les habilitations sont modifiables par les membres : confirmation explicite.
      if (!confirm(`Débloquer l'accès de ${a.displayName} ?\n\nContentieux transmis : ${ctx.length ? ctx.join(', ') : 'aucun (habilitations à régler dans le TJ)'}.`
        + `${a.acces === 'actif' ? '\nSon trousseau actuel sera remplacé (phrase perdue).' : ''}\n\nVérifiez que ce périmètre est bien le sien.`)) return;
      const { code } = await debloquerCompte(tjId, a.username, cleAdmin, httpAdmin, identiteSession()?.username || 'admin', proposes);
      montrerSecret(`Code d’invitation de ${a.displayName}`, code,
        `À remettre à l’intéressé : à sa connexion, il le saisit puis choisit sa phrase personnelle. Contentieux : ${ctx.length ? ctx.join(', ') : 'aucun'}.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Déblocage impossible', 'error');
    } finally { setBusy(false); load(); }
  };

  const handleCreateUser = async (tjId: string) => {
    if (!newUser.username.trim()) { showToast('Identifiant requis', 'error'); return; }
    setBusy(true);
    const { status, json } = await apiJson('/api/tjs/comptes', { ...newUser, tj: tjId });
    setBusy(false);
    if (status !== 200) { showToast(String(json.error || 'Création refusée'), 'error'); return; }
    montrerSecret(`Compte ${newUser.username} créé dans ${nameOf(tjId)}`, String(json.motDePasse),
      'Mot de passe provisoire, à remettre à l’intéressé. L’accès aux données suit la règle commune : invitation par un administrateur du TJ (ou, TJ vierge et compte administrateur local, création des clés à sa première connexion). Habilitations : dans le TJ, Paramètres → Utilisateurs & accès.');
    setAddUserTj(null);
    setNewUser({ username: '', displayName: '', tjAdmin: false });
    load();
  };

  const copier = () => {
    if (!secret) return;
    navigator.clipboard?.writeText(secret.valeur).then(() => setCopied(true)).catch(() => {});
  };

  const membresDe = (tjId: string) => accounts.filter(a => a.role !== 'admin' && a.tjs[0] === tjId);
  const membres = accounts.filter(a => a.role !== 'admin');
  const enAttente = membres.filter(a => !a.suspendu && a.acces === 'en-attente').length;
  const suspendus = membres.filter(a => a.suspendu).length;
  const q = recherche.trim().toLowerCase();
  const resultats = q
    ? membres.filter(a => a.displayName.toLowerCase().includes(q) || a.username.toLowerCase().includes(q))
    : [];
  const tjsVisibles = filtre === 'tous' ? tjs : tjs.filter(t => t.id === filtre);
  const estOuvert = (id: string) => filtre === id || !!ouverts[id];
  const basculer = (id: string) => setOuverts(o => ({ ...o, [id]: !estOuvert(id) }));

  const pastille = (texte: React.ReactNode, ton: 'gris' | 'vert' | 'ambre' | 'rouge' = 'gris', titre?: string) => {
    const cls = { gris: 'bg-gray-100 text-gray-600', vert: 'bg-emerald-50 text-emerald-700', ambre: 'bg-amber-50 text-amber-700', rouge: 'bg-red-50 text-red-700' }[ton];
    return <span title={titre} className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${cls}`}>{texte}</span>;
  };

  /** Ligne d'un compte (dans la carte d'un TJ, ou dans les résultats de recherche avec la colonne Tribunal). */
  const ligneCompte = (a: AccountRow, avecTj: boolean) => {
    const tjId = a.tjs[0];
    const tj = tjs.find(t => t.id === tjId);
    return (
      <tr key={a.username} className={a.suspendu ? 'opacity-60' : ''}>
        <td className="px-3 py-1.5">
          <div className="font-medium text-gray-800">{a.displayName}</div>
          <div className="text-xs font-mono text-gray-600" title="Identifiant de connexion">{a.username}</div>
        </td>
        {avecTj && <td className="px-3 py-1.5 text-xs text-gray-700 whitespace-nowrap">{nameOf(tjId)}</td>}
        <td className="px-3 py-1.5">
          <select className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" disabled={busy}
            value={statutDe(a, tjId)} onChange={e => handleStatut(a, e.target.value as Statut)}>
            <option value="membre">Membre</option>
            <option value="admin">Administrateur local</option>
            <option value="suspendu">Suspendu</option>
          </select>
        </td>
        <td className="px-3 py-1.5">
          <span className={`text-[10px] font-semibold border rounded-full px-1.5 py-0.5 whitespace-nowrap ${ACCES[a.acces].cls}`}>{ACCES[a.acces].label}</span>
        </td>
        <td className="px-3 py-1.5 text-[11px] text-gray-500 whitespace-nowrap">{date(a.lastLoginAt)}</td>
        <td className="px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <select className="border border-gray-300 rounded px-1.5 py-1 text-xs bg-white" disabled={busy}
              value="" onChange={e => { if (e.target.value) handleMove(a, e.target.value); }} title="Déplacer vers un autre tribunal">
              <option value="">Déplacer…</option>
              {tjs.filter(x => x.id !== tjId).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="p-1 rounded hover:bg-gray-100 disabled:opacity-40" disabled={busy}
              title="Nouveau mot de passe provisoire" onClick={() => handleResetPassword(a)}>
              <KeyRound className="h-3.5 w-3.5 text-gray-500" />
            </button>
            <button className="p-1 rounded hover:bg-gray-100 disabled:opacity-40" disabled={busy || !cle || !tj?.escrow}
              title={!tj?.escrow ? 'Séquestre du TJ absent : son administrateur doit se connecter une fois' : 'Débloquer l’accès aux données (nouvelle invitation)'}
              onClick={() => handleDebloquer(a, tjId)}>
              <Unlock className="h-3.5 w-3.5 text-gray-500" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const enteteTableau = (avecTj: boolean) => (
    <thead>
      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
        <th className="px-3 py-1.5 font-semibold">Compte</th>
        {avecTj && <th className="px-3 py-1.5 font-semibold">Tribunal</th>}
        <th className="px-3 py-1.5 font-semibold">Statut</th>
        <th className="px-3 py-1.5 font-semibold">Données</th>
        <th className="px-3 py-1.5 font-semibold">Vu le</th>
        <th className="px-3 py-1.5 font-semibold">Actions</th>
      </tr>
    </thead>
  );

  const tuile = (valeur: number, libelle: string, ton?: 'ambre' | 'rouge') => (
    <div className={`rounded-lg border px-3 py-2 ${ton === 'ambre' && valeur ? 'border-amber-200 bg-amber-50' : ton === 'rouge' && valeur ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <div className={`text-lg font-semibold tabular-nums ${ton === 'ambre' && valeur ? 'text-amber-700' : ton === 'rouge' && valeur ? 'text-red-700' : 'text-gray-800'}`}>{valeur}</div>
      <div className="text-[11px] text-gray-500">{libelle}</div>
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-emerald-600" />
            Gestion des TJ
            <button className="p-0.5 rounded hover:bg-gray-100" title="Comment ça marche" onClick={() => setAide(v => !v)}>
              <HelpCircle className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </h3>
          {aide && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed max-w-3xl">
              Chaque tribunal est un espace <b>strictement séparé</b>. Son administrateur local y gère comptes, habilitations et
              invitations — c&apos;est la voie normale ; vous pouvez tout faire ici en parallèle : créer, débloquer, ouvrir.
              « Ouvrir » bascule l&apos;application sur un tribunal (journalisé). Les indicateurs sont des compteurs scellés pour
              vous par les postes du TJ : le serveur ne les lit pas.
            </p>
          )}
        </div>
        <button className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5"
          onClick={() => setShowAddTj(v => !v)}>
          <Plus className="h-3.5 w-3.5" /> Créer un tribunal
        </button>
      </div>

      {showAddTj && (
        <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1" placeholder="Nom du tribunal (ex. TJ Lille)" value={newTjName} autoFocus
              onChange={e => setNewTjName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleCreateTj(); }} />
            <button className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50"
              onClick={handleCreateTj} disabled={busy || newTjName.trim().length < 2}>Créer</button>
            <button className="text-xs text-gray-500 hover:text-gray-700 px-2" onClick={() => setShowAddTj(false)}>Annuler</button>
          </div>
          <p className="text-[11px] text-gray-500">
            Un code d&apos;accès s&apos;affichera <b>une seule fois</b> : la première personne inscrite avec ce code devient
            l&apos;administratrice locale. Vous pouvez aussi l&apos;ouvrir, l&apos;initialiser vous-même et créer les comptes.
          </p>
        </div>
      )}

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
        <div className="flex items-start gap-2 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <Lock className="h-3.5 w-3.5 text-gray-400 mt-0.5" />
          <span>Clé d&apos;administration non chargée (indicateurs, déblocage, cartographie) : elle se charge quelques secondes
            après le déverrouillage ; sinon, reconnectez-vous avec votre phrase personnelle.</span>
        </div>
      )}

      {loading && <div className="text-sm text-gray-400">Chargement…</div>}

      {!loading && (<>
        {/* Synthèse */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {tuile(tjs.length, tjs.length > 1 ? 'tribunaux' : 'tribunal')}
          {tuile(membres.length, 'comptes (hors vous)')}
          {tuile(enAttente, 'en attente d’invitation', 'ambre')}
          {tuile(suspendus, suspendus > 1 ? 'suspendus' : 'suspendu', 'rouge')}
        </div>

        {/* Filtre par TJ + recherche */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {[{ id: 'tous', name: 'Tous' }, ...tjs].map(t => {
              // pendant une recherche, les résultats couvrent tous les TJ : aucun filtre en surbrillance
              const actif = !q && filtre === t.id;
              const nb = t.id === 'tous' ? membres.length : membresDe(t.id).length;
              const alerte = t.id !== 'tous' && membresDe(t.id).some(a => !a.suspendu && a.acces === 'en-attente');
              return (
                <button key={t.id} onClick={() => { setFiltre(t.id); setRecherche(''); }}
                  className={`flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 ${actif ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
                  {t.name}
                  <span className={`tabular-nums text-[10px] ${actif ? 'text-emerald-100' : 'text-gray-400'}`}>{nb}</span>
                  {alerte && <span className={`h-1.5 w-1.5 rounded-full ${actif ? 'bg-white' : 'bg-amber-500'}`} title="Inscrits en attente d’invitation" />}
                </button>
              );
            })}
          </div>
          <div className="relative ml-auto">
            <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
            <input className="border border-gray-300 rounded-full pl-7 pr-3 py-1 text-xs w-60" placeholder="Rechercher un compte, tous TJ…"
              value={recherche} onChange={e => setRecherche(e.target.value)} />
          </div>
        </div>

        {/* Résultats de recherche (tous tribunaux) */}
        {q ? (
          <section className="border border-gray-200 rounded-lg overflow-x-auto">
            <div className="px-3 py-2 text-xs text-gray-600 border-b border-gray-100 bg-gray-50/60">
              {resultats.length} compte{resultats.length > 1 ? 's' : ''} pour « {recherche.trim()} »
            </div>
            <table className="w-full text-sm">
              {enteteTableau(true)}
              <tbody className="divide-y divide-gray-50">
                {resultats.map(a => ligneCompte(a, true))}
                {resultats.length === 0 && <tr><td className="px-3 py-2 text-[11px] text-gray-400" colSpan={6}>Aucun compte</td></tr>}
              </tbody>
            </table>
          </section>
        ) : tjsVisibles.map(tj => {
          const t = totaux[tj.id];
          const liste = membresDe(tj.id);
          const ouvert = estOuvert(tj.id);
          return (
            <section key={tj.id} className="border border-gray-200 rounded-lg bg-white">
              {/* En-tête du TJ (cliquable : déplier / replier) */}
              <div className={`px-3 py-2.5 flex items-center gap-2 ${ouvert ? 'border-b border-gray-100 bg-gray-50/60 rounded-t-lg' : 'rounded-lg'}`}>
                <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => basculer(tj.id)} disabled={editingId === tj.id}>
                  <ChevronRight className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${ouvert ? 'rotate-90' : ''}`} />
                  <Landmark className={`h-4 w-4 flex-shrink-0 ${tj.id === activeTj ? 'text-emerald-600' : 'text-gray-400'}`} />
                  {editingId === tj.id ? null : (
                    <span className="text-sm font-semibold text-gray-800 truncate">{tj.name}</span>
                  )}
                  {tj.id === activeTj && editingId !== tj.id && pastille('ouvert ici', 'vert')}
                </button>
                {editingId === tj.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input className="border border-gray-300 rounded px-2 py-1 text-sm flex-1" value={editName} autoFocus
                      onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRename(tj.id); }} />
                    <button className="p-1 rounded hover:bg-emerald-50" onClick={() => handleRename(tj.id)} disabled={busy} aria-label="Valider"><Check className="h-4 w-4 text-emerald-600" /></button>
                    <button className="p-1 rounded hover:bg-gray-100" onClick={() => setEditingId(null)} aria-label="Annuler"><X className="h-4 w-4 text-gray-500" /></button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {pastille(<>Admin : {tj.admins.length ? tj.admins.join(', ') : (tj.id === 'default' ? 'vous' : 'aucun')}</>, tj.admins.length || tj.id === 'default' ? 'gris' : 'ambre')}
                    {pastille(<><Users className="inline h-3 w-3 mr-0.5 -mt-0.5" />{tj.members}</>, 'gris', 'Comptes')}
                    {tj.pending > 0 && pastille(`${tj.pending} en attente`, 'ambre')}
                    {tj.suspendus > 0 && pastille(`${tj.suspendus} suspendu${tj.suspendus > 1 ? 's' : ''}`, 'rouge')}
                    {!tj.initialized && pastille('clés non créées', 'ambre')}
                    {tj.id !== 'default' && pastille(tj.myAccess ? 'accès ouvert' : tj.escrow ? 'accès prêt' : 'accès non déposé',
                      tj.myAccess || tj.escrow ? 'vert' : 'ambre', 'Votre accès à ce tribunal')}
                    {tj.id !== activeTj && (
                      <button className="text-[11px] font-semibold text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded px-2 py-0.5 disabled:opacity-50"
                        title="Basculer l'application sur ce tribunal" onClick={() => handleSwitch(tj.id)} disabled={busy}>
                        Ouvrir
                      </button>
                    )}
                  </div>
                )}
              </div>

              {ouvert && (<>
                {/* Indicateurs */}
                <div className="px-3 py-2.5 border-b border-gray-100">
                  {!cle ? <div className="text-[11px] text-gray-400">Indicateurs verrouillés</div>
                    : !t ? <div className="text-[11px] text-gray-400">Aucun indicateur publié pour l&apos;instant</div>
                      : (
                        <div className="grid grid-cols-3 sm:grid-cols-7 gap-1.5">
                          {[
                            [t.enCours, 'enquêtes en cours'], [t.misEnCause, 'mis en cause'], [t.archives, 'archivées'],
                            [t.enInstruction, 'à l’instruction'], [t.instructionsEnCours, 'instructions'], [t.misEnExamen, 'mis en examen'],
                            [t.mesuresAirActives, 'mesures AIR'],
                          ].map(([v, l]) => (
                            <div key={String(l)} className="rounded bg-gray-50 px-2 py-1.5 text-center">
                              <div className="text-sm font-semibold tabular-nums text-gray-800">{v}</div>
                              <div className="text-[10px] text-gray-500 leading-tight">{l}</div>
                            </div>
                          ))}
                        </div>
                      )}
                  {cle && t && <div className="text-[10px] text-gray-400 mt-1">mis à jour le {date(t.maj)}</div>}
                </div>

                {/* Comptes */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    {enteteTableau(false)}
                    <tbody className="divide-y divide-gray-50">
                      {liste.map(a => ligneCompte(a, false))}
                      {liste.length === 0 && (
                        <tr><td className="px-3 py-2 text-[11px] text-gray-400" colSpan={5}>Aucun compte{tj.id === 'default' ? ' (hors vous)' : ''}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pied : création de compte + gestion du TJ */}
                <div className="px-3 py-2.5 border-t border-gray-100 flex flex-wrap items-center gap-3">
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
                  <div className="ml-auto flex items-center gap-1 text-[11px] text-gray-500">
                    <button className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100" onClick={() => { setEditingId(tj.id); setEditName(tj.name); }}>
                      <Edit2 className="h-3 w-3" /> Renommer
                    </button>
                    {confirmRegenId === tj.id ? (
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-600" /><span className="text-red-600 font-semibold">L&apos;ancien code ne marchera plus</span>
                        <button className="p-1 rounded hover:bg-red-50" onClick={() => handleRegenCode(tj.id)} disabled={busy} aria-label="Confirmer"><Check className="h-3.5 w-3.5 text-red-600" /></button>
                        <button className="p-1 rounded hover:bg-gray-100" onClick={() => setConfirmRegenId(null)} aria-label="Annuler"><X className="h-3.5 w-3.5 text-gray-500" /></button>
                      </span>
                    ) : (
                      <button className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100" onClick={() => setConfirmRegenId(tj.id)}>
                        <RefreshCw className="h-3 w-3" /> {tj.hasCode ? 'Nouveau code d’accès' : 'Générer un code d’accès'}
                      </button>
                    )}
                  </div>
                </div>
              </>)}
            </section>
          );
        })}

        {/* Cartographie inter-TJ (repliée par défaut) */}
        <section className="border border-gray-200 rounded-lg bg-white">
          <button className="w-full px-3 py-2.5 flex items-center gap-2 text-left" onClick={() => setCartoOuverte(v => !v)}>
            <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${cartoOuverte ? 'rotate-90' : ''}`} />
            <Network className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-semibold text-gray-800">Cartographie inter-TJ</span>
            <span className="text-[11px] text-gray-400">personnes mises en cause dans plusieurs tribunaux</span>
          </button>
          {cartoOuverte && (
            <div className="px-3 pb-3">
              <CartographieInterTj tjs={tjs.filter(t => t.escrow).map(t => ({ id: t.id, name: t.name }))} clePrivee={cle} http={httpAdmin} sansCadre />
            </div>
          )}
        </section>
      </>)}
    </div>
  );
};
