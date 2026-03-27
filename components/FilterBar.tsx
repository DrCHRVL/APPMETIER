"use client"

import React, { useState } from 'react';
import { TagSelector } from './TagSelector';
import { Select } from './ui/select';
import { Tag } from '@/types/interfaces';
import { Button } from './ui/button';
import { Filter, ChevronDown, ChevronUp, X, Flag, LayoutGrid } from 'lucide-react';
import { Badge } from './ui/badge';
import { useTags } from '@/hooks/useTags';
import { SectionOrderModal } from './modals/SectionOrderModal';

interface FilterBarProps {
  selectedTags: Tag[];
  onTagSelect: (tag: Tag) => void;
  onTagRemove: (tagId: string) => void;
  sortOrder: string;
  onSortChange: (order: string) => void;
  activeSections?: string[];
  sections?: string[];
  onReorder?: (name: string, direction: 'up' | 'down') => Promise<boolean>;
  onAddSection?: (name: string) => Promise<boolean>;
}

export const FilterBar = ({
  selectedTags,
  onTagSelect,
  onTagRemove,
  sortOrder,
  onSortChange,
  activeSections = [],
  sections = [],
  onReorder,
  onAddSection
}: FilterBarProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSectionOrder, setShowSectionOrder] = useState(false);
  const { getTagsByCategory } = useTags();

  const isSuiviJIRSSelected = selectedTags.some(tag => tag.id === 'suivi_jirs');
  const isSuiviPGSelected = selectedTags.some(tag => tag.id === 'suivi_pg');

  return (
    <div className="bg-white" style={{ borderBottom: '1px solid hsl(214 25% 88%)' }}>
      <div className="px-3 py-1.5 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg text-xs font-medium"
            >
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              Filtres
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 ml-1.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-1.5 rounded-lg transition-colors text-xs font-medium gap-1 ${isSuiviJIRSSelected ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              onClick={() => {
                if (isSuiviJIRSSelected) {
                  onTagRemove('suivi_jirs');
                } else {
                  onTagSelect({
                    id: 'suivi_jirs',
                    value: 'JIRS',
                    category: 'suivi'
                  });
                }
              }}
              title="Filtrer les dossiers suivis JIRS"
            >
              <Flag className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">JIRS</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-1.5 rounded-lg transition-colors text-xs font-medium gap-1 ${isSuiviPGSelected ? 'text-purple-600 bg-purple-50 hover:bg-purple-100' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              onClick={() => {
                if (isSuiviPGSelected) {
                  onTagRemove('suivi_pg');
                } else {
                  onTagSelect({
                    id: 'suivi_pg',
                    value: 'PG',
                    category: 'suivi'
                  });
                }
              }}
              title="Filtrer les dossiers suivis Parquet Général"
            >
              <Flag className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">PG</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg text-xs"
              onClick={() => setShowSectionOrder(true)}
              title="Réordonner les colonnes"
            >
              <LayoutGrid className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Colonnes</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Trier par :</span>
            <Select
              value={sortOrder}
              onChange={(e) => onSortChange(e.target.value)}
              className="w-44 h-7 text-xs rounded-lg"
            >
              <option value="date-desc">Date (plus récent)</option>
              <option value="date-asc">Date (plus ancien)</option>
              <option value="cr-desc">Dernier CR (plus récent)</option>
              <option value="cr-asc">Dernier CR (plus ancien)</option>
            </Select>
          </div>
        </div>

        {selectedTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1 px-1">
            {selectedTags.map(tag => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="h-5 px-1.5 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 rounded-full"
              >
                {tag.value}
                <button
                  className="hover:text-emerald-900 rounded-full"
                  onClick={(e) => {
                    e.preventDefault();
                    onTagRemove(tag.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="px-4 py-2" style={{ borderTop: '1px solid hsl(214 25% 92%)' }}>
          <TagSelector
            selectedTags={selectedTags}
            onTagSelect={onTagSelect}
            onTagRemove={onTagRemove}
          />
        </div>
      )}

      <SectionOrderModal
        isOpen={showSectionOrder}
        onClose={() => setShowSectionOrder(false)}
        sections={sections}
        activeSections={activeSections}
        onReorder={onReorder ?? (async () => false)}
        onAddSection={onAddSection ?? (async () => false)}
      />
    </div>
  );
};