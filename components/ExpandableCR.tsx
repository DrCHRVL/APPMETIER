import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CompteRendu } from '@/types/interfaces';

interface ExpandableCRProps {
  cr: CompteRendu;
}

export const ExpandableCR = ({ cr }: ExpandableCRProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const previewLength = 250; // Nombre de caractères à afficher en aperçu

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const getPreviewText = () => {
    if (cr.description.length <= previewLength || isExpanded) {
      return cr.description;
    }
    return `${cr.description.substring(0, previewLength)}...`;
  };

  return (
    <div 
      className="flex flex-col cursor-pointer"
      onClick={toggleExpand}
    >
      <div className="flex justify-between items-start">
        <p className="font-medium text-[13px]">
          {new Date(cr.date).toLocaleDateString()} - {cr.enqueteur}
        </p>
        <button 
          className="text-gray-500 hover:text-gray-700"
          onClick={toggleExpand}
        >
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>
      <p className="text-gray-600 mt-1 text-[10px] whitespace-pre-wrap break-words">
        {getPreviewText()}
      </p>
    </div>
  );
};