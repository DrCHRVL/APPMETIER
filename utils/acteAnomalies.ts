import { Enquete } from '@/types/interfaces';

// Au-delà de cette durée, la date de fin d'un acte (écoute / géoloc) est
// considérée comme aberrante : une écoute/géoloc en préliminaire est plafonnée
// à ~2 ans (renouvellements mensuels). Aligné sur MAX_DUREE_ESTIMABLE_JOURS
// du décompte des prolongations (useActeStats).
const MAX_DUREE_PLAUSIBLE_JOURS = 760; // ~25 mois
// Bornes d'années plausibles pour repérer une année manifestement mal saisie.
const ANNEE_MIN = 2000;
const MARGE_ANNEES_FUTUR = 5;

const MS_PAR_JOUR = 1000 * 60 * 60 * 24;

export interface ActeAberrant {
  enqueteId: number;
  enqueteNumero: string;
  type: 'Écoute' | 'Géolocalisation' | 'Autre acte';
  libelle: string;
  dateDebut: string;
  dateFin: string;
  raison: string;
}

type ActeLike = {
  dateDebut?: string;
  dateFin?: string;
};

// Renvoie l'année si la date est exploitable, sinon null.
function anneeDe(date: string | undefined): number | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear();
}

// Identifie la raison rendant un acte aberrant, ou null si tout est cohérent.
// `estimeParDuree` : vrai pour écoutes/géolocs (contrôle de durée pertinent).
function raisonAberration(acte: ActeLike, estimeParDuree: boolean): string | null {
  const anneeMax = new Date().getFullYear() + MARGE_ANNEES_FUTUR;

  // Date présente mais illisible.
  if (acte.dateDebut && isNaN(new Date(acte.dateDebut).getTime())) {
    return 'date de début illisible';
  }
  if (acte.dateFin && isNaN(new Date(acte.dateFin).getTime())) {
    return 'date de fin illisible';
  }

  // Année manifestement hors plage (faute de frappe sur l'année).
  const anneeDebut = anneeDe(acte.dateDebut);
  const anneeFin = anneeDe(acte.dateFin);
  for (const annee of [anneeDebut, anneeFin]) {
    if (annee !== null && (annee < ANNEE_MIN || annee > anneeMax)) {
      return `année improbable (${annee})`;
    }
  }

  // Incohérence / durée invraisemblable entre début et fin.
  if (acte.dateDebut && acte.dateFin && anneeDebut !== null && anneeFin !== null) {
    const dureeJours = Math.floor(
      (new Date(acte.dateFin).getTime() - new Date(acte.dateDebut).getTime()) / MS_PAR_JOUR
    );
    if (dureeJours < 0) {
      return 'date de fin antérieure au début';
    }
    if (estimeParDuree && dureeJours > MAX_DUREE_PLAUSIBLE_JOURS) {
      const ans = (dureeJours / 365).toFixed(dureeJours > 3650 ? 0 : 1);
      return `durée de ${dureeJours} j (~${ans} ans)`;
    }
  }

  return null;
}

/**
 * Repère les actes (écoutes, géolocs, autres) dont les dates sont manifestement
 * erronées : date illisible, année hors plage, fin antérieure au début, ou
 * durée invraisemblable (écoute/géoloc). Sert à localiser une donnée corrompue
 * — typiquement celle qui faisait exploser les totaux du tableau de bord.
 */
export function detectActesAberrants(enquetes: Enquete[]): ActeAberrant[] {
  const anomalies: ActeAberrant[] = [];

  for (const e of enquetes) {
    const numero = e.numero || `#${e.id}`;

    for (const ec of e.ecoutes || []) {
      const raison = raisonAberration(ec, true);
      if (raison) {
        anomalies.push({
          enqueteId: e.id,
          enqueteNumero: numero,
          type: 'Écoute',
          libelle: ec.numero || ec.cible || `#${ec.id}`,
          dateDebut: ec.dateDebut || '',
          dateFin: ec.dateFin || '',
          raison,
        });
      }
    }

    for (const g of e.geolocalisations || []) {
      const raison = raisonAberration(g, true);
      if (raison) {
        anomalies.push({
          enqueteId: e.id,
          enqueteNumero: numero,
          type: 'Géolocalisation',
          libelle: g.objet || `#${g.id}`,
          dateDebut: g.dateDebut || '',
          dateFin: g.dateFin || '',
          raison,
        });
      }
    }

    for (const a of e.actes || []) {
      // Pas de contrôle de durée pour les « autres actes » (pas de plafond
      // légal homogène) ; on ne repère que les dates illisibles / incohérentes.
      const raison = raisonAberration(a, false);
      if (raison) {
        anomalies.push({
          enqueteId: e.id,
          enqueteNumero: numero,
          type: 'Autre acte',
          libelle: a.type || `#${a.id}`,
          dateDebut: a.dateDebut || '',
          dateFin: a.dateFin || '',
          raison,
        });
      }
    }
  }

  return anomalies;
}
