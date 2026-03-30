// utils/contentieuxManager.ts — Gestion du chargement sélectif des données par contentieux
//
// Chaque contentieux a ses propres données (enquêtes, tags custom, alertes, etc.)
// stockées dans un dossier séparé sur le serveur.
// Ce manager gère le chargement, la sauvegarde et l'accès aux données
// en fonction des contentieux autorisés pour l'utilisateur.

import { ElectronBridge } from './electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { Enquete, AlertRule, Alert, AlertValidation, VisualAlertRule } from '@/types/interfaces';
import { ResultatAudience } from '@/types/audienceTypes';

// ──────────────────────────────────────────────
// TYPES INTERNES
// ──────────────────────────────────────────────

/** Données d'un contentieux stockées localement */
export interface ContentieuxData {
  enquetes: Enquete[];
  customTags: Record<string, any>;
  alertRules: AlertRule[];
  alerts: Alert[];
  alertValidations: Record<string, AlertValidation>;
  visualAlertRules: VisualAlertRule[];
  audienceResultats: Record<string, ResultatAudience>;
}

/** État de chargement d'un contentieux */
interface ContentieuxState {
  definition: ContentieuxDefinition;
  data: ContentieuxData;
  isLoaded: boolean;
  syncMode: 'read_write' | 'read_only';
  lastLoadedAt: string | null;
}

// Préfixe des clés de stockage local par contentieux
function storageKey(contentieuxId: ContentieuxId, key: string): string {
  return `ctx_${contentieuxId}_${key}`;
}

// ──────────────────────────────────────────────
// CONTENTIEUX MANAGER
// ──────────────────────────────────────────────

export class ContentieuxManager {
  private static instance: ContentieuxManager;
  private states = new Map<ContentieuxId, ContentieuxState>();
  private listeners: Array<(contentieuxId: ContentieuxId) => void> = [];

  private constructor() {}

  public static getInstance(): ContentieuxManager {
    if (!ContentieuxManager.instance) {
      ContentieuxManager.instance = new ContentieuxManager();
    }
    return ContentieuxManager.instance;
  }

  // ──────────────────────────────────────────────
  // INITIALISATION
  // ──────────────────────────────────────────────

  /**
   * Charge les données des contentieux autorisés.
   * Appelé une fois au login, après que le UserManager a résolu les permissions.
   */
  public async loadContentieux(
    definitions: ContentieuxDefinition[],
    accessibleIds: ContentieuxId[],
    syncModes: Map<ContentieuxId, 'read_write' | 'read_only' | 'none'>
  ): Promise<void> {
    for (const def of definitions) {
      if (!accessibleIds.includes(def.id)) continue;

      const mode = syncModes.get(def.id);
      if (mode === 'none') continue;

      const data = await this.loadContentieuxData(def.id);

      this.states.set(def.id, {
        definition: def,
        data,
        isLoaded: true,
        syncMode: mode || 'read_only',
        lastLoadedAt: new Date().toISOString(),
      });
    }
  }

  // ──────────────────────────────────────────────
  // ACCESSEURS
  // ──────────────────────────────────────────────

  /** Récupère les données d'un contentieux. Retourne null si non chargé ou non autorisé. */
  public getData(contentieuxId: ContentieuxId): ContentieuxData | null {
    const state = this.states.get(contentieuxId);
    if (!state || !state.isLoaded) return null;
    return state.data;
  }

  /** Récupère les enquêtes d'un contentieux */
  public getEnquetes(contentieuxId: ContentieuxId): Enquete[] {
    return this.getData(contentieuxId)?.enquetes || [];
  }

  /** Récupère les enquêtes de TOUS les contentieux chargés */
  public getAllEnquetes(): Map<ContentieuxId, Enquete[]> {
    const result = new Map<ContentieuxId, Enquete[]>();
    for (const [id, state] of this.states) {
      if (state.isLoaded) {
        result.set(id, state.data.enquetes);
      }
    }
    return result;
  }

  /** Récupère les tags custom d'un contentieux */
  public getCustomTags(contentieuxId: ContentieuxId): Record<string, any> {
    return this.getData(contentieuxId)?.customTags || {};
  }

  /** Récupère les résultats d'audience d'un contentieux */
  public getAudienceResultats(contentieuxId: ContentieuxId): Record<string, ResultatAudience> {
    return this.getData(contentieuxId)?.audienceResultats || {};
  }

  /** Vérifie si un contentieux est chargé */
  public isLoaded(contentieuxId: ContentieuxId): boolean {
    return this.states.get(contentieuxId)?.isLoaded ?? false;
  }

  /** Retourne la liste des contentieux chargés */
  public getLoadedContentieuxIds(): ContentieuxId[] {
    return Array.from(this.states.keys()).filter(id => this.states.get(id)?.isLoaded);
  }

  /** Retourne le mode de sync d'un contentieux */
  public getSyncMode(contentieuxId: ContentieuxId): 'read_write' | 'read_only' {
    return this.states.get(contentieuxId)?.syncMode || 'read_only';
  }

  // ──────────────────────────────────────────────
  // MUTATIONS (écriture locale)
  // ──────────────────────────────────────────────

