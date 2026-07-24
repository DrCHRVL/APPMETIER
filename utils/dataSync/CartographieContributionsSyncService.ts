// utils/dataSync/CartographieContributionsSyncService.ts
//
// Synchronisation des CONTRIBUTIONS cartographie : la projection minimale des
// dossiers (enquêtes des contentieux accessibles + dossiers d'instruction
// rattachés à un contentieux) de chaque utilisateur, agrégée dans un fichier
// serveur commun. C'est ce qui rend le module « commun à tous » :
//   - un collègue qui ajoute des noms / dossiers dans SON module instruction
//     et les rattache à un contentieux les voit apparaître chez tout le monde ;
//   - la carte couvre TOUS les contentieux, même ceux auxquels l'utilisateur
//     courant n'a pas accès (un collègue qui y a accès les publie).
//
// Fichier serveur : `cartographie-contributions.json`
//
// Confidentialité : on ne publie QUE la projection minimale (cf.
// CartoContributionSource) — jamais les notes perso, OPP, débats JLD ou pièces.
//
// Stratégie de fusion : chaque utilisateur n'écrit que SA propre entrée
// (clé `windowsUsername`). Pas de conflit par entité : « le plus récent par
// auteur gagne ». Les entrées plus vieilles que CONTRIB_TTL_MS sont élaguées
// pour borner la taille du fichier (utilisateur parti, poste abandonné…).

import type {
  CartographieContributionsSyncFile,
  CartoContributorEntry,
  CartoContributionSource,
} from '@/types/globalSyncTypes';
import type { Enquete } from '@/types/interfaces';
import type { MisEnExamen } from '@/types/instructionTypes';
import type { ContentieuxId } from '@/types/userTypes';
import type { EnqueteWithContext } from '@/utils/mindmapGraph';
import { useCartographieContributionsStore } from '@/stores/useCartographieContributionsStore';
import { buildMetadata, getCurrentUserInfo } from './globalSyncCommon';

const PUSH_DEBOUNCE_MS = 2000;
const PERIODIC_SYNC_MS = 60_000;
/** Au-delà, une contribution non rafraîchie est élaguée (poste abandonné). */
const CONTRIB_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function isAvailable(): boolean {
  return typeof window !== 'undefined'
    && !!window.electronAPI?.globalSync_pullCartographieContributions
    && !!window.electronAPI?.globalSync_pushCartographieContributions;
}

// ─── Projection (local → wire) ───────────────────────────────────────────────

/** Projette une source locale vers la forme minimale publiée sur le serveur. */
export function projectContributionSource(src: EnqueteWithContext): CartoContributionSource {
  const { enquete, contentieuxId, misEnExamen, condamnes } = src;
  return {
    contentieuxId,
    enqueteId: enquete.id,
    numero: enquete.numero,
    statut: enquete.statut,
    dateCreation: enquete.dateCreation,
    dateMiseAJour: enquete.dateMiseAJour,
    services: enquete.services,
    misEnCause: (enquete.misEnCause || []).map(m => {
      const mm = m as {
        id?: string | number; nom: string; statut?: string;
        isVictime?: boolean; isSuspect?: boolean; suspectRole?: string;
      };
      return {
        id: mm.id,
        nom: mm.nom,
        statut: mm.statut,
        isVictime: mm.isVictime,
        isSuspect: mm.isSuspect,
        suspectRole: mm.suspectRole,
      };
    }),
    misEnExamen: misEnExamen?.map(e => ({
      nom: e.nom,
      infractions: e.infractions?.map(i => ({
        natinfCode: i.natinfCode,
        qualification: i.qualification,
      })),
    })),
    condamnes: condamnes?.map(c => ({ nom: c.nom })),
  };
}

// ─── Reconstruction (wire → EnqueteWithContext) ──────────────────────────────

