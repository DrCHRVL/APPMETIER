import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Enquete, EcouteData, GeolocData, DateManagerData, ProlongationHistoryEntry } from '@/types/interfaces';
import ProgressBar from '../ProgressBar';
import { Edit, X, Clock, Hourglass, ArrowDown, Plus, FileText, ChevronDown, ChevronUp, Copy, Ban } from 'lucide-react';
import { ProlongationModal } from '../modals/ProlongationModal';
import { PoseActeModal } from '../modals/PoseActeModal';
import { ProlongationValidationModal } from '../modals/ProlongationValidationModal';
import { AutorisationValidationModal } from '../modals/AutorisationValidationModal';
import { ActeUtils, getStatutBadgeProps, trackDeletedActeId } from '@/utils/acteUtils';
import { useToast } from '@/contexts/ToastContext';
import { DateUtils } from '@/utils/dateUtils';
import { Badge } from '@/components/ui/badge';
import { EcouteModal } from '../modals/EcouteModal';
import { GeolocModal } from '../modals/GeolocModal';

interface EcouteSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

export const EcouteSection = React.memo(({ enquete, onUpdate, isEditing }: EcouteSectionProps) => {
  const { showToast } = useToast();
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
        duree: dates.duree || '1',
        dureeUnit: dates.dureeUnit || 'mois',
        maxProlongations: dates.maxProlongations ?? 1,
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
          dureeUnit: dates.dureeUnit || 'mois',
          maxProlongations: dates.maxProlongations ?? 1,
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
    showToast('Écoute créée', 'success');
  };

  const handleUpdateEcoute = (ecouteData: Partial<EcouteData>, dates: DateManagerData) => {
    if (!onUpdate || !enquete || !editingEcouteId || !enquete.ecoutes) return;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id !== editingEcouteId) return ecoute;

      const hasProlongations = ecoute.prolongationsHistory && ecoute.prolongationsHistory.length > 0;
      const updated: EcouteData = {
        ...ecoute,
        dateDebut: dates.dateDebut || ecoute.dateDebut,
        datePose: dates.datePose,
        numero: ecouteData.numero || ecoute.numero,
        cible: ecouteData.cible !== undefined ? ecouteData.cible : ecoute.cible,
        description: ecouteData.description !== undefined ? ecouteData.description : ecoute.description,
        statut: dates.updatedStatut || ecoute.statut
      };

      // Ne pas écraser duree/dateFin si des prolongations existent déjà
      if (!hasProlongations) {
        updated.duree = dates.duree || ecoute.duree;
        updated.dureeUnit = dates.dureeUnit || ecoute.dureeUnit;
        updated.dateFin = dates.dateFin || ecoute.dateFin;
      }

      return updated;
    });

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
    setProlongationEcouteId(ecouteId);
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

  // Prolongation des écoutes : toujours 1 mois calendaire
  const ECOUTE_PROLONG_UNIT = 'mois' as const;

  const handleValidateProlongation = (date: string, duration: string, dureeUnit?: 'jours' | 'mois') => {
    if (!onUpdate || !enquete || !validationEcouteId || !enquete.ecoutes) return;
    const pUnit = dureeUnit || ECOUTE_PROLONG_UNIT;

    const updatedEcoutes = enquete.ecoutes.map(ecoute => {
      if (ecoute.id === validationEcouteId) {
        const dureeInitiale = ecoute.prolongationsHistory?.[0]?.dureeInitiale || ecoute.duree;
        const newHistoryEntry: ProlongationHistoryEntry = {
          date,
          dureeAjoutee: duration,
          dureeInitiale: dureeInitiale,
          dureeUnit: pUnit,
          dureeInitialeUnit: ecoute.dureeUnit || 'mois'
        };

        const prolongationsHistory = ecoute.prolongationsHistory || [];
        const updatedHistory = [...prolongationsHistory, newHistoryEntry];

        return {
          ...ecoute,
          ...ActeUtils.calculateProlongation(ecoute, date, duration, pUnit, updatedHistory.map(e => ({ dureeAjoutee: e.dureeAjoutee, dureeUnit: e.dureeUnit }))),
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

        const dureeInitiale = ecoute.prolongationsHistory[0]?.dureeInitiale || ecoute.duree;
        const dureeInitialeUnit = ecoute.dureeUnit || 'jours';

        let nouvelleDuree = dureeInitiale;
        updatedHistory.forEach(entry => {
          nouvelleDuree = (parseInt(nouvelleDuree) + parseInt(entry.dureeAjoutee)).toString();
        });

        const dateReference = ecoute.datePose || ecoute.dateDebut;
        const nouvelleDateFin = ActeUtils.replayDateFin(
          dateReference,
          dureeInitiale,
          dureeInitialeUnit,
          updatedHistory.map(e => ({ dureeAjoutee: e.dureeAjoutee, dureeUnit: e.dureeUnit }))
        );

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
    trackDeletedActeId(id);
    showToast('Écoute supprimée', 'success');
  };

  const handleRefuseJLD = (id: number) => {
    if (!onUpdate || !enquete || !enquete.ecoutes) return;
    const updatedEcoutes = enquete.ecoutes.map(ecoute =>
      ecoute.id === id ? { ...ecoute, statut: 'refuse' as const } : ecoute
    );
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

  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const nbAutorisationPending = activeEcoutes.filter(e => e.statut === 'autorisation_pending').length;
  const nbPosePending         = activeEcoutes.filter(e => e.statut === 'pose_pending').length;
  const nbProlongationPending = activeEcoutes.filter(e => e.statut === 'prolongation_pending').length;
  const nbExpireSoon          = activeEcoutes.filter(e =>
    e.statut === 'en_cours' && e.dateFin &&
    new Date(e.dateFin) <= sevenDaysFromNow && new Date(e.dateFin) >= now
  ).length;
  const hasUrgences = nbAutorisationPending + nbPosePending + nbProlongationPending + nbExpireSoon > 0;

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

      {/* Bannière urgences */}
      {hasUrgences && (
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">⚠ Actions en attente :</span>
          {nbAutorisationPending > 0 && <span>{nbAutorisationPending} autorisation{nbAutorisationPending > 1 ? 's' : ''} en attente</span>}
          {nbPosePending > 0 && <span>{nbPosePending} pose{nbPosePending > 1 ? 's' : ''} en attente</span>}
          {nbProlongationPending > 0 && <span>{nbProlongationPending} prolongation{nbProlongationPending > 1 ? 's' : ''} à valider</span>}
          {nbExpireSoon > 0 && <span className="text-red-700 font-medium">{nbExpireSoon} écoute{nbExpireSoon > 1 ? 's' : ''} expire{nbExpireSoon > 1 ? 'nt' : ''} sous 7 jours</span>}
        </div>
      )}

      {/* Écoutes actives */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeEcoutes.map((ecoute) => {
          const hasHistoryEntries = ecoute.prolongationsHistory && ecoute.prolongationsHistory.length > 0;
          const isHistoryExpanded = expandedHistoryIds.includes(ecoute.id);
          const nbProlongations = ecoute.prolongationsHistory?.length ?? 0;
          const maxP = ecoute.maxProlongations ?? 1;
          const prolongLimitAtteinte = maxP >= 0 && nbProlongations >= maxP;
          const statutBadge = getStatutBadgeProps(ecoute.statut);

          return (
          <div key={ecoute.id} className="bg-gray-50 p-3 rounded">
            <div className="flex justify-between items-center mb-2">
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium">{ecoute.numero}</span>
                  {ecoute.cible && <span className="text-sm text-gray-500">({ecoute.cible})</span>}
                  <Badge className={`text-xs px-1.5 py-0 border ${statutBadge.className}`}>{statutBadge.label}</Badge>
                </div>
                {ecoute.description && (
                  <p className="text-sm text-gray-600 mt-1">{ecoute.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                {ecoute.statut === 'autorisation_pending' && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAutorisationEcouteId(ecoute.id)}
                      title="Définir la date d'autorisation JLD"
                    >
                      <FileText className="h-4 w-4 text-purple-600" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRefuseJLD(ecoute.id)}
                      title="Refus JLD — écoute non autorisée"
                    >
                      <Ban className="h-4 w-4 text-red-500" />
                    </Button>
                  </>
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
                    {!prolongLimitAtteinte && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleProlongationWithCheck(ecoute.id)}
                      title="Prolonger l'écoute"
                    >
                      <Clock className="h-4 w-4" />
                    </Button>
                    )}
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
            {prolongLimitAtteinte && (
              <p className="text-xs text-red-600 mt-1">Limite légale de prolongation atteinte ({maxP} max)</p>
            )}
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
                const nbProlongationsT = ecoute.prolongationsHistory?.length ?? 0;
                const maxPT = ecoute.maxProlongations ?? 1;
                const prolongLimitAtteinteT = maxPT >= 0 && nbProlongationsT >= maxPT;
                
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
                  {prolongLimitAtteinteT && (
                    <p className="text-xs text-red-600 mt-1">Limite légale de prolongation atteinte ({maxPT} max)</p>
                  )}
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
                              <span>{entry.dureeAjoutee} {entry.dureeUnit === 'mois' ? 'mois' : 'jours'}</span>
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
        originalDureeUnit={enquete.ecoutes?.find(e => e.id === validationEcouteId)?.dureeUnit || 'mois'}
        poseDate={enquete.ecoutes?.find(e => e.id === validationEcouteId)?.datePose}
        currentDateFin={enquete.ecoutes?.find(e => e.id === validationEcouteId)?.dateFin}
        prolongationDureeUnit="mois"
        defaultProlongationDuree="1"
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
});