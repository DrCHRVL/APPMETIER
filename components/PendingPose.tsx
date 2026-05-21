import React, { useMemo } from 'react';
import { MapPin } from 'lucide-react';
import { Enquete } from '@/types/interfaces';

interface PendingPoseProps {
  enquetes: Enquete[];
  onOpenEnquete?: (enquete: Enquete) => void;
}

interface PendingPoseItem {
  acteType: string;
  enquete: Enquete;
  daysSince: number;
}

export const PendingPose = React.memo(({ enquetes, onOpenEnquete }: PendingPoseProps) => {
  const pendingPose = useMemo(() => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;
    const items: PendingPoseItem[] = [];

    for (const e of enquetes) {
      for (const a of e.actes || []) {
        if (a.statut === 'pose_pending') {
          items.push({ acteType: a.type || 'Acte', enquete: e, daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs) });
        }
      }
      for (const a of e.ecoutes || []) {
        if (a.statut === 'pose_pending') {
          items.push({ acteType: `Écoute ${a.numero}`, enquete: e, daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs) });
        }
      }
      for (const a of e.geolocalisations || []) {
        if (a.statut === 'pose_pending') {
          items.push({ acteType: `Géoloc ${a.objet}`, enquete: e, daysSince: Math.floor((now - new Date(a.dateDebut).getTime()) / dayMs) });
        }
      }
    }
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
        <ul className="flex flex-col divide-y divide-teal-200/70">
          {pendingPose.map((item, idx) => (
            <li
              key={idx}
              className={`flex items-baseline gap-1.5 py-1 group ${onOpenEnquete ? 'cursor-pointer hover:text-teal-800' : ''}`}
              onClick={() => onOpenEnquete?.(item.enquete)}
              title={onOpenEnquete ? `Ouvrir l'enquête ${item.enquete.numero}` : undefined}
            >
              <span className="text-xs text-gray-700 leading-snug select-none flex-1">
                {item.acteType}
                <span className="text-gray-400 ml-1 text-[10px]">
                  ({item.enquete.numero})
                </span>
              </span>
              <span className={`text-[10px] font-semibold whitespace-nowrap ${
                item.daysSince >= 14 ? 'text-red-600' :
                item.daysSince >= 7 ? 'text-orange-600' :
                'text-teal-600'
              }`}>
                {item.daysSince}j
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
