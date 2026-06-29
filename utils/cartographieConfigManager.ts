// utils/cartographieConfigManager.ts
//
// Gestion de la configuration du module Cartographie : pondérations du
// score (top 10), coefficients par tag d'infraction et regroupement par
// service.
//
// PARTAGÉE PAR TOUTE L'ÉQUIPE : la config vit dans un fichier serveur commun
// (`cartographie-config`), pas dans les préférences par utilisateur. Tout le
// monde lit et écrit la même configuration ; quand un magistrat ajuste les
// pondérations, le changement se propage aux autres postes (pull au montage
// du module + sync périodique). Objet unique → fusion last-write-wins par
// `updatedAt` (le plus récent gagne en entier, pas de merge par champ).
//
// Persistance locale via ElectronBridge sous la clé `cartographieConfig`
// (cache hors-ligne + base de comparaison pour le merge).

import { ElectronBridge } from './electronBridge';
import { getCurrentUserInfo } from './dataSync/globalSyncCommon';
import { APP_CONFIG } from '@/config/constants';
import {
  DEFAULT_CARTO_CONFIG,
  DEFAULT_CARTO_WEIGHTS,
  type CartographieModuleConfig,
  type CartographieScoreWeights,
} from '@/types/cartographieTypes';

const CONFIG_KEY = APP_CONFIG.STORAGE_KEYS.CARTOGRAPHIE_CONFIG;
const PERIODIC_SYNC_MS = 60_000;

/** `true` si l'API serveur de la config carto partagée est disponible. */
function isShareAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullCartographieConfig
    && !!window.electronAPI?.globalSync_pushCartographieConfig;
}

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

/** Compare deux configs par leur `updatedAt`. */
function ts(c: CartographieModuleConfig | null): number {
  return c ? Date.parse(c.updatedAt || '') || 0 : -1;
}

/** Renvoie la config la plus récente des deux (last-write-wins). */
function pickNewest(
  a: CartographieModuleConfig | null,
  b: CartographieModuleConfig | null,
): CartographieModuleConfig | null {
  if (!a) return b;
  if (!b) return a;
  return ts(b) > ts(a) ? b : a;
}

async function pullServerConfig(): Promise<CartographieModuleConfig | null> {
  if (!window.electronAPI?.globalSync_pullCartographieConfig) return null;
  const raw = await window.electronAPI.globalSync_pullCartographieConfig();
  return raw ? normalize(raw) : null;
}

async function pushServerConfig(config: CartographieModuleConfig): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushCartographieConfig) return false;
  return await window.electronAPI.globalSync_pushCartographieConfig(config);
}

class CartographieConfigManagerService {
  private cache: CartographieModuleConfig | null = null;
  private listeners = new Set<(config: CartographieModuleConfig) => void>();
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  // Une écriture locale n'a pas encore été confirmée côté serveur (push à
  // retenter par la prochaine sync périodique si le partage était injoignable).
  private dirty = false;

  /** Lit la config locale brute (sans toucher au cache ni au serveur). */
  private async loadLocalOnly(): Promise<CartographieModuleConfig | null> {
    const stored = await ElectronBridge.getData<CartographieModuleConfig | null>(
      CONFIG_KEY,
      null,
    );
    if (stored === null) return null;
    return normalize(stored);
  }

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
    const localConfig = stored ? normalize(stored) : null;

    // Tirer la config partagée de l'équipe et garder la plus récente.
    let serverConfig: CartographieModuleConfig | null = null;
    try {
      serverConfig = await pullServerConfig();
    } catch {
      // Partage injoignable : on se contente de la config locale.
    }

    const winner = pickNewest(localConfig, serverConfig) || normalize(null);

    // Le serveur a une version plus récente (ou la 1re config connue) → on la
    // persiste localement pour le hors-ligne et la prochaine comparaison.
    if (serverConfig && ts(serverConfig) > ts(localConfig)) {
      await ElectronBridge.setData(CONFIG_KEY, winner);
    }
    // Config présente en local mais pas (ou plus à jour) sur le serveur → on
    // marque dirty pour qu'elle remonte au partage à la prochaine sync.
    if (localConfig && ts(localConfig) > ts(serverConfig)) {
      this.dirty = true;
    }

    this.cache = winner;
    return winner;
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
    const user = await getCurrentUserInfo().catch(() => null);
    const next: CartographieModuleConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.displayName || config.updatedBy,
    };
    await ElectronBridge.setData(CONFIG_KEY, next);
    this.cache = next;
    this.dirty = true;
    this.emit(next);
    // Push immédiat vers le serveur commun (best-effort : si le partage est
    // injoignable, `dirty` reste à true et la sync périodique retentera).
    pushServerConfig(next)
      .then(ok => { if (ok) this.dirty = false; })
      .catch(() => {});
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

  // ─── Synchronisation avec le serveur commun ────────────────────────────────

  /** À appeler à l'ouverture du module Cartographie : pull initial + sync
   *  périodique pour récupérer les ajustements faits par les collègues. */
  start(): void {
    this.startPeriodic();
    this.sync().catch(err => console.error('CartographieConfigSync.initial', err));
  }

  stop(): void {
    this.stopPeriodic();
  }

  private startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('CartographieConfigSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  private stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  /** Force un aller-retour serveur immédiat (utilisé par le bouton Enregistrer). */
  async flushPending(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    await this.sync();
  }

  async sync(): Promise<void> {
    if (!isShareAvailable()) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = this.performSync().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async performSync(): Promise<void> {
    try {
      const [serverConfig, local] = await Promise.all([
        pullServerConfig(),
        this.cache ? Promise.resolve(this.cache) : this.loadLocalOnly(),
      ]);

      // Le serveur gagne → appliquer localement + notifier les abonnés (l'écran
      // Paramètres se met à jour en direct sans recharger l'app).
      if (serverConfig && ts(serverConfig) > ts(local)) {
        await ElectronBridge.setData(CONFIG_KEY, serverConfig);
        this.cache = serverConfig;
        this.emit(serverConfig);
        this.dirty = false;
        return;
      }

      // Local gagne (ou serveur vide), ou un push précédent a échoué → pousser.
      const needsPush = local && (!serverConfig || this.dirty || ts(local) > ts(serverConfig));
      if (needsPush && local) {
        const ok = await pushServerConfig(local);
        if (ok) this.dirty = false;
      } else {
        this.dirty = false;
      }
    } catch (error) {
      console.error('❌ CartographieConfigSync: sync échouée', error);
    }
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
