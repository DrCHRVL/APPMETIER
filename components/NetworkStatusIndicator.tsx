import { useEffect, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Wifi, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { NetworkStatusManager } from '@/utils/networkStatusManager';
import { Switch } from './ui/switch';

/**
 * Petite icône Wi-Fi qui reflète l'état de la cible de synchronisation :
 *  - bureau (Electron) : le partage réseau P:\
 *  - web               : le serveur SIRAL (sonde /api/health)
 *
 *  - vert  : latence saine, sync temps réel
 *  - jaune : réseau lent, sync différée
 *  - rouge : injoignable, modifications locales uniquement
 *
 * Au clic, un popover propose un interrupteur "Mode hors ligne" pour forcer
 * temporairement l'app en local (utile si la synchro ralentit l'UI). Ce
 * réglage n'est pas persisté : au prochain lancement on repart en ligne.
 */
export const NetworkStatusIndicator = () => {
  const { state, latency } = useNetworkStatus();
  // En web, l'indicateur concerne le serveur SIRAL ; en bureau, le partage P:\.
  const isWeb = typeof window !== 'undefined' && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;
  const targetLabel = isWeb ? 'serveur SIRAL' : 'partage réseau (P:\\)';
  const [forcedOffline, setForcedOffline] = useState(() =>
    NetworkStatusManager.isForcedOffline()
  );
  const realStatus = NetworkStatusManager.getRealStatus();

  useEffect(() => {
    setForcedOffline(NetworkStatusManager.isForcedOffline());
  }, [state]);

  const toggleOffline = (value: boolean) => {
    NetworkStatusManager.setForcedOffline(value);
    setForcedOffline(value);
  };

  let color: string;
  let label: string;
  let Icon = Wifi;
  if (forcedOffline) {
    color = 'text-slate-500';
    Icon = WifiOff;
    label = 'Mode hors ligne activé — modifications enregistrées localement';
  } else {
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
  }

  let realLabel: string;
  switch (realStatus.state) {
    case 'healthy':
      realLabel = `Connecté (${realStatus.latency} ms)`;
      break;
    case 'slow':
      realLabel = `Réseau lent (${realStatus.latency} ms)`;
      break;
    case 'unreachable':
    default:
      realLabel = 'Réseau injoignable';
      break;
  }

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${color} hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500`}
          aria-label={label}
          title={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50 w-72 rounded-md border border-slate-200 bg-white p-3 text-sm shadow-md outline-none"
        >
          <div className="mb-2">
            <div className="font-medium text-slate-900">État du réseau</div>
            <div className="text-xs text-slate-500">{realLabel}</div>
            <div className="text-[11px] text-slate-400">Cible : {targetLabel}</div>
          </div>
          <div className="flex items-start justify-between gap-3 rounded-md bg-slate-50 p-2">
            <div className="flex-1">
              <label
                htmlFor="offline-mode-switch"
                className="block text-sm font-medium text-slate-900"
              >
                Mode hors ligne
              </label>
              <p className="mt-0.5 text-xs text-slate-500">
                Suspend la synchronisation pour fluidifier l'app. Non conservé
                au prochain lancement.
              </p>
            </div>
            <Switch
              id="offline-mode-switch"
              checked={forcedOffline}
              onCheckedChange={toggleOffline}
            />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
};
