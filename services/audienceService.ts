import { ResultatAudience } from '@/types/interfaces';
import { StorageManager } from '../utils/storage';

class AudienceService {
  private static STORAGE_KEY = 'audience_results';

  saveResult(enqueteId: number, resultat: ResultatAudience, dateAudience: string) {
    const results = this.getAllResults();
    results[enqueteId] = { resultat, dateAudience };
    StorageManager.set(this.STORAGE_KEY, results);
  }

  getResult(enqueteId: number) {
    const results = this.getAllResults();
    return results[enqueteId];
  }

  private getAllResults() {
    return StorageManager.get(this.STORAGE_KEY, {});
  }

  validateResult(resultat: ResultatAudience): boolean {
    if (!resultat.dateAudience) return false;
    if (!resultat.condamnations.length) return false;
    
    return resultat.condamnations.every(c => 
      c.peinePrison > 0 || c.sursisProbatoire > 0 || 
      c.sursisSimple > 0 || c.peineAmende > 0
    );
  }
}

export const audienceService = new AudienceService();