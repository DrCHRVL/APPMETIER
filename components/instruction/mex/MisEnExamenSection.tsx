'use client';

import React, { useEffect, useState } from 'react';
import { Plus, X, ChevronsDownUp, ChevronsUpDown, ArrowRightCircle, Search, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { MecAutocompleteInput } from '../../ui/MecAutocompleteInput';
import { MisEnExamenCard } from './MisEnExamenCard';
import type { MisEnExamen, Suspect, SaisineItem } from '@/types/instructionTypes';

interface Props {
  misEnExamen: MisEnExamen[];
  suspects?: Suspect[];
  /** Saisine in rem du dossier : périmètre des chefs d'inculpation possibles
   *  et déduction du régime/cas de détention provisoire. */
  saisine?: SaisineItem[];
  onChange: (next: MisEnExamen[]) => void;
  onSuspectsChange?: (next: Suspect[]) => void;
  readOnly?: boolean;
  /** Noms connus cross-dossiers pour l'autocomplete (MEX + suspects) */
  allKnownNames?: string[];
}

// ── Composant interne : carte suspect ─────────────────────────────────────────

interface SuspectCardProps {
  suspect: Suspect;
  onDelete: () => void;
  onEdit: (updated: Suspect) => void;
  onConvert: (dateMex: string) => void;
  readOnly?: boolean;
  allKnownNames?: string[];
}

const SuspectCard = ({ suspect, onDelete, onEdit, onConvert, readOnly, allKnownNames = [] }: SuspectCardProps) => {
  const [editing, setEditing] = useState(false);
  const [draftNom, setDraftNom] = useState(suspect.nom);
  const [draftRole, setDraftRole] = useState(suspect.role ?? '');
  const [converting, setConverting] = useState(false);
  const [dateMex, setDateMex] = useState(() => new Date().toISOString().split('T')[0]);

  const saveEdit = () => {
    if (!draftNom.trim()) return;
    onEdit({ ...suspect, nom: draftNom.trim(), role: draftRole.trim() || undefined });
    setEditing(false);
  };

  const confirmConvert = () => {
    if (!dateMex) return;
    onConvert(dateMex);
    setConverting(false);
  };

  return (
    <div className="bg-white border border-amber-200 rounded-lg p-2.5 shadow-sm space-y-2">
      {editing ? (
        <div className="space-y-1.5">
          <div>
            <Label className="text-xs">Nom *</Label>
            <MecAutocompleteInput
              value={draftNom}
              onChange={setDraftNom}
              suggestions={allKnownNames}
              minTriggerLength={4}
              className="h-7 text-sm"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Rôle dans l'affaire (optionnel)</Label>
            <Input
              value={draftRole}
              onChange={(e) => setDraftRole(e.target.value)}
              placeholder="Ex : organisateur, transporteur…"
              className="h-7 text-sm"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => { setEditing(false); setDraftNom(suspect.nom); setDraftRole(suspect.role ?? ''); }}
            >
              <X className="h-3 w-3 mr-1" />Annuler
            </Button>
            <Button
              size="sm"
              className="h-6 text-xs bg-amber-600 hover:bg-amber-700"
              onClick={saveEdit}
              disabled={!draftNom.trim()}
            >
              Enregistrer
            </Button>
          </div>
        </div>
      ) : converting ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-emerald-800">
            Mise en examen de <span className="font-bold">{suspect.nom}</span>
          </p>
          <div>
            <Label className="text-xs">Date de mise en examen *</Label>
            <Input
              type="date"
              value={dateMex}
              onChange={(e) => setDateMex(e.target.value)}
              className="h-7 text-sm"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setConverting(false)}
            >
              <X className="h-3 w-3 mr-1" />Annuler
            </Button>
            <Button
              size="sm"
              className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700"
              onClick={confirmConvert}
              disabled={!dateMex}
            >
              <ArrowRightCircle className="h-3 w-3 mr-1" />
              Mettre en examen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{suspect.nom}</p>
            {suspect.role && (
              <p className="text-xs text-amber-700 truncate">{suspect.role}</p>
            )}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                title="Modifier"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setConverting(true)}
                className="p-1 rounded hover:bg-emerald-50 text-emerald-500 hover:text-emerald-700"
                title="Mettre en examen"
              >
                <ArrowRightCircle className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onDelete}
                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                title="Supprimer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Section principale ─────────────────────────────────────────────────────────

