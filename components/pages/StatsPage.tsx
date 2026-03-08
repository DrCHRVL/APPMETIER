import React, { useState, useEffect } from 'react';
import { useAudience } from '@/hooks/useAudience';
import { Enquete } from '@/types/interfaces';
import { GeneralStats } from '../stats/GeneralStats';
import { AudienceStats } from '../stats/AudienceStats';
import { InfractionStats } from '../stats/InfractionStats';
import { Button } from '../ui/button';
import { AudienceResultModal } from '../modals/AudienceResultModal';
import { useToast } from '@/contexts/ToastContext';
import { ResultatAudience } from '@/types/audienceTypes';
import { ExportPdfButton } from '../pdf/ExportPdfButton';

interface StatsPageProps {
  enquetes: Enquete[];
}

export const StatsPage = ({ enquetes }: StatsPageProps) => {
  const { audienceState, isLoading, saveResultat } = useAudience();
  const { showToast } = useToast();
  const [showDirectResultModal, setShowDirectResultModal] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  
  if (isLoading) {
    return <div>Chargement des statistiques...</div>;
  }
  
  if (!audienceState?.resultats) {
    return <div>Aucune donnée d'audience disponible</div>;
  }

  const handleSaveDirectResult = async (resultat: ResultatAudience) => {
    try {
      const directResultat = {
        ...resultat,
        isDirectResult: true,
        enqueteId: Date.now()
      };
      
      await saveResultat(directResultat);
      setShowDirectResultModal(false);
      showToast('Résultat enregistré avec succès', 'success');
    } catch (error) {
      showToast('Erreur lors de l\'enregistrement', 'error');
    }
  };

  return (
    <>
      {/* Wrapper pour forcer la largeur complète à l'impression */}
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
        {/* Boutons d'action - masqués à l'impression */}
        <div className="flex justify-between items-center mb-4 no-print">
          <div className="flex gap-2">
            <Button 
              onClick={() => setShowDirectResultModal(true)}
              variant="outline"
            >
              + Ajouter procédure permanence
            </Button>
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
        
        {/* Contenu des statistiques */}
        <div className="print-container">
          <div className="pdf-section">
            <h3>Statistiques générales</h3>
            <GeneralStats enquetes={enquetes} />
          </div>

          <div className="pdf-section">
            <h3>Types d'infractions</h3>
            <InfractionStats enquetes={enquetes} />
          </div>

          <div className="pdf-section">
            <h3>Résultats d'audience</h3>
            <AudienceStats enquetes={enquetes} />
          </div>
        </div>

        {/* Modal - masqué à l'impression */}
        {showDirectResultModal && (
          <AudienceResultModal
            isOpen={showDirectResultModal}
            onClose={() => setShowDirectResultModal(false)}
            onSave={handleSaveDirectResult}
            enqueteId={Date.now()}
            isDirectResult={true}
          />
        )}
      </div>
    </>
  );
};
