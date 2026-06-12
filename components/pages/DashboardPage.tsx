'use client';

/**
 * SIRAL — Tableau de bord.
 * Vue d'accueil transversale : indicateurs clés, OP à venir, et les rappels
 * d'action (à faire / autorisations JLD en attente / poses en attente).
 * Ces widgets ne vivent QUE sur le tableau de bord — pas de doublon ailleurs.
 */
import React, { useMemo } from 'react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { DossierInstruction } from '@/types/instructionTypes';
import { OPTimeline } from '@/components/OPTimeline';
import { TodoReminderBar } from '@/components/TodoReminderBar';
import { PendingActsJLD } from '@/components/PendingActsJLD';
import { PendingPose } from '@/components/PendingPose';

interface DashboardPageProps {
  enquetesByContentieux: Map<ContentieuxId, Enquete[]>;
  contentieuxDefs: ContentieuxDefinition[];
  activeEnquetes: Enquete[];
  instructions: DossierInstruction[];
  globalTodos: any;
  onUpdateEnquete: (id: number, updates: Partial<Enquete>) => void;
  onGlobalTodosChange: (todos: any) => void;
  // accepte une enquête ou un id (comme handleViewEnquete) : compatible OPTimeline + widgets
  onOpenEnquete: (enqueteOrId: Enquete | number) => void;
  onOpenInstruction: (dossier: DossierInstruction) => void;
}

const KPI = ({ label, value, sub }: { label: string; value: number | string; sub?: string }) => (
  <div className="bg-white border border-gray-200/80 rounded-2xl px-5 py-4 shadow-[0_1px_2px_rgba(20,32,27,0.04)]">
    <div className="text-[12px] font-semibold text-gray-500">{label}</div>
    <div className="mt-1.5 text-3xl font-bold tracking-tight text-gray-900">{value}</div>
    {sub && <div className="mt-0.5 text-[12px] text-gray-400">{sub}</div>}
  </div>
);

export const DashboardPage = ({
  enquetesByContentieux,
  contentieuxDefs,
  activeEnquetes,
  instructions,
  globalTodos,
  onUpdateEnquete,
  onGlobalTodosChange,
  onOpenEnquete,
  onOpenInstruction,
}: DashboardPageProps) => {
  const stats = useMemo(() => {
    let enquetesActives = 0;
    let terminees = 0;
    for (const list of enquetesByContentieux.values()) {
      for (const e of list) (e.statut === 'archive' ? terminees++ : enquetesActives++);
    }
    const instructionsActives = instructions.filter(d => !d.archived).length;
    return { enquetesActives, terminees, instructionsActives };
  }, [enquetesByContentieux, instructions]);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Tableau de bord</h1>
        <p className="text-sm text-gray-500 mt-0.5 capitalize">{today}</p>
      </div>

      {/* Indicateurs clés */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Enquêtes en cours" value={stats.enquetesActives} />
        <KPI label="Instructions en cours" value={stats.instructionsActives} />
        <KPI label="Enquêtes terminées" value={stats.terminees} />
        <KPI label="Contentieux suivis" value={contentieuxDefs.length} />
      </div>

      {/* OP à venir — déplacée ici depuis la liste des enquêtes */}
      <OPTimeline
        enquetesByContentieux={enquetesByContentieux}
        contentieuxDefs={contentieuxDefs}
        onEnqueteClick={onOpenEnquete}
      />

      {/* Rappels d'action (sans doublon dans la page Enquêtes) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <TodoReminderBar
          enquetes={activeEnquetes}
          globalTodos={globalTodos}
          onUpdateEnquete={onUpdateEnquete}
          onGlobalTodosChange={onGlobalTodosChange}
          onOpenEnquete={onOpenEnquete}
        />
        <PendingActsJLD enquetes={activeEnquetes} onOpenEnquete={onOpenEnquete} />
        <PendingPose enquetes={activeEnquetes} onOpenEnquete={onOpenEnquete} />
      </div>
    </div>
  );
};
