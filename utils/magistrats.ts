// utils/magistrats.ts — Magistrat référent d'une enquête (pastille + filtre)

import { UserManager } from '@/utils/userManager';
import type { ContentieuxId, UserProfile } from '@/types/userTypes';

/** Magistrats (rôle 'magistrat') approuvés d'un contentieux, triés par nom. */
export function getMagistratsForContentieux(contentieuxId: ContentieuxId): UserProfile[] {
  return UserManager.getInstance()
    .getAllUsers()
    .filter(u => u.approved !== false && u.contentieux.some(c => c.contentieuxId === contentieuxId && c.role === 'magistrat'))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Initiales à partir du nom affiché ("Audran Chevalier" → "AC"). */
export function getInitials(displayName: string): string {
  const parts = displayName.replace(/\(.*?\)/g, '').trim().split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Palette de 8 teintes nettement distinctes (texte blanc), sans rouge (réservé
// aux alertes) ni bleu (réservé au drapeau JIRS).
const PALETTE = [
  '#0d9488', // teal
  '#ea580c', // orange
  '#7c3aed', // violet
  '#db2777', // rose
  '#ca8a04', // jaune foncé
  '#16a34a', // vert
  '#475569', // ardoise
  '#92400e', // brun
];

/** Couleur stable d'un magistrat : attribuée selon l'ordre d'arrivée des
 *  magistrats dans l'application, ce qui garantit des couleurs distinctes
 *  (jusqu'à 8) qui ne changent pas quand un nouveau collègue est ajouté. */
export function getMagistratColor(windowsUsername: string): string {
  const magistrats = UserManager.getInstance()
    .getAllUsers()
    .filter(u => u.contentieux.some(c => c.role === 'magistrat'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.windowsUsername.localeCompare(b.windowsUsername));
  const idx = magistrats.findIndex(u => u.windowsUsername.toLowerCase() === windowsUsername.toLowerCase());
  return PALETTE[(idx < 0 ? magistrats.length : idx) % PALETTE.length];
}
