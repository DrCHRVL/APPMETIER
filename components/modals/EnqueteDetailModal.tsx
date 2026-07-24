import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Enquete, CompteRendu, ModificationEntry, OPPhase } from '@/types/interfaces';
import { getOPPhases, getOPPhaseEndDate, nextOPPhaseId, OP_DEFAULT_DURATION_DAYS } from '@/utils/opPhases';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { useUser } from '@/contexts/UserContext';
import { getUnseenModifications } from '@/utils/modificationLogger';
import { ModificationsPopup } from './ModificationsPopup';
import { CompteRenduSection } from '../sections/CompteRenduSection';
import { GeolocSection } from '../sections/GeolocSection';
import { EcouteSection } from '../sections/EcouteSection';
import { ActeSection } from '../sections/ActeSection';
import { MisEnCauseSection } from '../sections/MisEnCauseSection';
import { DocumentsSection } from '../sections/DocumentsSection';
import { ToDoSection } from '../sections/ToDoSection';
import { SaisiesSection } from '../sections/SaisiesSection';
import { DeleteEnqueteModal } from './DeleteEnqueteModal';
import { ClotureSummaryModal } from './ClotureSummaryModal';
import { SasSummaryModal } from './SasSummaryModal';
import { Trash2, Siren, FileText, Plus, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '../ui/badge';
import { EnqueteHeader } from '../sections/EnqueteHeader';
import { CoSaisineSection } from '../sections/CoSaisineSection';
import { TransfertContentieuxSection } from '../sections/TransfertContentieuxSection';
import { ChronologieSection } from '../attache/ChronologieSection';
import { PropositionsBar } from '../attache/PropositionsBar';
import { FloatingDossierChat } from '../attache/FloatingDossierChat';
import { ProductionsSection } from '../attache/ProductionsSection';
import { Label } from '../ui/label';
import { useToast } from '@/contexts/ToastContext';
import { SuiviAlertModal } from './SuiviAlertModal';
import { ToDoItem } from '@/types/interfaces';

interface EnqueteDetailModalProps {
  enquete: Enquete;
  isEditing: boolean;
  editingCR: CompteRendu | null;
  onClose: () => void;
  onEdit: () => void;
  onUpdate: (id: number, updates: Partial<Enquete>) => void;
  onAddCR: (cr: Omit<CompteRendu, 'id'>) => void;
  onUpdateCR: (id: number, updates: Partial<CompteRendu>) => void;
  onDeleteCR: (id: number) => void;
  setEditingCR: (cr: CompteRendu | null) => void;
  onDelete?: (id: number) => void;
  /** Noms de tous les MEC connus (cross-dossiers) pour suggestions */
  allKnownMec?: string[];
  /** Callback pour créer un todo général (suivi JIRS/PG) */
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
  /** Si true, masque les boutons Modifier/Supprimer (mode consultation) */
  readOnly?: boolean;
  /** ID du contentieux courant (pour la co-saisine) */
  contentieuxId?: string;
  /** Callback pour partager l'enquête avec d'autres contentieux */
  onShareEnquete?: (enqueteId: number, targetContentieuxIds: string[]) => void;
  /** Callback pour retirer le partage */
  onUnshareEnquete?: (enqueteId: number) => void;
  /** Callback pour transférer l'enquête vers un autre contentieux */
  onTransferEnquete?: (enqueteId: number, targetContentieuxId: string) => Promise<boolean>;
  /** Si true, cette enquête provient d'un autre contentieux */
  isSharedEnquete?: boolean;
  /** Si true, le panneau « Attaché de justice » (chat) est ouvert à droite :
   *  on décale le modal vers la zone libre à gauche pour éviter la superposition. */
  attacheOpen?: boolean;
  /** Attaché IA disponible (sidecar configuré) : conditionne l'icône
   *  « Actualiser » de la description (admin uniquement). */
  attacheAvailable?: boolean;
}

const EnqueteDetailModalImpl = ({
  enquete,
  isEditing,
  editingCR,
  onClose,
  onEdit,
  onUpdate,
  onAddCR,
  onUpdateCR,
  onDeleteCR,
  setEditingCR,
  onDelete,
  allKnownMec = [],
  onCreateGlobalTodo,
  readOnly = false,
  contentieuxId,
  onShareEnquete,
  onUnshareEnquete,
  onTransferEnquete,
  isSharedEnquete = false,
  attacheOpen = false,
  attacheAvailable = false,
}: EnqueteDetailModalProps) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [descriptionRefreshing, setDescriptionRefreshing] = useState(false);
  const [showClotureSummary, setShowClotureSummary] = useState(false);
  const [showSasSummary, setShowSasSummary] = useState(false);
  const [showSuiviAlert, setShowSuiviAlert] = useState(false);
  const [suiviAlertContext, setSuiviAlertContext] = useState<'dateOP' | 'archive' | 'audience'>('dateOP');
  const [localNumero, setLocalNumero] = useState(enquete.numero);
  const [unseenModifications, setUnseenModifications] = useState<ModificationEntry[]>([]);
  const [showModificationsPopup, setShowModificationsPopup] = useState(false);
  useEffect(() => { setLocalNumero(enquete.numero); }, [enquete.numero]);
  const { showToast } = useToast();
  const { user, isAdmin } = useUser();
  const markEnqueteAsSeen = useEnquetesStore(s => s.markEnqueteAsSeen);

  const effectiveReadOnly = readOnly;

  // À l'ouverture (changement d'id d'enquête) : capturer les modifications non vues
  // PUIS marquer comme vu. La capture utilise l'enquête avant le mark, donc le
  // popup reste cohérent même si le state se met à jour ensuite.
  useEffect(() => {
    if (!user) return;
    const unseen = getUnseenModifications(enquete, user.windowsUsername);
    if (unseen.length > 0) {
      setUnseenModifications(unseen);
      setShowModificationsPopup(true);
    }
    markEnqueteAsSeen(enquete.id);
    // On ne se ré-exécute pas quand `enquete` change par effet de bord (mark as seen,
    // édition en cours…) : seulement quand on switch d'enquête.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquete.id]);

  const hasSuiviRef = useRef(enquete.tags.some(t => t.category === 'suivi'));
  hasSuiviRef.current = enquete.tags.some(t => t.category === 'suivi');

  // Pour les actions discrètes (clics, validation, ajout/suppression) : propagation immédiate + toast
  const handleUpdateImmediate = useCallback((id: number, updates: Partial<Enquete>) => {
    onUpdate(id, updates);
    showToast('Modifications enregistrées', 'success');
    if ((updates.dateOP || updates.opPhases) && hasSuiviRef.current) {
      setSuiviAlertContext('dateOP');
      setShowSuiviAlert(true);
    }
  }, [onUpdate, showToast]);

  // Actualisation « à la demande » de la description par l'attaché IA (icône à
  // côté du titre Description). Le run est court et awaité côté service ; au
  // retour, on tire le coffre serveur (syncAndRefresh) pour afficher la nouvelle
  // synthèse tout de suite. Elle se rafraîchit aussi TOUTE SEULE en arrière-plan
  // à chaque CR/acte téléversé — ce bouton ne fait qu'accélérer.
  const handleRefreshDescription = useCallback(async () => {
    if (descriptionRefreshing) return;
    setDescriptionRefreshing(true);
    try {
      const res = await fetch('/api/attache/actualiser-description', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: enquete.numero }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 || data.running) {
        showToast('Une actualisation est déjà en cours — réessayez dans un instant.', 'info');
      } else if (res.ok && data.ok) {
        await useEnquetesStore.getState().syncAndRefresh().catch(() => {});
        showToast('Description actualisée', 'success');
      } else {
        showToast(data.error || 'Actualisation impossible pour le moment', 'error');
      }
    } catch {
      showToast('Service de l\'attaché indisponible', 'error');
    } finally {
      setDescriptionRefreshing(false);
    }
  }, [descriptionRefreshing, enquete.numero, showToast]);

  // Met à jour les phases d'OP (et synchronise `dateOP` legacy avec la 1re phase
  // pour que les consommateurs non encore migrés continuent de fonctionner).
  const updateOPPhases = useCallback((phases: OPPhase[]) => {
    const sorted = [...phases].sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
    handleUpdateImmediate(enquete.id, {
      opPhases: sorted.length > 0 ? sorted : undefined,
      dateOP: sorted[0]?.dateDebut,
    });
  }, [enquete.id, handleUpdateImmediate]);

  const opPhases = useMemo(() => getOPPhases(enquete), [enquete]);

  const handleAddOPPhase = useCallback(() => {
    const id = nextOPPhaseId(enquete.opPhases);
    const today = new Date().toISOString().slice(0, 10);
    updateOPPhases([...opPhases, { id, dateDebut: today }]);
  }, [enquete.opPhases, opPhases, updateOPPhases]);

  const handleUpdateOPPhase = useCallback((id: number, updates: Partial<OPPhase>) => {
    const next = opPhases.map(p => (p.id === id ? { ...p, ...updates } : p));
    updateOPPhases(next);
  }, [opPhases, updateOPPhases]);

  const handleRemoveOPPhase = useCallback((id: number) => {
    updateOPPhases(opPhases.filter(p => p.id !== id));
  }, [opPhases, updateOPPhases]);

  // Pour la saisie texte : propagation déboncée (400ms), PAS de toast par frappe
  const debouncedOnUpdate = useDebouncedCallback(
    (id: number, updates: Partial<Enquete>) => {
      onUpdate(id, updates);
    },
    400
  );

  // Flush des écritures en attente quand on change d'enquête : évite que les frappes
  // sur l'enquête A soient écrites sur l'enquête B après un switch rapide.
  useEffect(() => {
    return () => {
      debouncedOnUpdate.flush();
    };
  }, [enquete.id, debouncedOnUpdate]);

  // Fermeture : flush le debounce pour ne pas perdre la dernière frappe.
  const handleClose = useCallback(() => {
    debouncedOnUpdate.flush();
    onClose();
  }, [debouncedOnUpdate, onClose]);

  // Rétro-compatibilité : alias pour les anciens appels
  const handleUpdateWithToast = handleUpdateImmediate;

  // Bouton flottant de défilement rapide (mobile) : permet d'atteindre le bas
  // d'un long dossier d'un seul geste, puis de remonter en tête (comme les
  // discussions claude.ai). On bascule la direction selon la position de scroll.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollDir, setScrollDir] = useState<'down' | 'up' | null>(null);

  const updateScrollAffordance = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distanceToBottom = scrollHeight - clientHeight - scrollTop;
    // Rien à faire si le contenu tient dans l'écran.
    if (scrollHeight - clientHeight < 200) { setScrollDir(null); return; }
    if (distanceToBottom > 120) setScrollDir('down');
    else if (scrollTop > 120) setScrollDir('up');
    else setScrollDir(null);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Recalcul initial (et après chargement asynchrone des sections) + à chaque
    // changement d'enquête, le contenu — donc la hauteur défilable — variant.
    updateScrollAffordance();
    const t = setTimeout(updateScrollAffordance, 300);
    el.addEventListener('scroll', updateScrollAffordance, { passive: true });
    window.addEventListener('resize', updateScrollAffordance);
    return () => {
      clearTimeout(t);
      el.removeEventListener('scroll', updateScrollAffordance);
      window.removeEventListener('resize', updateScrollAffordance);
    };
  }, [updateScrollAffordance, enquete.id]);

  const handleScrollJump = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: scrollDir === 'down' ? el.scrollHeight : 0,
      behavior: 'smooth',
    });
  }, [scrollDir]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(enquete.id);
      showToast('Enquête supprimée avec succès', 'success');
      onClose();
    }
  }, [onDelete, enquete.id, showToast, onClose]);

  return (
    <>
      <Dialog open={!!enquete} onOpenChange={handleClose}>
        <DialogContent
          className={`max-w-6xl max-h-[90vh] bg-white overflow-hidden flex flex-col max-sm:left-0 max-sm:right-0 max-sm:top-[env(safe-area-inset-top)] max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-w-full max-sm:max-h-none max-sm:rounded-none max-sm:border-0 max-sm:p-0 lg:transition-[left,max-width] lg:duration-200 ${
            // Chat « Attaché » ouvert : le drawer (440px) est fixé à droite. Sur
            // écran large, on recentre le modal dans l'espace restant à gauche
            // (décalage du centre de 220px + largeur plafonnée) au lieu de le
            // laisser centré sous le panneau.
            attacheOpen
              ? 'lg:left-[calc(50%-13.75rem)] lg:max-w-[min(72rem,calc(100vw-29.5rem))]'
              : ''
          }`}
        >
          <DialogHeader className="flex-shrink-0 max-sm:px-4 max-sm:pt-2">
            <div className="flex justify-between items-center">
              <div className="flex-1">
                {isEditing ? (
                  <Input
                    value={localNumero}
                    onChange={(e) => {
                      setLocalNumero(e.target.value);
                      debouncedOnUpdate(enquete.id, { numero: e.target.value });
                    }}
                    className="text-base font-semibold w-64"
                    placeholder="Numéro d'enquête"
                  />
                ) : (
                  <DialogTitle className="text-base flex flex-wrap items-center gap-2">
                    Enquête N° {enquete.numero}
                    {enquete.overboardPins && enquete.overboardPins.length > 0 && (
                      enquete.overboardPins.map(pin => (
                        <Badge
                          key={pin.pinnedBy}
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 bg-amber-50 text-amber-700 border-amber-200"
                        >
                          <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500 mr-1" />
                          Suivi hiérarchique — {pin.pinnedBy.toUpperCase()}
                        </Badge>
                      ))
                    )}
                  </DialogTitle>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isEditing && onDelete && !effectiveReadOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {!effectiveReadOnly && (
                  <Button onClick={onEdit} size="sm" className="mr-12">
                    {isEditing ? 'Terminer' : 'Modifier'}
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <div ref={scrollContainerRef} className="flex-1 overflow-auto px-6 py-2 max-sm:px-3" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <EnqueteHeader
              numero={enquete.numero}
              dateDebut={enquete.dateDebut}
              services={enquete.services}
              tags={enquete.tags}
              infractionNatinfCodes={enquete.infractionNatinfCodes}
              description={enquete.description}
              directeurEnquete={enquete.directeurEnquete}
              numeroParquet={enquete.numeroParquet}
              numeroIDJ={enquete.numeroIDJ}
              isEditing={isEditing}
              onUpdate={isEditing ? (updates) => debouncedOnUpdate(enquete.id, updates) : undefined}
              onUpdateImmediate={isEditing ? (updates) => handleUpdateImmediate(enquete.id, updates) : undefined}
              onRefreshDescription={attacheAvailable && isAdmin() && !isEditing ? handleRefreshDescription : undefined}
              descriptionRefreshing={descriptionRefreshing}
            />

            {/* Propositions de l'attaché en attente (✓/✗) + chronologie
                probatoire — admin uniquement, auto-masquées sinon. */}
            {isAdmin() && <PropositionsBar numero={enquete.numero} />}
            {isAdmin() && (
              <ProductionsSection
                numero={enquete.numero}
                service={enquete.tags?.find((t) => t.category === 'services')?.value
                  || enquete.services?.find((s) => s && s.trim())}
              />
            )}
            {isAdmin() && <ChronologieSection numero={enquete.numero} />}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-6">
                <CompteRenduSection
                  enquete={enquete}
                  editingCR={editingCR}
                  onAddCR={onAddCR}
                  onUpdateCR={onUpdateCR}
                  onDeleteCR={onDeleteCR}
                  setEditingCR={setEditingCR}
                  isEditing={isEditing}
                  contentieuxId={contentieuxId}
                />

                <MisEnCauseSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing}
                  allKnownMec={allKnownMec}
                />
              </div>

              <div className="space-y-6">
                <ToDoSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing}
                />

                {/* Dates d'OP — supporte plusieurs phases d'interpellation */}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <Siren className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      <h3 className="text-sm font-semibold">
                        {opPhases.length > 1 ? "Dates d'OP" : "Date d'OP"}
                      </h3>
                      {opPhases.length === 0 && (
                        <span className="text-xs text-gray-400 italic ml-1">— Non planifiée</span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title={opPhases.length === 0 ? "Planifier une date d'OP" : "Ajouter une phase d'OP"}
                      onClick={handleAddOPPhase}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {opPhases.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {opPhases.map((phase, idx) => {
                        const fallbackEnd = getOPPhaseEndDate({ ...phase, dateFin: undefined });
                        const fallbackEndIso = fallbackEnd.toISOString().slice(0, 10);
                        return (
                          <div key={phase.id} className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded p-2">
                            {opPhases.length > 1 && (
                              <span className="text-[10px] font-semibold text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">
                                Phase {idx + 1}
                              </span>
                            )}
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-gray-600">Début</Label>
                              <Input
                                type="date"
                                value={phase.dateDebut}
                                className="h-7 text-sm w-[140px]"
                                onChange={(e) => {
                                  if (e.target.value) handleUpdateOPPhase(phase.id, { dateDebut: e.target.value });
                                }}
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <Label className="text-xs text-gray-600">Fin</Label>
                              <Input
                                type="date"
                                value={phase.dateFin || ''}
                                placeholder={fallbackEndIso}
                                title={`Si vide : application du délai habituel de ${OP_DEFAULT_DURATION_DAYS * 24}h (jusqu'au ${fallbackEnd.toLocaleDateString('fr-FR')})`}
                                className="h-7 text-sm w-[140px]"
                                onChange={(e) => handleUpdateOPPhase(phase.id, { dateFin: e.target.value || undefined })}
                              />
                              {!phase.dateFin && (
                                <span className="text-[10px] text-gray-500 italic">
                                  défaut {OP_DEFAULT_DURATION_DAYS * 24}h
                                </span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-gray-400 hover:text-red-500 ml-auto"
                              title="Supprimer cette phase"
                              onClick={() => handleRemoveOPPhase(phase.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Co-saisine */}
                {contentieuxId && onShareEnquete && onUnshareEnquete && (
                  <CoSaisineSection
                    enquete={enquete}
                    isEditing={isEditing}
                    currentContentieuxId={contentieuxId}
                    onShare={onShareEnquete}
                    onUnshare={onUnshareEnquete}
                    isShared={isSharedEnquete}
                  />
                )}

                {/* Transfert vers un autre contentieux */}
                {contentieuxId && onTransferEnquete && !isSharedEnquete && (
                  <TransfertContentieuxSection
                    enquete={enquete}
                    isEditing={isEditing}
                    currentContentieuxId={contentieuxId}
                    isShared={isSharedEnquete}
                    onTransfer={onTransferEnquete}
                  />
                )}

                <GeolocSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing}
                />

                <EcouteSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing}
                />

                <ActeSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing}
                />

                <DocumentsSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing}
                />

                <SaisiesSection
                  enqueteId={enquete.id}
                  contentieuxId={enquete.contentieuxOrigine || contentieuxId || 'crimorg'}
                  readOnly={effectiveReadOnly}
                />

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-gray-600 border-gray-300 hover:bg-gray-50"
                  onClick={() => setShowClotureSummary(true)}
                >
                  <FileText className="h-4 w-4" />
                  Générer récapitulatif de clôture
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 text-gray-600 border-gray-300 hover:bg-gray-50"
                  onClick={() => setShowSasSummary(true)}
                >
                  <FileText className="h-4 w-4" />
                  Générer le SAS (article 80-5 CPP)
                </Button>
              </div>
            </div>
          </div>

          {/* Bouton flottant de défilement rapide (mobile uniquement) */}
          {scrollDir && (
            <button
              type="button"
              onClick={handleScrollJump}
              aria-label={scrollDir === 'down' ? 'Aller en bas de la page' : 'Remonter en haut'}
              className="sm:hidden absolute right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg active:bg-emerald-700 transition-colors"
              style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            >
              {scrollDir === 'down'
                ? <ChevronDown className="h-6 w-6" />
                : <ChevronUp className="h-6 w-6" />}
            </button>
          )}

          {/* Chat flottant de l'attaché sur ce dossier — admin uniquement, déplaçable,
              toujours accessible (même pendant la rédaction d'un CR). DANS le contenu
              de la Dialog : Radix (modale) rend inerte tout ce qui vit dehors —
              une bulle montée à l'extérieur serait visible mais insensible au clic. */}
          {isAdmin() && (
            <FloatingDossierChat
              numero={enquete.numero}
              cadre={enquete.statut === 'instruction' ? 'instruction' : 'preliminaire'}
              label={enquete.numero}
              inDialog
            />
          )}
        </DialogContent>
      </Dialog>

      <ClotureSummaryModal
        isOpen={showClotureSummary}
        onClose={() => setShowClotureSummary(false)}
        enquete={enquete}
      />

      <SasSummaryModal
        isOpen={showSasSummary}
        onClose={() => setShowSasSummary(false)}
        enquete={enquete}
      />

      <DeleteEnqueteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        enqueteNumero={enquete.numero}
      />

      <SuiviAlertModal
        isOpen={showSuiviAlert}
        onClose={() => setShowSuiviAlert(false)}
        enqueteNumero={enquete.numero}
        enqueteTags={enquete.tags}
        triggerContext={suiviAlertContext}
        onCreateTodo={onCreateGlobalTodo}
      />

      <ModificationsPopup
        isOpen={showModificationsPopup}
        onClose={() => setShowModificationsPopup(false)}
        modifications={unseenModifications}
        enqueteNumero={enquete.numero}
      />

    </>
  );
};

export const EnqueteDetailModal = React.memo(EnqueteDetailModalImpl, (a, b) =>
  a.enquete === b.enquete &&
  a.editingCR === b.editingCR &&
  a.isEditing === b.isEditing &&
  a.contentieuxId === b.contentieuxId &&
  a.readOnly === b.readOnly &&
  a.isSharedEnquete === b.isSharedEnquete &&
  a.attacheOpen === b.attacheOpen &&
  a.attacheAvailable === b.attacheAvailable &&
  a.allKnownMec === b.allKnownMec &&
  a.onClose === b.onClose &&
  a.onEdit === b.onEdit &&
  a.onUpdate === b.onUpdate &&
  a.onAddCR === b.onAddCR &&
  a.onUpdateCR === b.onUpdateCR &&
  a.onDeleteCR === b.onDeleteCR &&
  a.setEditingCR === b.setEditingCR &&
  a.onDelete === b.onDelete &&
  a.onCreateGlobalTodo === b.onCreateGlobalTodo &&
  a.onShareEnquete === b.onShareEnquete &&
  a.onUnshareEnquete === b.onUnshareEnquete &&
  a.onTransferEnquete === b.onTransferEnquete
);