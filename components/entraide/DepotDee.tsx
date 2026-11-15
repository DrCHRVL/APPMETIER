'use client';

// Zone de dépôt d'une DEE (annexe A) dans le registre : le formulaire est lu
// dans le navigateur ; si une demande correspondante existe déjà, on la
// montre, sinon la fiche de création s'ouvre préremplie.

import React, { useState } from 'react';
import { FileUp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { dateFr, etatDemande, TYPE_LABELS } from '@/utils/entraide/logique';
import { demandesCorrespondantes, lireFichierDee, type Correspondance, type FicheDee } from '@/utils/entraide/dee';
import type { DemandeEntraide } from '@/types/entraideTypes';

interface Props {
  demandes: DemandeEntraide[];
  onOuvrir: (id: string) => void;
  onCreer: (fiche: FicheDee, piece: string) => void;
}

export const DepotDee: React.FC<Props> = ({ demandes, onOuvrir, onCreer }) => {
  const { showToast } = useToast();
  const [enLecture, setEnLecture] = useState(false);
  const [survol, setSurvol] = useState(false);
  const [trouve, setTrouve] = useState<{ fiche: FicheDee; piece: string; liste: Correspondance[] } | null>(null);

  const lire = async (fichier: File) => {
    setEnLecture(true);
    setTrouve(null);
    try {
      const fiche = await lireFichierDee(fichier);
      const liste = demandesCorrespondantes(demandes, fiche);
      if (liste.length) setTrouve({ fiche, piece: fichier.name, liste });
      else onCreer(fiche, fichier.name);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lecture impossible', 'error');
    } finally {
      setEnLecture(false);
    }
  };

  return (
    <div className="space-y-2">
      <label
        onDragOver={(e) => { e.preventDefault(); setSurvol(true); }}
        onDragLeave={() => setSurvol(false)}
        onDrop={(e) => { e.preventDefault(); setSurvol(false); const f = e.dataTransfer.files?.[0]; if (f) lire(f); }}
        className={`flex items-center gap-2 rounded-lg border-2 border-dashed px-4 py-2.5 text-sm cursor-pointer transition-colors ${survol ? 'border-[#2B5746] bg-[#2B5746]/10' : 'border-gray-300 bg-white hover:bg-gray-50'} ${enLecture ? 'opacity-60 pointer-events-none' : ''}`}
      >
        {enLecture ? <Loader2 className="h-4 w-4 animate-spin text-[#2B5746]" /> : <FileUp className="h-4 w-4 text-[#2B5746]" />}
        <span className="font-medium text-gray-800">{enLecture ? 'Lecture de la DEE…' : 'Déposer une DEE'}</span>
        <span className="text-xs text-gray-500">PDF, DOCX ou ODT (annexe A) : vérification dans le registre, sinon fiche préremplie. La pièce reste sur ce poste.</span>
        <input type="file" className="hidden" accept=".pdf,.docx,.odt,.txt"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) lire(f); }} />
      </label>

      {trouve && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-amber-900">
              « {trouve.piece} » : {trouve.liste.some((c) => c.fort) ? 'cette DEE semble déjà enregistrée' : 'demande(s) proches dans le registre'}.
            </p>
            <button onClick={() => setTrouve(null)} className="p-0.5 rounded hover:bg-amber-100"><X className="h-4 w-4 text-amber-800" /></button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {trouve.liste.slice(0, 5).map(({ demande: d, motifs, fort }) => {
              const e = etatDemande(d);
              return (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 border border-amber-200">
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="font-mono text-xs">{d.refEsabora || '—'}</span>
                      <span className="mx-1.5 text-gray-400">·</span>{TYPE_LABELS[d.type]} {d.sens === 'emise' ? 'émise' : 'reçue'} · {d.pays}
                      {d.objet ? <span className="text-gray-600"> · {d.objet}</span> : null}
                    </div>
                    <div className={`text-xs ${fort ? 'text-amber-900 font-medium' : 'text-gray-500'}`}>
                      {motifs.join(' · ')} — {e.libelleEtape}{d.dateEnregistrement ? `, enregistrée le ${dateFr(d.dateEnregistrement)}` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setTrouve(null); onOuvrir(d.id); }}>Ouvrir</Button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => { const t = trouve; setTrouve(null); onCreer(t.fiche, t.piece); }}>
              Créer une nouvelle demande quand même
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
