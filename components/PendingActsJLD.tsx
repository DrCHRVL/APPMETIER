import React, { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { getProlongationRequestDate, getAutorisationRequestDate } from '@/utils/acteUtils';

type ActeKind = 'acte' | 'ecoute' | 'geoloc';

interface PendingActsJLDProps {
  enquetes: Enquete[];
  onOpenEnquete?: (enquete: Enquete) => void;
  /** Si fourni, prioritaire sur onOpenEnquete : ouvre l'aperçu de l'acte cliqué (profil JLD). */
  onOpenActe?: (enquete: Enquete, acteId: number, kind: ActeKind) => void;
}

interface PendingActeItem {
  acteType: string;
  cible?: string;
  enquete: Enquete;
  acteId: number;
  acteKind: ActeKind;
  daysSince: number;       // jours écoulés depuis la mise en attente JLD
  daysToDeadline?: number; // jours restants avant échéance de l'acte (dateFin), si connue
  kind: 'autorisation' | 'prolongation';
}

/** Service d'enquête (tag de catégorie « services ») d'une enquête. */
function serviceOf(e: Enquete): string | undefined {
  return e.tags?.find(t => t.category === 'services')?.value;
}

export const PendingActsJLD = React.memo(({ enquetes, onOpenEnquete, onOpenActe }: PendingActsJLDProps) => {
  const pendingActes = useMemo(() => {
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;
    const items: PendingActeItem[] = [];

    // Jours restants avant l'échéance de l'acte (sa dateFin courante). Positif = il
    // reste du temps, négatif = échéance dépassée. undefined si dateFin inconnue.
    const deadlineDays = (dateFin?: string): number | undefined => {
      if (!dateFin) return undefined;
      const t = new Date(dateFin).getTime();
      if (isNaN(t)) return undefined;
      return Math.ceil((t - now) / dayMs);
    };

    for (const e of enquetes) {
      const mods = e.modifications;
      const pushAutorisation = (label: string, a: { id: number; dateDebut: string; dateFin?: string; autorisationRequestedAt?: string }, acteKind: ActeKind, cible?: string) =>
        items.push({ acteType: label, cible, enquete: e, acteId: a.id, acteKind, daysSince: Math.floor((now - new Date(getAutorisationRequestDate(a)).getTime()) / dayMs), daysToDeadline: deadlineDays(a.dateFin), kind: 'autorisation' });
      const pushProlongation = (label: string, a: { id: number; dateDebut: string; dateFin?: string; prolongationRequestedAt?: string; prolongationDate?: string }, acteKind: ActeKind, cible?: string) =>
        items.push({ acteType: label, cible, enquete: e, acteId: a.id, acteKind, daysSince: Math.floor((now - new Date(getProlongationRequestDate(a, mods)).getTime()) / dayMs), daysToDeadline: deadlineDays(a.dateFin), kind: 'prolongation' });

      for (const a of e.actes || []) {
        if (a.statut === 'autorisation_pending') pushAutorisation(a.type || 'Acte', a, 'acte');
        else if (a.statut === 'prolongation_pending') pushProlongation(a.type || 'Acte', a, 'acte');
      }
      for (const a of e.ecoutes || []) {
        if (a.statut === 'autorisation_pending') pushAutorisation(`Écoute ${a.numero}`, a, 'ecoute', a.cible);
        else if (a.statut === 'prolongation_pending') pushProlongation(`Écoute ${a.numero}`, a, 'ecoute', a.cible);
      }
      for (const a of e.geolocalisations || []) {
        if (a.statut === 'autorisation_pending') pushAutorisation(`Géoloc ${a.objet}`, a, 'geoloc');
        else if (a.statut === 'prolongation_pending') pushProlongation(`Géoloc ${a.objet}`, a, 'geoloc');
      }
    }
    return items;
  }, [enquetes]);

  const totalCount = pendingActes.length;
  const autorisations = pendingActes.filter(i => i.kind === 'autorisation');
  const prolongations = pendingActes.filter(i => i.kind === 'prolongation');

  const renderItem = (item: PendingActeItem, idx: number) => (
    <li
      key={`${item.enquete.id}-${item.acteKind}-${item.acteId}`}
      className={`flex items-start gap-1.5 py-1 group min-w-0 ${(onOpenActe || onOpenEnquete) ? 'cursor-pointer hover:text-purple-800' : ''}`}
      onClick={() => onOpenActe ? onOpenActe(item.enquete, item.acteId, item.acteKind) : onOpenEnquete?.(item.enquete)}
      title={`${item.acteType} (${item.enquete.numero})${(onOpenActe || onOpenEnquete) ? (onOpenActe ? " — Voir l'acte" : " — Ouvrir l'enquête") : ''}`}
    >
      <span className="text-xs text-gray-700 leading-snug select-none flex-1 min-w-0 break-words [overflow-wrap:anywhere]">
        {item.acteType}
        {item.cible && <span className="text-gray-500"> · {item.cible}</span>}
        <span className="text-gray-400 ml-1 text-[10px]">
          ({item.enquete.numero})
        </span>
        {serviceOf(item.enquete) && (
          <span className="ml-1 inline-block text-[9px] font-semibold text-purple-700 bg-purple-100 rounded px-1 align-middle">
            {serviceOf(item.enquete)}
          </span>
        )}
      </span>
      <span className="flex flex-col items-end leading-tight whitespace-nowrap">
        <span
          className={`text-[10px] font-semibold ${
            item.daysSince >= 14 ? 'text-red-600' :
            item.daysSince >= 7 ? 'text-orange-600' :
            'text-purple-600'
          }`}
          title="Ancienneté de l'attente JLD (depuis la demande)"
        >
          {item.daysSince}j d'attente
        </span>
        {item.daysToDeadline !== undefined && (
          <span
            className={`text-[9px] font-medium ${
              item.daysToDeadline <= 0 ? 'text-red-600' :
              item.daysToDeadline <= 3 ? 'text-orange-600' :
              'text-gray-500'
            }`}
            title="Jours restants avant échéance de l'acte (date de fin courante)"
          >
            {item.daysToDeadline <= 0
              ? `échéance dépassée (${Math.abs(item.daysToDeadline)}j)`
              : `éch. dans ${item.daysToDeadline}j`}
          </span>
        )}
      </span>
    </li>
  );

  const renderColumn = (label: string, items: PendingActeItem[]) => (
    <div className="flex-1 min-w-0">
      <div className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide mb-1">
        {label}
        <span className="text-gray-400 ml-1">({items.length})</span>
      </div>
      <ul className="flex flex-col divide-y divide-purple-200/70">
        {items.length > 0
          ? items.map(renderItem)
          : <li className="text-[11px] text-gray-400 italic py-1">—</li>}
      </ul>
    </div>
  );

  return (
    <div className="bg-purple-50 border border-purple-300 rounded-lg px-4 py-2 shadow-sm">
      {/* En-tête */}
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="h-3.5 w-3.5 text-purple-600" />
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Attente JLD
        </span>
        {totalCount > 0 && (
          <span className="text-[10px] bg-purple-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
            {totalCount}
          </span>
        )}
      </div>

      {totalCount === 0 ? (
        <span className="text-[11px] text-gray-400 italic">Aucun acte en attente</span>
      ) : (
        <div className="flex gap-4">
          {renderColumn('Autorisations', autorisations)}
          <div className="border-l border-dashed border-purple-300" />
          {renderColumn('Prolongations', prolongations)}
        </div>
      )}
    </div>
  );
});
