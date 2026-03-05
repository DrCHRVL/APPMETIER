import { v1 } from './schemas/v1';
import { v2 } from './schemas/v2';

export const CURRENT_VERSION = 2;

export class MigrationManager {
  private migrations = new Map([
    [1, v1],
    [2, v2]
  ]);

  async migrate(data: any, fromVersion: number): Promise<any> {
    let currentData = { ...data };
    let currentVersion = fromVersion;

    while (currentVersion < CURRENT_VERSION) {
      const nextVersion = currentVersion + 1;
      const migration = this.migrations.get(nextVersion);
      
      if (!migration) {
        throw new Error(`Migration to version ${nextVersion} not found`);
      }

      try {
        currentData = await migration(currentData);
        currentVersion = nextVersion;
      } catch (error) {
        throw new Error(`Migration to version ${nextVersion} failed: ${error}`);
      }
    }

    return currentData;
  }
}