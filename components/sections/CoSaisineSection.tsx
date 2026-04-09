import React from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Enquete } from '@/types/interfaces';
import { ContentieuxDefinition } from '@/types/userTypes';
import { Link2, X } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

interface CoSaisineSectionProps {
  enquete: Enquete;
  isEditing: boolean;
  currentContentieuxId: string;
  onShare: (enqueteId: number, targetContentieuxIds: string[]) => void;
  onUnshare: (enqueteId: number) => void;
  /** Si true, l'enquête vient d'un autre contentieux (lecture seule pour la co-saisine) */
  isShared?: boolean;
}

// Couleurs par contentieux
const CTX_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  crimorg: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' },
  ecofi:   { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', dot: 'bg-blue-500' },
  enviro:  { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300', dot: 'bg-green-500' },
};

const DEFAULT_CTX_COLOR = { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-300', dot: 'bg-gray-500' };

export const CoSaisineSection = React.memo(({
  enquete,
  isEditing,
  currentContentieuxId,
  onShare,
  onUnshare,
  isShared = false,
}: CoSaisineSectionProps) => {
  const { accessibleContentieux } = useUser();

  // Contentieux disponibles pour le partage (exclure le contentieux courant)
  const availableContentieux = accessibleContentieux.filter(
    c => c.id !== currentContentieuxId
  );

  const sharedWith = enquete.sharedWith || [];
  const hasSharing = sharedWith.length > 0;

  // En mode lecture seule (enquête reçue d'un autre contentieux), juste afficher l'info
  if (isShared) {
    const originId = enquete.contentieuxOrigine || '';
    const originDef = accessibleContentieux.find(c => c.id === originId);
    const colors = CTX_COLORS[originId] || DEFAULT_CTX_COLOR;
    return (
      <div className={`p-3 rounded-lg border ${colors.border} ${colors.bg}`}>
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-purple-600" />
          <span className="text-sm font-semibold">Co-saisine</span>
          <Badge variant="outline" className={`text-xs ${colors.bg} ${colors.text} ${colors.border}`}>
            Origine : {originDef?.label || originId}
          </Badge>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Cette enquête est partagée depuis {originDef?.label || originId}. Vous pouvez consulter et ajouter des CR.
        </p>
      </div>
    );
  }

  // Pas de partage et pas en édition → ne rien afficher si pas pertinent
  if (!hasSharing && !isEditing) return null;

  const toggleContentieux = (ctxId: string) => {
    const newShared = sharedWith.includes(ctxId)
      ? sharedWith.filter(id => id !== ctxId)
      : [...sharedWith, ctxId];

    if (newShared.length === 0) {
      onUnshare(enquete.id);
    } else {
      onShare(enquete.id, newShared);
    }
  };

  return (
    <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="h-4 w-4 text-purple-600" />
        <span className="text-sm font-semibold text-purple-800">Co-saisine</span>
        {hasSharing && !isEditing && (
          <span className="text-xs text-purple-600">
            Partagée avec {sharedWith.length} contentieux
          </span>
        )}
      </div>

      {/* Affichage des contentieux partagés */}
      {hasSharing && !isEditing && (
        <div className="flex flex-wrap gap-1.5">
          {sharedWith.map(ctxId => {
            const def = accessibleContentieux.find(c => c.id === ctxId);
            const colors = CTX_COLORS[ctxId] || DEFAULT_CTX_COLOR;
            return (
              <Badge
                key={ctxId}
                variant="outline"
                className={`text-xs ${colors.bg} ${colors.text} ${colors.border}`}
              >
                <div className={`h-2 w-2 rounded-full ${colors.dot} mr-1`} />
                {def?.label || ctxId}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Mode édition : sélection des contentieux */}
      {isEditing && (
        <div className="space-y-2">
          <p className="text-xs text-purple-600">
            Sélectionnez les contentieux avec lesquels partager cette enquête :
          </p>
          <div className="flex flex-wrap gap-2">
            {availableContentieux.map(ctx => {
              const isActive = sharedWith.includes(ctx.id);
              const colors = CTX_COLORS[ctx.id] || DEFAULT_CTX_COLOR;
              return (
                <Button
                  key={ctx.id}
                  variant="outline"
                  size="sm"
                  className={`text-xs h-7 gap-1.5 transition-all ${
                    isActive
                      ? `${colors.bg} ${colors.text} ${colors.border} ring-2 ring-purple-300`
                      : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => toggleContentieux(ctx.id)}
                >
                  <div className={`h-2 w-2 rounded-full ${isActive ? colors.dot : 'bg-gray-300'}`} />
                  {ctx.label}
                  {isActive && <X className="h-3 w-3 ml-1" />}
                </Button>
              );
            })}
          </div>
          {availableContentieux.length === 0 && (
            <p className="text-xs text-gray-400 italic">
              Aucun autre contentieux accessible pour le partage.
            </p>
          )}
        </div>
      )}
    </div>
  );
});
