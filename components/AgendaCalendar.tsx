'use client';

/**
 * SIRAL — Calendrier mensuel du tableau de bord.
 *
 * Affiche un mois complet (toujours visible, même sans rendez-vous) et y place
 * les événements des agendas connectés (Google, Outlook, iCloud), fusionnés et
 * colorés par fournisseur. C'est distinct de la timeline « OPs à venir ».
 *
 * Lecture seule : les événements viennent du proxy /api/agenda. Si aucun agenda
 * n'est connecté, on invite à le faire depuis Paramètres → Agenda.
 */
import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { AgendaEvent, AgendaSource, SOURCE_META } from '@/lib/web/agenda';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Indice du lundi=0 … dimanche=6 pour un jour de la semaine JS (0=dimanche). */
const mondayIndex = (jsDay: number) => (jsDay + 6) % 7;

interface AgendaCalendarProps {
  events: AgendaEvent[];
  /** Fournisseurs actuellement connectés (pour la légende). */
  connectedSources: AgendaSource[];
  loading?: boolean;
}

export const AgendaCalendar = ({ events, connectedSources, loading }: AgendaCalendarProps) => {
  // Mois affiché (1er du mois courant par défaut).
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const today = new Date();
  const todayKey = dayKey(today);

  // Regroupe les événements par jour.
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const e of events) {
      const d = new Date(e.start);
      if (Number.isNaN(d.getTime())) continue;
      const k = dayKey(d);
      (map.get(k) ?? map.set(k, []).get(k)!).push(e);
    }
    return map;
  }, [events]);

  // Grille de 6 semaines (42 cellules) démarrant au lundi.
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - mondayIndex(first.getDay()));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const goPrev = () => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const goNext = () => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1));
  const goToday = () => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); };

  const monthLabel = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  return (
    <div className="bg-white border border-gray-200/80 rounded-2xl px-4 py-4 sm:px-5">
      {/* En-tête : titre, navigation, légende */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <CalendarDays className="h-4 w-4 text-indigo-600" />
        <span className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">Calendrier</span>
        <span className="text-[13px] font-semibold text-gray-800 capitalize ml-1">{monthLabel}</span>

        <div className="flex items-center gap-1 ml-auto">
          {connectedSources.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 mr-2">
              {connectedSources.map(s => (
                <span key={s} className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SOURCE_META[s].color }} />
                  {SOURCE_META[s].label}
                </span>
              ))}
            </div>
          )}
          <button onClick={goToday} className="text-[11px] font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-100">
            Aujourd&apos;hui
          </button>
          <button onClick={goPrev} aria-label="Mois précédent" className="p-1 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={goNext} aria-label="Mois suivant" className="p-1 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* En-têtes de jours */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-gray-400 uppercase py-1">{w}</div>
        ))}
      </div>

      {/* Grille des jours */}
      <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = dayKey(d) === todayKey;
          const dayEvents = byDay.get(dayKey(d)) ?? [];
          return (
            <div
              key={i}
              className={`min-h-[64px] sm:min-h-[78px] bg-white p-1 ${inMonth ? '' : 'bg-gray-50/60'}`}
            >
              <div className="flex items-center justify-center">
                <span
                  className={`text-[11px] leading-5 w-5 h-5 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-indigo-600 text-white font-semibold'
                      : inMonth ? 'text-gray-700' : 'text-gray-300'
                  }`}
                >
                  {d.getDate()}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {dayEvents.slice(0, 3).map((e, j) => {
                  const meta = SOURCE_META[e.source ?? 'other'];
                  const time = e.allDay ? '' : new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <div
                      key={j}
                      title={`${time ? time + ' · ' : ''}${e.title}`}
                      className="flex items-center gap-1 text-[10px] leading-tight text-gray-700 truncate"
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color }} />
                      <span className="truncate">{time ? <span className="text-gray-400">{time} </span> : null}{e.title}</span>
                    </div>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-gray-400 pl-2.5">+{dayEvents.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Pied : état de connexion */}
      {connectedSources.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-2.5">
          Aucun agenda connecté. Connectez Google, Outlook ou iCloud depuis <b>Paramètres → Agenda</b> pour voir vos rendez-vous ici.
        </p>
      )}
      {loading && connectedSources.length > 0 && (
        <p className="text-[11px] text-gray-400 mt-2.5">Chargement de l&apos;agenda…</p>
      )}
    </div>
  );
};
