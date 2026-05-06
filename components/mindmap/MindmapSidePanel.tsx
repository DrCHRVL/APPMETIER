// components/mindmap/MindmapSidePanel.tsx
// Panneau latéral détaillant un MEC : variantes, score, dossiers cités.

'use client';

import React, { useEffect, useState } from 'react';
import { X, ChevronRight, FileText, Minus, Plus, Star } from 'lucide-react';
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
  /** Modifie le bonus de score manuel du MEC (peut être négatif). */
  onSetScoreBoost?: (mecId: string, bonus: number, reason?: string) => void;
}

const BOOST_MIN = -10;
const BOOST_MAX = 20;

export const MindmapSidePanel: React.FC<MindmapSidePanelProps> = ({
  mec,
  graph,
  contentieuxDefs,
  onClose,
  onDossierClick,
  onDossierOpen,
  onSetScoreBoost,
}) => {
  const ctxColorById = new Map<string, { color: string; label: string }>(
    contentieuxDefs.map(d => [d.id, { color: d.color, label: d.label }]),
  );

  const dossiers = mec.dossierIds
    .map(id => graph.dossierById.get(id))
    .filter((d): d is DossierNode => Boolean(d))
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));

  // Édition locale du boost : on n'écrit dans le store qu'au commit
  // (Enregistrer / clavier Entrée) pour éviter de relancer le layout à
  // chaque frappe.
  const [boostDraft, setBoostDraft] = useState(mec.manualBonus);
  const [reasonDraft, setReasonDraft] = useState(mec.manualBonusReason || '');
  useEffect(() => {
    setBoostDraft(mec.manualBonus);
    setReasonDraft(mec.manualBonusReason || '');
  }, [mec.id, mec.manualBonus, mec.manualBonusReason]);
  const boostDirty = boostDraft !== mec.manualBonus
    || (reasonDraft || '') !== (mec.manualBonusReason || '');

  const commitBoost = () => {
    if (!onSetScoreBoost) return;
    const clamped = Math.max(BOOST_MIN, Math.min(BOOST_MAX, Math.round(boostDraft)));
    onSetScoreBoost(mec.id, clamped, reasonDraft.trim() || undefined);
  };
  const resetBoost = () => {
    if (!onSetScoreBoost) return;
    onSetScoreBoost(mec.id, 0);
    setBoostDraft(0);
    setReasonDraft('');
  };

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

      {/* Importance manuelle */}
      {onSetScoreBoost && (
        <div className="p-4 border-b border-slate-200 bg-amber-50/40">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 text-amber-500" />
              Importance manuelle
            </div>
            {mec.manualBonus !== 0 && (
              <button
                onClick={resetBoost}
                className="text-[10px] text-slate-500 hover:text-slate-800 underline"
              >
                réinitialiser
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBoostDraft(b => Math.max(BOOST_MIN, b - 1))}
              className="h-8 w-8 flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-50"
              title="Diminuer"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <input
              type="number"
              value={boostDraft}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setBoostDraft(Number.isNaN(v) ? 0 : v);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') commitBoost(); }}
              min={BOOST_MIN}
              max={BOOST_MAX}
              className="flex-1 h-8 text-center text-sm font-semibold border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            <button
              onClick={() => setBoostDraft(b => Math.min(BOOST_MAX, b + 1))}
              className="h-8 w-8 flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-50"
              title="Augmenter"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitBoost(); }}
            placeholder="Justification (optionnel)…"
            className="mt-2 w-full h-8 px-2 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
            <span>
              Bonus appliqué après formule (de {BOOST_MIN} à +{BOOST_MAX}).
            </span>
            <button
              onClick={commitBoost}
              disabled={!boostDirty}
              className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${
                boostDirty
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              Enregistrer
            </button>
          </div>
          {mec.manualBonus !== 0 && (
            <div className="mt-2 text-[11px] text-amber-800 bg-amber-100 border border-amber-200 rounded px-2 py-1">
              Bonus actif : {mec.manualBonus > 0 ? '+' : ''}{mec.manualBonus} pt{Math.abs(mec.manualBonus) > 1 ? 's' : ''}
              {mec.manualBonusReason ? ` — ${mec.manualBonusReason}` : ''}
            </div>
          )}
        </div>
      )}

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
