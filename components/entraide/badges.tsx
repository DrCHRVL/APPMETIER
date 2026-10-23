'use client';

import React from 'react';
import { dateFr, TYPE_COURTS } from '@/utils/entraide/logique';
import type { EntraideEtat, EntraideType } from '@/types/entraideTypes';

const COULEURS_TYPE: Record<EntraideType, string> = {
  dee: 'bg-blue-50 text-blue-700',
  do: 'bg-violet-50 text-violet-700',
  cri: 'bg-teal-50 text-teal-700',
  execution: 'bg-amber-50 text-amber-800',
  civil: 'bg-gray-100 text-gray-700',
};

export const BadgeType: React.FC<{ type: EntraideType }> = ({ type }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${COULEURS_TYPE[type]}`}>{TYPE_COURTS[type]}</span>
);

/** Échéance en relatif et en couleur : « en retard de 12 j », « dans 9 j ». */
export const BadgeEcheance: React.FC<{ etat: EntraideEtat }> = ({ etat }) => {
  if (etat.niveau === 'cloturee') return <span className="inline-block rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Clôturée</span>;
  if (etat.joursRestants === null) {
    return etat.dormant
      ? <span className="inline-block rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700" title="Aucune échéance et rien depuis plus de 6 mois">Dormant</span>
      : <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">—</span>;
  }
  const j = etat.joursRestants;
  const legale = etat.echeancesLegales.some((l) => l.date === etat.prochaineDate && (l.statut === 'en_cours' || l.statut === 'depasse'));
  const style = j < 0 ? 'bg-red-50 text-red-700' : j <= 30 ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-700';
  const texte = j < 0 ? `retard ${-j} j` : j === 0 ? "aujourd'hui" : `dans ${j} j`;
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`} title={dateFr(etat.prochaineDate)}>
      {texte}{legale ? ' · légal' : ''}
    </span>
  );
};
