// utils/entraide/textes.ts
//
// Textes variables des courriers et des mails du module Entraide : intitulés
// selon le type de demande, intro des soit-transmis, bloc contact, dates en
// français et en anglais. Tout ce qui est propre au parquet (ville, ressort)
// vient de PAPETERIE.

import { PAPETERIE } from '@/lib/web/papeterie';
import { dateFr, lignesMesures, autoritesJudiciairesDe } from './logique';
import type {
  AutoriteEtrangere,
  DemandeEntraide,
  EntraideLangue,
  EntraideType,
  ServiceEnqueteur,
  SignataireEntraide,
} from '@/types/entraideTypes';

const INTITULES: Record<EntraideLangue, Record<EntraideType, string>> = {
  fr: {
    dee: 'la décision d’enquête européenne',
    cri: 'la commission rogatoire internationale',
    do: 'la dénonciation officielle',
    execution: 'la demande d’exécution',
    civil: 'la demande d’entraide civile internationale',
  },
  en: {
    dee: 'the European Investigation Order',
    cri: 'the letter rogatory',
    do: 'the request for proceedings (official denunciation)',
    execution: 'the request for execution',
    civil: 'the request for mutual assistance in civil matters',
  },
};

/** « la décision d'enquête européenne », « the letter rogatory »… */
export function intitule(type: EntraideType, langue: EntraideLangue): string {
  return INTITULES[langue][type];
}

/** Objet du courrier T3. */
export function objetRetour(type: EntraideType, langue: EntraideLangue): string {
  if (langue === 'en') {
    if (type === 'dee') return 'Return of the executed European Investigation Order';
    if (type === 'cri') return 'Return of the executed letter rogatory';
    return 'Return of the executed request';
  }
  if (type === 'dee') return 'Retour DEE avec exécution';
  if (type === 'cri') return 'Retour CRI avec exécution';
  return 'Retour de la demande d’entraide avec exécution';
}

/** Première phrase des soit-transmis T1/T2. */
export function introSoitTransmis(d: DemandeEntraide): string {
  const par = autoritesJudiciairesDe(d.pays);
  const ref = d.refEtrangere ? ` (V/réf : ${d.refEtrangere})` : '';
  switch (d.type) {
    case 'dee':
      return `Décision d’enquête européenne délivrée par ${par}${ref} aux fins d’exécuter les mesures d’enquête suivantes, citées en section C :`;
    case 'cri':
      return `Commission rogatoire internationale délivrée par ${par}${ref} aux fins d’exécuter les mesures suivantes :`;
    case 'do':
      return `Dénonciation officielle des faits adressée par ${par}${ref}, aux fins suivantes :`;
    case 'execution':
      return `Demande d’exécution délivrée par ${par}${ref}, aux fins suivantes :`;
    default:
      return `Demande d’entraide internationale délivrée par ${par}${ref}, aux fins suivantes :`;
  }
}

export function introRelance(d: DemandeEntraide): string {
  return `Bien vouloir m’informer de l’état d’avancement de ${intitule(d.type, 'fr')} suivante :`;
}

/** Lignes « Bien vouloir … » : le paragraphe retouché prime sur le catalogue. */
export function lignesDemande(d: DemandeEntraide): string[] {
  if (d.texteMesures && d.texteMesures.trim()) {
    return d.texteMesures.split('\n').map((l) => l.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
  }
  const lignes = lignesMesures(d.mesures, d.personnes);
  return lignes.length ? lignes : ['Bien vouloir exécuter les mesures sollicitées dans la demande jointe'];
}

const MOIS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function dateLongue(iso: string, langue: EntraideLangue): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return langue === 'en' ? `${Number(m[3])} ${MOIS_EN[Number(m[2]) - 1]} ${m[1]}` : dateFr(iso);
}

/** « Deputy Public Prosecutor » à partir de la fonction française. */
export function fonctionAnglaise(fonction: string): string {
  const f = (fonction || '').toLowerCase();
  if (f.includes('premier vice')) return 'First Deputy Public Prosecutor';
  if (f.includes('vice-procureur') || f.includes('vice procureur')) return 'Senior Deputy Public Prosecutor';
  if (f.includes('procureur adjoint') || f.includes('procureure adjointe')) return 'Assistant Public Prosecutor';
  if (f.includes('substitut')) return 'Deputy Public Prosecutor';
  if (f.includes('procureur')) return 'Public Prosecutor';
  if (f.includes('greff')) return 'Court Clerk';
  return fonction;
}

/** 03.22.82.47.07 → +33 3 22 82 47 07 (correspondants étrangers). */
export function telephoneInternational(tel: string): string {
  const chiffres = (tel || '').replace(/\D/g, '');
  if (chiffres.length === 10 && chiffres.startsWith('0')) {
    return `+33 ${chiffres[1]} ${chiffres.slice(2).replace(/(\d{2})(?=\d)/g, '$1 ')}`.trim();
  }
  return tel;
}

function minusculeInitiale(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** Phrase de contact des courriers T3/T4. */
export function contact(sig: SignataireEntraide | null, langue: EntraideLangue): string {
  if (!sig) return langue === 'en' ? 'the International Mutual Legal Assistance Department' : 'le service de l’entraide internationale';
  if (langue === 'en') {
    return `${sig.civilite === 'Mme' ? 'Ms' : 'Mr'} ${sig.prenomNom}, ${fonctionAnglaise(sig.fonction)} at the ${PAPETERIE.ville} Judicial Court,`;
  }
  return `${sig.civilite === 'Mme' ? 'Madame' : 'Monsieur'} ${sig.prenomNom}, ${minusculeInitiale(sig.fonction)} ${PAPETERIE.magistrat.ressort}`;
}

/** Libellé « Parquet de X » / « Tribunal de X » pour les trames T1/T2. */
export function demandeurTrame(a: AutoriteEtrangere | null, d: DemandeEntraide): { tribunal: string; parquet: string } {
  const ville = a?.ville || '';
  const nature = a?.nature;
  if (nature === 'tribunal' || nature === 'juge') return { tribunal: ville || a?.nom || '', parquet: '' };
  if (nature === 'parquet' || ville) return { tribunal: '', parquet: ville || a?.nom || '' };
  return { tribunal: '', parquet: a?.nom || d.autoriteNom || '' };
}

/** Ligne « Autre unité : … » d'un service. */
export function autreUnite(s: ServiceEnqueteur | null, d: DemandeEntraide): string {
  if (d.serviceAutre) return d.serviceAutre;
  if (s && s.cases.includes('autre')) return s.libelle;
  return '';
}

/** Date du dernier envoi de la demande à l'autorité étrangère (demande émise). */
export function dateEnvoiAutorite(d: DemandeEntraide): string | null {
  const envois = (d.evenements || []).filter((e) => e.type === 'envoi_autorite').map((e) => e.date).sort();
  return envois.length ? envois[envois.length - 1] : null;
}
