'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X, Gavel, Check, Clock } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import type {
  DebatJLDPlanifie,
  MisEnExamen,
  TypeDebatJLD,
} from '@/types/instructionTypes';

interface Props {
  debats: DebatJLDPlanifie[];
  misEnExamen: MisEnExamen[];
  onChange: (next: DebatJLDPlanifie[]) => void;
  readOnly?: boolean;
}

const TYPE_LABEL: Record<TypeDebatJLD, string> = {
  placement_dp:    'Placement en DP',
  prolongation_dp: 'Prolongation DP',
  dml:             'DML',
  autre:           'Autre',
};

const TYPE_COLOR: Record<TypeDebatJLD, string> = {
  placement_dp:    'bg-red-100 text-red-800 border-red-200',
  prolongation_dp: 'bg-amber-100 text-amber-800 border-amber-200',
  dml:             'bg-purple-100 text-purple-800 border-purple-200',
  autre:           'bg-gray-100 text-gray-700 border-gray-200',
};

const DECISION_LABEL: Record<NonNullable<DebatJLDPlanifie['decision']>, string> = {
  placement:           'Placement',
  maintien:            'Maintien',
  remise_en_liberte:   'Remise en liberté',
  cj:                  'CJ',
  arse:                'ARSE',
  autre:               'Autre',
};

