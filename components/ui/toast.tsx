import React, { useEffect } from 'react';
import { X, CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

const STYLES: Record<ToastType, { bg: string; Icon: typeof CheckCircle2 }> = {
  success: { bg: 'bg-green-600', Icon: CheckCircle2 },
  error: { bg: 'bg-red-600', Icon: XCircle },
  warning: { bg: 'bg-amber-500', Icon: AlertTriangle },
  info: { bg: 'bg-blue-600', Icon: Info },
};

export const Toast = ({ message, type, onClose, duration }: ToastProps) => {
  // Les échecs restent affichés plus longtemps : l'utilisateur doit pouvoir
  // les lire même s'il regardait ailleurs au moment de l'affichage.
  const effectiveDuration = duration ?? (type === 'error' ? 6000 : 3500);

  useEffect(() => {
    const timer = setTimeout(onClose, effectiveDuration);
    return () => clearTimeout(timer);
  }, [effectiveDuration, onClose]);

  const { bg, Icon } = STYLES[type];

  return (
    <div
      role="status"
      aria-live="polite"
      // z-[100] : au-dessus du voile des Dialog (z-50) et de tous les panneaux
      // (chat z-[60], attaché z-[70], popup production z-[80]) — sinon le toast
      // est grisé sous l'overlay quand un dossier est ouvert.
      className={`fixed bottom-4 right-4 z-[100] ${bg} text-white pl-3 pr-2 py-2 rounded-lg shadow-xl ring-1 ring-black/10 flex items-center gap-2 max-w-[min(420px,calc(100vw-2rem))] animate-in slide-in-from-bottom-2 fade-in duration-200`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="text-sm">{message}</span>
      <button
        onClick={onClose}
        aria-label="Fermer la notification"
        className="ml-1 flex-shrink-0 rounded p-0.5 hover:bg-white/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
