/* Fichier temporairement désactivé au profit de useAudience.ts
import { atom } from 'jotai';
import { AudienceState } from '@/types/audienceTypes';
import { StorageManager } from '@/utils/storage';

const initialState: AudienceState = {
 resultats: {}
};

const baseAudienceAtom = atom<AudienceState>(initialState);

export const audienceAtom = atom(
 (get) => get(baseAudienceAtom),
 (get, set, newState: AudienceState) => {
   set(baseAudienceAtom, newState);
   StorageManager.set('audience_results', newState).catch(console.error);
 }
);

if (typeof window !== 'undefined') {
 StorageManager.get('audience_results', initialState).then((savedState) => {
   audienceAtom.onMount = (setAtom) => {
     setAtom(savedState);
   };
 }).catch(console.error);
}
*/

// Export temporaire pour éviter les erreurs d'import
export const audienceAtom = null;