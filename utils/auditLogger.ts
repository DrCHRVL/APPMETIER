// utils/auditLogger.ts — Journal d'audit léger
//
// Stocke les entrées d'audit dans un fichier JSON sur le serveur partagé.
// Conserve les 500 dernières entrées pour ne pas gonfler le fichier.

import { AuditLogEntry, ContentieuxId } from '@/types/userTypes';

const MAX_ENTRIES = 500;

export class AuditLogger {
  private static instance: AuditLogger;
  private username: string = '';
  private displayName: string = '';

  private constructor() {}

  static getInstance(): AuditLogger {
    if (!AuditLogger.instance) {
      AuditLogger.instance = new AuditLogger();
    }
    return AuditLogger.instance;
  }

  /** Initialise avec l'identité de l'utilisateur */
  initialize(username: string, displayName: string): void {
    this.username = username;
    this.displayName = displayName;
  }

  /** Ajoute une entrée au journal */
  async log(
    action: AuditLogEntry['action'],
    details?: string,
    contentieuxId?: ContentieuxId
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      action,
      username: this.username,
      displayName: this.displayName,
      contentieuxId,
      details,
      timestamp: new Date().toISOString(),
    };

    try {
      await window.electronAPI?.appendAuditLog?.(entry, MAX_ENTRIES);
    } catch {
      // Silencieux si serveur inaccessible
    }
  }

  /** Lit le journal d'audit complet */
  static async getLog(): Promise<AuditLogEntry[]> {
    try {
      return await window.electronAPI?.readAuditLog?.() || [];
    } catch {
      return [];
    }
  }
}
