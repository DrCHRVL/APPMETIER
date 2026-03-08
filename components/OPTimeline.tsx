import React, { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';

interface OPTimelineProps {
  enquetes: Enquete[];
}

interface OPEvent {
  enqueteId: number;
  numero: string;
  dateOP: Date;
  dateOPStr: string;
  dateFin96h: Date;
  daysFromToday: number;
}

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const DAYS_RANGE = 61; // ~2 mois

function formatDateShort(d: Date): string {
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

function formatDateFull(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0');
  const month = MONTHS_FR[d.getMonth()];
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} ${d.getFullYear()} ${hour}h${min}`;
}

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
      // Afficher les OP des 2 prochains mois (depuis aujourd'hui)
      if (dateOP < today || dateOP > rangeEnd) return;
      const dateFin96h = new Date(dateOP);
      dateFin96h.setHours(dateFin96h.getHours() + 96);
      const daysFromToday = Math.round((dateOP.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      events.push({
        enqueteId: e.id,
        numero: e.numero,
        dateOP,
        dateOPStr: e.dateOP,
        dateFin96h,
        daysFromToday,
      });
    });
    return events.sort((a, b) => a.dateOP.getTime() - b.dateOP.getTime());
  }, [enquetes, today, rangeEnd]);

  if (opEvents.length === 0) return null;

  // Construire les marqueurs de semaines pour l'axe
  const weekMarkers: { day: number; label: string }[] = [];
  for (let i = 0; i <= DAYS_RANGE; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    // Marqueur chaque lundi (ou jour 0 = aujourd'hui)
    if (i === 0 || d.getDay() === 1) {
      weekMarkers.push({ day: i, label: formatDateShort(d) });
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          OPs à venir — 2 mois
        </span>
        <span className="text-[10px] text-gray-400">(barre = 96h garde à vue max)</span>
      </div>

      {/* Conteneur timeline */}
      <div className="relative" style={{ height: `${opEvents.length * 22 + 20}px` }}>
        {/* Axe horizontal */}
        <div
          className="absolute left-0 right-0 bottom-0 border-t border-gray-200"
          style={{ height: 1 }}
        />

        {/* Marqueurs de dates sur l'axe */}
        {weekMarkers.map(({ day, label }) => (
          <div
            key={day}
            className="absolute bottom-0 flex flex-col items-center"
            style={{ left: `${(day / DAYS_RANGE) * 100}%` }}
          >
            <div className="w-px h-2 bg-gray-300" />
            <span className="text-[9px] text-gray-400 mt-0.5 whitespace-nowrap" style={{ transform: 'translateX(-50%)' }}>
              {label}
            </span>
          </div>
        ))}

        {/* Événements OP */}
        {opEvents.map((event, idx) => {
          const leftPct = (event.daysFromToday / DAYS_RANGE) * 100;
          // La durée 96h en % de la plage totale (DAYS_RANGE jours)
          const widthPct = (4 / DAYS_RANGE) * 100; // 96h = 4 jours

          const isUrgent = event.daysFromToday <= 3;
          const isSoon = event.daysFromToday <= 7;

          const barColor = isUrgent
            ? 'bg-red-400'
            : isSoon
            ? 'bg-orange-400'
            : 'bg-blue-400';

          const dotColor = isUrgent
            ? 'bg-red-600'
            : isSoon
            ? 'bg-orange-500'
            : 'bg-blue-600';

          const textColor = isUrgent
            ? 'text-red-700'
            : isSoon
            ? 'text-orange-700'
            : 'text-blue-700';

          // Décalage vertical pour chaque événement (empilés)
          const topPx = idx * 22;

          return (
            <div
              key={event.enqueteId}
              className="absolute flex items-center"
              style={{ top: topPx, left: `${leftPct}%`, right: 0 }}
              title={`OP: ${formatDateFull(event.dateOP)} — Fin GAV max: ${formatDateFull(event.dateFin96h)}`}
            >
              {/* Bande 96h */}
              <div
                className={`absolute h-3 ${barColor} opacity-30 rounded-sm`}
                style={{
                  left: 0,
                  width: `${Math.min(widthPct, 100 - leftPct)}%`,
                }}
              />

              {/* Point de départ OP */}
              <div className={`relative z-10 h-3 w-3 rounded-full ${dotColor} flex-shrink-0 border-2 border-white shadow-sm`} />

              {/* Étiquette */}
              <span
                className={`ml-1 text-[10px] font-semibold ${textColor} whitespace-nowrap leading-none`}
              >
                {event.numero}
                <span className="font-normal text-gray-500 ml-1">
                  {event.daysFromToday === 0
                    ? 'aujourd\'hui'
                    : event.daysFromToday === 1
                    ? 'demain'
                    : `J+${event.daysFromToday}`}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      {/* Légende compacte */}
      <div className="flex items-center gap-3 mt-1 pt-1 border-t border-gray-100">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-red-600" />
          <span className="text-[9px] text-gray-500">≤ 3j</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-orange-500" />
          <span className="text-[9px] text-gray-500">≤ 7j</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-blue-600" />
          <span className="text-[9px] text-gray-500">&gt; 7j</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-4 bg-blue-400 opacity-30 rounded-sm" />
          <span className="text-[9px] text-gray-500">Fenêtre GAV 96h</span>
        </div>
      </div>
    </div>
  );
};
