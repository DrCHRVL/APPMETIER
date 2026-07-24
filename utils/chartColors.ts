// Couleurs des graphiques de la page Statistiques — la SOURCE UNIQUE vit dans
// le module partagé lib/stats/chartCouleurs.mjs (également consommé par le
// service attaché, pour que ses graphiques PNG portent exactement les couleurs
// de l'app). Ce fichier n'apporte que le typage.

import {
  CHART_COLORS as CHART_COLORS_CORE,
  getServiceColor as getServiceColorCore,
  ORIENTATION_DATASETS as ORIENTATION_DATASETS_CORE,
} from '@/lib/stats/chartCouleurs.mjs';

export const CHART_COLORS: string[] = CHART_COLORS_CORE;

// Couleur stable par service (basée sur le hash du nom, pas sur l'index)
export const getServiceColor = (service: string, _index?: number): string =>
  getServiceColorCore(service, _index);

// Constantes de couleurs orientations
export const ORIENTATION_DATASETS = ORIENTATION_DATASETS_CORE as ReadonlyArray<{
  key: 'nombreCRPC' | 'nombreCI' | 'nombreCOPJ' | 'nombreOI' | 'nombreCDD' | 'nombreClassements';
  label: string;
  color: string;
}>;
