import React, { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';

interface OPTimelineProps {
  enquetes: Enquete[];
}

interface OPEvent {
  enqueteId: number;
  numero: string;
  dateOP: Date;
  daysFromToday: number;
}

const DAYS_RANGE = 40; // ~6 semaines
const OP_DURATION_DAYS = 4; // 96h
const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']; // index par getDay() (0=Dim)
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export const OPTimeline = ({ enquetes }: OPTimelineProps) => {
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
    const events: OPEvent[] = [];
    enquetes.forEach(e => {
      if (!e.dateOP || e.statut === 'archive') return;
      const dateOP = new Date(e.dateOP);
      dateOP.setHours(0, 0, 0, 0);
      const opEndDate = new Date(dateOP);
      opEndDate.setDate(opEndDate.getDate() + OP_DURATION_DAYS);
      if (opEndDate < today || dateOP > rangeEnd) return;
      const daysFromToday = Math.round((dateOP.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      events.push({ enqueteId: e.id, numero: e.numero, dateOP, daysFromToday });
    });
    return events.sort((a, b) => a.dateOP.getTime() - b.dateOP.getTime());
  }, [enquetes, today, rangeEnd]);

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

            {/* Barres 96h (positionnées dans le conteneur relatif) */}
            {opEvents.map((event, idx) => {
              const leftPct = (event.daysFromToday / DAYS_RANGE) * 100;
              const clampedLeft = Math.max(0, leftPct);
              const barWidthPct = ((OP_DURATION_DAYS + Math.min(0, event.daysFromToday)) / DAYS_RANGE) * 100;
              const isUrgent = event.daysFromToday <= 3;
              const isSoon = event.daysFromToday <= 7;
              const barBg = isUrgent ? '#fca5a5' : isSoon ? '#fdba74' : '#93c5fd'; // red-300 / orange-300 / blue-300
              return (
                <div
                  key={`bar-${event.enqueteId}`}
                  className="absolute rounded-sm pointer-events-none"
                  style={{
                    left: `${clampedLeft}%`,
                    width: `${Math.min(barWidthPct, 100 - clampedLeft)}%`,
                    top: idx * ROW_H + 8,
                    height: 12,
                    backgroundColor: barBg,
                    opacity: 0.55,
                  }}
                />
              );
            })}

            {/* Points + étiquettes */}
            {opEvents.map((event, idx) => {
              const leftPct = (event.daysFromToday / DAYS_RANGE) * 100;
              const clampedLeft = Math.max(0, leftPct);
              const isUrgent = event.daysFromToday <= 3;
              const isSoon = event.daysFromToday <= 7;
              const dotColor = isUrgent ? 'bg-red-600' : isSoon ? 'bg-orange-500' : 'bg-blue-600';
              const textColor = isUrgent ? 'text-red-700' : isSoon ? 'text-orange-700' : 'text-blue-700';

              const dayLabel =
                event.daysFromToday === 0
                  ? 'auj.'
                  : event.daysFromToday === 1
                  ? 'dem.'
                  : event.daysFromToday < 0
                  ? 'en cours'
                  : `J+${event.daysFromToday}`;

              return (
                <div
                  key={`label-${event.enqueteId}`}
                  className="absolute flex items-center z-10"
                  style={{ top: idx * ROW_H + 6, left: `${clampedLeft}%` }}
                  title={`OP ${event.numero} — dans ${event.daysFromToday} jour(s)`}
                >
                  <div className={`h-4 w-4 rounded-full ${dotColor} border-2 border-white shadow flex-shrink-0`} />
                  <span className={`ml-1 text-xs font-bold ${textColor} whitespace-nowrap leading-none`}>
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
