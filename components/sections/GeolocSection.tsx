import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Enquete, GeolocData, DateManagerData, ProlongationHistoryEntry } from '@/types/interfaces';
import ProgressBar from '../ProgressBar';
import { Edit, X, Clock, Hourglass, ArrowDown, Plus, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { ProlongationModal } from '../modals/ProlongationModal';
import { PoseActeModal } from '../modals/PoseActeModal';
import { ProlongationValidationModal } from '../modals/ProlongationValidationModal';
import { AutorisationValidationModal } from '../modals/AutorisationValidationModal';
import { ActeUtils } from '@/utils/acteUtils';
import { DateUtils } from '@/utils/dateUtils';
import { GeolocModal } from '../modals/GeolocModal';

interface GeolocSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

export const GeolocSection = ({ enquete, onUpdate, isEditing }: GeolocSectionProps) => {
  const [editingGeolocId, setEditingGeolocId] = useState<number | null>(null);
  const [prolongationGeolocId, setProlongationGeolocId] = useState<number | null>(null);
  const [validationGeolocId, setValidationGeolocId] = useState<number | null>(null);
  const [autorisationGeolocId, setAutorisationGeolocId] = useState<number | null>(null);
  const [poseGeolocId, setPoseGeolocId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<number[]>([]);
  const [showTerminated, setShowTerminated] = useState(false);

  const toggleHistoryExpansion = (id: number) => {
    setExpandedHistoryIds(prev => 
      prev.includes(id) 
        ? prev.filter(expandedId => expandedId !== id) 
        : [...prev, id]
    );
  };

  const geolocToEdit = editingGeolocId 
    ? enquete.geolocalisations?.find(geoloc => geoloc.id === editingGeolocId) || null
    : null;

  const handleAddGeoloc = (geolocData: Partial<GeolocData>, dates: DateManagerData) => {
    if (!onUpdate || !enquete) return;

    const withPose = !!dates.datePose;
    
    if (dates.updatedStatut === 'autorisation_pending') {
      const newGeoloc: GeolocData = {
        id: Date.now(),
        objet: geolocData.objet || '',
        description: geolocData.description || '',
        dateDebut: '',
        dateFin: '',
        duree: dates.duree || '0',
        statut: 'autorisation_pending',
        prolongationsHistory: []
      };

      onUpdate(enquete.id, {
        geolocalisations: [...(enquete.geolocalisations || []), newGeoloc]
      });
    } else {
      try {
        const newGeolocWithId = ActeUtils.createActe({
          objet: geolocData.objet || '',
          description: geolocData.description || '',
          dateDebut: dates.dateDebut,
          dateFin: '',
          duree: dates.duree,
          datePose: dates.datePose || '',
          statut: 'pose_pending',
          prolongationsHistory: []
        }, withPose) as GeolocData;

        onUpdate(enquete.id, {
          geolocalisations: [...(enquete.geolocalisations || []), newGeolocWithId]
        });
      } catch (error) {
        console.error('Erreur lors de la création de la géolocalisation:', error);
        throw error;
      }
    }
  };

  const handleUpdateGeoloc = (geolocData: Partial<GeolocData>, dates: DateManagerData) => {
    if (!onUpdate || !enquete || !editingGeolocId || !enquete.geolocalisations) return;

    const updatedGeolocs = enquete.geolocalisations.map(geoloc => 
      geoloc.id === editingGeolocId 
        ? {
            ...geoloc,
            dateDebut: dates.dateDebut || geoloc.dateDebut,
            dateFin: dates.dateFin || geoloc.dateFin,
            datePose: dates.datePose,
            duree: dates.duree || geoloc.duree,
            objet: geolocData.objet || geoloc.objet,
            description: geolocData.description !== undefined ? geolocData.description : geoloc.description,
            statut: dates.updatedStatut || geoloc.statut
          }
        : geoloc
    );

    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
    setEditingGeolocId(null);
  };

  const handlePose = (date: string) => {
    if (!onUpdate || !enquete || !poseGeolocId || !enquete.geolocalisations) return;

    const updatedGeolocs = enquete.geolocalisations.map(geoloc => {
      if (geoloc.id === poseGeolocId) {
        return {
          ...geoloc,
          ...ActeUtils.setPose(geoloc, date)
        };
      }
      return geoloc;
    });

    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
    setPoseGeolocId(null);
  };

  const handleProlongation = () => {
    if (!onUpdate || !enquete || !prolongationGeolocId || !enquete.geolocalisations) return;

    const updatedGeolocs = enquete.geolocalisations.map(geoloc => {
      if (geoloc.id === prolongationGeolocId) {
        return {
          ...geoloc,
          statut: 'prolongation_pending'
        };
      }
      return geoloc;
    });

    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
    setTimeout(() => {
      setProlongationGeolocId(null);
    }, 500);
  };

  const handleValidateProlongation = (date: string, duration: string) => {
    if (!onUpdate || !enquete || !validationGeolocId || !enquete.geolocalisations) return;

    const updatedGeolocs = enquete.geolocalisations.map(geoloc => {
      if (geoloc.id === validationGeolocId) {
        const newHistoryEntry: ProlongationHistoryEntry = {
          date,
          dureeAjoutee: duration,
          dureeInitiale: geoloc.duree
        };

        const prolongationsHistory = geoloc.prolongationsHistory || [];
        const updatedHistory = [...prolongationsHistory, newHistoryEntry];

        return {
          ...geoloc,
          ...ActeUtils.calculateProlongation(geoloc, date, duration),
          prolongationDate: date,
          prolongationsHistory: updatedHistory
        };
      }
      return geoloc;
    });

    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
    setTimeout(() => setValidationGeolocId(null), 500);
  };

  const handleValidateAutorisation = (date: string) => {
    if (!onUpdate || !enquete || !autorisationGeolocId || !enquete.geolocalisations) return;

    const updatedGeolocs = enquete.geolocalisations.map(geoloc => {
      if (geoloc.id === autorisationGeolocId) {
        return {
          ...geoloc,
          dateDebut: date,
          statut: 'pose_pending'
        };
      }
      return geoloc;
    });

    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
    setTimeout(() => setAutorisationGeolocId(null), 500);
  };

  const handleDeleteProlongation = (geolocId: number, prolongationIndex: number) => {
    if (!onUpdate || !enquete || !enquete.geolocalisations) return;

    const updatedGeolocs = enquete.geolocalisations.map(geoloc => {
      if (geoloc.id === geolocId && geoloc.prolongationsHistory) {
        const updatedHistory = geoloc.prolongationsHistory.filter((_, index) => index !== prolongationIndex);
        
        let nouvelleDuree = geoloc.prolongationsHistory[0]?.dureeInitiale || geoloc.duree;
        updatedHistory.forEach(entry => {
          nouvelleDuree = (parseInt(nouvelleDuree) + parseInt(entry.dureeAjoutee)).toString();
        });

        const dateReference = geoloc.datePose || geoloc.dateDebut;
        const nouvelleDateFin = DateUtils.calculateActeEndDate(dateReference, nouvelleDuree);

        return {
          ...geoloc,
          prolongationsHistory: updatedHistory,
          duree: nouvelleDuree,
          dateFin: nouvelleDateFin,
          prolongationDate: updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1].date : undefined
        };
      }
      return geoloc;
    });

    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
  };

  const handleDeleteGeoloc = (id: number) => {
    if (!onUpdate || !enquete || !enquete.geolocalisations) return;
    
    const updatedGeolocs = enquete.geolocalisations.filter(geoloc => geoloc.id !== id);
    onUpdate(enquete.id, { geolocalisations: updatedGeolocs });
  };

  const now = new Date();
  
  const activeGeolocs = enquete.geolocalisations?.filter(g => {
    if (!g.dateFin) return true;
    return new Date(g.dateFin) >= now;
  }) || [];
  
  const terminatedGeolocs = enquete.geolocalisations?.filter(g => {
    if (!g.dateFin) return false;
    return new Date(g.dateFin) < now;
  }).sort((a, b) => new Date(b.dateFin).getTime() - new Date(a.dateFin).getTime()) || [];

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold">Géolocalisations</h3>
        {onUpdate && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 w-6 p-0" 
            onClick={() => setShowAddModal(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Géolocalisations actives */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeGeolocs.map((geoloc) => {
          const hasHistoryEntries = geoloc.prolongationsHistory && geoloc.prolongationsHistory.length > 0;
          const isHistoryExpanded = expandedHistoryIds.includes(geoloc.id);
          
          return (
          <div key={geoloc.id} className="bg-gray-50 p-3 rounded">
            <div className="flex justify-between items-center mb-2">
              <div>
                <span className="font-medium">{geoloc.objet}</span>
                {geoloc.description && (
                  <p className="text-sm text-gray-600 mt-1">{geoloc.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                {geoloc.statut === 'autorisation_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAutorisationGeolocId(geoloc.id)}
                    title="Définir la date d'autorisation JLD"
                  >
                    <FileText className="h-4 w-4 text-purple-600" />
                  </Button>
                )}
                {geoloc.statut === 'pose_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPoseGeolocId(geoloc.id)}
                    title="Définir la date de pose"
                  >
                    <ArrowDown className="h-4 w-4 text-yellow-600" />
                  </Button>
                )}
                {geoloc.duree && onUpdate && geoloc.statut === 'en_cours' && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setProlongationGeolocId(geoloc.id)}
                  >
                    <Clock className="h-4 w-4" />
                  </Button>
                )}
                {geoloc.statut === 'prolongation_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setValidationGeolocId(geoloc.id)}
                    title="Valider la prolongation"
                  >
                    <Hourglass className="h-4 w-4 text-green-600" />
                  </Button>
                )}
                {isEditing && (
                  <>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setEditingGeolocId(geoloc.id)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDeleteGeoloc(geoloc.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <ProgressBar 
              dateDebut={geoloc.dateDebut}
              dateFin={geoloc.dateFin}
              datePose={geoloc.datePose}
            />
            <div className="mt-1 text-xs text-gray-600">
              {geoloc.statut === 'autorisation_pending' && (
                <p>En attente d'autorisation JLD • Durée prévue: {geoloc.duree || 0} jours</p>
              )}
            </div>
            {hasHistoryEntries && (
              <div className="mt-2">
                <div 
                  className="flex items-center text-xs text-blue-600 cursor-pointer"
                  onClick={() => toggleHistoryExpansion(geoloc.id)}
                >
                  {isHistoryExpanded ? 
                    <ChevronUp className="h-3 w-3 mr-1" /> : 
                    <ChevronDown className="h-3 w-3 mr-1" />
                  }
                  <span>
                    {isHistoryExpanded ? 
                      "Masquer l'historique des prolongations" : 
                      `Voir l'historique des prolongations (${geoloc.prolongationsHistory?.length})`
                    }
                  </span>
                </div>

                {isHistoryExpanded && (
                  <div className="mt-1 pl-2 border-l-2 border-blue-200">
                    {geoloc.prolongationsHistory?.map((entry, index) => (
                      <div key={index} className="text-xs text-gray-600 mb-1 flex items-center justify-between">
                        <div>
                          <span className="font-medium">Prolongation {index + 1}: </span>
                          <span>{DateUtils.formatDate(entry.date)}</span>
                          <span className="mx-1">•</span> 
                          <span>{entry.dureeAjoutee} jours</span>
                          <span className="mx-1">•</span>
                          <span>Durée précédente: {entry.dureeInitiale} jours</span>
                        </div>
                        {isEditing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 w-4 p-0 text-red-500 hover:text-red-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProlongation(geoloc.id, index);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {geoloc.prolongationDate && !hasHistoryEntries && (
              <p className="text-xs text-gray-600 mt-2">
                Prolongation: {DateUtils.formatDate(geoloc.prolongationDate)}
              </p>
            )}
          </div>
        )})}
      </div>

      {/* Géolocalisations terminées */}
      {terminatedGeolocs.length > 0 && (
        <div className="mt-6">
          <div 
            className="flex items-center gap-2 mb-3 cursor-pointer text-gray-500 hover:text-gray-700"
            onClick={() => setShowTerminated(!showTerminated)}
          >
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-sm font-medium flex items-center gap-1">
              {showTerminated ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Mesures terminées ({terminatedGeolocs.length})
            </span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          {showTerminated && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
              {terminatedGeolocs.map((geoloc) => {
                const hasHistoryEntries = geoloc.prolongationsHistory && geoloc.prolongationsHistory.length > 0;
                const isHistoryExpanded = expandedHistoryIds.includes(geoloc.id);
                
                return (
                <div key={geoloc.id} className="bg-gray-50 p-3 rounded border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <span className="font-medium text-gray-600">{geoloc.objet}</span>
                      {geoloc.description && (
                        <p className="text-sm text-gray-500 mt-1">{geoloc.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {/* Bouton de prolongation même pour les terminées */}
                      {geoloc.duree && onUpdate && geoloc.statut === 'en_cours' && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setProlongationGeolocId(geoloc.id)}
                          title="Prolonger la géolocalisation"
                        >
                          <Clock className="h-4 w-4" />
                        </Button>
                      )}
                      {geoloc.statut === 'prolongation_pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setValidationGeolocId(geoloc.id)}
                          title="Valider la prolongation"
                        >
                          <Hourglass className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      {isEditing && (
                        <>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setEditingGeolocId(geoloc.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleDeleteGeoloc(geoloc.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <ProgressBar 
                    dateDebut={geoloc.dateDebut}
                    dateFin={geoloc.dateFin}
                    datePose={geoloc.datePose}
                  />
                  {hasHistoryEntries && (
                    <div className="mt-2">
                      <div 
                        className="flex items-center text-xs text-blue-600 cursor-pointer"
                        onClick={() => toggleHistoryExpansion(geoloc.id)}
                      >
                        {isHistoryExpanded ? 
                          <ChevronUp className="h-3 w-3 mr-1" /> : 
                          <ChevronDown className="h-3 w-3 mr-1" />
                        }
                        <span>
                          {isHistoryExpanded ? 
                            "Masquer l'historique des prolongations" : 
                            `Voir l'historique des prolongations (${geoloc.prolongationsHistory?.length})`
                          }
                        </span>
                      </div>

                      {isHistoryExpanded && (
                        <div className="mt-1 pl-2 border-l-2 border-blue-200">
                          {geoloc.prolongationsHistory?.map((entry, index) => (
                            <div key={index} className="text-xs text-gray-600 mb-1">
                              <span className="font-medium">Prolongation {index + 1}: </span>
                              <span>{DateUtils.formatDate(entry.date)}</span>
                              <span className="mx-1">•</span> 
                              <span>{entry.dureeAjoutee} jours</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      <GeolocModal 
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddGeoloc}
        title="Ajouter une géolocalisation"
      />

      <GeolocModal 
        isOpen={!!editingGeolocId}
        onClose={() => setEditingGeolocId(null)}
        onSave={handleUpdateGeoloc}
        geoloc={geolocToEdit || undefined}
        title="Modifier la géolocalisation"
      />

      <ProlongationModal 
        isOpen={!!prolongationGeolocId}
        onClose={() => setProlongationGeolocId(null)}
        onConfirm={handleProlongation}
        originalStartDate={enquete.geolocalisations?.find(g => g.id === prolongationGeolocId)?.dateDebut}
        originalDuration={enquete.geolocalisations?.find(g => g.id === prolongationGeolocId)?.duree}
      />

      <ProlongationValidationModal 
        isOpen={!!validationGeolocId}
        onClose={() => setValidationGeolocId(null)}
        onValidate={handleValidateProlongation}
        originalStartDate={enquete.geolocalisations?.find(g => g.id === validationGeolocId)?.dateDebut}
        originalDuration={enquete.geolocalisations?.find(g => g.id === validationGeolocId)?.duree}
        poseDate={enquete.geolocalisations?.find(g => g.id === validationGeolocId)?.datePose}
      />

      <PoseActeModal
        isOpen={!!poseGeolocId}
        onClose={() => setPoseGeolocId(null)}
        onConfirm={handlePose}
        dateDebut={enquete.geolocalisations?.find(g => g.id === poseGeolocId)?.dateDebut || ''}
        duree={enquete.geolocalisations?.find(g => g.id === poseGeolocId)?.duree || ''}
      />

      <AutorisationValidationModal
        isOpen={!!autorisationGeolocId}
        onClose={() => setAutorisationGeolocId(null)}
        onValidate={handleValidateAutorisation}
        acteType={`Géolocalisation ${enquete.geolocalisations?.find(g => g.id === autorisationGeolocId)?.objet || ''}`}
      />
    </div>
  );
};