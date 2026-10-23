'use client';

// Bloc signature du magistrat connecté : coordonnées reprises dans les
// courriers et les mails, et image de signature apposée UNIQUEMENT sur les
// courriers qu'il valide lui-même.

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { useUserStore } from '@/stores/useUserStore';
import type { EntraideApi } from '@/hooks/useEntraide';
import type { SignataireEntraide } from '@/types/entraideTypes';

/** Réduit l'image (≤ 600 px de large) et la convertit en PNG. */
async function imageReduite(fichier: File): Promise<string> {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const largeur = Math.min(600, img.naturalWidth);
    const hauteur = Math.round((img.naturalHeight * largeur) / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = largeur;
    canvas.height = hauteur;
    canvas.getContext('2d')!.drawImage(img, 0, 0, largeur, hauteur);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const SignaturePanel: React.FC<{ api: EntraideApi }> = ({ api }) => {
  const { showToast } = useToast();
  const user = useUserStore((s) => s.user);
  const existant = api.index.signataire.get(api.moi.toLowerCase()) || null;
  const [f, setF] = useState<Omit<SignataireEntraide, 'dateMiseAJour'>>(() => existant || {
    username: api.moi,
    civilite: 'M.',
    prenomNom: user?.displayName || '',
    fonction: 'Substitut du procureur de la République',
    telephone: '',
    email: '',
  });
  useEffect(() => { if (existant) setF(existant); }, [existant?.dateMiseAJour]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<SignataireEntraide>) => setF({ ...f, ...p });
  const champ = 'w-full rounded-md border px-3 py-1.5 text-sm';

  return (
    <div className="max-w-2xl rounded-lg border bg-white p-5 space-y-3">
      <p className="text-sm text-gray-600">
        Ces informations remplissent le bloc signature et la ligne de contact des courriers et des mails dont vous êtes le magistrat en charge.
        Votre image de signature n’est apposée que sur les courriers que <b>vous</b> validez (« Valider et signer »).
      </p>
      <div className="grid grid-cols-4 gap-3">
        <label className="block text-xs text-gray-600">Civilité
          <select className={champ} value={f.civilite} onChange={(e) => set({ civilite: e.target.value as 'M.' | 'Mme' })}>
            <option value="M.">M.</option><option value="Mme">Mme</option>
          </select>
        </label>
        <label className="col-span-3 block text-xs text-gray-600">Prénom NOM
          <input className={champ} value={f.prenomNom} onChange={(e) => set({ prenomNom: e.target.value })} placeholder="Audran CHEVALIER" />
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
      <div>
        <div className="text-xs text-gray-600 mb-1">Image de signature (capture PNG ou JPEG)</div>
        <div className="flex items-center gap-3">
          {f.signature
            // eslint-disable-next-line @next/next/no-img-element -- data URL locale, pas d'optimisation possible
            ? <img src={f.signature} alt="Signature" className="h-16 max-w-[240px] object-contain border rounded bg-white" />
            : <div className="h-16 w-[240px] border border-dashed rounded flex items-center justify-center text-xs text-gray-400">Aucune image</div>}
          <input type="file" accept="image/png,image/jpeg" className="text-xs"
            onChange={async (e) => { const fichier = e.target.files?.[0]; if (fichier) set({ signature: await imageReduite(fichier) }); }} />
          {f.signature && <button className="text-xs text-red-700" onClick={() => set({ signature: undefined })}>Retirer</button>}
        </div>
      </div>
      <div className="flex justify-end">
        <Button className="bg-[#2B5746] hover:bg-[#2B5746]/90" disabled={!f.prenomNom.trim()}
          onClick={async () => { await api.enregistrerSignataire({ ...f, username: api.moi }); showToast('Bloc signature enregistré', 'success'); }}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
};
