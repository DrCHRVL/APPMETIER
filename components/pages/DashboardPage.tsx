'use client';

/**
 * SIRAL — Tableau de bord, PAR CONTENTIEUX.
 * Onglets de contentieux en tête ; tout l'écran (indicateurs, OP à venir,
 * rappels d'action) reflète le contentieux sélectionné. Ces widgets ne
 * vivent QUE sur le tableau de bord — pas de doublon dans la liste des enquêtes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { DossierInstruction } from '@/types/instructionTypes';
import { OPTimeline } from '@/components/OPTimeline';
import { TodoReminderBar } from '@/components/TodoReminderBar';
import { PendingActsJLD } from '@/components/PendingActsJLD';
import { PendingPose } from '@/components/PendingPose';
import { UpcomingActeDeadlines } from '@/components/UpcomingActeDeadlines';
import { ElectronBridge } from '@/utils/electronBridge';
import { AgendaCalendar } from '@/components/AgendaCalendar';
import { fetchAgendaMulti, AgendaEvent, AgendaSource, AgendaUrls } from '@/lib/web/agenda';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { JLDActePreviewModal, JLDActeRef, JLDActeKind } from '@/components/modals/JLDActePreviewModal';
import { MajordomeWidget } from '@/components/attache/MajordomeWidget';
import { InboxWidget } from '@/components/attache/InboxWidget';
import { ProductionsSection } from '@/components/attache/ProductionsSection';

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
  /**
   * Mode JLD : tableau de bord restreint. Masque les instructions, les rappels
   * « à faire » et l'agenda ; un clic sur un acte (attente JLD / pose / échéance)
   * ouvre un aperçu d'acte dédié plutôt que la fiche enquête complète.
   */
  isJLD?: boolean;
}

