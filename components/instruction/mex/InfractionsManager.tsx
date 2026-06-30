'use client';

import React, { useMemo, useState } from 'react';
import { Trash2, MapPin, Calendar as CalendarIcon, ChevronDown, ChevronUp, Scale } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { NatinfGroupSuggestions } from '../../natinf/NatinfGroupSuggestions';
import { NatinfBadge } from '../../natinf/NatinfBadge';
import type { InfractionReproche, SaisineItem } from '@/types/instructionTypes';

interface Props {
  value: InfractionReproche[];
  onChange: (next: InfractionReproche[]) => void;
  /** Saisine in rem du dossier : périmètre des chefs possibles. On ne peut pas
   *  mettre en examen pour un fait qui n'en fait pas partie. */
  saisine?: SaisineItem[];
  readOnly?: boolean;
}

// Clé d'identité d'un chef (NATINF prioritaire, sinon libellé) servant à
// rapprocher un chef de mise en examen d'une qualification de la saisine.
const chefKey = (code: string | undefined, qualification: string) =>
  code ? `c:${code}` : `q:${qualification.trim().toLowerCase()}`;

export const InfractionsManager = ({ value, onChange, saisine = [], readOnly }: Props) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Qualifications disponibles, issues de la saisine in rem (dédoublonnées).
  // C'est l'unique source des chefs : impossible d'inculper hors saisine.
  const saisineOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { key: string; qualification: string; natinfCode?: string; natinfRef?: InfractionReproche['natinfRef'] }[] = [];
    for (const item of saisine) {
      const qualification = (item.qualification || item.natinfRef?.libelle || (item.natinfCode ? `NATINF ${item.natinfCode}` : '')).trim();
      if (!qualification && !item.natinfCode) continue;
      const key = chefKey(item.natinfCode, qualification);
      if (seen.has(key)) continue;
      seen.add(key);
      opts.push({ key, qualification, natinfCode: item.natinfCode, natinfRef: item.natinfRef });
    }
    return opts;
  }, [saisine]);

  // Chefs déjà retenus, indexés par clé d'identité.
  const selectedKeys = useMemo(
    () => new Set(value.map(v => chefKey(v.natinfCode, v.qualification))),
    [value],
  );

  // Codes NATINF de la saisine = périmètre proposable pour les familles.
  const saisineCodes = useMemo(
    () => saisineOptions.map(o => o.natinfCode).filter((c): c is string => Boolean(c)),
    [saisineOptions],
  );

  const handleRemove = (id: number) => onChange(value.filter(i => i.id !== id));

  const handleUpdate = (id: number, updates: Partial<InfractionReproche>) =>
    onChange(value.map(i => (i.id === id ? { ...i, ...updates } : i)));

  // Sélection / désélection d'un chef à partir d'une qualification de la saisine.
  const handleToggleSaisine = (opt: (typeof saisineOptions)[number]) => {
    if (readOnly) return;
    if (selectedKeys.has(opt.key)) {
      onChange(value.filter(v => chefKey(v.natinfCode, v.qualification) !== opt.key));
    } else {
      onChange([
        ...value,
        {
          id: Date.now() + Math.floor(Math.random() * 1000),
          qualification: opt.qualification,
          natinfCode: opt.natinfCode,
          natinfRef: opt.natinfRef,
        },
      ]);
    }
  };

  // Codes NATINF déjà retenus comme chefs (pour la détection de familles).
  const selectedNatinfCodes = useMemo(
    () => value.map(v => v.natinfCode).filter((c): c is string => Boolean(c)),
    [value],
  );

  // Ajout en lot des chefs « jumeaux » d'une famille — restreint à la saisine :
  // on ne propose et n'ajoute que des codes effectivement visés par la saisine.
  const handleAddCodes = (codes: string[]) => {
    if (readOnly) return;
    const existing = new Set(value.map(v => v.natinfCode).filter(Boolean));
    const byCode = new Map(saisineOptions.filter(o => o.natinfCode).map(o => [o.natinfCode!, o] as const));
    const toAdd: InfractionReproche[] = [];
    let seq = 0;
    for (const code of codes) {
      if (existing.has(code)) continue;
      const opt = byCode.get(code);
      if (!opt) continue; // hors saisine : ignoré
      existing.add(code);
      toAdd.push({
        id: Date.now() + Math.floor(Math.random() * 1000) + seq++,
        qualification: opt.qualification,
        natinfCode: opt.natinfCode,
        natinfRef: opt.natinfRef,
      });
    }
    if (toAdd.length > 0) onChange([...value, ...toAdd]);
  };

  // Chefs hors saisine (anciennes saisies, ou saisine modifiée depuis) : on les
  // conserve mais on les signale, car ils sortent désormais du périmètre.
  const horsSaisine = useMemo(
    () => value.filter(v => !saisineOptions.some(o => o.key === chefKey(v.natinfCode, v.qualification))),
    [value, saisineOptions],
  );

  return (
    <div className="space-y-3">
      {/* Liste des chefs retenus avec détails (date, lieu, contexte) */}
      {value.length === 0 ? (
        <div className="text-xs text-gray-400 italic">Aucun chef d'inculpation retenu.</div>
      ) : (
        <div className="space-y-1.5">
          {value.map(inf => {
            const isExpanded = expandedId === inf.id;
            const hasDetails = !!(inf.dateInfraction || inf.lieuInfraction || inf.explication);
            const isHorsSaisine = horsSaisine.some(h => h.id === inf.id);
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
                  {isHorsSaisine && (
                    <span
                      className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300"
                      title="Ce chef ne figure pas dans la saisine in rem actuelle. Vérifiez la saisine ou retirez-le."
                    >
                      hors saisine
                    </span>
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

      {/* Sélection des chefs dans le périmètre de la saisine in rem.
          La mise en examen ne peut viser que des faits dont le juge est saisi. */}
      {!readOnly && (
        <div className="border border-dashed border-emerald-300 rounded p-2 bg-emerald-50/40">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-600 mb-1.5">
            <Scale className="h-3 w-3" />
            Chefs visés par la saisine in rem
          </div>
          {saisineOptions.length === 0 ? (
            <div className="text-xs text-gray-400 italic">
              Aucune qualification dans la saisine in rem. Renseignez d'abord la saisine
              (onglet Aperçu) pour pouvoir mettre en examen.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {saisineOptions.map(opt => {
                const isSelected = selectedKeys.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => handleToggleSaisine(opt)}
                    title={opt.qualification}
                    className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    <span className="max-w-[16rem] truncate">{opt.qualification}</span>
                    {opt.natinfCode && (
                      <span className={`font-mono text-[10px] ${isSelected ? 'text-emerald-100' : 'text-gray-400'}`}>
                        {opt.natinfCode}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <NatinfGroupSuggestions
            selectedCodes={selectedNatinfCodes}
            availableCodes={saisineCodes}
            onAdd={handleAddCodes}
            className="mt-2"
          />
        </div>
      )}
    </div>
  );
};
