// utils/airConfigManager.ts
//
// Gestion de la configuration des délais du module AIR (seuils des alertes de
// convocation Procureur + seuils « mesures anciennes »).
//
// PARTAGÉE PAR TOUTE L'ÉQUIPE : la config vit dans un fichier serveur commun
// (`air-config`), pas dans les préférences par utilisateur. Tout le monde lit
// et écrit la même configuration ; quand un magistrat ajuste un délai, le
// changement se propage aux autres postes (pull au montage du module + sync
// périodique). Objet unique → fusion last-write-wins par `updatedAt`.
//
// Persistance locale via ElectronBridge sous la clé `airConvocationConfig`
// (cache hors-ligne + base de comparaison pour le merge). Si l'API de partage
// serveur est indisponible (ancien poste Electron), on retombe proprement sur
// une configuration locale.

import { ElectronBridge } from './electronBridge';
import { getCurrentUserInfo } from './dataSync/globalSyncCommon';
import {
  DEFAULT_AIR_CONVOCATION_CONFIG,
  type AIRConvocationConfig,
} from '@/types/airConfigTypes';

const CONFIG_KEY = 'airConvocationConfig';
const PERIODIC_SYNC_MS = 60_000;

/** `true` si l'API serveur de la config AIR partagée est disponible. */
function isShareAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullAIRConfig
    && !!window.electronAPI?.globalSync_pushAIRConfig;
}

/** Reconstruit une config valide à partir d'un blob potentiellement partiel
 *  (rétrocompat : un enregistrement antérieur peut manquer de champs). */
function normalize(stored: Partial<AIRConvocationConfig> | null): AIRConvocationConfig {
  return { ...DEFAULT_AIR_CONVOCATION_CONFIG, ...(stored || {}) };
}

/** Compare deux configs par leur `updatedAt`. Une config sans horodatage est
 *  considérée comme la plus ancienne possible. */
function ts(c: AIRConvocationConfig | null): number {
  return c ? Date.parse(c.updatedAt || '') || 0 : -1;
}

function pickNewest(
  a: AIRConvocationConfig | null,
  b: AIRConvocationConfig | null,
): AIRConvocationConfig | null {
  if (!a) return b;
  if (!b) return a;
  return ts(b) > ts(a) ? b : a;
}

async function pullServerConfig(): Promise<AIRConvocationConfig | null> {
  if (!window.electronAPI?.globalSync_pullAIRConfig) return null;
  const raw = await window.electronAPI.globalSync_pullAIRConfig();
  return raw ? normalize(raw) : null;
}

async function pushServerConfig(config: AIRConvocationConfig): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushAIRConfig) return false;
  return await window.electronAPI.globalSync_pushAIRConfig(config);
}

class AIRConfigManagerService {
  private cache: AIRConvocationConfig | null = null;
  private listeners = new Set<(config: AIRConvocationConfig) => void>();
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  // Comptage de références : le hook est monté par plusieurs écrans (dashboard
  // + paramètres). On ne stoppe la sync périodique qu'au dernier démontage.
  private activeConsumers = 0;
  // Une écriture locale n'a pas encore été confirmée côté serveur (à repousser
  // par la prochaine sync périodique si le partage était injoignable).
  private dirty = false;

  async load(): Promise<AIRConvocationConfig> {
    if (this.cache) return this.cache;
    const stored = await ElectronBridge.getData<Partial<AIRConvocationConfig> | null>(
      CONFIG_KEY,
      null,
    );
    // Lecture illisible (≠ config réellement absente) : défauts ÉPHÉMÈRES pour
    // l'affichage, sans mise en cache, pour qu'un appel ultérieur réessaie.
    if (stored === null && ElectronBridge.didReadFail(CONFIG_KEY)) {
      return normalize(null);
    }
    const localConfig = stored ? normalize(stored) : null;

    // Tirer la config partagée de l'équipe et garder la plus récente.
    let serverConfig: AIRConvocationConfig | null = null;
    try {
      serverConfig = await pullServerConfig();
    } catch {
      // Partage injoignable : on se contente de la config locale.
    }

    const winner = pickNewest(localConfig, serverConfig) || normalize(null);

    // Le serveur a une version plus récente (ou la 1re connue) → la persister
    // localement pour le hors-ligne et la prochaine comparaison.
    if (serverConfig && ts(serverConfig) > ts(localConfig)) {
      await ElectronBridge.setData(CONFIG_KEY, winner);
    }
    // Config présente localement mais pas (ou plus à jour) sur le serveur → à
    // remonter au partage à la prochaine sync.
    if (localConfig && ts(localConfig) > ts(serverConfig)) {
      this.dirty = true;
    }

    this.cache = winner;
    return winner;
  }

  /** Applique une mise à jour partielle, persiste localement et pousse au
   *  serveur commun. */
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
    this.dirty = true;
    await ElectronBridge.setData(CONFIG_KEY, next);
    this.emit(next);
    // Push immédiat vers le serveur commun (best-effort : si injoignable,
    // `dirty` reste à true et la sync périodique retentera).
    pushServerConfig(next)
      .then(ok => { if (ok) this.dirty = false; })
      .catch(() => {});
    // Écriture disque immédiate : ces réglages sont souvent modifiés puis on
    // quitte/recharge l'app aussitôt.
    return ElectronBridge.flush(CONFIG_KEY);
  }

  /** Reset complet aux valeurs par défaut. */
  async reset(): Promise<boolean> {
    return this.save({ ...DEFAULT_AIR_CONVOCATION_CONFIG });
  }

  // ─── Synchronisation avec le serveur commun ────────────────────────────────

  /** À appeler à l'ouverture du module AIR : pull initial + sync périodique
   *  pour récupérer les ajustements faits par les collègues. Ref-compté. */
  start(): void {
    this.activeConsumers++;
    this.startPeriodic();
    this.sync().catch(err => console.error('AIRConfigSync.initial', err));
  }

  stop(): void {
    this.activeConsumers = Math.max(0, this.activeConsumers - 1);
    if (this.activeConsumers === 0) this.stopPeriodic();
  }

  private startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('AIRConfigSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  private stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
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
      const serverConfig = await pullServerConfig();
      const local = this.cache;

      // Le serveur gagne → appliquer localement + notifier les abonnés (écran
      // Paramètres et dashboard se mettent à jour sans recharger l'app).
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
      console.error('❌ AIRConfigSync: sync échouée', error);
    }
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
