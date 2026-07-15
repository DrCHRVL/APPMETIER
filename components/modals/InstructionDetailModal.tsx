'use client';

import React, { useState } from 'react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import {
  X, Edit, Trash2, Save, FileText, Users, Calendar, ListChecks,
  Lock, Scale, MapPin, ShieldOff, AlertTriangle, Archive, RotateCcw,
  ShieldCheck, Plus, ExternalLink, Link2, Unlink, ClipboardPaste,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { CopyButton } from '../ui/CopyButton';
import { useToast } from '@/contexts/ToastContext';
import { useUser } from '@/contexts/UserContext';
import { FloatingDossierChat } from '../attache/FloatingDossierChat';
import { ProductionsSection } from '../attache/ProductionsSection';
import { DmlArchiveSection } from '../instruction/DmlArchiveSection';
import { DossierCompletSection } from '../instruction/DossierCompletSection';
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
  getDossierAgeJours,
  formatDossierAge,
  getJoursRestantsAvantFinDP,
  getJoursRestantsAvantMaxLegal,
  getDateFinDPCourante,
  getDateFinMaxLegale,
} from '@/utils/instructionUtils';
import { useInstructionAlertRules } from '@/hooks/useInstructionAlertRules';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { MisEnExamenSection } from '../instruction/mex/MisEnExamenSection';
import { SaisineManager } from '../instruction/SaisineManager';
import { OpsSection } from '../instruction/OpsSection';
import { DebatsJLDSection } from '../instruction/DebatsJLDSection';
import { NotesPersoSection } from '../instruction/NotesPersoSection';
import { DossierTimelineSection } from '../instruction/DossierTimelineSection';
import { RichTextEditor } from '../instruction/RichTextEditor';
import {
  LierEnquetePreliminaireModal,
  type EnquetePreliminaireOption,
} from '../instruction/LierEnquetePreliminaireModal';
import { CassiopeeImportModal, type CassiopeeImportResult } from './CassiopeeImportModal';
import { renderFormattedText } from '@/lib/formatCR';
import type {
  DossierInstruction,
  EtatReglement,
  OrientationPrevisible,
  MisEnExamen,
  OPInstruction,
  DebatJLDPlanifie,
  NotePersoInstruction,
  EvenementInstruction,
  MesureSurete,
  Victime,
} from '@/types/instructionTypes';

interface InstructionDetailModalProps {
  dossier: DossierInstruction;
  isEditing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onUpdate: (id: number, updates: Partial<DossierInstruction>) => void;
  onDelete: (id: number) => void;
  /** Liste des contentieux pour le sélecteur en mode édition. */
  contentieuxDefs?: import('@/types/userTypes').ContentieuxDefinition[];
  /** Tous les noms MEX + suspects connus (cross-dossiers) pour l'autocomplete */
  allKnownNames?: string[];
  /**
   * Enquêtes préliminaires éligibles au rattachement (résultat = OI). Permet
   * de lier ce dossier à sa préliminaire d'origine pour lever le doublon de
   * cartographie sans perdre les données de l'enquête.
   */
  enquetePreliminaireOptions?: EnquetePreliminaireOption[];
  /** Ouvre la fiche de l'enquête préliminaire liée (CR, actes, notes). */
  onOpenEnquetePreliminaire?: (enqueteId: number, contentieuxId?: string) => void;
}

type TabKey = 'apercu' | 'mex' | 'victimes' | 'echeances' | 'timeline';

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'apercu',    label: 'Aperçu',         icon: FileText },
  { key: 'mex',       label: 'Mis en examen',  icon: Users },
  { key: 'victimes',  label: 'Victimes',       icon: ShieldCheck },
  { key: 'echeances', label: 'OP & JLD',       icon: Calendar },
  { key: 'timeline',  label: 'Timeline',       icon: ListChecks },
];

const MESURE_BADGE: Record<MesureSurete['type'], { short: string; color: string; icon: React.ElementType }> = {
  libre:  { short: 'Libre', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: ShieldOff },
  cj:     { short: 'CJ',    color: 'bg-amber-100 text-amber-800 border-amber-300', icon: Scale },
  arse:   { short: 'ARSE',  color: 'bg-purple-100 text-purple-800 border-purple-300', icon: MapPin },
  detenu: { short: 'DP',    color: 'bg-red-100 text-red-800 border-red-300', icon: Lock },
};

