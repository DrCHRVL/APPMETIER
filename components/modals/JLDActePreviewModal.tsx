'use client';

/**
 * JLDActePreviewModal — aperçu d'acte « forgé » pour le profil JLD.
 *
 * Le JLD n'a pas accès au détail des enquêtes : quand il clique sur un acte
 * depuis le tableau de bord (file « Attente JLD », « Pose en attente » ou
 * « Échéances d'actes »), on lui présente UNIQUEMENT le petit encadré qui
 * décrit cet acte — celui que l'on retrouve dans les sections Géoloc / Écoute
 * / Acte de la fiche enquête, mais en lecture seule (aucune action possible).
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { Enquete } from '@/types/interfaces';
import ProgressBar from '../ProgressBar';
import { Badge } from '@/components/ui/badge';
import { getStatutBadgeProps } from '@/utils/acteUtils';
import { DateUtils } from '@/utils/dateUtils';
import { AUTRE_ACTE_TYPES, AutreActeTypeKey } from '@/config/acteTypes';

export type JLDActeKind = 'acte' | 'ecoute' | 'geoloc';

export interface JLDActeRef {
  enquete: Enquete;
  acteId: number;
  kind: JLDActeKind;
}

interface JLDActePreviewModalProps {
  acteRef: JLDActeRef | null;
  onClose: () => void;
}

/** Service d'enquête (tag de catégorie « services ») d'une enquête. */
function serviceOf(e: Enquete): string | undefined {
  return e.tags?.find(t => t.category === 'services')?.value;
}

export const JLDActePreviewModal = ({ acteRef, onClose }: JLDActePreviewModalProps) => {
  const [historyOpen, setHistoryOpen] = useState(false);
  useEscapeKey(onClose, !!acteRef);

  if (!acteRef) return null;

  const { enquete, acteId, kind } = acteRef;
  const list =
    kind === 'acte' ? enquete.actes :
    kind === 'ecoute' ? enquete.ecoutes :
    enquete.geolocalisations;
  const acte = list?.find(a => a.id === acteId);

  // En-tête : titre/cible de l'acte selon son type.
  let titre = 'Acte';
  let cible: string | undefined;
  if (acte) {
    if (kind === 'geoloc') {
      titre = (acte as any).objet || 'Géolocalisation';
    } else if (kind === 'ecoute') {
      titre = (acte as any).numero || 'Écoute';
      cible = (acte as any).cible;
    } else {
      const typeKey = (acte as any).type as AutreActeTypeKey;
      titre = AUTRE_ACTE_TYPES[typeKey]?.label ?? (acte as any).type ?? 'Acte';
    }
  }

  const statutBadge = acte ? getStatutBadgeProps(acte.statut) : null;
  const hasHistory = !!acte?.prolongationsHistory && acte.prolongationsHistory.length > 0;
  const service = serviceOf(enquete);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* En-tête modal — contexte minimal du dossier */}
        <div className="flex items-start justify-between px-5 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">
              Aperçu acte — JLD
            </div>
            <div className="mt-0.5 text-sm font-bold text-gray-900 truncate">
              {enquete.numero || `Enquête ${enquete.id}`}
              {service && (
                <span className="ml-1.5 align-middle inline-block text-[9px] font-semibold text-teal-700 bg-teal-100 rounded px-1">
                  {service}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex-shrink-0"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corps : le seul encadré de l'acte (lecture seule) */}
        <div className="p-5">
          {!acte ? (
            <div className="text-sm text-gray-500 italic py-6 text-center">
              Cet acte n'est plus disponible.
            </div>
          ) : (
            <div className="bg-gray-50 p-3 rounded">
              <div className="flex justify-between items-center mb-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium">{titre}</span>
                    {cible && <span className="text-sm text-gray-500">({cible})</span>}
                    {statutBadge && (
                      <Badge className={`text-xs px-1.5 py-0 border ${statutBadge.className}`}>
                        {statutBadge.label}
                      </Badge>
                    )}
                  </div>
                  {(acte as any).description && (
                    <p className="text-sm text-gray-600 mt-1">{(acte as any).description}</p>
                  )}
                </div>
              </div>

              <ProgressBar
                dateDebut={acte.dateDebut}
                dateFin={acte.dateFin}
                datePose={acte.datePose}
              />

              <div className="mt-1 text-xs text-gray-600">
                {acte.statut === 'autorisation_pending' && (
                  <p>En attente d'autorisation JLD • Durée prévue: {acte.duree || 0} jours</p>
                )}
              </div>

              {hasHistory && (
                <div className="mt-2">
                  <div
                    className="flex items-center text-xs text-blue-600 cursor-pointer"
                    onClick={() => setHistoryOpen(o => !o)}
                  >
                    <span>
                      {historyOpen
                        ? "Masquer l'historique des prolongations"
                        : `Voir l'historique des prolongations (${acte.prolongationsHistory!.length})`}
                    </span>
                  </div>
                  {historyOpen && (
                    <div className="mt-1 pl-2 border-l-2 border-blue-200">
                      {acte.prolongationsHistory!.map((entry, index) => (
                        <div key={index} className="text-xs text-gray-600 mb-1">
                          <span className="font-medium">Prolongation {index + 1}: </span>
                          <span>{DateUtils.formatDate(entry.date)}</span>
                          <span className="mx-1">•</span>
                          <span>{entry.dureeAjoutee} {entry.dureeUnit === 'mois' ? 'mois' : 'jours'}</span>
                          <span className="mx-1">•</span>
                          <span>Durée précédente: {entry.dureeInitiale} {(entry.dureeInitialeUnit || 'jours') === 'mois' ? 'mois' : 'jours'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {acte.prolongationDate && !hasHistory && (
                <p className="text-xs text-gray-600 mt-2">
                  Prolongation: {DateUtils.formatDate(acte.prolongationDate)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