  /** Met à jour les enquêtes d'un contentieux */
  public async setEnquetes(contentieuxId: ContentieuxId, enquetes: Enquete[]): Promise<boolean> {
    const state = this.states.get(contentieuxId);
    if (!state || state.syncMode === 'read_only') return false;

    state.data.enquetes = enquetes;
    await this.saveContentieuxKey(contentieuxId, 'enquetes', enquetes);
    this.notifyListeners(contentieuxId);
    return true;
  }

  /** Met à jour les tags custom d'un contentieux */
  public async setCustomTags(contentieuxId: ContentieuxId, tags: Record<string, any>): Promise<boolean> {
    const state = this.states.get(contentieuxId);
    if (!state || state.syncMode === 'read_only') return false;

    state.data.customTags = tags;
    await this.saveContentieuxKey(contentieuxId, 'customTags', tags);
    this.notifyListeners(contentieuxId);
    return true;
  }

  /** Met à jour les règles d'alertes d'un contentieux */
  public async setAlertRules(contentieuxId: ContentieuxId, rules: AlertRule[]): Promise<boolean> {
    const state = this.states.get(contentieuxId);
    if (!state || state.syncMode === 'read_only') return false;

    state.data.alertRules = rules;
    await this.saveContentieuxKey(contentieuxId, 'alertRules', rules);
    this.notifyListeners(contentieuxId);
    return true;
  }

  /** Met à jour les résultats d'audience d'un contentieux */
  public async setAudienceResultats(
    contentieuxId: ContentieuxId,
    resultats: Record<string, ResultatAudience>
  ): Promise<boolean> {
    const state = this.states.get(contentieuxId);
    if (!state || state.syncMode === 'read_only') return false;

    state.data.audienceResultats = resultats;
    await this.saveContentieuxKey(contentieuxId, 'audienceResultats', resultats);
    this.notifyListeners(contentieuxId);
    return true;
  }

  /**
   * Remplace toutes les données d'un contentieux (après un sync pull).
   * Ne vérifie PAS syncMode car le sync a besoin de pouvoir écrire
   * les données reçues du serveur même en read_only.
   */
  public async replaceData(contentieuxId: ContentieuxId, data: Partial<ContentieuxData>): Promise<void> {
    const state = this.states.get(contentieuxId);
    if (!state) return;

    if (data.enquetes !== undefined) {
      state.data.enquetes = data.enquetes;
      await this.saveContentieuxKey(contentieuxId, 'enquetes', data.enquetes);
    }
    if (data.customTags !== undefined) {
      state.data.customTags = data.customTags;
      await this.saveContentieuxKey(contentieuxId, 'customTags', data.customTags);
    }
    if (data.alertRules !== undefined) {
      state.data.alertRules = data.alertRules;
      await this.saveContentieuxKey(contentieuxId, 'alertRules', data.alertRules);
    }
    if (data.alerts !== undefined) {
      state.data.alerts = data.alerts;
      await this.saveContentieuxKey(contentieuxId, 'alerts', data.alerts);
    }
    if (data.alertValidations !== undefined) {
      state.data.alertValidations = data.alertValidations;
      await this.saveContentieuxKey(contentieuxId, 'alertValidations', data.alertValidations);
    }
    if (data.visualAlertRules !== undefined) {
      state.data.visualAlertRules = data.visualAlertRules;
      await this.saveContentieuxKey(contentieuxId, 'visualAlertRules', data.visualAlertRules);
    }
    if (data.audienceResultats !== undefined) {
      state.data.audienceResultats = data.audienceResultats;
      await this.saveContentieuxKey(contentieuxId, 'audienceResultats', data.audienceResultats);
    }

    this.notifyListeners(contentieuxId);
  }

  // ──────────────────────────────────────────────
  // LISTENERS
  // ──────────────────────────────────────────────

  public addListener(listener: (contentieuxId: ContentieuxId) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(contentieuxId: ContentieuxId): void {
    for (const listener of this.listeners) {
      listener(contentieuxId);
    }
  }

  // ──────────────────────────────────────────────
  // STOCKAGE LOCAL
  // ──────────────────────────────────────────────

  private async loadContentieuxData(contentieuxId: ContentieuxId): Promise<ContentieuxData> {
    const [enquetes, customTags, alertRules, alerts, alertValidations, visualAlertRules, audienceResultats] =
      await Promise.all([
        ElectronBridge.getData(storageKey(contentieuxId, 'enquetes'), [] as Enquete[]),
        ElectronBridge.getData(storageKey(contentieuxId, 'customTags'), {} as Record<string, any>),
        ElectronBridge.getData(storageKey(contentieuxId, 'alertRules'), APP_CONFIG.DEFAULT_ALERT_RULES),
        ElectronBridge.getData(storageKey(contentieuxId, 'alerts'), [] as Alert[]),
        ElectronBridge.getData(storageKey(contentieuxId, 'alertValidations'), {} as Record<string, AlertValidation>),
        ElectronBridge.getData(storageKey(contentieuxId, 'visualAlertRules'), [] as VisualAlertRule[]),
        ElectronBridge.getData(storageKey(contentieuxId, 'audienceResultats'), {} as Record<string, ResultatAudience>),
      ]);

    return { enquetes, customTags, alertRules, alerts, alertValidations, visualAlertRules, audienceResultats };
  }

  private async saveContentieuxKey<T>(contentieuxId: ContentieuxId, key: string, value: T): Promise<void> {
    await ElectronBridge.setData(storageKey(contentieuxId, key), value);
  }
}
