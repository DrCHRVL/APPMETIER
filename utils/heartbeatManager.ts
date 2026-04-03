// utils/heartbeatManager.ts — Système de heartbeat via fichiers partagés
//
// Chaque client écrit un fichier USERNAME.json dans le dossier heartbeats/
// sur le serveur partagé. Les autres clients lisent ces fichiers pour
// savoir qui est en ligne.

import { UserHeartbeat } from '@/types/userTypes';
import { ElectronBridge } from './electronBridge';

const HEARTBEAT_INTERVAL = 30_000; // 30 secondes
const ONLINE_THRESHOLD = 120_000;  // 2 minutes sans heartbeat = hors ligne

export class HeartbeatManager {
  private static instance: HeartbeatManager;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private username: string = '';
  private displayName: string = '';
  private activeContentieux: string | null = null;
  private currentView: string = '';

  private constructor() {}

  static getInstance(): HeartbeatManager {
    if (!HeartbeatManager.instance) {
      HeartbeatManager.instance = new HeartbeatManager();
    }
    return HeartbeatManager.instance;
  }

  /** Démarre le heartbeat périodique */
  start(username: string, displayName: string): void {
    this.username = username;
    this.displayName = displayName;
    this.writeHeartbeat();
    this.intervalId = setInterval(() => this.writeHeartbeat(), HEARTBEAT_INTERVAL);

    // Supprimer le heartbeat à la fermeture
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.stop());
    }
  }

  /** Arrête le heartbeat et supprime le fichier */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.removeHeartbeat();
  }

  /** Met à jour le contexte (contentieux actif, vue) */
  updateContext(activeContentieux: string | null, currentView: string): void {
    this.activeContentieux = activeContentieux;
    this.currentView = currentView;
  }

  /** Écrit le heartbeat sur le serveur */
  private async writeHeartbeat(): Promise<void> {
    const heartbeat: UserHeartbeat = {
      username: this.username,
      displayName: this.displayName,
      activeContentieux: this.activeContentieux,
      currentView: this.currentView,
      appVersion: '3.0',
      timestamp: new Date().toISOString(),
    };

    try {
      await window.electronAPI?.writeHeartbeat?.(this.username, heartbeat);
    } catch {
      // Silencieux si le serveur est inaccessible
    }
  }

  /** Supprime le fichier heartbeat */
  private async removeHeartbeat(): Promise<void> {
    try {
      await window.electronAPI?.removeHeartbeat?.(this.username);
    } catch {
      // Silencieux
    }
  }

  /** Lit tous les heartbeats actifs depuis le serveur */
  static async getOnlineUsers(): Promise<(UserHeartbeat & { isOnline: boolean })[]> {
    try {
      const heartbeats: UserHeartbeat[] = await window.electronAPI?.readAllHeartbeats?.() || [];
      const now = Date.now();
      return heartbeats.map(hb => ({
        ...hb,
        isOnline: (now - new Date(hb.timestamp).getTime()) < ONLINE_THRESHOLD,
      }));
    } catch {
      return [];
    }
  }
}
