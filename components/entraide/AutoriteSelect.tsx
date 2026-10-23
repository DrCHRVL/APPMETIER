'use client';

// Saisie de l'autorité étrangère : on tape un nom, une ville ou un mot-clé
// appris (« Tournai » → parquet de Mons), la fiche se propose ; Entrée
// choisit la première. Une autorité inconnue se crée sur place.

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { chercherAutorites, paysDe, PAYS } from '@/utils/entraide/logique';
import type { AutoriteEtrangere, AutoriteNature, EntraideLangue } from '@/types/entraideTypes';

interface Props {
  autorites: AutoriteEtrangere[];
  pays?: string;
  valeur: AutoriteEtrangere | null;
  onChoisir: (a: AutoriteEtrangere | null, requete: string) => void;
  onCreer: (a: Omit<AutoriteEtrangere, 'id' | 'dateMiseAJour'>) => Promise<AutoriteEtrangere>;
}

const NATURES: Array<[AutoriteNature, string]> = [
  ['parquet', 'Parquet'], ['tribunal', 'Tribunal'], ['juge', "Juge d'instruction"],
  ['ministere', 'Ministère / autorité centrale'], ['police', 'Police'], ['autre', 'Autre'],
];

export const AutoriteSelect: React.FC<Props> = ({ autorites, pays, valeur, onChoisir, onCreer }) => {
  const [requete, setRequete] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [creation, setCreation] = useState<null | Omit<AutoriteEtrangere, 'id' | 'dateMiseAJour'>>(null);

  const suggestions = useMemo(
    () => (requete.trim() ? chercherAutorites(autorites, requete, pays) : autorites.filter((a) => !pays || a.pays === pays)).slice(0, 8),
    [autorites, requete, pays],
  );

  if (valeur) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm">
        <div className="min-w-0">
          <div className="font-medium text-gray-800 truncate">{valeur.nom}</div>
          <div className="text-xs text-gray-500">{[valeur.ville, valeur.pays].filter(Boolean).join(' · ')} · courriers en {valeur.langue === 'en' ? 'anglais' : 'français'}</div>
        </div>
        <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => onChoisir(null, '')}>Changer</button>
      </div>
    );
  }

  if (creation) {
    const set = (p: Partial<typeof creation>) => setCreation({ ...creation, ...p });
    return (
      <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 space-y-2 text-sm">
        <div className="text-xs font-semibold text-blue-900">Nouvelle autorité (enregistrée une fois pour toutes)</div>
        <input className="w-full rounded border px-2 py-1" placeholder="Nom complet" value={creation.nom} onChange={(e) => set({ nom: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <select className="rounded border px-2 py-1" value={creation.nature || 'parquet'} onChange={(e) => set({ nature: e.target.value as AutoriteNature })}>
            {NATURES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="rounded border px-2 py-1" placeholder="Ville" value={creation.ville || ''} onChange={(e) => set({ ville: e.target.value })} />
        </div>
        <textarea className="w-full rounded border px-2 py-1" rows={2} placeholder="Adresse postale" value={creation.adresse || ''} onChange={(e) => set({ adresse: e.target.value })} />
        <div className="grid grid-cols-3 gap-2">
          <select className="rounded border px-2 py-1" value={creation.pays} onChange={(e) => set({ pays: e.target.value, langue: paysDe(e.target.value)?.langue || 'en' })}>
            <option value="">Pays…</option>
            {PAYS.map((p) => <option key={p.nom} value={p.nom}>{p.nom}</option>)}
          </select>
          <select className="rounded border px-2 py-1" value={creation.langue} onChange={(e) => set({ langue: e.target.value as EntraideLangue })}>
            <option value="fr">Courriers en français</option>
            <option value="en">Courriers en anglais</option>
          </select>
          <input className="rounded border px-2 py-1" placeholder="Mail (facultatif)" value={creation.email || ''} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-1 text-xs rounded border" onClick={() => setCreation(null)}>Annuler</button>
          <button
            type="button"
            className="px-3 py-1 text-xs rounded bg-[#2B5746] text-white disabled:opacity-50"
            disabled={!creation.nom.trim() || !creation.pays}
            onClick={async () => { const a = await onCreer(creation); setCreation(null); onChoisir(a, requete); }}
          >Enregistrer et choisir</button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        placeholder="Tapez un nom, une ville, un mot-clé… (ex. Tournai)"
        value={requete}
        onChange={(e) => { setRequete(e.target.value); setOuvert(true); }}
        onFocus={() => setOuvert(true)}
        onBlur={() => setTimeout(() => setOuvert(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestions[0]) onChoisir(suggestions[0], requete);
          }
        }}
      />
      {ouvert && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
          {suggestions.map((a) => (
            <button
              type="button"
              key={a.id}
              className="block w-full text-left px-3 py-1.5 hover:bg-gray-50"
              onMouseDown={(e) => { e.preventDefault(); onChoisir(a, requete); }}
            >
              <div className="text-sm text-gray-800">{a.nom}</div>
              <div className="text-xs text-gray-500">{[a.ville, a.pays].filter(Boolean).join(' · ')}{a.langue === 'en' ? ' · EN' : ''}</div>
            </button>
          ))}
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 border-t"
            onMouseDown={(e) => {
              e.preventDefault();
              setCreation({ nom: requete, nature: 'parquet', ville: '', adresse: '', pays: pays || '', langue: paysDe(pays)?.langue || 'en', email: '', motsCles: [] });
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Créer {requete ? `« ${requete} »` : 'une autorité'}
          </button>
        </div>
      )}
    </div>
  );
};
