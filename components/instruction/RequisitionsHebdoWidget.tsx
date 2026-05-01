'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks, AlertTriangle, Gavel, Calendar as CalendarIcon, Check } from 'lucide-react';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { FALLBACK_CABINET_COLOR } from '@/config/instructionConfig';
import type { DossierInstruction } from '@/types/instructionTypes';

interface Props {
  dossiers: DossierInstruction[];
  onOpenDossier?: (id: number) => void;
  /** Plage en jours (défaut 7) */
  daysRange?: number;
  defaultOpen?: boolean;
}

type Kind = 'dml' | 'jld' | 'op';

interface Item {
  key: string;
  kind: Kind;
  date: Date;
  daysLeft: number; // négatif si en retard
  dossierId: number;
  dossierLabel: string;
  cabinetColor: string;
  description: string;
  done: boolean;
  echu?: boolean;
}

const KIND_META: Record<Kind, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  dml: { label: 'DML',         bg: 'bg-purple-100', text: 'text-purple-800', icon: Gavel },
  jld: { label: 'Débat JLD',   bg: 'bg-indigo-100', text: 'text-indigo-800', icon: Gavel },
  op:  { label: 'OP du JI',    bg: 'bg-blue-100',   text: 'text-blue-800',   icon: CalendarIcon },
};

export const RequisitionsHebdoWidget = ({
  dossiers,
  onOpenDossier,
  daysRange = 7,
  defaultOpen = true,
}: Props) => {
  const { getCabinetById } = useInstructionCabinets();
  const [open, setOpen] = useState(defaultOpen);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const limit = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysRange);
    return d;
  }, [today, daysRange]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const dossier of dossiers) {
      const cabinet = getCabinetById(dossier.cabinetId);
      const cabinetColor = cabinet?.color || FALLBACK_CABINET_COLOR;
      const dossierLabel = dossier.numeroInstruction;

      // DML en attente
      for (const mex of dossier.misEnExamen) {
        for (const dml of mex.dmls) {
          if (dml.statut !== 'en_attente') continue;
          const date = new Date(dml.dateEcheance);
          date.setHours(0, 0, 0, 0);
          const daysLeft = Math.ceil((date.getTime() - today.getTime()) / 86400000);
          // Inclure les retards + les imminents dans la fenêtre
          if (daysLeft >= -30 && date <= limit) {
            out.push({
              key: `dml-${dossier.id}-${dml.id}`,
              kind: 'dml',
              date,
              daysLeft,
              dossierId: dossier.id,
              dossierLabel,
              cabinetColor,
              description: `DML — ${mex.nom} (déposée le ${new Date(dml.dateDepot).toLocaleDateString()})`,
              done: !!dml.dateRequisitions,
              echu: daysLeft < 0,
            });
          }
        }
      }

      // Débats JLD à venir
      for (const debat of dossier.debatsJLD) {
        const date = new Date(debat.date);
        const dayOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const daysLeft = Math.ceil((dayOnly.getTime() - today.getTime()) / 86400000);
        if (daysLeft >= 0 && dayOnly <= limit) {
          out.push({
            key: `jld-${dossier.id}-${debat.id}`,
            kind: 'jld',
            date: dayOnly,
            daysLeft,
            dossierId: dossier.id,
            dossierLabel,
            cabinetColor,
            description: `${debat.type.replace('_', ' ')}${debat.heureExacte ? ' à ' + date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ' (heure non communiquée)'}`,
            done: !!debat.requisitionsRedigees,
          });
        }
      }

      // OP du JI à venir
      for (const op of dossier.ops) {
        const date = new Date(op.date);
        date.setHours(0, 0, 0, 0);
        const daysLeft = Math.ceil((date.getTime() - today.getTime()) / 86400000);
        if (daysLeft >= 0 && date <= limit) {
          out.push({
            key: `op-${dossier.id}-${op.id}`,
            kind: 'op',
            date,
            daysLeft,
            dossierId: dossier.id,
            dossierLabel,
            cabinetColor,
            description: op.description || op.service || 'OP programmée',
            done: !!op.requisitionsRedigees,
          });
        }
      }
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [dossiers, getCabinetById, today, limit]);

  const todo = items.filter(i => !i.done);
  const done = items.filter(i => i.done);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-semibold text-gray-700">
            Réquisitions à rédiger — {daysRange} jours
          </span>
          {todo.length > 0 && (
            <span className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
              {todo.length} à faire
            </span>
          )}
          {todo.some(i => i.echu) && (
            <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
              <AlertTriangle className="h-3 w-3" />
              {todo.filter(i => i.echu).length} en retard
            </span>
          )}
          {items.length === 0 && (
            <span className="text-[11px] text-gray-400 italic">Rien à signaler</span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-gray-100 space-y-3">
          {todo.length === 0 ? (
            <div className="text-sm text-gray-500 italic py-3 text-center">
              Aucune réquisition à rédiger dans la fenêtre.
            </div>
          ) : (
            <ul className="space-y-1">
              {todo.map(it => (
                <Row key={it.key} item={it} onOpen={onOpenDossier} />
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">
                ✓ {done.length} déjà rédigée{done.length > 1 ? 's' : ''}
              </summary>
              <ul className="space-y-1 mt-2 opacity-70">
                {done.map(it => (
                  <Row key={it.key} item={it} onOpen={onOpenDossier} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

const Row = ({ item, onOpen }: { item: Item; onOpen?: (id: number) => void }) => {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const dayLabel =
    item.daysLeft === 0
      ? 'aujourd\'hui'
      : item.daysLeft === 1
      ? 'demain'
      : item.daysLeft < 0
      ? `en retard ${Math.abs(item.daysLeft)} j`
      : `J+${item.daysLeft}`;
  return (
    <li
      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs border ${
        item.echu
          ? 'border-red-200 bg-red-50'
          : item.daysLeft <= 1
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-200 bg-white'
      } ${onOpen ? 'cursor-pointer hover:shadow-sm' : ''}`}
      onClick={() => onOpen?.(item.dossierId)}
    >
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: item.cabinetColor }}
      />
      <Icon className="h-3 w-3 text-gray-500 shrink-0" />
      <span className={`text-[10px] uppercase tracking-wide px-1 py-0.5 rounded ${meta.bg} ${meta.text}`}>
        {meta.label}
      </span>
      <span className="font-semibold text-gray-800 shrink-0">{item.dossierLabel}</span>
      <span className="text-gray-600 truncate">{item.description}</span>
      <span className={`ml-auto whitespace-nowrap font-medium ${
        item.echu ? 'text-red-700' : item.daysLeft <= 1 ? 'text-amber-700' : 'text-gray-600'
      }`}>
        {dayLabel}
      </span>
      {item.done && <Check className="h-3 w-3 text-emerald-600 shrink-0" />}
    </li>
  );
};
