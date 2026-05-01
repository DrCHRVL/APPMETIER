'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Calendar as CalendarIcon, AlertTriangle, Check, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { calculateDMLEcheance } from '@/utils/instructionUtils';
import { DELAI_DML_JOURS } from '@/config/dpRegimes';
import type { DemandeMiseEnLiberte } from '@/types/instructionTypes';

interface Props {
  value: DemandeMiseEnLiberte[];
  onChange: (next: DemandeMiseEnLiberte[]) => void;
  readOnly?: boolean;
}

const STATUT_LABELS: Record<DemandeMiseEnLiberte['statut'], { label: string; color: string }> = {
  en_attente: { label: 'En attente', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  accordee:   { label: 'Accordée', color: 'bg-green-100 text-green-800 border-green-200' },
  rejetee:    { label: 'Rejetée', color: 'bg-gray-100 text-gray-700 border-gray-200' },
};

export const DMLsManager = ({ value, onChange, readOnly }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [draftDate, setDraftDate] = useState(() => new Date().toISOString().split('T')[0]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const handleAdd = () => {
    if (!draftDate) return;
    const echeance = calculateDMLEcheance(draftDate);
    onChange([
      ...value,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        dateDepot: draftDate,
        dateEcheance: echeance,
        statut: 'en_attente',
      },
    ]);
    setDraftDate(new Date().toISOString().split('T')[0]);
    setShowForm(false);
  };

  const handleRemove = (id: number) => onChange(value.filter(d => d.id !== id));

  const handleStatut = (id: number, statut: DemandeMiseEnLiberte['statut']) =>
    onChange(value.map(d => (d.id === id ? { ...d, statut } : d)));

  const handleDateRequisitions = (id: number, date: string) =>
    onChange(value.map(d => (d.id === id ? { ...d, dateRequisitions: date || undefined } : d)));

  // Tri : en_attente d'abord (par échéance), puis le reste par date dépôt
  const sorted = [...value].sort((a, b) => {
    if (a.statut === 'en_attente' && b.statut !== 'en_attente') return -1;
    if (a.statut !== 'en_attente' && b.statut === 'en_attente') return 1;
    return new Date(b.dateDepot).getTime() - new Date(a.dateDepot).getTime();
  });

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">
        Délai légal : <strong>{DELAI_DML_JOURS} jours ouvrables</strong> à compter du dépôt (art 148).
        Total : <strong>{value.length}</strong> DML.
      </div>

      {sorted.length === 0 && !showForm && (
        <div className="text-xs text-gray-400 italic">Aucune DML déposée.</div>
      )}

      {sorted.map(dml => {
        const echeance = new Date(dml.dateEcheance);
        echeance.setHours(0, 0, 0, 0);
        const joursRestants = Math.ceil((echeance.getTime() - today.getTime()) / 86400000);
        const enRetard = dml.statut === 'en_attente' && joursRestants < 0;
        const proche = dml.statut === 'en_attente' && joursRestants >= 0 && joursRestants <= 3;
        const statutMeta = STATUT_LABELS[dml.statut];
        return (
          <div
            key={dml.id}
            className={`border rounded p-2 text-xs ${
              enRetard
                ? 'border-red-300 bg-red-50'
                : proche
                ? 'border-amber-300 bg-amber-50'
                : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-800">
                    Déposée le {new Date(dml.dateDepot).toLocaleDateString()}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded border ${statutMeta.color}`}>
                    {statutMeta.label}
                  </span>
                  {dml.statut === 'en_attente' && (
                    enRetard ? (
                      <span className="inline-flex items-center gap-0.5 text-red-700 font-semibold">
                        <AlertTriangle className="h-3 w-3" />
                        En retard de {Math.abs(joursRestants)} j
                      </span>
                    ) : (
                      <span className={proche ? 'text-amber-700 font-medium' : 'text-gray-600'}>
                        Échéance dans {joursRestants} j
                      </span>
                    )
                  )}
                </div>
                <div className="text-gray-500 mt-0.5 flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3" />
                  Échéance : {echeance.toLocaleDateString()}
                  {dml.dateRequisitions && (
                    <span className="ml-3 text-emerald-700">
                      Réquisitions rédigées le {new Date(dml.dateRequisitions).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              {!readOnly && (
                <button
                  onClick={() => handleRemove(dml.id)}
                  className="text-gray-400 hover:text-red-600 shrink-0"
                  title="Supprimer"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>

            {!readOnly && dml.statut === 'en_attente' && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5 pt-1.5 border-t border-gray-200">
                <Input
                  type="date"
                  value={dml.dateRequisitions || ''}
                  onChange={(e) => handleDateRequisitions(dml.id, e.target.value)}
                  className="h-6 text-xs w-36"
                  title="Date des réquisitions parquet"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatut(dml.id, 'accordee')}
                  className="h-6 text-xs text-green-700 border-green-300 hover:bg-green-50"
                >
                  <Check className="h-3 w-3 mr-1" />
                  Accordée
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatut(dml.id, 'rejetee')}
                  className="h-6 text-xs text-gray-700 border-gray-300 hover:bg-gray-50"
                >
                  <X className="h-3 w-3 mr-1" />
                  Rejetée
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-gray-300 rounded p-2 space-y-1.5 bg-gray-50">
            <label className="text-xs font-medium text-gray-700">Date de dépôt *</label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                autoFocus
                className="h-7 text-xs"
              />
              <span className="text-xs text-gray-500">
                → échéance : {draftDate ? new Date(calculateDMLEcheance(draftDate)).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="h-6 text-xs">
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!draftDate}
                className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                Ajouter la DML
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-xs text-emerald-600 hover:bg-emerald-50 py-1.5 rounded border border-dashed border-emerald-300 inline-flex items-center justify-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Enregistrer une nouvelle DML
          </button>
        )
      )}
    </div>
  );
};
