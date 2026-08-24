'use client';

/**
 * SIRAL — veille de recoupements · liste des signaux.
 *
 * Un signal = une valeur (personne, adresse, ligne, véhicule…) vue dans
 * plusieurs dossiers. La lecture se fait DOSSIER PAR DOSSIER : un même nom
 * cité six fois dans la même procédure n'est pas six informations, c'est un
 * dossier et la liste des endroits où il apparaît.
 *
 * Trois suites possibles, et seulement quand elles apportent quelque chose :
 *   · ouvrir le dossier concerné ;
 *   · l'ajouter aux mis en cause, quand la procédure en parle sans l'y avoir
 *     inscrit ;
 *   · tracer le lien de renseignement qui manque sur la cartographie.
 *
 * Rien n'est proposé si la cartographie le montre déjà : ni le lien, ni la
 * mention « inédit ». « Écarter » ne fait que taire le signal pour son auteur,
 * tant que la situation ne change pas.
 */
import { useMemo, useState } from 'react';
import {
  Building2, Car, ChevronDown, ChevronRight, CreditCard, EyeOff, Link2,
  Phone, Smartphone, User, Users, ExternalLink, RotateCcw, UserPlus, Check,
} from 'lucide-react';
import type { Recoupement, RecoupementKind } from '@/types/recoupementTypes';
import { LIBELLE_KIND } from '@/utils/recoupements/engine';
import {
  analyserSignal, type LienExistant, type PropositionLien, type Provenance,
} from '@/utils/recoupements/liens';

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

/** Ce qu'on écrit sur une pastille de provenance : le plus parlant des deux. */
function libelleProvenance(p: Provenance): string {
  const detail = (p.detail || '').trim();
  if (!detail || p.libelle === 'mis en cause') return p.libelle;
  return detail.length > 46 ? `${detail.slice(0, 45)}…` : detail;
}

export interface RecoupementListProps {
  signaux: Recoupement[];
  /** Dossier depuis lequel on regarde : il n'est pas proposé à l'ouverture. */
  dossierCourant?: string;
  estNouveau?: (signal: Recoupement) => boolean;
  onOuvrirDossier?: (signal: Recoupement, dossierKey: string) => void;
  onEcarter?: (signal: Recoupement) => void;
  onReactiver?: (signal: Recoupement) => void;
  /** Liens de renseignement déjà tracés — ce qui existe n'est pas reproposé. */
  liens?: LienExistant[];
  /** Trace le lien manquant sur la cartographie. */
  onCreerLien?: (proposition: PropositionLien) => void;
  /** Inscrit la personne aux mis en cause du dossier qui la cite. */
  onAjouterMec?: (signal: Recoupement, dossierKey: string, nom: string) => void;
  /** Signal déplié à l'ouverture (le premier, dans le bandeau d'un dossier). */
  deplierPremier?: boolean;
}

const AUCUN_LIEN: LienExistant[] = [];

export function RecoupementList({
  signaux,
  dossierCourant,
  estNouveau,
  onOuvrirDossier,
  onEcarter,
  onReactiver,
  liens = AUCUN_LIEN,
  onCreerLien,
  onAjouterMec,
  deplierPremier = false,
}: RecoupementListProps) {
  const [ouvert, setOuvert] = useState<string | null>(
    deplierPremier && signaux.length > 0 ? signaux[0].id : null
  );

  if (signaux.length === 0) return null;

  return (
    <div className="divide-y divide-amber-100/70">
      {signaux.map(signal => (
        <SignalLigne
          key={signal.id}
          signal={signal}
          ouvert={ouvert === signal.id}
          onBasculer={() => setOuvert(ouvert === signal.id ? null : signal.id)}
          dossierCourant={dossierCourant}
          neuf={estNouveau?.(signal) ?? false}
          liens={liens}
          onOuvrirDossier={onOuvrirDossier}
          onEcarter={onEcarter}
          onReactiver={onReactiver}
          onCreerLien={onCreerLien}
          onAjouterMec={onAjouterMec}
        />
      ))}
    </div>
  );
}

