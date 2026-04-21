// Palette centralisée des couleurs par contentieux — partagée entre
// CoSaisineSection et TransfertContentieuxSection pour garder une
// cohérence visuelle des badges/boutons côté modal.

export interface ContentieuxColorSet {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

export const CTX_COLORS: Record<string, ContentieuxColorSet> = {
  crimorg: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' },
  ecofi:   { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', dot: 'bg-blue-500' },
  enviro:  { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300', dot: 'bg-green-500' },
};

export const DEFAULT_CTX_COLOR: ContentieuxColorSet = {
  bg: 'bg-gray-50',
  text: 'text-gray-700',
  border: 'border-gray-300',
  dot: 'bg-gray-500',
};

export const getContentieuxColors = (contentieuxId: string): ContentieuxColorSet =>
  CTX_COLORS[contentieuxId] || DEFAULT_CTX_COLOR;
