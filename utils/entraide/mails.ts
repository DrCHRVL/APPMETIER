// utils/entraide/mails.ts
//
// Mails prêts à envoyer (bouton « Copier » ou « Ouvrir dans Outlook ») :
// objet complet (références, date), corps en français ou en anglais selon la
// langue de l'autorité. Les pièces jointes restent à ajouter à la main.

import { PAPETERIE } from '@/lib/web/papeterie';
import { aujourdhui, dateFr, etatDemande, TYPE_COURTS } from './logique';
import { dateEnvoiAutorite, dateLongue, fonctionAnglaise, intitule, telephoneInternational } from './textes';
import type {
  AutoriteEtrangere,
  DemandeEntraide,
  EntraideLangue,
  ServiceEnqueteur,
  SignataireEntraide,
} from '@/types/entraideTypes';

export interface MailPret {
  id: string;
  libelle: string;
  destinataire: string;
  objet: string;
  corps: string;
}

function signature(sig: SignataireEntraide | null, langue: EntraideLangue): string {
  if (!sig) return langue === 'en' ? `${PAPETERIE.parquet}\n${PAPETERIE.ville}` : `${PAPETERIE.parquet}\n${PAPETERIE.ville}`;
  if (langue === 'en') {
    return [`${sig.prenomNom}`, fonctionAnglaise(sig.fonction), `${PAPETERIE.ville} Judicial Court (France)`,
      sig.telephone ? `Tel. ${telephoneInternational(sig.telephone)}` : '', sig.email || ''].filter(Boolean).join('\n');
  }
  return [sig.prenomNom, sig.fonction, PAPETERIE.parquet, sig.telephone ? `Tél. ${sig.telephone}` : '', sig.email || '']
    .filter(Boolean).join('\n');
}

function dateEnvoiEnqueteurs(d: DemandeEntraide): string | null {
  const envois = (d.evenements || [])
    .filter((e) => e.type === 'envoi_enqueteurs' || e.type === 'relance_enqueteurs')
    .map((e) => e.date).sort();
  return envois.length ? envois[envois.length - 1] : null;
}

function refs(d: DemandeEntraide, langue: EntraideLangue): string {
  const n = langue === 'en' ? 'Our ref.' : 'N/réf';
  const v = langue === 'en' ? 'Your ref.' : 'V/réf';
  return [d.refEsabora ? `${n} ${d.refEsabora}` : '', d.refEtrangere ? `${v} ${d.refEtrangere}` : ''].filter(Boolean).join(' – ');
}

