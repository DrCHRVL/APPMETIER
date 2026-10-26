// components/entraide/utilisateurs.ts — utilisateurs du module Entraide.

import { UserManager } from '@/utils/userManager';
import type { UserProfile } from '@/types/userTypes';

/** Utilisateurs approuvés ayant le module Entraide, triés par nom. */
export function utilisateursEntraide(): UserProfile[] {
  return UserManager.getInstance()
    .getAllUsers()
    .filter((u) => u.approved !== false && u.modules.includes('entraide'))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function nomUtilisateur(username?: string): string {
  if (!username) return '';
  const u = UserManager.getInstance().getAllUsers().find((x) => x.windowsUsername.toLowerCase() === username.toLowerCase());
  return u?.displayName || username;
}
