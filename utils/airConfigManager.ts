// utils/airConfigManager.ts
//
// Gestion de la configuration des délais du module AIR (seuils des alertes de
// convocation Procureur + seuils « mesures anciennes »).
//
// Persistance locale via ElectronBridge sous la clé `airConvocationConfig`.
// Un système d'abonnement (subscribe/emit) permet au dashboard de se mettre à
// jour en direct quand les réglages sont modifiés depuis l'écran Paramètres,
// sans avoir à recharger l'application.

import { ElectronBridge } from './electronBridge';
import { getCurrentUserInfo } from './dataSync/globalSyncCommon';
import {
  DEFAULT_AIR_CONVOCATION_CONFIG,
  type AIRConvocationConfig,
} from '@/types/airConfigTypes';

const CONFIG_KEY = 'airConvocationConfig';

/** Reconstruit une config valide à partir d'un blob potentiellement partiel
 *  (rétrocompat : un enregistrement antérieur peut manquer de champs). */
function normalize(stored: Partial<AIRConvocationConfig> | null): AIRConvocationConfig {
  return { ...DEFAULT_AIR_CONVOCATION_CONFIG, ...(stored || {}) };
}

class AIRConfigManagerService {
  private cache: AIRConvocationConfig | null = null;
  private listeners = new Set<(config: AIRConvocationConfig) => void>();

  async load(): Promise<AIRConvocationConfig> {
    if (this.cache) return this.cache;
    const stored = await ElectronBridge.getData<Partial<AIRConvocationConfig> | null>(
      CONFIG_KEY,
      null,
    );
    // Lecture illisible (≠ config réellement absente) : on renvoie des défauts
    // ÉPHÉMÈRES pour l'affichage sans les mettre en cache, afin qu'un appel
    // ultérieur réessaie.
    if (stored === null && ElectronBridge.didReadFail(CONFIG_KEY)) {
      return normalize(null);
    }
    const config = normalize(stored);
    this.cache = config;
    return config;
  }

  /** Applique une mise à jour partielle et persiste immédiatement. */
  async save(patch: Partial<AIRConvocationConfig>): Promise<boolean> {
    const current = await this.load();
    const user = await getCurrentUserInfo().catch(() => null);
    const next: AIRConvocationConfig = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.displayName || current.updatedBy,
    };
    this.cache = next;
    await ElectronBridge.setData(CONFIG_KEY, next);
    this.emit(next);
    // Écriture disque immédiate : ces réglages sont souvent modifiés puis on
    // quitte/recharge l'app aussitôt.
    return ElectronBridge.flush(CONFIG_KEY);
  }

  /** Reset complet aux valeurs par défaut. */
  async reset(): Promise<boolean> {
    return this.save({ ...DEFAULT_AIR_CONVOCATION_CONFIG });
  }

  subscribe(cb: (config: AIRConvocationConfig) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(config: AIRConvocationConfig): void {
    for (const cb of this.listeners) {
      try { cb(config); } catch { /* listener non bloquant */ }
    }
  }
}

export const AIRConfigManager = new AIRConfigManagerService();