/** Relance par mail d'un service enquêteur pour une demande reçue. */
export function mailRelanceEnqueteurs(d: DemandeEntraide, service: ServiceEnqueteur | null, sig: SignataireEntraide | null): MailPret {
  const envoi = dateEnvoiEnqueteurs(d);
  const objet = `Relance – ${TYPE_COURTS[d.type]} ${d.pays} – N/réf ${d.refEsabora}${envoi ? ` – ST du ${dateFr(envoi)}` : ''}`;
  const corps = [
    'Bonjour,',
    '',
    `Par soit-transmis${envoi ? ` du ${dateFr(envoi)}` : ''}, le parquet vous a saisi de ${intitule(d.type, 'fr')} émanant des autorités ${d.pays ? `de ${d.pays}` : 'étrangères'} (N/réf ${d.refEsabora}${d.refEtrangere ? ` – V/réf ${d.refEtrangere}` : ''}).`,
    d.objet ? `Objet : ${d.objet}` : '',
    '',
    'Le délai de retour étant échu, je vous remercie de bien vouloir me faire connaître l’état d’avancement des investigations et, le cas échéant, de me retourner les procès-verbaux d’exécution dans les meilleurs délais.',
    '',
    'Bien cordialement,',
    '',
    signature(sig, 'fr'),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { id: 'relance_enqueteurs', libelle: 'Relance des enquêteurs', destinataire: service?.email || '', objet, corps };
}

/** Une seule relance pour toutes les demandes en retard d'un service. */
export function mailRelanceGroupee(service: ServiceEnqueteur, demandes: DemandeEntraide[], sig: SignataireEntraide | null, jour = aujourdhui()): MailPret {
  const lignes = demandes.map((d) => {
    const e = etatDemande(d, jour);
    const envoi = dateEnvoiEnqueteurs(d);
    return `- N/réf ${d.refEsabora} – ${TYPE_COURTS[d.type]} ${d.pays}${envoi ? ` – ST du ${dateFr(envoi)}` : ''}${e.echeance ? ` – retour attendu le ${dateFr(e.echeance.date)}` : ''}${d.objet ? ` – ${d.objet}` : ''}`;
  });
  const objet = `Relance – ${demandes.length} demande${demandes.length > 1 ? 's' : ''} d’entraide internationale en attente de retour`;
  const corps = [
    'Bonjour,',
    '',
    `Les demandes d’entraide internationale suivantes, confiées à votre service, sont en attente de retour au-delà du délai imparti :`,
    '',
    ...lignes,
    '',
    'Je vous remercie de bien vouloir me faire connaître l’état d’avancement de ces dossiers et, le cas échéant, de me retourner les procès-verbaux d’exécution dans les meilleurs délais.',
    '',
    'Bien cordialement,',
    '',
    signature(sig, 'fr'),
  ].join('\n');
  return { id: `relance_groupee_${service.id}`, libelle: `Relance groupée – ${service.libelle}`, destinataire: service.email || '', objet, corps };
}

/** Relance de l'autorité étrangère (demande émise) — même contenu que T4. */
export function mailRelanceAutorite(d: DemandeEntraide, a: AutoriteEtrangere | null, sig: SignataireEntraide | null, langue: EntraideLangue): MailPret {
  const envoi = dateEnvoiAutorite(d);
  if (langue === 'en') {
    return {
      id: 'relance_autorite_en',
      libelle: 'Relance de l’autorité (anglais)',
      destinataire: a?.email || '',
      objet: `Request for information on the progress of ${intitule(d.type, 'en')} – ${refs(d, 'en')}`,
      corps: [
        'Dear Sir or Madam,',
        '',
        `We would be grateful if you could inform us of the progress of ${intitule(d.type, 'en')} issued by the French judicial authorities${envoi ? ` and sent to you on ${dateLongue(envoi, 'en')}` : ''}, under reference ${d.refEtrangere || d.refEsabora}.`,
        '',
        'We understand that the execution of such requests takes time, and we thank you in advance for the attention you are giving to this matter. We would appreciate it if you could let us know, as far as possible, which steps have been taken or, where appropriate, the estimated time needed for their completion.',
        '',
        'Thank you in advance for your cooperation.',
        '',
        'Yours faithfully,',
        '',
        signature(sig, 'en'),
      ].join('\n'),
    };
  }
  return {
    id: 'relance_autorite_fr',
    libelle: 'Relance de l’autorité (français)',
    destinataire: a?.email || '',
    objet: `Demande de renseignements sur l’état d’avancement de ${intitule(d.type, 'fr')} – ${refs(d, 'fr')}`,
    corps: [
      'Madame, Monsieur,',
      '',
      `Nous nous permettons de solliciter votre bienveillance afin d’obtenir des informations sur l’état d’avancement de ${intitule(d.type, 'fr')} que les autorités judiciaires françaises vous ont transmise${envoi ? ` le ${dateFr(envoi)}` : ''}, sous la référence ${d.refEtrangere || d.refEsabora}.`,
      '',
      'Nous vous serions reconnaissants de bien vouloir nous informer, dans la mesure du possible, de l’avancement des diligences entreprises ou, le cas échéant, du délai estimé pour leur réalisation.',
      '',
      'En vous remerciant par avance de votre précieuse collaboration, nous vous prions d’agréer, Madame, Monsieur, l’expression de notre haute considération.',
      '',
      signature(sig, 'fr'),
    ].join('\n'),
  };
}

/** Mail d'accompagnement du retour (T3) à l'autorité requérante. */
export function mailRetourAutorite(d: DemandeEntraide, a: AutoriteEtrangere | null, sig: SignataireEntraide | null, langue: EntraideLangue): MailPret {
  if (langue === 'en') {
    return {
      id: 'retour_autorite_en',
      libelle: 'Retour à l’autorité (anglais)',
      destinataire: a?.email || '',
      objet: `Execution of ${intitule(d.type, 'en')} – ${refs(d, 'en')}`,
      corps: [
        'Dear Sir or Madam,',
        '',
        `We hereby inform you that ${intitule(d.type, 'en')} bearing your reference ${d.refEtrangere || '—'} has been executed. The execution documents are attached / have been sent to you by registered post.`,
        '',
        'We remain at your disposal for any further information.',
        '',
        'Yours faithfully,',
        '',
        signature(sig, 'en'),
      ].join('\n'),
    };
  }
  return {
    id: 'retour_autorite_fr',
    libelle: 'Retour à l’autorité (français)',
    destinataire: a?.email || '',
    objet: `Retour ${TYPE_COURTS[d.type]} avec exécution – ${refs(d, 'fr')}`,
    corps: [
      'Madame, Monsieur,',
      '',
      `Nous vous informons de la réalisation de ${intitule(d.type, 'fr')} dont vos références sont : ${d.refEtrangere || '—'}. Les pièces d’exécution sont jointes / vous sont adressées par lettre recommandée avec accusé de réception.`,
      '',
      'Nous restons à votre disposition pour tout complément d’information.',
      '',
      'Veuillez agréer, Madame, Monsieur, l’expression de notre haute considération.',
      '',
      signature(sig, 'fr'),
    ].join('\n'),
  };
}

/** Mails pertinents pour une demande, selon son sens. */
export function mailsDemande(
  d: DemandeEntraide,
  ctx: { autorite: AutoriteEtrangere | null; service: ServiceEnqueteur | null; signataire: SignataireEntraide | null },
): MailPret[] {
  const langue: EntraideLangue = ctx.autorite?.langue || 'fr';
  if (d.sens === 'recue') {
    return [
      mailRelanceEnqueteurs(d, ctx.service, ctx.signataire),
      mailRetourAutorite(d, ctx.autorite, ctx.signataire, langue),
      ...(langue === 'en' ? [mailRetourAutorite(d, ctx.autorite, ctx.signataire, 'fr')] : []),
    ];
  }
  return [
    mailRelanceAutorite(d, ctx.autorite, ctx.signataire, langue),
    ...(langue === 'en' ? [mailRelanceAutorite(d, ctx.autorite, ctx.signataire, 'fr')] : []),
  ];
}

/** Lien mailto: (Outlook) — objet et corps pré-remplis. */
export function lienMailto(m: MailPret): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%0A/g, '%0D%0A');
  return `mailto:${encodeURIComponent(m.destinataire || '')}?subject=${enc(m.objet)}&body=${enc(m.corps)}`;
}
