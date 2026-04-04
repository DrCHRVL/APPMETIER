'use client';

import React, { useState, useMemo } from 'react';
import { PieChart } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { GeneralStats } from '../stats/GeneralStats';
import { AudienceStats } from '../stats/AudienceStats';
import { InfractionStats } from '../stats/InfractionStats';
import { useAudience } from '@/hooks/useAudience';

interface GlobalStatsPageProps {
  /** Enquêtes par contentieux (toutes celles accessibles) */
  enquetesByContentieux: Map<ContentieuxId, Enquete[]>;
  /** Définitions des contentieux */
  contentieuxDefs: ContentieuxDefinition[];
}

export const GlobalStatsPage = ({
  enquetesByContentieux,
  contentieuxDefs,
}: GlobalStatsPageProps) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { isLoading } = useAudience();

  // Fusionner toutes les enquêtes
  const allEnquetes = useMemo(() => {
    const all: Enquete[] = [];
    for (const enquetes of enquetesByContentieux.values()) {
      all.push(...enquetes);
    }
    return all;
  }, [enquetesByContentieux]);

  if (isLoading) {
    return <div>Chargement des statistiques...</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <PieChart className="h-6 w-6 text-gray-600" />
          <h1 className="text-xl font-bold text-gray-800">Statistiques globales</h1>
          <span className="text-sm text-gray-500">Tous contentieux confondus</span>
        </div>
        <div className="flex items-center gap-2 bg-white border rounded-lg px-3 py-1.5">
          <label className="font-medium text-sm">Année :</label>
          <select
            className="p-1 border rounded text-sm font-semibold"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {Array.from(
              { length: (new Date().getFullYear() - 2024) + 2 },
              (_, i) => 2024 + i
            ).map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Contenu des statistiques — contentieuxId='global' pour inclure tous les résultats */}
      <div className="space-y-8">
        <div>
          <h3 className="text-lg font-semibold text-gray-700 mb-3">Statistiques générales</h3>
          <GeneralStats enquetes={allEnquetes} selectedYear={selectedYear} contentieuxId="global" enquetesByContentieux={enquetesByContentieux} contentieuxDefs={contentieuxDefs} />
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-700 mb-3">Types d'infractions</h3>
          <InfractionStats enquetes={allEnquetes} selectedYear={selectedYear} contentieuxId="global" />
        </div>

        <div>
          <h3 className="text-lg font-semibold text-gray-700 mb-3">Résultats d'audience</h3>
          <AudienceStats enquetes={allEnquetes} selectedYear={selectedYear} contentieuxId="global" enquetesByContentieux={enquetesByContentieux} contentieuxDefs={contentieuxDefs} />
        </div>
      </div>
    </div>
  );
};
