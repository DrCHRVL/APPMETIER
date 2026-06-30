'use client';

import React, { useMemo, useState } from 'react';
import { Sparkles, Plus, X } from 'lucide-react';
import { useNatinf } from '@/hooks/useNatinf';
import { getNatinfGroupSuggestions } from '@/config/natinfGroups';
import { NatinfBadge } from './NatinfBadge';

interface NatinfGroupSuggestionsProps {
  /** Codes NATINF actuellement sélectionnés. */
  selectedCodes: string[];
  /** Ajout des codes manquants d'une famille (dédoublonnage côté appelant). */
  onAdd: (codes: string[]) => void;
  className?: string;
}

/**
 * Propose, de façon non intrusive, d'ajouter les chefs « jumeaux » d'une
 * famille d'infractions dès qu'un de ses codes est saisi (cf. config/natinfGroups).
 * Exemple : on saisit « Détention 7991 » → proposition d'ajouter Transport 7990,
 * Offre/cession 7992, Acquisition 7993. Chaque proposition peut être ignorée.
 */
export const NatinfGroupSuggestions = ({ selectedCodes, onAdd, className }: NatinfGroupSuggestionsProps) => {
  const { getByCode } = useNatinf();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const suggestions = useMemo(
    () => getNatinfGroupSuggestions(selectedCodes).filter((s) => !dismissed.has(s.group.id)),
    [selectedCodes, dismissed],
  );

  if (suggestions.length === 0) return null;

  const dismiss = (groupId: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });

  return (
    <div className={`space-y-1.5 ${className || ''}`}>
      {suggestions.map(({ group, missing }) => (
        <div
          key={group.id}
          className="rounded-md border border-blue-200 bg-blue-50/70 p-2 text-xs"
        >
          <div className="flex items-start gap-1.5">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-blue-800">Famille « {group.label} »</span>
              <span className="text-blue-700">
                {' '}— ajouter aussi {missing.length === 1 ? "l'infraction liée" : `les ${missing.length} infractions liées`} ?
              </span>
            </div>
            <button
              type="button"
              onClick={() => dismiss(group.id)}
              className="shrink-0 text-blue-400 hover:text-blue-600"
              aria-label="Ignorer la suggestion"
              title="Ignorer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-5">
            {missing.map((code) => {
              const e = getByCode(code);
              return (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-1.5 py-0.5"
                  title={e?.libelle}
                >
                  <span className="max-w-[12rem] truncate text-gray-700">{e?.libelle ?? `NATINF ${code}`}</span>
                  <NatinfBadge code={code} nature={e?.nature} quantumLabel={e?.quantumLabel} compact />
                </span>
              );
            })}
          </div>

          <div className="mt-1.5 pl-5">
            <button
              type="button"
              onClick={() => {
                onAdd(missing);
                dismiss(group.id);
              }}
              className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-3 w-3" />
              Tout ajouter
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