function SignalLigne({
  signal, ouvert, onBasculer, dossierCourant, neuf, liens,
  onOuvrirDossier, onEcarter, onReactiver, onCreerLien, onAjouterMec,
}: {
  signal: Recoupement;
  ouvert: boolean;
  onBasculer: () => void;
  dossierCourant?: string;
  neuf: boolean;
  liens: LienExistant[];
  onOuvrirDossier?: (signal: Recoupement, dossierKey: string) => void;
  onEcarter?: (signal: Recoupement) => void;
  onReactiver?: (signal: Recoupement) => void;
  onCreerLien?: (proposition: PropositionLien) => void;
  onAjouterMec?: (signal: Recoupement, dossierKey: string, nom: string) => void;
}) {
  const Icon = ICONE[signal.kind] || Link2;
  // Recalculé à chaque changement de la surcouche : un lien tracé fait
  // disparaître sa propre proposition, sans rien à rafraîchir à la main.
  const analyse = useMemo(() => analyserSignal(signal, liens), [signal, liens]);

  // Nom porté par le nœud de cartographie (celui sous lequel la personne est
  // déclarée quelque part) — c'est lui qu'on inscrirait aux mis en cause.
  const nomPersonne = useMemo(
    () => signal.occurrences.find(o => o.declaree && o.origine === 'mec')?.valeurBrute || signal.valeur,
    [signal]
  );

  const propositionsDeSignal = analyse.propositions.filter(p => !p.dossierKey);

  return (
    <div className="px-3 py-2">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
        <button
          type="button"
          onClick={onBasculer}
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
          {analyse.inedit ? (
            <span
              className="ml-1.5 rounded bg-sky-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700"
              title="Rien ne relie encore ces dossiers sur la cartographie : ni mis en cause commun, ni lien de renseignement"
            >
              inédit
            </span>
          ) : analyse.liensExistants.length > 0 && (
            <span
              className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500"
              title="Le lien est déjà tracé sur la cartographie — rien à créer"
            >
              déjà relié
            </span>
          )}
          {ouvert
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

      {ouvert && (
        <div className="mt-1.5 space-y-2 pl-6">
          {analyse.parDossier.map(d => (
            <DossierBloc
              key={d.key}
              resume={d}
              courant={d.key === dossierCourant}
              kind={signal.kind}
              onOuvrir={onOuvrirDossier && d.key !== dossierCourant
                ? () => onOuvrirDossier(signal, d.key) : undefined}
              onAjouterMec={onAjouterMec && signal.kind === 'personne' && d.citeeSansEtreMiseEnCause
                ? () => onAjouterMec(signal, d.key, nomPersonne) : undefined}
              proposition={analyse.propositions.find(p => p.dossierKey === d.key)}
              onCreerLien={onCreerLien}
            />
          ))}

          {/* Liens qui manquent à la carte, tous dossiers confondus. */}
          {onCreerLien && propositionsDeSignal.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-amber-100/70 pt-1.5">
              {propositionsDeSignal.map(p => (
                <button
                  key={p.cle}
                  type="button"
                  onClick={() => onCreerLien(p)}
                  title={p.titre}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50/60 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:border-sky-300 hover:bg-sky-100"
                >
                  <Link2 className="h-3 w-3" />
                  {p.libelle}
                </button>
              ))}
              <span className="text-[10.5px] text-gray-400">
                trace le trait sur la cartographie — ne modifie aucun dossier
              </span>
            </div>
          )}

          {analyse.propositions.length === 0 && analyse.liensExistants.length > 0 && (
            <p className="flex items-center gap-1 border-t border-amber-100/70 pt-1.5 text-[10.5px] text-gray-400">
              <Check className="h-3 w-3 text-emerald-500" />
              Lien de renseignement déjà tracé sur la cartographie.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function DossierBloc({
  resume, courant, kind, onOuvrir, onAjouterMec, proposition, onCreerLien,
}: {
  resume: ReturnType<typeof analyserSignal>['parDossier'][number];
  courant: boolean;
  kind: RecoupementKind;
  onOuvrir?: () => void;
  onAjouterMec?: () => void;
  proposition?: PropositionLien;
  onCreerLien?: (proposition: PropositionLien) => void;
}) {
  const [toutVoir, setToutVoir] = useState(false);
  const extraits = toutVoir ? resume.extraits : resume.extraits.slice(0, 1);
  const reste = resume.extraits.length - extraits.length;

  return (
    <div className="text-[11.5px] leading-snug">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-gray-700">{resume.ref.numero}</span>
        {courant && (
          <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-500">
            ce dossier
          </span>
        )}
        {resume.declaree && (
          <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-500">
            fiche
          </span>
        )}
        {kind === 'personne' && resume.citeeSansEtreMiseEnCause && (
          <span
            className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-700"
            title="La procédure en parle, mais la personne n'est pas dans sa liste de mis en cause"
          >
            pas mis en cause
          </span>
        )}
      </div>

      {/* Les provenances, sur une ligne : mis en cause · description · pièce X */}
      <p className="mt-0.5 text-gray-500">
        {resume.provenances.map((p, i) => (
          <span key={`${p.libelle}_${p.detail || ''}_${i}`} title={`${p.libelle}${p.detail ? ` · ${p.detail}` : ''}`}>
            {i > 0 && <span className="text-gray-300"> · </span>}
            {libelleProvenance(p)}
          </span>
        ))}
      </p>

      {extraits.map((extrait, i) => (
        <p key={i} className="mt-0.5 border-l-2 border-gray-200 pl-2 italic text-gray-500">
          {extrait}
        </p>
      ))}
      {reste > 0 && (
        <button
          type="button"
          onClick={() => setToutVoir(true)}
          className="mt-0.5 text-[10.5px] text-gray-400 underline decoration-dotted hover:text-gray-600"
        >
          + {reste} autre{reste > 1 ? 's' : ''} mention{reste > 1 ? 's' : ''}
        </button>
      )}

      {(onOuvrir || onAjouterMec || (proposition && onCreerLien)) && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {onOuvrir && (
            <button
              type="button"
              onClick={onOuvrir}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:border-gray-300 hover:bg-gray-50"
            >
              <ExternalLink className="h-3 w-3" />
              Ouvrir {resume.ref.numero}
            </button>
          )}
          {onAjouterMec && (
            <button
              type="button"
              onClick={onAjouterMec}
              title={resume.ref.nature === 'instruction'
                ? `Inscrire cette personne aux suspects de ${resume.ref.numero} (une mise en examen ne se décide pas ici)`
                : `Inscrire cette personne aux mis en cause de ${resume.ref.numero}`}
              className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50/60 px-1.5 py-0.5 text-[11px] font-medium text-purple-800 hover:border-purple-300 hover:bg-purple-100"
            >
              <UserPlus className="h-3 w-3" />
              {resume.ref.nature === 'instruction' ? 'Ajouter aux suspects' : 'Ajouter aux mis en cause'}
            </button>
          )}
          {proposition && onCreerLien && (
            <button
              type="button"
              onClick={() => onCreerLien(proposition)}
              title={proposition.titre}
              className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50/60 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:border-sky-300 hover:bg-sky-100"
            >
              <Link2 className="h-3 w-3" />
              {proposition.libelle}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
