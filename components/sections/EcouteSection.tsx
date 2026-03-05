import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Enquete, EcouteData, GeolocData, DateManagerData, ProlongationHistoryEntry } from '@/types/interfaces';
import ProgressBar from '../ProgressBar';
import { Edit, X, Clock, Hourglass, ArrowDown, Plus, FileText, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { ProlongationModal } from '../modals/ProlongationModal';
import { PoseActeModal } from '../modals/PoseActeModal';
import { ProlongationValidationModal } from '../modals/ProlongationValidationModal';
import { AutorisationValidationModal } from '../modals/AutorisationValidationModal';
import { ActeUtils } from '@/utils/acteUtils';
import { DateUtils } from '@/utils/dateUtils';
import { EcouteModal } from '../modals/EcouteModal';
import { GeolocModal } from '../modals/GeolocModal';

interface EcouteSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

export const EcouteSection = ({ enquete, onUpdate, isEditing }: EcouteSectionProps) => {
  const [editingEcouteId, setEditingEcouteId] = useState<number | null>(null);
  const [prolongationEcouteId, setProlongationEcouteId] = useState<number | null>(null);
  const [validationEcouteId, setValidationEcouteId] = useState<number | null>(null);
  const [autorisationEcouteId, setAutorisationEcouteId] = useState<number | null>(null);
  const [poseEcouteId, setPoseEcouteId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<number[]>([]);
  const [showDuplicateGeolocModal, setShowDuplicateGeolocModal] = useState(false);
  const [ecouteToDuplicate, setEcouteToDuplicate] = useState<EcouteData | null>(null);
  const [showTerminated, setShowTerminated] = useState(false);

  const toggleHistoryExpansion = (id: number) => {
    setExpandedHistoryIds(prev => 
      prev.includes(id) 
        ? prev.filter(expandedId => expandedId !== id) 
        : [...prev, id]
    );
  };

  const ecouteToEdit = editingEcouteId 
    ? enquete.ecoutes?.find(ecoute => ecoute.id === editingEcouteId) || null
    : null;

  const handleAddEcoute = (ecouteData: Partial<EcouteData>, dates: DateManagerData) => {
    if (!onUpdate || !enquete) return;

    const withPose = !!dates.datePose;
    
    if (dates.updatedStatut === 'autorisation_pending') {
      const newEcoute: EcouteData = {
        id: Date.now(),
        numero: ecouteData.numero || '',
        cible: ecouteData.cible || '',
        description: ecouteData.description || '',
        dateDebut: '',
        dateFin: '',
        duree: dates.duree || '0',
        statut: 'autorisation_pending',
        prolongationsHistory: []
      };

      onUpdate(enquete.id, {
        ecoutes: [...(enquete.ecoutes || []), newEcoute]
      });
    } else {
      try {
        const newEcouteWithId = ActeUtils.createActe({
          numero: ecouteData.numero || '',
          cible: ecouteData.cible || '',
          description: ecouteData.description || '',
          dateDebut: dates.dateDebut,
          dateFin: '',
          duree: dates.duree,
          datePose: dates.datePose || '',
          statut: 'pose_pending',
          prolongationsHistory: []
        }, withPose) as EcouteData;

        onUpdate(enquete.id, {
          ecoutes: [...(enquete.ecoutes || []), newEcouteWithId]
        });
      } catch (error) {
        console.error('Erreur lors de la création de l\'écoute:', error);
        throw error;
      }
    }
  };

  const handleUpdateEcoute = (ecouteData: Partial<EcouteData>, dates: DateManagerData) => {
    if (!onUpdate || !enquete || !editingEcouteId || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => 
      ecoute.id === editingEcouteId 
        ? {
            ...ecoute,
            dateDebut: dates.dateDebut || ecoute.dateDebut,
            dateFin: dates.dateFin || ecoute.dateFin,
            datePose: dates.datePose,
            duree: dates.duree || ecoute.duree,
            numero: ecouteData.numero || ecoute.numero,
            cible: ecouteData.cible !== undefined ? ecouteData.cible : ecoute.cible,
            description: ecouteData.description !== undefined ? ecouteData.description : ecoute.description,
            statut: dates.updatedStatut || ecoute.statut
          }
        : ecoute
    );

    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
    setEditingEcouteId(null);
  };

  const handlePose = (date: string) => {
    if (!onUpdate || !enquete || !poseEcouteId || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id === poseEcouteId) {
        return {
          ...ecoute,
          ...ActeUtils.setPose(ecoute, date)
        };
      }
      return ecoute;
    });

    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
    setPoseEcouteId(null);
  };

  const handleProlongationWithCheck = (ecouteId: number) => {
    const ecoute = enquete.ecoutes?.find(e => e.id === ecouteId);
    if (ecoute?.prolongationsHistory && ecoute.prolongationsHistory.length >= 1) {
      if (window.confirm('⚠️ Attention : Cette écoute a déjà été prolongée une fois. Une seconde prolongation est exceptionnelle et nécessite une justification particulière. Voulez-vous continuer ?')) {
        setProlongationEcouteId(ecouteId);
      }
    } else {
      setProlongationEcouteId(ecouteId);
    }
  };

  const handleProlongation = () => {
    if (!onUpdate || !enquete || !prolongationEcouteId || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id === prolongationEcouteId) {
        return {
          ...ecoute,
          statut: 'prolongation_pending'
        };
      }
      return ecoute;
    });

    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
    setTimeout(() => {
      setProlongationEcouteId(null);
    }, 500);
  };

  const handleValidateProlongation = (date: string, duration: string) => {
    if (!onUpdate || !enquete || !validationEcouteId || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id === validationEcouteId) {
        const newHistoryEntry: ProlongationHistoryEntry = {
          date,
          dureeAjoutee: duration,
          dureeInitiale: ecoute.duree
        };

        const prolongationsHistory = ecoute.prolongationsHistory || [];
        const updatedHistory = [...prolongationsHistory, newHistoryEntry];

        return {
          ...ecoute,
          ...ActeUtils.calculateProlongation(ecoute, date, duration),
          prolongationDate: date,
          prolongationsHistory: updatedHistory
        };
      }
      return ecoute;
    });

    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
    setTimeout(() => setValidationEcouteId(null), 500);
  };

  const handleValidateAutorisation = (date: string) => {
    if (!onUpdate || !enquete || !autorisationEcouteId || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id === autorisationEcouteId) {
        return {
          ...ecoute,
          dateDebut: date,
          statut: 'pose_pending'
        };
      }
      return ecoute;
    });

    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
    setTimeout(() => setAutorisationEcouteId(null), 500);
  };

  const handleDuplicateToGeoloc = (ecoute: EcouteData) => {
    setEcouteToDuplicate(ecoute);
    setShowDuplicateGeolocModal(true);
  };

  const handleSaveDuplicatedGeoloc = (geolocData: Partial<GeolocData>, dates: DateManagerData) => {
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

    setShowDuplicateGeolocModal(false);
    setEcouteToDuplicate(null);
  };

  const handleDeleteProlongation = (ecouteId: number, prolongationIndex: number) => {
    if (!onUpdate || !enquete || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id === ecouteId && ecoute.prolongationsHistory) {
        const updatedHistory = ecoute.prolongationsHistory.filter((_, index) => index !== prolongationIndex);
        
        let nouvelleDuree = ecoute.prolongationsHistory[0]?.dureeInitiale || ecoute.duree;
        updatedHistory.forEach(entry => {
          nouvelleDuree = (parseInt(nouvelleDuree) + parseInt(entry.dureeAjoutee)).toString();
        });

        const dateReference = ecoute.datePose || ecoute.dateDebut;
        const nouvelleDateFin = DateUtils.calculateActeEndDate(dateReference, nouvelleDuree);

        return {
          ...ecoute,
          prolongationsHistory: updatedHistory,
          duree: nouvelleDuree,
          dateFin: nouvelleDateFin,
          prolongationDate: updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1].date : undefined
        };
      }
      return ecoute;
    });

    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
  };

  const handleDeleteEcoute = (id: number) => {
    if (!onUpdate || !enquete || !enquete.ecoutes) return;
    const updatedEcoutes = enquete.ecoutes.filter(ecoute => ecoute.id !== id);
    onUpdate(enquete.id, { ecoutes: updatedEcoutes });
  };

  const now = new Date();
  
  const activeEcoutes = enquete.ecoutes?.filter(e => {
    if (!e.dateFin) return true;
    return new Date(e.dateFin) >= now;
  }) || [];
  
  const terminatedEcoutes = enquete.ecoutes?.filter(e => {
    if (!e.dateFin) return false;
    return new Date(e.dateFin) < now;
  }).sort((a, b) => new Date(b.dateFin).getTime() - new Date(a.dateFin).getTime()) || [];

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold">Écoutes</h3>
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

      {/* Écoutes actives */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeEcoutes.map((ecoute) => {
          const hasHistoryEntries = ecoute.prolongationsHistory && ecoute.prolongationsHistory.length > 0;
          const isHistoryExpanded = expandedHistoryIds.includes(ecoute.id);
          
          return (
          <div key={ecoute.id} className="bg-gray-50 p-3 rounded">
            <div className="flex justify-between items-center mb-2">
              <div>
                <span className="font-medium">{ecoute.numero}</span>
                {ecoute.cible && <span className="text-sm text-gray-500 ml-2">({ecoute.cible})</span>}
                {ecoute.description && (
                  <p className="text-sm text-gray-600 mt-1">{ecoute.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                {ecoute.statut === 'autorisation_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAutorisationEcouteId(ecoute.id)}
                    title="Définir la date d'autorisation JLD"
                  >
                    <FileText className="h-4 w-4 text-purple-600" />
                  </Button>
                )}
                {ecoute.statut === 'pose_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPoseEcouteId(ecoute.id)}
                    title="Définir la date de pose"
                  >
                    <ArrowDown className="h-4 w-4 text-yellow-600" />
                  </Button>
                )}
                {ecoute.duree && onUpdate && ecoute.statut === 'en_cours' && (
                  <div className="flex gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleProlongationWithCheck(ecoute.id)}
                      title="Prolonger l'écoute"
                    >
                      <Clock className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDuplicateToGeoloc(ecoute)}
                      title="Dupliquer en géolocalisation"
                      className="text-blue-600"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {ecoute.statut === 'prolongation_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setValidationEcouteId(ecoute.id)}
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
                      onClick={() => setEditingEcouteId(ecoute.id)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDeleteEcoute(ecoute.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <ProgressBar 
              dateDebut={ecoute.dateDebut}
              dateFin={ecoute.dateFin}
              datePose={ecoute.datePose}
            />
            <div className="mt-1 text-xs text-gray-600">
              {ecoute.statut === 'autorisation_pending' && (
                <p>En attente d'autorisation JLD • Durée prévue: {ecoute.duree || 0} jours</p>
              )}
            </div>
            {hasHistoryEntries && (
              <div className="mt-2">
                <div 
                  className="flex items-center text-xs text-blue-600 cursor-pointer"
                  onClick={() => toggleHistoryExpansion(ecoute.id)}
                >
                  {isHistoryExpanded ? 
                    <ChevronUp className="h-3 w-3 mr-1" /> : 
                    <ChevronDown className="h-3 w-3 mr-1" />
                  }
                  <span>
                    {isHistoryExpanded ? 
                      "Masquer l'historique des prolongations" : 
                      `Voir l'historique des prolongations (${ecoute.prolongationsHistory?.length})`
                    }
                  </span>
                </div>

                {isHistoryExpanded && (
                  <div className="mt-1 pl-2 border-l-2 border-blue-200">
                    {ecoute.prolongationsHistory?.map((entry, index) => (
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
                              handleDeleteProlongation(ecoute.id, index);
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
            {ecoute.prolongationDate && !hasHistoryEntries && (
              <p className="text-xs text-gray-600 mt-2">
                Prolongation: {DateUtils.formatDate(ecoute.prolongationDate)}
              </p>
            )}
          </div>
        )})}
      </div>

      {/* Écoutes terminées */}
      {terminatedEcoutes.length > 0 && (
        <div className="mt-6">
          <div 
            className="flex items-center gap-2 mb-3 cursor-pointer text-gray-500 hover:text-gray-700"
            onClick={() => setShowTerminated(!showTerminated)}
          >
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-sm font-medium flex items-center gap-1">
              {showTerminated ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Mesures terminées ({terminatedEcoutes.length})
            </span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          {showTerminated && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
              {terminatedEcoutes.map((ecoute) => {
                const hasHistoryEntries = ecoute.prolongationsHistory && ecoute.prolongationsHistory.length > 0;
                const isHistoryExpanded = expandedHistoryIds.includes(ecoute.id);
                
                return (
                <div key={ecoute.id} className="bg-gray-50 p-3 rounded border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <span className="font-medium text-gray-600">{ecoute.numero}</span>
                      {ecoute.cible && <span className="text-sm text-gray-500 ml-2">({ecoute.cible})</span>}
                      {ecoute.description && (
                        <p className="text-sm text-gray-500 mt-1">{ecoute.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {/* Bouton de prolongation même pour les terminées */}
                      {ecoute.duree && onUpdate && ecoute.statut === 'en_cours' && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleProlongationWithCheck(ecoute.id)}
                          title="Prolonger l'écoute"
                        >
                          <Clock className="h-4 w-4" />
                        </Button>
                      )}
                      {ecoute.statut === 'prolongation_pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setValidationEcouteId(ecoute.id)}
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
                            onClick={() => setEditingEcouteId(ecoute.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleDeleteEcoute(ecoute.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <ProgressBar 
                    dateDebut={ecoute.dateDebut}
                    dateFin={ecoute.dateFin}
                    datePose={ecoute.datePose}
                  />
                  {hasHistoryEntries && (
                    <div className="mt-2">
                      <div 
                        className="flex items-center text-xs text-blue-600 cursor-pointer"
                        onClick={() => toggleHistoryExpansion(ecoute.id)}
                      >
                        {isHistoryExpanded ? 
                          <ChevronUp className="h-3 w-3 mr-1" /> : 
                          <ChevronDown className="h-3 w-3 mr-1" />
                        }
                        <span>
                          {isHistoryExpanded ? 
                            "Masquer l'historique des prolongations" : 
                            `Voir l'historique des prolongations (${ecoute.prolongationsHistory?.length})`
                          }
                        </span>
                      </div>

                      {isHistoryExpanded && (
                        <div className="mt-1 pl-2 border-l-2 border-blue-200">
                          {ecoute.prolongationsHistory?.map((entry, index) => (
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

      <EcouteModal 
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddEcoute}
        title="Ajouter une écoute"
      />

      <EcouteModal 
        isOpen={!!editingEcouteId}
        onClose={() => setEditingEcouteId(null)}
        onSave={handleUpdateEcoute}
        ecoute={ecouteToEdit || undefined}
        title="Modifier l'écoute"
      />

      <GeolocModal 
        isOpen={showDuplicateGeolocModal}
        onClose={() => {
          setShowDuplicateGeolocModal(false);
          setEcouteToDuplicate(null);
        }}
        onSave={handleSaveDuplicatedGeoloc}
        title="Créer une géolocalisation (dupliquée depuis écoute)"
        initialData={{
          objet: ecouteToDuplicate?.numero || '',
          description: ecouteToDuplicate?.cible || '',
          duree: '15',
          needsJLDAuth: false,
          dateDebut: ecouteToDuplicate?.dateDebut || new Date().toISOString().split('T')[0],
          datePose: ecouteToDuplicate?.dateDebut || new Date().toISOString().split('T')[0]
        }}
      />

      <ProlongationModal 
        isOpen={!!prolongationEcouteId}
        onClose={() => setProlongationEcouteId(null)}
        onConfirm={handleProlongation}
        originalStartDate={enquete.ecoutes?.find(e => e.id === prolongationEcouteId)?.dateDebut}
        originalDuration={enquete.ecoutes?.find(e => e.id === prolongationEcouteId)?.duree}
      />

      <ProlongationValidationModal 
        isOpen={!!validationEcouteId}
        onClose={() => setValidationEcouteId(null)}
        onValidate={handleValidateProlongation}
        originalStartDate={enquete.ecoutes?.find(e => e.id === validationEcouteId)?.dateDebut}
        originalDuration={enquete.ecoutes?.find(e => e.id === validationEcouteId)?.duree}
        poseDate={enquete.ecoutes?.find(e => e.id === validationEcouteId)?.datePose}
      />

      <PoseActeModal
        isOpen={!!poseEcouteId}
        onClose={() => setPoseEcouteId(null)}
        onConfirm={handlePose}
        dateDebut={enquete.ecoutes?.find(e => e.id === poseEcouteId)?.dateDebut || ''}
        duree={enquete.ecoutes?.find(e => e.id === poseEcouteId)?.duree || ''}
      />

      <AutorisationValidationModal
        isOpen={!!autorisationEcouteId}
        onClose={() => setAutorisationEcouteId(null)}
        onValidate={handleValidateAutorisation}
        acteType={`Écoute ${enquete.ecoutes?.find(e => e.id === autorisationEcouteId)?.numero || ''}`}
      />
    </div>
  );
};