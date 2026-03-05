"use client"

import React, { useState } from 'react';
import { TagSelector } from './TagSelector';
import { Select } from './ui/select';
import { Tag } from '@/types/interfaces';
import { Button } from './ui/button';
import { Filter, ChevronDown, ChevronUp, X, Flag } from 'lucide-react';
import { Badge } from './ui/badge';
import { useTags } from '@/hooks/useTags';

interface FilterBarProps {
  selectedTags: Tag[];
  onTagSelect: (tag: Tag) => void;
  onTagRemove: (tagId: string) => void;
  sortOrder: string;
  onSortChange: (order: string) => void;
}

export const FilterBar = ({
  selectedTags,
  onTagSelect,
  onTagRemove,
  sortOrder,
  onSortChange
}: FilterBarProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { getTagsByCategory } = useTags();
  
  const isPrioritaireSelected = selectedTags.some(tag => tag.id === 'prioritaire');

  return (
    <div className="bg-white border-b">
      <div className="p-2 flex flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-gray-600"
            >
              <Filter className="h-4 w-4 mr-2" />
              Filtres
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 ml-2" />
              ) : (
                <ChevronDown className="h-4 w-4 ml-2" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className={`${isPrioritaireSelected ? 'text-red-500' : 'text-gray-400'}`}
              onClick={() => {
                if (isPrioritaireSelected) {
                  onTagRemove('prioritaire');
                } else {
                  onTagSelect({
                    id: 'prioritaire',
                    value: 'Prioritaire',
                    category: 'priorite'
                  });
                }
              }}
            >
              <Flag className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Trier par:</span>
            <Select
              value={sortOrder}
              onChange={(e) => onSortChange(e.target.value)}
              className="w-48"
            >
              <option value="date-desc">Date (plus récent)</option>
              <option value="date-asc">Date (plus ancien)</option>
              <option value="cr-desc">Dernier CR (plus récent)</option>
              <option value="cr-asc">Dernier CR (plus ancien)</option>
            </Select>
          </div>
        </div>

        {selectedTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 px-2">
            {selectedTags.map(tag => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="h-5 px-1.5 text-[11px] bg-gray-100 flex items-center gap-1"
              >
                {tag.value}
                <button
                  className="hover:text-gray-700 rounded-full"
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
        <div className="px-4 py-2 border-t">
          <TagSelector
            selectedTags={selectedTags}
            onTagSelect={onTagSelect}
            onTagRemove={onTagRemove}
          />
        </div>
      )}
    </div>
  );
};