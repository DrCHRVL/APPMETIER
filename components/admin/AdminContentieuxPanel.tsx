'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Save, Power, PowerOff, Edit2, X, Check, FolderOpen, AlertTriangle } from 'lucide-react';
import { UserManager } from '@/utils/userManager';
import { ContentieuxDefinition, ContentieuxId } from '@/types/userTypes';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';

const PRESET_COLORS = [
  '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#be185d',
];

export const AdminContentieuxPanel = () => {
  const { isAdmin: checkIsAdmin, refreshUsers } = useUser();
  const { showToast } = useToast();
  const [contentieuxList, setContentieuxList] = useState<ContentieuxDefinition[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New contentieux form
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#9333ea');
  const [newServerFolder, setNewServerFolder] = useState('');

  // Edit form
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editServerFolder, setEditServerFolder] = useState('');

  const load = useCallback(() => {
    const manager = UserManager.getInstance();
    setContentieuxList(manager.getAllContentieux());
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const sanitizeId = (label: string) =>
    label.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '');

  const handleAdd = async () => {
    const id = newId.trim() || sanitizeId(newLabel);
    if (!id || !newLabel.trim()) {
      showToast('ID et nom requis', 'error');
      return;
    }
    const manager = UserManager.getInstance();
    const order = contentieuxList.length + 1;
    const success = await manager.addContentieux({
      id,
      label: newLabel.trim(),
      color: newColor,
      serverFolder: newServerFolder.trim() || id,
      order,
      enabled: true,
    });
    if (success) {
      showToast(`Contentieux "${newLabel.trim()}" ajouté`, 'success');
      refreshUsers();
      load();
      setShowAddForm(false);
      setNewId(''); setNewLabel(''); setNewServerFolder('');
    } else {
      showToast('Erreur: ID déjà existant ou droits insuffisants', 'error');
    }
  };

  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);

  const handleToggle = async (id: ContentieuxId, enabled: boolean) => {
    // Activation : pas besoin de confirmation
    if (enabled) {
      const manager = UserManager.getInstance();
      const success = await manager.toggleContentieux(id, true);
      if (success) {
        showToast('Contentieux activé', 'success');
        refreshUsers();
        load();
      }
      return;
    }
    // Désactivation : demander confirmation
    setConfirmDisableId(id);
  };

  const confirmDisable = async () => {
    if (!confirmDisableId) return;
    const manager = UserManager.getInstance();
    const success = await manager.toggleContentieux(confirmDisableId, false);
    if (success) {
      showToast('Contentieux désactivé (données conservées)', 'success');
      refreshUsers();
      load();
    } else {
      showToast('Impossible: au moins un contentieux doit rester actif', 'error');
    }
    setConfirmDisableId(null);
  };

  const startEdit = (def: ContentieuxDefinition) => {
    setEditingId(def.id);
    setEditLabel(def.label);
    setEditColor(def.color);
    setEditServerFolder(def.serverFolder);
  };

  const handleSaveEdit = async (id: ContentieuxId) => {
    const manager = UserManager.getInstance();
    const success = await manager.updateContentieux(id, {
      label: editLabel.trim(),
      color: editColor,
      serverFolder: editServerFolder.trim(),
    });
    if (success) {
      showToast('Contentieux mis à jour', 'success');
      refreshUsers();
      load();
      setEditingId(null);
    }
  };

  const enabledCount = contentieuxList.filter(c => c.enabled !== false).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Gestion des contentieux</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {enabledCount} actif{enabledCount > 1 ? 's' : ''} sur {contentieuxList.length}
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un contentieux
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">Nouveau contentieux</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Nom</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => {
                  setNewLabel(e.target.value);
                  if (!newId) setNewServerFolder(sanitizeId(e.target.value));
                }}
                placeholder="Ex: Section Financière"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">ID technique</label>
              <input
                type="text"
                value={newId || sanitizeId(newLabel)}
                onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="section_fin"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Dossier serveur</label>
              <input
                type="text"
                value={newServerFolder || sanitizeId(newLabel)}
                onChange={(e) => setNewServerFolder(e.target.value)}
                placeholder="section_fin"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Couleur</label>
              <div className="flex items-center gap-2">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setNewColor(color)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      newColor === color ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setShowAddForm(false); setNewId(''); setNewLabel(''); setNewServerFolder(''); }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleAdd}
              disabled={!newLabel.trim()}
              className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5 inline mr-1" />
              Créer
            </button>
          </div>
        </div>
      )}

      {/* Contentieux list */}
      <div className="space-y-2">
        {contentieuxList
          .sort((a, b) => a.order - b.order)
          .map(def => {
            const isEnabled = def.enabled !== false;
            const isEditing = editingId === def.id;

            return (
              <div
                key={def.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                  isEnabled
                    ? 'bg-white border-gray-200'
                    : 'bg-gray-50 border-gray-200 opacity-60'
                }`}
              >
                {/* Color dot */}
                <div
                  className="w-4 h-4 rounded-full shrink-0 border border-white shadow-sm"
                  style={{ backgroundColor: isEditing ? editColor : def.color }}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="px-2 py-1 text-sm border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={editServerFolder}
                        onChange={(e) => setEditServerFolder(e.target.value)}
                        className="px-2 py-1 text-sm border border-gray-300 rounded font-mono"
                        placeholder="Dossier serveur"
                      />
                      <div className="flex items-center gap-1">
                        {PRESET_COLORS.slice(0, 5).map(color => (
                          <button
                            key={color}
                            onClick={() => setEditColor(color)}
                            className={`w-5 h-5 rounded-full border-2 ${editColor === color ? 'border-gray-800' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                        <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="w-5 h-5 rounded cursor-pointer" />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-sm font-medium text-gray-800">{def.label}</div>
                      <div className="text-[11px] text-gray-400 font-mono">
                        {def.id} · {def.serverFolder}/
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {isEditing ? (
                    <>
                      <button onClick={() => handleSaveEdit(def.id)} className="p-1.5 bg-green-100 hover:bg-green-200 rounded-md">
                        <Check className="h-3.5 w-3.5 text-green-700" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-md">
                        <X className="h-3.5 w-3.5 text-gray-500" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleToggle(def.id, !isEnabled)}
                        className={`p-1.5 rounded-md transition-colors ${
                          isEnabled
                            ? 'bg-green-100 hover:bg-green-200 text-green-700'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
                        }`}
                        title={isEnabled ? 'Désactiver' : 'Activer'}
                      >
                        {isEnabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => startEdit(def)} className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-md">
                        <Edit2 className="h-3.5 w-3.5 text-gray-500" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Note de sécurité */}
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <strong>Sécurité :</strong> la désactivation d'un contentieux le masque de l'application
          mais <strong>ne supprime aucune donnée</strong>. Vous pouvez le réactiver à tout moment
          pour retrouver toutes les enquêtes et données associées.
        </div>
      </div>

      {/* Confirmation de désactivation */}
      {confirmDisableId && (() => {
        const ctxToDisable = contentieuxList.find(c => c.id === confirmDisableId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-full">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-800">Désactiver ce contentieux ?</h3>
              </div>
              <div className="text-sm text-gray-600 space-y-2">
                <p>
                  Vous allez désactiver <strong>{ctxToDisable?.label}</strong>.
                </p>
                <p>
                  Le contentieux sera <strong>masqué</strong> dans toute l'application (sidebar, paramètres, overboard).
                  Les utilisateurs assignés n'y auront plus accès.
                </p>
                <p className="text-green-700 font-medium">
                  Les données (enquêtes, documents, résultats) ne seront pas supprimées.
                  Vous pourrez réactiver ce contentieux à tout moment.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setConfirmDisableId(null)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={confirmDisable}
                  className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors"
                >
                  Désactiver
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
