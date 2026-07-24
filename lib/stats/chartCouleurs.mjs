/**
 * SIRAL — charte des couleurs de graphiques statistiques.
 *
 * SOURCE UNIQUE, partagée par :
 *  - l'écran Chart.js et l'export PDF (utils/chartColors.ts, re-export typé) ;
 *  - le service attaché (scripts/attache/statsGraphiques.mjs), pour que les
 *    graphiques PNG remis à l'agent portent EXACTEMENT les couleurs de l'app.
 */

export const CHART_COLORS = [
  '#34495e', '#3498db', '#2ecc71', '#16a085', '#e74c3c', '#c0392b',
  '#f1c40f', '#f39c12', '#9b59b6', '#8e44ad', '#1abc9c', '#7f8c8d',
  '#d35400', '#27ae60', '#2980b9', '#95a5a6',
]

// Couleur stable par service (basée sur le hash du nom, pas sur l'index)
export const getServiceColor = (service, _index) => {
  let hash = 0
  const s = String(service)
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colorIndex = Math.abs(hash) % CHART_COLORS.length
  return CHART_COLORS[colorIndex]
}

// Constantes de couleurs orientations (clés = champs d'AudienceStats)
export const ORIENTATION_DATASETS = [
  { key: 'nombreCRPC', label: 'CRPC', color: '#34495e' },
  { key: 'nombreCI', label: 'CI', color: '#3498db' },
  { key: 'nombreCOPJ', label: 'COPJ', color: '#2ecc71' },
  { key: 'nombreOI', label: 'OI', color: '#95a5a6' },
  { key: 'nombreCDD', label: 'CDD', color: '#E8D0A9' },
  { key: 'nombreClassements', label: 'Classement', color: '#e74c3c' },
]
