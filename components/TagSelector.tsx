"use client"

import React from 'react';
import { Button } from './ui/button';
import { Tag } from '@/types/interfaces';
import { useTags } from '@/hooks/useTags';
import { TagCategory, TAG_CATEGORIES } from '@/config/tags';

interface TagSelectorProps {
  selectedTags: Tag[];
  onTagSelect: (tag: Tag) => void;
  onTagRemove: (tagId: string) => void;
  allowedCategories?: TagCategory[];
}

export const TagSelector = ({
  selectedTags,
  onTagSelect,
  onTagRemove,
  allowedCategories
}: TagSelectorProps) => {
  const { getTagsByCategory, isLoading } = useTags();
  
  const availableCategories = allowedCategories || ['infractions', 'services', 'duree', 'priorite', 'statut', 'juge'];

  if (isLoading) {
    return <div className="text-sm text-gray-500">Chargement des tags...</div>;
  }

  return (
    <div className="space-y-4">
      {availableCategories.map(category => {
        const categoryTags = getTagsByCategory(category);
        
        if (categoryTags.length === 0) return null;
        
        return (
          <div key={category} className="space-y-1">
            <h3 className="text-sm font-medium text-gray-700">
              {TAG_CATEGORIES[category] || category}
            </h3>
            <div className="flex flex-wrap gap-2">
              {categoryTags.map((tag) => {
                const isSelected = selectedTags.some(t => t.id === tag.id);
                
                return (
                  <Button
                    key={tag.id}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    className={`h-7 ${isSelected ? 'bg-primary text-white' : 'text-gray-700'}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      
                      if (!isSelected) {
                        onTagSelect({
                          id: tag.id,
                          value: tag.value,
                          category: tag.category
                        });
                      } else {
                        onTagRemove(tag.id);
                      }
                    }}
                  >
                    {tag.value}
                  </Button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};