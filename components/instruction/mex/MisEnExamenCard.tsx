'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Edit, Trash2, Save, X, User as UserIcon, Lock, MapPin, Scale, ShieldOff } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { InfractionsManager } from './InfractionsManager';
import { PersonnaliteManager } from './PersonnaliteManager';
import { DMLsManager } from './DMLsManager';
import { MesureSureteEditor } from './MesureSureteEditor';
import { getJoursRestantsAvantFinDP, getDateFinDPCourante } from '@/utils/instructionUtils';
import { getCasDPById } from '@/config/dpRegimes';
import type {
  MisEnExamen,
  MesureSurete,
  InfractionReproche,
  ElementPersonnalite,
  DemandeMiseEnLiberte,
} from '@/types/instructionTypes';

interface Props {
  mex: MisEnExamen;
  onChange: (next: MisEnExamen) => void;
  onDelete: () => void;
  defaultExpanded?: boolean;
  readOnly?: boolean;
}

const MESURE_BADGE: Record<MesureSurete['type'], { short: string; full: string; color: string; icon: React.ElementType }> = {
  libre:  { short: 'Libre',  full: 'Libre', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: ShieldOff },
  cj:     { short: 'CJ',     full: 'Contrôle judiciaire', color: 'bg-amber-100 text-amber-800 border-amber-300', icon: Scale },
  arse:   { short: 'ARSE',   full: 'ARSE', color: 'bg-purple-100 text-purple-800 border-purple-300', icon: MapPin },
  detenu: { short: 'DP',     full: 'Détention provisoire', color: 'bg-red-100 text-red-800 border-red-300', icon: Lock },
};

