// types/airConfigTypes.ts
//
// Configuration des délais du module AIR : seuils qui pilotent les alertes de
// convocation Procureur (Urgent / Retard probable / Suivi insuffisant) ainsi
// que les seuils « mesures anciennes ». Éditable depuis l'écran Paramètres →
// module AIR et consommée par le dashboard (AIRDashboardIntegrated).

export interface AIRConvocationConfig {
  /** Cadence de RDV attendue devant le Procureur : 1 RDV tous les N mois. */
  cadenceRDVMois: number;

  /** Urgent à convoquer : ancienneté ≥ N mois ET nombre de RDV ≤ M. */
  urgentAgeMois: number;
  urgentMaxRDV: number;

  /** Retard probable : ancienneté ≥ N mois ET retard de RDV ≥ M. */
  retardAgeMois: number;
  retardMinRetardRDV: number;

  /** Suivi insuffisant : ancienneté ≥ N mois ET retard de RDV ≥ M. */
  insuffisantAgeMois: number;
  insuffisantMinRetardRDV: number;

  /** Seuil « mesures anciennes » (carte + 6 mois, recommandation clôture). */
  ancienneteMois: number;
  /** Seuil « mesures très anciennes » (alerte système > 12 mois). */
  tresAncienneteMois: number;

  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_AIR_CONVOCATION_CONFIG: AIRConvocationConfig = {
  cadenceRDVMois: 1.75,
  urgentAgeMois: 4,
  urgentMaxRDV: 0,
  retardAgeMois: 6,
  retardMinRetardRDV: 2,
  insuffisantAgeMois: 8,
  insuffisantMinRetardRDV: 1,
  ancienneteMois: 6,
  tresAncienneteMois: 12,
};
