import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

export const Toast = ({ message, type, onClose, duration = 3000 }: ToastProps) => {
  // onClose via ref : un parent qui recrée le callback à chaque rendu ne doit
  // pas relancer le minuteur (sinon le toast ne se fermerait jamais).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  const bgColor = type === 'success' ? 'bg-green-500' :
                 type === 'error' ? 'bg-red-500' :
                 type === 'warning' ? 'bg-amber-500' :
                 'bg-blue-500';

  return (
    <div className={`fixed bottom-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2`}>
      <span>{message}</span>
      <button onClick={onClose} className="hover:opacity-80">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};