// utils/UserIdentification.ts

interface UserInfo {
  id: string;
  displayName: string;
  computerName: string;
}

class UserIdentificationService {
  private static instance: UserIdentificationService;
  private currentUser: UserInfo | null = null;

  private constructor() {}

  public static getInstance(): UserIdentificationService {
    if (!UserIdentificationService.instance) {
      UserIdentificationService.instance = new UserIdentificationService();
    }
    return UserIdentificationService.instance;
  }

  /**
   * Récupère l'identification de l'utilisateur actuel
   */
  async getCurrentUser(): Promise<UserInfo> {
    if (this.currentUser) {
      return this.currentUser;
    }

    try {
      // Récupérer le nom de l'ordinateur via Electron
      const computerName = await this.getComputerName();
      
      // Créer un identifiant utilisateur basé sur le nom PC
      const userInfo: UserInfo = {
        id: this.generateUserId(computerName),
        displayName: this.generateDisplayName(computerName),
        computerName: computerName
      };

      this.currentUser = userInfo;
      return userInfo;
    } catch (error) {
      console.error('Erreur lors de l\'identification utilisateur:', error);
      
      // Fallback si échec
      const fallbackUser: UserInfo = {
        id: 'user-unknown',
        displayName: 'Utilisateur Inconnu',
        computerName: 'PC-UNKNOWN'
      };
      
      return fallbackUser;
    }
  }

  /**
   * Récupère le nom de l'ordinateur via l'API Electron
   */
  private async getComputerName(): Promise<string> {
    if (!window.electronAPI) {
      throw new Error('API Electron non disponible');
    }

    try {
      // Utiliser l'API système d'Electron pour récupérer le nom de l'ordinateur
      const computerName = await window.electronAPI.getComputerName();
      return computerName || 'PC-UNKNOWN';
    } catch (error) {
      console.error('Impossible de récupérer le nom de l\'ordinateur:', error);
      return 'PC-UNKNOWN';
    }
  }

  /**
   * Génère un identifiant utilisateur unique basé sur le nom de l'ordinateur
   */
  private generateUserId(computerName: string): string {
    // Nettoyer le nom de l'ordinateur pour créer un ID valide
    const cleanName = computerName
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .substring(0, 20);
    
    return `USER_${cleanName}`;
  }

  /**
   * Génère un nom d'affichage convivial
   */
  private generateDisplayName(computerName: string): string {
    // Logique pour convertir le nom PC en nom d'affichage
    const name = computerName.toUpperCase();
    
    // Règles de mapping spécifiques à votre organisation
    if (name.includes('AUDRAN') || name.includes('PC-AUDRAN')) {
      return 'Audran CHEVALIER';
    } else if (name.includes('COLLAB') || name.includes('PC-COLLAB')) {
      return 'Collaboratrice';
    }
    
    // Fallback générique
    return `Utilisateur (${computerName})`;
  }

  /**
   * Force le rechargement de l'identification utilisateur
   */
  async refreshCurrentUser(): Promise<UserInfo> {
    this.currentUser = null;
    return this.getCurrentUser();
  }

  /**
   * Retourne l'utilisateur actuel en cache (sans appel réseau)
   */
  getCurrentUserSync(): UserInfo | null {
    return this.currentUser;
  }
}

export const UserIdentification = UserIdentificationService.getInstance();
export type { UserInfo };
