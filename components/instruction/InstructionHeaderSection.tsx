import React from 'react';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select } from '../ui/select';
import { Plus, Minus } from 'lucide-react';
import { EnqueteInstruction, CABINET_COLORS } from '@/types/interfaces';
import { MisEnExamenCard } from './MisEnExamenCard';
import { InstructionWidgets } from '../instruction/InstructionWidgets';

interface InstructionHeaderSectionProps {
  instruction: EnqueteInstruction;
  isEditing: boolean;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => boolean;
  onShowAddMexModal: () => void;
  mexActions: {
    update: (mexId: number, updates: Partial<any>) => boolean;
    delete: (mexId: number) => boolean;
  };
  getUrgencyLevel: (dateFinDP: string) => 'expired' | 'critical' | 'warning' | 'normal';
  refreshKey: number;
  onShowDMLModal: () => void;
  onShowDebatModal: (type: 'placement_dp' | 'prolongation_dp') => void;
}

export const InstructionHeaderSection = ({
  instruction,
  isEditing,
  onUpdate,
  onShowAddMexModal,
  mexActions,
  getUrgencyLevel,
  refreshKey,
  onShowDMLModal,
  onShowDebatModal
}: InstructionHeaderSectionProps) => {

  // Gestion compteur côtes
  const handleCotesChange = (increment: boolean) => {
    const newValue = Math.max(0, instruction.cotesTomes + (increment ? 1 : -1));
    onUpdate(instruction.id, { cotesTomes: newValue });
  };

  // Couleur du cabinet pour l'header
  const cabinetColorClass = instruction?.cabinet && CABINET_COLORS 
    ? (CABINET_COLORS[instruction.cabinet] || 'bg-white')
    : 'bg-white';

  return (
    <div className={`flex-shrink-0 rounded-t-lg ${cabinetColorClass} border-b-2`}>
      <div className="flex justify-between items-center p-4">
        {/* Section principale - informations du dossier */}
        <div className="flex-1">
          {isEditing ? (
            <div className="space-y-2">
              {/* Première ligne : Numéros et cabinet */}
              <div className="flex gap-2 items-center">
                <Input
                  value={instruction.numeroInstruction || ''}
                  onChange={(e) => onUpdate(instruction.id, { numeroInstruction: e.target.value })}
                  className="text-lg font-semibold w-48 bg-white"
                  placeholder="Numéro instruction"
                />
                <Input
                  value={instruction.numeroParquet || ''}
                  onChange={(e) => onUpdate(instruction.id, { numeroParquet: e.target.value })}
                  className="text-base w-40 bg-white"
                  placeholder="Numéro parquet"
                />
                <select
                  value={instruction.cabinet || '1'}
                  onChange={(e) => onUpdate(instruction.id, { cabinet: e.target.value as any })}
                  className="text-sm border rounded px-2 py-1 bg-white"
                >
                  <option value="1">Cabinet 1</option>
                  <option value="2">Cabinet 2</option>
                  <option value="3">Cabinet 3</option>
                  <option value="4">Cabinet 4</option>
                </select>
              </div>
              
              {/* Deuxième ligne : Infos complémentaires */}
              <div className="flex gap-2 items-center">
                <select
                  value={instruction.origineEnquete || 'preliminaire'}
                  onChange={(e) => onUpdate(instruction.id, { origineEnquete: e.target.value as any })}
                  className="text-sm border rounded px-2 py-1 bg-white"
                >
                  <option value="preliminaire">Préliminaire</option>
                  <option value="flagrance">Flagrance</option>
                </select>
                
                <Input
                  value={instruction.serviceEnqueteur || ''}
                  onChange={(e) => onUpdate(instruction.id, { serviceEnqueteur: e.target.value })}
                  className="text-sm w-32 bg-white"
                  placeholder="Service"
                />
                
                <Input
                  type="date"
                  value={instruction.dateDebut || ''}
                  onChange={(e) => onUpdate(instruction.id, { dateDebut: e.target.value })}
                  className="text-sm w-36 bg-white"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">
                  {instruction.numeroInstruction || 'Numéro manquant'}
                </h2>
                <span className="text-sm text-gray-600">
                  Parquet: {instruction.numeroParquet || 'Non défini'}
                </span>
                <Badge variant="outline" className="text-xs">
                  Cabinet {instruction.cabinet || '?'}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-600">
                <span>Origine: {instruction.origineEnquete === 'flagrance' ? 'Flagrance' : 'Préliminaire'}</span>
                <span>Service: {instruction.serviceEnqueteur || 'Non défini'}</span>
                <span>Ouvert le: {new Date(instruction.dateDebut).toLocaleDateString()}</span>
              </div>
            </div>
          )}

          {/* Section Mis en examen - ACTUALISÉE EN TEMPS RÉEL */}
          <div className="mt-3 flex flex-col gap-2" key={`misEnExamen-${refreshKey}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 font-medium">
                Mis en examen ({instruction.misEnExamen?.length || 0}):
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onShowAddMexModal}
                className="h-5 w-5 p-0 text-green-600 hover:text-green-700"
                title="Ajouter mis en examen"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            
            <div className="max-h-40 overflow-auto bg-gray-50 rounded p-2">
              {(!instruction.misEnExamen || instruction.misEnExamen.length === 0) ? (
                <span className="text-xs text-gray-400 italic">Aucun mis en examen</span>
              ) : (
                <div className="space-y-2">
                  {instruction.misEnExamen.map(mex => (
                    <MisEnExamenCard
                      key={`${mex.id}-${refreshKey}`}
                      mex={mex}
                      isGlobalEditing={isEditing}
                      onUpdate={mexActions.update}
                      onDelete={mexActions.delete}
                      getUrgencyLevel={getUrgencyLevel}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section droite - Widgets et actions */}
        <div className="flex items-center gap-4" key={`widgets-${refreshKey}`}>
          {/* Utilisation du composant InstructionWidgets existant */}
          <InstructionWidgets
            instruction={instruction}
            onUpdate={onUpdate}
            isEditing={isEditing}
            onShowDMLModal={onShowDMLModal}
            onShowDebatModal={onShowDebatModal}
          />

          {/* Compteur côtes avec actualisation immédiate */}
          <div className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-gray-600 hover:text-gray-800"
              onClick={() => handleCotesChange(false)}
              disabled={instruction.cotesTomes <= 0}
              title="Diminuer côtes"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="text-xs font-medium min-w-8 text-center">
              {instruction.cotesTomes}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0 text-gray-600 hover:text-gray-800"
              onClick={() => handleCotesChange(true)}
              title="Augmenter côtes"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* État instruction */}
          {isEditing ? (
            <Select
              value={instruction.etatReglement}
              onChange={(e) => onUpdate(instruction.id, { etatReglement: e.target.value as any })}
              className="text-xs h-8"
            >
              <option value="instruction">En cours</option>
              <option value="175_rendu">175 rendu</option>
              <option value="rd_fait">RD fait</option>
              <option value="ordonnance_rendue">Ordonnance</option>
            </Select>
          ) : (
            <Badge 
              variant="outline"
              className={`text-xs ${
                instruction.etatReglement === 'instruction' ? 'bg-gray-100 text-gray-700' :
                instruction.etatReglement === '175_rendu' ? 'bg-yellow-100 text-yellow-700' :
                instruction.etatReglement === 'rd_fait' ? 'bg-blue-100 text-blue-700' :
                'bg-green-100 text-green-700'
              }`}
            >
              {instruction.etatReglement === 'instruction' ? 'En cours' :
               instruction.etatReglement === '175_rendu' ? '175 rendu' :
               instruction.etatReglement === 'rd_fait' ? 'RD fait' :
               'Ordonnance'}
            </Badge>
          )}

          {/* Orientation finale */}
          {isEditing ? (
            <Select
              value={instruction.orientation || ''}
              onChange={(e) => onUpdate(instruction.id, { orientation: e.target.value as any })}
              className="text-xs h-8"
            >
              <option value="">Orientation?</option>
              <option value="TC">TC</option>
              <option value="CCD">CCD</option>
              <option value="Assises">Assises</option>
              <option value="non_lieu">Non-lieu</option>
            </Select>
          ) : instruction.orientation && (
            <Badge variant="outline" className="text-xs">
              {instruction.orientation}
            </Badge>
          )}
        </div>
      </div>

      {/* Description du dossier - pleine largeur */}
      <div className="px-4 pb-3">
        <label className="text-sm font-medium text-gray-700">Description:</label>
        {isEditing ? (
          <textarea
            value={instruction.description || ''}
            onChange={(e) => onUpdate(instruction.id, { description: e.target.value })}
            placeholder="Description du dossier..."
            className="w-full mt-1 h-16 text-sm border rounded px-3 py-2 bg-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        ) : (
          <p className="text-sm text-gray-600 mt-1 bg-gray-50 p-2 rounded min-h-8">
            {instruction.description || 'Aucune description'}
          </p>
        )}
      </div>
    </div>
  );
};