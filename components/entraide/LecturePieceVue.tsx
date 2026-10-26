'use client';

// Fiche de lecture d'une pièce : synthèse des faits, ce qui est demandé, où,
// qui. Affichée à l'administrateur seul.

import React from 'react';
import { MapPin } from 'lucide-react';
import { MESURES } from '@/utils/entraide/logique';
import type { LecturePiece } from '@/utils/entraide/lecturePiece';

export const LecturePieceVue: React.FC<{ l: LecturePiece; compact?: boolean }> = ({ l, compact }) => (
  <div className={`space-y-2 text-[13px] ${compact ? '' : ''}`}>
    {l.synthese && <p className="text-gray-800 whitespace-pre-wrap">{l.synthese}</p>}
    {l.demande && <p><b className="text-gray-700">Demandé :</b> {l.demande}</p>}
    {(l.mesures.length > 0 || l.mesuresAutres.length > 0) && (
      <p className="text-xs text-gray-600">
        {[...l.mesures.map((id) => MESURES.find((m) => m.id === id)?.libelle || id), ...l.mesuresAutres].join(' · ')}
      </p>
    )}
    {l.lieux.length > 0 && (
      <ul className="space-y-0.5">
        {l.lieux.map((x, i) => (
          <li key={i} className="flex items-start gap-1.5"><MapPin className="h-3.5 w-3.5 mt-0.5 text-[#2B5746] flex-shrink-0" />
            <span><b>{x.ville}</b>{x.adresse ? ` — ${x.adresse}` : ''}{x.role ? <span className="text-gray-500"> ({x.role})</span> : null}</span>
          </li>
        ))}
      </ul>
    )}
    {l.personnes.length > 0 && (
      <ul className="text-xs text-gray-700 space-y-0.5">
        {l.personnes.map((p, i) => (
          <li key={i}><b>{p.nom}</b>{p.qualite ? ` · ${p.qualite}` : ''}{p.naissance ? ` · ${p.naissance}` : ''}{p.adresse ? ` · ${p.adresse}` : ''}</li>
        ))}
      </ul>
    )}
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
      {l.autorite.nom && <span>{l.autorite.nom}{l.autorite.ville ? `, ${l.autorite.ville}` : ''}</span>}
      {l.autorite.reference && <span>Réf. {l.autorite.reference}</span>}
      {l.infractions && <span>{l.infractions}</span>}
      {l.dateFaits && <span>Faits : {l.dateFaits}</span>}
      {l.urgence && <span className="text-red-700">Urgence : {l.urgence}</span>}
    </div>
    {l.vigilance.length > 0 && (
      <ul className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900 list-disc list-inside">
        {l.vigilance.map((v, i) => <li key={i}>{v}</li>)}
      </ul>
    )}
    <p className="text-[10px] text-gray-400">{l.piece}{l.source === 'ocr' || l.source === 'texte+ocr' ? ' · scan' : ''}</p>
  </div>
);
