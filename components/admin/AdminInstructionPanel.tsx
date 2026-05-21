'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, X, Check, Power, PowerOff, AlertTriangle, Trash2, Bell, RotateCcw, Network, FolderOpen, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { useInstructionAlertRules } from '@/hooks/useInstructionAlertRules';
import { useInstructionCustomTypes } from '@/hooks/useInstructionCustomTypes';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { instructionSyncService } from '@/utils/dataSync/InstructionSyncService';
import { CABINET_COLOR_PALETTE, INSTRUCTION_TRIGGER_LABELS } from '@/config/instructionConfig';
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

  // Cabinets : édition réservée aux admins. Les utilisateurs non-admin voient
  // simplement la liste en lecture seule (les sections alertes / rappel hebdo
  // restent par contre éditables car elles sont per-user).
  const isAdmin = checkIsAdmin();

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
    <div className="space-y-8">
      {/* ─── CABINETS ─── */}
      <section className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Cabinets d'instruction</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {isLoading
              ? 'Chargement…'
              : `${enabledCount} actif${enabledCount > 1 ? 's' : ''} sur ${allCabinets.length}`}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {isAdmin
              ? 'Configurez ici les cabinets de votre tribunal. Vous pouvez en ajouter, modifier la couleur ou le magistrat affecté, désactiver ou supprimer un cabinet vide.'
              : 'Liste des cabinets configurés. La gestion (ajout / suppression / modification) est réservée à l\'administrateur.'}
          </p>
        </div>
        {isAdmin && (
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter un cabinet
        </button>
        )}
      </div>

      {/* Add form */}
      {isAdmin && showAddForm && (
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

              {isAdmin && (
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
              )}
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
      </section>

      {/* ─── ALERTES TWEAKABLES ─── */}
      <AlertRulesSection />

      {/* ─── TYPES PERSONNALISÉS (timeline + expertises) ─── */}
      <CustomTypesSection />

      {/* ─── SAUVEGARDE RÉSEAU (privée par utilisateur) ─── */}
      <NetworkBackupSection />

      {/* ─── RAPPEL HEBDO ─── */}
      <WeeklyRecapSection />
    </div>
  );
};

// ──────────────────────────────────────────────
// SECTION SAUVEGARDE RÉSEAU (privée par utilisateur)
// ──────────────────────────────────────────────

