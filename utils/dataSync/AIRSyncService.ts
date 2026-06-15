// utils/dataSync/AIRSyncService.ts
//
// Synchronisation réseau du module AIR (mesures AIR), PRIVÉE par utilisateur.
//
// Les mesures AIR restent propres à chaque utilisateur : elles ne sont jamais
// partagées par défaut. Ce service sauvegarde les mesures de l'utilisateur
// courant dans un coffre chiffré dédié (`air-<safeUser>` côté serveur web, ou
// `<safeUser>-air.json` sur le dossier réseau en desktop), les re-synchronise
// entre ses différents postes, et permet — sur déclaration RÉCIPROQUE — de
// fusionner ses mesures avec celles d'autres utilisateurs (même mécanique que
// le module instruction).
//
// Stockage local :
//   - mesures    : `air_mesures__<windowsUsername>`         (clé partagée avec useAIR)
//   - tombstones : `air_mesures_deleted__<windowsUsername>`
//   - partage    : `air_mesures_share__<windowsUsername>`
//
// Fusion (un ou plusieurs auteurs, plusieurs postes) :
//   - union par `refAEM`, la `dateMiseAJour` la plus récente gagne ;
//   - tombstone => la mesure est supprimée, sauf si elle a été modifiée après
//     la suppression (réapparition volontaire).

import { ElectronBridge } from '../electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { getCurrentUserInfo } from './globalSyncCommon';
import type { AIRImportData } from '@/types/interfaces';
import type { AIRSyncFile, AIRTombstone } from '@/types/airSyncTypes';

const PUSH_DEBOUNCE_MS = 5000;
const PERIODIC_SYNC_MS = 120_000;

export interface AIRSyncStatus {
  configured: boolean;
  isOnline: boolean;
  isSync: boolean;
  lastSuccessfulSync: string | null;
}

export interface AIRSyncResult {
  success: boolean;
  error?: string;
  pushed?: number;
  pulled?: number;
}

function mesuresKey(username: string): string {
  return `${APP_CONFIG.STORAGE_KEYS.AIR_MESURES}__${username}`;
}

function tombstonesKey(username: string): string {
  return `${APP_CONFIG.STORAGE_KEYS.AIR_MESURES}_deleted__${username}`;
}

/** Clé de stockage local de la configuration de partage (partenaires + refus). */
function shareConfigKey(username: string): string {
  return `${APP_CONFIG.STORAGE_KEYS.AIR_MESURES}_share__${username}`;
}

/** Normalise un username comme côté desktop (fichiers `<user>-air.json`). */
function sanitizeUser(u: string): string {
  return String(u || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}

/** Configuration de partage locale d'un utilisateur. */
export interface AIRShareConfig {
  /** Partenaires que j'accepte (= j'invite / j'accepte leur invitation). */
  partners: string[];
  /** Invitations entrantes que j'ai explicitement refusées (pour ne plus les afficher). */
  declined: string[];
}

export type AIRShareLinkStatus = 'shared' | 'pending';

export interface AIRShareState {
  /** Capacité de partage disponible (toujours vrai si la synchro réseau est dispo). */
  enabled: boolean;
  /** Mes partenaires déclarés, avec le statut de la liaison. */
  partners: Array<{ username: string; status: AIRShareLinkStatus }>;
  /** Invitations entrantes (quelqu'un m'a cité, je ne l'ai pas encore accepté ni refusé). */
  incoming: string[];
  /** Membres effectifs du groupe partagé (moi + partenaires réciproques). */
  groupMembers: string[];
}

/** Construit la clé de fichier réseau partagé pour un groupe de membres. */
function sharedGroupKey(members: string[]): string {
  const uniq = Array.from(new Set(members.map(sanitizeUser))).filter(Boolean).sort();
  return `shared__${uniq.join('__')}`.slice(0, 64);
}

/** Compare deux ensembles de usernames (insensible à l'ordre, après normalisation). */
function sameUserSet(a: string[], b: string[]): boolean {
  const sa = Array.from(new Set(a.map(sanitizeUser))).sort();
  const sb = Array.from(new Set(b.map(sanitizeUser))).sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function mesureTime(m: AIRImportData): number {
  return Date.parse(m.dateMiseAJour || '') || 0;
}

/** Sérialisation normalisée (triée par refAEM) pour détecter un changement réel. */
function serializeMesures(mesures: AIRImportData[]): string {
  return JSON.stringify([...mesures].sort((a, b) => String(a.refAEM).localeCompare(String(b.refAEM))));
}

function mergeTombstones(
  a: AIRTombstone[],
  b: AIRTombstone[],
): AIRTombstone[] {
  const byRef = new Map<string, AIRTombstone>();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.refAEM !== 'string') continue;
    const existing = byRef.get(t.refAEM);
    if (!existing || Date.parse(t.deletedAt) > Date.parse(existing.deletedAt)) {
      byRef.set(t.refAEM, { refAEM: t.refAEM, deletedAt: t.deletedAt });
    }
  }
  return Array.from(byRef.values());
}

