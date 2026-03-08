import React, { useState } from 'react';
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
import { Trash2, Siren, FileText, Plus, X } from 'lucide-react';
import { EnqueteHeader } from '../sections/EnqueteHeader';
import { Label } from '../ui/label';
import { useToast } from '@/contexts/ToastContext';

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
  allKnownMec = []
}: EnqueteDetailModalProps) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClotureSummary, setShowClotureSummary] = useState(false);
  const [showDateOPEdit, setShowDateOPEdit] = useState(false);
  const { showToast } = useToast();

  const handleUpdateWithToast = (id: number, updates: Partial<Enquete>) => {
    onUpdate(id, updates);
    showToast('Modifications enregistrées', 'success');
  };
  
  const handleDelete = () => {
    if (onDelete) {
      onDelete(enquete.id);
      showToast('Enquête supprimée avec succès', 'success');
      onClose();
    }
  };

  return (
    <>
      <Dialog open={!!enquete} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] bg-white overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <div className="flex justify-between items-center">
              <div className="flex-1">
                {isEditing ? (
                  <Input
                    value={enquete.numero}
                    onChange={(e) => handleUpdateWithToast(enquete.id, { numero: e.target.value })}
                    className="text-base font-semibold w-64"
                    placeholder="Numéro d'enquête"
                  />
                ) : (
                  <DialogTitle className="text-base">
                    Enquête N° {enquete.numero}
                  </DialogTitle>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isEditing && onDelete && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button onClick={onEdit} size="sm" className="mr-12">
                  {isEditing ? 'Terminer' : 'Modifier'}
                </Button>
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
              onUpdate={isEditing ? (updates) => handleUpdateWithToast(enquete.id, updates) : undefined}
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
    </>
  );
};