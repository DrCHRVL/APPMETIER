import React, { useState } from 'react';
import { useAudience } from '@/hooks/useAudience';

import { Enquete } from '@/types/interfaces';
import { GeneralStats } from '../stats/GeneralStats';
import { AudienceStats } from '../stats/AudienceStats';
import { InfractionStats } from '../stats/InfractionStats';
import { ExportPdfButton } from '../pdf/ExportPdfButton';

interface StatsPageProps {
  enquetes: Enquete[];
  contentieuxId?: string;
}

export const StatsPage = ({ enquetes, contentieuxId }: StatsPageProps) => {
  const { isLoading } = useAudience();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  if (isLoading) {
    return <div>Chargement des statistiques...</div>;
  }

  return (
    <>
      <style>
        {`
          @media print {
            body {
              margin: 0 !important;
              padding: 0 !important;
            }
          }
        `}
      </style>

      <div className="p-6 max-w-6xl mx-auto space-y-8">
        {/* Barre d'action avec sélecteur d'année centralisé */}
        <div className="flex justify-between items-center mb-4 no-print">
          <div className="flex items-center gap-4">
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
          <ExportPdfButton selectedYear={selectedYear} enquetes={enquetes} />
        </div>

        {/* En-tête pour l'impression uniquement */}
        <div className="print-header" style={{ display: 'none' }}>
          <h1>Rapport Statistiques - Année {selectedYear}</h1>
          <p className="print-date">
            Généré le {new Date().toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric'
            })}
          </p>
        </div>

        {/* Contenu des statistiques - année synchronisée */}
        <div className="print-container">
          <div className="pdf-section">
            <h3>Statistiques générales</h3>
            <GeneralStats enquetes={enquetes} selectedYear={selectedYear} contentieuxId={contentieuxId} />
          </div>

          <div className="pdf-section">
            <h3>Types d'infractions</h3>
            <InfractionStats enquetes={enquetes} selectedYear={selectedYear} contentieuxId={contentieuxId} />
          </div>

          <div className="pdf-section">
            <h3>Résultats d'audience</h3>
            <AudienceStats enquetes={enquetes} selectedYear={selectedYear} contentieuxId={contentieuxId} />
          </div>
        </div>

      </div>
    </>
  );
};