export const MisEnExamenSection = ({ misEnExamen, suspects = [], saisine = [], onChange, onSuspectsChange, readOnly, allKnownNames = [] }: Props) => {
  const [showAddMexForm, setShowAddMexForm] = useState(false);
  const [draftNom, setDraftNom] = useState('');
  const [draftDate, setDraftDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(
    () => new Set(misEnExamen.length === 1 ? [misEnExamen[0].id] : []),
  );

  // Ajout suspect
  const [showAddSuspectForm, setShowAddSuspectForm] = useState(false);
  const [draftSuspectNom, setDraftSuspectNom] = useState('');
  const [draftSuspectRole, setDraftSuspectRole] = useState('');

  // Déplie automatiquement un MEX fraîchement ajouté.
  useEffect(() => {
    if (lastAddedId !== null && !expandedIds.has(lastAddedId)) {
      setExpandedIds(prev => new Set(prev).add(lastAddedId));
    }
  }, [lastAddedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpanded = (id: number) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allExpanded = misEnExamen.length > 0 && misEnExamen.every(m => expandedIds.has(m.id));
  const collapseAll = () => setExpandedIds(new Set());
  const expandAll = () => setExpandedIds(new Set(misEnExamen.map(m => m.id)));

  // ── MEX handlers ───────────────────────────────────────────────────────────

  const handleAddMex = () => {
    if (!draftNom.trim()) return;
    const newId = Date.now() + Math.floor(Math.random() * 1000);
    const newMex: MisEnExamen = {
      id: newId,
      nom: draftNom.trim(),
      dateMiseEnExamen: draftDate,
      infractions: [],
      elementsPersonnalite: [],
      mesureSurete: { type: 'libre', depuis: draftDate },
      dmls: [],
    };
    onChange([...misEnExamen, newMex]);
    setLastAddedId(newId);
    setDraftNom('');
    setDraftDate(new Date().toISOString().split('T')[0]);
    setShowAddMexForm(false);
  };

  const handleUpdateMex = (id: number, next: MisEnExamen) =>
    onChange(misEnExamen.map(m => (m.id === id ? next : m)));

  const handleRemoveMex = (id: number) =>
    onChange(misEnExamen.filter(m => m.id !== id));

  // ── Suspect handlers ───────────────────────────────────────────────────────

  const handleAddSuspect = () => {
    if (!draftSuspectNom.trim()) return;
    const newSuspect: Suspect = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      nom: draftSuspectNom.trim(),
      role: draftSuspectRole.trim() || undefined,
    };
    onSuspectsChange?.([...suspects, newSuspect]);
    setDraftSuspectNom('');
    setDraftSuspectRole('');
    setShowAddSuspectForm(false);
  };

  const handleEditSuspect = (id: number, updated: Suspect) =>
    onSuspectsChange?.(suspects.map(s => (s.id === id ? updated : s)));

  const handleDeleteSuspect = (id: number) =>
    onSuspectsChange?.(suspects.filter(s => s.id !== id));

  /** Bascule un suspect en MEX : crée la fiche MEX, supprime le suspect. */
  const handleConvertSuspect = (suspect: Suspect, dateMexValue: string) => {
    const newId = Date.now() + Math.floor(Math.random() * 1000);
    const newMex: MisEnExamen = {
      id: newId,
      nom: suspect.nom,
      dateMiseEnExamen: dateMexValue,
      infractions: [],
      elementsPersonnalite: [],
      mesureSurete: { type: 'libre', depuis: dateMexValue },
      dmls: [],
    };
    onChange([...misEnExamen, newMex]);
    setLastAddedId(newId);
    onSuspectsChange?.(suspects.filter(s => s.id !== suspect.id));
  };

  return (
    <div className="space-y-4">

      {/* ── Bloc suspects ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-amber-700 uppercase flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />
            Suspects / futurs MEX
            {suspects.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                {suspects.length}
              </span>
            )}
          </h3>
        </div>

        {suspects.length === 0 && !showAddSuspectForm && (
          <p className="text-xs text-gray-400 italic">Aucun suspect renseigné.</p>
        )}

        {suspects.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {suspects.map(s => (
              <SuspectCard
                key={s.id}
                suspect={s}
                readOnly={readOnly}
                onDelete={() => handleDeleteSuspect(s.id)}
                onEdit={(updated) => handleEditSuspect(s.id, updated)}
                onConvert={(date) => handleConvertSuspect(s, date)}
                allKnownNames={allKnownNames}
              />
            ))}
          </div>
        )}

        {!readOnly && (
          showAddSuspectForm ? (
            <div className="border-2 border-dashed border-amber-300 rounded-lg p-3 bg-amber-50/30 space-y-2">
              <h4 className="text-sm font-semibold text-gray-700">Nouveau suspect</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nom complet *</Label>
                  <MecAutocompleteInput
                    value={draftSuspectNom}
                    onChange={setDraftSuspectNom}
                    suggestions={allKnownNames}
                    minTriggerLength={4}
                    placeholder="Ex: MARTIN Paul"
                    autoFocus
                    className="h-8 text-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddSuspect(); if (e.key === 'Escape') { setShowAddSuspectForm(false); setDraftSuspectNom(''); setDraftSuspectRole(''); } }}
                  />
                </div>
                <div>
                  <Label className="text-xs">Rôle dans l'affaire (optionnel)</Label>
                  <Input
                    value={draftSuspectRole}
                    onChange={(e) => setDraftSuspectRole(e.target.value)}
                    placeholder="Ex: organisateur, chauffeur…"
                    className="h-8 text-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddSuspect(); if (e.key === 'Escape') { setShowAddSuspectForm(false); setDraftSuspectNom(''); setDraftSuspectRole(''); } }}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowAddSuspectForm(false); setDraftSuspectNom(''); setDraftSuspectRole(''); }}
                  className="h-7 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />Annuler
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddSuspect}
                  disabled={!draftSuspectNom.trim()}
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="h-3 w-3 mr-1" />Ajouter
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddSuspectForm(true)}
              className="w-full text-xs text-amber-700 hover:bg-amber-50 py-1.5 rounded-lg border border-dashed border-amber-300 inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter un suspect
            </button>
          )
        )}
      </div>

      {/* Séparateur */}
      <div className="border-t border-gray-200" />

      {/* ── Bloc MEX ──────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">
          Mis en examen
          {misEnExamen.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 text-[10px] font-bold">
              {misEnExamen.length}
            </span>
          )}
        </h3>

        {misEnExamen.length === 0 && !showAddMexForm && (
          <div className="text-center py-6 text-gray-500 text-sm bg-gray-50 border border-dashed border-gray-300 rounded-lg">
            Aucun mis en examen pour ce dossier.
          </div>
        )}

        {misEnExamen.length > 1 && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={allExpanded ? collapseAll : expandAll}
              className="h-7 text-xs text-gray-600 hover:text-emerald-700"
            >
              {allExpanded ? (
                <><ChevronsDownUp className="h-3.5 w-3.5 mr-1" />Tout replier</>
              ) : (
                <><ChevronsUpDown className="h-3.5 w-3.5 mr-1" />Tout déplier</>
              )}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2 items-start">
          {misEnExamen.map(mex => (
            <MisEnExamenCard
              key={mex.id}
              mex={mex}
              saisine={saisine}
              onChange={(next) => handleUpdateMex(mex.id, next)}
              onDelete={() => handleRemoveMex(mex.id)}
              expanded={expandedIds.has(mex.id)}
              onToggleExpanded={() => toggleExpanded(mex.id)}
              readOnly={readOnly}
            />
          ))}
        </div>

        {!readOnly && (
          showAddMexForm ? (
            <div className="border-2 border-dashed border-emerald-300 rounded-lg p-3 bg-emerald-50/30 space-y-2">
              <h4 className="text-sm font-semibold text-gray-700">Nouveau mis en examen</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nom complet *</Label>
                  <MecAutocompleteInput
                    value={draftNom}
                    onChange={setDraftNom}
                    suggestions={allKnownNames}
                    minTriggerLength={4}
                    placeholder="Ex: DUPONT Jean"
                    autoFocus
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Date de mise en examen *</Label>
                  <Input
                    type="date"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowAddMexForm(false); setDraftNom(''); }}
                  className="h-7 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />Annuler
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddMex}
                  disabled={!draftNom.trim()}
                  className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                >
                  <Plus className="h-3 w-3 mr-1" />Ajouter
                </Button>
              </div>
              <p className="text-[11px] text-gray-500">
                Les détails (infractions, mesures de sûreté, DML…) se renseignent ensuite en dépliant la carte.
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowAddMexForm(true)}
              className="w-full text-sm text-emerald-700 hover:bg-emerald-50 py-2 rounded-lg border-2 border-dashed border-emerald-300 inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Ajouter un mis en examen
            </button>
          )
        )}
      </div>
    </div>
  );
};
