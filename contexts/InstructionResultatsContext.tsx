/**
 * InstructionResultatsContext — initialise le store des résultats d'audience
 * des dossiers d'instruction au montage. Mêmes ergonomie que AudienceContext
 * mais sur un JSON séparé (instruction_resultats__<windowsUsername>) et
 * **par utilisateur**.
 */

import React, { useEffect } from 'react';
import { useInstructionResultatsStore } from '@/stores/useInstructionResultatsStore';
import { useUser } from '@/contexts/UserContext';
import type { ResultatAudience } from '@/types/audienceTypes';

export const InstructionResultatsProvider = ({ children }: { children: React.ReactNode }) => {
  const setUser = useInstructionResultatsStore(s => s.setUser);
  const { user } = useUser();
  const username = user?.windowsUsername || null;

  // Recharge le store sur chaque changement d'utilisateur (login, logout,
  // bascule de profil dans une session admin…).
  useEffect(() => {
    void setUser(username);
  }, [username, setUser]);

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
