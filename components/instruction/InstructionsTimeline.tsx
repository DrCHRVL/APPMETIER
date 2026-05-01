'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Calendar as CalendarIcon } from 'lucide-react';
import type { DossierInstruction } from '@/types/instructionTypes';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { FALLBACK_CABINET_COLOR } from '@/config/instructionConfig';

interface InstructionsTimelineProps {
  dossiers: DossierInstruction[];
  onDossierClick?: (dossierId: number) => void;
  /** Plage en jours (par défaut 42 ≈ 6 semaines) */
  daysRange?: number;
  /** Préférence d'affichage initial (true = ouvert) */
  defaultOpen?: boolean;
}

type EventType = 'fin_dp' | 'debat_jld' | 'dml_echeance' | 'op_ji';

interface TimelineEvent {
  key: string;
  date: Date;
  daysFromToday: number;
  type: EventType;
  dossierId: number;
  dossierLabel: string;
  cabinetColor: string;
  /** Texte court à afficher */
  shortLabel: string;
  /** Tooltip détaillé */
  tooltip: string;
}

const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const EVENT_TYPE_META: Record<EventType, { label: string; bgClass: string; textClass: string; icon: string }> = {
  fin_dp:       { label: 'Fin DP',     bgClass: 'bg-red-500',   textClass: 'text-red-600',   icon: '🔒' },
  debat_jld:    { label: 'Débat JLD',  bgClass: 'bg-indigo-500',textClass: 'text-indigo-600',icon: '⚖️' },
  dml_echeance: { label: 'DML',        bgClass: 'bg-purple-500',textClass: 'text-purple-600',icon: '📅' },
  op_ji:        { label: 'OP du JI',   bgClass: 'bg-blue-500',  textClass: 'text-blue-600',  icon: '🚓' },
};

const ROW_H = 24;

