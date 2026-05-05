/**
 * Gestionnaire d'état réseau côté renderer.
 *
 * Le main process sonde le partage SMB toutes les 20 s et nous notifie via
 * IPC ('network:status'). Ce singleton expose ces changements aux composants
 * React via un pattern listener simple.
 *
 * États possibles :
 *   - 'healthy'      : latence < 800 ms, opérations réseau normales
 *   - 'slow'         : 800 ms ≤ latence ≤ 3 s, l'UI prévient
 *   - 'unreachable'  : latence > 3 s ou échec, mode local seulement
 */

export type NetworkState = 'healthy' | 'slow' | 'unreachable';

export interface NetworkStatus {
  state: NetworkState;
  latency: number;
  lastProbeAt: number;
}

type Listener = (status: NetworkStatus) => void;

class NetworkStatusManagerImpl {
  private status: NetworkStatus = { state: 'healthy', latency: 0, lastProbeAt: 0 };
  private listeners = new Set<Listener>();
  private started = false;

  async start(): Promise<NetworkStatus> {
    if (this.started) return this.status;
    this.started = true;
    const api = (window as unknown as { electronAPI?: any }).electronAPI;
    if (!api?.startNetworkMonitor) return this.status;

    api.onNetworkStatus?.((next: NetworkStatus) => {
      this.status = next;
      this.listeners.forEach(l => l(next));
    });
    const initial = await api.startNetworkMonitor();
    if (initial) {
      this.status = initial;
      this.listeners.forEach(l => l(initial));
    }
    return this.status;
  }

  getStatus(): NetworkStatus {
    return this.status;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sonde unique à la demande (utilisée au lancement). */
  async probeOnce(): Promise<NetworkStatus> {
    const api = (window as unknown as { electronAPI?: any }).electronAPI;
    if (!api?.probeNetwork) return this.status;
    const next = await api.probeNetwork();
    if (next) {
      this.status = next;
      this.listeners.forEach(l => l(next));
    }
    return next || this.status;
  }
}

export const NetworkStatusManager = new NetworkStatusManagerImpl();
