// utils/cartographieConfigManager.ts
//
// Gestion de la configuration du module Cartographie : pondérations du
// score (top 10) et coefficients par tag d'infraction.
// Persistance via ElectronBridge sous la clé `cartographieConfig`.
//
// Contrairement aux cabinets d'instruction qui ont besoin d'un sync
// inter-postes, les pondérations carto sont per-poste : chaque utilisateur
// affine son propre score selon ses critères. On garde donc l'API simple
// (load/save), sans tombstones ni timestamps de merge.

import { ElectronBridge } from './electronBridge';
import { APP_CONFIG } from '@/config/constants';
import {
  DEFAULT_CARTO_CONFIG,
  DEFAULT_CARTO_WEIGHTS,
  type CartographieModuleConfig,
  type CartographieScoreWeights,
} from '@/types/cartographieTypes';

const CONFIG_KEY = APP_CONFIG.STORAGE_KEYS.CARTOGRAPHIE_CONFIG;

/** Reconstruit une config valide à partir d'un blob potentiellement partiel
 *  (rétrocompat : un fichier antérieur peut manquer de champs). */
function normalize(stored: Partial<CartographieModuleConfig> | null): CartographieModuleConfig {
  const weights: CartographieScoreWeights = {
    ...DEFAULT_CARTO_WEIGHTS,
    ...(stored?.weights || {}),
  };
  return {
    weights,
    tagInfractionWeights: { ...(stored?.tagInfractionWeights || {}) },
    groupByService: stored?.groupByService ?? DEFAULT_CARTO_CONFIG.groupByService,
    version: stored?.version ?? DEFAULT_CARTO_CONFIG.version,
    updatedAt: stored?.updatedAt || new Date().toISOString(),
    updatedBy: stored?.updatedBy,
  };
}

class CartographieConfigManagerService {
  private cache: CartographieModuleConfig | null = null;
  private listeners = new Set<(config: CartographieModuleConfig) => void>();

  async load(): Promise<CartographieModuleConfig> {
    if (this.cache) return this.cache;
    const stored = await ElectronBridge.getData<CartographieModuleConfig | null>(
      CONFIG_KEY,
      null,
    );
    // Lecture illisible (≠ config réellement absente) : on renvoie des défauts
    // ÉPHÉMÈRES pour l'affichage mais on NE les met PAS en cache, afin qu'un
    // appel ultérieur réessaie et qu'aucune sauvegarde ne parte d'une base
    // erronée (cf. loadForWrite).
    if (stored === null && ElectronBridge.didReadFail(CONFIG_KEY)) {
      return normalize(null);
    }
    const config = normalize(stored);
    this.cache = config;
    return config;
  }

  /** Charge une base FIABLE pour une écriture. Si la lecture a échoué, on
   *  refuse l'opération plutôt que d'écrire des valeurs par défaut par-dessus
   *  la vraie configuration (cause historique de la perte des pondérations). */
  private async loadForWrite(): Promise<CartographieModuleConfig> {
    if (this.cache) return this.cache;
    const stored = await ElectronBridge.getData<CartographieModuleConfig | null>(
      CONFIG_KEY,
      null,
    );
    if (stored === null && ElectronBridge.didReadFail(CONFIG_KEY)) {
      throw new Error(
        'Configuration cartographie illisible : sauvegarde annulée pour ne pas écraser les réglages existants. Réessayez après rechargement de l’application.',
      );
    }
    const config = normalize(stored);
    this.cache = config;
    return config;
  }

  async save(config: CartographieModuleConfig): Promise<boolean> {
    const next: CartographieModuleConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    await ElectronBridge.setData(CONFIG_KEY, next);
    this.cache = next;
    this.emit(next);
    // Écriture disque immédiate : ces réglages sont souvent modifiés puis on
    // quitte/recharge l'app aussitôt, avant l'expiration du délai temporisé.
    return ElectronBridge.flush(CONFIG_KEY);
  }

  async refresh(): Promise<CartographieModuleConfig> {
    this.cache = null;
    return this.load();
  }

  /** Mise à jour partielle des pondérations principales. */
  async updateWeights(patch: Partial<CartographieScoreWeights>): Promise<boolean> {
    const current = await this.loadForWrite();
    return this.save({
      ...current,
      weights: { ...current.weights, ...patch },
    });
  }

  /** Définit le poids associé à un tag d'infraction (clé = Tag.id).
   *  Passer 0 supprime l'entrée pour rester clean. */
  async setTagInfractionWeight(tagId: string, weight: number): Promise<boolean> {
    const current = await this.loadForWrite();
    const next = { ...current.tagInfractionWeights };
    if (!weight) {
      delete next[tagId];
    } else {
      next[tagId] = weight;
    }
    return this.save({ ...current, tagInfractionWeights: next });
  }

  /** Active/désactive l'ancrage zonal par service d'enquête. */
  async setGroupByService(enabled: boolean): Promise<boolean> {
    const current = await this.loadForWrite();
    return this.save({ ...current, groupByService: enabled });
  }

  /** Reset complet aux valeurs par défaut. */
  async reset(): Promise<boolean> {
    return this.save({
      ...DEFAULT_CARTO_CONFIG,
      updatedAt: new Date().toISOString(),
    });
  }

  subscribe(cb: (config: CartographieModuleConfig) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(config: CartographieModuleConfig): void {
    for (const cb of this.listeners) {
      try { cb(config); } catch { /* listener non bloquant */ }
    }
  }
}

export const CartographieConfigManager = new CartographieConfigManagerService();
