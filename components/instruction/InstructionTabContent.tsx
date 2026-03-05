import React, { memo, useMemo, Suspense, lazy } from 'react';
import { EnqueteInstruction, CompteRendu } from '@/types/interfaces';
import { Loader } from 'lucide-react';

// Lazy loading des composants lourds
const MesuresSureteSection = lazy(() => import('../instruction/MesuresSureteSection'));
const DocumentsSection = lazy(() => import('../sections/DocumentsSection'));

interface InstructionTabContentProps {
  activeTab: 'general' | 'mesures' | 'documents';
  instruction: EnqueteInstruction;
  isEditing: boolean;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => boolean;
  refreshKey: number;
  // Props pour l'onglet général
  editingCR: CompteRendu | null;
  setEditingCR: (cr: CompteRendu | null) => void;
  crActions: {
    add: (cr: Omit<CompteRendu, 'id'>) => boolean;
    update: (crId: number, updates: Partial<CompteRendu>) => boolean;
    delete: (crId: number) => boolean;
  };
}

// Composant de loading
const LoadingSpinner = () => (
  <div className="flex items-center justify-center py-8">
    <Loader className="h-6 w-6 animate-spin text-gray-400" />
    <span className="ml-2 text-sm text-gray-500">Chargement...</span>
  </div>
);

// Composant pour l'onglet général (toujours chargé)
const GeneralTabContent = memo(({ 
  instruction, 
  isEditing, 
  onUpdate, 
  editingCR, 
  setEditingCR, 
  crActions,
  refreshKey 
}: {
  instruction: EnqueteInstruction;
  isEditing: boolean;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => boolean;
  editingCR: CompteRendu | null;
  setEditingCR: (cr: CompteRendu | null) => void;
  crActions: any;
  refreshKey: number;
}) => {
  // Import statique pour l'onglet principal
  const CompteRenduSection = lazy(() => import('../sections/CompteRenduSection'));
  const InstructionTimeline = lazy(() => import('../instruction/InstructionTimeline'));
  const OPManager = lazy(() => import('../instruction/OPManager'));
  const RDSection = lazy(() => import('../instruction/RDSection'));

  return (
    <div className="p-6" key={`general-${refreshKey}`}>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-6">
          {/* Timeline procédurale EN HAUT */}
          <Suspense fallback={<LoadingSpinner />}>
            <InstructionTimeline
              instruction={instruction}
              onUpdate={onUpdate}
              isEditing={isEditing}
            />
          </Suspense>

          <Suspense fallback={<LoadingSpinner />}>
            <CompteRenduSection
              enquete={instruction}
              editingCR={editingCR}
              onAddCR={crActions.add}
              onUpdateCR={crActions.update}
              onDeleteCR={crActions.delete}
              setEditingCR={setEditingCR}
              isEditing={isEditing}
            />
          </Suspense>
        </div>

        <div className="space-y-6">
          {/* Gestion OP */}
          <Suspense fallback={<LoadingSpinner />}>
            <OPManager
              instruction={instruction}
              onUpdate={onUpdate}
              isEditing={isEditing}
            />
          </Suspense>

          {/* Section RD et rapports */}
          <Suspense fallback={<LoadingSpinner />}>
            <RDSection
              instruction={instruction}
              onUpdate={onUpdate}
              isEditing={isEditing}
            />
          </Suspense>
        </div>
      </div>
      
      {/* Date de dernière mise à jour en bas */}
      <div className="mt-8 pt-4 border-t text-center">
        <p className="text-xs text-gray-500">
          Dernière mise à jour: {new Date(instruction.dateMiseAJour).toLocaleDateString()} à {new Date(instruction.dateMiseAJour).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
});

GeneralTabContent.displayName = 'GeneralTabContent';

// Composant principal avec optimisation de rendu
export const InstructionTabContent = memo(({
  activeTab,
  instruction,
  isEditing,
  onUpdate,
  refreshKey,
  editingCR,
  setEditingCR,
  crActions
}: InstructionTabContentProps) => {
  
  // Mémoriser le contenu de chaque onglet pour éviter les re-renders inutiles
  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'general':
        return (
          <GeneralTabContent
            instruction={instruction}
            isEditing={isEditing}
            onUpdate={onUpdate}
            editingCR={editingCR}
            setEditingCR={setEditingCR}
            crActions={crActions}
            refreshKey={refreshKey}
          />
        );

      case 'mesures':
        return (
          <div className="p-6" key={`mesures-${refreshKey}`}>
            <Suspense fallback={<LoadingSpinner />}>
              <MesuresSureteSection
                instruction={instruction}
                onUpdate={onUpdate}
                isEditing={isEditing}
              />
            </Suspense>
          </div>
        );

      case 'documents':
        return (
          <div className="p-6" key={`documents-${refreshKey}`}>
            <Suspense fallback={<LoadingSpinner />}>
              <DocumentsSection
                enquete={instruction}
                onUpdate={onUpdate}
                isEditing={isEditing}
              />
            </Suspense>
          </div>
        );

      default:
        return (
          <div className="p-6 text-center text-gray-500">
            Onglet non reconnu
          </div>
        );
    }
  }, [activeTab, instruction, isEditing, onUpdate, refreshKey, editingCR, setEditingCR, crActions]);

  return (
    <div className="flex-1 overflow-auto">
      {tabContent}
    </div>
  );
});

InstructionTabContent.displayName = 'InstructionTabContent';