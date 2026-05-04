// components/mindmap/ManageOverlayPanel.tsx
// Panneau flottant listant les éléments overlay créés par l'utilisateur :
// MEC ex nihilo, dossiers ex nihilo, liens renseignement. Permet de
// recentrer la caméra sur un élément, de l'éditer ou de le supprimer.

'use client';

import React, { useState } from 'react';
import { X, Pencil, Trash2, MapPin, FileText, User, Link as LinkIcon } from 'lucide-react';
import type {
  MecExNihilo,
  DossierExNihilo,
  LienRenseignement,
} from '@/stores/useCartographieOverlayStore';
import type { MindmapGraph } from '@/utils/mindmapGraph';

type Tab = 'mecs' | 'dossiers' | 'liens';

interface Props {
  mecs: MecExNihilo[];
  dossiers: DossierExNihilo[];
  liens: LienRenseignement[];
  graph: MindmapGraph;
  onClose: () => void;
  onCenterNode: (nodeId: string) => void;
  onEditMec: (mec: MecExNihilo) => void;
  onEditDossier: (dossier: DossierExNihilo) => void;
  onEditLien: (lien: LienRenseignement) => void;
  onDeleteMec: (id: string) => void;
  onDeleteDossier: (id: string) => void;
  onDeleteLien: (id: string) => void;
}

export const ManageOverlayPanel: React.FC<Props> = ({
  mecs, dossiers, liens, graph,
  onClose, onCenterNode,
  onEditMec, onEditDossier, onEditLien,
  onDeleteMec, onDeleteDossier, onDeleteLien,
}) => {
  const [tab, setTab] = useState<Tab>('mecs');

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
  onCenter?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleteConfirm: string;
}> = ({ title, subtitle, onCenter, onEdit, onDelete, deleteConfirm }) => (
  <div className="flex items-start gap-1 px-2 py-2 rounded hover:bg-slate-50 group">
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-slate-900 truncate" title={title}>{title}</div>
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
