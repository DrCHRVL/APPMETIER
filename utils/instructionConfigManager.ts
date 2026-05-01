// utils/instructionConfigManager.ts
//
// Gestion de la configuration du module Instruction (cabinets configurables).
// Stockage via ElectronBridge sous la clé `instructionConfig`.

import { ElectronBridge } from './electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { DEFAULT_CABINETS } from '@/config/instructionConfig';
import type { Cabinet, InstructionModuleConfig } from '@/types/instructionTypes';

const CONFIG_KEY = APP_CONFIG.STORAGE_KEYS.INSTRUCTION_CONFIG;

/** Crée une config par défaut */
const buildDefaultConfig = (): InstructionModuleConfig => ({
  cabinets: DEFAULT_CABINETS,
  version: 1,
  updatedAt: new Date().toISOString(),
});

/** Sanitize un libellé en id (slug) */
export const cabinetSlug = (label: string): string =>
  label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

class InstructionConfigManagerService {
  private cache: InstructionModuleConfig | null = null;

  /** Charge la config (avec cache + initialisation au besoin) */
  async load(): Promise<InstructionModuleConfig> {
    if (this.cache) return this.cache;

    const stored = await ElectronBridge.getData<InstructionModuleConfig | null>(
      CONFIG_KEY,
      null,
    );

    if (!stored || !Array.isArray(stored.cabinets) || stored.cabinets.length === 0) {
      const fresh = buildDefaultConfig();
      await this.save(fresh);
      this.cache = fresh;
      return fresh;
    }

    this.cache = stored;
    return stored;
  }

  /** Sauvegarde et invalide le cache */
  async save(config: InstructionModuleConfig): Promise<boolean> {
    const next: InstructionModuleConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    const ok = await ElectronBridge.setData(CONFIG_KEY, next);
    if (ok) this.cache = next;
    return ok;
  }

  /** Force le rechargement depuis le storage */
  async refresh(): Promise<InstructionModuleConfig> {
    this.cache = null;
    return this.load();
  }

  /** Liste les cabinets activés (triés par order) */
  async getEnabledCabinets(): Promise<Cabinet[]> {
    const config = await this.load();
    return config.cabinets
      .filter(c => c.enabled !== false)
      .sort((a, b) => a.order - b.order);
  }

  /** Liste tous les cabinets (pour l'admin) */
  async getAllCabinets(): Promise<Cabinet[]> {
    const config = await this.load();
    return [...config.cabinets].sort((a, b) => a.order - b.order);
  }

  /** Récupère un cabinet par id */
  async getCabinetById(id: string): Promise<Cabinet | undefined> {
    const config = await this.load();
    return config.cabinets.find(c => c.id === id);
  }

  /** Ajoute un cabinet (id auto si vide) */
  async addCabinet(input: Omit<Cabinet, 'order'> & { order?: number }): Promise<{ ok: boolean; reason?: string }> {
    const config = await this.load();
    const id = input.id?.trim() || cabinetSlug(input.label);
    if (!id) return { ok: false, reason: 'ID invalide' };
    if (!input.label.trim()) return { ok: false, reason: 'Libellé requis' };
    if (config.cabinets.some(c => c.id === id)) {
      return { ok: false, reason: 'Un cabinet avec cet ID existe déjà' };
    }
    const order = input.order ?? config.cabinets.length + 1;
    const next: InstructionModuleConfig = {
      ...config,
      cabinets: [
        ...config.cabinets,
        {
          id,
          label: input.label.trim(),
          color: input.color,
          magistratParDefaut: input.magistratParDefaut?.trim() || undefined,
          order,
          enabled: input.enabled !== false,
        },
      ],
    };
    const ok = await this.save(next);
    return { ok };
  }

  /** Met à jour un cabinet */
  async updateCabinet(id: string, updates: Partial<Omit<Cabinet, 'id'>>): Promise<boolean> {
    const config = await this.load();
    const idx = config.cabinets.findIndex(c => c.id === id);
    if (idx === -1) return false;
    const next: InstructionModuleConfig = {
      ...config,
      cabinets: config.cabinets.map((c, i) =>
        i === idx ? { ...c, ...updates, id: c.id } : c,
      ),
    };
    return this.save(next);
  }

  /**
   * Supprime un cabinet. Refuse si c'est le dernier cabinet activé.
   * Note : cette action ne touche pas aux dossiers existants — leur
   * `cabinetId` deviendra orphelin. À l'UI de proposer une réaffectation.
   */
  async removeCabinet(id: string): Promise<{ ok: boolean; reason?: string }> {
    const config = await this.load();
    const remaining = config.cabinets.filter(c => c.id !== id);
    if (remaining.filter(c => c.enabled !== false).length === 0) {
      return { ok: false, reason: 'Impossible de supprimer le dernier cabinet actif' };
    }
    const next: InstructionModuleConfig = { ...config, cabinets: remaining };
    const ok = await this.save(next);
    return { ok };
  }

  /** Active / désactive un cabinet */
  async toggleCabinet(id: string, enabled: boolean): Promise<{ ok: boolean; reason?: string }> {
    const config = await this.load();
    if (!enabled) {
      const otherActives = config.cabinets.filter(c => c.id !== id && c.enabled !== false);
      if (otherActives.length === 0) {
        return { ok: false, reason: 'Au moins un cabinet doit rester activé' };
      }
    }
    const ok = await this.updateCabinet(id, { enabled });
    return { ok };
  }
}

export const InstructionConfigManager = new InstructionConfigManagerService();
