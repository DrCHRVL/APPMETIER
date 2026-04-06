'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen, Save, Check, AlertCircle, Loader2, ArrowRight, Lock, RotateCcw } from 'lucide-react';
import { UserManager } from '@/utils/userManager';
import { ServerPathsConfig, ContentieuxId } from '@/types/userTypes';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';

export const AdminPathsPanel = () => {
  const { isAdmin: checkIsAdmin, contentieux: contentieuxDefs } = useUser();
  const { showToast } = useToast();
  const [generalPath, setGeneralPath] = useState('');
  const [contentieuxPaths, setContentieuxPaths] = useState<Record<ContentieuxId, string>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [validResults, setValidResults] = useState<Record<string, boolean | null>>({});
  const [saving, setSaving] = useState(false);
  const [serverRootPath, setServerRootPath] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetInput, setResetInput] = useState('');
  const [resetting, setResetting] = useState(false);

  // Chemins effectifs actuels (pour détecter les changements et migrer)
  const [effectivePaths, setEffectivePaths] = useState<{ general: string; contentieux: Record<string, string> } | null>(null);
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [migrationChanges, setMigrationChanges] = useState<Array<{ type: 'general' | 'contentieux'; id?: string; label?: string; oldPath: string; newPath: string }>>([]);
  const [migrating, setMigrating] = useState(false);
  const pendingSaveRef = useRef<ServerPathsConfig | null>(null);

  const loadPaths = useCallback(async () => {
    const manager = UserManager.getInstance();
    const config = manager.getConfig();
    const paths = config?.serverPaths;

    // Charger le chemin racine configuré
    try {
      const serverConfig = await (window as any).electronAPI?.serverConfig_get?.();
      setServerRootPath(serverConfig?.serverRootPath || '');
    } catch {}

    // Charger les chemins effectifs (configurés ou par défaut)
    let effective: { general: string; contentieux: Record<string, string> } | null = null;
    try {
      effective = await (window as any).electronAPI?.paths_getEffective?.();
      setEffectivePaths(effective);
    } catch {}

    // Si pas configuré, pré-remplir avec les chemins effectifs (= les défauts hardcodés)
    setGeneralPath(paths?.general || effective?.general || '');
    const ctxPaths: Record<string, string> = {};
    for (const def of contentieuxDefs) {
      ctxPaths[def.id] = paths?.contentieux?.[def.id] || effective?.contentieux?.[def.id] || '';
    }
    setContentieuxPaths(ctxPaths);
  }, [contentieuxDefs]);

  useEffect(() => { loadPaths(); }, [loadPaths]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const validatePath = async (key: string, pathValue: string) => {
    if (!pathValue.trim()) {
      setValidResults(prev => ({ ...prev, [key]: null }));
      return;
    }
    setValidating(prev => ({ ...prev, [key]: true }));
    try {
      const result = await (window as any).electronAPI?.validatePath?.(pathValue.trim());
      setValidResults(prev => ({ ...prev, [key]: !!result }));
    } catch {
      setValidResults(prev => ({ ...prev, [key]: false }));
    }
    setValidating(prev => ({ ...prev, [key]: false }));
  };

  const selectFolder = async (key: string, setter: (val: string) => void) => {
    const selected = await (window as any).electronAPI?.selectFolder?.();
    if (selected) {
      setter(selected);
      validatePath(key, selected);
    }
  };

  const doSave = async (serverPaths: ServerPathsConfig) => {
    const manager = UserManager.getInstance();
    const config = manager.getConfig();
    if (!config) return;

    config.serverPaths = serverPaths;
    config.updatedAt = new Date().toISOString();

    if (typeof window !== 'undefined' && (window as any).electronAPI?.dataSync_pushUsersConfig) {
      await (window as any).electronAPI.dataSync_pushUsersConfig(config);
    }
    // Recharger les chemins effectifs
    try {
      const effective = await (window as any).electronAPI?.paths_getEffective?.();
      setEffectivePaths(effective);
    } catch {}
    showToast('Chemins réseau sauvegardés', 'success');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const serverPaths: ServerPathsConfig = {
        general: generalPath.trim(),
        contentieux: {},
      };
      for (const [id, p] of Object.entries(contentieuxPaths)) {
        if (p.trim()) serverPaths.contentieux[id] = p.trim();
      }

      // Détecter les changements de chemins
      const changes: typeof migrationChanges = [];
      if (effectivePaths) {
        if (generalPath.trim() && effectivePaths.general && generalPath.trim() !== effectivePaths.general) {
          changes.push({ type: 'general', oldPath: effectivePaths.general, newPath: generalPath.trim() });
        }
        for (const def of contentieuxDefs) {
          const newP = contentieuxPaths[def.id]?.trim();
          const oldP = effectivePaths.contentieux?.[def.id];
          if (newP && oldP && newP !== oldP) {
            changes.push({ type: 'contentieux', id: def.id, label: def.label, oldPath: oldP, newPath: newP });
          }
        }
      }

      if (changes.length > 0) {
        // Proposer la migration
        setMigrationChanges(changes);
        pendingSaveRef.current = serverPaths;
        setShowMigrationDialog(true);
      } else {
        await doSave(serverPaths);
      }
    } catch (error) {
      showToast('Erreur lors de la sauvegarde', 'error');
    }
    setSaving(false);
  };

  const handleMigrate = async (doMigrate: boolean) => {
    setMigrating(true);
    try {
      if (doMigrate) {
        for (const change of migrationChanges) {
          if (change.type === 'general') {
            const result = await (window as any).electronAPI?.paths_migrateGeneral?.(change.oldPath, change.newPath);
            if (result?.success && result.migrated?.length > 0) {
              showToast(`Données générales migrées : ${result.migrated.join(', ')}`, 'success');
            }
          } else if (change.type === 'contentieux' && change.id) {
            const result = await (window as any).electronAPI?.paths_migrateContentieux?.(change.id, change.oldPath, change.newPath);
            if (result?.success && result.migrated?.length > 0) {
              showToast(`${change.label} : données migrées (${result.migrated.join(', ')})`, 'success');
            }
          }
        }
      }

      // Sauvegarder dans tous les cas
      if (pendingSaveRef.current) {
        await doSave(pendingSaveRef.current);
      }
    } catch (error) {
      showToast('Erreur lors de la migration', 'error');
    }
    setMigrating(false);
    setShowMigrationDialog(false);
    pendingSaveRef.current = null;
    setMigrationChanges([]);
  };

  const renderPathInput = (
    key: string,
    label: string,
    value: string,
    onChange: (val: string) => void,
    description?: string,
    color?: string
  ) => (
    <div key={key} className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
        {color && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />}
        {label}
      </label>
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setValidResults(prev => ({ ...prev, [key]: null }));
            }}
            onBlur={() => validatePath(key, value)}
            placeholder="Ex: P:\\TGI\\Parquet\\..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-8"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            {validating[key] && <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />}
            {!validating[key] && validResults[key] === true && <Check className="h-4 w-4 text-green-500" />}
            {!validating[key] && validResults[key] === false && <AlertCircle className="h-4 w-4 text-red-500" />}
          </div>
        </div>
        <button
          onClick={() => selectFolder(key, onChange)}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          title="Parcourir"
        >
          <FolderOpen className="h-4 w-4 text-gray-600" />
        </button>
      </div>
      {validResults[key] === false && (
        <p className="text-xs text-red-500">Chemin inaccessible ou non inscriptible</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Chemins réseau</h3>
        <p className="text-sm text-gray-500">
          Configurez les chemins réseau partagés pour la synchronisation et les fichiers communs.
        </p>
      </div>

      {/* Chemin racine (configuré à l'initialisation — lecture seule) */}
      <div className="bg-gray-100 border border-gray-300 rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-gray-400" />
            Chemin racine du serveur
          </h4>
          <button
            onClick={() => { setShowResetConfirm(true); setResetInput(''); }}
            className="text-[10px] text-red-400 hover:text-red-600 font-medium transition-colors"
          >
            Réinitialiser
          </button>
        </div>
        <p className="text-xs text-gray-500">Défini lors de la configuration initiale. Non modifiable.</p>
        <div className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 font-mono">
          {serverRootPath || '(non configuré)'}
        </div>
      </div>

      {/* Dialog reset factory */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="text-base font-semibold text-red-700 flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Réinitialisation du serveur
            </h3>
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                Cette action va <strong>déconnecter cette instance</strong> du serveur actuel.
                Au prochain lancement, l'écran de configuration initiale s'affichera.
              </p>
              <p className="text-red-600 font-medium">
                Les données locales ne seront pas supprimées, mais la synchronisation sera interrompue.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tapez <strong>RESET</strong> pour confirmer
              </label>
              <input
                type="text"
                value={resetInput}
                onChange={e => setResetInput(e.target.value)}
                placeholder="RESET"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg font-mono"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={async () => {
                  setResetting(true);
                  try {
                    await (window as any).electronAPI?.serverConfig_reset?.();
                    setShowResetConfirm(false);
                    showToast('Configuration réinitialisée. Relancez l\'application.', 'info');
                  } catch {
                    showToast('Erreur lors de la réinitialisation', 'error');
                  }
                  setResetting(false);
                }}
                disabled={resetInput !== 'RESET' || resetting}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetting ? 'Réinitialisation...' : 'Confirmer la réinitialisation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chemin général */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
        <h4 className="text-sm font-semibold text-blue-800">Chemin général</h4>
        {renderPathInput(
          'general',
          'Dossier racine partagé',
          generalPath,
          setGeneralPath,
          'Utilisé pour users.json, heartbeats, événements et journal d\'audit'
        )}
      </div>

      {/* Chemins par contentieux */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-800">Chemins par contentieux</h4>
        <p className="text-xs text-gray-500">Dossier de données (app-data.json, backups) par contentieux.</p>
        {contentieuxDefs
          .sort((a, b) => a.order - b.order)
          .map(def =>
            renderPathInput(
              `ctx_${def.id}`,
              def.label,
              contentieuxPaths[def.id] || '',
              (val) => setContentieuxPaths(prev => ({ ...prev, [def.id]: val })),
              undefined,
              def.color
            )
          )}
      </div>

      {/* Bouton sauvegarder */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Sauvegarder
        </button>
      </div>

      {/* Dialog de migration */}
      {showMigrationDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4 space-y-4">
            <h3 className="text-base font-semibold text-gray-800">Migrer les données ?</h3>
            <p className="text-sm text-gray-600">
              Vous avez modifié {migrationChanges.length === 1 ? 'un chemin' : `${migrationChanges.length} chemins`}.
              Souhaitez-vous copier les données existantes vers {migrationChanges.length === 1 ? 'le nouveau chemin' : 'les nouveaux chemins'} ?
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {migrationChanges.map((change, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
                  <div className="font-medium text-gray-700">
                    {change.type === 'general' ? 'Chemin général' : change.label}
                  </div>
                  <div className="flex items-center gap-2 text-gray-500">
                    <span className="font-mono truncate flex-1" title={change.oldPath}>{change.oldPath}</span>
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    <span className="font-mono truncate flex-1 text-emerald-600" title={change.newPath}>{change.newPath}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400">
              Les fichiers originaux ne seront pas supprimés (copie uniquement).
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => handleMigrate(false)}
                disabled={migrating}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Sauvegarder sans migrer
              </button>
              <button
                onClick={() => handleMigrate(true)}
                disabled={migrating}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {migrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Copier et sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