export const InstructionsTimeline = ({
  dossiers,
  onDossierClick,
  daysRange = 42,
  defaultOpen = true,
}: InstructionsTimelineProps) => {
  const { getCabinetById } = useInstructionCabinets();
  const [open, setOpen] = useState(defaultOpen);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const rangeEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + daysRange);
    return d;
  }, [today, daysRange]);

  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];

    for (const dossier of dossiers) {
      const cabinet = getCabinetById(dossier.cabinetId);
      const color = cabinet?.color || FALLBACK_CABINET_COLOR;
      const dossierLabel = dossier.numeroInstruction || `#${dossier.id}`;

      // Fins de DP
      for (const mex of dossier.misEnExamen) {
        if (mex.mesureSurete.type !== 'detenu') continue;
        const periode = [...mex.mesureSurete.periodes].sort(
          (a, b) => new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime(),
        )[0];
        if (!periode?.dateFin) continue;
        const date = new Date(periode.dateFin);
        date.setHours(0, 0, 0, 0);
        if (date < today || date > rangeEnd) continue;
        list.push({
          key: `dp-${dossier.id}-${mex.id}-${periode.id}`,
          date,
          daysFromToday: Math.round((date.getTime() - today.getTime()) / 86400000),
          type: 'fin_dp',
          dossierId: dossier.id,
          dossierLabel,
          cabinetColor: color,
          shortLabel: `Fin DP ${mex.nom.split(' ')[0]}`,
          tooltip: `Fin DP — ${mex.nom} — ${dossierLabel} — ${date.toLocaleDateString('fr-FR')}`,
        });
      }

      // Débats JLD planifiés
      for (const debat of dossier.debatsJLD || []) {
        const date = new Date(debat.date);
        date.setHours(0, 0, 0, 0);
        if (date < today || date > rangeEnd) continue;
        const heure = debat.heureExacte
          ? new Date(debat.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '';
        list.push({
          key: `jld-${dossier.id}-${debat.id}`,
          date,
          daysFromToday: Math.round((date.getTime() - today.getTime()) / 86400000),
          type: 'debat_jld',
          dossierId: dossier.id,
          dossierLabel,
          cabinetColor: color,
          shortLabel: `Débat JLD ${heure}`,
          tooltip: `Débat JLD — ${dossierLabel}${heure ? ` à ${heure}` : ''} — ${date.toLocaleDateString('fr-FR')}`,
        });
      }

      // Échéances DML
      for (const mex of dossier.misEnExamen) {
        for (const dml of mex.dmls || []) {
          if (dml.statut !== 'en_attente') continue;
          const date = new Date(dml.dateEcheance);
          date.setHours(0, 0, 0, 0);
          if (date < today || date > rangeEnd) continue;
          list.push({
            key: `dml-${dossier.id}-${mex.id}-${dml.id}`,
            date,
            daysFromToday: Math.round((date.getTime() - today.getTime()) / 86400000),
            type: 'dml_echeance',
            dossierId: dossier.id,
            dossierLabel,
            cabinetColor: color,
            shortLabel: `DML ${mex.nom.split(' ')[0]}`,
            tooltip: `Échéance DML — ${mex.nom} — ${dossierLabel} — ${date.toLocaleDateString('fr-FR')}`,
          });
        }
      }

      // OP fixées par le JI
      for (const op of dossier.ops || []) {
        const date = new Date(op.date);
        date.setHours(0, 0, 0, 0);
        if (date < today || date > rangeEnd) continue;
        list.push({
          key: `op-${dossier.id}-${op.id}`,
          date,
          daysFromToday: Math.round((date.getTime() - today.getTime()) / 86400000),
          type: 'op_ji',
          dossierId: dossier.id,
          dossierLabel,
          cabinetColor: color,
          shortLabel: `OP JI`,
          tooltip: `OP du JI — ${dossierLabel} — ${date.toLocaleDateString('fr-FR')}${op.description ? ` — ${op.description}` : ''}`,
        });
      }
    }

    return list.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [dossiers, getCabinetById, today, rangeEnd]);

  const dayCells = useMemo(() => {
    return Array.from({ length: daysRange }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      return {
        offset: i,
        date: d,
        label: DAY_LABELS[dow],
        isWeekend: dow === 0 || dow === 6,
        isToday: i === 0,
        monthLabel: d.getDate() === 1 || i === 0 ? MONTHS_FR[d.getMonth()] : null,
      };
    });
  }, [today, daysRange]);

  // Compteurs par type pour le résumé
  const countsByType = useMemo(() => {
    const out: Record<EventType, number> = { fin_dp: 0, debat_jld: 0, dml_echeance: 0, op_ji: 0 };
    for (const e of events) out[e.type] += 1;
    return out;
  }, [events]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-4">
      {/* Header repliable */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">
            Échéances à venir — {Math.round(daysRange / 7)} semaines
          </span>
          {events.length > 0 && (
            <span className="text-xs text-gray-500">
              ({events.length} évén.{events.length > 1 ? 's' : ''})
            </span>
          )}
          <div className="flex items-center gap-2 ml-3">
            {(Object.keys(countsByType) as EventType[]).map(t =>
              countsByType[t] > 0 ? (
                <span key={t} className="inline-flex items-center gap-1 text-[11px] text-gray-600">
                  <span className={`w-2 h-2 rounded-full ${EVENT_TYPE_META[t].bgClass}`} />
                  {countsByType[t]} {EVENT_TYPE_META[t].label}
                </span>
              ) : null,
            )}
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {/* Corps */}
      {open && (
        <div className="px-4 pb-3 pt-1 border-t border-gray-100">
          {events.length === 0 ? (
            <div className="text-sm text-gray-500 italic py-3 text-center">
              Aucune échéance dans les {Math.round(daysRange / 7)} prochaines semaines.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: `${daysRange * 16}px` }}>
                {/* Ligne LMMJVSD + numéro du jour */}
                <div className="flex border-b border-gray-100">
                  {dayCells.map(cell => (
                    <div
                      key={cell.offset}
                      className={`flex-1 text-center py-0.5 leading-none flex flex-col items-center ${
                        cell.isWeekend
                          ? 'text-gray-300 bg-gray-50'
                          : cell.isToday
                          ? 'text-blue-600 bg-blue-50'
                          : 'text-gray-400'
                      }`}
                      title={cell.date.toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    >
                      <span className="text-[9px] font-semibold">{cell.label}</span>
                      <span className="text-[8px] font-medium">{cell.date.getDate()}</span>
                    </div>
                  ))}
                </div>

                {/* Zone événements */}
                <div className="relative flex" style={{ height: `${events.length * ROW_H + 6}px` }}>
                  {/* Fonds (weekends + aujourd'hui) */}
                  {dayCells.map(cell => (
                    <div
                      key={cell.offset}
                      className={`flex-1 h-full ${
                        cell.isWeekend ? 'bg-gray-50' : cell.isToday ? 'bg-blue-50' : ''
                      }`}
                      style={{ borderRight: '1px solid #f3f4f6' }}
                    />
                  ))}

                  {/* Points + étiquettes */}
                  {events.map((event, idx) => {
                    const leftPct = (event.daysFromToday / daysRange) * 100;
                    const meta = EVENT_TYPE_META[event.type];
                    const dayLabel =
                      event.daysFromToday === 0
                        ? 'auj.'
                        : event.daysFromToday === 1
                        ? 'dem.'
                        : `J+${event.daysFromToday}`;
                    const isClickable = !!onDossierClick;
                    const handleClick = () => onDossierClick?.(event.dossierId);
                    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClick();
                      }
                    };
                    return (
                      <div
                        key={event.key}
                        className={`absolute flex items-center z-10 ${
                          isClickable
                            ? 'cursor-pointer hover:brightness-110 hover:underline focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400 rounded-sm'
                            : ''
                        }`}
                        style={{ top: idx * ROW_H + 4, left: `${leftPct}%` }}
                        title={event.tooltip + (isClickable ? ' — cliquer pour ouvrir' : '')}
                        onClick={isClickable ? handleClick : undefined}
                        onKeyDown={isClickable ? handleKeyDown : undefined}
                        role={isClickable ? 'button' : undefined}
                        tabIndex={isClickable ? 0 : undefined}
                      >
                        {/* Pastille couleur cabinet avec marqueur type */}
                        <div className="relative flex-shrink-0">
                          <div
                            className="h-4 w-4 rounded-full border-2 border-white shadow"
                            style={{ backgroundColor: event.cabinetColor }}
                          />
                          <div
                            className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${meta.bgClass}`}
                            title={meta.label}
                          />
                        </div>
                        <span
                          className="ml-1 text-[11px] font-semibold whitespace-nowrap leading-none"
                          style={{ color: event.cabinetColor }}
                        >
                          {event.dossierLabel}
                          <span className={`ml-1 ${meta.textClass}`}>{event.shortLabel}</span>
                          <span className="font-normal text-gray-400 ml-1">{dayLabel}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Ligne des mois */}
                <div className="flex border-t border-gray-100" style={{ height: 14 }}>
                  {dayCells.map(cell => (
                    <div key={cell.offset} className="flex-1 relative overflow-visible">
                      {cell.monthLabel && (
                        <span
                          className="absolute text-[9px] text-gray-400 font-medium whitespace-nowrap"
                          style={{ left: '50%', transform: 'translateX(-50%)', top: 1 }}
                        >
                          {cell.monthLabel}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
