'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, Shield, Save, Edit2, X, Check, ChevronDown, AlertCircle, CheckCircle, Clock, Eye, FolderOpen, RefreshCw, KeyRound, Copy, ShieldOff, AlertTriangle } from 'lucide-react';
import { UserManager } from '@/utils/userManager';
import { KNOWN_CONTENTIEUX } from '@/lib/web/keyring';
import {
  UserProfile,
  ContentieuxDefinition,
  GlobalRole,
  ContentieuxRole,
  ContentieuxId,
  ModuleId,
} from '@/types/userTypes';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { copyPlainToClipboard } from '@/utils/richTextExport';

// ──────────────────────────────────────────────
// LABELS
// ──────────────────────────────────────────────

const GLOBAL_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  pra: 'PR / PRA',
  vice_proc: 'Vice-procureur',
  jld: 'JLD',
};

const CONTENTIEUX_ROLE_LABELS: Record<ContentieuxRole, string> = {
  magistrat: 'Magistrat en charge',
  ja: 'Juriste assistante',
};

const MODULE_LABELS: Record<ModuleId, string> = {
  air: 'Suivi AIR',
  instructions: 'Instructions judiciaires',
  mindmap: 'Cartographie mis en cause',
};

/** Libellés courts des contentieux pour l'aperçu des clés livrées. */
const CTX_KEY_LABELS: Record<string, string> = { crimorg: 'CRIM ORG', ecofi: 'ECOFI', enviro: 'ENVIRO' };

/** Périmètres de clés livrés à un membre, dérivés de ses habilitations contentieux. */
const scopesForUser = (user: UserProfile): string[] =>
  user.contentieux
    .map(c => c.contentieuxId)
    .filter(id => KNOWN_CONTENTIEUX.includes(id))
    .map(id => `ctx-${id}`);

/** Libellés lisibles des périmètres livrés (« Données communes » toujours incluse). */
const scopeLabelsForUser = (user: UserProfile): string[] => [
  'Données communes',
  ...user.contentieux
    .map(c => c.contentieuxId)
    .filter(id => KNOWN_CONTENTIEUX.includes(id))
    .map(id => CTX_KEY_LABELS[id] || id),
];

interface InviteResult { username: string; code: string; scopes: string[] }

// ──────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ──────────────────────────────────────────────

