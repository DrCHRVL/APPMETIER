'use client';

/**
 * SIRAL — export Word d'un acte : choix de la papeterie.
 *
 * Cette fenêtre ne s'ouvre PAS à chaque export. Elle n'apparaît que la
 * première fois qu'un type d'acte se présente : dès que le magistrat a tranché,
 * la règle est retenue et les exports suivants partent d'un clic, sans appel au
 * modèle. C'est tout l'objet de l'aiguillage (`lib/web/papeterieRoutage.ts`) —
 * demander une fois, ne plus jamais redemander.
 *
 * Le hook `usePapeterieExport()` porte tout le parcours ; un composant appelant
 * n'a qu'à faire `await exporterWord(acte)` et à poser `{papeterieModal}` dans
 * son rendu.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { X, Loader2, Sparkles, AlertTriangle, FileText, Check } from 'lucide-react';
import type { ActeExportable } from '@/lib/web/acteExport';
import type { DecisionPapeterie } from '@/lib/web/papeterieRoutage';
import type { TrameForme } from '@/lib/web/trameFill';

const TYPE_LABELS: Record<string, string> = {
  courrier: 'Courrier',
  requete: 'Requête',
  'soit-transmis': 'Soit-transmis',
  defaut: 'Par défaut',
};

interface EnAttente {
  acte: ActeExportable;
  decision: DecisionPapeterie;
}

export function usePapeterieExport(opts: { onError?: (message: string) => void } = {}) {
  const { onError } = opts;
  const [pending, setPending] = useState<EnAttente | null>(null);
  const [choix, setChoix] = useState('');
  const [touche, setTouche] = useState(false);
  const [retenir, setRetenir] = useState(true);
  const [iaBusy, setIaBusy] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  /**
   * Point d'entrée unique de l'export Word. Trois issues :
   *  - décision déjà apprise et découpage franc → téléchargement immédiat ;
   *  - décision apprise mais découpage douteux → l'IA désigne les frontières,
   *    sans déranger le magistrat ;
   *  - décision non tranchée → cette fenêtre, l'IA proposant pendant ce temps.
   */
  const exporterWord = useCallback(async (acte: ActeExportable) => {
    const [{ decoupageHeuristique, downloadActeDocx }, routage] = await Promise.all([
      import('@/lib/web/acteExport'),
      import('@/lib/web/papeterieRoutage'),
    ]);
    const { regions, estCourrier, typeDeduit } = decoupageHeuristique(acte);
    const decision = await routage.preparerExport(acte, typeDeduit, regions, estCourrier);

    // Aucune papeterie enregistrée : gabarit intégré, il n'y a rien à choisir.
    if (!decision.papeteries.length) {
      await downloadActeDocx(acte, { trame: null });
      return;
    }

    if (decision.certain) {
      const affinee = decision.doutes.length ? await routage.affinerParIA(acte, decision) : decision;
      if (affinee.iaIndisponible && decision.doutes.length) {
        // Le renfort manque : on imprime quand même, avec le découpage
        // heuristique — un acte est toujours remis, jamais bloqué.
        onError?.(`Découpage assisté indisponible (${affinee.iaIndisponible}) — mise en forme automatique.`);
      }
      await downloadActeDocx(acte, { trame: decision.trame, regions: affinee.decoupage });
      return;
    }

    setPending({ acte, decision });
    setChoix(decision.trame?.id || '');
    setTouche(false);
    setRetenir(true);
    setIaBusy(true);
    const affinee = await routage.affinerParIA(acte, decision);
    setIaBusy(false);
    setPending((cur) => (cur && cur.acte === acte ? { acte, decision: affinee } : cur));
    // On ne bouscule pas un choix que le magistrat vient de faire à la main.
    setChoix((c) => (c && c !== decision.trame?.id ? c : affinee.trame?.id || c));
  }, [onError]);

  const fermer = useCallback(() => setPending(null), []);

  const confirmer = useCallback(async () => {
    if (!pending) return;
    const { acte, decision } = pending;
    const trame = decision.papeteries.find((p) => p.id === choix) || decision.trame;
    if (!trame) return;
    setEnvoi(true);
    try {
      const [{ downloadActeDocx }, routage] = await Promise.all([
        import('@/lib/web/acteExport'),
        import('@/lib/web/papeterieRoutage'),
      ]);
      await downloadActeDocx(acte, { trame, regions: decision.decoupage });
      const change = trame.id !== decision.trame?.id;
      if (retenir) {
        // Un choix REPRIS à la main fait autorité ; une proposition validée
        // d'un clic vaut moins et pourra être révisée par une décision explicite.
        await routage.retenirRegle(acte, trame.id, change ? 'magistrat' : 'ia', decision.motif);
      }
      // Le magistrat a écarté la proposition : c'est le signal le plus utile
      // qui soit pour l'attaché — on le consigne au journal d'apprentissage.
      if (change) await routage.signalerCorrection(acte, decision.trame, trame);
      setPending(null);
    } catch {
      onError?.('Génération Word impossible.');
    } finally {
      setEnvoi(false);
    }
  }, [pending, choix, retenir, onError]);

  const papeterieModal = useMemo(() => (
    pending ? (
      <PapeterieExportModal
        decision={pending.decision}
        choix={choix}
        onChoix={(id) => { setChoix(id); setTouche(true); }}
        retenir={retenir}
        onRetenir={setRetenir}
        iaBusy={iaBusy}
        envoi={envoi}
        modifie={touche}
        onClose={fermer}
        onConfirm={confirmer}
      />
    ) : null
  ), [pending, choix, retenir, iaBusy, envoi, touche, fermer, confirmer]);

  return { exporterWord, papeterieModal };
}

