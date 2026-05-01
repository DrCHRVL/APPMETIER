'use client';

import React, { useState } from 'react';
import { Plus, Edit2, X, Check, Power, PowerOff, AlertTriangle, Trash2 } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { CABINET_COLOR_PALETTE } from '@/config/instructionConfig';
import { cabinetSlug } from '@/utils/instructionConfigManager';
import type { Cabinet } from '@/types/instructionTypes';

export const AdminInstructionPanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();
  const { showToast } = useToast();
  const {
    allCabinets,
    isLoading,
    addCabinet,
    updateCabinet,
    removeCabinet,
    toggleCabinet,
  } = useInstructionCabinets();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);

  // Form state — add
  const [newLabel, setNewLabel] = useState('');
  const [newId, setNewId] = useState('');
  const [newColor, setNewColor] = useState(CABINET_COLOR_PALETTE[0]);
  const [newMagistrat, setNewMagistrat] = useState('');

  // Form state — edit
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editMagistrat, setEditMagistrat] = useState('');

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const resetAddForm = () => {
    setShowAddForm(false);
    setNewLabel('');
    setNewId('');
    setNewColor(CABINET_COLOR_PALETTE[0]);
    setNewMagistrat('');
  };

  const handleAdd = async () => {
    if (!newLabel.trim()) {
      showToast('Libellé requis', 'error');
      return;
    }
    const result = await addCabinet({
      id: newId.trim() || cabinetSlug(newLabel),
      label: newLabel.trim(),
      color: newColor,
      magistratParDefaut: newMagistrat.trim() || undefined,
      enabled: true,
    });
    if (result.ok) {
      showToast(`Cabinet "${newLabel.trim()}" ajouté`, 'success');
      resetAddForm();
    } else {
      showToast(result.reason || 'Échec de l\'ajout', 'error');
    }
  };

  const startEdit = (cab: Cabinet) => {
    setEditingId(cab.id);
    setEditLabel(cab.label);
    setEditColor(cab.color);
    setEditMagistrat(cab.magistratParDefaut || '');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editLabel.trim()) {
      showToast('Libellé requis', 'error');
      return;
    }
    const ok = await updateCabinet(id, {
      label: editLabel.trim(),
      color: editColor,
      magistratParDefaut: editMagistrat.trim() || undefined,
    });
    if (ok) {
      showToast('Cabinet mis à jour', 'success');
      setEditingId(null);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (enabled) {
      const result = await toggleCabinet(id, true);
      if (result.ok) showToast('Cabinet activé', 'success');
      return;
    }
    setConfirmDisableId(id);
  };

  const confirmDisable = async () => {
    if (!confirmDisableId) return;
    const result = await toggleCabinet(confirmDisableId, false);
    if (result.ok) showToast('Cabinet désactivé', 'success');
    else showToast(result.reason || 'Échec', 'error');
    setConfirmDisableId(null);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    const result = await removeCabinet(confirmDeleteId);
    if (result.ok) showToast('Cabinet supprimé', 'success');
    else showToast(result.reason || 'Échec', 'error');
    setConfirmDeleteId(null);
  };

  const enabledCount = allCabinets.filter(c => c.enabled !== false).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Cabinets d'instruction</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {isLoading
              ? 'Chargement…'
              : `${enabledCount} actif${enabledCount > 1 ? 's' : ''} sur ${allCabinets.length}`}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Configurez ici les cabinets de votre tribunal. Vous pouvez en ajouter, modifier la
            couleur ou le magistrat affecté, désactiver ou supprimer un cabinet vide.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un cabinet
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">Nouveau cabinet</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">Libellé</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Ex: Cabinet 5, Cabinet Mme Durand…"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                ID technique (auto si vide)
              </label>
              <input
                type="text"
                value={newId || cabinetSlug(newLabel)}
                onChange={(e) =>
                  setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
                placeholder="cab-5"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Magistrat par défaut (optionnel)
              </label>
              <input
                type="text"
                value={newMagistrat}
                onChange={(e) => setNewMagistrat(e.target.value)}
                placeholder="Ex: Mme Dupont"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600 mb-1 block">Couleur</label>
              <div className="flex flex-wrap items-center gap-2">
                {CABINET_COLOR_PALETTE.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewColor(color)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                      newColor === color ? 'border-gray-800 scale-110' : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={color}
                  />
                ))}
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={resetAddForm}
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

      {/* Cabinet list */}
      <div className="space-y-2">
        {allCabinets.map(cab => {
          const isEnabled = cab.enabled !== false;
          const isEditing = editingId === cab.id;
          return (
            <div
              key={cab.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                isEnabled
                  ? 'bg-white border-gray-200'
                  : 'bg-gray-50 border-gray-200 opacity-60'
              }`}
            >
              <div
                className="w-4 h-4 rounded-full shrink-0 border border-white shadow-sm"
                style={{ backgroundColor: isEditing ? editColor : cab.color }}
              />

              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="px-2 py-1 text-sm border border-gray-300 rounded"
                      placeholder="Libellé"
                    />
                    <input
                      type="text"
                      value={editMagistrat}
                      onChange={(e) => setEditMagistrat(e.target.value)}
                      className="px-2 py-1 text-sm border border-gray-300 rounded"
                      placeholder="Magistrat"
                    />
                    <div className="flex items-center gap-1 flex-wrap">
                      {CABINET_COLOR_PALETTE.slice(0, 6).map(color => (
                        <button
                          key={color}
                          onClick={() => setEditColor(color)}
                          className={`w-5 h-5 rounded-full border-2 ${
                            editColor === color ? 'border-gray-800' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-sm font-medium text-gray-800 flex items-center gap-2">
                      {cab.label}
                      {cab.magistratParDefaut && (
                        <span className="text-xs text-gray-500 font-normal">
                          · {cab.magistratParDefaut}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 font-mono">{cab.id}</div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isEditing ? (
                  <>
                    <button
                      onClick={() => handleSaveEdit(cab.id)}
                      className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                      title="Enregistrer"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded transition-colors"
                      title="Annuler"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => startEdit(cab)}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded transition-colors"
                      title="Modifier"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleToggle(cab.id, !isEnabled)}
                      className={`p-1.5 rounded transition-colors ${
                        isEnabled
                          ? 'text-amber-600 hover:bg-amber-50'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                      title={isEnabled ? 'Désactiver' : 'Activer'}
                    >
                      {isEnabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(cab.id)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirm disable modal */}
      {confirmDisableId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-gray-800">Désactiver ce cabinet ?</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Les dossiers existants resteront en base mais ne pourront plus être créés sur ce
                  cabinet. Vous pourrez le réactiver à tout moment.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDisableId(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmDisable}
                className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
              >
                Désactiver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-gray-800">Supprimer définitivement ce cabinet ?</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Les dossiers attachés à ce cabinet deviendront orphelins (cabinet inconnu) — vous
                  devrez les réaffecter manuellement. Si vous voulez juste le masquer, préférez la
                  désactivation.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmDelete}
                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
