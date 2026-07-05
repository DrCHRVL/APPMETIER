'use client';

import React, { useMemo, useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, X, Plus, Scale } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NatinfPicker } from '../natinf/NatinfPicker';
import { NatinfGroupSuggestions } from '../natinf/NatinfGroupSuggestions';
import { NatinfBadge } from '../natinf/NatinfBadge';
import { toRef } from '@/lib/natinf/natinfData';
import { useNatinf } from '@/hooks/useNatinf';
import type { NatinfEntry } from '@/types/natinf';
import type { SaisineItem, ActeSaisine } from '@/types/instructionTypes';

interface Props {
  value: SaisineItem[];
  onChange: (next: SaisineItem[]) => void;
  readOnly?: boolean;
}

const ACTE_BADGE: Record<ActeSaisine, { short: string; full: string; color: string }> = {
  introductif: { short: 'RI', full: 'Réquisitoire introductif', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  suppletif: { short: 'Supplétif', full: 'Réquisitoire supplétif', color: 'bg-purple-100 text-purple-800 border-purple-300' },
};

export const SaisineManager = ({ value, onChange, readOnly }: Props) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { getByCode } = useNatinf();

  const newId = () => Date.now() + Math.floor(Math.random() * 1000);

  const addFromNatinf = (entry: NatinfEntry) => {
    const item: SaisineItem = {
      id: newId(),
      qualification: entry.libelle,
      natinfCode: entry.code,
      natinfRef: toRef(entry),
      acte: 'introductif',
    };
    onChange([...value, item]);
    setExpandedId(item.id);
  };

  // Codes NATINF déjà visés par la saisine (détection des familles d'infractions).
  const selectedNatinfCodes = useMemo(
    () => value.map(v => v.natinfCode).filter((c): c is string => Boolean(c)),
    [value],
  );

  // Ajout en lot des chefs « jumeaux » d'une famille (ex : quatuor stupéfiants).
  // Les codes ajoutés héritent de l'acte introductif et du snapshot NATINF.
  const addCodes = (codes: string[]) => {
    if (readOnly) return;
    const existing = new Set(value.map(v => v.natinfCode).filter(Boolean));
    const toAdd: SaisineItem[] = [];
    let seq = 0;
    for (const code of codes) {
      if (existing.has(code)) continue;
      const entry = getByCode(code);
      if (!entry) continue;
      existing.add(code);
      toAdd.push({
        id: newId() + seq++,
        qualification: entry.libelle,
        natinfCode: entry.code,
        natinfRef: toRef(entry),
        acte: 'introductif',
      });
    }
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  const addFreeText = () => {
    const item: SaisineItem = { id: newId(), qualification: '', acte: 'introductif' };
    onChange([...value, item]);
    setExpandedId(item.id);
  };

  const update = (id: number, updates: Partial<SaisineItem>) =>
    onChange(value.map(i => (i.id === id ? { ...i, ...updates } : i)));

  const remove = (id: number) => onChange(value.filter(i => i.id !== id));

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="text-xs text-gray-400 italic">
          Aucune qualification de saisine. {!readOnly && 'Ajoutez les faits dont le juge est saisi (RI, supplétifs).'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {value.map(item => {
            const isExpanded = expandedId === item.id;
            const acte = ACTE_BADGE[item.acte];
            return (
              <div key={item.id} className="border border-gray-200 rounded bg-white text-sm">
                <div className="flex items-center gap-2 p-2">
                  <span
                    className={`shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${acte.color}`}
                    title={acte.full}
                  >
                    {acte.short}
                  </span>
                  <span className="font-medium text-gray-800 truncate min-w-0 flex-1">
                    {item.qualification || <span className="text-gray-400 italic">Qualification à préciser</span>}
                  </span>
                  {item.natinfRef && (
                    <NatinfBadge
                      nature={item.natinfRef.nature}
                      code={item.natinfRef.code}
                      title={item.natinfRef.libelle}
                      className="shrink-0"
                    />
                  )}
                  {item.dateActe && (
                    <span className="shrink-0 text-[11px] text-gray-500">
                      {new Date(item.dateActe).toLocaleDateString()}
                    </span>
                  )}
                  {!readOnly && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="h-6 px-1 text-xs text-gray-500 hover:bg-gray-100"
                        title={isExpanded ? 'Réduire' : 'Détails'}
                      >
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(item.id)}
                        className="h-6 px-1 text-xs text-red-600 hover:bg-red-50"
                        title="Retirer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>

                {/* Faits visibles en lecture seule s'ils existent */}
                {readOnly && item.faits && (
                  <div className="border-t border-gray-100 p-2 text-xs text-gray-600 whitespace-pre-wrap bg-gray-50/50">
                    {item.faits}
                  </div>
                )}

                {!readOnly && isExpanded && (
                  <div className="border-t border-gray-100 p-2 space-y-2 bg-gray-50/50">
                    <Input
                      value={item.qualification}
                      onChange={(e) => update(item.id, { qualification: e.target.value })}
                      placeholder="Qualification des faits"
                      className="text-xs h-7"
                    />

                    <div className="space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">NATINF</div>
                      {item.natinfRef ? (
                        <div className="flex items-center gap-2">
                          <NatinfBadge nature={item.natinfRef.nature} code={item.natinfRef.code} />
                          <span className="min-w-0 flex-1 truncate text-xs text-gray-700" title={item.natinfRef.libelle}>
                            {item.natinfRef.libelle}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => update(item.id, { natinfCode: undefined, natinfRef: undefined })}
                            className="h-6 px-1 text-gray-400 hover:text-red-600"
                            title="Détacher le NATINF"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <NatinfPicker
                          onSelect={(entry) =>
                            update(item.id, {
                              natinfCode: entry.code,
                              natinfRef: toRef(entry),
                              // si la qualification est vide, on reprend le libellé NATINF
                              qualification: item.qualification.trim() || entry.libelle,
                            })
                          }
                          placeholder="Rattacher un NATINF…"
                        />
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Acte</div>
                        <select
                          value={item.acte}
                          onChange={(e) => update(item.id, { acte: e.target.value as ActeSaisine })}
                          className="w-full h-7 px-2 text-xs border border-gray-300 rounded"
                        >
                          <option value="introductif">Réquisitoire introductif</option>
                          <option value="suppletif">Réquisitoire supplétif</option>
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400 mb-0.5">Date de l'acte</div>
                        <Input
                          type="date"
                          value={item.dateActe || ''}
                          onChange={(e) => update(item.id, { dateActe: e.target.value || undefined })}
                          className="text-xs h-7"
                        />
                      </div>
                    </div>

                    <textarea
                      value={item.faits || ''}
                      onChange={(e) => update(item.id, { faits: e.target.value || undefined })}
                      rows={2}
                      placeholder="Exposé des faits visés"
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded resize-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <div className="border border-dashed border-gray-300 rounded p-2 bg-gray-50 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <Scale className="h-3 w-3" />
            Ajouter une qualification (recherche NATINF par n° ou libellé)
          </div>
          <NatinfPicker onSelect={addFromNatinf} placeholder="N° NATINF ou libellé…" />
          <NatinfGroupSuggestions selectedCodes={selectedNatinfCodes} onAdd={addCodes} />
          <button
            type="button"
            onClick={addFreeText}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-700"
          >
            <Plus className="h-3 w-3" /> Qualification libre (sans NATINF)
          </button>
        </div>
      )}
    </div>
  );
};
