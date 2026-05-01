// components/mindmap/MindmapSidePanel.tsx
// Panneau latéral détaillant un MEC : variantes, score, dossiers cités.

'use client';

import React from 'react';
import { X, ChevronRight, FileText } from 'lucide-react';
import type { ContentieuxDefinition } from '@/types/userTypes';
import type { DossierNode, MecNode, MindmapGraph } from '@/utils/mindmapGraph';

interface MindmapSidePanelProps {
  mec: MecNode;
  graph: MindmapGraph;
  contentieuxDefs: ContentieuxDefinition[];
  onClose: () => void;
  /** Click sur un dossier listé → focus sur ce dossier */
  onDossierClick?: (dossier: DossierNode) => void;
  /** Double click → ouverture du modal d'enquête */
  onDossierOpen?: (dossier: DossierNode) => void;
}

export const MindmapSidePanel: React.FC<MindmapSidePanelProps> = ({
  mec,
  graph,
  contentieuxDefs,
  onClose,
  onDossierClick,
  onDossierOpen,
}) => {
  const ctxColorById = new Map<string, { color: string; label: string }>(
    contentieuxDefs.map(d => [d.id, { color: d.color, label: d.label }]),
  );

  const dossiers = mec.dossierIds
    .map(id => graph.dossierById.get(id))
    .filter((d): d is DossierNode => Boolean(d))
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));

  return (
    <div className="absolute top-0 right-0 h-full w-96 bg-white border-l border-slate-200 shadow-xl flex flex-col z-20">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-slate-200 bg-slate-50">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Mis en cause</div>
          <div className="text-lg font-semibold text-slate-900 truncate" title={mec.displayName}>
            {mec.displayName}
          </div>
          {mec.variants.length > 0 && (
            <div className="text-xs text-slate-500 mt-1">
              Aussi orthographié : {mec.variants.slice(0, 3).join(', ')}
              {mec.variants.length > 3 ? '…' : ''}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Score breakdown */}
      <div className="p-4 border-b border-slate-200">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Score composite</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Dossiers" value={mec.dossierIds.length} />
          <Stat label="Mises en examen" value={mec.nbMisEnExamen} />
          <Stat label="Chefs cumulés" value={mec.nbChefs} />
          <Stat label="Score brut" value={mec.rawScore.toFixed(1)} />
        </div>
        {mec.recent && (
          <div className="mt-2 inline-block text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            Mention récente (12 derniers mois)
          </div>
        )}
        {mec.statuts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {mec.statuts.map(s => (
              <span key={s} className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Dossiers */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-slate-500">
          Dossiers ({dossiers.length})
        </div>
        <ul className="px-2 pb-2">
          {dossiers.map(d => {
            const ctx = ctxColorById.get(d.contentieuxId);
            return (
              <li key={d.id}>
                <button
                  onClick={() => onDossierClick?.(d)}
                  onDoubleClick={() => onDossierOpen?.(d)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-slate-50 group text-left"
                >
                  <div
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ background: ctx?.color || '#64748b' }}
                  />
                  <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-slate-900 truncate">{d.numero}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {ctx?.label || d.contentieuxId}
                      {d.statut !== 'en_cours' && ` • ${d.statut}`}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-4 pb-4 text-[11px] text-slate-400">
          Clic = recentrer · Double-clic = ouvrir le dossier
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="bg-slate-50 rounded p-2">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-base font-semibold text-slate-900">{value}</div>
  </div>
);