export const InstructionDetailModal = ({
  dossier,
  isEditing,
  onClose,
  onEdit,
  onUpdate,
  onDelete,
  contentieuxDefs = [],
  allKnownNames = [],
  enquetePreliminaireOptions = [],
  onOpenEnquetePreliminaire,
}: InstructionDetailModalProps) => {
  const { showToast } = useToast();
  const { isAdmin } = useUser();
  const { getCabinetById } = useInstructionCabinets();
  const cabinet = getCabinetById(dossier.cabinetId);
  const cabinetColor = cabinet?.color || FALLBACK_CABINET_COLOR;

  const [activeTab, setActiveTab] = useState<TabKey>('apercu');
  // Picker de rattachement à l'enquête préliminaire d'origine.
  const [showLierPrelim, setShowLierPrelim] = useState(false);
  // Import « bricolage » Cassiopée par copier-coller.
  const [showCassiopeeImport, setShowCassiopeeImport] = useState(false);

  const handleCassiopeeImport = (r: CassiopeeImportResult) => {
    onUpdate(dossier.id, {
      misEnExamen: [...dossier.misEnExamen, ...r.misEnExamen],
      suspects: [...(dossier.suspects ?? []), ...r.suspects],
      victimes: [...(dossier.victimes ?? []), ...r.victimes],
      saisine: [...(dossier.saisine ?? []), ...r.saisine],
      evenements: [...(dossier.evenements ?? []), ...r.evenements],
    });
  };

  // Échap ferme la modale en consultation. En édition, on n'écoute pas pour ne
  // pas fermer par mégarde pendant une saisie ; l'utilisateur sort via les
  // boutons dédiés. Désactivé aussi quand le picker enfant est ouvert.
  useEscapeKey(onClose, !isEditing && !showLierPrelim);

  const handleLierPrelim = (option: EnquetePreliminaireOption) => {
    onUpdate(dossier.id, {
      enquetePreliminaireId: option.id,
      enquetePreliminaireContentieuxId: option.contentieuxId,
      enquetePreliminaireNumero: option.numero,
    });
    setShowLierPrelim(false);
    showToast(`Enquête préliminaire ${option.numero} rattachée`, 'success');
  };

  const handleDelierPrelim = () => {
    if (!confirm(
      'Détacher l\'enquête préliminaire de ce dossier ?\n\n'
      + 'L\'enquête et ses données ne sont pas supprimées. Elle réapparaîtra '
      + 'comme un nœud distinct sur la cartographie.',
    )) return;
    onUpdate(dossier.id, {
      enquetePreliminaireId: undefined,
      enquetePreliminaireContentieuxId: undefined,
      enquetePreliminaireNumero: undefined,
    });
    showToast('Enquête préliminaire détachée', 'success');
  };

  // État local pour l'édition
  const [editData, setEditData] = useState<Partial<DossierInstruction>>({
    numeroInstruction: dossier.numeroInstruction,
    numeroParquet: dossier.numeroParquet,
    lienNpp: dossier.lienNpp,
    cabinetId: dossier.cabinetId,
    magistratInstructeur: dossier.magistratInstructeur,
    contentieuxId: dossier.contentieuxId,
    description: dossier.description,
    dateOuverture: dossier.dateOuverture,
    dateRI: dossier.dateRI,
    etatReglement: dossier.etatReglement,
    orientationPrevisible: dossier.orientationPrevisible,
    cotesTomes: dossier.cotesTomes,
  });

  const openLienNpp = () => {
    if (!dossier.lienNpp) return;
    const api = (typeof window !== 'undefined' ? window.electronAPI : undefined) as
      | { openExternalUrl?: (url: string) => Promise<boolean> }
      | undefined;
    if (api?.openExternalUrl) {
      void api.openExternalUrl(dossier.lienNpp);
    } else {
      window.open(dossier.lienNpp, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSave = () => {
    if (!editData.numeroInstruction?.trim()) {
      showToast('N° instruction requis', 'error');
      return;
    }
    if (editData.lienNpp && !/^https?:\/\//i.test(editData.lienNpp)) {
      showToast('Le lien NPP doit commencer par http:// ou https://', 'error');
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

  const handleArchive = () => {
    if (!confirm(
      `Archiver "${dossier.numeroInstruction}" ?\n\n`
      + `Le dossier sortira des informations en cours et sera disponible dans `
      + `« Archives instruction » pour saisir le résultat d'audience.`,
    )) return;
    onUpdate(dossier.id, {
      archived: true,
      dateArchivage: new Date().toISOString(),
    });
    showToast('Dossier archivé', 'success');
    onClose();
  };

  const handleUnarchive = () => {
    if (!confirm(`Restaurer "${dossier.numeroInstruction}" dans les informations en cours ?`)) return;
    onUpdate(dossier.id, { archived: false, dateArchivage: undefined });
    showToast('Dossier restauré', 'success');
    onClose();
  };

  const { rules: alertRules } = useInstructionAlertRules();
  const seuilFinDPJours = alertRules.find(r => r.trigger === 'dp_fin_proche')?.seuil ?? 21;
  const seuilMaxDPJours = alertRules.find(r => r.trigger === 'dp_max_proche')?.seuil ?? 90;

  const stats = (() => {
    const byStatut = countMexByStatut(dossier);
    return {
      nbMex: dossier.misEnExamen.length,
      nbDetenu: byStatut.detenu,
      nbCJ: byStatut.cj,
      nbARSE: byStatut.arse,
      nbDML: countTotalDMLs(dossier),
      ageJours: getDossierAgeJours(dossier),
    };
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[97vw] max-w-[1500px] h-[92vh] flex flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-gray-200"
          style={{ backgroundColor: cabinetColor + '12' }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900 truncate inline-flex items-center gap-1.5">
                {dossier.numeroInstruction}
                {dossier.numeroInstruction && (
                  <CopyButton value={dossier.numeroInstruction} title="Copier le n° d'instruction" />
                )}
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
              N° instruction : {dossier.numeroInstruction || '—'}
              {' · '}
              Parquet : {dossier.lienNpp ? (
                <button
                  type="button"
                  onClick={openLienNpp}
                  title={`Ouvrir la fiche NPP : ${dossier.lienNpp}`}
                  className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 hover:underline"
                >
                  {dossier.numeroParquet}
                  <ExternalLink className="h-3 w-3" />
                </button>
              ) : (
                dossier.numeroParquet
              )}
              {dossier.numeroParquet && (
                <CopyButton value={dossier.numeroParquet} title="Copier le n° de parquet" className="ml-1 align-middle" />
              )}
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
                {dossier.archived ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleUnarchive}
                    title="Restaurer dans les informations en cours"
                    className="text-emerald-700 hover:text-emerald-800"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleArchive}
                    title="Archiver le dossier"
                    className="text-amber-700 hover:text-amber-800"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleDelete} title="Supprimer" className="text-red-600 hover:text-red-700">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {isEditing && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCassiopeeImport(true)}
                  title="Importer des données depuis Cassiopée (copier-coller)"
                  className="gap-1.5"
                >
                  <ClipboardPaste className="h-4 w-4" />
                  Importer Cassiopée
                </Button>
                <Button size="sm" onClick={handleSave} className="bg-[#2B5746] hover:bg-[#1f3d2f]">
                  <Save className="h-4 w-4 mr-1" />
                  Enregistrer
                </Button>
              </>
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
            <>
            {/* Rattachement enquête préliminaire d'origine (résultat OI) :
                lève le doublon de cartographie, sans toucher aux données de
                l'enquête. Géré indépendamment du mode édition. */}
            {dossier.enquetePreliminaireId != null ? (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="h-4 w-4 text-emerald-700 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase font-semibold text-emerald-700">
                        Enquête préliminaire d'origine
                      </div>
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {dossier.enquetePreliminaireNumero || `Enquête #${dossier.enquetePreliminaireId}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {onOpenEnquetePreliminaire && (
                      <button
                        onClick={() => onOpenEnquetePreliminaire(
                          dossier.enquetePreliminaireId!,
                          dossier.enquetePreliminaireContentieuxId,
                        )}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 bg-white border border-emerald-300 rounded px-2 py-1 hover:bg-emerald-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Ouvrir l'enquête
                      </button>
                    )}
                    <button
                      onClick={() => setShowLierPrelim(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded px-2 py-1 hover:bg-gray-100"
                    >
                      <Link2 className="h-3.5 w-3.5" /> Changer
                    </button>
                    <button
                      onClick={handleDelierPrelim}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-white border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                    >
                      <Unlink className="h-3.5 w-3.5" /> Détacher
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-emerald-700/80 mt-1.5">
                  Masquée comme doublon sur la cartographie — ses notes, CR et actes restent accessibles dans le module enquêtes.
                </p>
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <span>Aucune enquête préliminaire rattachée.</span>
                </div>
                <button
                  onClick={() => setShowLierPrelim(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#2B5746] bg-white border border-[#2B5746]/40 rounded px-2 py-1 hover:bg-[#2B5746]/5"
                >
                  <Link2 className="h-3.5 w-3.5" /> Lier une enquête (OI)
                </button>
              </div>
            )}

            {isEditing ? (
              <div className="space-y-4">
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
                  <div className="col-span-2">
                    <Label>Lien NPP (optionnel)</Label>
                    <Input
                      type="url"
                      placeholder="https://tgi-…npp.intranet.justice.gouv.fr/…"
                      value={editData.lienNpp || ''}
                      onChange={(e) => setEditData(d => ({ ...d, lienNpp: e.target.value.trim() || undefined }))}
                    />
                    <p className="text-[11px] text-gray-500 mt-1">
                      Si renseigné, le n° de parquet devient cliquable et ouvre la fiche NPP dans le navigateur par défaut.
                    </p>
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
                  <div>
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
                  {contentieuxDefs.length > 0 && (
                    <div>
                      <Label>Contentieux</Label>
                      <select
                        value={editData.contentieuxId || ''}
                        onChange={(e) => setEditData(d => ({ ...d, contentieuxId: e.target.value || undefined }))}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                      >
                        <option value="">— non précisé —</option>
                        {contentieuxDefs.map(c => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1">
                        Couleur et filtrage cartographie.
                      </p>
                    </div>
                  )}
                </div>

                {/* Description sur une largeur restreinte pour rester lisible */}
                <div className="max-w-2xl">
                  <Label>Description</Label>
                  <RichTextEditor
                    value={editData.description || ''}
                    onChange={(val) => setEditData(d => ({ ...d, description: val }))}
                    minHeight={120}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    La saisine in rem dispose désormais d'une section dédiée (onglet Aperçu,
                    avec rattachement NATINF). Réservez la description au narratif.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Stats rapides */}
                <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
                  <Stat label="MEX" value={stats.nbMex} />
                  <Stat label="En DP" value={stats.nbDetenu} highlight={stats.nbDetenu > 0 ? 'red' : undefined} />
                  <Stat label="CJ" value={stats.nbCJ} />
                  <Stat label="ARSE" value={stats.nbARSE} />
                  <Stat label="DML total" value={stats.nbDML} />
                  <Stat label="Cotes" value={dossier.cotesTomes || 0} />
                  <Stat
                    label="Victimes"
                    value={(dossier.victimes || []).length}
                    onClick={() => setActiveTab('victimes')}
                  />
                </div>

                {/* Mini-section victimes : noms uniquement (détails dans l'onglet Victimes) */}
                {(dossier.victimes || []).length > 0 && (
                  <div className="flex items-start gap-1.5 flex-wrap text-xs">
                    <span className="text-gray-500 uppercase font-semibold flex items-center gap-1 shrink-0">
                      <ShieldCheck className="h-3 w-3 text-emerald-600" /> Victimes
                    </span>
                    {(dossier.victimes || []).map(v => (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200"
                        title={v.surCarto ? 'Affichée sur la cartographie' : undefined}
                      >
                        {v.nom}
                        {v.surCarto && <MapPin className="h-2.5 w-2.5 text-emerald-600" />}
                      </span>
                    ))}
                    <button
                      onClick={() => setActiveTab('victimes')}
                      className="text-emerald-700 hover:underline"
                    >
                      gérer →
                    </button>
                  </div>
                )}

                {/* Contentieux */}
                {(() => {
                  const ctx = dossier.contentieuxId
                    ? contentieuxDefs.find(c => c.id === dossier.contentieuxId)
                    : null;
                  if (ctx) {
                    return (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-500 uppercase font-semibold">Contentieux</span>
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium"
                          style={{ background: `${ctx.color}20`, color: ctx.color, border: `1px solid ${ctx.color}` }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: ctx.color }} />
                          {ctx.label}
                        </span>
                      </div>
                    );
                  }
                  if (contentieuxDefs.length > 0) {
                    return (
                      <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                        Contentieux non précisé. Renseignez-le en mode édition pour
                        que ce dossier apparaisse dans le bon filtre cartographique.
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Saisine in rem : qualifications structurées des faits dont le
                    juge est saisi (réquisitoire introductif + supplétifs). */}
                <div className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Scale className="h-3.5 w-3.5 text-gray-500" />
                    <span className="text-xs font-semibold text-gray-500 uppercase">Saisine in rem</span>
                  </div>
                  <SaisineManager
                    value={dossier.saisine || []}
                    onChange={(saisine) => onUpdate(dossier.id, { saisine })}
                  />
                </div>

                {/* 3 colonnes : Description / Notes perso / Mis en examen */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 min-w-0">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Description</div>
                    {dossier.description ? (
                      <div
                        className="text-sm text-gray-700 break-words prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderFormattedText(dossier.description) }}
                      />
                    ) : (
                      <div className="text-sm text-gray-400 italic">Aucune description.</div>
                    )}
                  </div>

                  <div className="bg-white border border-gray-200 rounded-lg p-3 min-w-0">
                    <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Notes perso</div>
                    <NotesPersoSection
                      notes={dossier.notesPerso}
                      onChange={(notesPerso: NotePersoInstruction[]) => onUpdate(dossier.id, { notesPerso })}
                    />
                  </div>

                  <div className="min-w-0">
                    <MexCondenseList
                      misEnExamen={dossier.misEnExamen}
                      onJumpToMex={() => setActiveTab('mex')}
                      seuilFinDPJours={seuilFinDPJours}
                      seuilMaxDPJours={seuilMaxDPJours}
                    />
                  </div>
                </div>
              </div>
            )}
            </>
          )}

          {activeTab === 'mex' && (
            <MisEnExamenSection
              misEnExamen={dossier.misEnExamen}
              suspects={dossier.suspects ?? []}
              saisine={dossier.saisine ?? []}
              onChange={(misEnExamen: MisEnExamen[]) =>
                onUpdate(dossier.id, { misEnExamen })
              }
              onSuspectsChange={(suspects) => onUpdate(dossier.id, { suspects })}
              allKnownNames={allKnownNames}
            />
          )}

          {activeTab === 'victimes' && (
            <VictimesSection
              victimes={dossier.victimes || []}
              onChange={(victimes: Victime[]) => onUpdate(dossier.id, { victimes })}
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

                {/* Archive DML du dossier : PDF signés conservés intacts (tous utilisateurs). */}
                {(dossier.numeroInstruction || dossier.numeroParquet) && (
                  <DmlArchiveSection numero={dossier.numeroInstruction || dossier.numeroParquet || ''} />
                )}

                {/* Dossier complet : arborescence versée, convertie en texte (tous utilisateurs). */}
                {(dossier.numeroInstruction || dossier.numeroParquet) && (
                  <DossierCompletSection numero={dossier.numeroInstruction || dossier.numeroParquet || ''} />
                )}

                {/* Atelier des actes rédigés (attaché IA) — admin only. */}
                {isAdmin() && (dossier.numeroInstruction || dossier.numeroParquet) && (
                  <ProductionsSection numero={dossier.numeroInstruction || dossier.numeroParquet || ''} />
                )}
              </div>
            </div>
          )}

          {activeTab === 'timeline' && (
            <DossierTimelineSection
              dossier={dossier}
              onChangeEvenements={(evenements: EvenementInstruction[]) =>
                onUpdate(dossier.id, { evenements })
              }
              onChangeNotesActesJI={(notesActesJI: string) =>
                onUpdate(dossier.id, { notesActesJI })
              }
              onChangeActeSyntheses={(acteSyntheses: Record<string, string>) =>
                onUpdate(dossier.id, { acteSyntheses })
              }
            />
          )}
        </div>
      </div>

      <LierEnquetePreliminaireModal
        isOpen={showLierPrelim}
        onClose={() => setShowLierPrelim(false)}
        options={enquetePreliminaireOptions}
        currentLinkId={dossier.enquetePreliminaireId}
        currentLinkContentieuxId={dossier.enquetePreliminaireContentieuxId}
        onSelect={handleLierPrelim}
      />

      <CassiopeeImportModal
        isOpen={showCassiopeeImport}
        onClose={() => setShowCassiopeeImport(false)}
        onImport={handleCassiopeeImport}
        existingMisEnExamen={dossier.misEnExamen}
        existingSuspects={dossier.suspects ?? []}
        existingVictimes={dossier.victimes ?? []}
        existingSaisine={dossier.saisine ?? []}
      />

      {/* Chat flottant de l'attaché sur ce dossier d'instruction — admin only. */}
      {isAdmin() && (dossier.numeroInstruction || dossier.numeroParquet) && (
        <FloatingDossierChat
          numero={dossier.numeroInstruction || dossier.numeroParquet || ''}
          cadre="instruction"
          label={dossier.numeroInstruction || dossier.numeroParquet}
        />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Tuile statistique compacte
// ─────────────────────────────────────────────────────────────────

const Stat = ({
  label,
  value,
  highlight,
  onClick,
}: {
  label: string;
  value: number;
  highlight?: 'red' | 'amber';
  onClick?: () => void;
}) => {
  const colors =
    highlight === 'red'
      ? 'bg-red-50 border-red-200 text-red-700'
      : highlight === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-gray-50 border-gray-200 text-gray-700';
  const interactive = onClick
    ? 'hover:bg-emerald-50 hover:border-emerald-300 cursor-pointer transition-colors'
    : '';
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
      className={`border rounded-lg px-2 py-1.5 ${colors} ${interactive}`}
    >
      <div className="text-lg font-bold leading-none">{value}</div>
      <div className="text-[10px] uppercase tracking-wide font-medium">{label}</div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Onglet Victimes : liste des victimes / parties civiles avec option
// d'affichage sur la cartographie.
// ─────────────────────────────────────────────────────────────────

const VictimesSection: React.FC<{
  victimes: Victime[];
  onChange: (next: Victime[]) => void;
}> = ({ victimes, onChange }) => {
  const [draft, setDraft] = useState('');

  const handleAdd = () => {
    const nom = draft.trim();
    if (!nom) return;
    onChange([
      ...victimes,
      { id: Date.now() + Math.floor(Math.random() * 1000), nom },
    ]);
    setDraft('');
  };

  const handleRemove = (id: number) =>
    onChange(victimes.filter(v => v.id !== id));

  const handlePatch = (id: number, patch: Partial<Victime>) =>
    onChange(victimes.map(v => (v.id === id ? { ...v, ...patch } : v)));

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Victimes / parties civiles ({victimes.length})
        </h3>
      </div>

      {/* Ajout */}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Nom et prénom (ex : MARTIN Sophie)"
          className="h-8 text-sm flex-1"
        />
        <Button
          size="sm"
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="h-3 w-3 mr-1" />
          Ajouter
        </Button>
      </div>

      {/* Liste */}
      <div className="space-y-1.5">
        {victimes.length === 0 && (
          <div className="text-sm text-gray-400 italic py-4 text-center border border-dashed border-gray-200 rounded-lg">
            Aucune victime enregistrée pour ce dossier.
          </div>
        )}
        {victimes.map(v => (
          <div
            key={v.id}
            className="flex items-center gap-3 border border-gray-200 rounded-lg px-2.5 py-2 bg-white"
          >
            <Input
              value={v.nom}
              onChange={(e) => handlePatch(v.id, { nom: e.target.value })}
              className="h-8 text-sm flex-1"
            />
            <label
              className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none shrink-0"
              title="Afficher cette victime sur le module cartographie (rattachée au dossier)"
            >
              <input
                type="checkbox"
                checked={!!v.surCarto}
                onChange={(e) => handlePatch(v.id, { surCarto: e.target.checked })}
                className="h-3.5 w-3.5 accent-emerald-600"
              />
              <MapPin className="h-3.5 w-3.5 text-emerald-600" />
              Sur la cartographie
            </label>
            <button
              onClick={() => handleRemove(v.id)}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0"
              title="Retirer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-gray-500">
        Cochez « Sur la cartographie » pour faire apparaître la victime dans le module
        cartographie, rattachée à ce dossier (affichée comme un mis en cause, avec la
        mention « (Victime) »). Le dossier doit être rattaché à un contentieux pour être
        projeté sur la carte.
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Liste condensée des mis en examen (Aperçu)
// ─────────────────────────────────────────────────────────────────

const MexCondenseList: React.FC<{
  misEnExamen: MisEnExamen[];
  onJumpToMex: () => void;
  seuilFinDPJours: number;
  seuilMaxDPJours: number;
}> = ({ misEnExamen, onJumpToMex, seuilFinDPJours, seuilMaxDPJours }) => {
  if (misEnExamen.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-400 italic">
        Aucun mis en examen pour ce dossier.
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Mis en examen ({misEnExamen.length})
        </h3>
        <button
          onClick={onJumpToMex}
          className="text-xs text-emerald-700 hover:underline"
        >
          Voir les détails →
        </button>
      </div>
      <ul className="grid grid-cols-1 gap-1.5">
        {misEnExamen.map(mex => {
          const meta = MESURE_BADGE[mex.mesureSurete.type];
          const Icon = meta.icon;
          const finDP = getDateFinDPCourante(mex);
          const joursRestants = getJoursRestantsAvantFinDP(mex);
          const finMax = getDateFinMaxLegale(mex);
          const joursMax = getJoursRestantsAvantMaxLegal(mex);
          const dmlEnAttente = mex.mesureSurete.type === 'detenu'
            ? mex.dmls.filter(d => d.statut === 'en_attente').length
            : 0;
          const finDPClass =
            joursRestants !== null && joursRestants < 0
              ? 'bg-red-200 text-red-900 border-red-300'
              : joursRestants !== null && joursRestants <= seuilFinDPJours
              ? 'bg-red-100 text-red-700 border-red-300 font-semibold'
              : 'bg-gray-50 text-gray-600 border-gray-200';
          const finMaxClass =
            joursMax !== null && joursMax < 0
              ? 'bg-red-200 text-red-900 border-red-300'
              : joursMax !== null && joursMax <= seuilMaxDPJours
              ? 'bg-red-100 text-red-700 border-red-300 font-semibold'
              : 'bg-gray-50 text-gray-600 border-gray-200';
          return (
            <li
              key={mex.id}
              className="border border-gray-200 rounded p-2 text-xs flex items-start gap-2 hover:bg-gray-50 cursor-pointer"
              onClick={onJumpToMex}
              title="Cliquez pour ouvrir l'onglet Mis en examen"
            >
              <Icon className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-semibold text-gray-800 truncate">{mex.nom}</span>
                  <span className={`inline-flex items-center gap-0.5 text-[10px] uppercase px-1.5 py-0.5 rounded border ${meta.color}`}>
                    {meta.short}
                  </span>
                  {dmlEnAttente > 0 && (
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200">
                      {dmlEnAttente} DML
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  MEX le {mex.dateMiseEnExamen ? new Date(mex.dateMiseEnExamen).toLocaleDateString() : '—'}
                  {mex.infractions.length > 0 && (
                    <> · {mex.infractions.length} chef{mex.infractions.length > 1 ? 's' : ''}</>
                  )}
                </div>
                {finDP && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5 ${finDPClass}`}
                      title={`Fin de la période DP courante${joursRestants !== null ? ` — J${joursRestants >= 0 ? '+' : ''}${joursRestants}` : ''}`}
                    >
                      {joursRestants !== null && joursRestants < 0 && <AlertTriangle className="h-2.5 w-2.5" />}
                      Fin&nbsp;: {new Date(finDP).toLocaleDateString()}
                    </span>
                    {finMax && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5 ${finMaxClass}`}
                        title={`Date à laquelle la durée légale max sera atteinte${joursMax !== null ? ` — J${joursMax >= 0 ? '+' : ''}${joursMax}` : ''}`}
                      >
                        {joursMax !== null && joursMax < 0 && <AlertTriangle className="h-2.5 w-2.5" />}
                        Fin maximal&nbsp;: {new Date(finMax).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )}
                {mex.infractions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {mex.infractions.slice(0, 3).map(inf => (
                      <span
                        key={inf.id}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 truncate max-w-[200px]"
                      >
                        {inf.qualification}
                      </span>
                    ))}
                    {mex.infractions.length > 3 && (
                      <span className="text-[10px] text-gray-400">+{mex.infractions.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
