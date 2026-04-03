'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Save, Check, AlertCircle, Loader2 } from 'lucide-react';
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

  const loadPaths = useCallback(() => {
    const manager = UserManager.getInstance();
    const config = manager.getConfig();
    const paths = config?.serverPaths;
    setGeneralPath(paths?.general || '');
    const ctxPaths: Record<string, string> = {};
    for (const def of contentieuxDefs) {
      ctxPaths[def.id] = paths?.contentieux?.[def.id] || '';
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const manager = UserManager.getInstance();
      const config = manager.getConfig();
      if (!config) return;

      const serverPaths: ServerPathsConfig = {
        general: generalPath.trim(),
        contentieux: {},
      };
      for (const [id, p] of Object.entries(contentieuxPaths)) {
        if (p.trim()) serverPaths.contentieux[id] = p.trim();
      }
      config.serverPaths = serverPaths;
      config.updatedAt = new Date().toISOString();

      if (typeof window !== 'undefined' && (window as any).electronAPI?.dataSync_pushUsersConfig) {
        await (window as any).electronAPI.dataSync_pushUsersConfig(config);
      }
      showToast('Chemins réseau sauvegardés', 'success');
    } catch (error) {
      showToast('Erreur lors de la sauvegarde', 'error');
    }
    setSaving(false);
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
    </div>
  );
};
