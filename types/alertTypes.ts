export type AlertType = 'cr_delay' | 'acte_expiration' | 'enquete_age' | 'air_6_mois' | 'air_12_mois' | 'air_rdv_delai';
export type AlertStatus = 'active' | 'validated';
export type ActeType = 'all' | 'geolocalisation' | 'ecoute' | 'autre';

export interface AlertTypeConfig {
  label: string;
  description: string;
  defaultThreshold: number;
}

export const ALERT_TYPE_CONFIG: Record<AlertType, AlertTypeConfig> = {
  cr_delay: {
    label: 'Délai compte rendu',
    description: 'Alerte lorsqu\'aucun compte rendu n\'a été ajouté depuis {threshold} jours',
    defaultThreshold: 7
  },
  acte_expiration: {
    label: 'Expiration acte',
    description: 'Alerte lorsqu\'un acte arrive à expiration dans {threshold} jours',
    defaultThreshold: 7
  },
  enquete_age: {
    label: 'Âge enquête',
    description: 'Alerte lorsqu\'une enquête atteint {threshold} jours',
    defaultThreshold: 45
  },
  air_6_mois: {
    label: 'Mesure AIR > 6 mois',
    description: 'Alerte lorsqu\'une mesure AIR dépasse 6 mois',
    defaultThreshold: 180 // 6 mois en jours
  },
  air_12_mois: {
    label: 'Mesure AIR > 12 mois',
    description: 'Alerte lorsqu\'une mesure AIR dépasse 12 mois',
    defaultThreshold: 365 // 12 mois en jours
  },
  air_rdv_delai: {
    label: 'Délai depuis RDV AIR',
    description: 'Alerte lorsqu\'aucun RDV procureur depuis {threshold} jours',
    defaultThreshold: 45
  }
};