'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X, Calendar as CalendarIcon, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type { OPInstruction } from '@/types/instructionTypes';

interface Props {
  ops: OPInstruction[];
  onChange: (next: OPInstruction[]) => void;
  readOnly?: boolean;
}

export const OpsSection = ({ ops, onChange, readOnly }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '',
    service: '',
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sorted = useMemo(
    () => [...ops].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [ops],
  );

  const handleAdd = () => {
    if (!draft.date) return;
    onChange([
      ...ops,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: draft.date,
        description: draft.description.trim() || undefined,
        service: draft.service.trim() || undefined,
      },
    ]);
    setDraft({ date: new Date().toISOString().split('T')[0], description: '', service: '' });
    setShowForm(false);
  };

  const handleRemove = (id: number) => onChange(ops.filter(o => o.id !== id));

  const handleUpdate = (id: number, updates: Partial<OPInstruction>) =>
    onChange(ops.map(o => (o.id === id ? { ...o, ...updates } : o)));

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        Opérations programmées par le juge d'instruction. Cochez « réquisitions rédigées » quand vous
        avez transmis vos réquisitions au JI.
      </div>

      {sorted.length === 0 && !showForm && (
        <div className="text-center py-4 text-sm text-gray-400 italic bg-gray-50 border border-dashed border-gray-200 rounded">
          Aucune OP enregistrée pour ce dossier.
        </div>
      )}

      <div className="space-y-2">
        {sorted.map(op => {
          const date = new Date(op.date);
          date.setHours(0, 0, 0, 0);
          const joursDiff = Math.ceil((date.getTime() - today.getTime()) / 86400000);
          const passed = joursDiff < 0;
          const proche = !passed && joursDiff <= 7;
          return (
            <div
              key={op.id}
              className={`border rounded p-2 text-sm ${
                passed
                  ? 'border-gray-200 bg-gray-50 text-gray-600'
                  : proche
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-blue-200 bg-blue-50/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CalendarIcon className="h-3.5 w-3.5 text-gray-500" />
                    <span className="font-semibold">{date.toLocaleDateString()}</span>
                    <span className={`text-[10px] uppercase tracking-wide ${
                      passed ? 'text-gray-500' : proche ? 'text-amber-700' : 'text-blue-700'
                    }`}>
                      {passed ? `il y a ${Math.abs(joursDiff)} j` : joursDiff === 0 ? 'aujourd\'hui' : `J+${joursDiff}`}
                    </span>
                    {op.service && (
                      <span className="text-xs text-gray-600">· {op.service}</span>
                    )}
                    {op.requisitionsRedigees && (
                      <span className="inline-flex items-center text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded">
                        <Check className="h-2.5 w-2.5 mr-0.5" />
                        Réq. rédigées
                      </span>
                    )}
                  </div>
                  {op.description && (
                    <div className="text-xs text-gray-600 mt-0.5">{op.description}</div>
                  )}
                  {op.notes && (
                    <div className="text-[11px] text-gray-500 italic mt-0.5">{op.notes}</div>
                  )}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => handleRemove(op.id)}
                    className="text-gray-400 hover:text-red-600 shrink-0"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>

              {!readOnly && !passed && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200">
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!op.requisitionsRedigees}
                      onChange={(e) =>
                        handleUpdate(op.id, {
                          requisitionsRedigees: e.target.checked,
                          dateRequisitions: e.target.checked
                            ? op.dateRequisitions || new Date().toISOString().split('T')[0]
                            : undefined,
                        })
                      }
                    />
                    Réquisitions rédigées
                  </label>
                  {op.requisitionsRedigees && (
                    <Input
                      type="date"
                      value={op.dateRequisitions || ''}
                      onChange={(e) => handleUpdate(op.id, { dateRequisitions: e.target.value || undefined })}
                      className="h-6 text-xs w-36"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-blue-300 rounded p-3 bg-blue-50/30 space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Nouvelle OP</h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Date *</Label>
                <Input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft(d => ({ ...d, date: e.target.value }))}
                  autoFocus
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Service</Label>
                <Input
                  value={draft.service}
                  onChange={(e) => setDraft(d => ({ ...d, service: e.target.value }))}
                  placeholder="Service en charge"
                  className="h-8 text-sm"
                />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Description</Label>
                <Input
                  value={draft.description}
                  onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))}
                  placeholder="Objet de l'OP (perquisition, interpellations, etc.)"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="h-7 text-xs">
                <X className="h-3 w-3 mr-1" />
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!draft.date}
                className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-3 w-3 mr-1" />
                Ajouter l'OP
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-sm text-blue-700 hover:bg-blue-50 py-2 rounded border-2 border-dashed border-blue-300 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Enregistrer une OP du JI
          </button>
        )
      )}
    </div>
  );
};
