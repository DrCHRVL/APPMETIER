export type TagCategory = 'services' | 'infractions' | 'duree' | 'priorite' | 'statut' | 'juge';

export interface TagDefinition {
  id: string;
  value: string;
  category: TagCategory;
  family?: string;    // Pour services uniquement
  order?: number;     // Ordre dans la famille
  isCustom: boolean;  // true = créé par utilisateur, false = prédéfini
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
  priorite: 'Priorité',
  statut: 'Statut',
  juge: 'Juge'
};

// Tags prédéfinis - source unique de vérité
export const DEFAULT_TAGS: TagDefinition[] = [
  // Services SR/PJ
  { id: 'service-sr-amiens', value: 'SR Amiens', category: 'services', family: 'sr_pj', order: 1, isCustom: false },
  { id: 'service-sipj-amiens', value: 'SIPJ Amiens', category: 'services', family: 'sr_pj', order: 2, isCustom: false },
  
  // Brigades
  { id: 'service-br-roye', value: 'BR ROYE', category: 'services', family: 'brigades', order: 1, isCustom: false },
  { id: 'service-br-abbeville', value: 'BR ABBEVILLE', category: 'services', family: 'brigades', order: 2, isCustom: false },
  { id: 'service-br-amiens', value: 'BR AMIENS', category: 'services', family: 'brigades', order: 3, isCustom: false },
  
  // SLPJ
  { id: 'service-slpj-amiens', value: 'SLPJ Amiens', category: 'services', family: 'slpj', order: 1, isCustom: false },
  { id: 'service-slpj-abbeville', value: 'SLPJ Abbeville', category: 'services', family: 'slpj', order: 2, isCustom: false },
  
  // Offices
  { id: 'service-ocldi', value: 'OCLDI', category: 'services', family: 'offices', order: 1, isCustom: false },
  { id: 'service-oltim', value: 'OLTIM', category: 'services', family: 'offices', order: 2, isCustom: false },
  
  // Gendarmerie
  { id: 'service-gir', value: 'GIR', category: 'services', family: 'gendarmerie', order: 1, isCustom: false },
  
  // Infractions
  { id: 'infraction-narcotrafic', value: 'NarcoTrafic', category: 'infractions', isCustom: false },
  { id: 'infraction-armes', value: 'Trafic d\'armes', category: 'infractions', isCustom: false },
  { id: 'infraction-esi', value: 'Trafic d\'ESI', category: 'infractions', isCustom: false },
  { id: 'infraction-cambriolages', value: 'Cambriolages', category: 'infractions', isCustom: false },
  { id: 'infraction-lambda', value: 'Lambda (non CrimOrg)', category: 'infractions', isCustom: false },
  
  // Durée
  { id: 'duree-2-mois', value: 'enquête de plus de 2 mois', category: 'duree', isCustom: false },
  { id: 'duree-6-mois', value: 'enquête de plus de 6 mois', category: 'duree', isCustom: false },
  { id: 'duree-a-venir', value: 'enquête à venir', category: 'duree', isCustom: false },
  
  // Priorité
  { id: 'priorite-prioritaire', value: 'Prioritaire', category: 'priorite', isCustom: false }
];

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