interface MergeResult {
  mesures: AIRImportData[];
  tombstones: AIRTombstone[];
}

/**
 * Fusion multi-sources (partage entre utilisateurs). Union par `refAEM` (la
 * `dateMiseAJour` la plus récente gagne), puis application des tombstones.
 */
function mergeMany(
  sources: Array<AIRImportData[] | undefined>,
  tombstoneSets: Array<AIRTombstone[] | undefined>,
): MergeResult {
  const byRef = new Map<string, AIRImportData>();
  for (const src of sources) {
    if (!src) continue;
    for (const m of src) {
      if (!m || typeof m.refAEM !== 'string' || !m.refAEM) continue;
      const existing = byRef.get(m.refAEM);
      if (!existing || mesureTime(m) > mesureTime(existing)) byRef.set(m.refAEM, m);
    }
  }
  let tombstones: AIRTombstone[] = [];
  for (const ts of tombstoneSets) tombstones = mergeTombstones(tombstones, ts || []);
  const tombByRef = new Map(tombstones.map(t => [t.refAEM, t]));

  const survivors: AIRImportData[] = [];
  for (const m of byRef.values()) {
    const t = tombByRef.get(m.refAEM);
    if (t && mesureTime(m) <= Date.parse(t.deletedAt)) continue;
    survivors.push(m);
  }
  const survivorRefs = new Set(survivors.map(m => m.refAEM));
  const cleanTombstones = tombstones.filter(t => !survivorRefs.has(t.refAEM));
  return { mesures: survivors, tombstones: cleanTombstones };
}

export class AIRSyncService {
  private static instance: AIRSyncService;

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

  // ── Partage du module entre utilisateurs ──
  private shareConfig: AIRShareConfig = { partners: [], declined: [] };
  /** Membres réciproques effectifs (moi + partenaires qui me citent en retour). */
  private groupMembers: string[] = [];
  /** Invitations entrantes détectées au dernier sync (m'ont cité, pas encore traité). */
  private incoming: string[] = [];

  static getInstance(): AIRSyncService {
    if (!AIRSyncService.instance) {
      AIRSyncService.instance = new AIRSyncService();
    }
    return AIRSyncService.instance;
  }

  private isAvailable(): boolean {
    return typeof window !== 'undefined'
      && !!window.electronAPI?.airSync_pull
      && !!window.electronAPI?.airSync_push;
  }

  /**
   * Mode web (SIRAL serveur) : le serveur chiffré est le magasin de référence.
   * Aucun dossier réseau Windows n'est requis — le pont web ignore le `basePath`
   * et route les coffres `air-<user>` directement vers /api/vaults.
   */
  private isWeb(): boolean {
    return typeof window !== 'undefined'
      && (window as { __SIRAL_WEB__?: boolean }).__SIRAL_WEB__ === true;
  }

