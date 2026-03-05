import React from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export const Checkbox = ({ 
  checked, 
  onCheckedChange, 
  className = "", 
  disabled = false,
  id 
}: CheckboxProps) => {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      className={`
        inline-flex items-center justify-center
        w-4 h-4 border-2 border-gray-300 rounded
        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        transition-colors duration-200
        ${checked 
          ? 'bg-blue-600 border-blue-600 text-white' 
          : 'bg-white hover:border-gray-400'
        }
        ${disabled 
          ? 'opacity-50 cursor-not-allowed' 
          : 'cursor-pointer'
        }
        ${className}
      `}
      onClick={() => !disabled && onCheckedChange(!checked)}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  );
};