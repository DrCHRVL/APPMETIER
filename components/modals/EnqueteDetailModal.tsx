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
import { Trash2, Siren } from 'lucide-react';
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
  onDelete
}: EnqueteDetailModalProps) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
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
                  <div className="flex items-center gap-2 mb-1">
                    <Siren className="h-4 w-4 text-orange-500" />
                    <h3 className="text-sm font-semibold">Date d'OP</h3>
                  </div>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={enquete.dateOP || ''}
                      onChange={(e) => handleUpdateWithToast(enquete.id, { dateOP: e.target.value || undefined })}
                      className="h-7 text-sm"
                    />
                  ) : enquete.dateOP ? (
                    <p className="text-sm font-medium text-orange-700">
                      {new Date(enquete.dateOP).toLocaleDateString()}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Non planifiée</p>
                  )}
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
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteEnqueteModal 
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        enqueteNumero={enquete.numero}
      />
    </>
  );
};