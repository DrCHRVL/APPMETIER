'use client';

import React, { useMemo } from 'react';
import { Calendar, Lock, Gavel, FileText, NotebookPen, ClipboardCheck, AlertTriangle } from 'lucide-react';
import type { DossierInstruction } from '@/types/instructionTypes';

interface Props {
  dossier: DossierInstruction;
}

type Kind =
  | 'ouverture'
  | 'placement_dp'
  | 'fin_periode_dp'
  | 'debat_jld'
  | 'op_ji'
  | 'dml_depot'
  | 'dml_echeance'
  | 'note'
  | 'verification';

interface Evt {
  key: string;
  date: Date;
  kind: Kind;
  title: string;
  detail?: string;
  badge: string;
  color: string;
}

const KIND_META: Record<Kind, { label: string; bg: string; icon: React.ElementType }> = {
  ouverture:       { label: 'Ouverture',     bg: 'bg-emerald-500', icon: FileText },
  placement_dp:    { label: 'Placement DP',  bg: 'bg-red-500',     icon: Lock },
  fin_periode_dp:  { label: 'Fin période DP',bg: 'bg-red-700',     icon: AlertTriangle },
  debat_jld:       { label: 'Débat JLD',     bg: 'bg-indigo-500',  icon: Gavel },
  op_ji:           { label: 'OP JI',         bg: 'bg-blue-500',    icon: Calendar },
  dml_depot:       { label: 'DML déposée',   bg: 'bg-purple-400',  icon: FileText },
  dml_echeance:    { label: 'Échéance DML',  bg: 'bg-purple-600',  icon: AlertTriangle },
  note:            { label: 'Note',          bg: 'bg-gray-400',    icon: NotebookPen },
  verification:    { label: 'Vérification',  bg: 'bg-amber-500',   icon: ClipboardCheck },
};

