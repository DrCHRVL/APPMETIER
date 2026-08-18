import { SiralBridge } from '@/utils/siralBridge';

export class SiralStorageService {
  // CREATE
  public async create<T>(key: string, data: T): Promise<boolean> {
    try {
      // Vérifie si la donnée existe déjà
      const existing = await this.read<T>(key);
      if (existing !== null) {
        throw new Error(`Data already exists for key: ${key}`);
      }
      return await SiralBridge.setData(key, data);
    } catch (error) {
      console.error(`Error creating data for key ${key}:`, error);
      return false;
    }
  }

  // READ
  public async read<T>(key: string, defaultValue?: T): Promise<T | null> {
    try {
      return await SiralBridge.getData(key, defaultValue ?? null);
    } catch (error) {
      console.error(`Error reading data for key ${key}:`, error);
      return null;
    }
  }

  // UPDATE
  public async update<T>(key: string, data: T): Promise<boolean> {
    try {
      // Vérifie si la donnée existe
      const existing = await this.read(key);
      if (existing === null) {
        throw new Error(`No data exists for key: ${key}`);
      }
      return await SiralBridge.setData(key, data);
    } catch (error) {
      console.error(`Error updating data for key ${key}:`, error);
      return false;
    }
  }

  // DELETE
  public async delete(key: string): Promise<boolean> {
    try {
      return await SiralBridge.clearData(key);
    } catch (error) {
      console.error(`Error deleting data for key ${key}:`, error);
      return false;
    }
  }

  // Méthodes utilitaires supplémentaires
  public async exists(key: string): Promise<boolean> {
    const data = await this.read(key);
    return data !== null;
  }

  public async getAll(): Promise<string[]> {
    return await SiralBridge.getAllKeys();
  }

  // Méthode de sauvegarde avec fusion
  public async createOrUpdate<T>(key: string, data: T): Promise<boolean> {
    try {
      return await SiralBridge.setData(key, data);
    } catch (error) {
      console.error(`Error saving data for key ${key}:`, error);
      return false;
    }
  }

  // Méthode pour les sauvegardes en masse
  public async bulkSave(data: Record<string, any>): Promise<boolean> {
    try {
      const results = await Promise.all(
        Object.entries(data).map(([key, value]) => 
          this.createOrUpdate(key, value)
        )
      );
      return results.every(result => result === true);
    } catch (error) {
      console.error('Error during bulk save:', error);
      return false;
    }
  }
}

// Export d'une instance unique
export const siralStorage = new SiralStorageService();