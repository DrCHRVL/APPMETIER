'use client';

// « Autre unité » : saisie libre, avec en suggestion les unités déjà saisies
// sur d'autres demandes — une unité tapée une fois se retrouve ensuite.

import React, { useId, useMemo } from 'react';
import type { DemandeEntraide } from '@/types/entraideTypes';

interface Props {
  demandes: DemandeEntraide[];
  valeur: string;
  onChange: (v: string) => void;
  className?: string;
}

export const AutreUniteInput: React.FC<Props> = ({ demandes, valeur, onChange, className }) => {
  const liste = useId();
  const unites = useMemo(() => {
    const vues = new Map<string, string>();
    for (const d of demandes) {
      const u = d.serviceAutre?.trim();
      if (u && u !== 'À préciser') vues.set(u.toLowerCase(), u);
    }
    return Array.from(vues.values()).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [demandes]);
  return (
    <>
      <input className={className} list={liste} placeholder="Ex. BR de Péronne" value={valeur} onChange={(e) => onChange(e.target.value)} />
      <datalist id={liste}>{unites.map((u) => <option key={u} value={u} />)}</datalist>
    </>
  );
};
