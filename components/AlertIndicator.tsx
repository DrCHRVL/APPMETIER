import React from 'react';
import { Button } from './ui/button';
import { Alert } from '@/types/interfaces';

interface AlertIndicatorProps {
  count: number;
  onClick: () => void;
  onValidate?: (alert: Alert) => void;
  alert?: Alert;
}

export const AlertIndicator = ({ count, onClick, onValidate, alert }: AlertIndicatorProps) => {
  if (count === 0) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (alert?.type === 'prolongation_pending' && onValidate) {
      onValidate(alert);
    } else {
      onClick();
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 w-6 p-0"
      onClick={handleClick}
      title={alert?.type === 'prolongation_pending' ? "Cliquer pour valider la prolongation" : undefined}
    >
      <div className="relative">
        <div className="h-3 w-3 bg-red-600 rounded-full"></div>
        {count > 1 && (
          <span className="absolute -top-1 -right-1 text-[8px] bg-white rounded-full h-3 w-3 flex items-center justify-center text-red-600 font-bold">
            {count}
          </span>
        )}
      </div>
    </Button>
  );
};