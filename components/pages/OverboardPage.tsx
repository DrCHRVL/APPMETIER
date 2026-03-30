'use client';

import React, { useMemo } from 'react';
import { Target, Pin, Calendar } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { OPTimeline } from '../OPTimeline';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

interface OverboardPageProps {
  /** Enquêtes par contentieux (toutes celles accessibles) */
  enquetesByContentieux: Map<ContentieuxId, Enquete[]>;
  /** Définitions des contentieux pour labels/couleurs */
  contentieuxDefs: ContentieuxDefinition[];
  /** Callback quand on clique sur une enquête */
  onEnqueteClick?: (enquete: Enquete, contentieuxId: ContentieuxId) => void;
  /** Rendu d'une carte enquête (réutilise EnquetePreview) */
  renderEnqueteCard?: (enquete: Enquete, contentieuxId: ContentieuxId) => React.ReactNode;
}

// Couleurs par contentieux (Tailwind safe)
const CTX_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  crimorg: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
  ecofi:   { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500' },
  enviro:  { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', dot: 'bg-green-500' },
};

const DEFAULT_CTX_COLOR = { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', dot: 'bg-gray-500' };

// ──────────────────────────────────────────────
// COMPOSANT
// ──────────────────────────────────────────────

export const OverboardPage = ({
  enquetesByContentieux,
  contentieuxDefs,
  onEnqueteClick,
  renderEnqueteCard,
}: OverboardPageProps) => {
  // Toutes les enquêtes en cours (pour la timeline OP)
  const allEnquetes = useMemo(() => {
    const all: Enquete[] = [];
    for (const enquetes of enquetesByContentieux.values()) {
      all.push(...enquetes.filter(e => e.statut === 'en_cours'));
    }
    return all;
  }, [enquetesByContentieux]);

  // Enquêtes marquées (pinned), groupées par contentieux
  const pinnedByContentieux = useMemo(() => {
    const result = new Map<ContentieuxId, Enquete[]>();
    for (const [cId, enquetes] of enquetesByContentieux) {
      const pinned = enquetes.filter(e => e.overboardPins && e.overboardPins.length > 0);
      if (pinned.length > 0) {
        result.set(cId, pinned);
      }
    }
    return result;
  }, [enquetesByContentieux]);

  const totalPinned = useMemo(() => {
    let count = 0;
    for (const enquetes of pinnedByContentieux.values()) {
      count += enquetes.length;
    }
    return count;
  }, [pinnedByContentieux]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Target className="h-6 w-6 text-gray-600" />
        <h1 className="text-xl font-bold text-gray-800">Overboard</h1>
        <span className="text-sm text-gray-500">Vue transversale</span>
      </div>

      {/* Section 1 : OP à venir (tous contentieux) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">
            Opérations à venir — tous contentieux
          </h2>
        </div>
        {allEnquetes.length > 0 ? (
          <OPTimeline enquetes={allEnquetes} />
        ) : (
          <p className="text-sm text-gray-400 italic">Aucune OP programmée</p>
        )}
      </div>

      {/* Section 2 : Enquêtes marquées */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Pin className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">
            Enquêtes suivies
          </h2>
          {totalPinned > 0 && (
            <span className="ml-auto text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {totalPinned} enquête{totalPinned > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {totalPinned === 0 ? (
          <p className="text-sm text-gray-400 italic">
            Aucune enquête épinglée. Utilisez l'icône de marquage dans le détail d'une enquête.
          </p>
        ) : (
          <div className="space-y-4">
            {contentieuxDefs
              .sort((a, b) => a.order - b.order)
              .map(ctxDef => {
                const pinned = pinnedByContentieux.get(ctxDef.id);
                if (!pinned || pinned.length === 0) return null;

                const colors = CTX_COLORS[ctxDef.id] || DEFAULT_CTX_COLOR;

                return (
                  <div key={ctxDef.id}>
                    {/* Header contentieux */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg ${colors.bg} border ${colors.border} border-b-0`}>
                      <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                        {ctxDef.label}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {pinned.length} enquête{pinned.length > 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Grille d'enquêtes */}
                    <div className={`border ${colors.border} border-t-0 rounded-b-lg p-3`}>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {pinned.map(enquete => (
                          <div key={enquete.id} className="relative">
                            {renderEnqueteCard ? (
                              renderEnqueteCard(enquete, ctxDef.id)
                            ) : (
                              // Fallback simple si pas de renderer custom
                              <div
                                className="bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
                                onClick={() => onEnqueteClick?.(enquete, ctxDef.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                                  <span className="font-medium text-sm text-gray-800">{enquete.numero}</span>
                                </div>
                                {enquete.description && (
                                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{enquete.description}</p>
                                )}
                                {/* Badges des épingleurs */}
                                <div className="flex gap-1 mt-2">
                                  {enquete.overboardPins?.map(pin => (
                                    <span
                                      key={pin.pinnedBy}
                                      className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded"
                                    >
                                      {pin.role.toUpperCase()}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};
