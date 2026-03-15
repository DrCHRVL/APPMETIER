import React from 'react';
import { Clock } from 'lucide-react';
import { Enquete } from '@/types/interfaces';

interface PendingActsJLDProps {
  enquetes: Enquete[];
}

interface PendingActeItem {
  acteType: string;
  enqueteNumero: string;
  daysSince: number;
}

export const PendingActsJLD = ({ enquetes }: PendingActsJLDProps) => {
  const now = new Date();

  const pendingActes: PendingActeItem[] = enquetes.flatMap(e => {
    const items: PendingActeItem[] = [];

    (e.actes || []).forEach(a => {
      if (a.statut === 'autorisation_pending') {
        items.push({
          acteType: a.type || 'Acte',
          enqueteNumero: e.numero,
          daysSince: Math.floor((now.getTime() - new Date(a.dateDebut).getTime()) / (1000 * 60 * 60 * 24)),
        });
      }
    });

    (e.ecoutes || []).forEach(a => {
      if (a.statut === 'autorisation_pending') {
        items.push({
          acteType: `Écoute ${a.numero}`,
          enqueteNumero: e.numero,
          daysSince: Math.floor((now.getTime() - new Date(a.dateDebut).getTime()) / (1000 * 60 * 60 * 24)),
        });
      }
    });

    (e.geolocalisations || []).forEach(a => {
      if (a.statut === 'autorisation_pending') {
        items.push({
          acteType: `Géoloc ${a.objet}`,
          enqueteNumero: e.numero,
          daysSince: Math.floor((now.getTime() - new Date(a.dateDebut).getTime()) / (1000 * 60 * 60 * 24)),
        });
      }
    });

    return items;
  });

  const totalCount = pendingActes.length;

  return (
    <div className="bg-purple-50 border border-purple-300 rounded-lg px-4 py-2 shadow-sm">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Clock className="h-3.5 w-3.5 text-purple-600" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Attente JLD
        </span>

        {totalCount > 0 && (
          <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
            {totalCount}
          </span>
        )}

        {pendingActes.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1 bg-white border border-purple-200 rounded-full px-2 py-0.5 group"
          >
            <span className="text-[11px] text-gray-700 whitespace-nowrap select-none">
              {item.acteType}
              <span className="text-gray-400 ml-1 text-[10px]">
                ({item.enqueteNumero})
              </span>
            </span>
            <span className={`text-[10px] font-semibold whitespace-nowrap ${
              item.daysSince >= 14 ? 'text-red-600' :
              item.daysSince >= 7 ? 'text-orange-600' :
              'text-purple-600'
            }`}>
              {item.daysSince}j
            </span>
          </div>
        ))}

        {totalCount === 0 && (
          <span className="text-[11px] text-gray-400 italic">Aucun acte en attente</span>
        )}
      </div>
    </div>
  );
};
