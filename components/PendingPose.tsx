import React, { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { Enquete } from '@/types/interfaces';

type ActeKind = 'acte' | 'ecoute' | 'geoloc';

interface PendingPoseProps {
  enquetes: Enquete[];
  onOpenEnquete?: (enquete: Enquete) => void;
  /** Si fourni, prioritaire sur onOpenEnquete : ouvre l'aperçu de l'acte cliqué (profil JLD). */
  onOpenActe?: (enquete: Enquete, acteId: number, kind: ActeKind) => void;
}

interface PendingPoseItem {
  acteType: string;
  cible?: string;
  enquete: Enquete;
  acteId: number;
  acteKind: ActeKind;
  daysSince: number;
}

/** Service d'enquête (tag de catégorie « services ») d'une enquête. */
function serviceOf(e: Enquete): string | undefined {
  return e.tags?.find(t => t.category === 'services')?.value;
}

export const PendingPose = React.memo(({ enquetes, onOpenEnquete, onOpenActe }: PendingPoseProps) => {
  const pendingPose = useMemo(() => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;
    const items: PendingPoseItem[] = [];

    for (const e of enquetes) {
      for (const a of e.actes || []) {
        if (a.statut === 'pose_pending') {
          items.push({ acteType: a.type || 'Acte', enquete: e, acteId: a.id, acteKind: 'acte', daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs) });
        }
      }
      for (const a of e.ecoutes || []) {
        if (a.statut === 'pose_pending') {
          items.push({ acteType: `Écoute ${a.numero}`, cible: a.cible, enquete: e, acteId: a.id, acteKind: 'ecoute', daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs) });
        }
      }
      for (const a of e.geolocalisations || []) {
        if (a.statut === 'pose_pending') {
          items.push({ acteType: `Géoloc ${a.objet}`, enquete: e, acteId: a.id, acteKind: 'geoloc', daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs) });
        }
      }
    }
    // Regroupement par dossier pour permettre des séparateurs visuels entre enquêtes
    items.sort((a, b) => {
      const na = a.enquete.numero || String(a.enquete.id);
      const nb = b.enquete.numero || String(b.enquete.id);
      return na.localeCompare(nb);
    });
    return items;
  }, [enquetes]);

  const totalCount = pendingPose.length;

  return (
    <div className="bg-teal-50 border border-teal-300 rounded-lg px-4 py-2 shadow-sm">
      {/* En-tête */}
      <div className="flex items-center gap-1.5 mb-2">
        <MapPin className="h-3.5 w-3.5 text-teal-600" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Pose en attente
        </span>
        {totalCount > 0 && (
          <span className="text-[10px] bg-teal-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
            {totalCount}
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        <span className="text-[11px] text-gray-400 italic">Aucune pose en attente</span>
      ) : (
        <ul className="flex flex-col">
          {pendingPose.map((item, idx) => {
            const prev = idx > 0 ? pendingPose[idx - 1] : null;
            const isNewGroup = prev !== null && prev.enquete.id !== item.enquete.id;
            const borderClass = idx === 0
              ? ''
              : isNewGroup
                ? 'border-t-2 border-teal-500/60 mt-1 pt-1'
                : 'border-t border-teal-200/70';
            return (
            <li
              key={idx}
              className={`flex items-baseline gap-1.5 py-1 group min-w-0 ${borderClass} ${(onOpenActe || onOpenEnquete) ? 'cursor-pointer hover:text-teal-800' : ''}`}
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
                  <span className="ml-1 inline-block text-[9px] font-semibold text-teal-700 bg-teal-100 rounded px-1 align-middle">
                    {serviceOf(item.enquete)}
                  </span>
                )}
              </span>
              <span className={`text-[10px] font-semibold whitespace-nowrap ${
                item.daysSince >= 14 ? 'text-red-600' :
                item.daysSince >= 7 ? 'text-orange-600' :
                'text-teal-600'
              }`}>
                {item.daysSince}j
              </span>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
PendingPose.displayName = 'PendingPose';