/** Reconstruit une source consommable par le moteur de graphe à partir du wire. */
function contributionToSource(c: CartoContributionSource): EnqueteWithContext {
  const pseudoEnquete = {
    id: c.enqueteId,
    numero: c.numero,
    statut: c.statut,
    dateCreation: c.dateCreation,
    dateMiseAJour: c.dateMiseAJour || c.dateCreation,
    services: c.services || [],
    actes: [],
    comptesRendus: [],
    documents: [],
    notes: '',
    tags: [],
    misEnCause: (c.misEnCause || []).map(m => ({
      id: m.id,
      nom: m.nom,
      statut: m.statut,
      isVictime: m.isVictime,
      isSuspect: m.isSuspect,
      suspectRole: m.suspectRole,
    })),
  } as unknown as Enquete;
  return {
    enquete: pseudoEnquete,
    contentieuxId: c.contentieuxId as ContentieuxId,
    misEnExamen: c.misEnExamen as unknown as MisEnExamen[] | undefined,
    condamnes: c.condamnes,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class CartographieContributionsSyncService {
  private static instance: CartographieContributionsSyncService;

  private localEntry: CartoContributorEntry | null = null;
  private serverVersion = 0;
  private dirty = false;

  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  static getInstance(): CartographieContributionsSyncService {
    if (!CartographieContributionsSyncService.instance) {
      CartographieContributionsSyncService.instance = new CartographieContributionsSyncService();
    }
    return CartographieContributionsSyncService.instance;
  }

  /** Démarre le pull initial + la synchro périodique (à l'ouverture du module). */
  start(): void {
    this.startPeriodic();
    this.sync().catch(err => console.error('CartoContributionsSync.initial', err));
  }

  stop(): void {
    this.stopPeriodic();
  }

  private startPeriodic(): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.sync().catch(err => console.error('CartoContributionsSync.periodic', err));
    }, PERIODIC_SYNC_MS);
  }

  private stopPeriodic(): void {
    if (this.periodicTimer) { clearInterval(this.periodicTimer); this.periodicTimer = null; }
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
  }

  /**
   * Déclare la contribution locale de l'utilisateur courant (projection de ses
   * sources). Appelée par le module Cartographie à chaque évolution de ses
   * données. Programme un push débouncé si la contribution a réellement changé.
   */
  setLocalContribution(
    windowsUsername: string | null | undefined,
    displayName: string | undefined,
    sources: EnqueteWithContext[],
  ): void {
    if (!windowsUsername) return;
    const enquetes: CartoContributionSource[] = [];
    const instructions: CartoContributionSource[] = [];
    for (const s of sources) {
      const projected = projectContributionSource(s);
      if (projected.statut === 'instruction') instructions.push(projected);
      else enquetes.push(projected);
    }
    const nextPayload = JSON.stringify({ enquetes, instructions });
    const prevPayload = this.localEntry
      ? JSON.stringify({ enquetes: this.localEntry.enquetes, instructions: this.localEntry.instructions })
      : null;
    if (nextPayload === prevPayload) return; // rien de neuf → pas de push

    this.localEntry = {
      windowsUsername,
      displayName,
      updatedAt: Date.now(),
      enquetes,
      instructions,
    };
    this.dirty = true;
    this.schedulePush();
  }

  private schedulePush(): void {
    if (!isAvailable()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(err => console.error('CartoContributionsSync.schedulePush', err));
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

  async sync(): Promise<void> {
    if (!isAvailable()) return;
    if (this.inFlight) { await this.inFlight; return; }
    this.inFlight = this.performSync().finally(() => { this.inFlight = null; });
    await this.inFlight;
  }

  // ─── Implémentation ────────────────────────────────────────────────────────

  private async performSync(): Promise<void> {
    try {
      const serverFile = await this.pullServer();
      this.serverVersion = serverFile?.version ?? this.serverVersion;

      const myUser = this.localEntry?.windowsUsername;
      const cutoff = Date.now() - CONTRIB_TTL_MS;

      // Fusion : la version la plus récente par auteur, mon entrée prioritaire.
      const byUser = new Map<string, CartoContributorEntry>();
      for (const c of serverFile?.contributors || []) {
        if (!c?.windowsUsername) continue;
        const prev = byUser.get(c.windowsUsername);
        if (!prev || (c.updatedAt || 0) > (prev.updatedAt || 0)) byUser.set(c.windowsUsername, c);
      }
      if (this.localEntry) byUser.set(this.localEntry.windowsUsername, this.localEntry);

      // Élagage des contributions périmées (sauf la mienne, toujours conservée).
      const merged: CartoContributorEntry[] = [];
      for (const c of byUser.values()) {
        if (c.windowsUsername === myUser || (c.updatedAt || 0) >= cutoff) merged.push(c);
      }

      // Met à jour l'état mémoire : sources distantes (hors la mienne, déjà locale).
      const remote: EnqueteWithContext[] = [];
      for (const c of merged) {
        if (c.windowsUsername === myUser) continue;
        for (const s of c.enquetes || []) remote.push(contributionToSource(s));
        for (const s of c.instructions || []) remote.push(contributionToSource(s));
      }
      useCartographieContributionsStore.getState().setRemoteSources(remote);

      // Push si nécessaire : mutation locale, fichier absent, ou élagage effectué.
      const needsPush =
        this.dirty
        || !serverFile
        || !this.contributorsEqual(merged, serverFile.contributors || []);

      if (needsPush) {
        const user = await getCurrentUserInfo();
        const payload: CartographieContributionsSyncFile = {
          ...buildMetadata(this.serverVersion, user),
          contributors: merged,
        };
        const ok = await this.pushServer(payload);
        if (ok) { this.serverVersion = payload.version; this.dirty = false; }
      }
    } catch (error) {
      console.error('❌ CartoContributionsSync: sync échouée', error);
    }
  }

  /** Compare deux listes de contributions par (auteur, updatedAt) — ordre indifférent. */
  private contributorsEqual(a: CartoContributorEntry[], b: CartoContributorEntry[]): boolean {
    if (a.length !== b.length) return false;
    const key = (list: CartoContributorEntry[]) =>
      list
        .map(c => `${c.windowsUsername}:${c.updatedAt || 0}`)
        .sort()
        .join('|');
    return key(a) === key(b);
  }

  private async pullServer(): Promise<CartographieContributionsSyncFile | null> {
    if (!window.electronAPI?.globalSync_pullCartographieContributions) return null;
    return (await window.electronAPI.globalSync_pullCartographieContributions()) || null;
  }

  private async pushServer(payload: CartographieContributionsSyncFile): Promise<boolean> {
    if (!window.electronAPI?.globalSync_pushCartographieContributions) return false;
    return await window.electronAPI.globalSync_pushCartographieContributions(payload);
  }
}

export const cartographieContributionsSyncService = CartographieContributionsSyncService.getInstance();
