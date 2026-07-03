'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Edit, Trash2, Save, X, User as UserIcon, Lock, MapPin, Scale, ShieldOff } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { InfractionsManager } from './InfractionsManager';
import { DMLsManager } from './DMLsManager';
import { MesureSureteEditor } from './MesureSureteEditor';
import { VerificationLegaleDP } from './VerificationLegaleDP';
import { RichTextEditor } from '../RichTextEditor';
import {
  getJoursRestantsAvantFinDP,
  getDateFinDPCourante,
  getDateFinDPCouranteEstimee,
  getDateFinMaxLegale,
  getJoursRestantsAvantMaxLegal,
  getPeriodeDPCourante,
} from '@/utils/instructionUtils';
import { getCasDPById } from '@/config/dpRegimes';
import { useInstructionAlertRules } from '@/hooks/useInstructionAlertRules';
import type {
  MisEnExamen,
  MesureSurete,
  InfractionReproche,
  DemandeMiseEnLiberte,
  SaisineItem,
} from '@/types/instructionTypes';

interface Props {
  mex: MisEnExamen;
  onChange: (next: MisEnExamen) => void;
  onDelete: () => void;
  defaultExpanded?: boolean;
  /** Mode contrôlé : si fourni, remplace l'état interne d'expansion. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Saisine in rem du dossier : périmètre des chefs d'inculpation possibles. */
  saisine?: SaisineItem[];
  readOnly?: boolean;
}

const MESURE_BADGE: Record<MesureSurete['type'], { short: string; full: string; color: string; icon: React.ElementType }> = {
  libre:  { short: 'Libre',  full: 'Libre', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: ShieldOff },
  cj:     { short: 'CJ',     full: 'Contrôle judiciaire', color: 'bg-amber-100 text-amber-800 border-amber-300', icon: Scale },
  arse:   { short: 'ARSE',   full: 'ARSE', color: 'bg-purple-100 text-purple-800 border-purple-300', icon: MapPin },
  detenu: { short: 'DP',     full: 'Détention provisoire', color: 'bg-red-100 text-red-800 border-red-300', icon: Lock },
};

