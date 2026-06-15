'use client';

/**
 * SIRAL — Tableau de bord, PAR CONTENTIEUX.
 * Onglets de contentieux en tête ; tout l'écran (indicateurs, OP à venir,
 * rappels d'action) reflète le contentieux sélectionné. Ces widgets ne
 * vivent QUE sur le tableau de bord — pas de doublon dans la liste des enquêtes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { DossierInstruction } from '@/types/instructionTypes';
import { OPTimeline } from '@/components/OPTimeline';
import { TodoReminderBar } from '@/components/TodoReminderBar';
import { PendingActsJLD } from '@/components/PendingActsJLD';
import { PendingPose } from '@/components/PendingPose';
import { UpcomingActeDeadlines } from '@/components/UpcomingActeDeadlines';
import { ElectronBridge } from '@/utils/electronBridge';
import { AGENDA_ICAL_KEY, fetchAgenda, AgendaEvent } from '@/lib/web/agenda';

interface DashboardPageProps {
  enquetesByContentieux: Map<ContentieuxId, Enquete[]>;
  contentieuxDefs: ContentieuxDefinition[];
  activeContentieux: ContentieuxId | null;
  instructions: DossierInstruction[];
  globalTodos: any;
  onUpdateEnquete: (id: number, updates: Partial<Enquete>) => void;
  onGlobalTodosChange: (todos: any) => void;
  onOpenEnquete: (enqueteOrId: Enquete | number) => void;
  onOpenInstruction: (dossier: DossierInstruction) => void;
}

const KPI = ({ label, value, accent }: { label: string; value: number | string; accent?: string }) => (
  <div className="bg-white border border-gray-200/80 rounded-2xl px-5 py-4 shadow-[0_1px_2px_rgba(20,32,27,0.04)]">
    <div className="text-[12px] font-semibold text-gray-500">{label}</div>
    <div className="mt-1.5 text-3xl font-bold tracking-tight" style={{ color: accent || '#1a2230' }}>{value}</div>
  </div>
);

export const DashboardPage = ({
  enquetesByContentieux,
  contentieuxDefs,
  activeContentieux,
  instructions,
  globalTodos,
  onUpdateEnquete,
  onGlobalTodosChange,
  onOpenEnquete,
}: DashboardPageProps) => {
  const [selected, setSelected] = useState<ContentieuxId>(
    activeContentieux || contentieuxDefs[0]?.id || 'crimorg'
  );
  const selectedDef = contentieuxDefs.find(c => c.id === selected) || contentieuxDefs[0];

  const enquetes = useMemo(
    () => enquetesByContentieux.get(selected) || [],
    [enquetesByContentieux, selected]
  );
  const activeEnquetes = useMemo(() => enquetes.filter(e => e.statut !== 'archive'), [enquetes]);

  // Actes encore actifs (géoloc, écoute, autres actes en cours)
  const actesEnCours = useMemo(() => {
    let n = 0;
    for (const e of activeEnquetes) {
      for (const a of [...(e.actes || []), ...(e.ecoutes || []), ...(e.geolocalisations || [])]) {
        if ((a as { statut?: string }).statut === 'en_cours') n++;
      }
    }
    return n;
  }, [activeEnquetes]);

  // Actes nécessitant une action (autorisation/prolongation/pose en attente)
  const actesEnAttente = useMemo(() => {
    const pending = new Set(['autorisation_pending', 'prolongation_pending', 'pose_pending']);
    let n = 0;
    for (const e of activeEnquetes) {
      for (const a of [...(e.actes || []), ...(e.ecoutes || []), ...(e.geolocalisations || [])]) {
        if (pending.has((a as { statut?: string }).statut || '')) n++;
      }
    }
    return n;
  }, [activeEnquetes]);

  // Carte du seul contentieux sélectionné (OPTimeline attend une Map)
  const singleCtxMap = useMemo(
    () => new Map([[selected, activeEnquetes]]),
    [selected, activeEnquetes]
  );

  // Instructions rattachées à ce contentieux (si l'info existe), sinon toutes
  const instructionsActives = useMemo(() => {
    const enCours = instructions.filter(d => !d.archived);
    const scoped = enCours.filter(d => (d as { contentieuxId?: string }).contentieuxId === selected);
    return scoped.length > 0 ? scoped.length : enCours.length;
  }, [instructions, selected]);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Agenda Google (lecture seule) — affiché s'il a été connecté dans les paramètres
  const [agenda, setAgenda] = useState<AgendaEvent[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = String(await ElectronBridge.getData(AGENDA_ICAL_KEY, '') || '');
      if (!url) { setAgenda(null); return; }
      try { const ev = await fetchAgenda(url); if (!cancelled) setAgenda(ev); }
      catch { if (!cancelled) setAgenda([]); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Tableau de bord</h1>
          <p className="text-sm text-gray-500 mt-0.5 capitalize">{today}</p>
        </div>
        {/* Onglets contentieux */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {contentieuxDefs.map(def => {
            const on = def.id === selected;
            return (
              <button
                key={def.id}
                onClick={() => setSelected(def.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition-all ${
                  on ? 'text-white shadow-sm' : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
                }`}
                style={on ? { backgroundColor: def.color } : {}}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: on ? '#fff' : def.color }} />
                {def.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Indicateurs clés du contentieux sélectionné */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Enquêtes en cours" value={activeEnquetes.length} accent={selectedDef?.color} />
        <KPI label="Instructions en cours" value={instructionsActives} />
        <KPI label="Actes en cours" value={actesEnCours} accent={actesEnCours > 0 ? '#0f766e' : undefined} />
        <KPI label="Actes en attente" value={actesEnAttente} accent={actesEnAttente > 0 ? '#b45309' : undefined} />
      </div>

      {/* OP à venir — du contentieux sélectionné */}
      <OPTimeline
        enquetesByContentieux={singleCtxMap}
        contentieuxDefs={contentieuxDefs}
        onEnqueteClick={onOpenEnquete}
      />

      {/* Échéances d'actes à venir (7 jours) — cliquable vers l'enquête */}
      <UpcomingActeDeadlines enquetes={activeEnquetes} onOpenEnquete={onOpenEnquete} />

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

      {/* Agenda Google (lecture seule) — uniquement si connecté */}
      {agenda && agenda.length > 0 && (
        <div className="bg-white border border-gray-200/80 rounded-2xl px-5 py-4 max-w-md">
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="h-4 w-4 text-indigo-600" />
            <span className="text-[12px] font-semibold text-gray-600 uppercase tracking-wide">Agenda</span>
            <span className="ml-auto text-[9px] font-bold text-indigo-700 bg-indigo-100 rounded px-1.5 py-0.5">G</span>
          </div>
          <ul className="space-y-1.5">
            {agenda.slice(0, 6).map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[13px]">
                <span className="text-gray-400 text-[11px] w-20 flex-shrink-0">
                  {new Date(e.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  {!e.allDay && ' · ' + new Date(e.start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-gray-700 truncate">{e.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
