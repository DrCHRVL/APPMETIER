'use client';

// Mesures demandées : on commence à écrire (« aud », « compte », « adresse »),
// les mesures correspondantes se proposent, les plus fréquentes d'abord.
// Pas de liste interminable à dérouler.

import React, { useMemo, useState } from 'react';
import { X, Scale } from 'lucide-react';
import { chercherMesures, MESURES } from '@/utils/entraide/logique';

interface Props {
  valeur: string[];
  onChange: (ids: string[]) => void;
  /** Fréquence d'usage de chaque mesure dans le registre. */
  frequences: Record<string, number>;
}

export const MesuresInput: React.FC<Props> = ({ valeur, onChange, frequences }) => {
  const [requete, setRequete] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const suggestions = useMemo(
    () => chercherMesures(requete, frequences).filter((m) => !valeur.includes(m.id)).slice(0, 7),
    [requete, frequences, valeur],
  );
  const ajouter = (id: string) => { onChange([...valeur, id]); setRequete(''); };

  return (
    <div>
      {valeur.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {valeur.map((id) => {
            const m = MESURES.find((x) => x.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#2B5746]/10 text-[#2B5746] px-2 py-0.5 text-xs">
                {m?.juge && <Scale className="h-3 w-3 text-amber-700" aria-label="Autorisation d'un juge requise" />}
                {m?.libelle || id}
                <button type="button" onClick={() => onChange(valeur.filter((x) => x !== id))} aria-label="Retirer"><X className="h-3 w-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <input
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          placeholder="Mesure demandée : tapez « aud », « compte », « adresse »…"
          value={requete}
          onChange={(e) => { setRequete(e.target.value); setOuvert(true); }}
          onFocus={() => setOuvert(true)}
          onBlur={() => setTimeout(() => setOuvert(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) ajouter(suggestions[0].id); }
            if (e.key === 'Backspace' && !requete && valeur.length) onChange(valeur.slice(0, -1));
          }}
        />
        {ouvert && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
            {suggestions.map((m) => (
              <button
                type="button"
                key={m.id}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                onMouseDown={(e) => { e.preventDefault(); ajouter(m.id); }}
              >
                <span>{m.libelle}</span>
                {m.juge && <span className="text-[10px] text-amber-700 flex items-center gap-1"><Scale className="h-3 w-3" />juge</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {valeur.some((id) => MESURES.find((m) => m.id === id)?.juge) && (
        <p className="mt-1 text-xs text-amber-800">⚖ Mesure qui, en France, requiert l'autorisation d'un juge (JLD ou juge d'instruction).</p>
      )}
    </div>
  );
};
