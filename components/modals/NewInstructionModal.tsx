'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import type {
  NewDossierInstructionData,
  OrigineDossier,
} from '@/types/instructionTypes';

interface NewInstructionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: NewDossierInstructionData) => void;
}

export const NewInstructionModal = ({ isOpen, onClose, onSubmit }: NewInstructionModalProps) => {
  const { showToast } = useToast();
  const { cabinets, getCabinetById } = useInstructionCabinets();

  const [numeroInstruction, setNumeroInstruction] = useState('');
  const [numeroParquet, setNumeroParquet] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const [magistratInstructeur, setMagistratInstructeur] = useState('');
  const [dateRI, setDateRI] = useState(() => new Date().toISOString().split('T')[0]);
  const [origine, setOrigine] = useState<OrigineDossier>('preliminaire');
  const [description, setDescription] = useState('');

  // Pré-sélectionne le 1er cabinet quand la liste arrive
  useEffect(() => {
    if (!cabinetId && cabinets.length > 0) {
      setCabinetId(cabinets[0].id);
    }
  }, [cabinets, cabinetId]);

  // Pré-remplit le magistrat depuis le cabinet choisi (si vide)
  useEffect(() => {
    if (!cabinetId) return;
    const cab = getCabinetById(cabinetId);
    if (cab?.magistratParDefaut && !magistratInstructeur) {
      setMagistratInstructeur(cab.magistratParDefaut);
    }
  }, [cabinetId, getCabinetById, magistratInstructeur]);

  const reset = () => {
    setNumeroInstruction('');
    setNumeroParquet('');
    setCabinetId(cabinets[0]?.id || '');
    setMagistratInstructeur('');
    setDateRI(new Date().toISOString().split('T')[0]);
    setOrigine('preliminaire');
    setDescription('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!numeroInstruction.trim()) {
      showToast('Numéro d\'instruction requis', 'error');
      return;
    }
    if (!numeroParquet.trim()) {
      showToast('Numéro de parquet requis', 'error');
      return;
    }
    if (!cabinetId) {
      showToast('Cabinet requis (ajoutez-en un dans Paramètres > Module instruction)', 'error');
      return;
    }
    if (!dateRI) {
      showToast('Date du RI requise', 'error');
      return;
    }

    const data: NewDossierInstructionData = {
      numeroInstruction: numeroInstruction.trim(),
      numeroParquet: numeroParquet.trim(),
      cabinetId,
      magistratInstructeur: magistratInstructeur.trim() || undefined,
      dateOuverture: dateRI,
      dateRI,
      origine,
      description: description.trim() || undefined,
      misEnExamen: [],
      victimes: [],
      ops: [],
      debatsJLD: [],
      notesPerso: [],
      verifications: [],
      etatReglement: 'en_cours',
      tags: [],
    };

    onSubmit(data);
    showToast('Dossier d\'instruction créé', 'success');
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-[640px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">Nouveau dossier d'instruction</h2>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="numeroInstruction">N° instruction *</Label>
              <Input
                id="numeroInstruction"
                value={numeroInstruction}
                onChange={(e) => setNumeroInstruction(e.target.value)}
                placeholder="Ex : JIRS AC 24/05"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="numeroParquet">N° parquet *</Label>
              <Input
                id="numeroParquet"
                value={numeroParquet}
                onChange={(e) => setNumeroParquet(e.target.value)}
                placeholder="Ex : 24.139.217"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cabinetId">Cabinet *</Label>
              {cabinets.length === 0 ? (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  Aucun cabinet configuré. Ouvrez Paramètres → Module instruction pour en ajouter.
                </div>
              ) : (
                <select
                  id="cabinetId"
                  value={cabinetId}
                  onChange={(e) => setCabinetId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                >
                  {cabinets.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <Label htmlFor="magistratInstructeur">Magistrat instructeur</Label>
              <Input
                id="magistratInstructeur"
                value={magistratInstructeur}
                onChange={(e) => setMagistratInstructeur(e.target.value)}
                placeholder="Ex : Mme Dupont"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dateRI">Date du RI *</Label>
              <Input
                id="dateRI"
                type="date"
                value={dateRI}
                onChange={(e) => setDateRI(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="origine">Origine</Label>
              <select
                id="origine"
                value={origine}
                onChange={(e) => setOrigine(e.target.value as OrigineDossier)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
              >
                <option value="preliminaire">Préliminaire</option>
                <option value="flagrance">Flagrance</option>
                <option value="plainte_avec_cpc">Plainte avec CPC</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="description">Description / synthèse (optionnel)</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md resize-none"
              placeholder="Faits, contexte, points clés…"
            />
          </div>

          <div className="text-xs text-gray-500 italic">
            Les mis en examen, mesures de sûreté, OP, débats JLD, notes et vérifications se gèrent
            depuis la fiche du dossier après création.
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={handleClose}>Annuler</Button>
          <Button
            onClick={handleSubmit}
            disabled={cabinets.length === 0}
            className="bg-[#2B5746] hover:bg-[#1f3d2f]"
          >
            Créer le dossier
          </Button>
        </div>
      </div>
    </div>
  );
};
