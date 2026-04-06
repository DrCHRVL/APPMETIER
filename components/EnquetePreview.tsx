import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Archive, Edit, Trash, RotateCcw, Users, Building2, FileText, Calendar, Flag, Clock, Hourglass, Gavel, ArrowDown, Star, EyeOff, Eye, Link2 } from 'lucide-react';
import { Enquete, Alert, VisualAlertRule, ToDoItem } from '@/types/interfaces';
import { VISUAL_ALERT_COLOR_PALETTE } from '@/config/constants';
import { StartEnqueteModal } from './modals/StartEnqueteModal';
import { AlertsModal } from './modals/AlertsModal';
import { ArchiveEnqueteModal } from './modals/ArchiveEnqueteModal';
import { ViewAudienceResultModal } from './modals/ViewAudienceResultModal';
import { useAudience } from '@/hooks/useAudience';
import { ExpandableCR } from './ExpandableCR';
import { useToast } from '@/contexts/ToastContext';
import { ProlongationModal } from './modals/ProlongationModal';
import { PoseActeModal } from './modals/PoseActeModal';
import { ProlongationValidationModal } from './modals/ProlongationValidationModal';
import { AutorisationValidationModal } from './modals/AutorisationValidationModal';
import { useTags } from '@/hooks/useTags';
import { useUser } from '@/contexts/UserContext';
import { OverboardPin } from '@/types/userTypes';

