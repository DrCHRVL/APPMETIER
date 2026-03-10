import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Enquete, AutreActe, DateManagerData, ProlongationHistoryEntry } from '@/types/interfaces';
import ProgressBar from '../ProgressBar';
import { Edit, X, Clock, Hourglass, ArrowDown, Plus, FileText, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { ProlongationModal } from '../modals/ProlongationModal';
import { PoseActeModal } from '../modals/PoseActeModal';
import { ProlongationValidationModal } from '../modals/ProlongationValidationModal';
import { AutorisationValidationModal } from '../modals/AutorisationValidationModal';
import { ActeUtils, getStatutBadgeProps } from '@/utils/acteUtils';
import { DateUtils } from '@/utils/dateUtils';
import { Badge } from '@/components/ui/badge';
import { ActeModal } from '../modals/ActeModal';
import { AUTRE_ACTE_TYPES, AutreActeTypeKey } from '@/config/acteTypes';
import { TooltipRoot, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/contexts/ToastContext';

interface ActeSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

export const ActeSection = ({ enquete, onUpdate, isEditing }: ActeSectionProps) => {
  const { showToast } = useToast();
  const [editingActeId, setEditingActeId] = useState<number | null>(null);
  const [prolongationActeId, setProlongationActeId] = useState<number | null>(null);
  const [validationActeId, setValidationActeId] = useState<number | null>(null);
  const [autorisationActeId, setAutorisationActeId] = useState<number | null>(null);
  const [poseActeId, setPoseActeId] = useState<number | null>(null);
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

  const acteToEdit = editingActeId 
    ? enquete.actes.find(acte => acte.id === editingActeId) || null
    : null;

  const handleAddActe = (acteData: Partial<AutreActe>, dates: DateManagerData) => {
    if (!onUpdate || !enquete) return;

    const withPose = !!dates.datePose;
    
    const baseFields = {
      type: acteData.type || '',
      description: acteData.description || '',
      dureeUnit: dates.dureeUnit,
      maxProlongations: dates.maxProlongations,
    };

    if (dates.updatedStatut === 'autorisation_pending') {
      const newActe: AutreActe = {
        id: Date.now(),
        ...baseFields,
        dateDebut: '',
        dateFin: '',
        duree: dates.duree || '0',
        statut: 'autorisation_pending'
      };
      onUpdate(enquete.id, { actes: [...enquete.actes, newActe] });
    } else if (dates.updatedStatut === 'en_cours') {
      const newActe: AutreActe = {
        id: Date.now(),
        ...baseFields,
        dateDebut: dates.dateDebut,
        dateFin: dates.dateFin || '',
        duree: dates.duree || '0',
        statut: 'en_cours'
      };
      onUpdate(enquete.id, { actes: [...enquete.actes, newActe] });
    } else {
      try {
        const newActeWithId = ActeUtils.createActe({
          ...baseFields,
          dateDebut: dates.dateDebut,
          dateFin: '',
          duree: dates.duree,
          datePose: dates.datePose || '',
          statut: 'pose_pending'
        }, withPose) as AutreActe;
        onUpdate(enquete.id, { actes: [...enquete.actes, newActeWithId] });
      } catch (error) {
        console.error('Erreur lors de la création de l\'acte:', error);
        throw error;
      }
    }
  };

  const handleUpdateActe = (acteData: Partial<AutreActe>, dates: DateManagerData) => {
    if (!onUpdate || !enquete || !editingActeId) return;

    const updatedActes = enquete.actes.map(acte => {
      if (acte.id !== editingActeId) return acte;

      const newDateDebut = dates.dateDebut || acte.dateDebut;
      const newDatePose = dates.datePose;

      // Recalculer dateFin en tenant compte des prolongations existantes :
      // si l'acte a des prolongations, sa durée totale (acte.duree) les inclut déjà ;
      // on recalcule alors depuis la nouvelle référence avec cette durée totale.
      let newDateFin = dates.dateFin || acte.dateFin;
      if (acte.prolongationsHistory && acte.prolongationsHistory.length > 0) {
        const ref = newDatePose || newDateDebut;
        if (ref && acte.duree) {
          newDateFin = DateUtils.calculateEndDateWithUnit(
            ref,
            acte.duree, // durée totale incluant les prolongations
            acte.dureeUnit || 'jours'
          );
        }
      }

      return {
        ...acte,
        dateDebut: newDateDebut,
        dateFin: newDateFin,
        datePose: newDatePose,
        duree: dates.duree || acte.duree,
        type: acteData.type || acte.type,
        description: acteData.description !== undefined ? acteData.description : acte.description,
        statut: dates.updatedStatut || acte.statut
      };
    });

    onUpdate(enquete.id, { actes: updatedActes });
    setEditingActeId(null);
  };

  const handlePose = (date: string) => {
    if (!onUpdate || !enquete || !poseActeId) return;

    const updatedActes = enquete.actes.map(acte => {
      if (acte.id === poseActeId) {
        return {
          ...acte,
          ...ActeUtils.setPose(acte, date)
        };
      }
      return acte;
    });

    onUpdate(enquete.id, { actes: updatedActes });
    setPoseActeId(null);
  };

  const handleProlongation = () => {
    if (!onUpdate || !enquete || !prolongationActeId) return;

    // Toast d'avertissement selon le type d'acte
    const acte = enquete.actes.find(a => a.id === prolongationActeId);
    if (acte) {
      const cfg = AUTRE_ACTE_TYPES[acte.type as AutreActeTypeKey];
      if (cfg?.toastOnRenewal) {
        showToast(cfg.toastOnRenewal, 'warning');
      }
      // Avertir si la limite de prolongations est atteinte
      const nbProlongations = acte.prolongationsHistory?.length ?? 0;
      if (cfg?.maxProlongations !== undefined && cfg.maxProlongations >= 0 && nbProlongations >= cfg.maxProlongations) {
        showToast(`Limite légale atteinte (${cfg.maxProlongations} prolongation${cfg.maxProlongations > 1 ? 's' : ''} maximum)`, 'error');
        return;
      }
    }

    const updatedActes = enquete.actes.map(a => {
      if (a.id === prolongationActeId) {
        return { ...a, statut: 'prolongation_pending' };
      }
      return a;
    });

    onUpdate(enquete.id, { actes: updatedActes });
    setTimeout(() => {
      setProlongationActeId(null);
    }, 500);
  };

  const handleValidateProlongation = (date: string, duration: string, dureeUnit?: 'jours' | 'mois') => {
    if (!onUpdate || !enquete || !validationActeId) return;

    const updatedActes = enquete.actes.map(acte => {
      if (acte.id === validationActeId) {
        const pUnit = dureeUnit || acte.dureeUnit || 'jours';
        const newHistoryEntry: ProlongationHistoryEntry = {
          date,
          dureeAjoutee: duration,
          dureeInitiale: acte.duree,
          dureeUnit: pUnit
        };

        const prolongationsHistory = acte.prolongationsHistory || [];
        const updatedHistory = [...prolongationsHistory, newHistoryEntry];

        return {
          ...acte,
          ...ActeUtils.calculateProlongation(acte, date, duration, pUnit),
          prolongationDate: date,
          prolongationsHistory: updatedHistory
        };
      }
      return acte;
    });

    onUpdate(enquete.id, { actes: updatedActes });
    setTimeout(() => setValidationActeId(null), 500);
  };

  const handleValidateAutorisation = (date: string) => {
    if (!onUpdate || !enquete || !autorisationActeId) return;

    const updatedActes = enquete.actes.map(acte => {
      if (acte.id === autorisationActeId) {
        return {
          ...acte,
          dateDebut: date,
          statut: 'pose_pending'
        };
      }
      return acte;
    });

    onUpdate(enquete.id, { actes: updatedActes });
    setTimeout(() => setAutorisationActeId(null), 500);
  };

  const handleDeleteProlongation = (acteId: number, prolongationIndex: number) => {
    if (!onUpdate || !enquete) return;

    const updatedActes = enquete.actes.map(acte => {
      if (acte.id === acteId && acte.prolongationsHistory) {
        const updatedHistory = acte.prolongationsHistory.filter((_, index) => index !== prolongationIndex);
        
        let nouvelleDuree = acte.prolongationsHistory[0]?.dureeInitiale || acte.duree;
        updatedHistory.forEach(entry => {
          nouvelleDuree = (parseInt(nouvelleDuree) + parseInt(entry.dureeAjoutee)).toString();
        });

        const dateReference = acte.datePose || acte.dateDebut;
        const nouvelleDateFin = DateUtils.calculateEndDateWithUnit(dateReference, nouvelleDuree, acte.dureeUnit || 'jours');

        return {
          ...acte,
          prolongationsHistory: updatedHistory,
          duree: nouvelleDuree,
          dateFin: nouvelleDateFin,
          prolongationDate: updatedHistory.length > 0 ? updatedHistory[updatedHistory.length - 1].date : undefined
        };
      }
      return acte;
    });

    onUpdate(enquete.id, { actes: updatedActes });
  };

  const handleDeleteActe = (id: number) => {
    if (!onUpdate || !enquete) return;
    
    const updatedActes = enquete.actes.filter(acte => acte.id !== id);
    onUpdate(enquete.id, { actes: updatedActes });
  };

  const now = new Date();
  
  const activeActes = enquete.actes?.filter(a => {
    if (!a.dateFin) return true;
    return new Date(a.dateFin) >= now;
  }) || [];
  
  const terminatedActes = enquete.actes?.filter(a => {
    if (!a.dateFin) return false;
    return new Date(a.dateFin) < now;
  }).sort((a, b) => new Date(b.dateFin).getTime() - new Date(a.dateFin).getTime()) || [];

  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const nbAutorisationPending = activeActes.filter(a => a.statut === 'autorisation_pending').length;
  const nbPosePending         = activeActes.filter(a => a.statut === 'pose_pending').length;
  const nbProlongationPending = activeActes.filter(a => a.statut === 'prolongation_pending').length;
  const nbExpireSoon          = activeActes.filter(a =>
    a.statut === 'en_cours' && a.dateFin &&
    new Date(a.dateFin) <= sevenDaysFromNow && new Date(a.dateFin) >= now
  ).length;
  const hasUrgences = nbAutorisationPending + nbPosePending + nbProlongationPending + nbExpireSoon > 0;

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold">Autres Actes</h3>
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
          {nbExpireSoon > 0 && <span className="text-red-700 font-medium">{nbExpireSoon} acte{nbExpireSoon > 1 ? 's' : ''} expire{nbExpireSoon > 1 ? 'nt' : ''} sous 7 jours</span>}
        </div>
      )}

      {/* Actes actifs */}
      <TooltipProvider>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activeActes.map((acte) => {
          const hasHistoryEntries = acte.prolongationsHistory && acte.prolongationsHistory.length > 0;
          const isHistoryExpanded = expandedHistoryIds.includes(acte.id);
          const typeConfig = AUTRE_ACTE_TYPES[acte.type as AutreActeTypeKey];
          const hoverTips = typeConfig?.hoverTips ?? [];
          const nbProlongations = acte.prolongationsHistory?.length ?? 0;
          const prolongLimitAtteinte = typeConfig !== undefined && typeConfig.maxProlongations >= 0 && nbProlongations >= typeConfig.maxProlongations;
          const statutBadge = getStatutBadgeProps(acte.statut);

          return (
          <div key={acte.id} className="bg-gray-50 p-3 rounded">
            <div className="flex justify-between items-center mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="font-medium text-sm">{typeConfig?.label ?? acte.type}</span>
                  <Badge className={`text-xs px-1.5 py-0 border ${statutBadge.className}`}>{statutBadge.label}</Badge>
                  {hoverTips.length > 0 && (
                    <TooltipRoot>
                      <TooltipTrigger asChild>
                        <button className="text-gray-400 hover:text-blue-500 flex-shrink-0">
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap bg-gray-900 text-white text-xs">
                        {hoverTips.join('\n\n')}
                      </TooltipContent>
                    </TooltipRoot>
                  )}
                </div>
                {typeConfig?.limiteLegaleTexte && (
                  <p className="text-xs text-red-600 font-medium mt-0.5">{typeConfig.limiteLegaleTexte}</p>
                )}
                {acte.description && (
                  <p className="text-sm text-gray-600 mt-1">{acte.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                {acte.statut === 'autorisation_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAutorisationActeId(acte.id)}
                    title="Définir la date d'autorisation JLD"
                  >
                    <FileText className="h-4 w-4 text-purple-600" />
                  </Button>
                )}
                {acte.statut === 'pose_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPoseActeId(acte.id)}
                    title="Définir la date de pose"
                  >
                    <ArrowDown className="h-4 w-4 text-yellow-600" />
                  </Button>
                )}
                {acte.duree && onUpdate && acte.statut === 'en_cours' && !prolongLimitAtteinte && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setProlongationActeId(acte.id)}
                    title="Prolonger l'acte"
                  >
                    <Clock className="h-4 w-4" />
                  </Button>
                )}
                {acte.statut === 'prolongation_pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setValidationActeId(acte.id)}
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
                      onClick={() => setEditingActeId(acte.id)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleDeleteActe(acte.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <ProgressBar 
              dateDebut={acte.dateDebut}
              dateFin={acte.dateFin}
              datePose={acte.datePose}
            />
            <div className="mt-1 text-xs text-gray-600">
              {acte.statut === 'autorisation_pending' && (
                <p>En attente d'autorisation JLD • Durée prévue: {acte.duree || 0} jours</p>
              )}
            </div>
            {hasHistoryEntries && (
              <div className="mt-2">
                <div 
                  className="flex items-center text-xs text-blue-600 cursor-pointer"
                  onClick={() => toggleHistoryExpansion(acte.id)}
                >
                  {isHistoryExpanded ? 
                    <ChevronUp className="h-3 w-3 mr-1" /> : 
                    <ChevronDown className="h-3 w-3 mr-1" />
                  }
                  <span>
                    {isHistoryExpanded ? 
                      "Masquer l'historique des prolongations" : 
                      `Voir l'historique des prolongations (${acte.prolongationsHistory?.length})`
                    }
                  </span>
                </div>

                {isHistoryExpanded && (
                  <div className="mt-1 pl-2 border-l-2 border-blue-200">
                    {acte.prolongationsHistory?.map((entry, index) => (
                      <div key={index} className="text-xs text-gray-600 mb-1 flex items-center justify-between">
                        <div>
                          <span className="font-medium">Prolongation {index + 1}: </span>
                          <span>{DateUtils.formatDate(entry.date)}</span>
                          <span className="mx-1">•</span> 
                          <span>{entry.dureeAjoutee} {entry.dureeUnit === 'mois' ? 'mois' : 'jours'}</span>
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
                              handleDeleteProlongation(acte.id, index);
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
            {acte.prolongationDate && !hasHistoryEntries && (
              <p className="text-xs text-gray-600 mt-2">
                Prolongation: {DateUtils.formatDate(acte.prolongationDate)}
              </p>
            )}
          </div>
        )})}
      </div>
      </TooltipProvider>

      {/* Actes terminés */}
      {terminatedActes.length > 0 && (
        <div className="mt-6">
          <div 
            className="flex items-center gap-2 mb-3 cursor-pointer text-gray-500 hover:text-gray-700"
            onClick={() => setShowTerminated(!showTerminated)}
          >
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-sm font-medium flex items-center gap-1">
              {showTerminated ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Mesures terminées ({terminatedActes.length})
            </span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          {showTerminated && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
              {terminatedActes.map((acte) => {
                const hasHistoryEntries = acte.prolongationsHistory && acte.prolongationsHistory.length > 0;
                const isHistoryExpanded = expandedHistoryIds.includes(acte.id);
                
                return (
                <div key={acte.id} className="bg-gray-50 p-3 rounded border border-gray-200">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <span className="font-medium text-gray-600">{acte.type}</span>
                      {acte.description && (
                        <p className="text-sm text-gray-500 mt-1">{acte.description}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {/* Bouton de prolongation même pour les terminés */}
                      {acte.duree && onUpdate && acte.statut === 'en_cours' && (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => setProlongationActeId(acte.id)}
                          title="Prolonger l'acte"
                        >
                          <Clock className="h-4 w-4" />
                        </Button>
                      )}
                      {acte.statut === 'prolongation_pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setValidationActeId(acte.id)}
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
                            onClick={() => setEditingActeId(acte.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleDeleteActe(acte.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <ProgressBar 
                    dateDebut={acte.dateDebut}
                    dateFin={acte.dateFin}
                    datePose={acte.datePose}
                  />
                  {hasHistoryEntries && (
                    <div className="mt-2">
                      <div 
                        className="flex items-center text-xs text-blue-600 cursor-pointer"
                        onClick={() => toggleHistoryExpansion(acte.id)}
                      >
                        {isHistoryExpanded ? 
                          <ChevronUp className="h-3 w-3 mr-1" /> : 
                          <ChevronDown className="h-3 w-3 mr-1" />
                        }
                        <span>
                          {isHistoryExpanded ? 
                            "Masquer l'historique des prolongations" : 
                            `Voir l'historique des prolongations (${acte.prolongationsHistory?.length})`
                          }
                        </span>
                      </div>

                      {isHistoryExpanded && (
                        <div className="mt-1 pl-2 border-l-2 border-blue-200">
                          {acte.prolongationsHistory?.map((entry, index) => (
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

      <ActeModal 
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddActe}
        title="Ajouter un acte"
      />

      <ActeModal 
        isOpen={!!editingActeId}
        onClose={() => setEditingActeId(null)}
        onSave={handleUpdateActe}
        acte={acteToEdit || undefined}
        title="Modifier l'acte"
      />

      <ProlongationModal 
        isOpen={!!prolongationActeId}
        onClose={() => setProlongationActeId(null)}
        onConfirm={handleProlongation}
        originalStartDate={enquete.actes.find(a => a.id === prolongationActeId)?.dateDebut}
        originalDuration={enquete.actes.find(a => a.id === prolongationActeId)?.duree}
      />

      {(() => {
        const acteToValidate = enquete.actes.find(a => a.id === validationActeId);
        const cfg = acteToValidate ? AUTRE_ACTE_TYPES[acteToValidate.type as AutreActeTypeKey] : null;
        const pUnit = cfg?.prolongationDureeUnit as 'jours' | 'mois' | undefined ?? acteToValidate?.dureeUnit ?? 'jours';
        const pDuree = cfg?.prolongationDuree !== undefined ? String(cfg.prolongationDuree) : undefined;
        return (
          <ProlongationValidationModal
            isOpen={!!validationActeId}
            onClose={() => setValidationActeId(null)}
            onValidate={handleValidateProlongation}
            originalStartDate={acteToValidate?.dateDebut}
            originalDuration={acteToValidate?.duree}
            originalDureeUnit={acteToValidate?.dureeUnit || 'jours'}
            poseDate={acteToValidate?.datePose}
            prolongationDureeUnit={pUnit}
            defaultProlongationDuree={pDuree}
          />
        );
      })()}

      <PoseActeModal
        isOpen={!!poseActeId}
        onClose={() => setPoseActeId(null)}
        onConfirm={handlePose}
        dateDebut={enquete.actes.find(a => a.id === poseActeId)?.dateDebut || ''}
        duree={enquete.actes.find(a => a.id === poseActeId)?.duree || ''}
        dureeUnit={enquete.actes.find(a => a.id === poseActeId)?.dureeUnit || 'jours'}
      />

      <AutorisationValidationModal
        isOpen={!!autorisationActeId}
        onClose={() => setAutorisationActeId(null)}
        onValidate={handleValidateAutorisation}
        acteType={enquete.actes.find(a => a.id === autorisationActeId)?.type || ''}
      />
    </div>
  );
};