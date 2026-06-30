import React, { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { Enquete } from '@/types/interfaces';

type ActeKind = 'acte' | 'ecoute' | 'geoloc';

interface UpcomingActeDeadlinesProps {
  enquetes: Enquete[];
  onOpenEnquete?: (enquete: Enquete) => void;
  /** Si fourni, prioritaire sur onOpenEnquete : ouvre l'aperçu de l'acte cliqué (profil JLD). */
  onOpenActe?: (enquete: Enquete, acteId: number, kind: ActeKind) => void;
  /** Fenêtre d'anticipation en jours (par défaut 7). */
  windowDays?: number;
}

interface DeadlineItem {
  acteType: string;
  cible?: string;
  enquete: Enquete;
  acteId: number;
  acteKind: ActeKind;
  /** Jours restants : date du jour → date d'échéance (entiers, calendrier). */
  daysLeft: number;
  echeance: Date;
  isWeekend: boolean;
  key: string;
}

/** Service d'enquête (tag de catégorie « services ») d'une enquête. */
function serviceOf(e: Enquete): string | undefined {
  return e.tags?.find(t => t.category === 'services')?.value;
}

/**
 * Parse une date ISO « YYYY-MM-DD » comme une date locale à minuit
 * (évite tout décalage de fuseau qui fausserait le décompte des jours).
 */
function parseLocalDate(s: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/**
 * Échéances d'actes (géoloc / écoute / autres actes encore actifs) arrivant à
 * terme dans les `windowDays` prochains jours. Uniquement les échéances d'actes
 * — pas les relances d'enquête. Chaque ligne est cliquable vers l'enquête.
 */
export const UpcomingActeDeadlines = React.memo(({ enquetes, onOpenEnquete, onOpenActe, windowDays = 7 }: UpcomingActeDeadlinesProps) => {
  const items = useMemo(() => {
    // Aujourd'hui à minuit local : référence stable du décompte.
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayMs = 1000 * 60 * 60 * 24;
    const result: DeadlineItem[] = [];

    for (const e of enquetes) {
      const buckets: Array<{ list: any[]; kind: ActeKind; label: (a: any) => string; cible?: (a: any) => string | undefined }> = [
        { list: e.actes || [], kind: 'acte', label: a => a.type || 'Acte' },
        { list: e.ecoutes || [], kind: 'ecoute', label: a => `Écoute ${a.numero}`, cible: a => a.cible },
        { list: e.geolocalisations || [], kind: 'geoloc', label: a => `Géoloc ${a.objet}` },
      ];
      for (const { list, kind, label, cible } of buckets) {
        for (const a of list) {
          if (a.statut !== 'en_cours' || !a.dateFin) continue;
          const echeance = parseLocalDate(a.dateFin);
          if (!echeance) continue;
          // Décompte simple : nombre de jours calendaires d'aujourd'hui à l'échéance.
          const daysLeft = Math.round((echeance.getTime() - today.getTime()) / dayMs);
          if (daysLeft < 0 || daysLeft > windowDays) continue;
          const day = echeance.getDay();
          result.push({
            acteType: label(a),
            cible: cible?.(a),
            enquete: e,
            acteId: a.id,
            acteKind: kind,
            daysLeft,
            echeance,
            isWeekend: day === 0 || day === 6,
            key: `${e.id}-${a.id}`,
          });
        }
      }
    }
    return result.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [enquetes, windowDays]);

  const totalCount = items.length;

  const countdownLabel = (d: number) =>
    d === 0 ? "aujourd'hui" : d === 1 ? 'demain' : `J-${d}`;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 shadow-sm">
      {/* En-tête */}
      <div className="flex items-center gap-1.5 mb-2">
        <CalendarClock className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Échéances d'actes — 7 jours
        </span>
        {totalCount > 0 && (
          <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
            {totalCount}
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        <span className="text-[11px] text-gray-400 italic">Aucune échéance dans les 7 jours</span>
      ) : (
        <ul className="flex flex-col divide-y divide-amber-200/70">
          {items.map(item => (
            <li
              key={item.key}
              className={`flex items-baseline gap-1.5 py-1 group min-w-0 rounded px-1 -mx-1 ${
                item.daysLeft <= 2 ? 'bg-red-100/70' : ''
              } ${(onOpenActe || onOpenEnquete) ? 'cursor-pointer hover:text-amber-800' : ''}`}
              onClick={() => onOpenActe ? onOpenActe(item.enquete, item.acteId, item.acteKind) : onOpenEnquete?.(item.enquete)}
              title={`${item.acteType} (${item.enquete.numero})${(onOpenActe || onOpenEnquete) ? (onOpenActe ? " — Voir l'acte" : " — Ouvrir l'enquête") : ''}`}
            >
              <span className="text-xs text-gray-700 leading-snug select-none flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
                {item.acteType}
                {item.cible && <span className="text-gray-500"> · {item.cible}</span>}
                <span className="text-gray-400 ml-1 text-[10px]">
                  ({item.enquete.numero})
                </span>
                {serviceOf(item.enquete) && (
                  <span className="ml-1 inline-block text-[9px] font-semibold text-amber-700 bg-amber-100 rounded px-1 align-middle">
                    {serviceOf(item.enquete)}
                  </span>
                )}
                {item.isWeekend && (
                  <span className="ml-1 text-[10px] text-red-400 italic">
                    · week-end ({WEEKDAYS[item.echeance.getDay()]})
                  </span>
                )}
              </span>
              <span className={`text-[10px] font-semibold whitespace-nowrap ${
                item.daysLeft <= 1 ? 'text-red-600' :
                item.daysLeft <= 3 ? 'text-orange-600' :
                'text-amber-600'
              }`}>
                {countdownLabel(item.daysLeft)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
