'use client';

import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Lock,
  Gavel,
  FileText,
  NotebookPen,
  AlertTriangle,
  Plus,
  X,
  Trash2,
  Edit,
  Save,
  Check,
  ClipboardList,
  Brain,
  Microscope,
  Footprints,
  Stethoscope,
  Skull,
  FlaskConical,
  Mic,
  Users,
  Crosshair,
  ArrowRight,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RichTextEditor } from './RichTextEditor';
import { renderFormattedText } from '@/lib/formatCR';
import type {
  DossierInstruction,
  EvenementInstruction,
  EvenementInstructionType,
  CategorieExpertise,
} from '@/types/instructionTypes';

interface Props {
  dossier: DossierInstruction;
  /** Persistance des événements libres saisis dans la timeline. */
  onChangeEvenements?: (next: EvenementInstruction[]) => void;
  /** Persistance du bloc-notes libre « Actes à faire / à demander à la JI ». */
  onChangeNotesActesJI?: (html: string) => void;
  readOnly?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Évts dérivés (DP, DML, JLD, OP, ouverture, notes…) en lecture seule
// ─────────────────────────────────────────────────────────────────

type DerivedKind =
  | 'ouverture'
  | 'placement_dp'
  | 'fin_periode_dp'
  | 'debat_jld'
  | 'op_ji'
  | 'dml_depot'
  | 'dml_echeance'
  | 'note';

interface DerivedEvt {
  key: string;
  date: Date;
  kind: DerivedKind;
  title: string;
  detail?: string;
  color: string;
}

const DERIVED_META: Record<DerivedKind, { label: string; bg: string; icon: React.ElementType }> = {
  ouverture:       { label: 'Ouverture',     bg: 'bg-emerald-500', icon: FileText },
  placement_dp:    { label: 'Placement DP',  bg: 'bg-red-500',     icon: Lock },
  fin_periode_dp:  { label: 'Fin période DP',bg: 'bg-red-700',     icon: AlertTriangle },
  debat_jld:       { label: 'Débat JLD',     bg: 'bg-indigo-500',  icon: Gavel },
  op_ji:           { label: 'OP JI',         bg: 'bg-blue-500',    icon: Calendar },
  dml_depot:       { label: 'DML déposée',   bg: 'bg-purple-400',  icon: FileText },
  dml_echeance:    { label: 'Échéance DML',  bg: 'bg-purple-600',  icon: AlertTriangle },
  note:            { label: 'Note',          bg: 'bg-gray-400',    icon: NotebookPen },
};

// ─────────────────────────────────────────────────────────────────
// Évts saisis manuellement (CR, expertises, IPC/APC, interrogatoires, interpellations)
// ─────────────────────────────────────────────────────────────────

const EVT_META: Record<EvenementInstructionType, { label: string; bg: string; text: string; icon: React.ElementType }> = {
  lancement_cr:        { label: 'Lancement CR',        bg: 'bg-cyan-500',    text: 'text-cyan-700',    icon: ArrowRight },
  retour_cr:           { label: 'Retour CR',           bg: 'bg-teal-500',    text: 'text-teal-700',    icon: Check },
  expertise:           { label: 'Expertise',           bg: 'bg-fuchsia-500', text: 'text-fuchsia-700', icon: Microscope },
  ipc:                 { label: 'IPC',                 bg: 'bg-orange-500',  text: 'text-orange-700',  icon: Mic },
  apc:                 { label: 'APC (partie civile)', bg: 'bg-pink-500',    text: 'text-pink-700',    icon: Users },
  interrogatoire_fond: { label: 'Interrogatoire au fond', bg: 'bg-amber-600', text: 'text-amber-700',  icon: Mic },
  phase_interpellation:{ label: 'Phase d\'interpellation', bg: 'bg-red-600',  text: 'text-red-700',    icon: Crosshair },
};

const EXPERTISE_LABELS: Record<CategorieExpertise, string> = {
  psychologique: 'Psychologique',
  psychiatrique: 'Psychiatrique',
  balistique: 'Balistique',
  adn: 'ADN',
  papillaire: 'Papillaire',
  medico_legale: 'Médico-légale',
  autopsie: 'Autopsie',
  autre: 'Autre',
};

const EXPERTISE_ICON: Record<CategorieExpertise, React.ElementType> = {
  psychologique: Brain,
  psychiatrique: Brain,
  balistique: Crosshair,
  adn: FlaskConical,
  papillaire: Footprints,
  medico_legale: Stethoscope,
  autopsie: Skull,
  autre: Microscope,
};

/** Le type d'expertise concerne une victime plutôt qu'un MEX (psy/psy/APC). */
const EXPERTISE_PEUT_VISER_VICTIME = (cat?: CategorieExpertise): boolean =>
  cat === 'psychologique' || cat === 'psychiatrique' || cat === 'medico_legale';

// ─────────────────────────────────────────────────────────────────
// Composant principal
// ─────────────────────────────────────────────────────────────────

export const DossierTimelineSection: React.FC<Props> = ({
  dossier,
  onChangeEvenements,
  onChangeNotesActesJI,
  readOnly,
}) => {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const evenements = dossier.evenements || [];

  const derivedEvents = useMemo<DerivedEvt[]>(() => {
    const list: DerivedEvt[] = [];

    if (dossier.dateOuverture) {
      list.push({
        key: `ouv-${dossier.id}`,
        date: new Date(dossier.dateOuverture),
        kind: 'ouverture',
        title: "Ouverture de l'information judiciaire",
        detail: `RI du ${new Date(dossier.dateRI || dossier.dateOuverture).toLocaleDateString()}`,
        color: DERIVED_META.ouverture.bg,
      });
    }

    for (const mex of dossier.misEnExamen) {
      if (mex.mesureSurete.type === 'detenu') {
        for (const periode of mex.mesureSurete.periodes) {
          list.push({
            key: `dp-debut-${mex.id}-${periode.id}`,
            date: new Date(periode.dateDebut),
            kind: 'placement_dp',
            title: `${periode.type === 'placement' ? 'Placement DP' : 'Prolongation DP'} — ${mex.nom}`,
            detail: `${periode.dureeMois} mois`,
            color: DERIVED_META.placement_dp.bg,
          });
          list.push({
            key: `dp-fin-${mex.id}-${periode.id}`,
            date: new Date(periode.dateFin),
            kind: 'fin_periode_dp',
            title: `Fin période DP — ${mex.nom}`,
            detail: `Période débutée le ${new Date(periode.dateDebut).toLocaleDateString()}`,
            color: DERIVED_META.fin_periode_dp.bg,
          });
        }
      }
      for (const dml of mex.dmls) {
        list.push({
          key: `dml-d-${mex.id}-${dml.id}`,
          date: new Date(dml.dateDepot),
          kind: 'dml_depot',
          title: `DML déposée — ${mex.nom}`,
          detail: `Statut : ${dml.statut.replace('_', ' ')}`,
          color: DERIVED_META.dml_depot.bg,
        });
        if (dml.statut === 'en_attente') {
          list.push({
            key: `dml-e-${mex.id}-${dml.id}`,
            date: new Date(dml.dateEcheance),
            kind: 'dml_echeance',
            title: `Échéance DML — ${mex.nom}`,
            detail: 'Réquisitions à rendre',
            color: DERIVED_META.dml_echeance.bg,
          });
        }
      }
    }

    for (const op of dossier.ops) {
      list.push({
        key: `op-${op.id}`,
        date: new Date(op.date),
        kind: 'op_ji',
        title: 'OP du JI',
        detail: op.description || op.service,
        color: DERIVED_META.op_ji.bg,
      });
    }

    for (const debat of dossier.debatsJLD) {
      list.push({
        key: `jld-${debat.id}`,
        date: new Date(debat.date),
        kind: 'debat_jld',
        title: `Débat JLD${debat.heureExacte ? ' à ' + new Date(debat.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}`,
        detail: debat.type.replace('_', ' '),
        color: DERIVED_META.debat_jld.bg,
      });
    }

    for (const n of dossier.notesPerso) {
      list.push({
        key: `note-${n.id}`,
        date: new Date(n.date),
        kind: 'note',
        title: 'Note perso',
        detail: n.contenu.length > 80 ? n.contenu.substring(0, 80) + '…' : n.contenu,
        color: DERIVED_META.note.bg,
      });
    }

    return list;
  }, [dossier]);

  /** Tous les événements (dérivés + libres) triés. */
  const sortedAll = useMemo(() => {
    const merged: { key: string; date: Date; isCustom: boolean; kind?: DerivedKind; evt?: EvenementInstruction; derived?: DerivedEvt }[] = [];
    for (const e of derivedEvents) merged.push({ key: e.key, date: e.date, isCustom: false, derived: e });
    for (const e of evenements) merged.push({ key: `evt-${e.id}`, date: new Date(e.date), isCustom: true, evt: e });
    merged.sort((a, b) => b.date.getTime() - a.date.getTime());
    return merged;
  }, [derivedEvents, evenements]);

  const futurs = sortedAll.filter(x => {
    const d = new Date(x.date);
    d.setHours(0, 0, 0, 0);
    return d >= today;
  }).reverse();
  const passes = sortedAll.filter(x => {
    const d = new Date(x.date);
    d.setHours(0, 0, 0, 0);
    return d < today;
  });

  const handleAddEvenement = (e: EvenementInstruction) => {
    onChangeEvenements?.([...evenements, e]);
  };
  const handleUpdateEvenement = (id: number, updates: Partial<EvenementInstruction>) => {
    onChangeEvenements?.(evenements.map(e => (e.id === id ? { ...e, ...updates } : e)));
  };
  const handleRemoveEvenement = (id: number) => {
    if (!confirm('Supprimer cet événement ?')) return;
    onChangeEvenements?.(evenements.filter(e => e.id !== id));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Colonne gauche/centre : timeline (2/3) */}
      <div className="lg:col-span-2 space-y-4">
        {!readOnly && onChangeEvenements && (
          <EvenementForm
            misEnExamen={dossier.misEnExamen}
            victimes={dossier.victimes || []}
            ops={dossier.ops}
            evenementsExistants={evenements}
            onAdd={handleAddEvenement}
          />
        )}

        {sortedAll.length === 0 && (
          <div className="text-center py-6 text-sm text-gray-400 italic bg-gray-50 border border-dashed border-gray-200 rounded">
            Aucun événement enregistré pour ce dossier.
          </div>
        )}

        {/* À VENIR */}
        {futurs.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              À venir ({futurs.length})
            </h3>
            <ol className="relative border-l-2 border-gray-200 ml-2 space-y-2">
              {futurs.map(item => (
                <TimelineItem
                  key={item.key}
                  item={item}
                  today={today}
                  isPast={false}
                  misEnExamen={dossier.misEnExamen}
                  victimes={dossier.victimes || []}
                  ops={dossier.ops}
                  evenementsExistants={evenements}
                  onUpdate={handleUpdateEvenement}
                  onRemove={handleRemoveEvenement}
                  readOnly={readOnly}
                />
              ))}
            </ol>
          </div>
        )}

