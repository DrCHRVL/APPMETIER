'use client';

import React, { useState } from 'react';
import { Plus, Trash2, MapPin, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { InfractionReproche } from '@/types/instructionTypes';

interface Props {
  value: InfractionReproche[];
  onChange: (next: InfractionReproche[]) => void;
  readOnly?: boolean;
}

export const InfractionsManager = ({ value, onChange, readOnly }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Omit<InfractionReproche, 'id'>>({
    qualification: '',
    dateInfraction: '',
    lieuInfraction: '',
    explication: '',
  });

  const reset = () => {
    setDraft({ qualification: '', dateInfraction: '', lieuInfraction: '', explication: '' });
    setShowForm(false);
  };

  const handleAdd = () => {
    if (!draft.qualification.trim()) return;
    onChange([
      ...value,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        qualification: draft.qualification.trim(),
        dateInfraction: draft.dateInfraction || undefined,
        lieuInfraction: draft.lieuInfraction?.trim() || undefined,
        explication: draft.explication?.trim() || undefined,
      },
    ]);
    reset();
  };

  const handleRemove = (id: number) => onChange(value.filter(i => i.id !== id));

  const handleUpdate = (id: number, updates: Partial<InfractionReproche>) =>
    onChange(value.map(i => (i.id === id ? { ...i, ...updates } : i)));

  return (
    <div className="space-y-2">
      {value.length === 0 && !showForm && (
        <div className="text-xs text-gray-400 italic">Aucune infraction enregistrée.</div>
      )}

      {value.map(inf => (
        <div key={inf.id} className="border border-gray-200 rounded p-2 bg-white text-sm">
          {readOnly ? (
            <>
              <div className="font-medium text-gray-800">{inf.qualification}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-0.5">
                {inf.dateInfraction && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarIcon className="h-3 w-3" />
                    {new Date(inf.dateInfraction).toLocaleDateString()}
                  </span>
                )}
                {inf.lieuInfraction && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {inf.lieuInfraction}
                  </span>
                )}
              </div>
              {inf.explication && (
                <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{inf.explication}</div>
              )}
            </>
          ) : (
            <div className="space-y-1.5">
              <Input
                value={inf.qualification}
                onChange={(e) => handleUpdate(inf.id, { qualification: e.target.value })}
                placeholder="Qualification (ex: Trafic de stupéfiants en BO)"
                className="text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  value={inf.dateInfraction || ''}
                  onChange={(e) => handleUpdate(inf.id, { dateInfraction: e.target.value || undefined })}
                  className="text-xs"
                />
                <Input
                  value={inf.lieuInfraction || ''}
                  onChange={(e) => handleUpdate(inf.id, { lieuInfraction: e.target.value || undefined })}
                  placeholder="Lieu"
                  className="text-xs"
                />
              </div>
              <textarea
                value={inf.explication || ''}
                onChange={(e) => handleUpdate(inf.id, { explication: e.target.value || undefined })}
                rows={2}
                placeholder="Explication / faits"
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded resize-none"
              />
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(inf.id)}
                  className="h-6 text-xs text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Supprimer
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}

      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-gray-300 rounded p-2 space-y-1.5 bg-gray-50">
            <Input
              value={draft.qualification}
              onChange={(e) => setDraft(d => ({ ...d, qualification: e.target.value }))}
              placeholder="Qualification *"
              autoFocus
              className="text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={draft.dateInfraction || ''}
                onChange={(e) => setDraft(d => ({ ...d, dateInfraction: e.target.value }))}
                className="text-xs"
              />
              <Input
                value={draft.lieuInfraction || ''}
                onChange={(e) => setDraft(d => ({ ...d, lieuInfraction: e.target.value }))}
                placeholder="Lieu"
                className="text-xs"
              />
            </div>
            <textarea
              value={draft.explication || ''}
              onChange={(e) => setDraft(d => ({ ...d, explication: e.target.value }))}
              rows={2}
              placeholder="Explication / faits"
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={reset} className="h-6 text-xs">
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!draft.qualification.trim()}
                className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                Ajouter
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-xs text-emerald-600 hover:bg-emerald-50 py-1.5 rounded border border-dashed border-emerald-300 inline-flex items-center justify-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Ajouter une infraction
          </button>
        )
      )}
    </div>
  );
};
