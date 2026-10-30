// utils/dataSync/EntraideSyncService.ts
//
// Registre PARTAGÉ du module Entraide internationale : un seul coffre chiffré
// `entraide` (périmètre global du trousseau), lu et écrit par tous les
// utilisateurs du module — greffe et magistrats voient le même registre.
//
// Copie locale : clé `entraide` (IndexedDB) — l'écran reste utilisable hors
// ligne et repart de là au démarrage.
//
// Fusion (plusieurs postes, plusieurs utilisateurs) :
//   - demandes, autorités, services : union par `id`, la `dateMiseAJour`
//     la plus récente gagne ; signataires : par `username` ;
//   - tombstones : une suppression l'emporte sur toute version antérieure
//     (une fiche modifiée APRÈS sa suppression réapparaît — geste volontaire) ;
//   - une lecture serveur qui ÉCHOUE n'est jamais confondue avec un coffre
//     vide : on n'écrit pas tant que l'état serveur n'est pas connu.

import { SiralBridge } from '../siralBridge';
import { APP_CONFIG } from '@/config/constants';
import { getCurrentUserInfo } from './globalSyncCommon';
import { migrerServices, SERVICES_DEPART } from '@/utils/entraide/logique';
import type {
  AutoriteEtrangere,
  DemandeEntraide,
  EntraideData,
  EntraideSyncFile,
  EntraideTombstone,
  ServiceEnqueteur,
  SignataireEntraide,
} from '@/types/entraideTypes';

const PUSH_DEBOUNCE_MS = 1500;
const PERIODIC_SYNC_MS = 60_000;

export const ENTRAIDE_VIDE: EntraideData = { demandes: [], autorites: [], services: [], signataires: [], tombstones: [] };

type AvecDate = { dateMiseAJour?: string };

function t(x: AvecDate | undefined): number {
  return Date.parse(x?.dateMiseAJour || '') || 0;
}

function fusionnerParCle<T extends AvecDate>(a: T[], b: T[], cle: (x: T) => string): T[] {
  const m = new Map<string, T>();
  for (const x of [...a, ...b]) {
    if (!x) continue;
    const k = cle(x);
    if (!k) continue;
    const cur = m.get(k);
    if (!cur || t(x) > t(cur)) m.set(k, x);
  }
  return Array.from(m.values());
}

function fusionnerTombstones(a: EntraideTombstone[], b: EntraideTombstone[]): EntraideTombstone[] {
  const m = new Map<string, EntraideTombstone>();
  for (const x of [...a, ...b]) {
    if (!x?.id) continue;
    const cur = m.get(x.id);
    if (!cur || Date.parse(x.deletedAt) > Date.parse(cur.deletedAt)) m.set(x.id, x);
  }
  return Array.from(m.values());
}

/** Fusion pure de deux états (exportée pour les tests et le connecteur). */
export function fusionnerEntraide(a: EntraideData, b: EntraideData): EntraideData {
  const tombstones = fusionnerTombstones(a.tombstones || [], b.tombstones || []);
  const morts = new Map(tombstones.map((x) => [x.id, Date.parse(x.deletedAt) || 0]));
  const vivant = (x: { id: string } & AvecDate) => !morts.has(x.id) || t(x) > (morts.get(x.id) || 0);
  return {
    demandes: fusionnerParCle<DemandeEntraide>(a.demandes || [], b.demandes || [], (x) => x.id).filter(vivant),
    autorites: fusionnerParCle<AutoriteEtrangere>(a.autorites || [], b.autorites || [], (x) => x.id).filter(vivant),
    services: fusionnerParCle<ServiceEnqueteur>(a.services || [], b.services || [], (x) => x.id).filter(vivant),
    signataires: fusionnerParCle<SignataireEntraide>(a.signataires || [], b.signataires || [], (x) => x.username),
    tombstones,
  };
}

/** Empreinte d'un état : détecte un vrai changement sans comparer à la main. */
function empreinte(d: EntraideData): string {
  const ids = <T>(xs: T[], k: (x: T) => string) => xs.map((x) => `${k(x)}@${t(x as AvecDate)}`).sort().join(',');
  return [
    ids(d.demandes, (x) => x.id),
    ids(d.autorites, (x) => x.id),
    ids(d.services, (x) => x.id),
    ids(d.signataires, (x) => x.username),
    d.tombstones.map((x) => `${x.id}@${x.deletedAt}`).sort().join(','),
  ].join('|');
}

function normaliser(raw: unknown): EntraideData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<EntraideData>;
  return {
    demandes: Array.isArray(r.demandes) ? r.demandes : [],
    autorites: Array.isArray(r.autorites) ? r.autorites : [],
    services: Array.isArray(r.services) ? r.services : [],
    signataires: Array.isArray(r.signataires) ? r.signataires : [],
    tombstones: Array.isArray(r.tombstones) ? r.tombstones : [],
  };
}

export type EntraideStatut = { charge: boolean; enLigne: boolean; derniereSynchro: string | null; erreur: string | null };

