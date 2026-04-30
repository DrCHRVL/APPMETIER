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
import { Trash2, Siren, FileText, Plus, Star, Gavel, Eye, EyeOff } from 'lucide-react';
import { UserManager } from '@/utils/userManager';
import { hasJldInvolvement } from '@/utils/permissions';
import { Badge } from '../ui/badge';
import { EnqueteHeader } from '../sections/EnqueteHeader';
import { CoSaisineSection } from '../sections/CoSaisineSection';
import { TransfertContentieuxSection } from '../sections/TransfertContentieuxSection';
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
}

export const EnqueteDetailModal = ({
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
}: EnqueteDetailModalProps) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClotureSummary, setShowClotureSummary] = useState(false);
  const [showSuiviAlert, setShowSuiviAlert] = useState(false);
  const [suiviAlertContext, setSuiviAlertContext] = useState<'dateOP' | 'archive' | 'audience'>('dateOP');
  const [localNumero, setLocalNumero] = useState(enquete.numero);
  const [unseenModifications, setUnseenModifications] = useState<ModificationEntry[]>([]);
  const [showModificationsPopup, setShowModificationsPopup] = useState(false);
  useEffect(() => { setLocalNumero(enquete.numero); }, [enquete.numero]);
  const { showToast } = useToast();
  const { user } = useUser();
  const markEnqueteAsSeen = useEnquetesStore(s => s.markEnqueteAsSeen);

  // Mode JLD : lecture stricte, pas de "À faire", CR éventuellement masqués.
  const isJldUser = user?.globalRole === 'jld';

  // Liste des utilisateurs JLD ayant accès à cette enquête (pour afficher le badge
  // « Visible par le JLD — XXX »). Un JLD voit l'enquête dès qu'une autorisation
  // ou prolongation a été enregistrée dans une géoloc/écoute.
  const jldViewers = useMemo(() => {
    if (!hasJldInvolvement(enquete)) return [] as { username: string; displayName: string }[];
    try {
      const all = UserManager.getInstance().getAllUsers();
      return all
        .filter(u => u.globalRole === 'jld' && u.approved !== false)
        .map(u => ({ username: u.windowsUsername, displayName: u.displayName }));
    } catch {
      return [];
    }
  }, [enquete]);

  const handleToggleHideCRsFromJld = useCallback(() => {
    const next = !enquete.hideCRsFromJld;
    onUpdate(enquete.id, { hideCRsFromJld: next });
    showToast(
      next ? 'Comptes rendus dissimulés au JLD' : 'Comptes rendus visibles par le JLD',
      'success'
    );
  }, [enquete.id, enquete.hideCRsFromJld, onUpdate, showToast]);

  const effectiveReadOnly = readOnly || isJldUser;
  const hideCRsForThisUser = isJldUser && !!enquete.hideCRsFromJld;

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
        <DialogContent className="max-w-6xl max-h-[90vh] bg-white overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
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
                    {jldViewers.map(v => (
                      <Badge
                        key={v.username}
                        variant="outline"
                        className="text-[10px] py-0 px-1.5 bg-orange-50 text-orange-700 border-orange-200"
                        title="Le juge des libertés et de la détention peut consulter cette enquête en lecture seule (lecture déclenchée par une autorisation ou prolongation enregistrée)"
                      >
                        <Gavel className="h-2.5 w-2.5 mr-1" />
                        Visible par le JLD — {v.displayName.toUpperCase()}
                      </Badge>
                    ))}
                  </DialogTitle>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Bascule "Dissimuler les CR au JLD" — visible uniquement si un JLD
                    a accès à cette enquête, et masquée pour le JLD lui-même. */}
                {!isJldUser && jldViewers.length > 0 && !isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-7 w-7 p-0 transition-colors ${
                      enquete.hideCRsFromJld ? 'text-red-500 hover:text-red-600' : 'text-gray-400 hover:text-gray-600'
                    }`}
                    onClick={handleToggleHideCRsFromJld}
                    title={enquete.hideCRsFromJld ? 'Rendre les CR visibles au JLD' : 'Dissimuler les CR au JLD'}
                  >
                    {enquete.hideCRsFromJld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                )}
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

          <div className="flex-1 overflow-auto px-6 py-2">
            <EnqueteHeader
              numero={enquete.numero}
              dateDebut={enquete.dateDebut}
              services={enquete.services}
              tags={enquete.tags}
              description={enquete.description}
              directeurEnquete={enquete.directeurEnquete}
              numeroParquet={enquete.numeroParquet}
              isEditing={isEditing}
              onUpdate={isEditing ? (updates) => debouncedOnUpdate(enquete.id, updates) : undefined}
              onUpdateImmediate={isEditing ? (updates) => handleUpdateImmediate(enquete.id, updates) : undefined}
            />

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-6">
                {!hideCRsForThisUser && (
                  <CompteRenduSection
                    enquete={enquete}
                    editingCR={editingCR}
                    onAddCR={onAddCR}
                    onUpdateCR={onUpdateCR}
                    onDeleteCR={onDeleteCR}
                    setEditingCR={setEditingCR}
                    isEditing={isEditing && !isJldUser}
                    contentieuxId={contentieuxId}
                  />
                )}

                <MisEnCauseSection
                  enquete={enquete}
                  onUpdate={handleUpdateWithToast}
                  isEditing={isEditing && !isJldUser}
                  allKnownMec={allKnownMec}
                />
              </div>

              <div className="space-y-6">
                {!isJldUser && (
                  <ToDoSection
                    enquete={enquete}
                    onUpdate={handleUpdateWithToast}
                    isEditing={isEditing}
                  />
                )}

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
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ClotureSummaryModal
        isOpen={showClotureSummary}
        onClose={() => setShowClotureSummary(false)}
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