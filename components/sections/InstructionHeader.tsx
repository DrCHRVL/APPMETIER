import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select } from '../ui/select';
import { Badge } from '../ui/badge';
import { TagSelector } from '../TagSelector';
import { EnqueteInstruction, Tag } from '@/types/interfaces';
import { Building2, Calendar, Flag, User, MapPin } from 'lucide-react';

interface InstructionHeaderProps {
  instruction: EnqueteInstruction;
  isEditing: boolean;
  onUpdate?: (updates: Partial<EnqueteInstruction>) => void;
}

export const InstructionHeader = ({
  instruction,
  isEditing,
  onUpdate
}: InstructionHeaderProps) => {

  const handleTagChange = (newTags: Tag[]) => {
    if (onUpdate) {
      onUpdate({ tags: newTags });
    }
  };

  const handleServiceChange = (newServices: string[]) => {
    if (onUpdate) {
      onUpdate({ services: newServices });
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-2 gap-6">
        {/* Colonne gauche */}
        <div className="space-y-4">
          {/* Numéros */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-1">
                <Flag className="h-4 w-4 text-blue-500" />
                Numéro instruction
              </Label>
              {isEditing ? (
                <Input
                  value={instruction.numeroInstruction}
                  onChange={(e) => onUpdate?.({ numeroInstruction: e.target.value })}
                  className="mt-1"
                />
              ) : (
                <div className="mt-1 p-2 bg-gray-50 rounded text-sm font-medium">
                  {instruction.numeroInstruction}
                </div>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium flex items-center gap-1">
                <Building2 className="h-4 w-4 text-gray-500" />
                Numéro parquet
              </Label>
              {isEditing ? (
                <Input
                  value={instruction.numeroParquet}
                  onChange={(e) => onUpdate?.({ numeroParquet: e.target.value })}
                  className="mt-1"
                />
              ) : (
                <div className="mt-1 p-2 bg-gray-50 rounded text-sm">
                  {instruction.numeroParquet}
                </div>
              )}
            </div>
          </div>

          {/* Cabinet et origine */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-1">
                <MapPin className="h-4 w-4 text-purple-500" />
                Cabinet
              </Label>
              {isEditing ? (
                <Select
                  value={instruction.cabinet}
                  onChange={(e) => onUpdate?.({ cabinet: e.target.value as '1'|'2'|'3'|'4' })}
                  className="mt-1"
                >
                  <option value="1">Cabinet 1</option>
                  <option value="2">Cabinet 2</option>
                  <option value="3">Cabinet 3</option>
                  <option value="4">Cabinet 4</option>
                </Select>
              ) : (
                <div className="mt-1">
                  <Badge 
                    variant="outline"
                    className={`${
                      instruction.cabinet === '1' ? 'bg-rose-100 text-rose-700 border-rose-300' :
                      instruction.cabinet === '2' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                      instruction.cabinet === '3' ? 'bg-green-100 text-green-700 border-green-300' :
                      'bg-blue-100 text-blue-700 border-blue-300'
                    }`}
                  >
                    Cabinet {instruction.cabinet}
                  </Badge>
                </div>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium">Origine enquête</Label>
              {isEditing ? (
                <Select
                  value={instruction.origineEnquete}
                  onChange={(e) => onUpdate?.({ origineEnquete: e.target.value as 'preliminaire'|'flagrance' })}
                  className="mt-1"
                >
                  <option value="preliminaire">Préliminaire</option>
                  <option value="flagrance">Flagrance</option>
                </Select>
              ) : (
                <div className="mt-1">
                  <Badge 
                    variant="outline"
                    className={instruction.origineEnquete === 'flagrance' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}
                  >
                    {instruction.origineEnquete === 'flagrance' ? 'Flagrance' : 'Préliminaire'}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Service enquêteur */}
          <div>
            <Label className="text-sm font-medium flex items-center gap-1">
              <User className="h-4 w-4 text-green-500" />
              Service enquêteur
            </Label>
            {isEditing ? (
              <Select
                value={instruction.serviceEnqueteur}
                onChange={(e) => onUpdate?.({ serviceEnqueteur: e.target.value })}
                className="mt-1"
              >
                <option value="">Sélectionner un service</option>
                <option value="PJ Amiens">PJ Amiens</option>
                <option value="SR Amiens">SR Amiens</option>
                <option value="Gendarmerie">Gendarmerie</option>
                <option value="OFAST">OFAST</option>
                <option value="OCLAESP">OCLAESP</option>
                <option value="OCRGDF">OCRGDF</option>
              </Select>
            ) : (
              <div className="mt-1">
                <Badge variant="outline" className="bg-green-50 text-green-700">
                  {instruction.serviceEnqueteur}
                </Badge>
              </div>
            )}
          </div>

          {/* Date ouverture */}
          <div>
            <Label className="text-sm font-medium flex items-center gap-1">
              <Calendar className="h-4 w-4 text-gray-500" />
              Date ouverture information
            </Label>
            {isEditing ? (
              <Input
                type="date"
                value={instruction.dateDebut}
                onChange={(e) => onUpdate?.({ dateDebut: e.target.value })}
                className="mt-1"
              />
            ) : (
              <div className="mt-1 p-2 bg-gray-50 rounded text-sm">
                {new Date(instruction.dateDebut).toLocaleDateString('fr-FR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>
            )}
          </div>
        </div>

        {/* Colonne droite */}
        <div className="space-y-4">
          {/* Tags infractions */}
          <div>
            <Label className="text-sm font-medium">Type d'infraction principale</Label>
            {isEditing ? (
              <div className="mt-1">
                <TagSelector
                  selectedTags={instruction.tags.filter(t => t.category === 'infractions')}
                  onTagSelect={(tag) => {
                    const otherTags = instruction.tags.filter(t => t.category !== 'infractions');
                    handleTagChange([...otherTags, tag]);
                  }}
                  onTagRemove={(tagId) => {
                    const newTags = instruction.tags.filter(t => t.id !== tagId);
                    handleTagChange(newTags);
                  }}
                  categories={['infractions']}
                  maxSelection={1}
                />
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {instruction.tags
                  .filter(tag => tag.category === 'infractions')
                  .map(tag => (
                    <Badge key={tag.id} variant="outline" className="bg-red-50 text-red-700">
                      {tag.value}
                    </Badge>
                  ))}
                {instruction.tags.filter(t => t.category === 'infractions').length === 0 && (
                  <span className="text-sm text-gray-500 italic">Aucune infraction renseignée</span>
                )}
              </div>
            )}
          </div>

          {/* Services impliqués */}
          <div>
            <Label className="text-sm font-medium">Services impliqués</Label>
            {isEditing ? (
              <div className="mt-1 space-y-2">
                {instruction.services.map((service, index) => (
                  <div key={index} className="flex gap-2">
                    <Select
                      value={service}
                      onChange={(e) => {
                        const newServices = [...instruction.services];
                        newServices[index] = e.target.value;
                        handleServiceChange(newServices.filter(s => s.trim() !== ''));
                      }}
                      className="flex-1"
                    >
                      <option value="">Sélectionner un service</option>
                      <option value="PJ Amiens">PJ Amiens</option>
                      <option value="SR Amiens">SR Amiens</option>
                      <option value="Gendarmerie">Gendarmerie</option>
                      <option value="OFAST">OFAST</option>
                      <option value="OCLAESP">OCLAESP</option>
                      <option value="OCRGDF">OCRGDF</option>
                    </Select>
                    {instruction.services.length > 1 && (
                      <button
                        onClick={() => {
                          const newServices = instruction.services.filter((_, i) => i !== index);
                          handleServiceChange(newServices);
                        }}
                        className="text-red-600 hover:text-red-800"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => handleServiceChange([...instruction.services, ''])}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Ajouter un service
                </button>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {instruction.services.filter(s => s.trim() !== '').map((service, index) => (
                  <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700">
                    {service}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <Label className="text-sm font-medium">Description du dossier</Label>
            {isEditing ? (
              <Textarea
                value={instruction.description || ''}
                onChange={(e) => onUpdate?.({ description: e.target.value })}
                placeholder="Description succincte des faits..."
                className="mt-1"
                rows={4}
              />
            ) : (
              <div className="mt-1 p-3 bg-gray-50 rounded text-sm">
                {instruction.description || (
                  <span className="text-gray-500 italic">Aucune description</span>
                )}
              </div>
            )}
          </div>

          {/* Tags suivi */}
          <div>
            <Label className="text-sm font-medium">Suivi</Label>
            <div className="mt-1 flex gap-1">
              {instruction.tags.some(t => t.category === 'suivi' && t.value === 'JIRS') && (
                <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300">
                  <Flag className="h-3 w-3 mr-1" />
                  JIRS
                </Badge>
              )}
              {instruction.tags.some(t => t.category === 'suivi' && t.value === 'PG') && (
                <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                  <Flag className="h-3 w-3 mr-1" />
                  Parquet Général
                </Badge>
              )}
              {!instruction.tags.some(t => t.category === 'suivi') && (
                <span className="text-sm text-gray-500">Aucun</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Informations calculées */}
      <div className="pt-4 border-t bg-gray-50 rounded p-3">
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Durée instruction:</span>
            <div className="font-medium">
              {Math.ceil(
                (new Date().getTime() - new Date(instruction.dateDebut).getTime()) 
                / (1000 * 60 * 60 * 24)
              )} jours
            </div>
          </div>
          
          <div>
            <span className="text-gray-600">État règlement:</span>
            <div>
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
                 'Ordonnance rendue'}
              </Badge>
            </div>
          </div>
          
          <div>
            <span className="text-gray-600">Comptes-rendus:</span>
            <div className="font-medium">{instruction.comptesRendus.length}</div>
          </div>
          
          <div>
            <span className="text-gray-600">Dernière mise à jour:</span>
            <div className="font-medium text-xs">
              {new Date(instruction.dateMiseAJour || instruction.dateCreation).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};