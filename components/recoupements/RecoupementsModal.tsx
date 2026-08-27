'use client';

/**
 * SIRAL — recoupements entre dossiers · vue d'ensemble.
 *
 * Tout ce que le dernier chantier a relevé, tous dossiers confondus, le plus
 * solide d'abord. On y arrive par la loupe de l'en-tête ; rien ne s'ouvre tout
 * seul.
 *
 * Le calcul n'a pas lieu ici : il tourne sur le SERVEUR, une fois par semaine
 * dans la nuit du samedi au dimanche, sur le fonds entier. Cette fenêtre en
 * lit le résultat — et dit toujours DE QUAND il date et CE QU'IL A PU LIRE :
 * un périmètre incomplet doit se voir, jamais se deviner.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Loader2, RefreshCw, ServerCog } from 'lucide-react';
import type { Recoupement } from '@/types/recoupementTypes';
import type { RecoupementsChantier } from '@/hooks/useRecoupements';
import type { LienExistant, PropositionLien } from '@/utils/recoupements/liens';
import { RecoupementList } from './RecoupementList';

export interface RecoupementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  signaux: Recoupement[];
  ecartes: Recoupement[];
  estNouveau: (signal: Recoupement) => boolean;
  /** Signal écarté autrefois, remonté parce qu'un dossier de plus l'a rejoint. */
  estRevenu?: (signal: Recoupement) => boolean;
  /** Première lecture du coffre en cours. */
  chargement: boolean;
  /** Le dernier chantier du serveur — null : aucun n'a encore tourné. */
  chantier: RecoupementsChantier | null;
  /** Un chantier tourne en ce moment. */
  detectionEnCours: boolean;
  /** Relance le chantier sur le serveur (administrateur seulement). */
  onLancerDetection: () => Promise<{ ok: boolean; error?: string }>;
  onOuvrirDossier?: (signal: Recoupement, dossierKey: string) => void;
  onEcarter: (signal: Recoupement) => void;
  onReactiver: (signal: Recoupement) => void;
  /** Liens de renseignement déjà tracés (rien n'est proposé deux fois). */
  liens?: LienExistant[];
  onCreerLien?: (proposition: PropositionLien) => void;
  onAjouterMec?: (signal: Recoupement, dossierKey: string, nom: string) => void;
  /** Marque comme vus les signaux affichés (appelé à l'ouverture). */
  onVus?: (signaux: Recoupement[]) => void;
}

export function RecoupementsModal({
  isOpen,
  onClose,
  signaux,
  ecartes,
  estNouveau,
  estRevenu,
  chargement,
  chantier,
  detectionEnCours,
  onLancerDetection,
  onOuvrirDossier,
  onEcarter,
  onReactiver,
  liens,
  onCreerLien,
  onAjouterMec,
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
          adresses, lignes, véhicules, comptes.
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
            <EtatChantier
              chargement={chargement}
              chantier={chantier}
              enCours={detectionEnCours}
              onLancer={onLancerDetection}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {onglet === 'actifs' ? (
            signaux.length > 0 ? (
              <RecoupementList
                signaux={signaux}
                estNouveau={estNouveau}
                estRevenu={estRevenu}
                onOuvrirDossier={onOuvrirDossier}
                onEcarter={onEcarter}
                liens={liens}
                onCreerLien={onCreerLien}
                onAjouterMec={onAjouterMec}
              />
            ) : (
              <p className="px-3 py-6 text-center text-xs text-gray-400">
                {chargement
                  ? 'Lecture du dernier chantier…'
                  : !chantier
                    ? 'Aucun chantier n’a encore tourné. Le prochain part dans la nuit du samedi au dimanche.'
                    : chantier.perimetre.piecesNonLues > 0
                      ? `Rien relevé sur ce qui a été lu. ${chantier.perimetre.piecesNonLues} pièce(s) restent à analyser — le prochain chantier les prendra.`
                      : 'Aucun recoupement relevé.'}
              </p>
            )
          ) : ecartes.length > 0 ? (
            <RecoupementList signaux={ecartes} onReactiver={onReactiver} liens={liens} />
          ) : (
            <p className="px-3 py-6 text-center text-xs text-gray-400">Aucun signal écarté.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * D'où viennent ces signaux, et de quand.
 *
 * Un tableau de rapprochements sans date est un piège : le magistrat ne peut
 * pas savoir si le dossier versé ce matin y est pour quelque chose. On affiche
 * donc toujours la date du dernier chantier et le nombre de pièces qu'il a
 * réellement lues — et l'on dit franchement ce qui lui a échappé.
 *
 * Le bouton de relance n'est proposé qu'à l'administrateur du TJ confié : pour
 * tout autre utilisateur la route du service attaché répond comme si elle
 * n'existait pas, et le bouton disparaît.
 */
function EtatChantier({
  chargement, chantier, enCours, onLancer,
}: {
  chargement: boolean;
  chantier: RecoupementsChantier | null;
  enCours: boolean;
  onLancer: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [peutLancer, setPeutLancer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  // Sondage à l'ouverture seulement (le portail Radix ne monte rien tant que
  // la fenêtre est fermée) : aucun appel en fond toute la journée.
  useEffect(() => {
    let vivant = true;
    fetch('/api/attache/recoupements', { credentials: 'include' })
      .then((r) => { if (vivant) setPeutLancer(r.ok); })
      .catch(() => { if (vivant) setPeutLancer(false); });
    return () => { vivant = false; };
  }, []);

  const lancer = useCallback(async () => {
    setErreur(null);
    const res = await onLancer();
    if (!res.ok) setErreur(res.error || 'Le chantier n’a pas pu partir.');
  }, [onLancer]);

  if (chargement) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-gray-400">
        <Loader2 className="h-3 w-3 animate-spin" /> lecture…
      </span>
    );
  }

  const dateChantier = chantier
    ? new Date(chantier.calculeAt).toLocaleString('fr-FR', {
      weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    : null;

  const perimetre = chantier?.perimetre;
  const detail = perimetre
    ? `${perimetre.dossiers} dossier(s) comparé(s), ${perimetre.piecesLues}/${perimetre.pieces} pièce(s) lues`
      + (perimetre.piecesNonLues > 0 ? ` · ${perimetre.piecesNonLues} à analyser au prochain passage` : '')
      + (perimetre.contentieuxSansCle.length > 0
        ? ` · hors périmètre faute de clé : ${perimetre.contentieuxSansCle.join(', ')}`
        : '')
    : undefined;

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1 text-[11px] text-gray-400" title={detail}>
        <ServerCog className="h-3 w-3" />
        {enCours
          ? 'chantier en cours sur le serveur…'
          : dateChantier
            ? `chantier du ${dateChantier}`
            : 'aucun chantier encore passé'}
      </span>
      {peutLancer && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={enCours}
          onClick={lancer}
          title="Relance la détection sur le serveur, sur le fonds entier. Le prochain passage automatique est la nuit du samedi au dimanche."
        >
          {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Lancer maintenant
        </Button>
      )}
      {erreur && <span className="text-[11px] text-red-600">{erreur}</span>}
    </div>
  );
}