export const MisEnExamenCard = ({ mex, onChange, onDelete, defaultExpanded = false, readOnly }: Props) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editing, setEditing] = useState(false);
  const [draftIdentite, setDraftIdentite] = useState({
    nom: mex.nom,
    dateNaissance: mex.dateNaissance || '',
    lieuNaissance: mex.lieuNaissance || '',
    nationalite: mex.nationalite || '',
    profession: mex.profession || '',
    adresse: mex.adresse || '',
    dateMiseEnExamen: mex.dateMiseEnExamen,
  });

  const meta = MESURE_BADGE[mex.mesureSurete.type];
  const Icon = meta.icon;
  const dateFinDP = getDateFinDPCourante(mex);
  const joursRestantsDP = getJoursRestantsAvantFinDP(mex);
  const cas = mex.mesureSurete.type === 'detenu' ? getCasDPById(mex.mesureSurete.casDPId) : undefined;

  const dmlEnAttenteCount = mex.dmls.filter(d => d.statut === 'en_attente').length;

  const handleSaveIdentite = () => {
    onChange({
      ...mex,
      nom: draftIdentite.nom.trim() || mex.nom,
      dateNaissance: draftIdentite.dateNaissance || undefined,
      lieuNaissance: draftIdentite.lieuNaissance.trim() || undefined,
      nationalite: draftIdentite.nationalite.trim() || undefined,
      profession: draftIdentite.profession.trim() || undefined,
      adresse: draftIdentite.adresse.trim() || undefined,
      dateMiseEnExamen: draftIdentite.dateMiseEnExamen,
    });
    setEditing(false);
  };

  const handleChangeInfractions = (infractions: InfractionReproche[]) =>
    onChange({ ...mex, infractions });

  const handleChangePersonnalite = (elementsPersonnalite: ElementPersonnalite[]) =>
    onChange({ ...mex, elementsPersonnalite });

  const handleChangeDMLs = (dmls: DemandeMiseEnLiberte[]) =>
    onChange({ ...mex, dmls });

  const handleChangeMesureSurete = (mesureSurete: MesureSurete) =>
    onChange({ ...mex, mesureSurete });

  const handleChangeCharges = (elementsCharge: string) =>
    onChange({ ...mex, elementsCharge: elementsCharge.trim() || undefined });

  const handleChangeNotes = (notes: string) =>
    onChange({ ...mex, notes: notes.trim() || undefined });

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header (toujours visible) */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 p-3 hover:bg-gray-50 transition-colors text-left"
      >
        <UserIcon className="h-4 w-4 text-gray-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="font-semibold text-gray-800">{mex.nom}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.color}`} title={meta.full}>
              <Icon className="h-2.5 w-2.5" />
              {meta.short}
            </span>
            {dmlEnAttenteCount > 0 && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                {dmlEnAttenteCount} DML en cours
              </span>
            )}
            {dateFinDP && joursRestantsDP !== null && (
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                joursRestantsDP < 0
                  ? 'bg-red-200 text-red-900 border-red-300'
                  : joursRestantsDP <= 30
                  ? 'bg-red-100 text-red-700 border-red-200'
                  : 'bg-gray-50 text-gray-600 border-gray-200'
              }`}>
                {joursRestantsDP < 0 ? 'DP échue' : `Fin DP J+${joursRestantsDP}`}
              </span>
            )}
            {cas && (
              <span className="text-[10px] text-gray-500 font-mono">{cas.article}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            Mis en examen le {mex.dateMiseEnExamen ? new Date(mex.dateMiseEnExamen).toLocaleDateString() : '—'}
            {mex.infractions.length > 0 && (
              <> · {mex.infractions.length} chef{mex.infractions.length > 1 ? 's' : ''} d'inculpation</>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {/* Détails */}
      {expanded && (
        <div className="border-t border-gray-200 p-3 space-y-4 bg-gray-50/40">
          {/* Identité */}
          <Section
            title="Identité"
            actions={
              !readOnly && (
                editing ? (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={handleSaveIdentite} className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700">
                      <Save className="h-3 w-3 mr-1" /> OK
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-6 text-xs">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(true)} className="h-6 text-xs">
                    <Edit className="h-3 w-3" />
                  </Button>
                )
              )
            }
          >
            {editing ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Nom complet *</Label>
                  <Input
                    value={draftIdentite.nom}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, nom: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Date mise en examen *</Label>
                  <Input
                    type="date"
                    value={draftIdentite.dateMiseEnExamen}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, dateMiseEnExamen: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Date naissance</Label>
                  <Input
                    type="date"
                    value={draftIdentite.dateNaissance}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, dateNaissance: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Lieu de naissance</Label>
                  <Input
                    value={draftIdentite.lieuNaissance}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, lieuNaissance: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Nationalité</Label>
                  <Input
                    value={draftIdentite.nationalite}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, nationalite: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Profession</Label>
                  <Input
                    value={draftIdentite.profession}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, profession: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">Adresse</Label>
                  <Input
                    value={draftIdentite.adresse}
                    onChange={(e) => setDraftIdentite(d => ({ ...d, adresse: e.target.value }))}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700">
                <div><dt className="inline text-gray-500">Naissance : </dt><dd className="inline">{mex.dateNaissance ? new Date(mex.dateNaissance).toLocaleDateString() : '—'}{mex.lieuNaissance ? ` à ${mex.lieuNaissance}` : ''}</dd></div>
                <div><dt className="inline text-gray-500">Nationalité : </dt><dd className="inline">{mex.nationalite || '—'}</dd></div>
                <div><dt className="inline text-gray-500">Profession : </dt><dd className="inline">{mex.profession || '—'}</dd></div>
                <div><dt className="inline text-gray-500">Adresse : </dt><dd className="inline">{mex.adresse || '—'}</dd></div>
              </dl>
            )}
          </Section>

          {/* Infractions */}
          <Section title={`Infractions reprochées (${mex.infractions.length})`}>
            <InfractionsManager value={mex.infractions} onChange={handleChangeInfractions} readOnly={readOnly} />
          </Section>

          {/* Éléments à charge */}
          <Section title="Éléments à charge">
            {readOnly ? (
              mex.elementsCharge ? (
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{mex.elementsCharge}</div>
              ) : (
                <div className="text-xs text-gray-400 italic">Aucun élément renseigné.</div>
              )
            ) : (
              <textarea
                value={mex.elementsCharge || ''}
                onChange={(e) => handleChangeCharges(e.target.value)}
                rows={3}
                placeholder="Synthèse des éléments à charge contre ce mis en examen…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y"
              />
            )}
          </Section>

          {/* Personnalité */}
          <Section title={`Éléments de personnalité (${mex.elementsPersonnalite.length})`}>
            <PersonnaliteManager
              value={mex.elementsPersonnalite}
              onChange={handleChangePersonnalite}
              readOnly={readOnly}
            />
          </Section>

          {/* Mesures de sûreté */}
          <Section title="Mesures de sûreté">
            <MesureSureteEditor mex={mex} onChange={handleChangeMesureSurete} readOnly={readOnly} />
          </Section>

          {/* DMLs */}
          <Section title={`Demandes de mise en liberté (${mex.dmls.length})`}>
            <DMLsManager value={mex.dmls} onChange={handleChangeDMLs} readOnly={readOnly} />
          </Section>

          {/* Notes */}
          <Section title="Notes brèves">
            {readOnly ? (
              mex.notes ? (
                <div className="text-sm text-gray-700 whitespace-pre-wrap">{mex.notes}</div>
              ) : (
                <div className="text-xs text-gray-400 italic">Aucune note.</div>
              )
            ) : (
              <textarea
                value={mex.notes || ''}
                onChange={(e) => handleChangeNotes(e.target.value)}
                rows={2}
                placeholder="Notes spécifiques à ce mis en examen…"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y"
              />
            )}
          </Section>

          {/* Suppression */}
          {!readOnly && (
            <div className="pt-2 border-t border-gray-200 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm(`Supprimer définitivement "${mex.nom}" du dossier ?`)) onDelete();
                }}
                className="text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Retirer ce mis en examen du dossier
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Section = ({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {actions}
    </div>
    {children}
  </div>
);
