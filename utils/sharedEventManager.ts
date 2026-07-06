// utils/sharedEventManager.ts — Système d'événements partagés via fichiers
//
// Écriture d'événements légers dans events/ sur le serveur partagé.
// File watcher côté Electron (main process) surveille ce dossier et notifie le renderer.

import { SharedEvent, ContentieuxId } from '@/types/userTypes';

const EVENT_TTL = 5 * 60_000; // Événements expirent après 5 minutes

export class SharedEventManager {
  private static instance: SharedEventManager;
  private listeners: Array<(event: SharedEvent) => void> = [];
  private username: string = '';
  private ipcRegistered = false;

  private constructor() {}

  static getInstance(): SharedEventManager {
    if (!SharedEventManager.instance) {
      SharedEventManager.instance = new SharedEventManager();
    }
    return SharedEventManager.instance;
  }

  /** Initialise avec le username et commence à écouter */
  start(username: string): void {
    this.username = username;

    // Écouter les événements envoyés depuis le main process (file watcher).
    // Enregistrement unique : un re-login sans rechargement complet ne doit pas
    // cumuler les callbacks IPC (sinon chaque événement serait distribué N fois).
    if (typeof window !== 'undefined' && !this.ipcRegistered) {
      window.electronAPI?.onSharedEvent?.((event: SharedEvent) => {
        this.dispatchInternal(event);
      });
      this.ipcRegistered = true;
    }
  }

  /** Distribue un événement aux listeners en filtrant les self-emits.
   *  Utilisé à la fois par le watcher et par la sync prioritaire au lancement. */
  static dispatch(event: SharedEvent): void {
    SharedEventManager.getInstance().dispatchInternal(event);
  }

  private dispatchInternal(event: SharedEvent): void {
    // Ignorer ses propres événements
    if (event.username === this.username) return;
    this.listeners.forEach(fn => fn(event));
  }

  /** Enregistre un listener d'événements */
  on(listener: (event: SharedEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(fn => fn !== listener);
    };
  }

  /** Publie un événement partagé */
  async emit(
    type: SharedEvent['type'],
    contentieuxId?: ContentieuxId,
    data?: Record<string, any>
  ): Promise<void> {
    const event: SharedEvent = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      contentieuxId,
      username: this.username,
      data,
      timestamp: new Date().toISOString(),
    };

    try {
      await window.electronAPI?.writeSharedEvent?.(event);
    } catch {
      // Silencieux si serveur inaccessible
    }
  }

  /** Nettoie les événements expirés (appelé périodiquement par le main process) */
  static async cleanup(): Promise<void> {
    try {
      await window.electronAPI?.cleanupSharedEvents?.(EVENT_TTL);
    } catch {
      // Silencieux
    }
  }
}
