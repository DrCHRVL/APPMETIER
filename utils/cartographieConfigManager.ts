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
// Persistance locale via SiralBridge sous la clé `cartographieConfig`
// (cache hors-ligne + base de comparaison pour le merge).

import { SiralBridge } from './siralBridge';
import { getCurrentUserInfo } from './dataSync/globalSyncCommon';
import { APP_CONFIG } from '@/config/constants';
import {
  CARTO_CONFIG_VERSION,
  DEFAULT_CARTO_CONFIG,
  DEFAULT_CARTO_LAYOUT,
  DEFAULT_CARTO_TEMPORAL,
  DEFAULT_CARTO_WEIGHTS,
  type CartographieLayoutConfig,
  type CartographieModuleConfig,
  type CartographieScoreWeights,
  type CartographieTemporalConfig,
} from '@/types/cartographieTypes';

const CONFIG_KEY = APP_CONFIG.STORAGE_KEYS.CARTOGRAPHIE_CONFIG;
const PERIODIC_SYNC_MS = 60_000;

/** `true` si l'API serveur de la config carto partagée est disponible. */
function isShareAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.siralBridge?.globalSync_pullCartographieConfig
    && !!window.siralBridge?.globalSync_pushCartographieConfig;
}

/** Reconstruit une config valide à partir d'un blob potentiellement partiel
 *  (rétrocompat : un fichier antérieur peut manquer de champs). */
function normalize(stored: Partial<CartographieModuleConfig> | null): CartographieModuleConfig {
  // MIGRATION v1 → v2 : `recentMultiplier` (bonus binaire « touché dans les
  // 12 mois ») a été remplacé par le bloc `temporal`. On repart des défauts et
  // on ne recopie que les clés encore connues du schéma — la clé morte ne
  // survit donc pas à un simple aller-retour de sauvegarde.
  const storedWeights = (stored?.weights || {}) as Partial<CartographieScoreWeights>;
  const weights: CartographieScoreWeights = { ...DEFAULT_CARTO_WEIGHTS };
  for (const key of Object.keys(DEFAULT_CARTO_WEIGHTS) as Array<keyof CartographieScoreWeights>) {
    const v = storedWeights[key];
    if (typeof v === 'number' && Number.isFinite(v)) weights[key] = v;
  }
  const temporal: CartographieTemporalConfig = {
    ...DEFAULT_CARTO_TEMPORAL,
    ...(stored?.temporal || {}),
  };
  const layout: CartographieLayoutConfig = {
    ...DEFAULT_CARTO_LAYOUT,
    ...(stored?.layout || {}),
  };
  return {
    weights,
    temporal,
    tagInfractionWeights: { ...(stored?.tagInfractionWeights || {}) },
    categoryWeights: { ...(stored?.categoryWeights || {}) },
    natinfWeights: { ...(stored?.natinfWeights || {}) },
    groupByService: stored?.groupByService ?? DEFAULT_CARTO_CONFIG.groupByService,
    layout,
    version: CARTO_CONFIG_VERSION,
    updatedAt: stored?.updatedAt || new Date().toISOString(),
    updatedBy: stored?.updatedBy,
  };
}

/** Compare deux configs par leur `updatedAt`. */
function ts(c: CartographieModuleConfig | null): number {
  return c ? Date.parse(c.updatedAt || '') || 0 : -1;
}

async function pullServerConfig(): Promise<CartographieModuleConfig | null> {
  if (!window.siralBridge?.globalSync_pullCartographieConfig) return null;
  const raw = await window.siralBridge.globalSync_pullCartographieConfig();
  return raw ? normalize(raw) : null;
}

