import React, { useState, useMemo } from 'react';
import { InstructionPreview } from '../InstructionPreview';
import { NewInstructionModal } from '../modals/NewInstructionModal';
import { InstructionDetailModal } from '../modals/InstructionDetailModal';
import { InstructionFilterBar } from '../InstructionFilterBar';
import { EnqueteInstruction, Tag } from '@/types/interfaces';
import { Button } from '../ui/button';
import { Plus, Filter, BarChart3 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface InstructionsPageProps {
  instructions: EnqueteInstruction[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onUpdateInstruction: (id: number, updates: Partial<EnqueteInstruction>) => void;
  onAddInstruction: (instruction: Omit<EnqueteInstruction, 'id' | 'dateCreation' | 'dateMiseAJour'>) => void;
  onDeleteInstruction: (id: number) => void;
}

export const InstructionsPage = ({
  instructions,
  searchTerm,
  onSearchChange,
  onUpdateInstruction,
  onAddInstruction,
  onDeleteInstruction
}: InstructionsPageProps) => {
  const { showToast } = useToast();

  // États
  const [selectedInstruction, setSelectedInstruction] = useState<EnqueteInstruction | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  
  // Filtres
  const [selectedCabinet, setSelectedCabinet] = useState<string>('');
  const [selectedEtat, setSelectedEtat] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [sortOrder, setSortOrder] = useState('date-desc');

  // Instructions filtrées et triées
  const filteredInstructions = useMemo(() => {
    let filtered = instructions;

    // Filtre par terme de recherche
    if (searchTerm) {
      filtered = filtered.filter(inst => 
        inst.numeroInstruction.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inst.numeroParquet.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inst.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inst.misEnCause.some(mec => mec.nom.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }

    // Filtre par cabinet
    if (selectedCabinet) {
      filtered = filtered.filter(inst => inst.cabinet === selectedCabinet);
    }

    // Filtre par état règlement
    if (selectedEtat) {
      filtered = filtered.filter(inst => inst.etatReglement === selectedEtat);
    }

    // Filtre par tags
    if (selectedTags.length > 0) {
      filtered = filtered.filter(inst => 
        selectedTags.some(tag => 
          inst.tags.some(instTag => instTag.id === tag.id)
        )
      );
    }

    // Tri
    filtered.sort((a, b) => {
      switch (sortOrder) {
        case 'date-desc':
          return new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime();
        case 'date-asc':
          return new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime();
        case 'cabinet-asc':
          return a.cabinet.localeCompare(b.cabinet);
        case 'etat-asc':
          return a.etatReglement.localeCompare(b.etatReglement);
        case 'numero-asc':
          return a.numeroInstruction.localeCompare(b.numeroInstruction);
        default:
          return 0;
      }
    });

    return filtered;
  }, [instructions, searchTerm, selectedCabinet, selectedEtat, selectedTags, sortOrder]);

  // Statistiques rapides
  const stats = useMemo(() => {
    const total = instructions.length;
    const parCabinet = {
      '1': instructions.filter(i => i.cabinet === '1').length,
      '2': instructions.filter(i => i.cabinet === '2').length,
      '3': instructions.filter(i => i.cabinet === '3').length,
      '4': instructions.filter(i => i.cabinet === '4').length
    };
    const parEtat = {
      instruction: instructions.filter(i => i.etatReglement === 'instruction').length,
      '175_rendu': instructions.filter(i => i.etatReglement === '175_rendu').length,
      'rd_fait': instructions.filter(i => i.etatReglement === 'rd_fait').length,
      'ordonnance_rendue': instructions.filter(i => i.etatReglement === 'ordonnance_rendue').length
    };
    const alertesDP = instructions.filter(i => 
      i.mesuresSurete?.dp?.alerteActive
    ).length;
    
    return { total, parCabinet, parEtat, alertesDP };
  }, [instructions]);

  // Handlers
  const handleAddInstruction = (instructionData: Omit<EnqueteInstruction, 'id' | 'dateCreation' | 'dateMiseAJour'>) => {
    onAddInstruction(instructionData);
    showToast('Dossier d\'instruction créé avec succès', 'success');
  };

  const handleTogglePriority = (instruction: EnqueteInstruction) => {
    const isPrioritaire = instruction.tags.some(tag => 
      tag.category === 'priorite' && tag.value === 'Prioritaire'
    );

    const newTags = isPrioritaire
      ? instruction.tags.filter(tag => !(tag.category === 'priorite' && tag.value === 'Prioritaire'))
      : [...instruction.tags, { id: 'prioritaire', value: 'Prioritaire', category: 'priorite' }];

    onUpdateInstruction(instruction.id, { tags: newTags });
    showToast(`Priorité ${isPrioritaire ? 'retirée' : 'ajoutée'}`, 'success');
  };

  const handleDeleteInstruction = (instruction: EnqueteInstruction) => {
    if (confirm(`Êtes-vous sûr de vouloir supprimer le dossier "${instruction.numeroInstruction}" ?`)) {
      onDeleteInstruction(instruction.id);
      showToast('Dossier supprimé avec succès', 'success');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header avec stats et actions */}
      <div className="flex-shrink-0 bg-white border-b p-4">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Instructions judiciaires</h1>
            <p className="text-sm text-gray-600">
              {stats.total} dossier{stats.total > 1 ? 's' : ''} • 
              {stats.alertesDP > 0 && (
                <span className="text-red-600 font-medium ml-1">
                  {stats.alertesDP} alerte{stats.alertesDP > 1 ? 's' : ''} DP
                </span>
              )}
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filtres
            </Button>
            
            <Button
              onClick={() => setShowNewModal(true)}
              className="bg-[#2B5746] hover:bg-[#1f3d2f] flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Nouveau dossier
            </Button>
          </div>
        </div>

        {/* Stats rapides */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-rose-50 p-3 rounded-lg border border-rose-200">
            <div className="text-lg font-semibold text-rose-700">{stats.parCabinet['1']}</div>
            <div className="text-sm text-rose-600">Cabinet 1</div>
          </div>
          <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
            <div className="text-lg font-semibold text-amber-700">{stats.parCabinet['2']}</div>
            <div className="text-sm text-amber-600">Cabinet 2</div>
          </div>
          <div className="bg-green-50 p-3 rounded-lg border border-green-200">
            <div className="text-lg font-semibold text-green-700">{stats.parCabinet['3']}</div>
            <div className="text-sm text-green-600">Cabinet 3</div>
          </div>
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="text-lg font-semibold text-blue-700">{stats.parCabinet['4']}</div>
            <div className="text-sm text-blue-600">Cabinet 4</div>
          </div>
        </div>

        {/* Barre de filtres */}
        {showFilters && (
          <InstructionFilterBar
            searchTerm={searchTerm}
            onSearchChange={onSearchChange}
            selectedCabinet={selectedCabinet}
            onCabinetChange={setSelectedCabinet}
            selectedEtat={selectedEtat}
            onEtatChange={setSelectedEtat}
            selectedTags={selectedTags}
            onTagSelect={(tag) => setSelectedTags([...selectedTags, tag])}
            onTagRemove={(tagId) => setSelectedTags(selectedTags.filter(t => t.id !== tagId))}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
          />
        )}
      </div>

      {/* Liste des instructions */}
      <div className="flex-1 overflow-auto p-6">
        {filteredInstructions.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredInstructions.map(instruction => (
              <InstructionPreview
                key={instruction.id}
                instruction={instruction}
                onView={() => {
                  setSelectedInstruction(instruction);
                  setIsEditing(false);
                }}
                onEdit={() => {
                  setSelectedInstruction(instruction);
                  setIsEditing(true);
                }}
                onDelete={() => handleDeleteInstruction(instruction)}
                onTogglePriority={() => handleTogglePriority(instruction)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <BarChart3 className="h-16 w-16 mb-4 text-gray-300" />
            <h3 className="text-lg font-medium mb-2">Aucun dossier d'instruction</h3>
            <p className="text-sm text-center max-w-md">
              {instructions.length === 0 
                ? "Commencez par créer votre premier dossier d'instruction"
                : "Aucun résultat ne correspond à vos critères de recherche"
              }
            </p>
            {instructions.length === 0 && (
              <Button
                onClick={() => setShowNewModal(true)}
                className="mt-4 bg-[#2B5746] hover:bg-[#1f3d2f]"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un dossier
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      <NewInstructionModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onSubmit={handleAddInstruction}
      />

      {selectedInstruction && (
        <InstructionDetailModal
          instruction={selectedInstruction}
          isEditing={isEditing}
          onClose={() => setSelectedInstruction(null)}
          onEdit={() => setIsEditing(!isEditing)}
          onUpdate={onUpdateInstruction}
          onDelete={() => handleDeleteInstruction(selectedInstruction)}
        />
      )}
    </div>
  );
};