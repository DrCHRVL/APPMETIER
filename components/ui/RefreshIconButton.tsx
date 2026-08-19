import React from 'react';
import { RefreshCw, Check, AlertCircle } from 'lucide-react';

/**
 * Cycle de vie d'une actualisation à la demande : le résultat (✓/⚠) reste
 * affiché quelques secondes après la fin du run, pour que l'utilisateur sache
 * si ça a marché même s'il a raté le toast.
 */
export type RefreshStatus = 'idle' | 'running' | 'success' | 'error';

interface RefreshIconButtonProps {
  status: RefreshStatus;
  onClick: () => void;
  /** Infobulle affichée à l'état repos (les autres états ont la leur). */
  title: string;
  ariaLabel: string;
  className?: string;
}

export const RefreshIconButton = ({
  status,
  onClick,
  title,
  ariaLabel,
  className = '',
}: RefreshIconButtonProps) => {
  const running = status === 'running';
  const titles: Record<RefreshStatus, string> = {
    idle: title,
    running: 'Actualisation en cours — le résultat s\'affichera ici',
    success: 'Actualisation terminée',
    error: 'Échec de l\'actualisation — cliquer pour réessayer',
  };
  const stateSuffix: Record<RefreshStatus, string> = {
    idle: '',
    running: ' (en cours)',
    success: ' (terminé)',
    error: ' (échec)',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      title={titles[status]}
      aria-label={`${ariaLabel}${stateSuffix[status]}`}
      aria-busy={running}
      className={`inline-flex items-center gap-1 transition-colors disabled:cursor-wait ${
        status === 'error'
          ? 'text-red-500 hover:text-red-600'
          : running
            ? 'text-emerald-600'
            : 'text-gray-400 hover:text-emerald-600'
      } ${className}`}
    >
      {status === 'success' ? (
        <Check className="h-3.5 w-3.5 text-emerald-600 animate-in fade-in zoom-in duration-200" />
      ) : status === 'error' ? (
        <AlertCircle className="h-3.5 w-3.5 animate-in fade-in zoom-in duration-200" />
      ) : (
        <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
      )}
      {running && (
        <span className="text-[10px] italic text-emerald-600 select-none">en cours…</span>
      )}
    </button>
  );
};