interface Props {
  decision: DecisionPapeterie;
  choix: string;
  onChoix: (id: string) => void;
  retenir: boolean;
  onRetenir: (v: boolean) => void;
  iaBusy: boolean;
  envoi: boolean;
  modifie: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PapeterieExportModal({
  decision, choix, onChoix, retenir, onRetenir, iaBusy, envoi, modifie, onClose, onConfirm,
}: Props) {
  const propose: TrameForme | null = decision.trame;
  const cible = decision.cle ? libelle(decision.cle) : null;

  return (
    // `onMouseDown` retenu : cette fenêtre peut être posée DANS une autre
    // (la fiche d'un acte), dont un clic sur le fond provoquerait la fermeture.
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Export Word</div>
            <div className="mt-0.5 text-sm font-bold text-gray-900">Dans quelle papeterie ?</div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-gray-500">
            Première fois pour ce type d'acte : une fois votre choix retenu, les exports suivants partiront
            directement, sans nouvelle question.
          </p>

          {iaBusy && (
            <div className="flex items-center gap-2 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              L'attaché lit l'acte pour proposer la papeterie et repérer ses parties…
            </div>
          )}
          {!iaBusy && decision.iaIndisponible && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Attaché injoignable ({decision.iaIndisponible}) — proposition déduite du titre de l'acte.</span>
            </div>
          )}
          {!iaBusy && !decision.iaIndisponible && decision.origine === 'ia' && decision.motif && (
            <div className="flex items-start gap-2 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-700">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{decision.motif}</span>
            </div>
          )}
          {!!decision.doutes.length && (
            <div className="text-[11px] text-gray-500">
              Découpage automatique incertain : {decision.doutes.join(' ; ')}.
              {!decision.iaIndisponible && ' L\'attaché a repéré les parties de l\'acte à sa place.'}
            </div>
          )}

          <div className="space-y-1.5">
            {decision.papeteries.map((p) => {
              const actif = p.id === choix;
              const estPropose = !modifie && p.id === propose?.id;
              return (
                <label
                  key={p.id}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                    actif ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="papeterie"
                    className="mt-1"
                    checked={actif}
                    onChange={() => onChoix(p.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-900 truncate">{p.nom}</span>
                      <span className="text-[10px] rounded bg-gray-100 px-1.5 py-0.5 text-gray-600 shrink-0">
                        {TYPE_LABELS[p.type] || p.type}
                      </span>
                      {estPropose && (
                        <span className="text-[10px] rounded bg-violet-100 px-1.5 py-0.5 text-violet-700 shrink-0">proposée</span>
                      )}
                    </span>
                    {p.usage && <span className="mt-0.5 block text-[11px] text-gray-500">{p.usage}</span>}
                  </span>
                </label>
              );
            })}
          </div>

          {cible && (
            <label className="flex items-start gap-2 text-xs text-gray-600 pt-1">
              <input type="checkbox" className="mt-0.5" checked={retenir} onChange={(e) => onRetenir(e.target.checked)} />
              <span>Retenir ce choix pour {cible} — modifiable dans Paramètres → Trames de forme.</span>
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Annuler
          </button>
          <button
            onClick={onConfirm}
            disabled={envoi || !choix}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {envoi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Télécharger
          </button>
        </div>
      </div>
    </div>
  );
}

/** Libellé lisible de la cible d'une règle (sans importer le cœur côté rendu). */
function libelle(cle: string): string {
  const [prefixe, ...reste] = cle.split(':');
  const v = reste.join(':').replace(/-/g, ' ');
  if (prefixe === 'source') return `les actes rédigés d'après la trame « ${v} »`;
  if (prefixe === 'titre') return `les actes intitulés « ${v} »`;
  if (prefixe === 'type') return `les actes de type « ${v} »`;
  return `« ${cle} »`;
}
