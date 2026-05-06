// components/mindmap/ManageOverlayPanel.tsx
// Panneau flottant listant les éléments overlay créés par l'utilisateur :
// MEC ex nihilo, dossiers ex nihilo, liens renseignement. Permet de
// recentrer la caméra sur un élément, de l'éditer ou de le supprimer.

'use client';

import React, { useState } from 'react';
import { X, Pencil, Trash2, MapPin, FileText, User, Link as LinkIcon, Compass } from 'lucide-react';
import type {
  MecExNihilo,
  DossierExNihilo,
  LienRenseignement,
  TagZoneAssignment,
} from '@/stores/useCartographieOverlayStore';
import type { MindmapGraph } from '@/utils/mindmapGraph';
import { ZONE_GRID_POSITION, ZONE_LABELS, type ZoneId } from './zones';

type Tab = 'mecs' | 'dossiers' | 'liens' | 'zones';

interface Props {
  mecs: MecExNihilo[];
  dossiers: DossierExNihilo[];
  liens: LienRenseignement[];
  /** Tags présents dans les sources (valeur, count) — pré-trié par fréquence. */
  availableTags: Array<[string, number]>;
  /** Assignations tag → zone actuellement persistées. */
  tagZones: TagZoneAssignment[];
  graph: MindmapGraph;
  onClose: () => void;
  onCenterNode: (nodeId: string) => void;
  onEditMec: (mec: MecExNihilo) => void;
  onEditDossier: (dossier: DossierExNihilo) => void;
  onEditLien: (lien: LienRenseignement) => void;
  onDeleteMec: (id: string) => void;
  onDeleteDossier: (id: string) => void;
  onDeleteLien: (id: string) => void;
  onSetTagZone: (tag: string, zone: ZoneId) => void;
  onRemoveTagZone: (tag: string) => void;
}

export const ManageOverlayPanel: React.FC<Props> = ({
  mecs, dossiers, liens, availableTags, tagZones, graph,
  onClose, onCenterNode,
  onEditMec, onEditDossier, onEditLien,
  onDeleteMec, onDeleteDossier, onDeleteLien,
  onSetTagZone, onRemoveTagZone,
}) => {
  const [tab, setTab] = useState<Tab>('mecs');
  const tagZoneMap = new Map(tagZones.map(a => [a.tag, a.zone]));

  const labelOf = (id: string): string => {
    const mec = graph.mecById.get(id);
    if (mec) return mec.displayName;
    const dossier = graph.dossierById.get(id);
    if (dossier) return dossier.numero;
    return '?';
  };

  return (
    <div className="absolute top-3 right-3 z-20 w-80 max-h-[calc(100%-1.5rem)] flex flex-col bg-white border border-slate-200 rounded-lg shadow-lg">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">Mes ajouts</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex border-b border-slate-200 text-xs">
        <TabButton active={tab === 'mecs'} onClick={() => setTab('mecs')} icon={<User className="h-3 w-3" />} label="MEC" count={mecs.length} />
        <TabButton active={tab === 'dossiers'} onClick={() => setTab('dossiers')} icon={<FileText className="h-3 w-3" />} label="Dossiers" count={dossiers.length} />
        <TabButton active={tab === 'liens'} onClick={() => setTab('liens')} icon={<LinkIcon className="h-3 w-3" />} label="Liens" count={liens.length} />
        <TabButton active={tab === 'zones'} onClick={() => setTab('zones')} icon={<Compass className="h-3 w-3" />} label="Zones" count={tagZones.length} />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'mecs' && (
          mecs.length === 0
            ? <Empty>Aucun MEC manuel.</Empty>
            : mecs.map(m => (
                <Row
                  key={m.id}
                  title={m.displayName}
                  subtitle={[
                    m.statut && labelStatut(m.statut),
                    m.alias.length > 0 && `${m.alias.length} alias`,
                  ].filter(Boolean).join(' · ') || (m.notes ? 'Notes renseignées' : 'Aucune info')}
                  onCenter={() => onCenterNode(m.id)}
                  onEdit={() => onEditMec(m)}
                  onDelete={() => onDeleteMec(m.id)}
                  deleteConfirm={`Supprimer la fiche manuelle de "${m.displayName}" ?`}
                />
              ))
        )}

        {tab === 'dossiers' && (
          dossiers.length === 0
            ? <Empty>Aucun dossier manuel.</Empty>
            : dossiers.map(d => (
                <Row
                  key={d.id}
                  title={d.label}
                  subtitle={[
                    d.dateApprox,
                    `${d.mecIds.length} MEC lié${d.mecIds.length > 1 ? 's' : ''}`,
                  ].filter(Boolean).join(' · ')}
                  onCenter={() => onCenterNode(d.id)}
                  onEdit={() => onEditDossier(d)}
                  onDelete={() => onDeleteDossier(d.id)}
                  deleteConfirm={`Supprimer le dossier manuel "${d.label}" ?`}
                />
              ))
        )}

        {tab === 'liens' && (
          liens.length === 0
            ? <Empty>Aucun lien renseignement.</Empty>
            : liens.map(l => (
                <Row
                  key={l.id}
                  title={`${labelOf(l.source)} → ${labelOf(l.target)}`}
                  subtitle={l.label || (l.notes ? 'Notes renseignées' : 'Sans libellé')}
                  onEdit={() => onEditLien(l)}
                  onDelete={() => onDeleteLien(l.id)}
                  deleteConfirm="Supprimer ce lien renseignement ?"
                />
              ))
        )}

        {tab === 'zones' && (
          availableTags.length === 0
            ? <Empty>Aucun tag dans les enquêtes affichées. Ajoutez des tags (ex. service d'enquête) pour pouvoir les ancrer à une zone.</Empty>
            : (
              <div className="space-y-2">
                <div className="px-2 py-1 text-[11px] text-slate-500 leading-snug">
                  Assigne chaque tag à une zone cardinale. Les enquêtes (et leurs MEC)
                  seront attirés vers cette zone — sans qu'un nœud "service" apparaisse.
                </div>
                {availableTags.map(([tag, count]) => (
                  <TagZoneRow
                    key={tag}
                    tag={tag}
                    count={count}
                    current={tagZoneMap.get(tag)}
                    onAssign={(z) => onSetTagZone(tag, z)}
                    onClear={() => onRemoveTagZone(tag)}
                  />
                ))}
              </div>
            )
        )}
      </div>
    </div>
  );
};

