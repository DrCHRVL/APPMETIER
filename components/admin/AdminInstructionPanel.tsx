'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, X, Check, Power, PowerOff, AlertTriangle, Trash2, Bell, RotateCcw, Network, Loader2, RefreshCw, Users, UserPlus, Share2, Mail } from 'lucide-react';
import type { InstructionShareState } from '@/utils/dataSync/InstructionSyncService';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { useInstructionAlertRules } from '@/hooks/useInstructionAlertRules';
import { useInstructionCustomTypes } from '@/hooks/useInstructionCustomTypes';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { instructionSyncService } from '@/utils/dataSync/InstructionSyncService';
import { UserManager } from '@/utils/userManager';
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

      {/* ─── PARTAGE DU MODULE ENTRE MAGISTRATS ─── */}
      <PartageSection />

      {/* ─── RAPPEL HEBDO ─── */}
      <WeeklyRecapSection />
    </div>
  );
};

// ──────────────────────────────────────────────
// SECTION SAUVEGARDE RÉSEAU (privée par utilisateur)
// ──────────────────────────────────────────────

const NetworkBackupSection = () => {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const { showToast } = useToast();

  // Rafraîchit le statut (dernière synchro) périodiquement tant que la section est ouverte
  useEffect(() => {
    const tick = () => setLastSync(instructionSyncService.getStatus().lastSuccessfulSync);
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

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

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
          <Network className="h-4 w-4 text-gray-500" />
          Sauvegarde de vos dossiers
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Vos dossiers d'instruction sont enregistrés automatiquement sur le{' '}
          <strong>serveur chiffré</strong> et synchronisés entre tous vos appareils.
          Ils restent <strong>privés</strong> : ils ne sont jamais visibles par les
          autres utilisateurs, sauf partage explicite ci-dessous.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>
            Synchronisé avec le serveur.
            {lastSync && (
              <span className="text-emerald-700/80">
                {' '}Dernière synchro : {new Date(lastSync).toLocaleString('fr-FR')}
              </span>
            )}
          </span>
        </div>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Synchroniser
        </button>
      </div>
    </section>
  );
};

// ──────────────────────────────────────────────
// SECTION PARTAGE DU MODULE (entre magistrats)
// ──────────────────────────────────────────────

const PartageSection = () => {
  const { showToast } = useToast();
  const [state, setState] = useState<InstructionShareState>(() => instructionSyncService.getShareState());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ windowsUsername: string; displayName: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Re-hydrate à chaque évènement de partage (sync, ajout/refus d'invitation).
  useEffect(() => {
    const refresh = () => setState(instructionSyncService.getShareState());
    refresh();
    window.addEventListener('instruction-share-changed', refresh);
    window.addEventListener('instructions-sync-completed', refresh);
    const id = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('instruction-share-changed', refresh);
      window.removeEventListener('instructions-sync-completed', refresh);
      clearInterval(id);
    };
  }, []);

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      setState(instructionSyncService.getShareState());
      if (okMsg) showToast(okMsg, 'success');
    } catch {
      showToast('Action de partage impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (value.trim().length >= 3) {
      const q = value.trim().toLowerCase();
      const all = UserManager.getInstance().getAllUsers();
      const filtered = all
        .filter(u =>
          u.windowsUsername.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map(u => ({ windowsUsername: u.windowsUsername, displayName: u.displayName }));
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (username: string) => {
    setDraft(username);
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleAdd = () => {
    const u = draft.trim();
    if (!u) return;
    setDraft('');
    setSuggestions([]);
    setShowSuggestions(false);
    void run(() => instructionSyncService.addPartner(u), 'Invitation de partage envoyée');
  };



  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-1.5">
          <Share2 className="h-4 w-4 text-gray-500" />
          Partage du module avec d'autres magistrats
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Indiquez les utilisateurs avec qui partager ce module (par ex. votre juriste
          assistante). Le partage <strong>fusionne</strong> vos dossiers d'instruction en
          un seul module commun. Ajouter une personne lui envoie une{' '}
          <strong>invitation</strong> : dès qu'elle l'<strong>accepte</strong> (un clic),
          le partage est actif. Inutile que chacun invite l'autre — accepter suffit. Une
          invitation reçue peut aussi être refusée.
        </p>
      </div>

      {/* Invitations entrantes */}
      {state.incoming.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-emerald-600" />
            Invitations reçues
          </div>
          {state.incoming.map(u => (
            <div key={u} className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 py-1.5">
              <Users className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="text-sm text-gray-800 flex-1 truncate">{u}</span>
              <button
                disabled={busy}
                onClick={() => run(() => instructionSyncService.acceptInvite(u), 'Partage accepté')}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-md disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Accepter
              </button>
              <button
                disabled={busy}
                onClick={() => run(() => instructionSyncService.declineInvite(u))}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Refuser
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Partenaires déclarés */}
      <div className="space-y-1.5">
        {state.partners.length === 0 && (
          <div className="text-xs text-gray-400 italic">Aucun partenaire de partage déclaré.</div>
        )}
        {state.partners.map(p => (
          <div key={p.username} className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-1.5">
            <Users className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-800 flex-1 truncate">{p.username}</span>
            {p.status === 'shared' ? (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                Partagé ✓
              </span>
            ) : (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                En attente d'acceptation
              </span>
            )}
            <button
              disabled={busy}
              onClick={() => run(() => instructionSyncService.removePartner(p.username))}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
              title="Retirer ce partenaire"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Ajout */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { handleAdd(); }
              if (e.key === 'Escape') { setShowSuggestions(false); }
            }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
            placeholder="Nom d'utilisateur du partenaire (dès 3 caractères)"
            disabled={busy}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:bg-gray-50 disabled:opacity-60"
          />
          {showSuggestions && (
            <ul className="absolute z-20 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map(s => (
                <li
                  key={s.windowsUsername}
                  onMouseDown={() => selectSuggestion(s.windowsUsername)}
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-emerald-50 text-sm"
                >
                  <Users className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-800">{s.windowsUsername}</span>
                  {s.displayName && s.displayName !== s.windowsUsername && (
                    <span className="text-gray-400 truncate">{s.displayName}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={handleAdd}
          disabled={busy || !draft.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Inviter
        </button>
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
