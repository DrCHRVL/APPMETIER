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
  private realStatus: NetworkStatus = { state: 'healthy', latency: 0, lastProbeAt: 0 };
  private forcedOffline = false;
  private listeners = new Set<Listener>();
  private started = false;

  private effective(): NetworkStatus {
    if (this.forcedOffline) {
      return { ...this.realStatus, state: 'unreachable' };
    }
    return this.realStatus;
  }

  private emit(next: NetworkStatus) {
    this.realStatus = next;
    const eff = this.effective();
    this.listeners.forEach(l => l(eff));
  }

  async start(): Promise<NetworkStatus> {
    if (this.started) return this.effective();
    this.started = true;
    const api = (window as unknown as { electronAPI?: any }).electronAPI;
    if (!api?.startNetworkMonitor) return this.effective();

    api.onNetworkStatus?.((next: NetworkStatus) => {
      this.emit(next);
    });
    const initial = await api.startNetworkMonitor();
    if (initial) {
      this.emit(initial);
    }
    return this.effective();
  }

  getStatus(): NetworkStatus {
    return this.effective();
  }

  /** État réel du probe, sans tenir compte du mode hors ligne forcé. */
  getRealStatus(): NetworkStatus {
    return this.realStatus;
  }

  isForcedOffline(): boolean {
    return this.forcedOffline;
  }

  /**
   * Active/désactive le mode hors ligne forcé. Volatile : non persisté entre
   * deux lancements de l'application (au prochain démarrage on repart en
   * ligne).
   */
  setForcedOffline(value: boolean): void {
    if (this.forcedOffline === value) return;
    this.forcedOffline = value;
    const eff = this.effective();
    this.listeners.forEach(l => l(eff));
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sonde unique à la demande (utilisée au lancement). */
  async probeOnce(): Promise<NetworkStatus> {
    const api = (window as unknown as { electronAPI?: any }).electronAPI;
    if (!api?.probeNetwork) return this.effective();
    const next = await api.probeNetwork();
    if (next) {
      this.emit(next);
    }
    return this.effective();
  }
}

export const NetworkStatusManager = new NetworkStatusManagerImpl();
