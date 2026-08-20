'use client';

/**
 * SIRAL — veille de recoupements · liste des signaux.
 *
 * Un signal = une valeur (personne, adresse, ligne, véhicule…) vue dans
 * plusieurs dossiers. La liste dit trois choses, et rien de plus :
 *   QUOI se recoupe · OÙ ça a été vu · et laisse le magistrat trancher.
 *
 * Aucune action n'écrit dans un dossier. « Écarter » ne fait que taire le
 * signal pour son auteur, tant que la situation ne change pas.
 */
import { useState } from 'react';
import {
  Building2, Car, ChevronDown, ChevronRight, CreditCard, EyeOff, Link2,
  Phone, Smartphone, User, Users, ExternalLink, RotateCcw,
} from 'lucide-react';
import type { Recoupement, RecoupementKind } from '@/types/recoupementTypes';
import { LIBELLE_KIND, LIBELLE_ORIGINE } from '@/utils/recoupements/engine';

const ICONE: Record<RecoupementKind, React.ElementType> = {
  personne: User,
  patronyme: Users,
  telephone: Phone,
  adresse: Building2,
  plaque: Car,
  compte: Link2,
  iban: CreditCard,
  imei: Smartphone,
};

export interface RecoupementListProps {
  signaux: Recoupement[];
  /** Dossier depuis lequel on regarde : il n'est pas proposé à l'ouverture. */
  dossierCourant?: string;
  estNouveau?: (signal: Recoupement) => boolean;
  onOuvrirDossier?: (signal: Recoupement, dossierKey: string) => void;
  onEcarter?: (signal: Recoupement) => void;
  onReactiver?: (signal: Recoupement) => void;
  /** Signal déplié à l'ouverture (le premier, dans le bandeau d'un dossier). */
  deplierPremier?: boolean;
}

export function RecoupementList({
  signaux,
  dossierCourant,
  estNouveau,
  onOuvrirDossier,
  onEcarter,
  onReactiver,
  deplierPremier = false,
}: RecoupementListProps) {
  const [ouvert, setOuvert] = useState<string | null>(
    deplierPremier && signaux.length > 0 ? signaux[0].id : null
  );

  if (signaux.length === 0) return null;

  return (
    <div className="divide-y divide-amber-100/70">
      {signaux.map(signal => {
        const Icon = ICONE[signal.kind] || Link2;
        const isOpen = ouvert === signal.id;
        const neuf = estNouveau?.(signal) ?? false;
        const autres = signal.dossierKeys.filter(k => k !== dossierCourant);

        return (
          <div key={signal.id} className="px-3 py-2">
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
              <button
                type="button"
                onClick={() => setOuvert(isOpen ? null : signal.id)}
                className="min-w-0 flex-1 text-left"
                title="Voir où cette valeur a été relevée"
              >
                <span className="text-[12.5px] font-medium text-gray-800">{signal.valeur}</span>
                <span className="ml-1.5 text-[10.5px] text-gray-500">
                  {LIBELLE_KIND[signal.kind].toLowerCase()}
                  {' · '}
                  {signal.dossierKeys.length} dossiers
                </span>
                {neuf && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                    nouveau
                  </span>
                )}
                {signal.pontInedit && (
                  <span
                    className="ml-1.5 rounded bg-sky-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700"
                    title="Ces dossiers ne partagent aucun mis en cause : le lien serait inédit"
                  >
                    inédit
                  </span>
                )}
                {isOpen
                  ? <ChevronDown className="ml-1 inline h-3 w-3 text-gray-400" />
                  : <ChevronRight className="ml-1 inline h-3 w-3 text-gray-400" />}
              </button>

              {onEcarter && (
                <button
                  type="button"
                  onClick={() => onEcarter(signal)}
                  title="Écarter — sans intérêt, ne plus me le remonter"
                  className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                </button>
              )}
              {onReactiver && (
                <button
                  type="button"
                  onClick={() => onReactiver(signal)}
                  title="Remettre ce signal en circulation"
                  className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="mt-1.5 space-y-1.5 pl-6">
                {signal.occurrences.map((occ, i) => (
                  <div key={`${occ.dossier.key}_${i}`} className="text-[11.5px] leading-snug">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-gray-700">{occ.dossier.numero}</span>
                      <span className="text-gray-400">
                        {LIBELLE_ORIGINE[occ.origine]}
                        {occ.detail ? ` · ${occ.detail}` : ''}
                      </span>
                      {occ.declaree && (
                        <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-500">
                          fiche
                        </span>
                      )}
                    </div>
                    {occ.extrait && (
                      <p className="mt-0.5 border-l-2 border-gray-200 pl-2 italic text-gray-500">
                        {occ.extrait}
                      </p>
                    )}
                  </div>
                ))}

                {onOuvrirDossier && autres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {autres.map(key => {
                      const ref = signal.occurrences.find(o => o.dossier.key === key)?.dossier;
                      if (!ref) return null;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onOuvrirDossier(signal, key)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ouvrir {ref.numero}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