interface EnquetePreviewProps {
  enquete: Enquete;
  isArchived?: boolean;
  onView: () => void;
  onEdit?: () => void;
  onArchive?: (id: number) => void;
  onDelete?: () => void;
  onUnarchive?: () => void;
  onToggleSuivi?: (type: 'JIRS' | 'PG') => void;
  onStartEnquete?: (id: number, date: string) => void;
  onToggleOverboardPin?: (enqueteId: number) => void;
  onToggleHideFromJA?: (enqueteId: number) => void;
  alerts: Alert[];
  onValidateAlert: (alertId: number | number[]) => void;
  onSnoozeAlert: (alertId: number, daysOrDate: number | string) => void;
  onProlongationRequest?: (acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  onPoseRequest?: (acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  onValidateProlongationRequest?: (acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  onValidateAutorisationRequest?: (acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  visualAlertRules?: VisualAlertRule[];
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
}

export const EnquetePreview = ({
  enquete,
  isArchived = false,
  onView,
  onEdit,
  onArchive,
  onDelete,
  onUnarchive,
  onToggleSuivi,
  onStartEnquete,
  alerts,
  onValidateAlert, 
  onSnoozeAlert, 
  onToggleOverboardPin,
  onToggleHideFromJA,
  onProlongationRequest,
  onPoseRequest,
  onValidateProlongationRequest,
  onValidateAutorisationRequest,
  visualAlertRules = [],
  onCreateGlobalTodo
}: EnquetePreviewProps) => {
  // États pour les modales
  const [showStartModal, setShowStartModal] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAudienceResultModal, setShowAudienceResultModal] = useState(false);
  const [showAutorisationModal, setShowAutorisationModal] = useState(false);
  const [showHideConfirm, setShowHideConfirm] = useState(false);
  const [selectedActe, setSelectedActe] = useState<{ id: number, type: 'acte' | 'ecoute' | 'geoloc' } | null>(null);

  // Hooks
  const { hasResultat, deleteAudienceResultat, isLoading } = useAudience();
  const { showToast } = useToast();
  const { getServicesFromTags } = useTags();
  const { user, canDo: userCanDo } = useUser();

  // Pin overboard
  const isPinned = useMemo(() => {
    if (!user || !enquete.overboardPins) return false;
    return enquete.overboardPins.some(p => p.pinnedBy === user.windowsUsername);
  }, [enquete.overboardPins, user]);

  // L'utilisateur est-il JA ? (pas de rôle global = potentiellement JA)
  const isUserJA = useMemo(() => {
    if (!user) return false;
    if (user.globalRole) return false;
    return user.contentieux.some(c => c.role === 'ja');
  }, [user]);

  // Variables dérivées
  const lastCR = enquete.comptesRendus[0];
  const activeActes = [
    ...(enquete.actes || []), 
    ...(enquete.ecoutes || []), 
    ...(enquete.geolocalisations || [])
  ].filter(acte => 
    (acte.statut === 'en_cours' || 
     acte.statut === 'prolongation_pending' || 
     acte.statut === 'pose_pending' ||
     acte.statut === 'autorisation_pending') && 
    (acte.dateFin || acte.statut === 'pose_pending' || acte.statut === 'autorisation_pending')
  );

  // Compteur des tâches à faire actives
  const activeTodosCount = useMemo(() => {
    return enquete.toDos?.filter(todo => todo.status === 'active').length || 0;
  }, [enquete.toDos]);

  // Calcul des jours vers OP (réutilisé dans l'évaluation des règles visuelles)
  const daysToOP = useMemo(() => {
    if (!enquete.dateOP) return null;
    return Math.ceil(
      (new Date(enquete.dateOP).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24)
    );
  }, [enquete.dateOP]);

  const isSuiviJIRS = enquete.tags.some(tag => tag.category === 'suivi' && tag.value === 'JIRS');
  const isSuiviPG = enquete.tags.some(tag => tag.category === 'suivi' && tag.value === 'PG');

  const enqueteAlerts = alerts.filter(alert => alert.enqueteId === enquete.id && alert.status === 'active');
  const hasCRDelayAlert = enqueteAlerts.some(alert => alert.type === 'cr_delay');

  const descriptionPreview = enquete.description
    ? enquete.description.length > 400
      ? `${enquete.description.substring(0, 400)}...`
      : enquete.description
    : null;

  // Services dérivés depuis les tags
  const displayServices = getServicesFromTags(enquete.tags);

  // Évaluation des règles d'alerte visuelles (triées par priorité)
  const matchingVisualRules = useMemo(() => {
    if (visualAlertRules.length === 0) return [];

    return visualAlertRules
      .filter(rule => rule.enabled)
      .filter(rule => {
        switch (rule.trigger) {
          case 'op_active':
            return daysToOP !== null && daysToOP < 0;
          case 'op_proche':
            return daysToOP !== null && daysToOP >= 0 && daysToOP <= rule.seuil;
          case 'acte_critique':
            return activeActes.some(acte => {
              if (!acte.dateFin) return false;
              const daysLeft = Math.ceil((new Date(acte.dateFin).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
              return daysLeft <= rule.seuil && daysLeft >= 0;
            });
          case 'cr_retard': {
            const cr = enquete.comptesRendus[0];
            if (!cr) return false;
            const daysSinceCR = Math.ceil((new Date().getTime() - new Date(cr.date).getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceCR >= rule.seuil;
          }
          case 'prolongation_pending':
            return activeActes.some(acte => {
              if (acte.statut !== 'prolongation_pending') return false;
              if (!acte.prolongationDate) return true; // pas de date = toujours matcher
              const daysSince = Math.ceil((new Date().getTime() - new Date(acte.prolongationDate).getTime()) / (1000 * 60 * 60 * 24));
              return daysSince >= rule.seuil;
            });
          case 'autorisation_pending':
            return activeActes.some(acte => {
              if (acte.statut !== 'autorisation_pending') return false;
              const daysSince = Math.ceil((new Date().getTime() - new Date(acte.dateDebut).getTime()) / (1000 * 60 * 60 * 24));
              return daysSince >= rule.seuil;
            });
          case 'jld_pending':
            return activeActes.some(acte => {
              if (acte.statut === 'autorisation_pending') {
                const daysSince = Math.ceil((new Date().getTime() - new Date(acte.dateDebut).getTime()) / (1000 * 60 * 60 * 24));
                return daysSince >= rule.seuil;
              }
              if (acte.statut === 'prolongation_pending') {
                const refDate = acte.prolongationDate || acte.dateDebut;
                if (!refDate) return true;
                const daysSince = Math.ceil((new Date().getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24));
                return daysSince >= rule.seuil;
              }
              return false;
            });
          default:
            return false;
        }
      })
      .sort((a, b) => a.priority - b.priority);
  }, [visualAlertRules, daysToOP, activeActes, enquete.comptesRendus]);

  // Calcul des classes CSS depuis les règles visuelles
  const { cardBgClass, cardBorderClass } = useMemo(() => {
    if (matchingVisualRules.length === 0) {
      return { cardBgClass: 'bg-white', cardBorderClass: 'border border-gray-200' };
    }

    // Fond : première règle avec fond activé
    const fondRule = matchingVisualRules.find(r => r.mode === 'fond' || r.mode === 'fond_bordure');
    const bgClass = fondRule ? (VISUAL_ALERT_COLOR_PALETTE[fondRule.fondColor]?.fond || 'bg-white') : 'bg-white';

    // Bordures : jusqu'à 2 règles (gauche + droite)
    const bordureRules = matchingVisualRules.filter(r => r.mode === 'bordure' || r.mode === 'fond_bordure');
    const leftRule = bordureRules[0];
    const rightRule = bordureRules[1];

    if (!leftRule) {
      return { cardBgClass: bgClass, cardBorderClass: 'border border-gray-200' };
    }

    const leftColor = VISUAL_ALERT_COLOR_PALETTE[leftRule.bordureColor]?.bordureLeft || 'border-l-red-500';
    let borderClass = `border-l-4 ${leftColor} border-t border-t-gray-200 border-b border-b-gray-200`;

    if (rightRule) {
      const rightColor = VISUAL_ALERT_COLOR_PALETTE[rightRule.bordureColor]?.bordureRight || 'border-r-orange-400';
      borderClass += ` border-r-4 ${rightColor}`;
    } else {
      borderClass += ' border-r border-r-gray-200';
    }

    return { cardBgClass: bgClass, cardBorderClass: borderClass };
  }, [matchingVisualRules]);

  // Handlers
  const handleUnarchive = async () => {
    try {
      const success = await deleteAudienceResultat(enquete.id);
      if (!success) {
        showToast('Erreur lors de la suppression des résultats d\'audience', 'error');
        return;
      }

      if (onUnarchive) {
        onUnarchive();
      }
      showToast('Enquête désarchivée avec succès', 'success');
    } catch (error) {
      console.error('Erreur lors du désarchivage:', error);
      showToast('Erreur lors du désarchivage', 'error');
    }
  };

  const handleValidateAutorisation = (date: string) => {
    if (selectedActe && onValidateAutorisationRequest) {
      onValidateAutorisationRequest(selectedActe.id, selectedActe.type);
      showToast('Autorisation validée', 'success');
      setSelectedActe(null);
      setShowAutorisationModal(false);
    }
  };

return (
    <>
      <Card
        className={`w-full card-hover cursor-pointer overflow-hidden ${cardBgClass} ${cardBorderClass}`}
        onClick={onView}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-2 px-3">
  <div className="flex-1 min-w-0 mr-3 max-w-[60%]">
    <div className="flex flex-col mb-1.5">
      <CardTitle className="text-base font-bold flex flex-wrap items-center gap-1.5">
        <div className="break-words min-w-[60%] max-w-full">
          {enquete.numero}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Indicateur de tâches à faire */}
          {activeTodosCount > 0 && (
            <div className="h-5 w-5 bg-violet-500 text-white text-[8px] rounded-full flex items-center justify-center font-bold shadow-md">
              {activeTodosCount}
            </div>
          )}

          {/* Pin overboard */}
          {onToggleOverboardPin && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-5 w-5 p-0 transition-colors ${
                isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-gray-400'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleOverboardPin(enquete.id);
              }}
              title={isPinned ? 'Retirer du suivi hiérarchique' : 'Épingler au suivi hiérarchique'}
            >
              <Star className={`h-3 w-3 ${isPinned ? 'fill-amber-500' : ''}`} />
            </Button>
          )}

          {/* Dissimulation JA — invisible pour les JA eux-mêmes */}
          {onToggleHideFromJA && !isUserJA && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-5 w-5 p-0 transition-colors ${
                enquete.hiddenFromJA ? 'text-red-400 hover:text-red-500' : 'text-gray-300 hover:text-gray-400'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setShowHideConfirm(true);
              }}
              title={enquete.hiddenFromJA ? 'Rendre visible aux JA' : 'Dissimuler aux JA'}
            >
              {enquete.hiddenFromJA ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          )}

         {!isLoading && hasResultat(enquete.id) && (
  <Button
    variant="ghost"
    size="sm"
    className="h-5 w-5 p-0 text-green-600"
    onClick={(e) => {
      e.stopPropagation();
      setShowAudienceResultModal(true);
    }}
    title="Voir les résultats d'audience"
  >
    <Gavel className="h-3 w-3" />
  </Button>
          )}
          {enqueteAlerts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                setShowAlertsModal(true);
              }}
            >
              <div className="relative">
                <div className="h-2.5 w-2.5 bg-red-600 rounded-full"></div>
                {enqueteAlerts.length > 1 && (
                  <span className="absolute -top-1 -right-1 text-[8px] bg-white rounded-full h-2.5 w-2.5 flex items-center justify-center text-red-600 font-bold">
                    {enqueteAlerts.length}
                  </span>
                )}
              </div>
            </Button>
          )}
          {onToggleSuivi && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 transition-colors ${
                  isSuiviJIRS ? 'text-blue-500 hover:text-blue-600' : 'text-gray-300 hover:text-gray-400'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSuivi('JIRS');
                }}
                title="Suivi JIRS"
              >
                <Flag className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-5 w-5 p-0 transition-colors ${
                  isSuiviPG ? 'text-purple-500 hover:text-purple-600' : 'text-gray-300 hover:text-gray-400'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSuivi('PG');
                }}
                title="Suivi Parquet Général"
              >
                <Flag className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </CardTitle>
    </div>

