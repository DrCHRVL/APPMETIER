'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, MapPin, Calendar as CalendarIcon, ChevronDown, ChevronUp, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { useTags } from '@/hooks/useTags';
import { useNatinf } from '@/hooks/useNatinf';
import { toRef } from '@/lib/natinf/natinfData';
import { NatinfPicker } from '../../natinf/NatinfPicker';
import { NatinfGroupSuggestions } from '../../natinf/NatinfGroupSuggestions';
import { NatinfBadge } from '../../natinf/NatinfBadge';
import type { InfractionReproche } from '@/types/instructionTypes';

interface Props {
  value: InfractionReproche[];
  onChange: (next: InfractionReproche[]) => void;
  readOnly?: boolean;
}

export const InfractionsManager = ({ value, onChange, readOnly }: Props) => {
  const { getTagsByCategory, isLoading } = useTags();
  const { getByCode } = useNatinf();
  const infractionTags = useMemo(() => getTagsByCategory('infractions'), [getTagsByCategory]);
  const sortedTags = useMemo(
    () => [...infractionTags].sort((a, b) => a.value.localeCompare(b.value, 'fr')),
    [infractionTags],
  );
  const selectedValues = useMemo(
    () => new Set(value.map(v => v.qualification)),
    [value],
  );
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleToggleTag = (tagValue: string) => {
    if (readOnly) return;
    if (selectedValues.has(tagValue)) {
      onChange(value.filter(v => v.qualification !== tagValue));
    } else {
      // Continuité tags ↔ NATINF : si le tag est relié à un seul code NATINF,
      // on rattache automatiquement le chef au référentiel.
      const def = infractionTags.find(t => t.value === tagValue);
      let natinfCode: string | undefined;
      let natinfRef: InfractionReproche['natinfRef'];
      if (def?.natinfCodes?.length === 1) {
        natinfCode = def.natinfCodes[0];
        const entry = getByCode(natinfCode);
        if (entry) natinfRef = toRef(entry);
      }
      onChange([
        ...value,
        {
          id: Date.now() + Math.floor(Math.random() * 1000),
          qualification: tagValue,
          natinfCode,
          natinfRef,
        },
      ]);
    }
  };

  const handleSetNatinf = (id: number, entry: Parameters<typeof toRef>[0]) =>
    handleUpdate(id, { natinfCode: entry.code, natinfRef: toRef(entry) });

  const handleClearNatinf = (id: number) =>
    handleUpdate(id, { natinfCode: undefined, natinfRef: undefined });

  const handleRemove = (id: number) => onChange(value.filter(i => i.id !== id));

  const handleUpdate = (id: number, updates: Partial<InfractionReproche>) =>
    onChange(value.map(i => (i.id === id ? { ...i, ...updates } : i)));

  // Création primaire d'un chef directement depuis le référentiel NATINF :
  // qualification = libellé officiel, code + snapshot renseignés d'office.
  const handleAddFromNatinf = (entry: Parameters<typeof toRef>[0]) => {
    if (readOnly) return;
    if (value.some(v => v.natinfCode === entry.code)) return; // évite les doublons
    onChange([
      ...value,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        qualification: entry.libelle,
        natinfCode: entry.code,
        natinfRef: toRef(entry),
      },
    ]);
  };

  // Codes NATINF déjà rattachés à un chef (pour la détection de familles).
  const selectedNatinfCodes = useMemo(
    () => value.map(v => v.natinfCode).filter((c): c is string => Boolean(c)),
    [value],
  );

  // Ajout en lot des chefs « jumeaux » d'une famille (suggestion).
  const handleAddCodes = (codes: string[]) => {
    if (readOnly) return;
    const existing = new Set(value.map(v => v.natinfCode).filter(Boolean));
    const toAdd: InfractionReproche[] = [];
    let seq = 0;
    for (const code of codes) {
      if (existing.has(code)) continue;
      const entry = getByCode(code);
      if (!entry) continue;
      existing.add(code);
      toAdd.push({
        id: Date.now() + Math.floor(Math.random() * 1000) + seq++,
        qualification: entry.libelle,
        natinfCode: entry.code,
        natinfRef: toRef(entry),
      });
    }
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  return (
    <div className="space-y-3">
      {/* Liste des infractions sélectionnées avec détails (date, lieu, contexte) */}
      {value.length === 0 ? (
        <div className="text-xs text-gray-400 italic">Aucune infraction sélectionnée.</div>
      ) : (
        <div className="space-y-1.5">
          {value.map(inf => {
            const isExpanded = expandedId === inf.id;
            const hasDetails = !!(inf.dateInfraction || inf.lieuInfraction || inf.explication);
            return (
              <div key={inf.id} className="border border-gray-200 rounded bg-white text-sm">
                <div className="flex items-center gap-2 p-2">
                  <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-800 border border-gray-200">
                    {inf.qualification}
                  </span>
                  {inf.natinfRef && (
                    <NatinfBadge
                      nature={inf.natinfRef.nature}
                      code={inf.natinfRef.code}
                      title={inf.natinfRef.libelle}
                      className="shrink-0"
                    />
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500 flex-1 min-w-0">
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
                  {!readOnly && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedId(isExpanded ? null : inf.id)}
                        className="h-6 px-1 text-xs text-gray-500 hover:bg-gray-100"
                        title={isExpanded ? 'Réduire' : 'Détails (date, lieu, contexte)'}
                      >
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(inf.id)}
                        className="h-6 px-1 text-xs text-red-600 hover:bg-red-50"
                        title="Retirer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
                {(isExpanded || (readOnly && hasDetails && inf.explication)) && (
                  <div className="border-t border-gray-100 p-2 space-y-1.5 bg-gray-50/50">
                    {readOnly ? (
                      inf.explication && (
                        <div className="text-xs text-gray-600 whitespace-pre-wrap">{inf.explication}</div>
                      )
                    ) : (
                      <>
                        <div className="space-y-1">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                            NATINF
                          </div>
                          {inf.natinfRef ? (
                            <div className="flex items-center gap-2">
                              <NatinfBadge nature={inf.natinfRef.nature} code={inf.natinfRef.code} />
                              <span className="min-w-0 flex-1 truncate text-xs text-gray-700" title={inf.natinfRef.libelle}>
                                {inf.natinfRef.libelle}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearNatinf(inf.id)}
                                className="h-6 px-1 text-gray-400 hover:text-red-600"
                                title="Détacher le NATINF"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <NatinfPicker
                              onSelect={(entry) => handleSetNatinf(inf.id, entry)}
                              placeholder="Rattacher un NATINF…"
                            />
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="date"
                            value={inf.dateInfraction || ''}
                            onChange={(e) => handleUpdate(inf.id, { dateInfraction: e.target.value || undefined })}
                            className="text-xs h-7"
                          />
                          <Input
                            value={inf.lieuInfraction || ''}
                            onChange={(e) => handleUpdate(inf.id, { lieuInfraction: e.target.value || undefined })}
                            placeholder="Lieu"
                            className="text-xs h-7"
                          />
                        </div>
                        <textarea
                          value={inf.explication || ''}
                          onChange={(e) => handleUpdate(inf.id, { explication: e.target.value || undefined })}
                          rows={2}
                          placeholder="Contexte / faits"
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded resize-none"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ajout primaire par le référentiel NATINF (remplit code + libellé). */}
      {!readOnly && (
        <div className="border border-dashed border-emerald-300 rounded p-2 bg-emerald-50/40">
          <div className="text-[11px] text-gray-600 mb-1.5">
            Ajouter un chef d'infraction (référentiel NATINF)
          </div>
          <NatinfPicker
            onSelect={handleAddFromNatinf}
            placeholder="Rechercher une infraction (n° NATINF ou libellé)…"
          />
          <NatinfGroupSuggestions
            selectedCodes={selectedNatinfCodes}
            onAdd={handleAddCodes}
            className="mt-2"
          />
        </div>
      )}

      {/* Sélecteur de tags d'infraction (secondaire ; NATINF rattaché si possible) */}
      {!readOnly && (
        <div className="border border-dashed border-gray-300 rounded p-2 bg-gray-50">
          <div className="text-[11px] text-gray-500 mb-1.5">
            Ou sélectionnez un type d'infraction (référentiel commun aux enquêtes)
            {isLoading && ' — chargement…'}
          </div>
          {sortedTags.length === 0 ? (
            <div className="text-xs text-gray-400 italic">
              Aucun tag d'infraction défini. Créez-en depuis la gestion des tags.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sortedTags.map(tag => {
                const isSelected = selectedValues.has(tag.value);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleToggleTag(tag.value)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {tag.value}
                  </button>
                );
              })}
            </div>
          )}
          {/* Infractions historiques non présentes dans la liste de tags
              (ex: anciens dossiers saisis en texte libre). On les conserve
              et permet leur suppression individuelle. */}
          {value.some(v => !sortedTags.find(t => t.value === v.qualification)) && (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="text-[10px] text-amber-700 mb-1">
                Anciennes saisies hors référentiel — à reclasser :
              </div>
              <div className="flex flex-wrap gap-1.5">
                {value
                  .filter(v => !sortedTags.find(t => t.value === v.qualification))
                  .map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleRemove(v.id)}
                      className="text-xs px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                      title="Retirer (saisie libre)"
                    >
                      {v.qualification} ×
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
