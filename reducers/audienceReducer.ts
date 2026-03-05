import { ResultatAudience } from '@/types/interfaces';

type AudienceAction = 
  | { type: 'SAVE_RESULT'; payload: { enqueteId: number; resultat: ResultatAudience; dateAudience: string } }
  | { type: 'DELETE_RESULT'; payload: { enqueteId: number } };

interface AudienceState {
  resultats: {
    [enqueteId: number]: {
      resultat: ResultatAudience;
      dateAudience: string;
    }
  }
}

export const audienceReducer = (state: AudienceState, action: AudienceAction): AudienceState => {
  switch (action.type) {
    case 'SAVE_RESULT':
      return {
        ...state,
        resultats: {
          ...state.resultats,
          [action.payload.enqueteId]: {
            resultat: action.payload.resultat,
            dateAudience: action.payload.dateAudience
          }
        }
      };
      
    case 'DELETE_RESULT':
      const { [action.payload.enqueteId]: _, ...rest } = state.resultats;
      return {
        ...state,
        resultats: rest
      };
      
    default:
      return state;
  }
};