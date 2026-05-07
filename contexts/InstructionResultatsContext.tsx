/**
 * InstructionResultatsContext — initialise le store des résultats d'audience
 * des dossiers d'instruction au montage. Mêmes ergonomie que AudienceContext
 * mais sur un JSON séparé (instruction_resultats).
 */

import React, { useEffect } from 'react';
import { useInstructionResultatsStore } from '@/stores/useInstructionResultatsStore';
import type { ResultatAudience } from '@/types/audienceTypes';

export const InstructionResultatsProvider = ({ children }: { children: React.ReactNode }) => {
  const initialize = useInstructionResultatsStore(s => s.initialize);
  useEffect(() => {
    initialize();
  }, [initialize]);
  return <>{children}</>;
};

/** Hook public — accès aux résultats d'audience des dossiers d'instruction. */
export const useInstructionResultats = () => {
  const resultats = useInstructionResultatsStore(s => s.resultats);
  const isLoading = useInstructionResultatsStore(s => s.isLoading);
  const saveResultat = useInstructionResultatsStore(s => s.saveResultat);
  const deleteResultat = useInstructionResultatsStore(s => s.deleteResultat);
  const getResultat = useInstructionResultatsStore(s => s.getResultat);
  const hasResultat = useInstructionResultatsStore(s => s.hasResultat);

  return {
    instructionResultatsState: { resultats } as { resultats: Record<string, ResultatAudience> },
    saveResultat,
    deleteResultat,
    getResultat,
    hasResultat,
    isLoading,
  };
};
