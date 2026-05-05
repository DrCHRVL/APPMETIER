import { Wifi, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from './ui/tooltip';

/**
 * Petite icône Wi-Fi qui reflète l'état du partage réseau (P:\).
 *  - vert  : latence saine, sync temps réel
 *  - jaune : réseau lent, sync différée
 *  - rouge : injoignable, modifications locales uniquement
 *
 * L'utilisateur n'a aucune action à faire : l'app s'adapte automatiquement.
 * L'indicateur sert juste à savoir où on en est.
 */
export const NetworkStatusIndicator = () => {
  const { state, latency } = useNetworkStatus();

  let color: string;
  let label: string;
  let Icon = Wifi;
  switch (state) {
    case 'healthy':
      color = 'text-emerald-500';
      label = `Réseau OK (${latency} ms)`;
      break;
    case 'slow':
      color = 'text-amber-500';
      label = `Réseau lent (${latency} ms) — synchronisation différée`;
      break;
    case 'unreachable':
    default:
      color = 'text-red-500';
      Icon = WifiOff;
      label = 'Réseau injoignable — modifications enregistrées localement';
      break;
  }

  return (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${color}`}
            aria-label={label}
          >
            <Icon className="h-4 w-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{label}</p>
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
};