class EntraideSyncService {
  private data: EntraideData = ENTRAIDE_VIDE;
  private statut: EntraideStatut = { charge: false, enLigne: false, derniereSynchro: null, erreur: null };
  private listeners = new Set<() => void>();
  private actif = false;
  private chargement: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private periodic: ReturnType<typeof setInterval> | null = null;
  private serverVersion = 0;
  private dirty = false;
  /** Compteur des modifications locales (détecte une édition pendant un envoi). */
  private rev = 0;

  getData(): EntraideData { return this.data; }
  getStatut(): EntraideStatut { return this.statut; }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    this.listeners.forEach((fn) => { try { fn(); } catch { /* écouteur fautif ignoré */ } });
  }

  private setStatut(p: Partial<EntraideStatut>): void {
    this.statut = { ...this.statut, ...p };
    this.emit();
  }

  /** Active (module autorisé) ou coupe la synchronisation. */
  configure(enabled: boolean): void {
    if (enabled === this.actif) return;
    this.actif = enabled;
    if (!enabled) {
      if (this.periodic) clearInterval(this.periodic);
      this.periodic = null;
      return;
    }
    this.charger().then(() => this.sync());
    this.periodic = setInterval(() => { this.sync().catch(() => {}); }, PERIODIC_SYNC_MS);
  }

  /** Copie locale → mémoire (une fois). */
  charger(): Promise<void> {
    if (!this.chargement) {
      this.chargement = (async () => {
        const raw = await SiralBridge.getData<unknown>(APP_CONFIG.STORAGE_KEYS.ENTRAIDE, null);
        this.data = normaliser(raw);
        this.setStatut({ charge: true });
      })();
    }
    return this.chargement;
  }

  /** Applique une modification locale puis planifie l'envoi. */
  async modifier(fn: (d: EntraideData) => EntraideData): Promise<void> {
    await this.charger();
    this.data = fn(this.data);
    this.emit();
    await SiralBridge.setData(APP_CONFIG.STORAGE_KEYS.ENTRAIDE, this.data);
    this.dirty = true;
    this.rev++;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.sync().catch(() => {});
    }, PUSH_DEBOUNCE_MS);
  }

  async sync(): Promise<void> {
    if (typeof window === 'undefined' || !window.siralBridge?.globalSync_pullEntraide) return;
    if (this.inFlight) {
      await this.inFlight;
      // Une modification arrivée pendant l'envoi précédent repart aussitôt.
      if (!this.dirty || this.occupe()) return;
    }
    this.inFlight = this.performSync().finally(() => { this.inFlight = null; });
    await this.inFlight;
  }

  private async performSync(): Promise<void> {
    await this.charger();
    const revDebut = this.rev;
    let serveur: EntraideSyncFile | null;
    try {
      serveur = (await window.siralBridge!.globalSync_pullEntraide!()) || null;
    } catch (e) {
      // Lecture ratée ≠ coffre vide : on n'écrit rien, on réessaiera.
      this.setStatut({ enLigne: false, erreur: e instanceof Error ? e.message : 'Serveur injoignable' });
      return;
    }
    this.serverVersion = serveur?.version ?? 0;
    const distant = normaliser(serveur);
    let fusion = fusionnerEntraide(this.data, distant);
    // Premier usage du module : services enquêteurs de départ.
    if (!serveur && fusion.services.length === 0) {
      const maintenant = new Date().toISOString();
      fusion = { ...fusion, services: SERVICES_DEPART.map((s) => ({ ...s, dateMiseAJour: maintenant })) };
    }
    // Services créés avec les anciennes trames (DRPJ, case DDSP) : remis à niveau.
    const migration = migrerServices(fusion.services, fusion.demandes);
    if (migration) {
      const maintenant = new Date().toISOString();
      fusion = {
        ...fusion,
        services: migration.services.map(({ modifie, ...s }) => (modifie ? { ...s, dateMiseAJour: maintenant } : s)),
        tombstones: [...fusion.tombstones, ...migration.supprimes.map((id) => ({ id, deletedAt: maintenant }))],
      };
    }
    if (empreinte(fusion) !== empreinte(this.data)) {
      this.data = fusion;
      await SiralBridge.setData(APP_CONFIG.STORAGE_KEYS.ENTRAIDE, fusion);
      this.emit();
    }
    if (!serveur || this.dirty || empreinte(fusion) !== empreinte(distant)) {
      const user = await getCurrentUserInfo();
      const payload: EntraideSyncFile = {
        ...fusion,
        version: this.serverVersion + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: user.displayName,
        computerName: user.computerName,
      };
      try {
        await window.siralBridge!.globalSync_pushEntraide!(payload);
        this.serverVersion = payload.version;
        this.dirty = this.rev !== revDebut;
      } catch (e) {
        this.setStatut({ enLigne: false, erreur: e instanceof Error ? e.message : 'Écriture refusée' });
        return;
      }
    } else {
      this.dirty = this.rev !== revDebut;
    }
    this.setStatut({ enLigne: true, erreur: null, derniereSynchro: new Date().toISOString() });
  }

  private occupe(): boolean { return this.inFlight !== null; }

  async flushPending(): Promise<void> {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      await this.sync();
    } else if (this.inFlight) {
      await this.inFlight;
    }
  }
}

export const entraideSyncService = new EntraideSyncService();
