'use client';

/**
 * SIRAL — veille de recoupements · vue d'ensemble.
 *
 * Tout ce que la veille a relevé, tous dossiers confondus, le plus solide
 * d'abord. On y arrive par la loupe de l'en-tête ; rien ne s'ouvre tout seul.
 *
 * Le bouton « Analyser les pièces » est le SEUL moment où la veille lit des
 * documents jamais ouverts (téléchargement + déchiffrement local) : c'est un
 * geste explicite, jamais une initiative de l'application.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { FileSearch, Loader2 } from 'lucide-react';
import type { Recoupement } from '@/types/recoupementTypes';
import type { DocScanState } from '@/hooks/useRecoupements';
import { RecoupementList } from './RecoupementList';

export interface RecoupementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  signaux: Recoupement[];
  ecartes: Recoupement[];
  estNouveau: (signal: Recoupement) => boolean;
  computing: boolean;
  docScan: DocScanState;
  onAnalyserPieces: () => void;
  onOuvrirDossier?: (signal: Recoupement, dossierKey: string) => void;
  onEcarter: (signal: Recoupement) => void;
  onReactiver: (signal: Recoupement) => void;
  /** Marque comme vus les signaux affichés (appelé à l'ouverture). */
  onVus?: (signaux: Recoupement[]) => void;
}

export function RecoupementsModal({
  isOpen,
  onClose,
  signaux,
  ecartes,
  estNouveau,
  computing,
  docScan,
  onAnalyserPieces,
  onOuvrirDossier,
  onEcarter,
  onReactiver,
  onVus,
}: RecoupementsModalProps) {
  const [onglet, setOnglet] = useState<'actifs' | 'ecartes'>('actifs');

  const nbNeufs = useMemo(() => signaux.filter(estNouveau).length, [signaux, estNouveau]);

  const fermer = () => {
    onVus?.(signaux);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) fermer(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] bg-white overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-base">Recoupements entre dossiers</DialogTitle>
        </DialogHeader>

        <p className="flex-shrink-0 text-[11.5px] leading-snug text-gray-500">
          Valeurs identiques ou très proches relevées dans plusieurs dossiers — noms,
          adresses, lignes, véhicules, comptes. Rien n&apos;est modifié nulle part :
          c&apos;est un signalement, à vérifier avant d&apos;en tirer quoi que ce soit.
        </p>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 pb-2">
          <button
            type="button"
            onClick={() => setOnglet('actifs')}
            className={`rounded-md px-2 py-1 text-xs font-semibold ${
              onglet === 'actifs' ? 'bg-amber-100 text-amber-800' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            À regarder ({signaux.length}{nbNeufs > 0 ? ` · ${nbNeufs} nouveaux` : ''})
          </button>
          <button
            type="button"
            onClick={() => setOnglet('ecartes')}
            className={`rounded-md px-2 py-1 text-xs font-semibold ${
              onglet === 'ecartes' ? 'bg-gray-200 text-gray-700' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            Écartés ({ecartes.length})
          </button>

          <div className="ml-auto flex items-center gap-2">
            {computing && (
              <span className="flex items-center gap-1 text-[11px] text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" /> analyse…
              </span>
            )}
            {docScan.scanning ? (
              <span className="flex items-center gap-1 text-[11px] text-gray-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                lecture des pièces {docScan.done}/{docScan.total}
              </span>
            ) : docScan.pending > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={onAnalyserPieces}
                title="Extrait le texte des pièces jamais lues (déchiffrement local, une seule fois)"
              >
                <FileSearch className="h-3.5 w-3.5" />
                Analyser {docScan.pending} pièce{docScan.pending > 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {onglet === 'actifs' ? (
            signaux.length > 0 ? (
              <RecoupementList
                signaux={signaux}
                estNouveau={estNouveau}
                onOuvrirDossier={onOuvrirDossier}
                onEcarter={onEcarter}
              />
            ) : (
              <p className="px-3 py-6 text-center text-xs text-gray-400">
                {computing
                  ? 'Analyse en cours…'
                  : docScan.pending > 0
                    ? 'Rien pour l’instant sur ce qui a été lu. Les pièces jamais analysées ne sont pas encore couvertes.'
                    : 'Aucun recoupement relevé.'}
              </p>
            )
          ) : ecartes.length > 0 ? (
            <RecoupementList signaux={ecartes} onReactiver={onReactiver} />
          ) : (
            <p className="px-3 py-6 text-center text-xs text-gray-400">Aucun signal écarté.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
