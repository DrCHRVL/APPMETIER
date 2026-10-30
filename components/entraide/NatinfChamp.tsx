'use client';

// Infraction(s) visée(s) par la demande, en codes NATINF du référentiel —
// pour une demande étrangère, l'équivalent de l'infraction en droit français.

import React from 'react';
import { X } from 'lucide-react';
import { NatinfPicker } from '@/components/natinf/NatinfPicker';
import { useNatinf } from '@/hooks/useNatinf';

export const NatinfChamp: React.FC<{ valeur: string[]; onChange: (codes: string[]) => void }> = ({ valeur, onChange }) => {
  const { getByCode } = useNatinf();
  return (
    <div className="space-y-1.5">
      <NatinfPicker
        placeholder="Infraction (ou son équivalent français) : libellé ou n° NATINF…"
        onSelect={(e) => { if (!valeur.includes(e.code)) onChange([...valeur, e.code]); }}
      />
      {valeur.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {valeur.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {getByCode(c)?.libelle || 'NATINF'} <span className="font-mono text-gray-400">{c}</span>
              <button type="button" title="Retirer" onClick={() => onChange(valeur.filter((x) => x !== c))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/** Libellés en clair, pour la lecture de la fiche. */
export const NatinfLibelles: React.FC<{ codes?: string[] }> = ({ codes }) => {
  const { getByCode } = useNatinf();
  if (!codes?.length) return <>—</>;
  return <>{codes.map((c) => `${getByCode(c)?.libelle || 'NATINF'} (${c})`).join(' · ')}</>;
};