const KPI = ({ label, value, accent, sub }: { label: string; value: number | string; accent?: string; sub?: string }) => (
  <div className="bg-white border border-gray-200/80 rounded-2xl px-5 py-4 shadow-[0_1px_2px_rgba(20,32,27,0.04)]">
    <div className="text-[12px] font-semibold text-gray-500">{label}</div>
    <div className="mt-1.5 text-3xl font-bold tracking-tight" style={{ color: accent || '#1a2230' }}>{value}</div>
    {sub && <div className="mt-1 text-[11px] text-gray-400">{sub}</div>}
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
  isJLD = false,
}: DashboardPageProps) => {
  const [selected, setSelected] = useState<ContentieuxId>(
    activeContentieux || contentieuxDefs[0]?.id || 'crimorg'
  );

  // Aperçu d'acte « forgé » pour le JLD (clic depuis les files du tableau de bord).
  const [jldActeRef, setJldActeRef] = useState<JLDActeRef | null>(null);
  const handleOpenActe = useMemo(
    () => (enquete: Enquete, acteId: number, kind: JLDActeKind) =>
      setJldActeRef({ enquete, acteId, kind }),
    []
  );
  const selectedDef = contentieuxDefs.find(c => c.id === selected) || contentieuxDefs[0];

  const enquetes = useMemo(
    () => enquetesByContentieux.get(selected) || [],
    [enquetesByContentieux, selected]
  );
  const activeEnquetes = useMemo(() => enquetes.filter(e => e.statut !== 'archive'), [enquetes]);

  // Actes réellement en cours (géoloc, écoute, autres actes posés et actifs).
  // - Un acte non posé (pas de datePose, ex. pose/autorisation en attente) n'est
  //   pas compté : tant qu'il n'est pas posé, il n'est pas « en cours ».
  // - Un acte « en cours » dont la dateFin est dépassée est en réalité terminé.
  //   Le statut est désormais normalisé au chargement, mais on garde le garde-fou
  //   pour les actes qui expirent pendant la session (avant le prochain reload).
  const actesEnCours = useMemo(() => {
    const now = new Date();
    let n = 0;
    for (const e of activeEnquetes) {
      for (const a of [...(e.actes || []), ...(e.ecoutes || []), ...(e.geolocalisations || [])]) {
        const acte = a as { statut?: string; datePose?: string; dateFin?: string };
        if (acte.statut !== 'en_cours') continue;
        if (!acte.datePose) continue;                                // pas posé → pas compté
        if (acte.dateFin && new Date(acte.dateFin) < now) continue;  // expiré → terminé
        n++;
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
  const { instructionsActives, nbDetenus } = useMemo(() => {
    const enCours = instructions.filter(d => !d.archived);
    const scoped = enCours.filter(d => (d as { contentieuxId?: string }).contentieuxId === selected);
    const liste = scoped.length > 0 ? scoped : enCours;
    const detenus = liste.flatMap(d => d.misEnExamen || []).filter(m => m.mesureSurete?.type === 'detenu').length;
    return { instructionsActives: liste.length, nbDetenus: detenus };
  }, [instructions, selected]);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  // Agenda (lecture seule) — Google + Outlook + iCloud fusionnés. Les adresses
  // iCal et l'apparence suivent le compte utilisateur (préférences
  // synchronisées) : on les retrouve sur tous les appareils. Le calendrier
  // mensuel reste affiché même sans agenda connecté ni rendez-vous.
  const { agendaUrls, agendaDisplay, seedAgenda } = useUserPreferences();
  const [agenda, setAgenda] = useState<AgendaEvent[]>([]);
  const [agendaSources, setAgendaSources] = useState<AgendaSource[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(true);

  // Migration unique de l'ancien stockage local vers le compte.
  useEffect(() => { seedAgenda(); }, [seedAgenda]);

  // Clé stable : ne déclenche un refetch que si le contenu des URLs change
  // (y compris quand un autre appareil pousse une modif via la synchro).
  const agendaUrlsKey = JSON.stringify(agendaUrls);
  const fetchAgendaData = React.useCallback(async () => {
    setAgendaLoading(true);
    const urls: AgendaUrls = JSON.parse(agendaUrlsKey);
    const sources = (Object.keys(urls) as AgendaSource[]).filter(s => urls[s as keyof typeof urls]);
    setAgendaSources(sources);
    if (sources.length === 0) { setAgenda([]); setAgendaLoading(false); return; }
    try { const ev = await fetchAgendaMulti(urls); setAgenda(ev); }
    catch { setAgenda([]); }
    finally { setAgendaLoading(false); }
  }, [agendaUrlsKey]);

  useEffect(() => {
    fetchAgendaData();
  }, [fetchAgendaData]);

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

      {/* Brief du majordome (attaché IA) — se masque de lui-même pour tout
          compte non-admin ou si la fonctionnalité n'est pas activée. */}
      {!isJLD && <MajordomeWidget />}

      {/* Actes rédigés HORS DOSSIER (attaché IA) : demandes d'actes arrivées
          par mail sans procédure correspondante, traitées sur consigne — le
          magistrat les retrouve ici, les exporte et les valide. Admin only
          (auto-masqué), invisible tant qu'il n'y en a aucun. */}
      {!isJLD && <ProductionsSection numero="_hors-dossier" titre="Actes rédigés — hors dossier" masquerSiVide />}

      {/* Indicateurs clés du contentieux sélectionné.
          Le JLD ne voit pas les instructions : 3 indicateurs au lieu de 4. */}
      <div className={`grid grid-cols-2 gap-3 ${isJLD ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
        <KPI label="Enquêtes en cours" value={activeEnquetes.length} accent={selectedDef?.color} />
        {!isJLD && (
          <KPI label="Instructions en cours" value={instructionsActives} sub={nbDetenus > 0 ? `dont ${nbDetenus} détenu${nbDetenus > 1 ? 's' : ''}` : undefined} />
        )}
        <KPI label="Actes en cours" value={actesEnCours} accent={actesEnCours > 0 ? '#0f766e' : undefined} />
        <KPI label="Actes en attente" value={actesEnAttente} accent={actesEnAttente > 0 ? '#b45309' : undefined} />
      </div>

      {/* OP à venir — du contentieux sélectionné.
          Pour le JLD, le clic n'ouvre pas la fiche enquête (pas d'accès). */}
      <OPTimeline
        enquetesByContentieux={singleCtxMap}
        contentieuxDefs={contentieuxDefs}
        onEnqueteClick={isJLD ? undefined : onOpenEnquete}
      />

      {/* Échéances d'actes à venir (7 jours) — clic vers l'enquête, ou aperçu d'acte (JLD) */}
      <UpcomingActeDeadlines
        enquetes={activeEnquetes}
        onOpenEnquete={isJLD ? undefined : onOpenEnquete}
        onOpenActe={isJLD ? handleOpenActe : undefined}
      />

      {/* Rappels d'action. Le JLD ne voit ni « à faire » (qui ne le concerne pas)
          ni l'agenda : seulement « Attente JLD » et « Pose en attente ». */}
      <div className={`grid grid-cols-1 gap-4 items-start ${isJLD ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
        {!isJLD && (
          <TodoReminderBar
            enquetes={activeEnquetes}
            globalTodos={globalTodos}
            onUpdateEnquete={onUpdateEnquete}
            onGlobalTodosChange={onGlobalTodosChange}
            onOpenEnquete={onOpenEnquete}
          />
        )}
        <PendingActsJLD
          enquetes={activeEnquetes}
          onOpenEnquete={isJLD ? undefined : onOpenEnquete}
          onOpenActe={isJLD ? handleOpenActe : undefined}
        />
        <PendingPose
          enquetes={activeEnquetes}
          onOpenEnquete={isJLD ? undefined : onOpenEnquete}
          onOpenActe={isJLD ? handleOpenActe : undefined}
        />
      </div>

      {/* Calendrier mensuel (lecture seule) — masqué pour le JLD. */}
      {!isJLD && (
        <AgendaCalendar events={agenda} connectedSources={agendaSources} loading={agendaLoading} displaySettings={agendaDisplay} onRefresh={fetchAgendaData} />
      )}

      {/* Boîte mail de l'attaché IA — tout en bas, sous le calendrier.
          Se masque de lui-même pour tout compte non-admin (404 côté API) :
          vue de contrôle « bien reçu / en cours / traité » de chaque message. */}
      {!isJLD && <InboxWidget />}

      {/* Aperçu d'acte forgé pour le JLD */}
      {isJLD && (
        <JLDActePreviewModal acteRef={jldActeRef} onClose={() => setJldActeRef(null)} />
      )}
    </div>
  );
};
