// utils/dataSync/AlertSyncService.ts
//
// Synchronisation dédiée des alertes (règles + validations).
// Fichier serveur : P:\...\10_App METIER\alerts-data.json
// Backups        : P:\...\10_App METIER\admin\backups\alerts-data-*.json

import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { AlertRule, AlertValidations, AlertValidation } from '@/types/interfaces';
import { AlertSyncFile } from '@/types/globalSyncTypes';
import { getCurrentUserInfo, buildMetadata, emitSyncCompleted } from './globalSyncCommon';

const PUSH_DEBOUNCE_MS = 800;
const PERIODIC_SYNC_MS = 30_000;

function isAlertSyncAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullAlerts
    && !!window.electronAPI?.globalSync_pushAlerts;
}

// ─── Fusion des règles : union par ID, local prioritaire ─────────────────────
function mergeRulesById(local: AlertRule[], server: AlertRule[]): AlertRule[] {
  const map = new Map<string, AlertRule>();
  for (const rule of server) {
    if (rule && rule.id) map.set(rule.id, rule);
  }
  for (const rule of local) {
    if (rule && rule.id) map.set(rule.id, rule);
  }
  return Array.from(map.values());
}

// ─── Fusion des validations : timestamp le plus récent gagne ─────────────────
function mergeValidations(local: AlertValidations, server: AlertValidations): AlertValidations {
  const out: AlertValidations = { ...server };
  for (const [key, localEntry] of Object.entries(local)) {
    const serverEntry = out[key] as AlertValidation | undefined;
    if (!serverEntry) {
      out[key] = localEntry;
      continue;
    }
    const a = localEntry.validatedAt || '';
    const b = serverEntry.validatedAt || '';
    out[key] = a >= b ? localEntry : serverEntry;
  }
  return out;
}

async function readLocalRules(): Promise<AlertRule[]> {
  const raw = await ElectronBridge.getData<any>(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, []);
  return Array.isArray(raw) ? raw : [];
}

async function readLocalValidations(): Promise<AlertValidations> {
  const raw = await ElectronBridge.getData<any>(APP_CONFIG.STORAGE_KEYS.ALERT_VALIDATIONS, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function writeLocalRules(rules: AlertRule[]): Promise<void> {
  await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_RULES, rules);
}

async function writeLocalValidations(validations: AlertValidations): Promise<void> {
  await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ALERT_VALIDATIONS, validations);
}

async function pullServer(): Promise<AlertSyncFile | null> {
  if (!window.electronAPI?.globalSync_pullAlerts) return null;
  return (await window.electronAPI.globalSync_pullAlerts()) || null;
}

async function pushServer(payload: AlertSyncFile): Promise<boolean> {
  if (!window.electronAPI?.globalSync_pushAlerts) return false;
  return await window.electronAPI.globalSync_pushAlerts(payload);
}

async function pullLegacyAlerts(): Promise<{ rules: AlertRule[]; validations: AlertValidations }> {
  try {
    if (!window.electronAPI?.globalSync_readLegacyAppData) return { rules: [], validations: {} };
    const legacy = await window.electronAPI.globalSync_readLegacyAppData();
    if (!legacy) return { rules: [], validations: {} };
    return {
      rules: Array.isArray(legacy.alertRules) ? legacy.alertRules : [],
      validations: (legacy.alertValidations && typeof legacy.alertValidations === 'object' && !Array.isArray(legacy.alertValidations))
        ? legacy.alertValidations
        : {},
    };
  } catch {
    return { rules: [], validations: {} };
  }
}

function rulesDiffer(a: AlertRule[], b: AlertRule[]): boolean {
  if (a.length !== b.length) return true;
  const mapB = new Map(b.map(r => [r.id, r]));
  return a.some(r => {
    const match = mapB.get(r.id);
    return !match || JSON.stringify(match) !== JSON.stringify(r);
  });
}

function validationsDiffer(a: AlertValidations, b: AlertValidations): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return true;
  const setB = new Set(kb);
  if (!ka.every(k => setB.has(k))) return true;
  return ka.some(k => (a[k] as AlertValidation)?.validatedAt !== (b[k] as AlertValidation)?.validatedAt);
}

export class AlertSyncService {
  private static instance: AlertSyncService;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private serverVersion = 0;
  private initialized = false;
  private inFlight: Promise<void> | null = null;
  private dirty = false;

  static getInstance(): AlertSyncService {
    if (!AlertSyncService.instance) {
      AlertSyncService.instance = new AlertSyncService();
    }
    return AlertSyncService.instance;
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('AlertSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  async sync(): Promise<void> {
    if (!isAlertSyncAvailable()) return;
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
      const [serverFile, localRules, localValidations, legacy] = await Promise.all([
        pullServer(),
        readLocalRules(),
        readLocalValidations(),
        pullLegacyAlerts(),
      ]);

      const serverRules = serverFile?.alertRules ?? [];
      const serverValidations = serverFile?.alertValidations ?? {};
      this.serverVersion = serverFile?.version ?? 0;

      // Migration one-shot : si alerts-data.json n'existe pas, on intègre
      // aussi le contenu de l'ancien app-data.json racine.
      const mergedRules = serverFile
        ? mergeRulesById(localRules, serverRules)
        : mergeRulesById(mergeRulesById(localRules, legacy.rules), serverRules);

      const mergedValidations = serverFile
        ? mergeValidations(localValidations, serverValidations)
        : mergeValidations(mergeValidations(localValidations, legacy.validations), serverValidations);

      const localChanged =
        rulesDiffer(mergedRules, localRules) || validationsDiffer(mergedValidations, localValidations);

      if (localChanged) {
        await writeLocalRules(mergedRules);
        await writeLocalValidations(mergedValidations);
        emitSyncCompleted('alerts');
      }

      const hasNewForServer =
        !serverFile ||
        this.dirty ||
        rulesDiffer(mergedRules, serverRules) ||
        validationsDiffer(mergedValidations, serverValidations);

      if (hasNewForServer) {
        const user = await getCurrentUserInfo();
        const payload: AlertSyncFile = {
          ...buildMetadata(this.serverVersion, user),
          alertRules: mergedRules,
          alertValidations: mergedValidations,
        };
        const ok = await pushServer(payload);
        if (ok) {
          this.serverVersion = payload.version;
          this.dirty = false;
        }
      } else {
        this.dirty = false;
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ AlertSync: sync échouée', error);
    }
  }

  schedulePush(): void {
    this.dirty = true;
    if (!isAlertSyncAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('AlertSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }

  async flushPending(): Promise<void> {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      await this.sync();
    } else if (this.inFlight) {
      await this.inFlight;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const alertSyncService = AlertSyncService.getInstance();