  /**
   * Configure le service (utilisateur + dossier réseau). En mode web, le serveur
   * SIRAL fait office de dossier réseau : un chemin sentinelle est forcé dès
   * qu'un utilisateur est connecté, pour que la synchro et le partage s'activent
   * sans configuration.
   */
  configure(username: string | null, networkPath: string | null | undefined): void {
    const path = this.isWeb()
      ? (username ? 'siral://serveur' : null)
      : ((networkPath || '').trim() || null);
    const changed = this.username !== username || this.networkPath !== path;
    this.username = username || null;
    this.networkPath = path;

    if (changed && this.username) {
      void this.loadShareConfig();
    }

    if (!this.username || !this.networkPath || !this.isAvailable()) {
      this.stopPeriodic();
      this.isOnline = false;
      return;
    }

    if (changed) {
      this.sync().catch(err => console.error('AIRSync.configure', err));
      this.startPeriodic();
    }
  }

  getStatus(): AIRSyncStatus {
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
      this.sync().catch(err => console.error('AIRSync.periodic', err));
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
      this.sync().catch(err => console.error('AIRSync.schedulePush', err));
    }, PUSH_DEBOUNCE_MS);
  }

  /** Enregistre la suppression d'une mesure (tombstone) pour propagation. */
  async recordDeletion(refAEM: string): Promise<void> {
    if (!this.username || !refAEM) return;
    const key = tombstonesKey(this.username);
    const existing = await ElectronBridge.getData<AIRTombstone[]>(key, []);
    const arr = Array.isArray(existing) ? existing : [];
    if (!arr.some(t => t.refAEM === refAEM)) {
      arr.push({ refAEM, deletedAt: new Date().toISOString() });
      await ElectronBridge.setData(key, arr);
    }
  }

  /** Sync manuelle (bouton « Synchroniser »). Retourne un résultat affichable. */
  async triggerSync(): Promise<AIRSyncResult> {
    if (!this.username || !this.networkPath) {
      return { success: false, error: 'Aucun dossier réseau configuré' };
    }
    if (!this.isAvailable()) {
      return { success: false, error: 'Synchronisation indisponible' };
    }
    if (this.inFlight) {
      try { await this.inFlight; } catch { /* ignore */ }
    }
    const online = await this.checkAccess();
    if (!online) {
      return { success: false, error: 'Serveur inaccessible' };
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
        console.error('❌ AIRSync: sync échouée', error);
      }
    })().finally(() => { this.inFlight = null; });
    await this.inFlight;
  }

  private async checkAccess(): Promise<boolean> {
    try {
      if (!window.electronAPI?.airSync_check || !this.networkPath) {
        this.isOnline = false;
        return false;
      }
      this.isOnline = await window.electronAPI.airSync_check(this.networkPath);
      return this.isOnline;
    } catch {
      this.isOnline = false;
      return false;
    }
  }

  private async performSync(): Promise<{ pushed: number; pulled: number }> {
    const username = this.username!;
    const networkPath = this.networkPath!;
    const api = window.electronAPI!;
    const mySan = sanitizeUser(username);

    this.isSync = true;
    try {
      const [localMesures, localTombstones, personalServer] = await Promise.all([
        ElectronBridge.getData<AIRImportData[]>(mesuresKey(username), []),
        ElectronBridge.getData<AIRTombstone[]>(tombstonesKey(username), []),
        api.airSync_pull!(networkPath, username),
      ]);

      const local = Array.isArray(localMesures) ? localMesures : [];
      const localTomb = Array.isArray(localTombstones) ? localTombstones : [];

      // ── Partage : partenaires réciproques (double consentement) ──
      const declined = new Set(this.shareConfig.declined.map(sanitizeUser));
      const myPartners = this.shareConfig.partners
        .map(sanitizeUser)
        .filter(p => p && p !== mySan);

      const reciprocal: string[] = [];
      const partnerSources: Array<AIRImportData[] | undefined> = [];
      const partnerTombs: Array<AIRTombstone[] | undefined> = [];
      await Promise.all(myPartners.map(async (p) => {
        try {
          const pf = await api.airSync_pull!(networkPath, p);
          if (pf && Array.isArray(pf.shareWith) && pf.shareWith.map(sanitizeUser).includes(mySan)) {
            reciprocal.push(p);
            partnerSources.push(pf.mesures);
            partnerTombs.push(pf.deletedRefs);
          }
        } catch { /* partenaire injoignable : on l'ignore pour ce tour */ }
      }));

      // ── Découverte des invitations entrantes (desktop : énumération) ──
      const incoming: string[] = [];
      if (api.airSync_listUsers) {
        try {
          const others = (await api.airSync_listUsers(networkPath))
            .map(sanitizeUser)
            .filter(u => u && u !== mySan && !myPartners.includes(u) && !declined.has(u));
          await Promise.all(others.map(async (u) => {
            try {
              const f = await api.airSync_pull!(networkPath, u);
              if (f && Array.isArray(f.shareWith) && f.shareWith.map(sanitizeUser).includes(mySan)) {
                incoming.push(u);
              }
            } catch { /* ignore */ }
          }));
        } catch { /* listUsers indisponible : pas de découverte auto */ }
      }
      this.incoming = incoming;

      const groupActive = reciprocal.length > 0;
      const members = groupActive
        ? Array.from(new Set([mySan, ...reciprocal])).sort()
        : [mySan];
      this.groupMembers = members;
      const dataKey = groupActive ? sharedGroupKey(members) : username;

      const sharedServer = groupActive
        ? await api.airSync_pull!(networkPath, dataKey)
        : null;

      this.version = Math.max(
        this.version,
        personalServer?.version || 0,
        sharedServer?.version || 0,
      );

      const { mesures, tombstones } = mergeMany(
        [local, personalServer?.mesures, sharedServer?.mesures, ...partnerSources],
        [localTomb, personalServer?.deletedRefs, sharedServer?.deletedRefs, ...partnerTombs],
      );

      const localChanged = serializeMesures(mesures) !== serializeMesures(local);
      const personalChanged =
        !personalServer
        || serializeMesures(mesures) !== serializeMesures(personalServer.mesures || [])
        || !sameUserSet(personalServer.shareWith || [], myPartners);
      const sharedChanged =
        groupActive
        && (!sharedServer || serializeMesures(mesures) !== serializeMesures(sharedServer.mesures || []));

      // Écrire en local si la fusion a apporté des nouveautés
      if (localChanged) {
        await ElectronBridge.setData(mesuresKey(username), mesures);
        await ElectronBridge.setData(tombstonesKey(username), tombstones);
        this.emitLocalChanged();
      } else if (tombstones.length !== localTomb.length) {
        await ElectronBridge.setData(tombstonesKey(username), tombstones);
      }

      // Pousser : coffre personnel (porte mon `shareWith` = handshake) + éventuel
      // coffre de groupe partagé (données communes au groupe).
      let pushed = 0;
      if (personalChanged || sharedChanged || this.dirty) {
        const user = await getCurrentUserInfo();
        this.version += 1;
        const payload: AIRSyncFile = {
          version: this.version,
          updatedAt: new Date().toISOString(),
          updatedBy: user.displayName,
          computerName: user.computerName,
          windowsUsername: username,
          mesures,
          deletedRefs: tombstones,
          shareWith: myPartners,
        };
        const okPersonal = await api.airSync_push!(networkPath, username, payload);
        let okShared = true;
        if (groupActive) {
          okShared = await api.airSync_push!(networkPath, dataKey, payload);
        }
        if (okPersonal && okShared) {
          this.dirty = false;
          pushed = mesures.length;
        }
      }

      this.lastSuccessfulSync = new Date().toISOString();
      this.emitShareChanged();
      return { pushed, pulled: localChanged ? mesures.length : 0 };
    } finally {
      this.isSync = false;
    }
  }

  /** Liste les backups réseau de l'utilisateur (du plus récent au plus ancien). */
  async listBackups(): Promise<string[]> {
    if (!this.username || !this.networkPath || !window.electronAPI?.airSync_listBackups) {
      return [];
    }
    try {
      return await window.electronAPI.airSync_listBackups(this.networkPath, this.username);
    } catch {
      return [];
    }
  }

  /** Restaure les mesures depuis un backup réseau (écrase local + serveur). */
  async restoreFromBackup(filename: string): Promise<boolean> {
    if (!this.username || !this.networkPath || !window.electronAPI?.airSync_readBackup) {
      return false;
    }
    try {
      const backup = await window.electronAPI.airSync_readBackup(
        this.networkPath, this.username, filename,
      );
      if (!backup) return false;
      const mesures = Array.isArray(backup.mesures) ? backup.mesures : [];
      await ElectronBridge.setData(mesuresKey(this.username), mesures);
      await ElectronBridge.setData(tombstonesKey(this.username), backup.deletedRefs || []);
      this.emitLocalChanged();
      this.dirty = true;
      await this.sync();
      return true;
    } catch (error) {
      console.error('❌ AIRSync: restauration échouée', error);
      return false;
    }
  }

  private emitLocalChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('air-sync-completed'));
  }

  private emitShareChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('air-share-changed'));
  }

  // ──────────────────────────────────────────────
  // PARTAGE DU MODULE ENTRE UTILISATEURS
  // ──────────────────────────────────────────────

  private async loadShareConfig(): Promise<void> {
    if (!this.username) { this.shareConfig = { partners: [], declined: [] }; return; }
    try {
      const raw = await ElectronBridge.getData<AIRShareConfig>(
        shareConfigKey(this.username),
        { partners: [], declined: [] },
      );
      this.shareConfig = {
        partners: Array.isArray(raw?.partners) ? raw.partners.map(sanitizeUser).filter(Boolean) : [],
        declined: Array.isArray(raw?.declined) ? raw.declined.map(sanitizeUser).filter(Boolean) : [],
      };
    } catch {
      this.shareConfig = { partners: [], declined: [] };
    }
    this.emitShareChanged();
  }

  private async saveShareConfig(): Promise<void> {
    if (!this.username) return;
    await ElectronBridge.setData(shareConfigKey(this.username), this.shareConfig);
    this.emitShareChanged();
  }

  /** État de partage courant (pour l'écran Paramètres). */
  getShareState(): AIRShareState {
    const mySan = sanitizeUser(this.username || '');
    const memberSet = new Set(this.groupMembers);
    const partners = this.shareConfig.partners
      .map(sanitizeUser)
      .filter(p => p && p !== mySan)
      .map(username => ({
        username,
        status: (memberSet.has(username) ? 'shared' : 'pending') as AIRShareLinkStatus,
      }));
    return {
      enabled: this.isAvailable(),
      partners,
      incoming: [...this.incoming],
      groupMembers: [...this.groupMembers],
    };
  }

  /** Remplace la liste des partenaires déclarés puis resynchronise. */
  async setPartners(usernames: string[]): Promise<void> {
    const mySan = sanitizeUser(this.username || '');
    const clean = Array.from(new Set(usernames.map(sanitizeUser))).filter(p => p && p !== mySan);
    this.shareConfig.partners = clean;
    this.shareConfig.declined = this.shareConfig.declined.filter(d => !clean.includes(sanitizeUser(d)));
    this.dirty = true;
    await this.saveShareConfig();
    await this.sync().catch(() => {});
  }

  /** Ajoute (ou accepte) un partenaire de partage. */
  async addPartner(username: string): Promise<void> {
    const u = sanitizeUser(username);
    if (!u) return;
    if (!this.shareConfig.partners.map(sanitizeUser).includes(u)) {
      await this.setPartners([...this.shareConfig.partners, u]);
    }
  }

  /** Accepte une invitation entrante (équivaut à ajouter le partenaire). */
  async acceptInvite(username: string): Promise<void> {
    await this.addPartner(username);
  }

  /** Retire un partenaire (rompt le partage de mon côté). */
  async removePartner(username: string): Promise<void> {
    const u = sanitizeUser(username);
    await this.setPartners(this.shareConfig.partners.filter(p => sanitizeUser(p) !== u));
  }

  /** Refuse une invitation entrante : ne la propose plus tant qu'elle n'est pas relancée. */
  async declineInvite(username: string): Promise<void> {
    const u = sanitizeUser(username);
    if (!u) return;
    if (!this.shareConfig.declined.map(sanitizeUser).includes(u)) {
      this.shareConfig.declined.push(u);
    }
    this.incoming = this.incoming.filter(i => sanitizeUser(i) !== u);
    await this.saveShareConfig();
  }
}

export const airSyncService = AIRSyncService.getInstance();
