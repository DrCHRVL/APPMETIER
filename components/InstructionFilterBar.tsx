import React from 'react';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { TagSelector } from './TagSelector';
import { Tag } from '@/types/interfaces';
import { Search, X } from 'lucide-react';

interface InstructionFilterBarProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectedCabinet: string;
  onCabinetChange: (cabinet: string) => void;
  selectedEtat: string;
  onEtatChange: (etat: string) => void;
  selectedTags: Tag[];
  onTagSelect: (tag: Tag) => void;
  onTagRemove: (tagId: string) => void;
  sortOrder: string;
  onSortChange: (order: string) => void;
}

export const InstructionFilterBar = ({
  searchTerm,
  onSearchChange,
  selectedCabinet,
  onCabinetChange,
  selectedEtat,
  onEtatChange,
  selectedTags,
  onTagSelect,
  onTagRemove,
  sortOrder,
  onSortChange
}: InstructionFilterBarProps) => {
  
  const clearAllFilters = () => {
    onSearchChange('');
    onCabinetChange('');
    onEtatChange('');
    onTagRemove(''); // Vider tous les tags
    onSortChange('date-desc');
  };

  const hasActiveFilters = searchTerm || selectedCabinet || selectedEtat || selectedTags.length > 0;

  return (
    <div className="bg-gray-50 border rounded-lg p-4 space-y-4">
      {/* Première ligne : Recherche et filtres principaux */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Recherche */}
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Rechercher un dossier..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Filtre Cabinet */}
        <Select
          value={selectedCabinet}
          onChange={(e) => onCabinetChange(e.target.value)}
        >
          <option value="">Tous les cabinets</option>
          <option value="1">Cabinet 1</option>
          <option value="2">Cabinet 2</option>
          <option value="3">Cabinet 3</option>
          <option value="4">Cabinet 4</option>
        </Select>

        {/* Filtre État règlement */}
        <Select
          value={selectedEtat}
          onChange={(e) => onEtatChange(e.target.value)}
        >
          <option value="">Tous les états</option>
          <option value="instruction">En cours d'instruction</option>
          <option value="175_rendu">175 rendu</option>
          <option value="rd_fait">RD fait</option>
          <option value="ordonnance_rendue">Ordonnance rendue</option>
        </Select>

        {/* Tri */}
        <Select
          value={sortOrder}
          onChange={(e) => onSortChange(e.target.value)}
        >
          <option value="date-desc">Date (plus récent)</option>
          <option value="date-asc">Date (plus ancien)</option>
          <option value="cabinet-asc">Cabinet (1→4)</option>
          <option value="etat-asc">État règlement</option>
          <option value="numero-asc">Numéro instruction</option>
        </Select>
      </div>

      {/* Deuxième ligne : Tags et actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <TagSelector
            selectedTags={selectedTags}
            onTagSelect={onTagSelect}
            onTagRemove={onTagRemove}
            categories={['infractions', 'services', 'suivi']}
            placeholder="Filtrer par type d'infraction..."
          />
        </div>

        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAllFilters}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
          >
            <X className="h-4 w-4" />
            Effacer les filtres
          </Button>
        )}
      </div>

      {/* Tags sélectionnés */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map(tag => (
            <Badge
              key={tag.id}
              variant="secondary"
              className="flex items-center gap-1 bg-blue-100 text-blue-800"
            >
              {tag.value}
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 hover:bg-transparent"
                onClick={() => onTagRemove(tag.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      {/* Indicateurs de filtres actifs */}
      {hasActiveFilters && (
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Filtres actifs :</span>
          <div className="flex gap-2">
            {selectedCabinet && (
              <Badge variant="outline" className="text-xs">
                Cabinet {selectedCabinet}
              </Badge>
            )}
            {selectedEtat && (
              <Badge variant="outline" className="text-xs">
                {selectedEtat === 'instruction' ? 'En cours' :
                 selectedEtat === '175_rendu' ? '175 rendu' :
                 selectedEtat === 'rd_fait' ? 'RD fait' :
                 'Ordonnance rendue'}
              </Badge>
            )}
            {searchTerm && (
              <Badge variant="outline" className="text-xs">
                Recherche: "{searchTerm}"
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
};