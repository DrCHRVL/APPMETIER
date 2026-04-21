import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CompteRendu } from '@/types/interfaces';
import { renderFormattedText } from '@/lib/formatCR';

interface ExpandableCRProps {
  cr: CompteRendu;
}

export const ExpandableCR = ({ cr }: ExpandableCRProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  // HTML formaté (gras, listes, surlignage…) + nettoyage des artefacts Office.
  // Quand replié, on s'appuie sur `line-clamp` en CSS pour tronquer visuellement
  // sans casser le HTML au milieu d'une balise.
  const formattedHtml = useMemo(() => renderFormattedText(cr.description), [cr.description]);

  return (
    <div
      className="flex flex-col cursor-pointer w-full"
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
      <div
        className={`text-gray-600 mt-1 text-[10px] break-words ${isExpanded ? '' : 'line-clamp-5'}`}
        style={{ wordBreak: 'break-word', hyphens: 'auto' }}
        dangerouslySetInnerHTML={{ __html: formattedHtml }}
      />
    </div>
  );
};