// Sélecteur de zone pour un tag : grille 3×3 de boutons cardinaux + bouton
// "aucune". Visuel compact pour rester dans le panneau étroit.
const TagZoneRow: React.FC<{
  tag: string;
  count: number;
  current: ZoneId | undefined;
  onAssign: (zone: ZoneId) => void;
  onClear: () => void;
}> = ({ tag, count, current, onAssign, onClear }) => {
  const cells: (ZoneId | null)[][] = [
    [null, null, null], [null, null, null], [null, null, null],
  ];
  for (const [zone, pos] of Object.entries(ZONE_GRID_POSITION) as [ZoneId, { col: 0 | 1 | 2; row: 0 | 1 | 2 }][]) {
    cells[pos.row][pos.col] = zone;
  }
  return (
    <div className="px-2 py-2 border border-slate-200 rounded">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-sm font-medium text-slate-900 truncate" title={tag}>{tag}</div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] bg-slate-100 text-slate-600 px-1 rounded">{count}</span>
          {current && (
            <button
              onClick={onClear}
              title="Retirer l'assignation"
              className="text-[10px] text-slate-400 hover:text-red-600"
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-0.5">
        {cells.flatMap((row, ri) => row.map((zone, ci) => {
          if (!zone) return <div key={`${ri}_${ci}`} />;
          const active = current === zone;
          return (
            <button
              key={zone}
              onClick={() => onAssign(zone)}
              title={ZONE_LABELS[zone]}
              className={`h-7 text-[10px] rounded transition-colors ${
                active
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {zone === 'centre' ? '·' : zone}
            </button>
          );
        }))}
      </div>
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 py-2 transition-colors ${
      active ? 'text-slate-900 border-b-2 border-slate-900 bg-slate-50' : 'text-slate-500 hover:text-slate-700'
    }`}
  >
    {icon}
    <span>{label}</span>
    <span className="text-[10px] bg-slate-200 text-slate-700 px-1 rounded">{count}</span>
  </button>
);

const Row: React.FC<{
  title: string;
  subtitle?: string;
  colorDot?: string;
  onCenter?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleteConfirm: string;
}> = ({ title, subtitle, colorDot, onCenter, onEdit, onDelete, deleteConfirm }) => (
  <div className="flex items-start gap-1 px-2 py-2 rounded hover:bg-slate-50 group">
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5" title={title}>
        {colorDot && (
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: colorDot }}
          />
        )}
        <span className="truncate">{title}</span>
      </div>
      {subtitle && <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>}
    </div>
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
      {onCenter && (
        <button onClick={onCenter} title="Centrer la caméra" className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100">
          <MapPin className="h-3.5 w-3.5" />
        </button>
      )}
      <button onClick={onEdit} title="Modifier" className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => { if (window.confirm(deleteConfirm)) onDelete(); }}
        title="Supprimer"
        className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-xs text-slate-400 px-2 py-6 text-center">{children}</div>
);

function labelStatut(s: string): string {
  switch (s) {
    case 'actif': return 'Actif';
    case 'dormant': return 'Dormant';
    case 'libere': return 'Sorti / libéré';
    case 'decede': return 'Décédé';
    default: return s;
  }
}