        {/* PASSÉ */}
        {passes.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              Historique ({passes.length})
            </h3>
            <ol className="relative border-l-2 border-gray-200 ml-2 space-y-2">
              {passes.map(item => (
                <TimelineItem
                  key={item.key}
                  item={item}
                  today={today}
                  isPast
                  misEnExamen={dossier.misEnExamen}
                  victimes={dossier.victimes || []}
                  ops={dossier.ops}
                  evenementsExistants={evenements}
                  onUpdate={handleUpdateEvenement}
                  onRemove={handleRemoveEvenement}
                  readOnly={readOnly}
                />
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Colonne droite : Actes à faire / à demander à la JI (1/3) — bloc-notes libre */}
      <div className="lg:col-span-1">
        <NotesActesJI
          value={dossier.notesActesJI || ''}
          onChange={onChangeNotesActesJI}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Item de timeline (dérivé OU libre)
// ─────────────────────────────────────────────────────────────────

interface TimelineItemProps {
  item: { key: string; date: Date; isCustom: boolean; evt?: EvenementInstruction; derived?: any };
  today: Date;
  isPast: boolean;
  misEnExamen: DossierInstruction['misEnExamen'];
  victimes: NonNullable<DossierInstruction['victimes']>;
  ops: DossierInstruction['ops'];
  evenementsExistants: EvenementInstruction[];
  onUpdate: (id: number, updates: Partial<EvenementInstruction>) => void;
  onRemove: (id: number) => void;
  readOnly?: boolean;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  today,
  isPast,
  misEnExamen,
  victimes,
  ops,
  evenementsExistants,
  onUpdate,
  onRemove,
  readOnly,
}) => {
  const [editing, setEditing] = useState(false);

  if (!item.isCustom && item.derived) {
    const e = item.derived;
    const Icon = DERIVED_META[e.kind as DerivedKind].icon;
    const days = isPast
      ? Math.floor((today.getTime() - e.date.getTime()) / 86400000)
      : Math.ceil((e.date.getTime() - today.getTime()) / 86400000);
    return (
      <li className="ml-4 pl-2">
        <div className={`absolute -left-[7px] w-3 h-3 rounded-full ${e.color} ${isPast ? 'opacity-70' : ''}`} />
        <div className="text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className={`h-3 w-3 ${isPast ? 'text-gray-400' : 'text-gray-500'}`} />
            <span className={`${isPast ? 'font-medium text-gray-700' : 'font-semibold text-gray-800'}`}>{e.title}</span>
            <span className={isPast ? 'text-gray-400' : 'text-gray-500'}>
              {e.date.toLocaleDateString('fr-FR')}
              {' · '}
              {isPast ? `il y a ${days} j` : days === 0 ? 'auj.' : days === 1 ? 'demain' : `J+${days}`}
            </span>
          </div>
          {e.detail && <div className={isPast ? 'text-gray-500 mt-0.5' : 'text-gray-600 mt-0.5'}>{e.detail}</div>}
        </div>
      </li>
    );
  }

  // Événement custom
  const evt = item.evt!;
  const meta = EVT_META[evt.type];
  const Icon = evt.type === 'expertise' && evt.categorieExpertise
    ? EXPERTISE_ICON[evt.categorieExpertise]
    : meta.icon;
  const days = isPast
    ? Math.floor((today.getTime() - item.date.getTime()) / 86400000)
    : Math.ceil((item.date.getTime() - today.getTime()) / 86400000);

  const mexNom = evt.misEnExamenId
    ? misEnExamen.find(m => m.id === evt.misEnExamenId)?.nom
    : undefined;
  const victimeNom = evt.victimeId
    ? victimes.find(v => v.id === evt.victimeId)?.nom
    : undefined;
  const opLabel = evt.opId
    ? (() => {
        const op = ops.find(o => o.id === evt.opId);
        return op ? `OP du ${new Date(op.date).toLocaleDateString()}${op.description ? ' — ' + op.description : ''}` : undefined;
      })()
    : undefined;
  const lancementLabel = evt.type === 'retour_cr' && evt.lancementCrId
    ? (() => {
        const lc = evenementsExistants.find(x => x.id === evt.lancementCrId);
        return lc ? `Retour du CR lancé le ${new Date(lc.date).toLocaleDateString()}${lc.titre ? ' — ' + lc.titre : ''}` : undefined;
      })()
    : undefined;

  const titreAffiche = evt.titre || (
    evt.type === 'expertise' && evt.categorieExpertise
      ? `Expertise ${EXPERTISE_LABELS[evt.categorieExpertise]}${evt.categorieExpertise === 'autre' && evt.expertiseLibelle ? ' — ' + evt.expertiseLibelle : ''}`
      : meta.label
  );

  return (
    <li className="ml-4 pl-2">
      <div className={`absolute -left-[7px] w-3 h-3 rounded-full ${meta.bg} ${isPast ? 'opacity-70' : ''}`} />
      {editing && !readOnly ? (
        <EvenementEditor
          evenement={evt}
          misEnExamen={misEnExamen}
          victimes={victimes}
          ops={ops}
          evenementsExistants={evenementsExistants}
          onSave={(updates) => {
            onUpdate(evt.id, updates);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className={`h-3 w-3 ${isPast ? 'text-gray-400' : meta.text}`} />
            <span className={`${isPast ? 'font-medium text-gray-700' : 'font-semibold text-gray-800'}`}>
              {titreAffiche}
            </span>
            <span className={isPast ? 'text-gray-400' : 'text-gray-500'}>
              {item.date.toLocaleDateString('fr-FR')}
              {' · '}
              {isPast ? `il y a ${days} j` : days === 0 ? 'auj.' : days === 1 ? 'demain' : `J+${days}`}
            </span>
            {!readOnly && (
              <span className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setEditing(true)}
                  title="Modifier"
                  className="text-gray-400 hover:text-emerald-600"
                >
                  <Edit className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onRemove(evt.id)}
                  title="Supprimer"
                  className="text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>
          <div className={`mt-0.5 ${isPast ? 'text-gray-500' : 'text-gray-600'} flex flex-wrap gap-x-2`}>
            {mexNom && <span>👤 {mexNom}</span>}
            {victimeNom && <span>🛡 {victimeNom}</span>}
            {opLabel && <span>🚓 {opLabel}</span>}
            {lancementLabel && <span>↳ {lancementLabel}</span>}
          </div>
          {evt.description && (
            <div
              className="mt-1 text-gray-700 prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: renderFormattedText(evt.description) }}
            />
          )}
        </div>
      )}
    </li>
  );
};

// ─────────────────────────────────────────────────────────────────
// Formulaire d'ajout d'événement (collapsé par défaut)
// ─────────────────────────────────────────────────────────────────

const EvenementForm: React.FC<{
  misEnExamen: DossierInstruction['misEnExamen'];
  victimes: NonNullable<DossierInstruction['victimes']>;
  ops: DossierInstruction['ops'];
  evenementsExistants: EvenementInstruction[];
  onAdd: (e: EvenementInstruction) => void;
}> = ({ misEnExamen, victimes, ops, evenementsExistants, onAdd }) => {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-sm text-emerald-700 hover:bg-emerald-50 py-2 rounded border-2 border-dashed border-emerald-300 inline-flex items-center justify-center gap-1.5"
      >
        <Plus className="h-4 w-4" />
        Ajouter un événement (CR, expertise, IPC, APC, interrogatoire, interpellation…)
      </button>
    );
  }

  return (
    <div className="border-2 border-dashed border-emerald-300 rounded p-3 bg-emerald-50/30">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-700">Nouvel événement</h4>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>
      <EvenementEditor
        misEnExamen={misEnExamen}
        victimes={victimes}
        ops={ops}
        evenementsExistants={evenementsExistants}
        onSave={(updates) => {
          const e: EvenementInstruction = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            type: updates.type as EvenementInstructionType,
            date: updates.date as string,
            ...updates,
          } as EvenementInstruction;
          onAdd(e);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Éditeur d'événement (création + édition)
// ─────────────────────────────────────────────────────────────────

const EvenementEditor: React.FC<{
  evenement?: EvenementInstruction;
  misEnExamen: DossierInstruction['misEnExamen'];
  victimes: NonNullable<DossierInstruction['victimes']>;
  ops: DossierInstruction['ops'];
  evenementsExistants: EvenementInstruction[];
  onSave: (data: Partial<EvenementInstruction>) => void;
  onCancel: () => void;
}> = ({ evenement, misEnExamen, victimes, ops, evenementsExistants, onSave, onCancel }) => {
  const [type, setType] = useState<EvenementInstructionType>(evenement?.type || 'lancement_cr');
  const [date, setDate] = useState(evenement?.date?.split('T')[0] || new Date().toISOString().split('T')[0]);
  const [titre, setTitre] = useState(evenement?.titre || '');
  const [description, setDescription] = useState(evenement?.description || '');
  const [misEnExamenId, setMisEnExamenId] = useState<string>(evenement?.misEnExamenId?.toString() || '');
  const [victimeId, setVictimeId] = useState<string>(evenement?.victimeId?.toString() || '');
  const [opId, setOpId] = useState<string>(evenement?.opId?.toString() || '');
  const [lancementCrId, setLancementCrId] = useState<string>(evenement?.lancementCrId?.toString() || '');
  const [categorieExpertise, setCategorieExpertise] = useState<CategorieExpertise>(
    evenement?.categorieExpertise || 'psychologique',
  );
  const [expertiseLibelle, setExpertiseLibelle] = useState(evenement?.expertiseLibelle || '');

  const lancementsCR = evenementsExistants.filter(e => e.type === 'lancement_cr');

  const handleSubmit = () => {
    if (!date) return;
    const data: Partial<EvenementInstruction> = {
      type,
      date,
      titre: titre.trim() || undefined,
      description: description.trim() || undefined,
      misEnExamenId: misEnExamenId ? Number(misEnExamenId) : undefined,
      victimeId: victimeId ? Number(victimeId) : undefined,
      opId: opId ? Number(opId) : undefined,
      lancementCrId: lancementCrId ? Number(lancementCrId) : undefined,
      categorieExpertise: type === 'expertise' ? categorieExpertise : undefined,
      expertiseLibelle:
        type === 'expertise' && categorieExpertise === 'autre'
          ? expertiseLibelle.trim() || undefined
          : undefined,
    };
    onSave(data);
  };

  // Choix MEX / victime selon le type
  const showMex =
    type === 'ipc' ||
    type === 'interrogatoire_fond' ||
    (type === 'expertise' && !EXPERTISE_PEUT_VISER_VICTIME(categorieExpertise)) ||
    (type === 'expertise' && categorieExpertise && (categorieExpertise === 'psychologique' || categorieExpertise === 'psychiatrique'));
  const showVictime =
    type === 'apc' ||
    (type === 'expertise' && EXPERTISE_PEUT_VISER_VICTIME(categorieExpertise));
  const showOp = type === 'phase_interpellation';
  const showLancementCR = type === 'retour_cr';
  const showExpertiseFields = type === 'expertise';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Type *</Label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EvenementInstructionType)}
            className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
          >
            <option value="lancement_cr">Lancement de CR</option>
            <option value="retour_cr">Retour de CR</option>
            <option value="expertise">Expertise</option>
            <option value="ipc">IPC (Interrogatoire de première comparution)</option>
            <option value="apc">APC (Audition de partie civile)</option>
            <option value="interrogatoire_fond">Interrogatoire au fond</option>
            <option value="phase_interpellation">Phase d'interpellation</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Date *</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {showExpertiseFields && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Type d'expertise</Label>
            <select
              value={categorieExpertise}
              onChange={(e) => setCategorieExpertise(e.target.value as CategorieExpertise)}
              className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
            >
              {(Object.keys(EXPERTISE_LABELS) as CategorieExpertise[]).map(k => (
                <option key={k} value={k}>{EXPERTISE_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {categorieExpertise === 'autre' && (
            <div>
              <Label className="text-xs">Précisez</Label>
              <Input
                value={expertiseLibelle}
                onChange={(e) => setExpertiseLibelle(e.target.value)}
                placeholder="Ex : toxicologique, comptable…"
                className="h-8 text-sm"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {showMex && (
          <div>
            <Label className="text-xs">Mis en examen</Label>
            <select
              value={misEnExamenId}
              onChange={(e) => setMisEnExamenId(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
            >
              <option value="">— sélectionner —</option>
              {misEnExamen.map(m => (
                <option key={m.id} value={m.id}>{m.nom}</option>
              ))}
            </select>
          </div>
        )}
        {showVictime && (
          <div>
            <Label className="text-xs">Victime / partie civile</Label>
            <select
              value={victimeId}
              onChange={(e) => setVictimeId(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
            >
              <option value="">— sélectionner —</option>
              {victimes.map(v => (
                <option key={v.id} value={v.id}>{v.nom}</option>
              ))}
            </select>
          </div>
        )}
        {showOp && (
          <div className="col-span-2">
            <Label className="text-xs">OP du JI associée</Label>
            <select
              value={opId}
              onChange={(e) => setOpId(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
            >
              <option value="">— sélectionner une OP —</option>
              {ops.map(o => (
                <option key={o.id} value={o.id}>
                  {new Date(o.date).toLocaleDateString()}
                  {o.description ? ` — ${o.description}` : ''}
                  {o.service ? ` (${o.service})` : ''}
                </option>
              ))}
            </select>
            {ops.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                Aucune OP n'est encore enregistrée — ajoutez-en une depuis l'onglet « OP & JLD ».
              </p>
            )}
          </div>
        )}
        {showLancementCR && (
          <div className="col-span-2">
            <Label className="text-xs">Lancement de CR associé</Label>
            <select
              value={lancementCrId}
              onChange={(e) => setLancementCrId(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
            >
              <option value="">— sélectionner un lancement —</option>
              {lancementsCR.map(l => (
                <option key={l.id} value={l.id}>
                  {new Date(l.date).toLocaleDateString()}
                  {l.titre ? ` — ${l.titre}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs">Titre / objet (optionnel)</Label>
        <Input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Ex : CR investigations Brigadier X, scellé n°…"
          className="h-8 text-sm"
        />
      </div>

      <div>
        <Label className="text-xs">Description / notes</Label>
        <RichTextEditor
          id={`evt-edit-${evenement?.id || 'new'}`}
          value={description}
          onChange={setDescription}
          placeholder="Détails, objet de l'expertise, notes complémentaires…"
          minHeight={100}
          maxHeight="30vh"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs">
          <X className="h-3 w-3 mr-1" />
          Annuler
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!date}
          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
        >
          <Save className="h-3 w-3 mr-1" />
          {evenement ? 'Mettre à jour' : 'Ajouter'}
        </Button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Colonne droite : Actes à faire / à demander à la JI
// Bloc-notes libre (rich text), sans workflow ni statut.
// ─────────────────────────────────────────────────────────────────

const NotesActesJI: React.FC<{
  value: string;
  onChange?: (html: string) => void;
  readOnly?: boolean;
}> = ({ value, onChange, readOnly }) => (
  <div className="bg-white border border-gray-200 rounded-lg p-3 sticky top-2">
    <div className="flex items-center gap-2 mb-2">
      <ClipboardList className="h-4 w-4 text-gray-600" />
      <h3 className="text-sm font-semibold text-gray-800">
        Actes à faire / à demander à la JI
      </h3>
    </div>
    <RichTextEditor
      id="notes-actes-ji"
      value={value}
      onChange={(html) => onChange?.(html)}
      placeholder="Notes libres : actes à faire, à demander au juge d'instruction…"
      minHeight={300}
      maxHeight="60vh"
      readOnly={readOnly || !onChange}
    />
  </div>
);