const NetworkBackupSection = () => {
  const { instructionNetworkPath, setInstructionNetworkPath } = useUserPreferences();
  const { showToast } = useToast();

  const [pathInput, setPathInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [valid, setValid] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Synchronise le champ avec la valeur persistée (et au pull réseau des prefs)
  useEffect(() => {
    setPathInput(instructionNetworkPath || '');
  }, [instructionNetworkPath]);

  // Rafraîchit le statut (dernière synchro) périodiquement tant que la section est ouverte
  useEffect(() => {
    const tick = () => setLastSync(instructionSyncService.getStatus().lastSuccessfulSync);
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  const validatePath = useCallback(async (value: string) => {
    if (!value.trim()) { setValid(null); return; }
    setValidating(true);
    try {
      const ok = await (window as any).electronAPI?.validatePath?.(value.trim());
      setValid(!!ok);
    } catch {
      setValid(false);
    }
    setValidating(false);
  }, []);

  const handleSelectFolder = async () => {
    const selected = await (window as any).electronAPI?.selectFolder?.();
    if (selected) {
      setPathInput(selected);
      validatePath(selected);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setInstructionNetworkPath(pathInput.trim());
      showToast(
        pathInput.trim()
          ? 'Dossier réseau enregistré. Vos dossiers d\'instruction y seront sauvegardés.'
          : 'Sauvegarde réseau désactivée (sauvegarde locale uniquement).',
        'success',
      );
    } catch {
      showToast('Erreur lors de l\'enregistrement', 'error');
    }
    setSaving(false);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await instructionSyncService.triggerSync();
      if (result.success) {
        showToast('Synchronisation réussie', 'success');
        setLastSync(instructionSyncService.getStatus().lastSuccessfulSync);
      } else {
        showToast(result.error || 'Échec de la synchronisation', 'error');
      }
    } finally {
      setSyncing(false);
    }
  };

  const dirty = (instructionNetworkPath || '') !== pathInput.trim();

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
          <Network className="h-4 w-4 text-gray-500" />
          Sauvegarde réseau de vos dossiers
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Choisissez un dossier réseau où sauvegarder vos dossiers d'instruction. Ils y
          seront enregistrés automatiquement et synchronisés entre vos différents postes.
          Vos dossiers restent <strong>privés</strong> : ils ne sont jamais partagés avec
          les autres utilisateurs. Laissez vide pour une sauvegarde locale uniquement.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Dossier réseau</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); setValid(null); }}
              onBlur={() => validatePath(pathInput)}
              placeholder="Ex: P:\TGI\Parquet\...\Mes instructions"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent pr-8"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              {validating && <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />}
              {!validating && valid === true && <Check className="h-4 w-4 text-green-500" />}
              {!validating && valid === false && <AlertCircle className="h-4 w-4 text-red-500" />}
            </div>
          </div>
          <button
            onClick={handleSelectFolder}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            title="Parcourir"
          >
            <FolderOpen className="h-4 w-4 text-gray-600" />
          </button>
        </div>
        {valid === false && (
          <p className="text-xs text-red-500">Chemin inaccessible ou non inscriptible</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {instructionNetworkPath
            ? (lastSync
                ? `Dernière synchro : ${new Date(lastSync).toLocaleString('fr-FR')}`
                : 'Sauvegarde réseau active — synchro en attente.')
            : 'Sauvegarde locale uniquement.'}
        </div>
        <div className="flex items-center gap-2">
          {instructionNetworkPath && !dirty && (
            <button
              onClick={handleSyncNow}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Synchroniser
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Enregistrer
          </button>
        </div>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────
// SECTION TYPES PERSONNALISÉS (événements timeline + expertises)
// ──────────────────────────────────────────────

const CustomTypesSection = () => {
  const {
    evenementTypes,
    categoriesExpertise,
    isLoading,
    addEvenementType,
    removeEvenementType,
    addCategorieExpertise,
    removeCategorieExpertise,
  } = useInstructionCustomTypes();
  const { showToast } = useToast();

  const [newEvtLabel, setNewEvtLabel] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');

  const handleAddEvt = async () => {
    if (!newEvtLabel.trim()) return;
    const r = await addEvenementType({ id: '', label: newEvtLabel.trim() });
    if (r.ok) {
      showToast('Type d\'événement ajouté', 'success');
      setNewEvtLabel('');
    } else {
      showToast(r.reason || 'Échec de l\'ajout', 'error');
    }
  };

  const handleAddCat = async () => {
    if (!newCatLabel.trim()) return;
    const r = await addCategorieExpertise({ id: '', label: newCatLabel.trim() });
    if (r.ok) {
      showToast('Catégorie d\'expertise ajoutée', 'success');
      setNewCatLabel('');
    } else {
      showToast(r.reason || 'Échec de l\'ajout', 'error');
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-800">Types personnalisés</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Ajoutez des types d'événement supplémentaires pour la timeline et des
          catégories d'expertise. Les types système restent toujours présents.
        </p>
      </div>

      {/* Types d'événement */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Types d'événement timeline ({evenementTypes.length})
        </h4>
        {isLoading ? (
          <div className="text-xs text-gray-500">Chargement…</div>
        ) : (
          <div className="space-y-1.5">
            {evenementTypes.length === 0 && (
              <div className="text-xs text-gray-400 italic">
                Aucun type personnalisé. Les types système (lancement_cr, retour_cr,
                expertise, ipc, apc, interrogatoire au fond, phase d'interpellation)
                restent toujours disponibles.
              </div>
            )}
            {evenementTypes.map(t => (
              <div
                key={t.id}
                className="flex items-center gap-2 p-2 rounded border border-gray-200"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{t.label}</div>
                  <div className="text-[11px] text-gray-400 font-mono">{t.id}</div>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm(`Retirer le type "${t.label}" ? Les événements existants conserveront leur libellé d'origine.`)) return;
                    const ok = await removeEvenementType(t.id);
                    if (ok) showToast('Type retiré', 'success');
                  }}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                  title="Retirer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newEvtLabel}
            onChange={(e) => setNewEvtLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddEvt(); }}
            placeholder="Nouveau type (ex : audition libre, perquisition…)"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
          />
          <button
            onClick={handleAddEvt}
            disabled={!newEvtLabel.trim()}
            className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5 inline mr-1" />
            Ajouter
          </button>
        </div>
      </div>

      {/* Catégories d'expertise */}
      <div className="bg-white border border-gray-200 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          Catégories d'expertise ({categoriesExpertise.length})
        </h4>
        {isLoading ? (
          <div className="text-xs text-gray-500">Chargement…</div>
        ) : (
          <div className="space-y-1.5">
            {categoriesExpertise.length === 0 && (
              <div className="text-xs text-gray-400 italic">
                Aucune catégorie personnalisée. Les catégories système (psychologique,
                psychiatrique, balistique, ADN, papillaire, médico-légale, autopsie,
                autre) restent toujours disponibles.
              </div>
            )}
            {categoriesExpertise.map(c => (
              <div
                key={c.id}
                className="flex items-center gap-2 p-2 rounded border border-gray-200"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{c.label}</div>
                  <div className="text-[11px] text-gray-400 font-mono">{c.id}</div>
                </div>
                <button
                  onClick={async () => {
                    if (!confirm(`Retirer la catégorie "${c.label}" ?`)) return;
                    const ok = await removeCategorieExpertise(c.id);
                    if (ok) showToast('Catégorie retirée', 'success');
                  }}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                  title="Retirer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newCatLabel}
            onChange={(e) => setNewCatLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddCat(); }}
            placeholder="Nouvelle catégorie (ex : toxicologique, comptable…)"
            className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
          />
          <button
            onClick={handleAddCat}
            disabled={!newCatLabel.trim()}
            className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5 inline mr-1" />
            Ajouter
          </button>
        </div>
      </div>
    </section>
  );
};

const WeeklyRecapSection = () => {
  const {
    instructionWeeklyRecapSubscribed,
    setInstructionWeeklyRecapSubscribed,
  } = useUserPreferences();
  const { showToast } = useToast();
  return (
    <section className="space-y-2">
      <h3 className="text-base font-semibold text-gray-800">Rappel hebdomadaire</h3>
      <label className="flex items-start gap-2 text-sm cursor-pointer p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
        <input
          type="checkbox"
          checked={!!instructionWeeklyRecapSubscribed}
          onChange={async (e) => {
            await setInstructionWeeklyRecapSubscribed(e.target.checked);
            showToast(
              e.target.checked
                ? 'Récap hebdomadaire instruction activé'
                : 'Récap hebdomadaire instruction désactivé',
              'success',
            );
          }}
          className="mt-0.5"
        />
        <div>
          <div className="font-medium text-gray-800">Inclure les instructions dans le récap hebdomadaire</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Quand activé, le pop-up hebdomadaire affichera un encart instruction avec les DML en retard,
            les fins de DP imminentes (≤30 j) et les débats JLD à venir (≤14 j).
          </div>
        </div>
      </label>
    </section>
  );
};

// ──────────────────────────────────────────────
// SECTION ALERTES TWEAKABLES
// ──────────────────────────────────────────────

const AlertRulesSection = () => {
  const { rules, isLoading, updateRule, resetToDefaults } = useInstructionAlertRules();
  const { showToast } = useToast();

  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
            <Bell className="h-4 w-4 text-gray-500" />
            Règles d'alertes
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Personnalisez les seuils (en jours) et l'activation de chaque alerte. Préférences propres à votre compte.
          </p>
        </div>
        <button
          onClick={async () => {
            if (confirm('Réinitialiser toutes les règles aux valeurs par défaut ?')) {
              await resetToDefaults();
              showToast('Règles d\'alertes réinitialisées', 'success');
            }
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Réinitialiser
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">Chargement…</div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map(rule => (
            <div
              key={rule.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                rule.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'
              }`}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: rule.color || '#6b7280' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800">
                  {INSTRUCTION_TRIGGER_LABELS[rule.trigger]}
                </div>
                <div className="text-[11px] text-gray-500 font-mono">{rule.trigger}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Seuil
                  <input
                    type="number"
                    min={0}
                    value={rule.seuil}
                    onChange={(e) => updateRule(rule.id, { seuil: Number(e.target.value) || 0 })}
                    className="w-14 h-7 text-xs border border-gray-300 rounded px-1.5"
                    title="Seuil en jours (0 = trigger immédiat dès condition remplie)"
                  />
                  <span className="text-[10px] text-gray-400">j</span>
                </label>
                <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  />
                  Activée
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
