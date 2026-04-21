import React, { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { ConfirmationDialog } from '../ui/confirmation-dialog';
import { Enquete } from '@/types/interfaces';
import { ArrowRightLeft } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';
import { ContentieuxManager } from '@/utils/contentieuxManager';
import { CTX_COLORS, DEFAULT_CTX_COLOR } from './contentieuxColors';

interface TransfertContentieuxSectionProps {
  enquete: Enquete;
  isEditing: boolean;
  currentContentieuxId: string;
  /** Si true, l'enquête vient d'un autre contentieux : transfert interdit (pas propriétaire) */
  isShared?: boolean;
  onTransfer: (enqueteId: number, targetContentieuxId: string) => Promise<boolean>;
}

export const TransfertContentieuxSection = React.memo(({
  enquete,
  isEditing,
  currentContentieuxId,
  isShared = false,
  onTransfer,
}: TransfertContentieuxSectionProps) => {
  const { accessibleContentieux } = useUser();
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  // Cibles possibles : contentieux accessibles, hors courant, en read_write
  const targets = useMemo(() => {
    const manager = ContentieuxManager.getInstance();
    return accessibleContentieux.filter(
      c => c.id !== currentContentieuxId && manager.getSyncMode(c.id) === 'read_write'
    );
  }, [accessibleContentieux, currentContentieuxId]);

  // Transfert indisponible pour une enquête reçue d'un autre contentieux
  // (le transfert doit partir du propriétaire)
  if (isShared) return null;
  if (!isEditing) return null;

  const pendingDef = pendingTarget
    ? accessibleContentieux.find(c => c.id === pendingTarget)
    : null;

  return (
    <>
      <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
        <div className="flex items-center gap-2 mb-2">
          <ArrowRightLeft className="h-4 w-4 text-amber-700" />
          <span className="text-sm font-semibold text-amber-800">Transférer vers un autre contentieux</span>
        </div>
        <p className="text-xs text-amber-700 mb-2">
          L'enquête quittera ce contentieux et sera déplacée (avec tous ses CR, actes, documents, todos, tags) vers la destination choisie.
        </p>
        {targets.length === 0 ? (
          <p className="text-xs text-gray-400 italic">
            Aucun contentieux cible disponible.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {targets.map(ctx => {
              const colors = CTX_COLORS[ctx.id] || DEFAULT_CTX_COLOR;
              return (
                <Button
                  key={ctx.id}
                  variant="outline"
                  size="sm"
                  className={`text-xs h-7 gap-1.5 bg-white text-gray-600 border-gray-300 hover:${colors.bg} hover:${colors.text} hover:${colors.border}`}
                  onClick={() => setPendingTarget(ctx.id)}
                >
                  <div className={`h-2 w-2 rounded-full ${colors.dot}`} />
                  {ctx.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmationDialog
        isOpen={pendingTarget !== null}
        onClose={() => setPendingTarget(null)}
        onConfirm={() => {
          if (pendingTarget) {
            onTransfer(enquete.id, pendingTarget);
          }
        }}
        title="Transférer l'enquête ?"
        message={`Transférer l'enquête N° ${enquete.numero} vers ${pendingDef?.label || pendingTarget} ? L'enquête disparaîtra du contentieux courant. Toutes les données (CR, actes, documents, todos, tags) seront conservées.`}
        confirmLabel="Transférer"
        variant="destructive"
      />
    </>
  );
});

TransfertContentieuxSection.displayName = 'TransfertContentieuxSection';
