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

/** Clé de stockage local de la configuration de partage (partenaires + refus). */
function shareConfigKey(username: string): string {
  return `${APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS}_share__${username}`;
}

/** Normalise un username comme côté desktop (fichiers `<user>-instructions.json`). */
function sanitizeUser(u: string): string {
  return String(u || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}

/** Configuration de partage locale d'un utilisateur. */
export interface InstructionShareConfig {
  /** Partenaires que j'accepte (= j'invite / j'accepte leur invitation). */
  partners: string[];
  /** Invitations entrantes que j'ai explicitement refusées (pour ne plus les afficher). */
  declined: string[];
}

export type InstructionShareLinkStatus = 'shared' | 'pending';

export interface InstructionShareState {
  /** Capacité de partage disponible (toujours vrai si la synchro réseau est dispo). */
  enabled: boolean;
  /** Mes partenaires déclarés, avec le statut de la liaison. */
  partners: Array<{ username: string; status: InstructionShareLinkStatus }>;
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

/**
 * Fusion multi-sources (partage entre magistrats). Union par id de dossier (la
 * `dateMiseAJour` la plus récente gagne), puis application des tombstones.
 * Modèle « 1+1 = 2 » : purement additif, aucune déduplication par parquet —
 * deux dossiers de même n° de parquet coexistent (cf. parquetDisplay côté UI).
 */
function mergeMany(
  sources: Array<DossierInstruction[] | undefined>,
  tombstoneSets: Array<InstructionTombstone[] | undefined>,
): MergeResult {
  const byId = new Map<number, DossierInstruction>();
  for (const src of sources) {
    if (!src) continue;
    for (const d of src) {
      if (!d || typeof d.id !== 'number') continue;
      const existing = byId.get(d.id);
      if (!existing || dossierTime(d) > dossierTime(existing)) byId.set(d.id, d);
    }
  }
  let tombstones: InstructionTombstone[] = [];
  for (const ts of tombstoneSets) tombstones = mergeTombstones(tombstones, ts || []);
  const tombById = new Map(tombstones.map(t => [t.id, t]));

  const survivors: DossierInstruction[] = [];
  for (const d of byId.values()) {
    const t = tombById.get(d.id);
    if (t && dossierTime(d) <= Date.parse(t.deletedAt)) continue;
    survivors.push(d);
  }
  const survivorIds = new Set(survivors.map(d => d.id));
  const cleanTombstones = tombstones.filter(t => !survivorIds.has(t.id));
  return { dossiers: survivors, tombstones: cleanTombstones };
}

/**
 * Calcule, pour une liste de dossiers, le n° de parquet à AFFICHER en
 * désambiguïsant les doublons : si plusieurs dossiers portent le même n° de
 * parquet (cas d'une fusion entre magistrats), les occurrences suivantes
 * reçoivent un suffixe « (2) », « (3) »… La correction reste humaine ensuite.
 * Retourne une Map id → libellé d'affichage (seulement pour les dossiers en doublon).
 */
export function parquetDisplayMap(dossiers: Array<{ id: number; numeroParquet?: string }>): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  // Ordre stable par id pour que le « (2) » tombe toujours sur le même dossier.
  for (const d of [...dossiers].sort((a, b) => a.id - b.id)) {
    const pq = (d.numeroParquet || '').trim();
    if (!pq) continue;
    const n = (seen.get(pq) || 0) + 1;
    seen.set(pq, n);
    if (n > 1) out.set(d.id, `${pq} (${n})`);
  }
  return out;
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

  // ── Partage du module entre magistrats ──
  private shareConfig: InstructionShareConfig = { partners: [], declined: [] };
  /** Membres réciproques effectifs (moi + partenaires qui me citent en retour). */
  private groupMembers: string[] = [];
  /** Invitations entrantes détectées au dernier sync (m'ont cité, pas encore traité). */
  private incoming: string[] = [];

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

    if (changed && this.username) {
      void this.loadShareConfig();
    }

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
    const api = window.electronAPI!;
    const mySan = sanitizeUser(username);

    this.isSync = true;
    try {
      const [localDossiers, localTombstones, personalServer] = await Promise.all([
        ElectronBridge.getData<DossierInstruction[]>(dossiersKey(username), []),
        ElectronBridge.getData<InstructionTombstone[]>(tombstonesKey(username), []),
        api.instructionSync_pull!(networkPath, username),
      ]);

      const local = Array.isArray(localDossiers) ? localDossiers : [];
      const localTomb = Array.isArray(localTombstones) ? localTombstones : [];

      // ── Partage : partenaires réciproques (double consentement) ──
      const declined = new Set(this.shareConfig.declined.map(sanitizeUser));
      const myPartners = this.shareConfig.partners
        .map(sanitizeUser)
        .filter(p => p && p !== mySan);

      const reciprocal: string[] = [];
      const partnerSources: Array<DossierInstruction[] | undefined> = [];
      const partnerTombs: Array<InstructionTombstone[] | undefined> = [];
      await Promise.all(myPartners.map(async (p) => {
        try {
          const pf = await api.instructionSync_pull!(networkPath, p);
          if (pf && Array.isArray(pf.shareWith) && pf.shareWith.map(sanitizeUser).includes(mySan)) {
            reciprocal.push(p);
            partnerSources.push(pf.dossiers);
            partnerTombs.push(pf.deletedIds);
          }
        } catch { /* partenaire injoignable : on l'ignore pour ce tour */ }
      }));

      // ── Découverte des invitations entrantes (desktop : énumération) ──
      const incoming: string[] = [];
      if (api.instructionSync_listUsers) {
        try {
          const others = (await api.instructionSync_listUsers(networkPath))
            .map(sanitizeUser)
            .filter(u => u && u !== mySan && !myPartners.includes(u) && !declined.has(u));
          await Promise.all(others.map(async (u) => {
            try {
              const f = await api.instructionSync_pull!(networkPath, u);
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
        ? await api.instructionSync_pull!(networkPath, dataKey)
        : null;

      this.version = Math.max(
        this.version,
        personalServer?.version || 0,
        sharedServer?.version || 0,
      );

      const { dossiers, tombstones } = mergeMany(
        [local, personalServer?.dossiers, sharedServer?.dossiers, ...partnerSources],
        [localTomb, personalServer?.deletedIds, sharedServer?.deletedIds, ...partnerTombs],
      );

      const localChanged = serializeDossiers(dossiers) !== serializeDossiers(local);
      const personalChanged =
        !personalServer
        || serializeDossiers(dossiers) !== serializeDossiers(personalServer.dossiers || [])
        || !sameUserSet(personalServer.shareWith || [], myPartners);
      const sharedChanged =
        groupActive
        && (!sharedServer || serializeDossiers(dossiers) !== serializeDossiers(sharedServer.dossiers || []));

      // Écrire en local si la fusion a apporté des nouveautés
      if (localChanged) {
        await ElectronBridge.setData(dossiersKey(username), dossiers);
        await ElectronBridge.setData(tombstonesKey(username), tombstones);
        this.emitLocalChanged();
      } else if (tombstones.length !== localTomb.length) {
        await ElectronBridge.setData(tombstonesKey(username), tombstones);
      }

      // Pousser : fichier personnel (porte mon `shareWith` = handshake) + éventuel
      // fichier de groupe partagé (données communes aux magistrats du groupe).
      let pushed = 0;
      if (personalChanged || sharedChanged || this.dirty) {
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
          shareWith: myPartners,
        };
        const okPersonal = await api.instructionSync_push!(networkPath, username, payload);
        let okShared = true;
        if (groupActive) {
          okShared = await api.instructionSync_push!(networkPath, dataKey, payload);
        }
        if (okPersonal && okShared) {
          this.dirty = false;
          pushed = dossiers.length;
        }
      }

      this.lastSuccessfulSync = new Date().toISOString();
      this.emitShareChanged();
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

  private emitShareChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('instruction-share-changed'));
  }

  // ──────────────────────────────────────────────
  // PARTAGE DU MODULE ENTRE MAGISTRATS
  // ──────────────────────────────────────────────

  private async loadShareConfig(): Promise<void> {
    if (!this.username) { this.shareConfig = { partners: [], declined: [] }; return; }
    try {
      const raw = await ElectronBridge.getData<InstructionShareConfig>(
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
  getShareState(): InstructionShareState {
    const mySan = sanitizeUser(this.username || '');
    const memberSet = new Set(this.groupMembers);
    const partners = this.shareConfig.partners
      .map(sanitizeUser)
      .filter(p => p && p !== mySan)
      .map(username => ({
        username,
        status: (memberSet.has(username) ? 'shared' : 'pending') as InstructionShareLinkStatus,
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
    // Un partenaire ré-ajouté ne doit plus être considéré comme refusé.
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

export const instructionSyncService = InstructionSyncService.getInstance();