export const DebatsJLDSection = ({ debats, misEnExamen, onChange, readOnly }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<{
    date: string;
    heure: string;
    heureExacte: boolean;
    type: TypeDebatJLD;
    misEnExamenId: number | '';
  }>({
    date: '',
    heure: '',
    heureExacte: false,
    type: 'placement_dp',
    misEnExamenId: '',
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sorted = useMemo(
    () => [...debats].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [debats],
  );

  const handleAdd = () => {
    if (!draft.date) return;
    let isoDate = draft.date;
    if (draft.heureExacte && draft.heure) {
      isoDate = `${draft.date}T${draft.heure}:00`;
    }
    onChange([
      ...debats,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: isoDate,
        heureExacte: draft.heureExacte && !!draft.heure,
        type: draft.type,
        misEnExamenId: draft.misEnExamenId === '' ? undefined : Number(draft.misEnExamenId),
      },
    ]);
    setDraft({ date: '', heure: '', heureExacte: false, type: 'placement_dp', misEnExamenId: '' });
    setShowForm(false);
  };

  const handleRemove = (id: number) => onChange(debats.filter(d => d.id !== id));

  const handleUpdate = (id: number, updates: Partial<DebatJLDPlanifie>) =>
    onChange(debats.map(d => (d.id === id ? { ...d, ...updates } : d)));

  const mexNameOf = (id?: number) => misEnExamen.find(m => m.id === id)?.nom || null;

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        Débats JLD planifiés ou passés (placement, prolongation, DML).
        Renseignez l'heure exacte communiquée par le JLD.
      </div>

      {sorted.length === 0 && !showForm && (
        <div className="text-center py-4 text-sm text-gray-400 italic bg-gray-50 border border-dashed border-gray-200 rounded">
          Aucun débat JLD enregistré.
        </div>
      )}

      <div className="space-y-2">
        {sorted.map(debat => {
          const date = new Date(debat.date);
          const dayOnly = new Date(date);
          dayOnly.setHours(0, 0, 0, 0);
          const joursDiff = Math.ceil((dayOnly.getTime() - today.getTime()) / 86400000);
          const passed = joursDiff < 0;
          const proche = !passed && joursDiff <= 14;
          const mexName = mexNameOf(debat.misEnExamenId);
          return (
            <div
              key={debat.id}
              className={`border rounded p-2 text-sm ${
                passed
                  ? 'border-gray-200 bg-gray-50 text-gray-600'
                  : proche
                  ? 'border-indigo-300 bg-indigo-50'
                  : 'border-indigo-200 bg-indigo-50/30'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Gavel className="h-3.5 w-3.5 text-indigo-500" />
                    <span className="font-semibold">
                      {date.toLocaleDateString()}
                      {debat.heureExacte && ' à ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${TYPE_COLOR[debat.type]}`}>
                      {TYPE_LABEL[debat.type]}
                    </span>
                    {mexName && (
                      <span className="text-xs text-gray-700">· {mexName}</span>
                    )}
                    {!debat.heureExacte && !passed && (
                      <span className="text-[10px] text-amber-700 italic flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        heure non communiquée
                      </span>
                    )}
                    <span className={`text-[10px] uppercase tracking-wide ml-auto ${
                      passed ? 'text-gray-500' : proche ? 'text-indigo-700 font-semibold' : 'text-indigo-600'
                    }`}>
                      {passed ? `il y a ${Math.abs(joursDiff)} j` : joursDiff === 0 ? 'aujourd\'hui' : `J+${joursDiff}`}
                    </span>
                  </div>
                  {debat.notes && (
                    <div className="text-xs text-gray-600 mt-0.5">{debat.notes}</div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-gray-600 mt-1">
                    {debat.requisitionsRedigees && (
                      <span className="inline-flex items-center text-emerald-700">
                        <Check className="h-3 w-3 mr-0.5" />
                        Réq. rédigées{debat.dateRequisitions ? ` le ${new Date(debat.dateRequisitions).toLocaleDateString()}` : ''}
                      </span>
                    )}
                    {debat.decision && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                        Décision : {DECISION_LABEL[debat.decision]}
                      </span>
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <button
                    onClick={() => handleRemove(debat.id)}
                    className="text-gray-400 hover:text-red-600 shrink-0"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>

              {!readOnly && (
                <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-200">
                  {!passed ? (
                    <>
                      <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!debat.requisitionsRedigees}
                          onChange={(e) =>
                            handleUpdate(debat.id, {
                              requisitionsRedigees: e.target.checked,
                              dateRequisitions: e.target.checked
                                ? debat.dateRequisitions || new Date().toISOString().split('T')[0]
                                : undefined,
                            })
                          }
                        />
                        Réquisitions rédigées
                      </label>
                      {debat.requisitionsRedigees && (
                        <Input
                          type="date"
                          value={debat.dateRequisitions || ''}
                          onChange={(e) => handleUpdate(debat.id, { dateRequisitions: e.target.value || undefined })}
                          className="h-6 text-xs w-36"
                        />
                      )}
                    </>
                  ) : (
                    <select
                      value={debat.decision || ''}
                      onChange={(e) =>
                        handleUpdate(debat.id, { decision: (e.target.value || undefined) as DebatJLDPlanifie['decision'] })
                      }
                      className="h-6 text-xs border border-gray-300 rounded px-1.5"
                    >
                      <option value="">Décision rendue…</option>
                      {(Object.keys(DECISION_LABEL) as Array<keyof typeof DECISION_LABEL>).map(k => (
                        <option key={k} value={k}>{DECISION_LABEL[k]}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-indigo-300 rounded p-3 bg-indigo-50/30 space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Nouveau débat JLD</h4>
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
                <Label className="text-xs">Type *</Label>
                <select
                  value={draft.type}
                  onChange={(e) => setDraft(d => ({ ...d, type: e.target.value as TypeDebatJLD }))}
                  className="w-full h-8 text-sm border border-gray-300 rounded px-2"
                >
                  {(Object.keys(TYPE_LABEL) as TypeDebatJLD[]).map(k => (
                    <option key={k} value={k}>{TYPE_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-end gap-2">
                <label className="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer mb-1">
                  <input
                    type="checkbox"
                    checked={draft.heureExacte}
                    onChange={(e) => setDraft(d => ({ ...d, heureExacte: e.target.checked }))}
                  />
                  Heure exacte connue
                </label>
                {draft.heureExacte && (
                  <Input
                    type="time"
                    value={draft.heure}
                    onChange={(e) => setDraft(d => ({ ...d, heure: e.target.value }))}
                    className="h-8 text-sm w-32"
                  />
                )}
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Mis en examen concerné</Label>
                <select
                  value={draft.misEnExamenId}
                  onChange={(e) => setDraft(d => ({ ...d, misEnExamenId: e.target.value === '' ? '' : Number(e.target.value) }))}
                  className="w-full h-8 text-sm border border-gray-300 rounded px-2"
                >
                  <option value="">— Aucun / non précisé —</option>
                  {misEnExamen.map(m => (
                    <option key={m.id} value={m.id}>{m.nom}</option>
                  ))}
                </select>
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
                className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus className="h-3 w-3 mr-1" />
                Ajouter le débat
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-sm text-indigo-700 hover:bg-indigo-50 py-2 rounded border-2 border-dashed border-indigo-300 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Planifier un débat JLD
          </button>
        )
      )}
    </div>
  );
};
