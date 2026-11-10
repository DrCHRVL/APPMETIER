'use client';

// Coordonnées du magistrat connecté : reprises dans la ligne de contact et
// le bas des courriers et des mails des demandes dont il est en charge.

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { useUserStore } from '@/stores/useUserStore';
import type { EntraideApi } from '@/hooks/useEntraide';
import type { SignataireEntraide } from '@/types/entraideTypes';

type Coordonnees = Omit<SignataireEntraide, 'dateMiseAJour'>;

/** Champs de coordonnées seuls (écarte toute propriété héritée d'anciennes données). */
function coordonnees(s: SignataireEntraide): Coordonnees {
  return {
    username: s.username,
    civilite: s.civilite,
    prenomNom: s.prenomNom,
    fonction: s.fonction,
    telephone: s.telephone,
    email: s.email,
  };
}

export const CoordonneesPanel: React.FC<{ api: EntraideApi }> = ({ api }) => {
  const { showToast } = useToast();
  const user = useUserStore((s) => s.user);
  const existant = api.index.signataire.get(api.moi.toLowerCase()) || null;
  const [f, setF] = useState<Coordonnees>(() => (existant ? coordonnees(existant) : {
    username: api.moi,
    civilite: 'M.',
    prenomNom: user?.displayName || '',
    fonction: 'Substitut du procureur de la République',
    telephone: '',
    email: '',
  }));
  useEffect(() => { if (existant) setF(coordonnees(existant)); }, [existant?.dateMiseAJour]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<Coordonnees>) => setF({ ...f, ...p });
  const champ = 'w-full rounded-md border px-3 py-1.5 text-sm';

  return (
    <div className="max-w-2xl rounded-lg border bg-white p-5 space-y-3">
      <p className="text-sm text-gray-600">
        Ces coordonnées figurent sur les courriers et les mails des demandes dont vous êtes le magistrat en charge :
        nom et fonction en bas du courrier, téléphone et mail dans la ligne de contact.
      </p>
      <div className="grid grid-cols-4 gap-3">
        <label className="block text-xs text-gray-600">Civilité
          <select className={champ} value={f.civilite} onChange={(e) => set({ civilite: e.target.value as 'M.' | 'Mme' })}>
            <option value="M.">M.</option><option value="Mme">Mme</option>
          </select>
        </label>
        <label className="col-span-3 block text-xs text-gray-600">Prénom NOM
          <input className={champ} value={f.prenomNom} onChange={(e) => set({ prenomNom: e.target.value })} placeholder="Prénom NOM" />
        </label>
      </div>
      <label className="block text-xs text-gray-600">Fonction
        <input className={champ} value={f.fonction} onChange={(e) => set({ fonction: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-gray-600">Téléphone
          <input className={champ} value={f.telephone || ''} onChange={(e) => set({ telephone: e.target.value })} placeholder="03.22.82.47.07" />
        </label>
        <label className="block text-xs text-gray-600">Mail
          <input className={champ} value={f.email || ''} onChange={(e) => set({ email: e.target.value })} />
        </label>
      </div>
      <div className="flex justify-end">
        <Button className="bg-[#2B5746] hover:bg-[#2B5746]/90" disabled={!f.prenomNom.trim()}
          onClick={async () => { await api.enregistrerSignataire({ ...f, username: api.moi }); showToast('Coordonnées enregistrées', 'success'); }}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
};
