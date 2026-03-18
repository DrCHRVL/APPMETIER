import React, { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { ResultatAudience } from '@/types/audienceTypes';
import { useAudience } from '@/hooks/useAudience';
import { ViewAudienceResultModal } from '../modals/ViewAudienceResultModal';
import { AudienceResultModal } from '../modals/AudienceResultModal';
import { FileText, Plus, Archive, Timer, Tags, Bell, Save, BarChart } from 'lucide-react';

export const PermanencePage = () => {
  const { audienceState, saveResultat } = useAudience();
  const { showToast } = useToast();
  const [showDirectResultModal, setShowDirectResultModal] = useState(false);
  const [viewResultat, setViewResultat] = useState<ResultatAudience | null>(null);
  const [editResultat, setEditResultat] = useState<ResultatAudience | null>(null);

  // Grouper les résultats par mois
  const groupedResults = Object.values(audienceState?.resultats || {})
    .filter(r => r.isDirectResult)
    .reduce((acc, resultat) => {
      const date = new Date(resultat.dateAudience);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!acc[monthKey]) {
        acc[monthKey] = [];
      }
      acc[monthKey].push(resultat);
      return acc;
    }, {} as Record<string, ResultatAudience[]>);

  const handleUpdateResultat = async (resultat: ResultatAudience) => {
    try {
      await saveResultat(resultat);
      setEditResultat(null);
      showToast('Résultat mis à jour avec succès', 'success');
    } catch (error) {
      showToast('Erreur lors de la mise à jour', 'error');
    }
  };

  const handleSaveDirectResult = async (resultat) => {
  try {
    const directResultat = {
      ...resultat,
      isDirectResult: true,
      enqueteId: Math.floor(Math.random() * 1e15) + Date.now()
    };
    
    await saveResultat(directResultat);
    setShowDirectResultModal(false);
    showToast('Résultat enregistré avec succès', 'success');
  } catch (error) {
    showToast('Erreur lors de l\'enregistrement', 'error');
  }
};

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6">Procédures de la permanence générale</h2>
      <div className="flex justify-end mb-6">
      <Button 
        onClick={() => setShowDirectResultModal(true)}
        variant="outline"
      >
        <Plus className="h-4 w-4 mr-2" />
        Ajouter procédure permanence
      </Button>
    </div>
      <div className="space-y-6">
        {Object.entries(groupedResults)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([monthKey, resultats]) => (
            <Card key={monthKey}>
              <CardHeader>
                <CardTitle>
                  {new Date(monthKey + '-01').toLocaleDateString('fr-FR', { 
                    month: 'long', 
                    year: 'numeric' 
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {resultats
                    .sort((a, b) => new Date(b.dateAudience).getTime() - new Date(a.dateAudience).getTime())
                    .map(resultat => (
                      <div 
                        key={resultat.enqueteId}
                        className="flex justify-between items-center p-2 hover:bg-gray-50 rounded"
                      >
                        <div>
                          <div className="font-medium">
                            {new Date(resultat.dateAudience).toLocaleDateString()}
                          </div>
                          <div className="text-sm text-gray-500">
                            {resultat.typeInfraction} - {resultat.condamnations.length} condamnation(s)
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setViewResultat(resultat)}
                          >
                            Voir
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditResultat(resultat)}
                          >
                            Modifier
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      {/* Modals */}
      {viewResultat && (
        <ViewAudienceResultModal
          isOpen={!!viewResultat}
          onClose={() => setViewResultat(null)}
          enqueteId={viewResultat.enqueteId}
          onUpdate={handleUpdateResultat}
        />
      )}
      
      {editResultat && (
        <AudienceResultModal
          isOpen={!!editResultat}
          onClose={() => setEditResultat(null)}
          onSave={handleUpdateResultat}
          enqueteId={editResultat.enqueteId}
          initialData={editResultat}
          isDirectResult={true}
        />
      )}
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
  );
};