'use client';

/**
 * SIRAL — veille de recoupements · signal discret dans un dossier.
 *
 * Une ligne, repliée, au-dessus du dossier. Elle ne s'ouvre pas toute seule,
 * n'interrompt rien et ne demande rien : elle dit qu'il y a quelque chose à
 * regarder, et attend. Rien à signaler = rien à l'écran.
 *
 * Le déplier vaut « j'ai vu » : la mention « nouveau » s'éteint et ne revient
 * que si un dossier de plus rejoint la coïncidence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye } from 'lucide-react';
import type { Recoupement } from '@/types/recoupementTypes';
import { RecoupementList } from './RecoupementList';

export interface RecoupementHintProps {
  /** Signaux touchant CE dossier. */
  signaux: Recoupement[];
  /** Ceux que l'utilisateur n'a jamais vus (allument la mention « nouveau »). */
  nouveaux?: Recoupement[];
  /** Clé de corpus du dossier affiché. */
  dossierCourant: string;
  estNouveau?: (signal: Recoupement) => boolean;
  onOuvrirDossier?: (signal: Recoupement, dossierKey: string) => void;
  onEcarter?: (signal: Recoupement) => void;
  /** Appelé au dépliage, pour marquer les signaux comme vus. */
  onVus?: (signaux: Recoupement[]) => void;
}

export function RecoupementHint({
  signaux,
  nouveaux = [],
  dossierCourant,
  estNouveau,
  onOuvrirDossier,
  onEcarter,
  onVus,
}: RecoupementHintProps) {
  const [ouvert, setOuvert] = useState(false);
  // Les signaux vus au dépliage : mémorisés une fois, pour ne pas re-notifier
  // à chaque rendu.
  const vusRef = useRef(false);

  useEffect(() => { vusRef.current = false; setOuvert(false); }, [dossierCourant]);

  const basculer = useCallback(() => {
    setOuvert(prev => {
      const suite = !prev;
      if (suite && !vusRef.current) {
        vusRef.current = true;
        onVus?.(signaux);
      }
      return suite;
    });
  }, [onVus, signaux]);

  if (signaux.length === 0) return null;

  const nb = signaux.length;
  const nbNeufs = nouveaux.length;

  return (
    <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/40">
      <button
        type="button"
        onClick={basculer}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        title="Valeurs de ce dossier retrouvées ailleurs — rien n'est modifié"
      >
        <Eye className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
        <span className="text-xs font-bold text-gray-800">
          {nb} recoupement{nb > 1 ? 's' : ''} avec d&apos;autres dossiers
        </span>
        {nbNeufs > 0 && (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9.5px] font-bold text-white">
            {nbNeufs} nouveau{nbNeufs > 1 ? 'x' : ''}
          </span>
        )}
        <span className="hidden text-[10.5px] text-gray-400 sm:inline">
          simple signalement — rien n&apos;a été modifié
        </span>
        <span className="ml-auto text-gray-400">
          {ouvert ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {ouvert && (
        <RecoupementList
          signaux={signaux}
          dossierCourant={dossierCourant}
          estNouveau={estNouveau}
          onOuvrirDossier={onOuvrirDossier}
          onEcarter={onEcarter}
          deplierPremier
        />
      )}
    </div>
  );
}
