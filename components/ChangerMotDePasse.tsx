'use client';

/** Mon profil → changer son mot de passe (ex. mot de passe provisoire remis par l'administrateur). */
import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

export const ChangerMotDePasse: React.FC = () => {
  const { showToast } = useToast();
  const [ancien, setAncien] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);

  const valider = async () => {
    if (nouveau !== confirmation) { showToast('Les deux saisies ne correspondent pas', 'error'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/password-change', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ ancien, nouveau }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(String(json.error || 'Changement refusé'), 'error'); return; }
      setAncien(''); setNouveau(''); setConfirmation('');
      showToast('Mot de passe changé', 'success');
    } finally { setBusy(false); }
  };

  const champ = 'border border-gray-300 rounded px-2 py-1.5 text-sm w-full';
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-800 uppercase tracking-wide">Mot de passe</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">Celui de la connexion (10 caractères minimum). Votre phrase personnelle, qui ouvre vos données, ne change pas.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input className={champ} type="password" placeholder="Mot de passe actuel" value={ancien} onChange={e => setAncien(e.target.value)} />
        <input className={champ} type="password" placeholder="Nouveau mot de passe" value={nouveau} onChange={e => setNouveau(e.target.value)} />
        <input className={champ} type="password" placeholder="Confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      </div>
      <button className="mt-3 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 disabled:opacity-50"
        onClick={valider} disabled={busy || !ancien || nouveau.length < 10}>
        Changer le mot de passe
      </button>
    </section>
  );
};
