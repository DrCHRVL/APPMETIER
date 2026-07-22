'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { X, ClipboardPaste, Users, Scale, ListChecks, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { CassiopeeImportModal, type CassiopeeImportResult } from './CassiopeeImportModal';
import type {
  NewDossierInstructionData,
  OrigineDossier,
  MisEnExamen,
  Suspect,
  Victime,
  SaisineItem,
  EvenementInstruction,
} from '@/types/instructionTypes';
import type { ContentieuxDefinition } from '@/types/userTypes';

interface NewInstructionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: NewDossierInstructionData) => void;
  /** Liste des contentieux pour le sélecteur (récupérée du UserStore parent). */
  contentieuxDefs?: ContentieuxDefinition[];
  /** Pré-sélection éventuelle (ex. contentieux courant de l'utilisateur). */
  defaultContentieuxId?: string;
}

export const NewInstructionModal = ({
  isOpen,
  onClose,
  onSubmit,
  contentieuxDefs = [],
  defaultContentieuxId,
}: NewInstructionModalProps) => {
  const { showToast } = useToast();
  const { cabinets, getCabinetById } = useInstructionCabinets();

  const [numeroInstruction, setNumeroInstruction] = useState('');
  const [numeroParquet, setNumeroParquet] = useState('');
  const [cabinetId, setCabinetId] = useState('');
  const [magistratInstructeur, setMagistratInstructeur] = useState('');
  const [dateRI, setDateRI] = useState(() => new Date().toISOString().split('T')[0]);
  const [origine, setOrigine] = useState<OrigineDossier>('preliminaire');
  const [description, setDescription] = useState('');
  const [contentieuxId, setContentieuxId] = useState<string>(defaultContentieuxId || '');

  // Import Cassiopée (copier-coller) : les personnes / chefs de saisine /
  // événements collés sont mis en attente ici puis inclus dans le dossier créé.
  const [showCassiopeeImport, setShowCassiopeeImport] = useState(false);
  const [importedMex, setImportedMex] = useState<MisEnExamen[]>([]);
  const [importedSuspects, setImportedSuspects] = useState<Suspect[]>([]);
  const [importedVictimes, setImportedVictimes] = useState<Victime[]>([]);
  const [importedSaisine, setImportedSaisine] = useState<SaisineItem[]>([]);
  const [importedEvenements, setImportedEvenements] = useState<EvenementInstruction[]>([]);

  const hasImported = useMemo(
    () =>
      importedMex.length +
        importedSuspects.length +
        importedVictimes.length +
        importedSaisine.length +
        importedEvenements.length >
      0,
    [importedMex, importedSuspects, importedVictimes, importedSaisine, importedEvenements],
  );

  const handleCassiopeeImport = (r: CassiopeeImportResult) => {
    // En-tête : renseigne les champs du formulaire (modifiables ensuite).
    if (r.header) {
      if (r.header.numeroInstruction) setNumeroInstruction(r.header.numeroInstruction);
      if (r.header.numeroParquet) setNumeroParquet(r.header.numeroParquet);
      if (r.header.dateRI) setDateRI(r.header.dateRI);
    }
    // Personnes / saisine / événements : mis en attente pour la création.
    setImportedMex(prev => [...prev, ...r.misEnExamen]);
    setImportedSuspects(prev => [...prev, ...r.suspects]);
    setImportedVictimes(prev => [...prev, ...r.victimes]);
    setImportedSaisine(prev => [...prev, ...r.saisine]);
    setImportedEvenements(prev => [...prev, ...r.evenements]);
  };

  const clearImported = () => {
    setImportedMex([]);
    setImportedSuspects([]);
    setImportedVictimes([]);
    setImportedSaisine([]);
    setImportedEvenements([]);
  };

  // Si la prop `defaultContentieuxId` change pendant que la modal est ouverte
  // (rare, mais possible si le contentieux actif change), on re-synchronise.
  useEffect(() => {
    if (defaultContentieuxId) setContentieuxId(defaultContentieuxId);
  }, [defaultContentieuxId]);

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
    setContentieuxId(defaultContentieuxId || '');
    clearImported();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Échap ferme la modale (comportement standard, aligné sur les autres modales).
  // Désactivé quand la modale d'import Cassiopée est ouverte par-dessus, pour ne
  // pas fermer le formulaire par mégarde.
  useEscapeKey(handleClose, isOpen && !showCassiopeeImport);

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
      contentieuxId: contentieuxId || undefined,
      dateOuverture: dateRI,
      dateRI,
      origine,
      description: description.trim() || undefined,
      misEnExamen: importedMex,
      suspects: importedSuspects.length ? importedSuspects : undefined,
      victimes: importedVictimes,
      saisine: importedSaisine.length ? importedSaisine : undefined,
      ops: [],
      debatsJLD: [],
      notesPerso: [],
      verifications: [],
      evenements: importedEvenements,
      etatReglement: 'en_cours',
      tags: [],
    };

    onSubmit(data);
    showToast(
      hasImported
        ? `Dossier créé avec ${importedMex.length} MEX, ${importedSaisine.length} chef(s) de saisine, ${importedEvenements.length} événement(s)`
        : 'Dossier d\'instruction créé',
      'success',
    );
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-[640px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">Nouveau dossier d'instruction</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCassiopeeImport(true)}
              title="Pré-remplir depuis Cassiopée (copier-coller)"
              className="gap-1.5"
            >
              <ClipboardPaste className="h-4 w-4" />
              Importer Cassiopée
            </Button>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Récapitulatif de ce qui a été pré-rempli depuis Cassiopée. */}
          {hasImported && (
            <div className="rounded-lg border border-[#2B5746]/30 bg-[#2B5746]/5 px-3 py-2 text-xs text-gray-700">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#2B5746] flex items-center gap-1.5">
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Importé de Cassiopée — sera ajouté à la création
                </span>
                <button
                  type="button"
                  onClick={clearImported}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" /> Vider
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
                {importedMex.length > 0 && (
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{importedMex.length} mis en examen</span>
                )}
                {importedSuspects.length > 0 && (
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{importedSuspects.length} suspect(s)</span>
                )}
                {importedVictimes.length > 0 && (
                  <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{importedVictimes.length} victime(s)</span>
                )}
                {importedSaisine.length > 0 && (
                  <span className="inline-flex items-center gap-1"><Scale className="h-3 w-3" />{importedSaisine.length} chef(s) de saisine</span>
                )}
                {importedEvenements.length > 0 && (
                  <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" />{importedEvenements.length} événement(s)</span>
                )}
              </div>
            </div>
          )}
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

          {/* Contentieux : permet de filtrer/colorier le dossier sur la
              cartographie. Optionnel pour le formulaire (les fiches anciennes
              sans valeur tombent en "Instructions" générique côté carto). */}
          {contentieuxDefs.length > 0 && (
            <div>
              <Label htmlFor="contentieuxId">Contentieux</Label>
              <select
                id="contentieuxId"
                value={contentieuxId}
                onChange={(e) => setContentieuxId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
              >
                <option value="">— non précisé —</option>
                {contentieuxDefs.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">
                Détermine la couleur et le filtrage de ce dossier sur la cartographie.
              </p>
            </div>
          )}

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
            Astuce : le bouton « Importer Cassiopée » pré-remplit l'en-tête, les mis en examen et
            les chefs de saisine. Les mesures de sûreté, OP, débats JLD, notes et vérifications se
            gèrent depuis la fiche du dossier après création.
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

      {/* Import Cassiopée : réutilise la modale de collage. Les données déjà
          mises en attente servent d'« existant » pour la déduplication. À la
          création, on applique l'en-tête par défaut. */}
      <CassiopeeImportModal
        isOpen={showCassiopeeImport}
        onClose={() => setShowCassiopeeImport(false)}
        onImport={handleCassiopeeImport}
        existingMisEnExamen={importedMex}
        existingSuspects={importedSuspects}
        existingVictimes={importedVictimes}
        existingSaisine={importedSaisine}
        applyHeaderDefault
      />
    </div>
  );
};
