'use client';

/**
 * SIRAL — Page « Assistant de justice » (attaché de justice IA).
 *
 * Regroupe, HORS du tableau de bord, tout ce que l'attaché IA prépare pour le
 * magistrat : les propositions à trancher, le journal (« Pendant votre
 * absence »), les actes rédigés hors dossier et la boîte dédiée. Le tableau de
 * bord retrouve ainsi sa lisibilité (indicateurs, OP, échéances, agenda) ;
 * l'assistant vit sur sa propre page.
 *
 * Le « brief du majordome » (balayage matinal de tous les dossiers, un
 * sous-agent par dossier) a été RETIRÉ : premier poste de dépense du forfait
 * pour un rendu redondant avec les widgets du tableau de bord. Ce que l'attaché
 * a à dire arrive désormais par le fil « pendant votre absence » ; un balayage
 * régulier se planifie en routine (Paramètres → Attaché IA), de nuit.
 *
 * Visible du SEUL administrateur : l'entrée de menu est masquée pour les autres
 * comptes (voir MultiSideBar) et la vue est gardée dans app/page.tsx. Défense en
 * profondeur : chaque widget se masque déjà de lui-même si /api/attache/* ≠ 200.
 */
import { Scale, AlertTriangle } from 'lucide-react';
import { AbsenceJournal } from '@/components/attache/AbsenceJournal';
import { InboxWidget } from '@/components/attache/InboxWidget';
import { ProductionsSection } from '@/components/attache/ProductionsSection';
import { NouveauxDossiersPropositions } from '@/components/attache/NouveauxDossiersPropositions';
import { ChantiersSection } from '@/components/attache/ChantiersSection';

/** Types de propositions tranchables ici (constante stable : évite un
 * rechargement en boucle du bandeau, qui compare `kinds` par valeur). */
const A_VALIDER_KINDS = ['dossier', 'dossier_carto', 'mec_carto', 'lien'] as const;

export const AssistantJusticePage = ({ onOpenDossier, serviceInjoignable }: {
  onOpenDossier?: (numero: string) => void;
  /** Le service attaché ne répond plus : la page reste, mais dit pourquoi elle est vide. */
  serviceInjoignable?: boolean;
}) => {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="space-y-6">
      {/* En-tête de page */}
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white shadow-sm">
          <Scale className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">Assistant de justice</h1>
          <p className="mt-0.5 text-sm text-gray-500 capitalize">{today}</p>
        </div>
      </div>

      {/* Service attaché hors d'état : chaque widget ci-dessous se masque de
          lui-même quand /api/attache/* ne répond pas. Sans cette bannière, la
          page paraissait simplement vidée de son contenu — voire, avant que la
          sonde ne distingue 404 et 503, l'assistant disparaissait entièrement de
          l'application (menu, page, paramètres, actes rédigés). */}
      {serviceInjoignable && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Service attaché injoignable — rien ne peut être affiché.</p>
            <p className="mt-1 text-amber-800">
              Vos actes rédigés, propositions et conversations sont intacts sur le serveur : c'est le
              service qui ne répond pas (conteneur arrêté, redémarrage en cours, ou machine saturée).
              L'application se raccroche toute seule dès qu'il répond de nouveau.
              Le détail du diagnostic est dans <b>Paramètres → Attaché</b>.
            </p>
          </div>
        </div>
      )}

      {/* Propositions en attente de validation — liens de renseignement,
          personnes et dossiers ex nihilo issus d'une analyse transversale, et
          nouveaux dossiers extraits d'une pièce. Elles vivaient uniquement dans
          le panneau Attaché et au bas de la Cartographie : quand une routine de
          scan cassait, le magistrat lisait « interrompue » sans jamais trouver
          où trancher ce qui avait malgré tout été déposé. Elles sont donc aussi
          ici, sur la page où les cartes de l'attaché atterrissent. */}
      <NouveauxDossiersPropositions kinds={A_VALIDER_KINDS} title="Proposition à valider" />

      {/* Chantiers d'analyse profonde : dépouillement massif d'un dossier en
          fiches factuelles (la nuit, par lots, interruptible) puis synthèse.
          Le poste de pilotage vit ICI — le moteur tourne côté service. */}
      <ChantiersSection />

      {/* Journal « pendant votre absence » — actions préparées, documents rédigés */}
      <AbsenceJournal onOpenDossier={onOpenDossier} />

      {/* Actes rédigés HORS DOSSIER : demandes arrivées par mail sans procédure
          correspondante, traitées sur consigne — invisible tant qu'il n'y en a aucun. */}
      <ProductionsSection numero="_hors-dossier" titre="Actes rédigés — hors dossier" masquerSiVide />

      {/* Boîte mail dédiée de l'attaché : contrôle « bien reçu / en cours / traité ». */}
      <InboxWidget />
    </div>
  );
};
