'use client';

/**
 * SIRAL — Page « Assistant de justice » (attaché de justice IA).
 *
 * Regroupe, HORS du tableau de bord, tout ce que l'attaché IA prépare pour le
 * magistrat : le brief (« Votre attaché a préparé »), le journal (« Pendant
 * votre absence »), les actes rédigés hors dossier et la boîte dédiée. Le
 * tableau de bord retrouve ainsi sa lisibilité (indicateurs, OP, échéances,
 * agenda) ; l'assistant vit sur sa propre page.
 *
 * Visible du SEUL administrateur : l'entrée de menu est masquée pour les autres
 * comptes (voir MultiSideBar) et la vue est gardée dans app/page.tsx. Défense en
 * profondeur : chaque widget se masque déjà de lui-même si /api/attache/* ≠ 200.
 */
import { Scale } from 'lucide-react';
import { MajordomeWidget } from '@/components/attache/MajordomeWidget';
import { AbsenceJournal } from '@/components/attache/AbsenceJournal';
import { InboxWidget } from '@/components/attache/InboxWidget';
import { ProductionsSection } from '@/components/attache/ProductionsSection';

export const AssistantJusticePage = () => {
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
          <p className="mt-1 text-[12px] text-gray-400">
            Ce que votre attaché IA a préparé, ce qu&apos;il a fait en votre absence et sa boîte dédiée —
            documents éditables et exportables ici comme dans le dossier · visible de vous seul.
          </p>
        </div>
      </div>

      {/* Brief du majordome — « Votre attaché a préparé » */}
      <MajordomeWidget />

      {/* Journal « pendant votre absence » — actions préparées, documents rédigés */}
      <AbsenceJournal />

      {/* Actes rédigés HORS DOSSIER : demandes arrivées par mail sans procédure
          correspondante, traitées sur consigne — invisible tant qu'il n'y en a aucun. */}
      <ProductionsSection numero="_hors-dossier" titre="Actes rédigés — hors dossier" masquerSiVide />

      {/* Boîte mail dédiée de l'attaché : contrôle « bien reçu / en cours / traité ». */}
      <InboxWidget />
    </div>
  );
};
