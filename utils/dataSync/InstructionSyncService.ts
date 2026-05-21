// utils/dataSync/InstructionSyncService.ts
//
// Synchronisation réseau du module instruction, PRIVÉE par utilisateur.
//
// Les dossiers d'instruction restent propres à chaque magistrat : ils ne
// sont jamais partagés avec d'autres utilisateurs. Ce service se contente
// de sauvegarder les dossiers de l'utilisateur courant dans un fichier
// dédié sur le dossier réseau qu'il a choisi (paramètres > Instruction),
// et de les re-synchroniser entre ses différents postes.
//
// Stockage local :
//   - dossiers   : `instructions__<windowsUsername>`  (clé partagée avec useInstructions)
//   - tombstones : `instructions_deleted__<windowsUsername>`
// Fichier réseau : `<networkPath>/<safeUser>-instructions.json`
//
// Fusion (un seul auteur, plusieurs postes) :
//   - union par id de dossier, la `dateMiseAJour` la plus récente gagne ;
//   - tombstone => le dossier est supprimé, sauf s'il a été modifié après
//     la suppression (réapparition volontaire).

import { ElectronBridge } from '../electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { getCurrentUserInfo } from './globalSyncCommon';
import type { DossierInstruction } from '@/types/instructionTypes';
import type { InstructionSyncFile, InstructionTombstone } from '@/types/instructionSyncTypes';

const PUSH_DEBOUNCE_MS = 5000;
const PERIODIC_SYNC_MS = 120_000;

export interface InstructionSyncStatus {
  configured: boolean;
  isOnline: boolean;
  isSync: boolean;
  lastSuccessfulSync: string | null;
}

export interface InstructionSyncResult {
  success: boolean;
  error?: string;
  pushed?: number;
  pulled?: number;
}

function dossiersKey(username: string): string {
  return `${APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS}__${username}`;
}

function tombstonesKey(username: string): string {
  return `${APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS}_deleted__${username}`;
}

function dossierTime(d: DossierInstruction): number {
  return Date.parse(d.dateMiseAJour || d.dateCreation || '') || 0;
}

/** Sérialisation normalisée (triée par id) pour détecter un changement réel. */
function serializeDossiers(dossiers: DossierInstruction[]): string {
  return JSON.stringify([...dossiers].sort((a, b) => a.id - b.id));
}

function mergeTombstones(
  a: InstructionTombstone[],
  b: InstructionTombstone[],
): InstructionTombstone[] {
  const byId = new Map<number, InstructionTombstone>();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.id !== 'number') continue;
    const existing = byId.get(t.id);
    if (!existing || Date.parse(t.deletedAt) > Date.parse(existing.deletedAt)) {
      byId.set(t.id, { id: t.id, deletedAt: t.deletedAt });
    }
  }
  return Array.from(byId.values());
}

interface MergeResult {
  dossiers: DossierInstruction[];
  tombstones: InstructionTombstone[];
}

function merge(
  localDossiers: DossierInstruction[],
  localTombstones: InstructionTombstone[],
  server: InstructionSyncFile | null,
): MergeResult {
  const byId = new Map<number, DossierInstruction>();
  for (const d of localDossiers) {
    if (d && typeof d.id === 'number') byId.set(d.id, d);
  }
  if (server?.dossiers) {
    for (const d of server.dossiers) {
      if (!d || typeof d.id !== 'number') continue;
      const existing = byId.get(d.id);
      if (!existing || dossierTime(d) > dossierTime(existing)) {
        byId.set(d.id, d);
      }
    }
  }

  const tombstones = mergeTombstones(localTombstones, server?.deletedIds || []);
  const tombById = new Map(tombstones.map(t => [t.id, t]));

  // Applique les tombstones : retire un dossier supprimé sauf s'il a été
  // modifié après la date de suppression (réapparition volontaire).
  const survivors: DossierInstruction[] = [];
  for (const d of byId.values()) {
    const t = tombById.get(d.id);
    if (t && dossierTime(d) <= Date.parse(t.deletedAt)) continue;
    survivors.push(d);
  }

  // Purge les tombstones dont le dossier a été ressuscité (sinon ils
  // resupprimeraient indéfiniment la même fiche).
  const survivorIds = new Set(survivors.map(d => d.id));
  const cleanTombstones = tombstones.filter(t => !survivorIds.has(t.id));

  return { dossiers: survivors, tombstones: cleanTombstones };
}

