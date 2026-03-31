'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { UserPlus, Trash2, Shield, Save, Edit2, X, Check, ChevronDown } from 'lucide-react';
import { UserManager } from '@/utils/userManager';
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

// ──────────────────────────────────────────────
// LABELS
// ──────────────────────────────────────────────

const GLOBAL_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrateur',
  pra: 'PR / PRA',
  vice_proc: 'Vice-procureur',
};

const CONTENTIEUX_ROLE_LABELS: Record<ContentieuxRole, string> = {
  magistrat: 'Magistrat en charge',
  ja: 'Juriste assistante',
};

const MODULE_LABELS: Record<ModuleId, string> = {
  air: 'Suivi AIR',
  instructions: 'Instructions judiciaires',
};

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

  const loadUsers = useCallback(() => {
    const manager = UserManager.getInstance();
    setUsers(manager.getAllUsers());
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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
    } else {
      showToast('Erreur lors de la modification du module', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-600" />
          Gestion des utilisateurs
        </h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Ajouter un utilisateur
        </button>
      </div>

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

      {/* Liste des utilisateurs */}
      <div className="space-y-3">
        {users.map(user => (
          <UserCard
            key={user.windowsUsername}
            user={user}
            contentieuxDefs={contentieuxDefs}
            onUpdateGlobalRole={handleUpdateGlobalRole}
            onAssignContentieux={handleAssignContentieux}
            onUnassignContentieux={handleUnassignContentieux}
            onToggleModule={handleToggleModule}
            onRemove={handleRemoveUser}
          />
        ))}
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────
// CARTE UTILISATEUR
// ──────────────────────────────────────────────

interface UserCardProps {
  user: UserProfile;
  contentieuxDefs: ContentieuxDefinition[];
  onUpdateGlobalRole: (username: string, role: GlobalRole) => void;
  onAssignContentieux: (username: string, cId: ContentieuxId, role: ContentieuxRole) => void;
  onUnassignContentieux: (username: string, cId: ContentieuxId) => void;
  onToggleModule: (username: string, moduleId: ModuleId, enabled: boolean) => void;
  onRemove: (username: string) => void;
}

const UserCard = ({
  user,
  contentieuxDefs,
  onUpdateGlobalRole,
  onAssignContentieux,
  onUnassignContentieux,
  onToggleModule,
  onRemove,
}: UserCardProps) => {
  const [expanded, setExpanded] = useState(false);

  const roleLabel = user.globalRole
    ? GLOBAL_ROLE_LABELS[user.globalRole] || user.globalRole
    : 'Utilisateur standard';

  const roleBadgeColor = user.globalRole === 'admin'
    ? 'bg-red-100 text-red-700'
    : user.globalRole === 'pra'
      ? 'bg-purple-100 text-purple-700'
      : user.globalRole === 'vice_proc'
        ? 'bg-blue-100 text-blue-700'
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
