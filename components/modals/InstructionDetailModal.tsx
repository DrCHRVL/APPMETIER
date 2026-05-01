'use client';

import React, { useState } from 'react';
import { X, Edit, Trash2, Save, FileText, Users, Calendar, ListChecks, ClipboardCheck, NotebookPen, Briefcase } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import {
  ETAT_REGLEMENT_LABELS,
  ETAT_REGLEMENT_BADGE_COLORS,
  ORIENTATION_LABELS,
  FALLBACK_CABINET_COLOR,
} from '@/config/instructionConfig';
import {
  countMexByStatut,
  countTotalDMLs,
  countDMLsEnAttente,
  getDossierAgeJours,
  formatDossierAge,
} from '@/utils/instructionUtils';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { MisEnExamenSection } from '../instruction/mex/MisEnExamenSection';
import { OpsSection } from '../instruction/OpsSection';
import { DebatsJLDSection } from '../instruction/DebatsJLDSection';
import { NotesPersoSection } from '../instruction/NotesPersoSection';
import { VerificationsSection } from '../instruction/VerificationsSection';
import { DossierTimelineSection } from '../instruction/DossierTimelineSection';
import type {
  DossierInstruction,
  EtatReglement,
  OrientationPrevisible,
  MisEnExamen,
  OPInstruction,
  DebatJLDPlanifie,
  NotePersoInstruction,
  VerificationPeriodique,
} from '@/types/instructionTypes';

interface InstructionDetailModalProps {
  dossier: DossierInstruction;
  isEditing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onUpdate: (id: number, updates: Partial<DossierInstruction>) => void;
  onDelete: (id: number) => void;
}

type TabKey = 'apercu' | 'mex' | 'echeances' | 'timeline' | 'notes' | 'verifs' | 'orientation';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'apercu',      label: 'Aperçu',         icon: FileText },
  { key: 'mex',         label: 'Mis en examen',  icon: Users },
  { key: 'echeances',   label: 'OP & JLD',       icon: Calendar },
  { key: 'timeline',    label: 'Timeline',       icon: ListChecks },
  { key: 'notes',       label: 'Notes perso',    icon: NotebookPen },
  { key: 'verifs',      label: 'Vérifications',  icon: ClipboardCheck },
  { key: 'orientation', label: 'Orientation',    icon: Briefcase },
];

const ComingSoon = ({ children }: { children: React.ReactNode }) => (
  <div className="border border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50">
    <ListChecks className="h-8 w-8 mx-auto mb-2 text-gray-300" />
    <div className="text-sm text-gray-500">{children}</div>
  </div>
);

