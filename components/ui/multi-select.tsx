import React, { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TagOption {
  id: string;
  value: string;
  category: string;
}

interface MultiSelectProps {
  options: (string | TagOption)[];
  value: string[];
  onChange: (value: string[]) => void;
  className?: string;
}

export const MultiSelect = ({
  options,
  value,
  onChange,
  className
}: MultiSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fonction utilitaire pour obtenir la valeur d'affichage
  const getOptionValue = (option: string | TagOption): string => {
    if (typeof option === 'string') {
      return option;
    }
    if (option && typeof option === 'object' && option.value) {
      return option.value;
    }
    return '';
  };

  // Fonction utilitaire pour obtenir une clé unique
  const getOptionKey = (option: string | TagOption, index: number): string => {
    if (typeof option === 'string') {
      return option;
    }
    if (option && typeof option === 'object') {
      return option.id || option.value || `option-${index}`;
    }
    return `option-${index}`;
  };

  const toggleOption = (option: string | TagOption) => {
    const optionValue = getOptionValue(option);
    if (!optionValue) return;
    
    const newValue = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  return (
    <div className="relative" ref={ref}>
      <div
        className={cn(
          "flex min-h-[2.5rem] w-full items-center justify-between rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background cursor-pointer",
          className
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex flex-wrap gap-1">
          {value.length > 0 ? (
            value.map(v => (
              <div
                key={v}
                className="bg-gray-100 px-2 py-0.5 rounded-sm text-xs flex items-center gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  // Trouver l'option correspondante pour la passer à toggleOption
                  const correspondingOption = options.find(opt => getOptionValue(opt) === v);
                  if (correspondingOption) {
                    toggleOption(correspondingOption);
                  }
                }}
              >
                {v}
                <X className="h-3 w-3 hover:text-red-500" />
              </div>
            ))
          ) : (
            <span className="text-gray-500">Sélectionner...</span>
          )}
        </div>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
          {options.map((option, index) => {
            const optionValue = getOptionValue(option);
            const optionKey = getOptionKey(option, index);
            const isSelected = value.includes(optionValue);
            
            // Ne pas afficher les options sans valeur
            if (!optionValue) {
              return null;
            }
            
            return (
              <div
                key={optionKey}
                className={cn(
                  "flex items-center px-3 py-2 text-sm cursor-pointer hover:bg-gray-50",
                  isSelected && "bg-gray-50"
                )}
                onClick={() => toggleOption(option)}
              >
                <div className={cn(
                  "w-4 h-4 border rounded mr-2 flex items-center justify-center",
                  isSelected && "bg-primary border-primary"
                )}>
                  {isSelected && (
                    <Check className="h-3 w-3 text-white" />
                  )}
                </div>
                {optionValue}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};