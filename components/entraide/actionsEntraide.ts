// components/entraide/actionsEntraide.ts
//
// Exécution des actions proposées sur une demande (lib/entraide/core.mjs →
// prochainesActions) : chaque action = un événement daté, plus, le cas
// échéant, un courrier téléchargé ou un mail ouvert. Partagé par la liste
// (bouton « Prochaine étape ») et la fiche.

import { aujourdhui, ENVOI_PAR_DOC } from '@/utils/entraide/logique';
import { genererDocument, nomFichier, telecharger } from '@/utils/entraide/documents';
import { lienMailto, mailRelanceEnqueteurs } from '@/utils/entraide/mails';
import type { EntraideApi } from '@/hooks/useEntraide';
import type {
  DemandeEntraide,
  EntraideAction,
  EntraideDocId,
  EntraideEvenementType,
  EntraideLangue,
  SignataireEntraide,
} from '@/types/entraideTypes';

/** Actions qui se résument à un événement daté (confirmé par l'écran). */
const SIMPLES: Record<string, EntraideEvenementType> = {
  ar_annexe_b: 'ar_annexe_b',
  traduction_demandee: 'traduction_demandee',
  traduction_recue: 'traduction_recue',
  retour_enqueteurs: 'retour_enqueteurs',
  transmission_magistrat: 'transmission_magistrat',
  envoi_autorite: 'envoi_autorite',
  retour_execution: 'retour_execution',
  ar_recu: 'ar_recu',
  cloturer: 'cloture',
  reouvrir: 'reouverture',
};

export interface ContexteAction {
  api: EntraideApi;
  demande: DemandeEntraide;
  /** Coordonnées du magistrat connecté (mails de relance). */
  monSignataire: SignataireEntraide | null;
  notifier: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export function signataireDe(api: EntraideApi, demande: DemandeEntraide): SignataireEntraide | null {
  const u = (demande.magistrat || '').toLowerCase();
  return (u && api.index.signataire.get(u)) || null;
}

/** Télécharge un courrier (à imprimer, signer et envoyer hors de l'application). */
export async function telechargerCourrier(
  api: EntraideApi,
  demande: DemandeEntraide,
  doc: EntraideDocId,
  langue: EntraideLangue,
): Promise<void> {
  const blob = await genererDocument({
    demande,
    doc,
    langue,
    autorite: (demande.autoriteId && api.index.autorite.get(demande.autoriteId)) || null,
    service: (demande.serviceId && api.index.service.get(demande.serviceId)) || null,
    signataire: signataireDe(api, demande),
  });
  telecharger(blob, nomFichier(demande, doc, langue));
}

export async function executerAction(
  ctx: ContexteAction,
  a: EntraideAction,
  options: { langue?: EntraideLangue; delaiMois?: number; echeance?: string; date?: string } = {},
): Promise<void> {
  const { api, demande: d, notifier } = ctx;
  const date = options.date || aujourdhui();

  if (SIMPLES[a.action]) {
    await api.ajouterEvenement(d.id, { type: SIMPLES[a.action], date });
    return;
  }
  switch (a.action) {
    case 'repositionner':
      await api.ajouterEvenement(d.id, { type: 'repositionnement', date, etape: a.etape, ...(a.doc ? { doc: a.doc } : {}) });
      return;
    case 'do_accepter':
    case 'do_refuser':
      await api.ajouterEvenement(d.id, { type: 'cloture', date, issue: a.action === 'do_accepter' ? 'acceptee' : 'refusee' });
      return;
    case 'ar_recu_cloturer':
      await api.ajouterEvenement(d.id, { type: 'ar_recu', date });
      await api.ajouterEvenement(d.id, { type: 'cloture', date });
      return;
    case 'retour_partiel':
      await api.ajouterEvenement(d.id, { type: 'retour_enqueteurs', date, partiel: true });
      return;
    case 'prorogation':
      await api.ajouterEvenement(d.id, {
        type: 'prorogation', date,
        ...(options.echeance ? { echeance: options.echeance } : { delaiMois: options.delaiMois || 3 }),
      });
      return;
    case 'relance_mail': {
      const service = (d.serviceId && api.index.service.get(d.serviceId)) || null;
      const mail = mailRelanceEnqueteurs(d, service, ctx.monSignataire || signataireDe(api, d));
      window.open(lienMailto(mail), '_self');
      await api.ajouterEvenement(d.id, { type: 'relance_enqueteurs_mail', date });
      return;
    }
    case 'preparer': {
      const doc = a.doc || 't1';
      const autorite = (d.autoriteId && api.index.autorite.get(d.autoriteId)) || null;
      const langue: EntraideLangue = doc === 't3' || doc === 't4' ? (options.langue || autorite?.langue || 'fr') : 'fr';
      await api.ajouterEvenement(d.id, { type: 'document_prepare', date, doc, langue });
      try {
        await telechargerCourrier(api, d, doc, langue);
        notifier(`${doc.toUpperCase()} préparé et téléchargé : à imprimer et envoyer (onglet « À envoyer »).`, 'success');
      } catch (e) {
        notifier(`${doc.toUpperCase()} préparé, mais le téléchargement a échoué (${e instanceof Error ? e.message : String(e)}) : retéléchargez-le depuis la fiche ou l’onglet « À envoyer ».`, 'warning');
      }
      return;
    }
    case 'envoyer': {
      const doc = a.doc || 't1';
      await api.ajouterEvenement(d.id, { type: ENVOI_PAR_DOC[doc], date });
      return;
    }
    default:
      notifier(`Action inconnue : ${a.action}`, 'error');
  }
}