async function pushServerConfig(config: CartographieModuleConfig): Promise<boolean> {
  if (!window.siralBridge?.globalSync_pushCartographieConfig) return false;
  return await window.siralBridge.globalSync_pushCartographieConfig(config);
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
    const stored = await SiralBridge.getData<CartographieModuleConfig | null>(
      CONFIG_KEY,
      null,
    );
    if (stored === null) return null;
    return normalize(stored);
  }

  async load(): Promise<CartographieModuleConfig> {
    if (this.cache) return this.cache;
    const stored = await SiralBridge.getData<CartographieModuleConfig | null>(
      CONFIG_KEY,
      null,
    );
    // Lecture illisible (≠ config réellement absente) : on renvoie des défauts
    // ÉPHÉMÈRES pour l'affichage mais on NE les met PAS en cache, afin qu'un
    // appel ultérieur réessaie et qu'aucune sauvegarde ne parte d'une base
    // erronée (cf. loadForWrite).
    if (stored === null && SiralBridge.didReadFail(CONFIG_KEY)) {
      return normalize(null);
    }
    const localConfig = stored ? normalize(stored) : null;

    // Config déjà connue de ce poste → on la sert IMMÉDIATEMENT, et la
    // réconciliation avec le partage se fait en tâche de fond (elle n'émettra
    // que si un collègue a poussé plus récent, cas rare).
    //
    // C'est ce qui évite l'effet « la carte s'affiche avec les réglages par
    // défaut puis se réorganise quelques secondes plus tard » : auparavant on
    // attendait l'aller-retour réseau avant de rendre la vraie config, si bien
    // que le premier layout était calculé avec les pondérations par défaut.
    if (localConfig) {
      this.cache = localConfig;
      this.sync().catch(err => console.error('CartographieConfigSync.afterLoad', err));
      return localConfig;
    }

    // Aucune config locale (premier démarrage de ce poste) : là, il faut bien
    // attendre le partage, sinon on repartirait des défauts et on écraserait
    // les réglages de l'équipe à la première sauvegarde.
    let serverConfig: CartographieModuleConfig | null = null;
    try {
      serverConfig = await pullServerConfig();
    } catch {
      // Partage injoignable : on se contente des valeurs par défaut.
    }

    const winner = serverConfig ?? normalize(null);
    if (serverConfig) {
      await SiralBridge.setData(CONFIG_KEY, winner);
    }

    this.cache = winner;
    return winner;
  }

  /** Charge une base FIABLE pour une écriture. Si la lecture a échoué, on
   *  refuse l'opération plutôt que d'écrire des valeurs par défaut par-dessus
   *  la vraie configuration (cause historique de la perte des pondérations). */
  private async loadForWrite(): Promise<CartographieModuleConfig> {
    if (this.cache) return this.cache;
    const stored = await SiralBridge.getData<CartographieModuleConfig | null>(
      CONFIG_KEY,
      null,
    );
    if (stored === null && SiralBridge.didReadFail(CONFIG_KEY)) {
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
    await SiralBridge.setData(CONFIG_KEY, next);
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
    return SiralBridge.flush(CONFIG_KEY);
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

  /** Mise à jour partielle de la pondération temporelle (ancienneté / continuité). */
  async updateTemporal(patch: Partial<CartographieTemporalConfig>): Promise<boolean> {
    const current = await this.loadForWrite();
    return this.save({
      ...current,
      temporal: { ...current.temporal, ...patch },
    });
  }

  /** Définit le poids de BASE associé à une catégorie d'infraction (clé = code
   *  StatCategory). Passer 0 supprime l'entrée pour rester clean. */
  async setCategoryWeight(categoryCode: string, weight: number): Promise<boolean> {
    const current = await this.loadForWrite();
    const next = { ...current.categoryWeights };
    if (!weight) {
      delete next[categoryCode];
    } else {
      next[categoryCode] = weight;
    }
    return this.save({ ...current, categoryWeights: next });
  }

  /** Définit le poids associé à un code NATINF. Passer 0 supprime l'entrée. */
  async setNatinfWeight(code: string, weight: number): Promise<boolean> {
    const current = await this.loadForWrite();
    const next = { ...current.natinfWeights };
    if (!weight) {
      delete next[code];
    } else {
      next[code] = weight;
    }
    return this.save({ ...current, natinfWeights: next });
  }

  /** Active/désactive l'ancrage zonal par service d'enquête. */
  async setGroupByService(enabled: boolean): Promise<boolean> {
    const current = await this.loadForWrite();
    return this.save({ ...current, groupByService: enabled });
  }

  /** Mise à jour partielle des paramètres d'espacement (avancés). */
  async updateLayout(patch: Partial<CartographieLayoutConfig>): Promise<boolean> {
    const current = await this.loadForWrite();
    return this.save({
      ...current,
      layout: { ...current.layout, ...patch },
    });
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
        await SiralBridge.setData(CONFIG_KEY, serverConfig);
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