export const MisEnExamenCard = ({
  mex,
  onChange,
  onDelete,
  defaultExpanded = false,
  expanded: expandedProp,
  onToggleExpanded,
  saisine = [],
  readOnly,
}: Props) => {
  const [expandedInternal, setExpandedInternal] = useState(defaultExpanded);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedInternal;
  const toggleExpanded = () => {
    if (onToggleExpanded) onToggleExpanded();
    if (!isControlled) setExpandedInternal(e => !e);
  };
  const [editing, setEditing] = useState(false);
  const [draftIdentite, setDraftIdentite] = useState({
    nom: mex.nom,
    dateNaissance: mex.dateNaissance || '',
    lieuNaissance: mex.lieuNaissance || '',
    nationalite: mex.nationalite || '',
    dateMiseEnExamen: mex.dateMiseEnExamen,
  });

  const meta = MESURE_BADGE[mex.mesureSurete.type];
  const Icon = meta.icon;
  const dateFinDP = getDateFinDPCourante(mex);
  const dateFinDPEstimee = getDateFinDPCouranteEstimee(mex);
  const dateFinActuelle = dateFinDP || dateFinDPEstimee;
  const joursRestantsDP = getJoursRestantsAvantFinDP(mex);
  const joursRestantsActuels = (() => {
    if (!dateFinActuelle) return null;
    const fin = new Date(dateFinActuelle);
    fin.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((fin.getTime() - today.getTime()) / 86400000);
  })();
  const dateFinMaxDP = getDateFinMaxLegale(mex);
  const joursMaxDP = getJoursRestantsAvantMaxLegal(mex);
  const periodeDPCourante = getPeriodeDPCourante(mex);
  const cas = mex.mesureSurete.type === 'detenu' ? getCasDPById(mex.mesureSurete.casDPId) : undefined;
  const { rules: alertRules } = useInstructionAlertRules();
  const seuilFinDP = alertRules.find(r => r.trigger === 'dp_fin_proche')?.seuil ?? 21;
  const seuilMaxDP = alertRules.find(r => r.trigger === 'dp_max_proche')?.seuil ?? 90;

  const hasNotes = !!mex.elementsCharge?.trim();

  // Les DML n'ont de sens que pour un MEX détenu (Demande de Mise en Liberté).
  // On masque la section et le compteur pour les autres statuts.
  const showDMLs = mex.mesureSurete.type === 'detenu';
  const dmlEnAttenteCount = showDMLs ? mex.dmls.filter(d => d.statut === 'en_attente').length : 0;

  const handleSaveIdentite = () => {
    onChange({
      ...mex,
      nom: draftIdentite.nom.trim() || mex.nom,
      dateNaissance: draftIdentite.dateNaissance || undefined,
      lieuNaissance: draftIdentite.lieuNaissance.trim() || undefined,
      nationalite: draftIdentite.nationalite.trim() || undefined,
      dateMiseEnExamen: draftIdentite.dateMiseEnExamen,
    });
    setEditing(false);
  };

  const handleChangeInfractions = (infractions: InfractionReproche[]) =>
    onChange({ ...mex, infractions });

  const handleChangeDMLs = (dmls: DemandeMiseEnLiberte[]) =>
    onChange({ ...mex, dmls });

  const handleChangeMesureSurete = (mesureSurete: MesureSurete) =>
    onChange({ ...mex, mesureSurete });

  const handleChangeNotes = (html: string) =>
    onChange({ ...mex, elementsCharge: html.trim() || undefined });

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      {/* Header (toujours visible) */}
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full flex items-center gap-2 p-3 hover:bg-gray-50 transition-colors text-left"
      >
        <UserIcon className="h-4 w-4 text-gray-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5">
            <span className="font-semibold text-gray-800 truncate">{mex.nom}</span>
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${meta.color}`} title={meta.full}>
              <Icon className="h-2.5 w-2.5" />
              {meta.short}
            </span>
            {dmlEnAttenteCount > 0 && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                {dmlEnAttenteCount} DML en cours
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

          {/* Dates DP en aperçu rapide (uniquement si MEX détenu) */}
          {mex.mesureSurete.type === 'detenu' && (dateFinActuelle || dateFinMaxDP) && (
            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
              {periodeDPCourante?.dateDebut && (
                <span className="px-1.5 py-0.5 rounded border bg-gray-50 text-gray-600 border-gray-200">
                  Début&nbsp;: {new Date(periodeDPCourante.dateDebut).toLocaleDateString()}
                </span>
              )}
              {dateFinActuelle && (
                <span
                  className={`px-1.5 py-0.5 rounded border ${
                    joursRestantsActuels !== null && joursRestantsActuels < 0
                      ? 'bg-red-200 text-red-900 border-red-300'
                      : joursRestantsActuels !== null && joursRestantsActuels <= seuilFinDP
                      ? 'bg-red-100 text-red-700 border-red-300 font-semibold'
                      : 'bg-gray-50 text-gray-600 border-gray-200'
                  }`}
                  title={
                    dateFinDP
                      ? 'Fin de la période DP courante'
                      : 'Fin actuelle estimée (placement initial non encore enregistré — basée sur la durée légale initiale)'
                  }
                >
                  Fin actuelle&nbsp;: {new Date(dateFinActuelle).toLocaleDateString()}
                  {!dateFinDP && <span className="ml-1 italic text-[9px] opacity-70">(est.)</span>}
                </span>
              )}
              {dateFinMaxDP && (
                <span
                  className={`px-1.5 py-0.5 rounded border ${
                    joursMaxDP !== null && joursMaxDP < 0
                      ? 'bg-red-200 text-red-900 border-red-300'
                      : joursMaxDP !== null && joursMaxDP <= seuilMaxDP
                      ? 'bg-red-100 text-red-700 border-red-300 font-semibold'
                      : 'bg-gray-50 text-gray-600 border-gray-200'
                  }`}
                  title="Date à laquelle la durée légale max sera atteinte"
                >
                  Fin maximal&nbsp;: {new Date(dateFinMaxDP).toLocaleDateString()}
                </span>
              )}
              {dmlEnAttenteCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                  {dmlEnAttenteCount} DML en cours
                </span>
              )}
            </div>
          )}

          {/* Aperçu rapide infractions */}
          {mex.infractions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {mex.infractions.slice(0, 4).map(inf => (
                <span
                  key={inf.id}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 truncate max-w-[220px]"
                  title={inf.qualification}
                >
                  {inf.qualification}
                </span>
              ))}
              {mex.infractions.length > 4 && (
                <span className="text-[10px] text-gray-400">+{mex.infractions.length - 4}</span>
              )}
            </div>
          )}

          {/* Aperçu rapide notes (HTML formaté) */}
          {hasNotes && (
            <div
              className="mt-1 text-[11px] text-gray-700 prose prose-xs max-w-none [&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_mark]:bg-yellow-200 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
              dangerouslySetInnerHTML={{ __html: mex.elementsCharge! }}
            />
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {/* Détails */}
      {expanded && (
        <div className="border-t border-gray-200 p-3 space-y-4 bg-gray-50/40">
          {/* Identité (sans profession ni adresse) */}
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
                <div className="col-span-2">
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
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-700">
                <div><dt className="inline text-gray-500">Mis en examen le : </dt><dd className="inline">{mex.dateMiseEnExamen ? new Date(mex.dateMiseEnExamen).toLocaleDateString() : '—'}</dd></div>
              </dl>
            )}
          </Section>

          {/* Infractions */}
          <Section title={`Infractions reprochées (${mex.infractions.length})`}>
            <InfractionsManager value={mex.infractions} onChange={handleChangeInfractions} saisine={saisine} readOnly={readOnly} />
          </Section>

          {/* NOTES (ex-éléments à charge) avec éditeur riche */}
          <Section title="Notes">
            <RichTextEditor
              id={`mex-notes-${mex.id}`}
              value={mex.elementsCharge || ''}
              onChange={handleChangeNotes}
              placeholder="Notes sur ce mis en examen, éléments à charge, observations…"
              minHeight={120}
              maxHeight="35vh"
              readOnly={readOnly}
            />
          </Section>

          {/* Mesures de sûreté */}
          <Section title="Mesures de sûreté">
            <MesureSureteEditor mex={mex} onChange={handleChangeMesureSurete} readOnly={readOnly} />
            <div className="mt-2">
              <VerificationLegaleDP mex={mex} />
            </div>
          </Section>

          {/* DMLs : uniquement pour les MEX détenus */}
          {showDMLs && (
            <Section title={`Demandes de mise en liberté (${mex.dmls.length})`}>
              <DMLsManager value={mex.dmls} onChange={handleChangeDMLs} readOnly={readOnly} />
            </Section>
          )}

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
  children?: React.ReactNode;
}) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {actions}
    </div>
    {children}
  </div>
);
