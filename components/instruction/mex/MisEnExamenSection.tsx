'use client';

import React, { useEffect, useState } from 'react';
import { Plus, X, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { MisEnExamenCard } from './MisEnExamenCard';
import type { MisEnExamen } from '@/types/instructionTypes';

interface Props {
  misEnExamen: MisEnExamen[];
  onChange: (next: MisEnExamen[]) => void;
  readOnly?: boolean;
}

export const MisEnExamenSection = ({ misEnExamen, onChange, readOnly }: Props) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [draftNom, setDraftNom] = useState('');
  const [draftDate, setDraftDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  /** Set des IDs de MEX dépliés (vue contrôlée). */
  const [expandedIds, setExpandedIds] = useState<Set<number>>(
    () => new Set(misEnExamen.length === 1 ? [misEnExamen[0].id] : []),
  );

  // Lorsqu'on ajoute un MEX, on le déplie automatiquement.
  useEffect(() => {
    if (lastAddedId !== null && !expandedIds.has(lastAddedId)) {
      setExpandedIds(prev => new Set(prev).add(lastAddedId));
    }
  }, [lastAddedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = (id: number) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allExpanded = misEnExamen.length > 0 && misEnExamen.every(m => expandedIds.has(m.id));
  const collapseAll = () => setExpandedIds(new Set());
  const expandAll = () => setExpandedIds(new Set(misEnExamen.map(m => m.id)));

  const handleAdd = () => {
    if (!draftNom.trim()) return;
    const newId = Date.now() + Math.floor(Math.random() * 1000);
    const newMex: MisEnExamen = {
      id: newId,
      nom: draftNom.trim(),
      dateMiseEnExamen: draftDate,
      infractions: [],
      // elementsPersonnalite : champ legacy (UI retirée), conservé vide pour le type
      elementsPersonnalite: [],
      mesureSurete: { type: 'libre', depuis: draftDate },
      dmls: [],
    };
    onChange([...misEnExamen, newMex]);
    setLastAddedId(newId);
    setDraftNom('');
    setDraftDate(new Date().toISOString().split('T')[0]);
    setShowAddForm(false);
  };

  const handleUpdate = (id: number, next: MisEnExamen) =>
    onChange(misEnExamen.map(m => (m.id === id ? next : m)));

  const handleRemove = (id: number) =>
    onChange(misEnExamen.filter(m => m.id !== id));

  return (
    <div className="space-y-3">
      {misEnExamen.length === 0 && !showAddForm && (
        <div className="text-center py-6 text-gray-500 text-sm bg-gray-50 border border-dashed border-gray-300 rounded-lg">
          Aucun mis en examen pour ce dossier.
        </div>
      )}

      {misEnExamen.length > 1 && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={allExpanded ? collapseAll : expandAll}
            className="h-7 text-xs text-gray-600 hover:text-emerald-700"
          >
            {allExpanded ? (
              <>
                <ChevronsDownUp className="h-3.5 w-3.5 mr-1" />
                Tout replier
              </>
            ) : (
              <>
                <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />
                Tout déplier
              </>
            )}
          </Button>
        </div>
      )}

      {/* Grille adaptative : 1 col petit écran, 2 cols écran moyen, 3 cols grand écran. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2 items-start">
        {misEnExamen.map(mex => (
          <MisEnExamenCard
            key={mex.id}
            mex={mex}
            onChange={(next) => handleUpdate(mex.id, next)}
            onDelete={() => handleRemove(mex.id)}
            expanded={expandedIds.has(mex.id)}
            onToggleExpanded={() => toggleExpanded(mex.id)}
            readOnly={readOnly}
          />
        ))}
      </div>

      {!readOnly && (
        showAddForm ? (
          <div className="border-2 border-dashed border-emerald-300 rounded-lg p-3 bg-emerald-50/30 space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Nouveau mis en examen</h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Nom complet *</Label>
                <Input
                  value={draftNom}
                  onChange={(e) => setDraftNom(e.target.value)}
                  placeholder="Ex: DUPONT Jean"
                  autoFocus
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Date de mise en examen *</Label>
                <Input
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowAddForm(false); setDraftNom(''); }}
                className="h-7 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!draftNom.trim()}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-3 w-3 mr-1" />
                Ajouter
              </Button>
            </div>
            <p className="text-[11px] text-gray-500">
              Les détails (infractions, mesures de sûreté, DML…) se renseignent ensuite en dépliant la carte.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full text-sm text-emerald-700 hover:bg-emerald-50 py-2 rounded-lg border-2 border-dashed border-emerald-300 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Ajouter un mis en examen
          </button>
        )
      )}
    </div>
  );
};
