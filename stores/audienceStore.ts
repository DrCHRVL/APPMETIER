import { atom } from 'jotai';
import { AudienceState, ResultatAudience } from '@/types/audienceTypes';
import { ElectronBridge } from '@/utils/electronBridge';

const STORAGE_KEY = 'audience_results';

// État initial
const initialState: AudienceState = {
  resultats: {}
};

// Atome principal
export const audienceAtom = atom<AudienceState>(initialState);

// Atome persistant
export const persistentAudienceAtom = atom(
  (get) => get(audienceAtom),
  async (get, set, newState: AudienceState) => {
    try {
      set(audienceAtom, newState);
      await ElectronBridge.setData(STORAGE_KEY, newState.resultats);
    } catch (error) {
      console.error('Error saving audience data:', error);
    }
  }
);

// Actions
export const addResultatAudience = atom(
  null,
  async (get, set, resultat: ResultatAudience) => {
    const state = get(audienceAtom);
    const newState = {
      resultats: {
        ...state.resultats,
        [resultat.enqueteId]: resultat
      }
    };
    await set(persistentAudienceAtom, newState);
  }
);

export const removeResultatAudience = atom(
  null,
  async (get, set, enqueteId: number) => {
    const state = get(audienceAtom);
    const { [enqueteId]: removed, ...rest } = state.resultats;
    await set(persistentAudienceAtom, { resultats: rest });
  }
);

// Chargement initial
if (typeof window !== 'undefined') {
  ElectronBridge.getData(STORAGE_KEY, {}).then((data) => {
    audienceAtom.write({ resultats: data });
  }).catch(error => {
    console.error('Error loading audience data:', error);
  });
}