export class InstructionSyncService {
  private static instance: InstructionSyncService;

  private username: string | null = null;
  private networkPath: string | null = null;

  private isOnline = false;
  private isSync = false;
  private lastSuccessfulSync: string | null = null;
  private version = 0;

  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private inFlight: Promise<void> | null = null;

  static getInstance(): InstructionSyncService {
    if (!InstructionSyncService.instance) {
      InstructionSyncService.instance = new InstructionSyncService();
    }
    return InstructionSyncService.instance;
  }

  private isAvailable(): boolean {
    return typeof window !== 'undefined'
      && !!window.electronAPI?.instructionSync_pull
      && !!window.electronAPI?.instructionSync_push;
  }

  /**
   * Configure le service (utilisateur + dossier réseau). Démarre la synchro
   * périodique si tout est renseigné, sinon l'arrête. À rappeler quand
   * l'utilisateur connecté change ou quand il modifie son chemin réseau.
   */
  configure(username: string | null, networkPath: string | null | undefined): void {
    const path = (networkPath || '').trim() || null;
    const changed = this.username !== username || this.networkPath !== path;
    this.username = username || null;
    this.networkPath = path;

    if (!this.username || !this.networkPath || !this.isAvailable()) {
      this.stopPeriodic();
      this.isOnline = false;
      return;
    }

    if (changed) {
      // Sync initiale + démarrage du timer
      this.sync().catch(err => console.error('InstructionSync.configure', err));
      this.startPeriodic();
    }
  }

  getStatus(): InstructionSyncStatus {
    return {
      configured: !!this.username && !!this.networkPath,
      isOnline: this.isOnline,
      isSync: this.isSync,
      lastSuccessfulSync: this.lastSuccessfulSync,
    };
  }

  startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('InstructionSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  stopPeriodic(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  /** Marque l'état modifié et programme un push réseau (débounce). */
  schedulePush(): void {
    this.dirty = true;
    if (!this.username || !this.networkPath || !this.isAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('InstructionSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }

  /** Enregistre la suppression d'un dossier (tombstone) pour propagation. */
  async recordDeletion(id: number): Promise<void> {
    if (!this.username) return;
    const key = tombstonesKey(this.username);
    const existing = await ElectronBridge.getData<InstructionTombstone[]>(key, []);
    const arr = Array.isArray(existing) ? existing : [];
    if (!arr.some(t => t.id === id)) {
      arr.push({ id, deletedAt: new Date().toISOString() });
      await ElectronBridge.setData(key, arr);
    }
  }

  /** Sync manuelle (bouton « Synchroniser »). Retourne un résultat affichable. */
  async triggerSync(): Promise<InstructionSyncResult> {
    if (!this.username || !this.networkPath) {
      return { success: false, error: 'Aucun dossier réseau configuré' };
    }
    if (!this.isAvailable()) {
      return { success: false, error: 'Synchronisation indisponible' };
    }
    // Évite un chevauchement avec une synchro périodique déjà en cours.
    if (this.inFlight) {
      try { await this.inFlight; } catch { /* ignore */ }
    }
    const online = await this.checkAccess();
    if (!online) {
      return { success: false, error: 'Dossier réseau inaccessible' };
    }
    try {
      const stats = await this.performSync();
      return { success: true, ...stats };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Erreur inconnue' };
    }
  }

  async sync(): Promise<void> {
    if (!this.isAvailable() || !this.username || !this.networkPath) return;
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    this.inFlight = (async () => {
      const online = await this.checkAccess();
      if (!online) return;
      try {
        await this.performSync();
      } catch (error) {
        console.error('❌ InstructionSync: sync échouée', error);
      }
    })().finally(() => { this.inFlight = null; });
    await this.inFlight;
  }

  private async checkAccess(): Promise<boolean> {
    try {
      if (!window.electronAPI?.instructionSync_check || !this.networkPath) {
        this.isOnline = false;
        return false;
      }
      this.isOnline = await window.electronAPI.instructionSync_check(this.networkPath);
      return this.isOnline;
    } catch {
      this.isOnline = false;
      return false;
    }
  }

  private async performSync(): Promise<{ pushed: number; pulled: number }> {
    const username = this.username!;
    const networkPath = this.networkPath!;

    this.isSync = true;
    try {
      const [localDossiers, localTombstones, server] = await Promise.all([
        ElectronBridge.getData<DossierInstruction[]>(dossiersKey(username), []),
        ElectronBridge.getData<InstructionTombstone[]>(tombstonesKey(username), []),
        window.electronAPI!.instructionSync_pull!(networkPath, username),
      ]);

      const local = Array.isArray(localDossiers) ? localDossiers : [];
      const localTomb = Array.isArray(localTombstones) ? localTombstones : [];

      this.version = Math.max(this.version, server?.version || 0);

      const { dossiers, tombstones } = merge(local, localTomb, server);

      const localChanged = serializeDossiers(dossiers) !== serializeDossiers(local);
      const serverChanged =
        !server || serializeDossiers(dossiers) !== serializeDossiers(server.dossiers || []);

      // Écrire en local si la fusion a apporté des nouveautés du serveur
      if (localChanged) {
        await ElectronBridge.setData(dossiersKey(username), dossiers);
        await ElectronBridge.setData(tombstonesKey(username), tombstones);
        this.emitLocalChanged();
      } else if (tombstones.length !== localTomb.length) {
        await ElectronBridge.setData(tombstonesKey(username), tombstones);
      }

      // Pousser vers le serveur si le local a changé ou si un push est en attente
      let pushed = 0;
      if (serverChanged || this.dirty) {
        const user = await getCurrentUserInfo();
        this.version += 1;
        const payload: InstructionSyncFile = {
          version: this.version,
          updatedAt: new Date().toISOString(),
          updatedBy: user.displayName,
          computerName: user.computerName,
          windowsUsername: username,
          dossiers,
          deletedIds: tombstones,
        };
        const ok = await window.electronAPI!.instructionSync_push!(networkPath, username, payload);
        if (ok) {
          this.dirty = false;
          pushed = dossiers.length;
        }
      }

      this.lastSuccessfulSync = new Date().toISOString();
      return { pushed, pulled: localChanged ? dossiers.length : 0 };
    } finally {
      this.isSync = false;
    }
  }

  /** Liste les backups réseau de l'utilisateur (du plus récent au plus ancien). */
  async listBackups(): Promise<string[]> {
    if (!this.username || !this.networkPath || !window.electronAPI?.instructionSync_listBackups) {
      return [];
    }
    try {
      return await window.electronAPI.instructionSync_listBackups(this.networkPath, this.username);
    } catch {
      return [];
    }
  }

  /** Restaure les dossiers depuis un backup réseau (écrase local + serveur). */
  async restoreFromBackup(filename: string): Promise<boolean> {
    if (!this.username || !this.networkPath || !window.electronAPI?.instructionSync_readBackup) {
      return false;
    }
    try {
      const backup = await window.electronAPI.instructionSync_readBackup(
        this.networkPath, this.username, filename,
      );
      if (!backup) return false;
      const dossiers = Array.isArray(backup.dossiers) ? backup.dossiers : [];
      await ElectronBridge.setData(dossiersKey(this.username), dossiers);
      await ElectronBridge.setData(tombstonesKey(this.username), backup.deletedIds || []);
      this.emitLocalChanged();
      this.dirty = true;
      await this.sync();
      return true;
    } catch (error) {
      console.error('❌ InstructionSync: restauration échouée', error);
      return false;
    }
  }

  private emitLocalChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('instructions-sync-completed'));
  }
}

export const instructionSyncService = InstructionSyncService.getInstance();
