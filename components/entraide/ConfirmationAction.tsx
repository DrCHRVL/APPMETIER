'use client';

// Fenêtre de confirmation d'une action du registre ou de la fiche : chaque
// action ajoute un événement à la chronologie (et donc change l'étape et les
// échéances) — on dit ce qui va se passer avant de l'écrire. La date se
// corrige ici (retour reçu la veille…), le délai et la langue aussi.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { ajouterMois, aujourdhui, dateFr, delaisDe, DOC_LABELS } from '@/utils/entraide/logique';
import type { DemandeEntraide, EntraideAction, EntraideLangue } from '@/types/entraideTypes';

export interface OptionsAction { date: string; langue?: EntraideLangue; delaiMois?: number; echeance?: string }

/** Ce que fait l'action, en une ou deux phrases (délais du dossier, drapeau compris). */
export function explicationAction(a: EntraideAction, d: DemandeEntraide): string {
  const DELAIS = delaisDe(d);
  const APRES_ENVOI: Record<string, string> = {
    t1: `le dossier sera chez les enquêteurs, retour attendu à ${DELAIS.enqueteursMois} mois`,
    t2: `un nouveau délai de retour de ${DELAIS.enqueteursMois} mois courra à compter de cette date`,
    t3: 'le dossier attendra l’accusé de réception de l’autorité étrangère',
    t4: `une nouvelle réponse de l’autorité sera attendue à ${DELAIS.relanceMois} mois`,
  };
  const doc = a.doc ? DOC_LABELS[a.doc] : '';
  switch (a.action) {
    case 'preparer':
      return `Prépare le courrier « ${doc} ». Il passe dans l’onglet « À signer » ; une fois signé puis marqué envoyé, ${APRES_ENVOI[a.doc || 't1']}.`;
    case 'signer':
      return `Appose votre signature sur « ${doc} » et télécharge le courrier signé. Il reste ensuite à l’envoyer, puis à le marquer envoyé.`;
    case 'envoyer':
      return `Note que « ${doc} » est parti : ${APRES_ENVOI[a.doc || 't1']}.`;
    case 'retour_enqueteurs':
      return 'Note que les enquêteurs ont retourné la procédure COMPLÈTE : l’attente du retour s’arrête et le dossier passe chez le magistrat pour avis (préparation du retour à l’autorité, T3). Retour incomplet : utilisez plutôt « Retour partiel ».';
    case 'retour_partiel':
      return 'Note un retour INCOMPLET : il figure dans la chronologie, mais le dossier reste chez les enquêteurs et l’échéance de retour est maintenue.';
    case 'prorogation':
      return 'Fixe une nouvelle échéance (dossier à représenter). Le dossier reste à la même étape : seule la date d’attente change.';
    case 'relance_mail':
      return 'Ouvre Outlook avec le mail de relance prérempli et note la relance dans la chronologie. L’échéance de retour ne change pas (seul le soit-transmis de relance T2 ouvre un nouveau délai).';
    case 'ar_annexe_b':
      return 'Note que l’accusé de réception (annexe B) a été adressé à l’autorité d’émission à cette date. Le délai légal de 7 jours (art. 16 dir. 2014/41/UE) sera compté tenu ou dépassé selon cette date.';
    case 'traduction_demandee':
      return `Note la transmission pour traduction : retour de la traduction attendu sous ${DELAIS.traductionJours} jours.`;
    case 'traduction_recue':
      return 'Note la réception de la traduction : le dossier reprend son cours là où il en était.';
    case 'transmission_magistrat':
      return 'Le dossier passe chez le magistrat pour avis. Les échéances en cours sont conservées.';
    case 'envoi_autorite':
      if (d.type === 'do' && d.sens === 'emise') return `Note l’envoi de la dénonciation officielle : seul son accusé de réception est attendu (relance proposée à ${DELAIS.emiseMois} mois sans réponse).`;
      return d.sens === 'emise'
        ? `Note l’envoi de la demande à l’autorité étrangère : réponse attendue à ${DELAIS.emiseMois} mois, relance proposée à l’échéance.`
        : 'Note l’envoi du retour à l’autorité étrangère : le dossier attend son accusé de réception.';
    case 'retour_execution':
      return 'Note la réception des pièces d’exécution envoyées par l’autorité étrangère : le dossier passe chez le magistrat pour avis, puis clôture.';
    case 'ar_recu':
      return 'Note l’accusé de réception de l’autorité étrangère : le dossier est prêt à être clôturé.';
    case 'do_accepter':
      return 'La dénonciation est acceptée : les faits partent en enquête (procédure ordinaire, hors suivi de l’entraide) et le dossier est clôturé ici avec la mention « acceptée ».';
    case 'do_refuser':
      return 'La dénonciation n’est pas reprise (classement) : le dossier est clôturé avec la mention « refusée ».';
    case 'ar_recu_cloturer':
      return 'L’autorité étrangère a accusé réception de la dénonciation : c’est tout ce qui est attendu d’une dénonciation émise. Le dossier est clôturé.';
    case 'cloturer':
      return 'Clôture le dossier : il quitte le registre (onglet « Clôturées ») et n’a plus d’échéance. Seule une réouverture le fera revenir.';
    case 'reouvrir':
      return 'Rouvre le dossier à l’étape et avec l’échéance qu’il avait avant sa clôture.';
    default:
      return 'Ajoute cet événement à la chronologie de la demande.';
  }
}