export const AdminUsersPanel = () => {
  const { isAdmin: checkIsAdmin, refreshUsers, contentieux: contentieuxDefs, user: currentUser } = useUser();
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New user form state
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newGlobalRole, setNewGlobalRole] = useState<GlobalRole>(null);

  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;

  const loadUsers = useCallback(() => {
    const manager = UserManager.getInstance();
    setUsers(manager.getAllUsers());
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // ── État d'enrôlement / trousseau (édition web) ───────────────────
  // username (minuscule) → état du compte serveur correspondant.
  type AccountState = { exists: boolean; hasKeyring: boolean; hasGrant: boolean };
  const [accountStates, setAccountStates] = useState<Record<string, AccountState>>({});

  const loadAccountStates = useCallback(async () => {
    if (!isWeb) return;
    const api = (typeof window !== 'undefined' ? (window as any).electronAPI : null);
    if (!api?.e2ee_listAccounts) return;
    try {
      const list: Array<{ username: string; displayName: string; role: 'admin' | 'member'; hasKeyring: boolean; hasGrant: boolean }> = await api.e2ee_listAccounts();
      // Unification : tout compte serveur enrôlé doit avoir un profil d'habilitations.
      const manager = UserManager.getInstance();
      const changed = await manager.reconcileWithAccounts(
        list.map(a => ({ username: a.username, displayName: a.displayName, role: a.role })),
      );
      if (changed) { loadUsers(); await refreshUsers(); }
      const map: Record<string, AccountState> = {};
      for (const a of list) map[a.username.toLowerCase()] = { exists: true, hasKeyring: a.hasKeyring, hasGrant: a.hasGrant };
      setAccountStates(map);
    } catch {
      // non bloquant : la liste des comptes peut être momentanément indisponible
    }
  }, [isWeb, loadUsers, refreshUsers]);

  useEffect(() => { loadAccountStates(); }, [loadAccountStates]);

  // ── Accès & clés : invitation (code à usage unique) / révocation ──
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState<string | null>(null);

  const handleInvite = useCallback(async (user: UserProfile) => {
    const username = user.windowsUsername;
    setKeyBusy(username); setInvite(null);
    try {
      const api = (window as any).electronAPI as { e2ee_invite: (u: string, s: string[]) => Promise<{ code: string; scopes: string[] }> };
      const res = await api.e2ee_invite(username, scopesForUser(user));
      setInvite({ username, code: res.code, scopes: res.scopes });
      await loadAccountStates();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Invitation impossible', 'error');
    } finally { setKeyBusy(null); }
  }, [loadAccountStates, showToast]);

  const handleRevoke = useCallback(async (username: string) => {
    setKeyBusy(username);
    try {
      const api = (window as any).electronAPI as { e2ee_revoke: (u: string) => Promise<boolean> };
      await api.e2ee_revoke(username);
      setConfirmRevoke(null);
      if (invite?.username.toLowerCase() === username.toLowerCase()) setInvite(null);
      await loadAccountStates();
      showToast('Trousseau révoqué', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Révocation impossible', 'error');
    } finally { setKeyBusy(null); }
  }, [invite, loadAccountStates, showToast]);

  const copyInviteCode = useCallback(async (code: string) => {
    if (await copyPlainToClipboard(code)) { setCopied(true); setTimeout(() => setCopied(false), 2500); }
  }, []);

  /** Rappelle de ré-inviter le membre (clé à mettre à jour) après une modif d'habilitation. */
  const hintReinviteIfEnrolled = useCallback((username: string) => {
    if (!isWeb) return;
    const st = accountStates[username.toLowerCase()];
    if (st && (st.hasKeyring || st.hasGrant)) {
      showToast('Habilitation modifiée — ré-invitez ce membre (carte dépliée) pour mettre son trousseau à jour.', 'info');
    }
  }, [isWeb, accountStates, showToast]);

  // ── Section "Consultation lecture seule" ──────────────────────────
  type ConsultationStatus = {
    enabled: boolean;
    deployPath: string;
    targetUsername: string;
    activatedAt: string | null;
    lastRefreshedAt: string | null;
    lastError: string | null;
    shellAvailable: boolean;
  };
  const [consultationStatus, setConsultationStatus] = useState<ConsultationStatus | null>(null);
  const [showConsultationForm, setShowConsultationForm] = useState(false);
  const [consTargetUser, setConsTargetUser] = useState('');
  const [consDeployPath, setConsDeployPath] = useState('');
  const [consBusy, setConsBusy] = useState(false);

  const loadConsultationStatus = useCallback(async () => {
    const api = (typeof window !== 'undefined' ? (window as any).electronAPI : null);
    if (!api?.consultation_getStatus) return;
    try {
      const s = await api.consultation_getStatus();
      setConsultationStatus(s);
    } catch (e) {
      // silencieux — pas critique
    }
  }, []);

  useEffect(() => { loadConsultationStatus(); }, [loadConsultationStatus]);

  const handleConsultationActivate = async () => {
    const api = (window as any).electronAPI;
    if (!consTargetUser || !consDeployPath) {
      showToast('Choisissez un utilisateur et un dossier de déploiement', 'error');
      return;
    }
    setConsBusy(true);
    try {
      const res = await api.consultation_activate(consTargetUser, consDeployPath);
      if (res.success) {
        showToast('Consultation activée pour ' + consTargetUser, 'success');
        setShowConsultationForm(false);
        setConsTargetUser('');
        setConsDeployPath('');
        await loadConsultationStatus();
      } else {
        showToast('Échec : ' + (res.error || 'erreur inconnue'), 'error');
      }
    } finally {
      setConsBusy(false);
    }
  };

  const handleConsultationDeactivate = async () => {
    if (!window.confirm('Désactiver la consultation lecture seule ? Les fichiers déposés sur le partage seront supprimés.')) return;
    const api = (window as any).electronAPI;
    setConsBusy(true);
    try {
      const res = await api.consultation_deactivate();
      if (res.success) {
        showToast('Consultation désactivée', 'info');
        await loadConsultationStatus();
      } else {
        showToast('Échec : ' + (res.error || 'erreur inconnue'), 'error');
      }
    } finally {
      setConsBusy(false);
    }
  };

  const handleConsultationPickFolder = async () => {
    const api = (window as any).electronAPI;
    const p = await api.consultation_pickFolder();
    if (p) setConsDeployPath(p);
  };

  const handleConsultationRefresh = async () => {
    const api = (window as any).electronAPI;
    setConsBusy(true);
    try {
      const res = await api.consultation_refreshNow();
      if (res.success) {
        showToast('Données de consultation rafraîchies', 'success');
        await loadConsultationStatus();
      } else {
        showToast('Échec : ' + (res.error || 'erreur inconnue'), 'error');
      }
    } finally {
      setConsBusy(false);
    }
  };

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const handleAddUser = async () => {
    if (!newUsername.trim() || !newDisplayName.trim()) return;

    const manager = UserManager.getInstance();
    const success = await manager.addUser({
      windowsUsername: newUsername.trim(),
      displayName: newDisplayName.trim(),
      globalRole: newGlobalRole,
      contentieux: [],
      modules: [],
    });

    if (success) {
      loadUsers();
      setShowAddForm(false);
      setNewUsername('');
      setNewDisplayName('');
      setNewGlobalRole(null);
      await refreshUsers();
      showToast('Utilisateur créé', 'success');
    } else {
      showToast('Erreur : cet identifiant existe peut-être déjà', 'error');
    }
  };

  const handleRemoveUser = async (username: string) => {
    if (!confirm(`Supprimer l'utilisateur "${username}" ?`)) return;
    const manager = UserManager.getInstance();
    const success = await manager.removeUser(username);
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast('Utilisateur supprimé', 'info');
    } else {
      showToast('Impossible de supprimer cet utilisateur', 'error');
    }
  };

  const handleUpdateGlobalRole = async (username: string, role: GlobalRole) => {
    // Empêcher l'admin de retirer son propre rôle admin
    if (currentUser?.windowsUsername.toLowerCase() === username.toLowerCase() &&
        currentUser.globalRole === 'admin' && role !== 'admin') {
      showToast('Vous ne pouvez pas retirer votre propre rôle administrateur', 'error');
      return;
    }

    const manager = UserManager.getInstance();
    const success = await manager.updateUser(username, { globalRole: role });
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast('Rôle mis à jour', 'success');
    } else {
      showToast('Erreur lors de la mise à jour du rôle', 'error');
    }
  };

  const handleAssignContentieux = async (username: string, contentieuxId: ContentieuxId, role: ContentieuxRole) => {
    const manager = UserManager.getInstance();
    const success = await manager.assignContentieux(username, contentieuxId, role);
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast('Contentieux attribué', 'success');
      hintReinviteIfEnrolled(username);
    } else {
      showToast('Erreur lors de l\'affectation', 'error');
    }
  };

  const handleUnassignContentieux = async (username: string, contentieuxId: ContentieuxId) => {
    const manager = UserManager.getInstance();
    const success = await manager.unassignContentieux(username, contentieuxId);
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast('Contentieux retiré', 'info');
      hintReinviteIfEnrolled(username);
    } else {
      showToast('Erreur lors du retrait du contentieux', 'error');
    }
  };

  const handleToggleModule = async (username: string, moduleId: ModuleId, enabled: boolean) => {
    const manager = UserManager.getInstance();
    const success = await manager.toggleModule(username, moduleId, enabled);
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast(enabled ? 'Module activé' : 'Module désactivé', 'success');
    } else {
      showToast('Erreur lors de la modification du module', 'error');
    }
  };

  const handleApproveUser = async (username: string) => {
    const manager = UserManager.getInstance();
    const success = await manager.updateUser(username, { approved: true });
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast('Utilisateur approuvé', 'success');
    } else {
      showToast('Erreur lors de l\'approbation', 'error');
    }
  };

  const handleRejectUser = async (username: string) => {
    if (!confirm(`Rejeter et supprimer la demande de "${username}" ? L'utilisateur devra relancer l'app pour refaire une demande.`)) return;
    const manager = UserManager.getInstance();
    const success = await manager.removeUser(username);
    if (success) {
      loadUsers();
      await refreshUsers();
      showToast('Demande rejetée — utilisateur supprimé', 'info');
    } else {
      showToast('Erreur lors du rejet', 'error');
    }
  };

  // Séparer les utilisateurs en attente et les utilisateurs approuvés
  const pendingUsers = users.filter(u => u.approved !== true && u.globalRole !== 'admin');
  const approvedUsers = users.filter(u => u.approved === true || u.globalRole === 'admin');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-600" />
          Gestion des utilisateurs &amp; accès
        </h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Ajouter un utilisateur
        </button>
      </div>

      {/* Rappel cryptographique (édition web) — replié par défaut */}
      {isWeb && (
        <details className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-emerald-900">
          <summary className="text-sm font-semibold flex items-center gap-2 cursor-pointer select-none">
            <KeyRound className="h-4 w-4" /> Accès &amp; clés — comment ça marche
          </summary>
          <div className="text-xs text-emerald-800 mt-2 leading-relaxed space-y-3">
            <p>
              Chaque membre détient un <b>trousseau personnel</b> (déverrouillé par sa phrase secrète) contenant les clés
              des contentieux auxquels il est habilité <i>ci-dessous</i>. Les clés ne transitent <b>jamais en clair</b> par
              le serveur.
            </p>

            <div>
              <p className="font-semibold text-emerald-900">Donner accès à un nouveau membre — dans cet ordre :</p>
              <ol className="list-decimal ml-4 mt-1 space-y-1">
                <li>
                  <b>Créez sa fiche</b> ci-dessous (<i>Ajouter un utilisateur</i>) et cochez ses contentieux &amp; modules.
                  Tant qu&apos;il ne s&apos;est pas enrôlé, son badge affiche <b>« Pas encore enrôlé »</b> et le bouton
                  Inviter n&apos;apparaît pas encore — c&apos;est normal.
                </li>
                <li>
                  <b>Lui s&apos;enrôle</b> : il ouvre l&apos;application et remplit l&apos;écran <i>Enrôlement</i> avec le
                  <b> code d&apos;enrôlement du service</b> (la valeur <code>SIRAL_SETUP_CODE</code>, à lui communiquer de
                  vive voix) puis son mot de passe. ⚠️ Il doit utiliser <b>exactement le même identifiant</b> que celui de
                  sa fiche, sinon les deux ne se relient pas.
                </li>
                <li>
                  <b>Vous l&apos;invitez</b> : son badge passe à <b>« À inviter »</b>. Dépliez sa carte → <b>Inviter</b> :
                  vous obtenez un <b>code à usage unique</b> qui livre exactement ses clés. Transmettez-le maintenant, de
                  vive voix ou par canal sûr — il ne sera <b>plus jamais affiché</b>.
                </li>
                <li>
                  <b>Lui active son trousseau</b> : il saisit ce code d&apos;invitation et choisit sa <b>phrase
                  personnelle</b> (irrécupérable — à noter en lieu sûr). Son badge passe alors à <b>« Trousseau actif »</b>.
                </li>
              </ol>
            </div>

            <p>
              <b>Les badges</b> résument l&apos;état : <i>Pas encore enrôlé</i> (aucun compte) → <i>À inviter</i> (enrôlé,
              sans clés) → <i>Invitation en attente</i> (code remis, pas encore activé) → <i>Trousseau actif</i>.
            </p>

            <p>
              <b>Entretien.</b> Après avoir modifié une habilitation, <b>ré-invitez</b> le membre pour mettre son trousseau
              à jour. <b>Révoquer</b> supprime son trousseau : il ne peut plus rien déchiffrer via l&apos;application ; pour
              une révocation cryptographique (membre parti avec ses clés mémorisées), ré-invitez ensuite les membres
              restants pour régénérer les clés à la prochaine rotation.
            </p>
          </div>
        </details>
      )}

      {/* Demandes en attente (app de bureau : l'enrôlement serveur fait foi en web) */}
      {!isWeb && pendingUsers.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Demandes d'accès en attente ({pendingUsers.length})
          </h3>
          <p className="text-xs text-amber-700">
            Ces utilisateurs ont lancé l'application et attendent votre validation pour accéder aux données.
          </p>
          <div className="space-y-2">
            {pendingUsers.map(pendingUser => (
              <div key={pendingUser.windowsUsername} className="flex items-center justify-between bg-white px-4 py-3 rounded-lg border border-amber-200">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center text-sm font-bold text-amber-700">
                    {pendingUser.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{pendingUser.displayName}</div>
                    <div className="text-xs text-gray-400">{pendingUser.windowsUsername} — inscrit le {new Date(pendingUser.createdAt).toLocaleDateString('fr-FR')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleApproveUser(pendingUser.windowsUsername)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors"
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Approuver
                  </button>
                  <button
                    onClick={() => handleRejectUser(pendingUser.windowsUsername)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Rejeter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formulaire d'ajout */}
      {showAddForm && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-emerald-800">Nouvel utilisateur</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username Windows</label>
              <input
                type="text"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="dupont.j"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nom affiché</label>
              <input
                type="text"
                value={newDisplayName}
                onChange={e => setNewDisplayName(e.target.value)}
                placeholder="Jean DUPONT"
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rôle global</label>
              <select
                value={newGlobalRole || ''}
                onChange={e => setNewGlobalRole(e.target.value ? e.target.value as GlobalRole : null)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Aucun (contentieux uniquement)</option>
                <option value="admin">Administrateur</option>
                <option value="pra">PR / PRA</option>
                <option value="vice_proc">Vice-procureur</option>
                <option value="jld">JLD</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              Annuler
            </button>
            <button
              onClick={handleAddUser}
              disabled={!newUsername.trim() || !newDisplayName.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="h-4 w-4" />
              Créer
            </button>
          </div>
        </div>
      )}

      {/* Liste des utilisateurs approuvés */}
      <div className="space-y-3">
        {approvedUsers.map(user => (
          <UserCard
            key={user.windowsUsername}
            user={user}
            contentieuxDefs={contentieuxDefs}
            isWeb={isWeb}
            accountState={accountStates[user.windowsUsername.toLowerCase()]}
            onUpdateGlobalRole={handleUpdateGlobalRole}
            onAssignContentieux={handleAssignContentieux}
            onUnassignContentieux={handleUnassignContentieux}
            onToggleModule={handleToggleModule}
            onRemove={handleRemoveUser}
            inviteResult={invite?.username.toLowerCase() === user.windowsUsername.toLowerCase() ? invite : null}
            keyBusy={keyBusy === user.windowsUsername}
            confirmingRevoke={confirmRevoke === user.windowsUsername}
            copied={copied}
            onInvite={handleInvite}
            onRevoke={handleRevoke}
            onRequestRevoke={setConfirmRevoke}
            onCopyCode={copyInviteCode}
          />
        ))}
      </div>

      {/* ─── Consultation lecture seule (app de bureau uniquement) ───── */}
      {!isWeb && (
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-amber-900 flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Consultation lecture seule
            </h3>
            <p className="text-xs text-amber-800 mt-1">
              Publie une copie web de l'app sur un partage réseau, ouvrable dans Edge sans installation.
              Mise à jour automatique à chaque synchro.
            </p>
          </div>
          {consultationStatus?.enabled ? (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md text-xs font-semibold">
              <CheckCircle className="h-3 w-3" /> Active
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 bg-gray-200 text-gray-600 rounded-md text-xs font-semibold">
              Inactive
            </span>
          )}
        </div>

        {consultationStatus?.shellAvailable === false && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-2 text-xs">
            La coquille statique n'est pas embarquée dans cette version de l'app
            (<code>consultation-shell/</code> manquant). Reconstruisez avec
            <code className="mx-1 px-1 py-0.5 bg-red-100 rounded">npm run build:consultation-shell</code>
            puis repackagez.
          </div>
        )}

        {/* État actif → infos + désactiver + rafraîchir */}
        {consultationStatus?.enabled && (
          <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-2 text-xs text-gray-700">
            <div><span className="font-semibold">Profil :</span> {consultationStatus.targetUsername}</div>
            <div className="break-all"><span className="font-semibold">Dossier :</span> {consultationStatus.deployPath}</div>
            <div>
              <span className="font-semibold">Dernier rafraîchissement :</span>{' '}
              {consultationStatus.lastRefreshedAt
                ? new Date(consultationStatus.lastRefreshedAt).toLocaleString('fr-FR')
                : '—'}
            </div>
            {consultationStatus.lastError && (
              <div className="text-red-700">
                <span className="font-semibold">Dernière erreur :</span> {consultationStatus.lastError}
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleConsultationRefresh}
                disabled={consBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                <RefreshCw className={'h-3.5 w-3.5 ' + (consBusy ? 'animate-spin' : '')} />
                Rafraîchir maintenant
              </button>
              <button
                onClick={handleConsultationDeactivate}
                disabled={consBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Désactiver
              </button>
            </div>
          </div>
        )}

        {/* État inactif → bouton "Activer" */}
        {!consultationStatus?.enabled && !showConsultationForm && (
          <button
            onClick={() => setShowConsultationForm(true)}
            disabled={consultationStatus?.shellAvailable === false}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Eye className="h-4 w-4" />
            Activer la consultation
          </button>
        )}

        {/* Formulaire d'activation */}
        {!consultationStatus?.enabled && showConsultationForm && (
          <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Pour qui ?
              </label>
              <select
                value={consTargetUser}
                onChange={e => setConsTargetUser(e.target.value)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              >
                <option value="">— Choisir un utilisateur —</option>
                {approvedUsers.map(u => (
                  <option key={u.windowsUsername} value={u.windowsUsername}>
                    {u.displayName} ({u.windowsUsername})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Où déposer le mini-site ? (chemin réseau)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={consDeployPath}
                  onChange={e => setConsDeployPath(e.target.value)}
                  placeholder="P:\Consultation_AppMetier"
                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                />
                <button
                  onClick={handleConsultationPickFolder}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm"
                >
                  <FolderOpen className="h-4 w-4" />
                  Parcourir
                </button>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowConsultationForm(false); setConsTargetUser(''); setConsDeployPath(''); }}
                disabled={consBusy}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={handleConsultationActivate}
                disabled={consBusy || !consTargetUser || !consDeployPath}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check className="h-4 w-4" />
                {consBusy ? 'Activation…' : 'Activer'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────
// CARTE UTILISATEUR
// ──────────────────────────────────────────────

interface UserCardProps {
  user: UserProfile;
  contentieuxDefs: ContentieuxDefinition[];
  isWeb?: boolean;
  accountState?: { exists: boolean; hasKeyring: boolean; hasGrant: boolean };
  onUpdateGlobalRole: (username: string, role: GlobalRole) => void;
  onAssignContentieux: (username: string, cId: ContentieuxId, role: ContentieuxRole) => void;
  onUnassignContentieux: (username: string, cId: ContentieuxId) => void;
  onToggleModule: (username: string, moduleId: ModuleId, enabled: boolean) => void;
  onRemove: (username: string) => void;
  // Accès & clés (édition web)
  inviteResult?: InviteResult | null;
  keyBusy?: boolean;
  confirmingRevoke?: boolean;
  copied?: boolean;
  onInvite?: (user: UserProfile) => void;
  onRevoke?: (username: string) => void;
  onRequestRevoke?: (username: string | null) => void;
  onCopyCode?: (code: string) => void;
}

/** Pastille d'état du trousseau (édition web) — dépliez la carte pour agir. */
const KeyringBadge = ({ state }: { state?: { exists: boolean; hasKeyring: boolean; hasGrant: boolean } }) => {
  if (!state?.exists) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500" title="Aucun compte serveur — la personne ne s'est pas encore enrôlée">Pas encore enrôlé</span>;
  }
  if (state.hasKeyring) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title="Trousseau actif">Trousseau actif</span>;
  }
  if (state.hasGrant) {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Invitation en attente d'acceptation">Invitation en attente</span>;
  }
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500" title="Enrôlé mais sans trousseau — dépliez la carte pour l'inviter">À inviter</span>;
};

const UserCard = ({
  user,
  contentieuxDefs,
  isWeb,
  accountState,
  onUpdateGlobalRole,
  onAssignContentieux,
  onUnassignContentieux,
  onToggleModule,
  onRemove,
  inviteResult,
  keyBusy,
  confirmingRevoke,
  copied,
  onInvite,
  onRevoke,
  onRequestRevoke,
  onCopyCode,
}: UserCardProps) => {
  const [expanded, setExpanded] = useState(false);

  const ctxIds = user.contentieux.map(c => c.contentieuxId).filter(id => KNOWN_CONTENTIEUX.includes(id));
  const enrolled = accountState?.exists === true;
  const hasTrousseau = accountState?.hasKeyring || accountState?.hasGrant;
  const overProvisioned = accountState?.hasKeyring === true && ctxIds.length === 0;

  const roleLabel = user.globalRole
    ? GLOBAL_ROLE_LABELS[user.globalRole] || user.globalRole
    : 'Utilisateur standard';

  const roleBadgeColor = user.globalRole === 'admin'
    ? 'bg-red-100 text-red-700'
    : user.globalRole === 'pra'
      ? 'bg-purple-100 text-purple-700'
      : user.globalRole === 'vice_proc'
        ? 'bg-blue-100 text-blue-700'
        : user.globalRole === 'jld'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-gray-100 text-gray-600';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-bold text-gray-600">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">{user.displayName}</div>
            <div className="text-xs text-gray-400">{user.windowsUsername}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${roleBadgeColor}`}>
            {roleLabel}
          </span>
          {isWeb && <KeyringBadge state={accountState} />}
          {user.contentieux.length > 0 && (
            <span className="text-xs text-gray-400">
              {user.contentieux.length} contentieux
            </span>
          )}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-4">
          {/* Rôle global */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Rôle global</label>
            <select
              value={user.globalRole || ''}
              onChange={e => onUpdateGlobalRole(user.windowsUsername, e.target.value ? e.target.value as GlobalRole : null)}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
            >
              <option value="">Aucun</option>
              <option value="admin">Administrateur</option>
              <option value="pra">PR / PRA</option>
              <option value="vice_proc">Vice-procureur</option>
              <option value="jld">JLD</option>
            </select>
          </div>

          {/* Contentieux */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Contentieux</label>
            <div className="space-y-2">
              {contentieuxDefs.map(ctxDef => {
                const assignment = user.contentieux.find(c => c.contentieuxId === ctxDef.id);
                return (
                  <div key={ctxDef.id} className="flex items-center gap-3 bg-white px-3 py-2 rounded-md border border-gray-200">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ctxDef.color }} />
                    <span className="text-sm text-gray-700 flex-1">{ctxDef.label}</span>
                    {assignment ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={assignment.role}
                          onChange={e => onAssignContentieux(user.windowsUsername, ctxDef.id, e.target.value as ContentieuxRole)}
                          className="px-2 py-1 border border-gray-300 rounded text-xs bg-white"
                        >
                          <option value="magistrat">Magistrat</option>
                          <option value="ja">JA</option>
                        </select>
                        <button
                          onClick={() => onUnassignContentieux(user.windowsUsername, ctxDef.id)}
                          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Retirer l'accès"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onAssignContentieux(user.windowsUsername, ctxDef.id, 'ja')}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                      >
                        + Attribuer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Modules */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Modules activés</label>
            <div className="flex gap-3">
              {(Object.entries(MODULE_LABELS) as [ModuleId, string][]).map(([moduleId, label]) => {
                const isEnabled = user.modules.includes(moduleId);
                return (
                  <label key={moduleId} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={e => onToggleModule(user.windowsUsername, moduleId, e.target.checked)}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Accès & clés (édition web) — invitation / révocation du trousseau */}
          {isWeb && (
            <div className="pt-3 border-t border-gray-200 space-y-2">
              <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-emerald-700" /> Accès &amp; clés
              </label>

              {!enrolled ? (
                <p className="text-xs text-gray-400">
                  Ce membre ne s&apos;est pas encore enrôlé (aucun compte serveur). L&apos;invitation sera possible une
                  fois qu&apos;il aura lancé l&apos;application.
                </p>
              ) : (
                <>
                  <p className="text-xs text-gray-500">
                    Clés livrées : <span className="font-medium text-gray-700">{scopeLabelsForUser(user).join(' · ')}</span>
                  </p>

                  {overProvisioned && (
                    <div className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                      <AlertTriangle className="h-3 w-3" /> Trousseau actif sans aucune habilitation contentieux
                    </div>
                  )}

                  {inviteResult && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                      <div className="text-xs font-semibold text-emerald-900">Code d&apos;invitation prêt</div>
                      <div className="flex items-center gap-2">
                        <code className="text-sm font-mono font-bold tracking-wider bg-white border border-emerald-200 rounded px-2.5 py-1">{inviteResult.code}</code>
                        <button
                          onClick={() => onCopyCode?.(inviteResult.code)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-emerald-200 rounded-md hover:bg-emerald-100"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? 'Copié' : 'Copier'}
                        </button>
                      </div>
                      <p className="text-[11px] text-emerald-800">
                        À usage unique — il ne sera <b>plus jamais affiché</b>. Transmettez-le maintenant, de vive voix
                        ou par canal sûr.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    {confirmingRevoke ? (
                      <>
                        <span className="text-xs text-red-600 font-medium">Révoquer le trousseau de {user.displayName} ?</span>
                        <button
                          onClick={() => onRevoke?.(user.windowsUsername)}
                          disabled={keyBusy}
                          className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                        >
                          {keyBusy ? '…' : 'Confirmer'}
                        </button>
                        <button onClick={() => onRequestRevoke?.(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Annuler</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => onInvite?.(user)}
                          disabled={keyBusy}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          {keyBusy ? '…' : (hasTrousseau ? 'Ré-inviter' : 'Inviter')}
                        </button>
                        {hasTrousseau && (
                          <button
                            onClick={() => onRequestRevoke?.(user.windowsUsername)}
                            disabled={keyBusy}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-50 disabled:opacity-50"
                          >
                            <ShieldOff className="h-3.5 w-3.5" /> Révoquer
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Supprimer */}
          {user.globalRole !== 'admin' && (
            <div className="pt-2 border-t border-gray-200">
              <button
                onClick={() => onRemove(user.windowsUsername)}
                className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 font-medium"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer cet utilisateur
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