export const InstructionDetailModal = ({
  dossier,
  isEditing,
  onClose,
  onEdit,
  onUpdate,
  onDelete,
}: InstructionDetailModalProps) => {
  const { showToast } = useToast();
  const { getCabinetById } = useInstructionCabinets();
  const cabinet = getCabinetById(dossier.cabinetId);
  const cabinetColor = cabinet?.color || FALLBACK_CABINET_COLOR;

  const [activeTab, setActiveTab] = useState<TabKey>('apercu');

  // État local pour l'édition
  const [editData, setEditData] = useState<Partial<DossierInstruction>>({
    numeroInstruction: dossier.numeroInstruction,
    numeroParquet: dossier.numeroParquet,
    cabinetId: dossier.cabinetId,
    magistratInstructeur: dossier.magistratInstructeur,
    description: dossier.description,
    dateOuverture: dossier.dateOuverture,
    dateRI: dossier.dateRI,
    etatReglement: dossier.etatReglement,
    orientationPrevisible: dossier.orientationPrevisible,
    cotesTomes: dossier.cotesTomes,
  });

  const handleSave = () => {
    if (!editData.numeroInstruction?.trim()) {
      showToast('N° instruction requis', 'error');
      return;
    }
    onUpdate(dossier.id, editData);
    showToast('Dossier mis à jour', 'success');
    onEdit();
  };

  const handleDelete = () => {
    if (confirm(`Supprimer définitivement "${dossier.numeroInstruction}" ?`)) {
      onDelete(dossier.id);
      showToast('Dossier supprimé', 'success');
      onClose();
    }
  };

  const stats = (() => {
    const byStatut = countMexByStatut(dossier);
    return {
      nbMex: dossier.misEnExamen.length,
      nbDetenu: byStatut.detenu,
      nbCJ: byStatut.cj,
      nbARSE: byStatut.arse,
      nbDML: countTotalDMLs(dossier),
      nbDMLenAttente: countDMLsEnAttente(dossier),
      ageJours: getDossierAgeJours(dossier),
    };
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] max-w-[1100px] h-[90vh] flex flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-gray-200"
          style={{ backgroundColor: cabinetColor + '12' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {dossier.numeroInstruction}
              </h2>
              <Badge
                variant="outline"
                className="text-xs py-0.5 px-2 font-bold border-2"
                style={{ borderColor: cabinetColor, color: cabinetColor, backgroundColor: cabinetColor + '20' }}
              >
                {cabinet?.label || 'Cabinet ?'}
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs py-0.5 px-2 ${ETAT_REGLEMENT_BADGE_COLORS[dossier.etatReglement]}`}
              >
                {ETAT_REGLEMENT_LABELS[dossier.etatReglement]}
              </Badge>
              {dossier.orientationPrevisible && (
                <Badge variant="outline" className="text-xs py-0.5 px-2 bg-indigo-50 text-indigo-700 border-indigo-200">
                  → {ORIENTATION_LABELS[dossier.orientationPrevisible]}
                </Badge>
              )}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">
              Parquet : {dossier.numeroParquet}
              {dossier.magistratInstructeur && <> · {dossier.magistratInstructeur}</>}
              {' · '}
              Ouvert {dossier.dateOuverture ? new Date(dossier.dateOuverture).toLocaleDateString() : '—'}
              {' · '}
              {formatDossierAge(stats.ageJours)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!isEditing && (
              <>
                <Button variant="ghost" size="sm" onClick={onEdit} title="Modifier">
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDelete} title="Supprimer" className="text-red-600 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {isEditing && (
              <Button size="sm" onClick={handleSave} className="bg-[#2B5746] hover:bg-[#1f3d2f]">
                <Save className="h-4 w-4 mr-1" />
                Enregistrer
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} title="Fermer">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50 px-2">
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-emerald-600 text-emerald-700 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-white/60'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'apercu' && (
            isEditing ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>N° instruction</Label>
                  <Input
                    value={editData.numeroInstruction || ''}
                    onChange={(e) => setEditData(d => ({ ...d, numeroInstruction: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>N° parquet</Label>
                  <Input
                    value={editData.numeroParquet || ''}
                    onChange={(e) => setEditData(d => ({ ...d, numeroParquet: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Magistrat instructeur</Label>
                  <Input
                    value={editData.magistratInstructeur || ''}
                    onChange={(e) => setEditData(d => ({ ...d, magistratInstructeur: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Date du RI</Label>
                  <Input
                    type="date"
                    value={editData.dateRI || ''}
                    onChange={(e) => setEditData(d => ({ ...d, dateRI: e.target.value, dateOuverture: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>État de règlement</Label>
                  <select
                    value={editData.etatReglement || 'en_cours'}
                    onChange={(e) => setEditData(d => ({ ...d, etatReglement: e.target.value as EtatReglement }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                  >
                    {(Object.keys(ETAT_REGLEMENT_LABELS) as EtatReglement[]).map(k => (
                      <option key={k} value={k}>{ETAT_REGLEMENT_LABELS[k]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Côtes / tomes</Label>
                  <Input
                    type="number"
                    min={0}
                    value={editData.cotesTomes ?? 0}
                    onChange={(e) => setEditData(d => ({ ...d, cotesTomes: Number(e.target.value) || 0 }))}
                  />
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <textarea
                    value={editData.description || ''}
                    onChange={(e) => setEditData(d => ({ ...d, description: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md resize-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Stats rapides */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <Stat label="MEX" value={stats.nbMex} />
                  <Stat label="En DP" value={stats.nbDetenu} highlight={stats.nbDetenu > 0 ? 'red' : undefined} />
                  <Stat label="CJ" value={stats.nbCJ} />
                  <Stat label="ARSE" value={stats.nbARSE} />
                  <Stat label="DML en cours" value={stats.nbDMLenAttente} highlight={stats.nbDMLenAttente > 0 ? 'amber' : undefined} />
                  <Stat label="Cotes" value={dossier.cotesTomes || 0} />
                </div>

                {/* Description */}
                {dossier.description ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{dossier.description}</div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-400 italic">Aucune description.</div>
                )}
              </div>
            )
          )}

          {activeTab === 'mex' && (
            <MisEnExamenSection
              misEnExamen={dossier.misEnExamen}
              onChange={(misEnExamen: MisEnExamen[]) =>
                onUpdate(dossier.id, { misEnExamen })
              }
            />
          )}

          {activeTab === 'echeances' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  OP programmées par le juge d'instruction
                </h3>
                <OpsSection
                  ops={dossier.ops}
                  onChange={(ops: OPInstruction[]) => onUpdate(dossier.id, { ops })}
                />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-indigo-600" />
                  Débats JLD
                </h3>
                <DebatsJLDSection
                  debats={dossier.debatsJLD}
                  misEnExamen={dossier.misEnExamen}
                  onChange={(debatsJLD: DebatJLDPlanifie[]) =>
                    onUpdate(dossier.id, { debatsJLD })
                  }
                />
              </div>
            </div>
          )}

          {activeTab === 'timeline' && (
            <DossierTimelineSection dossier={dossier} />
          )}

          {activeTab === 'notes' && (
            <NotesPersoSection
              notes={dossier.notesPerso}
              onChange={(notesPerso: NotePersoInstruction[]) => onUpdate(dossier.id, { notesPerso })}
            />
          )}

          {activeTab === 'verifs' && (
            <VerificationsSection
              verifications={dossier.verifications}
              onChange={(verifications: VerificationPeriodique[]) => onUpdate(dossier.id, { verifications })}
            />
          )}

          {activeTab === 'orientation' && (
            isEditing ? (
              <div className="max-w-md">
                <Label>Orientation prévisible</Label>
                <select
                  value={editData.orientationPrevisible || ''}
                  onChange={(e) =>
                    setEditData(d => ({
                      ...d,
                      orientationPrevisible: (e.target.value || undefined) as OrientationPrevisible | undefined,
                    }))
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                >
                  <option value="">— Non définie —</option>
                  {(Object.keys(ORIENTATION_LABELS) as OrientationPrevisible[]).map(k => (
                    <option key={k} value={k}>{ORIENTATION_LABELS[k]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="text-sm">
                {dossier.orientationPrevisible ? (
                  <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded px-3 py-1.5">
                    <Briefcase className="h-4 w-4 text-indigo-600" />
                    <span className="font-medium text-indigo-700">
                      {ORIENTATION_LABELS[dossier.orientationPrevisible]}
                    </span>
                  </div>
                ) : (
                  <span className="text-gray-400 italic">Aucune orientation prévisible définie.</span>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

const Stat = ({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: 'red' | 'amber';
}) => {
  const colors =
    highlight === 'red'
      ? 'bg-red-50 border-red-200 text-red-700'
      : highlight === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-gray-50 border-gray-200 text-gray-700';
  return (
    <div className={`border rounded-lg px-2 py-1.5 ${colors}`}>
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wide font-medium">{label}</div>
    </div>
  );
};