            {/* Tags d'infraction */}
            <div className="flex flex-wrap gap-1 mb-1.5">
              {enquete.tags
                .filter(tag => tag.category === 'infractions')
                .map(tag => (
                  <Badge
                    key={tag.value}
                    variant="outline"
                    className="text-[10px] py-0 px-1.5 bg-gray-50"
                  >
                    {tag.value}
                  </Badge>
                ))}

              {/* Badge co-saisine */}
              {enquete.sharedWith && enquete.sharedWith.length > 0 && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-purple-50 text-purple-700 border-purple-300">
                  <Link2 className="h-3 w-3 mr-0.5" />
                  Co-saisine
                </Badge>
              )}
              {enquete.contentieuxOrigine && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-700 border-amber-300">
                  <Link2 className="h-3 w-3 mr-0.5" />
                  Partagée · {enquete.contentieuxOrigine}
                </Badge>
              )}
            </div>

            {descriptionPreview && (
              <p className="text-xs text-gray-600 mb-1.5 italic line-clamp-6">
                {descriptionPreview}
              </p>
            )}

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1 text-xs text-gray-600 line-clamp-1">
                <Building2 className="h-3 w-3 flex-shrink-0" />
                {displayServices.join(' / ')}
              </div>

              <div className="flex items-start gap-1 text-xs">
                <Users className="h-3 w-3 text-gray-600 mt-0.5 flex-shrink-0" />
                <div className="flex flex-col">
                  {enquete.misEnCause.map((mec, index) => (
                    <span key={mec.id} className="font-medium">
                      {mec.nom}
                      {mec.role ? ` (${mec.role})` : ''}
                      {index < enquete.misEnCause.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

           <div className="flex flex-col items-end flex-shrink-0 max-w-[40%]">
            <div className="flex justify-end gap-1 mb-1.5" onClick={e => e.stopPropagation()}>
             {isArchived ? (
  <>
    {onUnarchive && (
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onUnarchive}>
        <RotateCcw className="h-3 w-3" />
      </Button>
    )}
    {onDelete && (
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onDelete}>
        <Trash className="h-3 w-3" />
      </Button>
    )}
  </>
) : (
                <>
                  {onEdit && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
                      <Edit className="h-3 w-3" />
                    </Button>
                  )}
                  {onArchive && !hasResultat(enquete.id) && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowArchiveModal(true)}>
                      <Archive className="h-3 w-3" />
                    </Button>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Calendar className="h-3 w-3" />
                <span>Début: {new Date(enquete.dateDebut).toLocaleDateString()}</span>
              </div>

              {lastCR && (
                <div className={`text-xs ${hasCRDelayAlert ? 'text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium' : 'text-gray-500'}`}>
                  Dernier CR: {new Date(lastCR.date).toLocaleDateString()} ({lastCR.enqueteur})
                </div>
              )}
            </div>

            {lastCR?.description && (
              <div
                className="mt-1.5 bg-gray-50/80 border border-gray-100 p-1.5 rounded-md text-[9px] text-gray-600 w-full line-clamp-5"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start gap-1">
                  <FileText className="h-2.5 w-2.5 mt-0.5 flex-shrink-0" />
                  <ExpandableCR cr={lastCR} />
                </div>
              </div>
            )}
          </div>
        </CardHeader>

       <CardContent className="px-3 pb-2 pt-0">
  {activeActes.length > 0 && (
    <div className="border-t-2 border-gray-200 pt-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap gap-1">
        {activeActes.map((acte) => {
          const daysLeft = acte.dateFin 
            ? Math.ceil((new Date(acte.dateFin).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
            : null;
          const isPending = acte.statut === 'prolongation_pending';
          const isPosePending = acte.statut === 'pose_pending';
          const isAutorisationPending = acte.statut === 'autorisation_pending';
          const isExpired = daysLeft !== null && daysLeft < 0;

          if (isExpired) return null;

          const badgeColor = isPending ? 'bg-green-100 text-green-800' :
            isPosePending ? 'bg-orange-100 text-orange-800' :
            isAutorisationPending ? 'bg-purple-100 text-purple-800' :
            daysLeft !== null && daysLeft <= 3 ? 'bg-red-100 text-red-800' :
            daysLeft !== null && daysLeft <= 7 ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-100 text-gray-800';
          
          const acteType = 'type' in acte ? acte.type : 
                         'numero' in acte ? `Écoute ${acte.numero}` :
                         'objet' in acte ? `Géoloc ${acte.objet}` : '';
          
 return (
    <Badge 
      key={acte.id} 
      variant="secondary"
      className={`${badgeColor} text-[10px] py-0 px-1.5 flex items-center gap-1 cursor-pointer`}
      onDoubleClick={(e) => {
        const type = 'type' in acte ? 'acte' : 'numero' in acte ? 'ecoute' : 'geoloc';
  
        if (acte.statut === 'pose_pending' && onPoseRequest) {
          onPoseRequest(acte.id, type);
        } else if (acte.statut === 'en_cours' && onProlongationRequest) {
          onProlongationRequest(acte.id, type);
        } else if (acte.statut === 'prolongation_pending' && onValidateProlongationRequest) {
          onValidateProlongationRequest(acte.id, type);
        } else if (acte.statut === 'autorisation_pending' && onValidateAutorisationRequest) {
          setSelectedActe({ id: acte.id, type });
          setShowAutorisationModal(true);
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {isPending && <Hourglass className="h-2 w-2" />}
      {isPosePending && <ArrowDown className="h-2 w-2" />}
      {isAutorisationPending && <Clock className="h-2 w-2" />}
      {acteType} {!isPosePending && !isAutorisationPending && `(${daysLeft}j)`}
      {isAutorisationPending && "(JLD)"}
    </Badge>
  );
})}
      </div>
    </div>
  )}
</CardContent>

      </Card>

      <StartEnqueteModal
        isOpen={showStartModal}
        onClose={() => setShowStartModal(false)}
        onConfirm={(date) => {
          if (onStartEnquete) {
            onStartEnquete(enquete.id, date);
          }
          setShowStartModal(false);
        }}
      />

      <AlertsModal
        isOpen={showAlertsModal}
        onClose={() => setShowAlertsModal(false)}
        alerts={enqueteAlerts}
        onValidateAlert={onValidateAlert}
        onSnoozeAlert={onSnoozeAlert}
      />

      {onArchive && (
        <ArchiveEnqueteModal
          isOpen={showArchiveModal}
          onClose={() => setShowArchiveModal(false)}
          enqueteId={enquete.id}
          onArchive={onArchive}
          misEnCause={enquete.misEnCause}
          enqueteNumero={enquete.numero}
          enqueteTags={enquete.tags}
          onCreateGlobalTodo={onCreateGlobalTodo}
        />
      )}

      <ViewAudienceResultModal
  isOpen={showAudienceResultModal}
  onClose={() => setShowAudienceResultModal(false)}
  enqueteId={enquete.id}
  onReset={async () => {
    try {
      await deleteAudienceResultat(enquete.id);
      showToast('Résultats supprimés avec succès', 'success');
      // Déclencher une mise à jour des stats
      window.dispatchEvent(new Event('audience-stats-update'));
      setShowAudienceResultModal(false);
    } catch (error) {
      showToast('Erreur lors de la suppression des résultats', 'error');
    }
  }}
  onUpdate={(resultat) => {
    // Déclencher une mise à jour des stats si nécessaire
    window.dispatchEvent(new Event('audience-stats-update'));
  }}
/>

      {selectedActe && (
        <AutorisationValidationModal
          isOpen={showAutorisationModal}
          onClose={() => {
            setShowAutorisationModal(false);
            setSelectedActe(null);
          }}
          onValidate={handleValidateAutorisation}
          acteType={selectedActe?.type || ''}
        />
      )}

      {/* Confirmation dissimulation JA */}
      {showHideConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">
              {enquete.hiddenFromJA
                ? 'Rendre cette enquête visible aux JA ?'
                : 'Dissimuler cette enquête aux utilisateurs de statut "JA" ?'}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              {enquete.hiddenFromJA
                ? 'Les utilisateurs de statut JA pourront à nouveau voir cette enquête sur la grille.'
                : 'Les utilisateurs de statut JA ne verront plus cette enquête sur la grille. Aucun impact sur les statistiques.'}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHideConfirm(false);
                }}
              >
                Non
              </Button>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onToggleHideFromJA) {
                    onToggleHideFromJA(enquete.id);
                  }
                  setShowHideConfirm(false);
                }}
              >
                Oui
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};