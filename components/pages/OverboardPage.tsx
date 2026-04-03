'use client';

import React, { useMemo } from 'react';
import { Target, Pin, Calendar, Gavel, Link2, User, Phone, Car } from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { ContentieuxId, ContentieuxDefinition } from '@/types/userTypes';
import { ResultatAudience } from '@/types/audienceTypes';
import { useAudience } from '@/contexts/AudienceContext';
import { findCrossMatches, groupMatches, CrossMatch } from '@/utils/crossContentieuxMatcher';
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

  // Audiences : récupérer le contexte
  const { audienceState } = useAudience();

  // Audiences en attente par contentieux
  const pendingAudiencesByCtx = useMemo(() => {
    const allResultats = audienceState?.resultats || {};
    const result = new Map<ContentieuxId, { enquete: Enquete; resultat: ResultatAudience }[]>();

    for (const [cId, enquetes] of enquetesByContentieux) {
      const enqueteIdSet = new Set(enquetes.map(e => e.id));
      const pending: { enquete: Enquete; resultat: ResultatAudience }[] = [];

      for (const [key, resultat] of Object.entries(allResultats)) {
        // Soit l'audience est marquée pending, soit elle a des condamnations pending
        const isPending = resultat.isAudiencePending ||
          resultat.hasPartialResults ||
          resultat.pendingCondamnations?.length > 0 ||
          resultat.condamnations?.some(c => c.isPending);

        if (!isPending) continue;

        const eId = Number(key);
        if (!enqueteIdSet.has(eId)) continue;

        const enquete = enquetes.find(e => e.id === eId);
        if (enquete) {
          pending.push({ enquete, resultat });
        }
      }

      // Trier par date d'audience
      pending.sort((a, b) => {
        const dateA = a.resultat.dateAudience || '';
        const dateB = b.resultat.dateAudience || '';
        return dateA.localeCompare(dateB);
      });

      if (pending.length > 0) {
        result.set(cId, pending);
      }
    }

    return result;
  }, [enquetesByContentieux, audienceState]);

  const totalPending = useMemo(() => {
    let count = 0;
    for (const items of pendingAudiencesByCtx.values()) count += items.length;
    return count;
  }, [pendingAudiencesByCtx]);

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

  // Cross-contentieux : détection d'informations communes
  const crossMatches = useMemo(() => findCrossMatches(enquetesByContentieux), [enquetesByContentieux]);
  const crossGroups = useMemo(() => groupMatches(crossMatches), [crossMatches]);

  const MATCH_ICONS: Record<string, React.ElementType> = { nom: User, telephone: Phone, immatriculation: Car };

  const getCtxLabel = (ctxId: ContentieuxId) => contentieuxDefs.find(d => d.id === ctxId)?.label || ctxId;

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

      {/* Section 2 : Audiences en attente par contentieux */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Gavel className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">
            Audiences en attente de résultat
          </h2>
          {totalPending > 0 && (
            <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {totalPending} audience{totalPending > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {totalPending === 0 ? (
          <p className="text-sm text-gray-400 italic">Aucune audience en attente</p>
        ) : (
          <div className="space-y-3">
            {contentieuxDefs
              .sort((a, b) => a.order - b.order)
              .map(ctxDef => {
                const items = pendingAudiencesByCtx.get(ctxDef.id);
                if (!items || items.length === 0) return null;

                const colors = CTX_COLORS[ctxDef.id] || DEFAULT_CTX_COLOR;

                return (
                  <div key={`aud_${ctxDef.id}`}>
                    {/* Header contentieux */}
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-t-lg ${colors.bg} border ${colors.border} border-b-0`}>
                      <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
                      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                        {ctxDef.label}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {items.length} en attente
                      </span>
                    </div>

                    {/* Liste des audiences */}
                    <div className={`border ${colors.border} border-t-0 rounded-b-lg overflow-hidden`}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500">
                            <th className="text-left px-3 py-1.5 font-medium">Enquête</th>
                            <th className="text-left px-3 py-1.5 font-medium">Date audience</th>
                            <th className="text-left px-3 py-1.5 font-medium">Personnes en attente</th>
                            <th className="text-left px-3 py-1.5 font-medium">Statut</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(({ enquete, resultat }) => {
                            const pendingNames = [
                              ...(resultat.pendingCondamnations?.map(p => p.nom) || []),
                              ...(resultat.condamnations?.filter(c => c.isPending).map(c => c.nom || '?') || []),
                            ];
                            const uniqueNames = [...new Set(pendingNames)];

                            return (
                              <tr
                                key={enquete.id}
                                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                                onClick={() => onEnqueteClick?.(enquete, ctxDef.id)}
                              >
                                <td className="px-3 py-2">
                                  <span className="font-medium text-gray-800">{enquete.numero}</span>
                                  {enquete.description && (
                                    <span className="text-xs text-gray-400 ml-2 truncate">{enquete.description}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-600">
                                  {resultat.dateAudience
                                    ? new Date(resultat.dateAudience).toLocaleDateString('fr-FR')
                                    : '—'}
                                </td>
                                <td className="px-3 py-2">
                                  {uniqueNames.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {uniqueNames.slice(0, 3).map((name, i) => (
                                        <span key={i} className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                                          {name}
                                        </span>
                                      ))}
                                      {uniqueNames.length > 3 && (
                                        <span className="text-xs text-gray-400">+{uniqueNames.length - 3}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                    En attente
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Section 3 : Enquêtes marquées */}
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
      {/* Section 4 : Croisement inter-contentieux */}
      {crossMatches.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-purple-200 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Link2 className="h-4 w-4 text-purple-600" />
            <h2 className="text-sm font-semibold text-purple-800">
              Informations communes entre contentieux
            </h2>
            <span className="ml-auto text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
              {crossMatches.length} correspondance{crossMatches.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="space-y-4">
            {crossGroups.map(group => {
              const Icon = MATCH_ICONS[group.type] || Link2;

              return (
                <div key={group.type}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="h-3.5 w-3.5 text-purple-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-600">
                      {group.label}
                    </span>
                    <span className="text-xs text-gray-400">
                      ({group.matches.length})
                    </span>
                  </div>

                  <div className="space-y-2">
                    {group.matches.map((match, idx) => {
                      const colorsA = CTX_COLORS[match.enqueteA.contentieuxId] || DEFAULT_CTX_COLOR;
                      const colorsB = CTX_COLORS[match.enqueteB.contentieuxId] || DEFAULT_CTX_COLOR;
                      const pct = Math.round(match.similarity * 100);

                      return (
                        <div
                          key={`${group.type}_${idx}`}
                          className="flex items-center gap-3 p-3 bg-purple-50/50 border border-purple-100 rounded-lg"
                        >
                          {/* Dossier A */}
                          <div
                            className="flex items-center gap-1.5 cursor-pointer hover:underline"
                            onClick={() => onEnqueteClick?.(
                              { id: match.enqueteA.id, numero: match.enqueteA.numero } as Enquete,
                              match.enqueteA.contentieuxId
                            )}
                          >
                            <div className={`w-2 h-2 rounded-full ${colorsA.dot}`} />
                            <span className="text-xs font-medium text-gray-800">{match.enqueteA.numero}</span>
                            <span className={`text-[10px] ${colorsA.text}`}>
                              ({getCtxLabel(match.enqueteA.contentieuxId)})
                            </span>
                          </div>

                          {/* Valeur + similarité */}
                          <div className="flex-1 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-xs font-mono text-gray-600">
                                &quot;{match.originalValues[0]}&quot;
                              </span>
                              <span className="text-[10px] text-gray-400">≈</span>
                              <span className="text-xs font-mono text-gray-600">
                                &quot;{match.originalValues[1]}&quot;
                              </span>
                            </div>
                            <div className="flex items-center justify-center gap-1 mt-1">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    pct >= 95 ? 'bg-green-500' : pct >= 85 ? 'bg-yellow-500' : 'bg-orange-500'
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className={`text-[10px] font-bold ${
                                pct >= 95 ? 'text-green-600' : pct >= 85 ? 'text-yellow-600' : 'text-orange-600'
                              }`}>
                                {pct}%
                              </span>
                            </div>
                          </div>

                          {/* Dossier B */}
                          <div
                            className="flex items-center gap-1.5 cursor-pointer hover:underline"
                            onClick={() => onEnqueteClick?.(
                              { id: match.enqueteB.id, numero: match.enqueteB.numero } as Enquete,
                              match.enqueteB.contentieuxId
                            )}
                          >
                            <div className={`w-2 h-2 rounded-full ${colorsB.dot}`} />
                            <span className="text-xs font-medium text-gray-800">{match.enqueteB.numero}</span>
                            <span className={`text-[10px] ${colorsB.text}`}>
                              ({getCtxLabel(match.enqueteB.contentieuxId)})
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
