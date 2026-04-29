import React, { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxDefinition } from '@/types/userTypes';
import { getOPPhases, getOPPhaseEndDate } from '@/utils/opPhases';

interface OPTimelineProps {
  enquetesByContentieux: Map<string, Enquete[]>;
  contentieuxDefs: ContentieuxDefinition[];
  /** Callback déclenché au clic sur une enquête de la frise. */
  onEnqueteClick?: (enqueteId: number, contentieuxId: string) => void;
}

interface OPEvent {
  key: string;
  enqueteId: number;
  numero: string;
  dateOP: Date;
  durationDays: number;
  daysFromToday: number;
  contentieuxId: string;
  color: string; // hex, depuis contentieuxDefs
}

const DAYS_RANGE = 40; // ~6 semaines
const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']; // index par getDay() (0=Dim)
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export const OPTimeline = ({ enquetesByContentieux, contentieuxDefs, onEnqueteClick }: OPTimelineProps) => {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const rangeEnd = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + DAYS_RANGE);
    return d;
  }, [today]);

  const opEvents = useMemo((): OPEvent[] => {
    const seen = new Set<string>();
    const ctxColorMap = new Map(contentieuxDefs.map(d => [d.id, d.color]));
    const events: OPEvent[] = [];

    enquetesByContentieux.forEach((enquetes, ctxId) => {
      enquetes.forEach(e => {
        if (e.statut === 'archive') return;
        const ownerCtxId = e.contentieuxOrigine || ctxId;
        const dedupeKey = `${ownerCtxId}_${e.id}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        const phases = getOPPhases(e);
        phases.forEach(phase => {
          const dateOP = new Date(phase.dateDebut);
          dateOP.setHours(0, 0, 0, 0);
          const opEndDate = getOPPhaseEndDate(phase);
          if (opEndDate < today || dateOP > rangeEnd) return;

          const daysFromToday = Math.round((dateOP.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const durationDays = Math.max(
            1,
            Math.round((opEndDate.getTime() - dateOP.getTime()) / (1000 * 60 * 60 * 24))
          );
          events.push({
            key: `${ownerCtxId}_${e.id}_${phase.id}`,
            enqueteId: e.id,
            numero: e.numero,
            dateOP,
            durationDays,
            daysFromToday,
            contentieuxId: ownerCtxId,
            color: ctxColorMap.get(ownerCtxId) || '#6b7280',
          });
        });
      });
    });

    return events.sort((a, b) => a.dateOP.getTime() - b.dateOP.getTime());
  }, [enquetesByContentieux, contentieuxDefs, today, rangeEnd]);

  // Colonnes de jours (doit être avant le return anticipé pour respecter les règles des hooks)
  const dayCells = useMemo(() => {
    return Array.from({ length: DAYS_RANGE }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dow = d.getDay(); // 0=Dim, 6=Sam
      return {
        offset: i,
        date: d,
        label: DAY_LABELS[dow],
        isWeekend: dow === 0 || dow === 6,
        isToday: i === 0,
        monthLabel: d.getDate() === 1 ? MONTHS_FR[d.getMonth()] : null,
      };
    });
  }, [today]);

  if (opEvents.length === 0) return null;

  const ROW_H = 28; // hauteur par ligne d'événement (px)

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold text-gray-700">OPs à venir — 6 semaines</span>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: `${DAYS_RANGE * 16}px` }}>

          {/* Ligne des initiales LMMJVSD + numéro du jour */}
          <div className="flex border-b border-gray-100">
            {dayCells.map(cell => (
              <div
                key={cell.offset}
                className={`flex-1 text-center py-0.5 leading-none select-none flex flex-col items-center ${
                  cell.isWeekend
                    ? 'text-gray-300 bg-gray-50'
                    : cell.isToday
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-400'
                }`}
                title={cell.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
              >
                <span className="text-[9px] font-semibold">{cell.label}</span>
                <span className={`text-[8px] font-medium ${cell.isWeekend ? 'text-gray-300' : cell.isToday ? 'text-blue-500' : 'text-gray-300'}`}>
                  {cell.date.getDate()}
                </span>
              </div>
            ))}
          </div>

          {/* Zone des événements */}
          <div className="relative flex" style={{ height: `${opEvents.length * ROW_H + 6}px` }}>
            {/* Fonds de colonnes : weekends grisés, aujourd'hui bleuté */}
            {dayCells.map(cell => (
              <div
                key={cell.offset}
                className={`flex-1 h-full ${
                  cell.isWeekend ? 'bg-gray-50' : cell.isToday ? 'bg-blue-50' : ''
                }`}
                style={{ borderRight: '1px solid #f3f4f6' }}
              />
            ))}

            {/* Barres (durée par phase : dateFin saisie ou délai 96h par défaut) */}
            {opEvents.map((event, idx) => {
              const leftPct = (event.daysFromToday / DAYS_RANGE) * 100;
              const clampedLeft = Math.max(0, leftPct);
              const barWidthPct = ((event.durationDays + Math.min(0, event.daysFromToday)) / DAYS_RANGE) * 100;
              return (
                <div
                  key={`bar-${event.key}`}
                  className="absolute rounded-sm pointer-events-none"
                  style={{
                    left: `${clampedLeft}%`,
                    width: `${Math.min(barWidthPct, 100 - clampedLeft)}%`,
                    top: idx * ROW_H + 8,
                    height: 12,
                    backgroundColor: event.color,
                    opacity: 0.35,
                  }}
                />
              );
            })}

            {/* Points + étiquettes */}
            {opEvents.map((event, idx) => {
              const leftPct = (event.daysFromToday / DAYS_RANGE) * 100;
              const clampedLeft = Math.max(0, leftPct);

              const dayLabel =
                event.daysFromToday === 0
                  ? 'auj.'
                  : event.daysFromToday === 1
                  ? 'dem.'
                  : event.daysFromToday < 0
                  ? 'en cours'
                  : `J+${event.daysFromToday}`;

              const isClickable = !!onEnqueteClick;
              const handleClick = () => onEnqueteClick?.(event.enqueteId, event.contentieuxId);
              const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClick();
                }
              };

              return (
                <div
                  key={`label-${event.key}`}
                  className={`absolute flex items-center z-10 ${
                    isClickable ? 'cursor-pointer hover:brightness-110 hover:underline focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-400 rounded-sm' : ''
                  }`}
                  style={{ top: idx * ROW_H + 6, left: `${clampedLeft}%` }}
                  title={`OP ${event.numero} — dans ${event.daysFromToday} jour(s)${isClickable ? ' — cliquer pour ouvrir' : ''}`}
                  onClick={isClickable ? handleClick : undefined}
                  onKeyDown={isClickable ? handleKeyDown : undefined}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                >
                  <div
                    className="h-4 w-4 rounded-full border-2 border-white shadow flex-shrink-0"
                    style={{ backgroundColor: event.color }}
                  />
                  <span
                    className="ml-1 text-xs font-bold whitespace-nowrap leading-none"
                    style={{ color: event.color }}
                  >
                    {event.numero}
                    <span className="font-normal text-gray-500 ml-1">{dayLabel}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Ligne des noms de mois */}
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
    </div>
  );
};
