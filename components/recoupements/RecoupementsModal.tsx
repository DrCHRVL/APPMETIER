'use client';

/**
 * SIRAL — veille de recoupements · vue d'ensemble.
 *
 * Tout ce que la veille a relevé, tous dossiers confondus, le plus solide
 * d'abord. On y arrive par la loupe de l'en-tête ; rien ne s'ouvre tout seul.
 *
 * « Analyser les pièces » est le SEUL moment où l'on touche aux documents
 * jamais ouverts, et c'est toujours un geste explicite :
 *   · analyse profonde — un CHANTIER est déposé à l'état DEVIS (volume, lots,
 *     jetons, nuits) ; rien ne tourne avant que le devis soit validé dans
 *     « Analyses profondes » ;
 *   · lecture rapide — extraction du seul texte, sur ce poste, sans jeton :
 *     elle fait entrer les pièces dans la veille, sans les faire lire à
 *     personne.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { FileSearch, Loader2, Layers, Check } from 'lucide-react';
import type { Recoupement } from '@/types/recoupementTypes';
import type { DocScanState } from '@/hooks/useRecoupements';
import type { LienExistant, PropositionLien } from '@/utils/recoupements/liens';
import { useChantiers } from '../attache/useChantiers';
import { RecoupementList } from './RecoupementList';

export interface RecoupementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  signaux: Recoupement[];
  ecartes: Recoupement[];
  estNouveau: (signal: Recoupement) => boolean;
  /** Signal écarté autrefois, remonté parce qu'un dossier de plus l'a rejoint. */
  estRevenu?: (signal: Recoupement) => boolean;
  computing: boolean;
  docScan: DocScanState;
  onAnalyserPieces: () => void;
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
  computing,
  docScan,
  onAnalyserPieces,
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
          adresses, lignes, véhicules, comptes. Aucun dossier n&apos;est modifié :
          c&apos;est un signalement, à vérifier avant d&apos;en tirer quoi que ce soit.
          Les suites — inscrire un mis en cause, tracer un lien de renseignement —
          ne partent que de vous.
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
            <AnalysePieces docScan={docScan} onLectureRapide={onAnalyserPieces} />
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
                {computing
                  ? 'Analyse en cours…'
                  : docScan.pending > 0
                    ? 'Rien pour l’instant sur ce qui a été lu. Les pièces jamais analysées ne sont pas encore couvertes.'
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
 * Les pièces jamais ouvertes — et les deux façons de s'en occuper.
 *
 * Monté avec la modale seulement (le portail Radix ne rend rien tant qu'elle
 * est fermée) : le sondage des chantiers ne tourne donc pas en fond toute la
 * journée.
 */
function AnalysePieces({
  docScan, onLectureRapide,
}: {
  docScan: DocScanState;
  onLectureRapide: () => void;
}) {
  const { available, creating, creer } = useChantiers();
  const [devisPose, setDevisPose] = useState(false);

  if (docScan.scanning) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        lecture des pièces {docScan.done}/{docScan.total}
      </span>
    );
  }
  if (docScan.pending <= 0) return null;

  if (devisPose) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
        <Check className="h-3.5 w-3.5" />
        Devis déposé — à valider dans « Analyses profondes »
      </span>
    );
  }

  const pieces = `${docScan.pending} pièce${docScan.pending > 1 ? 's' : ''}`;

  const lancerChantier = async () => {
    const numeros = docScan.numeros;
    const id = await creer({
      type: numeros.length >= 2 ? 'liens' : 'dossier',
      numero: numeros.length >= 2 ? '' : (numeros[0] || ''),
      numeros,
      consigne:
        'Recoupements entre dossiers. Dépouiller les pièces jamais analysées et relever '
        + 'les personnes, adresses, lignes téléphoniques, véhicules, comptes et IBAN communs '
        + 'à plusieurs dossiers. Pour chacun : citer la pièce et la cote, dire ce que le '
        + 'rapprochement établit et ce qu’il n’établit pas, et signaler en priorité ce qui '
        + 'n’est pas déjà visible sur la cartographie (aucun mis en cause commun).',
      nuitSeulement: true,
    });
    if (id) setDevisPose(true);
  };

  return (
    <div className="flex items-center gap-2">
      {available && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={creating}
          onClick={lancerChantier}
          title={`Analyse profonde des ${pieces} jamais lues, sur ${docScan.numeros.length} dossier(s) : un devis chiffré est déposé dans « Analyses profondes ». Rien ne tourne avant que vous le validiez.`}
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
          Analyser {pieces}
        </Button>
      )}
      <button
        type="button"
        onClick={onLectureRapide}
        title="Extraction du seul texte, sur ce poste, sans jeton ni analyse : les pièces entrent dans la veille mais personne ne les lit."
        className={available
          ? 'inline-flex items-center gap-1 text-[10.5px] text-gray-400 underline decoration-dotted hover:text-gray-600'
          : 'inline-flex h-7 items-center gap-1.5 rounded-md border border-gray-200 px-2 text-xs text-gray-700 hover:bg-gray-50'}
      >
        <FileSearch className="h-3 w-3" />
        {available ? 'lecture rapide' : `Analyser ${pieces}`}
      </button>
    </div>
  );
}