interface Props {
  action: EntraideAction;
  demande: DemandeEntraide;
  langueParDefaut?: EntraideLangue;
  onAnnuler: () => void;
  onValider: (o: OptionsAction) => void | Promise<void>;
}

export const ConfirmationAction: React.FC<Props> = ({ action: a, demande: d, langueParDefaut = 'fr', onAnnuler, onValider }) => {
  useEscapeKey(onAnnuler);
  const jour = aujourdhui();
  const [date, setDate] = useState(jour);
  const [langue, setLangue] = useState<EntraideLangue>(langueParDefaut);
  const [mois, setMois] = useState(3);
  const [echeance, setEcheance] = useState('');
  const [enCours, setEnCours] = useState(false);
  const avecLangue = a.action === 'preparer' && (a.doc === 't3' || a.doc === 't4');
  const avecDate = a.action !== 'signer' && a.action !== 'preparer';

  const valider = async () => {
    setEnCours(true);
    try {
      await onValider({
        date: avecDate ? date : jour,
        ...(avecLangue ? { langue } : {}),
        ...(a.action === 'prorogation' ? (echeance ? { echeance } : { delaiMois: mois }) : {}),
      });
    } finally {
      setEnCours(false);
    }
  };

  const bouton = (actif: boolean) => `px-2.5 py-1 rounded border text-xs ${actif ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onAnnuler}>
      <div className="w-[min(520px,94vw)] rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-5 py-3">
          <h3 className="text-base font-semibold text-gray-900">{a.libelle}</h3>
          <p className="text-xs text-gray-500 font-mono truncate">{d.refEsabora} · {d.pays}</p>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-gray-700 leading-relaxed">{explicationAction(a, d)}</p>
          {avecDate && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Date
              <input type="date" className="rounded border px-2 py-1 text-xs" value={date} max={jour} onChange={(e) => setDate(e.target.value || jour)} />
              {date !== jour && <span className="text-amber-700">(antidaté)</span>}
            </label>
          )}
          {a.action === 'prorogation' && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <div className="text-xs text-gray-600 mb-1">Nouveau délai</div>
                <div className="flex gap-1">
                  {[3, 4, 6].map((m) => <button key={m} type="button" className={bouton(!echeance && mois === m)} onClick={() => { setMois(m); setEcheance(''); }}>{m} mois</button>)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">… ou à représenter le</div>
                <input type="date" className="rounded border px-2 py-1 text-xs" value={echeance} onChange={(e) => setEcheance(e.target.value)} />
              </div>
              <span className="text-xs text-gray-500">Échéance : <b>{dateFr(echeance || ajouterMois(date, mois) || '')}</b></span>
            </div>
          )}
          {avecLangue && (
            <div>
              <div className="text-xs text-gray-600 mb-1">Langue du courrier</div>
              <div className="flex gap-1">
                {(['fr', 'en'] as EntraideLangue[]).map((l) => <button key={l} type="button" className={bouton(langue === l)} onClick={() => setLangue(l)}>{l === 'fr' ? 'Français' : 'Anglais'}</button>)}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button size="sm" variant="outline" onClick={onAnnuler}>Annuler</Button>
          <Button size="sm" className="bg-[#2B5746] hover:bg-[#2B5746]/90" disabled={enCours} onClick={valider}>Confirmer</Button>
        </div>
      </div>
    </div>
  );
};