export const DossierTimelineSection = ({ dossier }: Props) => {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const events = useMemo<Evt[]>(() => {
    const list: Evt[] = [];

    // Ouverture
    if (dossier.dateOuverture) {
      list.push({
        key: `ouv-${dossier.id}`,
        date: new Date(dossier.dateOuverture),
        kind: 'ouverture',
        title: 'Ouverture de l\'information judiciaire',
        detail: `RI du ${new Date(dossier.dateRI || dossier.dateOuverture).toLocaleDateString()}`,
        badge: KIND_META.ouverture.label,
        color: KIND_META.ouverture.bg,
      });
    }

    // Pour chaque MEX
    for (const mex of dossier.misEnExamen) {
      if (mex.mesureSurete.type === 'detenu') {
        for (const periode of mex.mesureSurete.periodes) {
          // Début (placement ou prolongation)
          list.push({
            key: `dp-debut-${mex.id}-${periode.id}`,
            date: new Date(periode.dateDebut),
            kind: 'placement_dp',
            title: `${periode.type === 'placement' ? 'Placement DP' : 'Prolongation DP'} — ${mex.nom}`,
            detail: `${periode.dureeMois} mois`,
            badge: periode.type === 'placement' ? 'Placement' : 'Prolong.',
            color: KIND_META.placement_dp.bg,
          });
          // Fin
          list.push({
            key: `dp-fin-${mex.id}-${periode.id}`,
            date: new Date(periode.dateFin),
            kind: 'fin_periode_dp',
            title: `Fin période DP — ${mex.nom}`,
            detail: `Période débutée le ${new Date(periode.dateDebut).toLocaleDateString()}`,
            badge: 'Fin DP',
            color: KIND_META.fin_periode_dp.bg,
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
          badge: 'DML',
          color: KIND_META.dml_depot.bg,
        });
        if (dml.statut === 'en_attente') {
          list.push({
            key: `dml-e-${mex.id}-${dml.id}`,
            date: new Date(dml.dateEcheance),
            kind: 'dml_echeance',
            title: `Échéance DML — ${mex.nom}`,
            detail: `Réquisitions à rendre`,
            badge: 'Éch. DML',
            color: KIND_META.dml_echeance.bg,
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
        badge: 'OP JI',
        color: KIND_META.op_ji.bg,
      });
    }

    for (const debat of dossier.debatsJLD) {
      list.push({
        key: `jld-${debat.id}`,
        date: new Date(debat.date),
        kind: 'debat_jld',
        title: `Débat JLD${debat.heureExacte ? ' à ' + new Date(debat.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}`,
        detail: debat.type.replace('_', ' '),
        badge: 'JLD',
        color: KIND_META.debat_jld.bg,
      });
    }

    for (const n of dossier.notesPerso) {
      list.push({
        key: `note-${n.id}`,
        date: new Date(n.date),
        kind: 'note',
        title: 'Note perso',
        detail: n.contenu.length > 80 ? n.contenu.substring(0, 80) + '…' : n.contenu,
        badge: 'Note',
        color: KIND_META.note.bg,
      });
    }

    for (const v of dossier.verifications) {
      list.push({
        key: `verif-${v.id}`,
        date: new Date(v.date),
        kind: 'verification',
        title: 'Point dossier',
        detail: v.contenu,
        badge: 'Vérif',
        color: KIND_META.verification.bg,
      });
    }

    // Tri chronologique (du plus récent au plus ancien)
    list.sort((a, b) => b.date.getTime() - a.date.getTime());
    return list;
  }, [dossier]);

  // Sépare passé et futur
  const futurs = events.filter(e => {
    const d = new Date(e.date);
    d.setHours(0, 0, 0, 0);
    return d >= today;
  }).reverse(); // du plus proche au plus lointain
  const passes = events.filter(e => {
    const d = new Date(e.date);
    d.setHours(0, 0, 0, 0);
    return d < today;
  });

  if (events.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-gray-400 italic bg-gray-50 border border-dashed border-gray-200 rounded">
        Aucun événement enregistré pour ce dossier.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* À VENIR */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          À venir ({futurs.length})
        </h3>
        {futurs.length === 0 ? (
          <div className="text-xs text-gray-400 italic">Aucun événement à venir.</div>
        ) : (
          <ol className="relative border-l-2 border-gray-200 ml-2 space-y-2">
            {futurs.map(e => {
              const Icon = KIND_META[e.kind].icon;
              const days = Math.ceil((e.date.getTime() - today.getTime()) / 86400000);
              return (
                <li key={e.key} className="ml-4 pl-2">
                  <div className={`absolute -left-[7px] w-3 h-3 rounded-full ${e.color}`} />
                  <div className="text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="h-3 w-3 text-gray-500" />
                      <span className="font-semibold text-gray-800">{e.title}</span>
                      <span className="text-gray-500">
                        {e.date.toLocaleDateString('fr-FR')}
                        {' · '}
                        {days === 0 ? 'auj.' : days === 1 ? 'demain' : `J+${days}`}
                      </span>
                    </div>
                    {e.detail && <div className="text-gray-600 mt-0.5">{e.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* PASSÉ */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          Historique ({passes.length})
        </h3>
        {passes.length === 0 ? (
          <div className="text-xs text-gray-400 italic">Aucun événement passé.</div>
        ) : (
          <ol className="relative border-l-2 border-gray-200 ml-2 space-y-2">
            {passes.map(e => {
              const Icon = KIND_META[e.kind].icon;
              const daysAgo = Math.floor((today.getTime() - e.date.getTime()) / 86400000);
              return (
                <li key={e.key} className="ml-4 pl-2">
                  <div className={`absolute -left-[7px] w-3 h-3 rounded-full ${e.color} opacity-70`} />
                  <div className="text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="h-3 w-3 text-gray-400" />
                      <span className="font-medium text-gray-700">{e.title}</span>
                      <span className="text-gray-400">
                        {e.date.toLocaleDateString('fr-FR')}
                        {' · '}
                        il y a {daysAgo} j
                      </span>
                    </div>
                    {e.detail && <div className="text-gray-500 mt-0.5">{e.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
};
