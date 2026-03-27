export type TagCategory = 'services' | 'infractions' | 'duree' | 'suivi' | 'statut' | 'juge';

export interface TagOrganization {
  section: string;
  subsection?: string;
  order?: number;
}

export interface TagDefinition {
  id: string;
  value: string;
  category: TagCategory;
  family?: string;    // Pour services uniquement
  order?: number;     // Ordre dans la famille
  organization?: TagOrganization;
}

export interface ServiceFamily {
  id: string;
  name: string;
  order: number;
}

export const TAG_CATEGORIES: Record<TagCategory, string> = {
  services: 'Services',
  infractions: 'Type d\'infractions',
  duree: 'Durée',
  suivi: 'Suivi',
  statut: 'Statut',
  juge: 'Juge'
};

// Plus de tags prédéfinis — l'utilisateur crée tout depuis l'interface

// Familles par défaut
export const DEFAULT_FAMILIES: ServiceFamily[] = [
  { id: 'sr_pj', name: 'SR & PJ', order: 1 },
  { id: 'brigades', name: 'BRIGADES', order: 2 },
  { id: 'slpj', name: 'SLPJ', order: 3 },
  { id: 'offices', name: 'OFFICES', order: 4 },
  { id: 'gendarmerie', name: 'GENDARMERIE', order: 5 }
];

// Utilitaires
export const getTagsByCategory = (tags: TagDefinition[], category: TagCategory): TagDefinition[] => {
  return tags.filter(tag => tag.category === category);
};

export const getServicesByFamily = (tags: TagDefinition[], familyId: string): TagDefinition[] => {
  return tags.filter(tag => tag.category === 'services' && tag.family === familyId);
};

export const getFamiliesFromTags = (tags: TagDefinition[]): ServiceFamily[] => {
  const familyMap = new Map<string, ServiceFamily>();
  
  tags
    .filter(tag => tag.category === 'services' && tag.family)
    .forEach(tag => {
      if (!familyMap.has(tag.family!)) {
        const defaultFamily = DEFAULT_FAMILIES.find(f => f.id === tag.family);
        familyMap.set(tag.family!, {
          id: tag.family!,
          name: defaultFamily?.name || tag.family!.replace(/_/g, ' ').toUpperCase(),
          order: defaultFamily?.order || 999
        });
      }
    });
  
  return Array.from(familyMap.values()).sort((a, b) => a.order - b.order);
};