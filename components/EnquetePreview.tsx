import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Archive, Edit, Trash, RotateCcw, Users, Building2, FileText, Calendar, Flag, Clock, Hourglass, Gavel, ArrowDown, Star, EyeOff, Eye, Link2, History } from 'lucide-react';
import { Enquete, Alert, VisualAlertRule, ToDoItem } from '@/types/interfaces';
import { getUnseenModifications } from '@/utils/modificationLogger';
import { getOPPhases, getOPPhaseEndDate } from '@/utils/opPhases';
import { VISUAL_ALERT_COLOR_PALETTE, VISUAL_ALERT_TRIGGER_GROUP } from '@/config/constants';
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
import { useInfractionNatinf } from '@/hooks/useInfractionNatinf';
import { NatinfBadge } from './natinf/NatinfBadge';
import { useUser } from '@/contexts/UserContext';
import { getLastCR } from '@/utils/compteRenduUtils';
import { getProlongationRequestDate, getAutorisationRequestDate } from '@/utils/acteUtils';
import { OverboardPin } from '@/types/userTypes';

interface EnquetePreviewProps {
  enquete: Enquete;
  /** Id du contentieux propriétaire de l'enquête. Indispensable pour les
      lookups dans le store de résultats d'audience (clé composite). */
  contentieuxId: string;
  isArchived?: boolean;
  onView: (id: number) => void;
  onEdit?: (id: number) => void;
  onArchive?: (id: number) => void;
  onDelete?: () => void;
  onUnarchive?: () => void;
  onToggleSuivi?: (id: number, type: 'JIRS' | 'PG') => void;
  onStartEnquete?: (id: number, date: string) => void;
  onToggleOverboardPin?: (enqueteId: number) => void;
  onToggleHideFromJA?: (enqueteId: number) => void;
  alerts: Alert[];
  onValidateAlert: (alertId: number | number[]) => void;
  onSnoozeAlert: (alertId: number, daysOrDate: number | string) => void;
  onProlongationRequest?: (enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  onPoseRequest?: (enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  onValidateProlongationRequest?: (enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  onValidateAutorisationRequest?: (enqueteId: number, acteId: number, type: 'acte' | 'ecoute' | 'geoloc') => void;
  visualAlertRules?: VisualAlertRule[];
  /** Surlignage ambre de la ligne « Dernier CR » quand alerte cr_delay active. Défaut true. */
  crDelayHighlight?: boolean;
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
}

export const EnquetePreview = React.memo(({
  enquete,
  contentieuxId,
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
  crDelayHighlight = true,
  onCreateGlobalTodo
}: EnquetePreviewProps) => {
  // États pour les modales
  const [showStartModal, setShowStartModal] = useState(false);
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showAudienceResultModal, setShowAudienceResultModal] = useState(false);
  const [showAutorisationModal, setShowAutorisationModal] = useState(false);
  const [showHideConfirm, setShowHideConfirm] = useState(false);
  const [showAllInfractions, setShowAllInfractions] = useState(false);
  const [selectedActe, setSelectedActe] = useState<{ id: number, type: 'acte' | 'ecoute' | 'geoloc' } | null>(null);

  // Hooks
  const { hasResultat, deleteAudienceResultat, isLoading } = useAudience();
  const { showToast } = useToast();
  const { getServicesFromTags } = useTags();
  const { infractionsForEnquete } = useInfractionNatinf();
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

  // Modifications non vues par l'utilisateur courant (faites par d'autres)
  const unseenCount = useMemo(() => {
    if (!user) return 0;
    return getUnseenModifications(enquete, user.windowsUsername).length;
  }, [enquete, user]);

  // Variables dérivées
  const lastCR = getLastCR(enquete.comptesRendus);
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

  // Calcul des jours vers OP (réutilisé dans l'évaluation des règles visuelles).
  // Avec plusieurs phases possibles : on prend la phase non terminée la plus
  // proche (à venir si dispo, sinon une phase en cours -> daysToOP négatif).
  const daysToOP = useMemo(() => {
    const phases = getOPPhases(enquete);
    if (phases.length === 0) return null;
    const todayMs = new Date().setHours(0, 0, 0, 0);
    const candidates = phases
      .map(p => {
        const start = new Date(p.dateDebut).setHours(0, 0, 0, 0);
        const end = getOPPhaseEndDate(p).getTime();
        return { days: Math.ceil((start - todayMs) / (1000 * 60 * 60 * 24)), end };
      })
      .filter(c => c.end >= todayMs); // ignore les phases déjà terminées
    if (candidates.length === 0) return null;
    const upcoming = candidates.filter(c => c.days >= 0);
    if (upcoming.length > 0) return Math.min(...upcoming.map(c => c.days));
    return Math.max(...candidates.map(c => c.days));
  }, [enquete]);

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

  // Infractions de l'enquête : repliées par défaut au-delà d'un seuil pour ne
  // pas surcharger la carte (« +N » dépliable à la demande).
  const infractionItems = useMemo(() => infractionsForEnquete(enquete), [infractionsForEnquete, enquete]);
  const INFRACTION_PREVIEW_LIMIT = 3;
  const visibleInfractions = showAllInfractions
    ? infractionItems
    : infractionItems.slice(0, INFRACTION_PREVIEW_LIMIT);
  const hiddenInfractionsCount = infractionItems.length - visibleInfractions.length;

  // Évaluation des règles d'alerte visuelles (triées par priorité)
  const matchingVisualRules = useMemo(() => {
    if (visualAlertRules.length === 0) return [];

    const matched = visualAlertRules
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
            const cr = getLastCR(enquete.comptesRendus);
            if (!cr) return false;
            const daysSinceCR = Math.ceil((new Date().getTime() - new Date(cr.date).getTime()) / (1000 * 60 * 60 * 24));
            return daysSinceCR >= rule.seuil;
          }
          case 'prolongation_pending':
            return activeActes.some(acte => {
              if (acte.statut !== 'prolongation_pending') return false;
              const refDate = getProlongationRequestDate(acte, enquete.modifications);
              const daysSince = Math.ceil((new Date().getTime() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24));
              return daysSince >= rule.seuil;
            });
          case 'autorisation_pending':
            return activeActes.some(acte => {
              if (acte.statut !== 'autorisation_pending') return false;
              const daysSince = Math.ceil((new Date().getTime() - new Date(getAutorisationRequestDate(acte)).getTime()) / (1000 * 60 * 60 * 24));
              return daysSince >= rule.seuil;
            });
          case 'jld_pending':
            return activeActes.some(acte => {
              if (acte.statut === 'autorisation_pending') {
                const daysSince = Math.ceil((new Date().getTime() - new Date(getAutorisationRequestDate(acte)).getTime()) / (1000 * 60 * 60 * 24));
                return daysSince >= rule.seuil;
              }
              if (acte.statut === 'prolongation_pending') {
                const refDate = getProlongationRequestDate(acte, enquete.modifications);
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

    // Exclusivité par groupe logique : plusieurs paliers d'un même groupe
    // (OP dépassée/proche/semaine, ou JLD/prolongation/autorisation) peuvent
    // matcher en même temps pour le même objet. On ne garde alors que la règle
    // la plus prioritaire du groupe pour éviter la superposition des couleurs
    // et des bordures. Les déclencheurs hors groupe restent cumulables.
    const seenGroups = new Set<string>();
    return matched.filter(rule => {
      const group = VISUAL_ALERT_TRIGGER_GROUP[rule.trigger];
      if (!group) return true;
      if (seenGroups.has(group)) return false;
      seenGroups.add(group);
      return true;
    });
  }, [visualAlertRules, daysToOP, activeActes, enquete.comptesRendus, enquete.modifications]);

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
      const success = await deleteAudienceResultat(contentieuxId, enquete.id);
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
      onValidateAutorisationRequest(enquete.id, selectedActe.id, selectedActe.type);
      showToast('Autorisation validée', 'success');
      setSelectedActe(null);
      setShowAutorisationModal(false);
    }
  };

return (
    <>
      <Card
        className={`w-full card-hover cursor-pointer overflow-hidden ${cardBgClass} ${cardBorderClass}`}
        onClick={() => onView(enquete.id)}
      >
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-2 px-3">
  <div className="flex-1 min-w-0 mr-3 max-w-[60%]">
    <div className="flex flex-col mb-1.5">
      <CardTitle className="text-base font-bold flex flex-wrap items-center gap-1.5">
        <div className="break-words min-w-[60%] max-w-full">
          {enquete.numero}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Modifications non vues (par d'autres utilisateurs) */}
          {unseenCount > 0 && (
            <div
              className="relative h-5 w-5 flex items-center justify-center text-red-600"
              title={`${unseenCount} modification${unseenCount > 1 ? 's' : ''} non vue${unseenCount > 1 ? 's' : ''} — ouvrir l'enquête pour voir le détail`}
            >
              <History className="h-3.5 w-3.5" />
              <span className="absolute -top-0.5 -right-0.5 text-[8px] bg-red-600 text-white rounded-full h-2.5 w-2.5 flex items-center justify-center font-bold">
                {unseenCount > 9 ? '9+' : unseenCount}
              </span>
            </div>
          )}

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

         {!isLoading && hasResultat(contentieuxId, enquete.id) && (
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
                  onToggleSuivi(enquete.id, 'JIRS');
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
                  onToggleSuivi(enquete.id, 'PG');
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

            {/* Tags d'infraction (repliés au-delà du seuil) */}
            <div className="flex flex-wrap gap-1 mb-1.5">
              {visibleInfractions.map((inf, i) => (
                <Badge
                  key={inf.code || inf.label || i}
                  variant="outline"
                  className="text-[10px] py-0 px-1.5 bg-gray-50 inline-flex items-center gap-1 max-w-full"
                  title={inf.label}
                >
                  <span className="min-w-0 max-w-[8rem] truncate">{inf.label}</span>
                  {inf.code && (
                    <span className="shrink-0">
                      <NatinfBadge code={inf.code} nature={inf.nature} quantumLabel={inf.quantumLabel} compact />
                    </span>
                  )}
                </Badge>
              ))}

              {/* Dépliage / repliage de la liste d'infractions */}
              {hiddenInfractionsCount > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllInfractions(true);
                  }}
                  className="text-[10px] py-0 px-1.5 rounded-full border border-gray-300 bg-gray-100 text-gray-600 hover:bg-gray-200"
                  title="Afficher toutes les infractions"
                >
                  +{hiddenInfractionsCount} autre{hiddenInfractionsCount > 1 ? 's' : ''}
                </button>
              )}
              {showAllInfractions && infractionItems.length > INFRACTION_PREVIEW_LIMIT && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowAllInfractions(false);
                  }}
                  className="text-[10px] py-0 px-1.5 rounded-full border border-gray-300 bg-gray-100 text-gray-600 hover:bg-gray-200"
                  title="Réduire la liste"
                >
                  réduire
                </button>
              )}

              {/* Badge co-saisine : un seul badge selon qu'on est origine (a partagé)
                  ou destinataire (a reçu). On ne cumule jamais les deux. */}
              {enquete.contentieuxOrigine ? (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-700 border-amber-300">
                  <Link2 className="h-3 w-3 mr-0.5" />
                  Partagée · {enquete.contentieuxOrigine}
                </Badge>
              ) : enquete.sharedWith && enquete.sharedWith.length > 0 ? (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-purple-50 text-purple-700 border-purple-300">
                  <Link2 className="h-3 w-3 mr-0.5" />
                  Co-saisine
                </Badge>
              ) : null}
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
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onUnarchive} title="Désarchiver l'enquête">
        <RotateCcw className="h-3 w-3" />
      </Button>
    )}
    {onDelete && (
      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onDelete} title="Supprimer l'enquête">
        <Trash className="h-3 w-3" />
      </Button>
    )}
  </>
) : (
                <>
                  {onEdit && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onEdit?.(enquete.id)} title="Modifier l'enquête">
                      <Edit className="h-3 w-3" />
                    </Button>
                  )}
                  {onArchive && !hasResultat(contentieuxId, enquete.id) && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowArchiveModal(true)} title="Archiver / clôturer l'enquête">
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
                <div className={`text-xs ${hasCRDelayAlert && crDelayHighlight ? 'text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium' : 'text-gray-500'}`}>
                  Dernier CR: {new Date(lastCR.date).toLocaleDateString()} ({lastCR.enqueteur})
                </div>
              )}
            </div>

            {lastCR?.description && (
              <div
                className="mt-1.5 bg-gray-50/80 border border-gray-100 p-1.5 rounded-md text-[9px] text-gray-600 w-full"
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
          onPoseRequest(enquete.id, acte.id, type);
        } else if (acte.statut === 'en_cours' && onProlongationRequest) {
          onProlongationRequest(enquete.id, acte.id, type);
        } else if (acte.statut === 'prolongation_pending' && onValidateProlongationRequest) {
          onValidateProlongationRequest(enquete.id, acte.id, type);
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
          contentieuxId={contentieuxId}
          onArchive={onArchive}
          misEnCause={enquete.misEnCause}
          enqueteNumero={enquete.numero}
          enqueteTags={enquete.tags}
          enqueteInfractionCodes={enquete.infractionNatinfCodes}
          onCreateGlobalTodo={onCreateGlobalTodo}
          isOverboardPinned={!!(enquete.overboardPins && enquete.overboardPins.length > 0)}
        />
      )}

      <ViewAudienceResultModal
  isOpen={showAudienceResultModal}
  onClose={() => setShowAudienceResultModal(false)}
  enqueteId={enquete.id}
  contentieuxId={contentieuxId}
  isOverboardPinned={!!(enquete.overboardPins && enquete.overboardPins.length > 0)}
  misEnCause={enquete.misEnCause}
  enqueteTags={enquete.tags}
  enqueteInfractionCodes={enquete.infractionNatinfCodes}
  onReset={async () => {
    try {
      await deleteAudienceResultat(contentieuxId, enquete.id);
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
});