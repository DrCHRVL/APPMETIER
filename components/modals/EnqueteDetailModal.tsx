import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Enquete, CompteRendu } from '@/types/interfaces';
import { CompteRenduSection } from '../sections/CompteRenduSection';
import { GeolocSection } from '../sections/GeolocSection';
import { EcouteSection } from '../sections/EcouteSection';
import { ActeSection } from '../sections/ActeSection';
import { MisEnCauseSection } from '../sections/MisEnCauseSection';
import { DocumentsSection } from '../sections/DocumentsSection';
import { ToDoSection } from '../sections/ToDoSection';
import { DeleteEnqueteModal } from './DeleteEnqueteModal';
import { ClotureSummaryModal } from './ClotureSummaryModal';
import { Trash2, Siren, FileText, Plus, X, Star } from 'lucide-react';
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
  const [showDateOPEdit, setShowDateOPEdit] = useState(false);
  const [showSuiviAlert, setShowSuiviAlert] = useState(false);
  const [suiviAlertContext, setSuiviAlertContext] = useState<'dateOP' | 'archive' | 'audience'>('dateOP');
  const [localNumero, setLocalNumero] = useState(enquete.numero);
  useEffect(() => { setLocalNumero(enquete.numero); }, [enquete.numero]);
  const { showToast } = useToast();

  const hasSuiviRef = useRef(enquete.tags.some(t => t.category === 'suivi'));
  hasSuiviRef.current = enquete.tags.some(t => t.category === 'suivi');

  // Pour les actions discrètes (clics, validation, ajout/suppression) : propagation immédiate + toast
  const handleUpdateImmediate = useCallback((id: number, updates: Partial<Enquete>) => {
    onUpdate(id, updates);
    showToast('Modifications enregistrées', 'success');
    if (updates.dateOP && hasSuiviRef.current) {
      setSuiviAlertContext('dateOP');
      setShowSuiviAlert(true);
    }
  }, [onUpdate, showToast]);

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
                  <DialogTitle className="text-base flex items-center gap-2">
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
                {isEditing && onDelete && !readOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {!readOnly && (
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

                {/* Date d'OP */}
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <Siren className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      {!showDateOPEdit && !isEditing ? (
                        enquete.dateOP ? (
                          <span className="text-sm">
                            <span className="font-semibold">Date d'OP :</span>{' '}
                            <span className="font-medium text-orange-700">
                              {new Date(enquete.dateOP).toLocaleDateString('fr-FR')}
                            </span>
                          </span>
                        ) : (
                          <>
                            <span className="text-sm font-semibold">Date d'OP</span>
                            <span className="text-xs text-gray-400 italic ml-1">— Non planifiée</span>
                          </>
                        )
                      ) : (
                        <h3 className="text-sm font-semibold">Date d'OP</h3>
                      )}
                    </div>
                    {!showDateOPEdit && !isEditing && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        title={enquete.dateOP ? "Modifier la date d'OP" : "Planifier une date d'OP"}
                        onClick={() => setShowDateOPEdit(true)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={enquete.dateOP || ''}
                      onChange={(e) => handleUpdateWithToast(enquete.id, { dateOP: e.target.value || undefined })}
                      className="h-7 text-sm mt-2"
                    />
                  ) : showDateOPEdit ? (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        type="date"
                        defaultValue={enquete.dateOP || ''}
                        className="h-7 text-sm flex-1"
                        autoFocus
                        onBlur={(e) => {
                          if (e.target.value) {
                            handleUpdateWithToast(enquete.id, { dateOP: e.target.value });
                          }
                          setShowDateOPEdit(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setShowDateOPEdit(false);
                          }
                          if (e.key === 'Enter') {
                            const input = e.currentTarget as HTMLInputElement;
                            if (input.value) handleUpdateWithToast(enquete.id, { dateOP: input.value });
                            setShowDateOPEdit(false);
                          }
                        }}
                      />
                      {enquete.dateOP && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
                          title="Supprimer la date d'OP"
                          onClick={() => {
                            handleUpdateWithToast(enquete.id, { dateOP: undefined });
                            setShowDateOPEdit(false);
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400"
                        title="Annuler"
                        onClick={() => setShowDateOPEdit(false)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : null}
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
    </>
  );
};