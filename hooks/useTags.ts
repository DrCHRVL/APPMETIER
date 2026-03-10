import { useState, useEffect, useCallback, useRef } from 'react';
import { TagDefinition, TagCategory, TagOrganization, getTagsByCategory } from '@/config/tags';
import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { Tag } from '@/types/interfaces';

interface UseTagsReturn {
  // État
  tags: TagDefinition[];
  isLoading: boolean;
  
  // Sélecteurs
  getTagsByCategory: (category: TagCategory) => TagDefinition[];
  getTagById: (id: string) => TagDefinition | undefined;
  getTagByValue: (value: string, category?: TagCategory) => TagDefinition | undefined;
  getServicesFromTags: (tags: Tag[]) => string[];
  
  // CRUD Tags
  addTag: (tag: Omit<TagDefinition, 'id'>) => Promise<boolean>;
  updateTag: (id: string, updates: Partial<TagDefinition>) => Promise<boolean>;
  deleteTag: (id: string) => Promise<boolean>;
  
  // Organisation
  updateTagOrganization: (tagId: string, organization: TagOrganization | null) => Promise<boolean>;
  
  // Nettoyage et migration
  cleanupOrphanTags: () => Promise<{ found: string[], cleaned: number }>;
  recreateOrphanTags: (orphanTags: string[]) => Promise<number>;
}

export const useTags = (): UseTagsReturn => {
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Utilitaires
  const createTagId = useCallback((value: string, category: TagCategory) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${category}-${timestamp}-${random}`;
  }, []);

  // Fonction pour dériver les services depuis les tags
  const getServicesFromTags = useCallback((tags: Tag[]): string[] => {
    return tags
      .filter(tag => tag.category === 'services')
      .map(tag => tag.value)
      .filter(Boolean);
  }, []);

  // Fonction de propagation des changements de tags
  const propagateTagChange = useCallback(async (oldValue: string, newValue: string, category: TagCategory) => {
    try {
      console.log(`Propagation du tag "${oldValue}" → "${newValue}" (${category})`);
      
      // Mettre à jour les enquêtes
      const enquetes = await ElectronBridge.getData(APP_CONFIG.STORAGE_KEYS.ENQUETES, []);
      if (Array.isArray(enquetes)) {
        let modifiedCount = 0;
        
        const updatedEnquetes = enquetes.map((enquete: any) => {
          let hasModification = false;
          let updatedEnquete = { ...enquete };
          
          // Mettre à jour les tags
          if (enquete.tags && Array.isArray(enquete.tags)) {
            let updatedTags;
            if (newValue === '') {
              // Suppression : retirer le tag de la liste
              updatedTags = enquete.tags.filter((tag: any) => {
                const tagValue = typeof tag === 'string' ? tag : tag.value;
                const tagCategory = typeof tag === 'string' ? category : tag.category;
                if (tagCategory === category && tagValue === oldValue) {
                  hasModification = true;
                  return false;
                }
                return true;
              });
            } else {
              // Renommage : mettre à jour la valeur
              updatedTags = enquete.tags.map((tag: any) => {
                const tagValue = typeof tag === 'string' ? tag : tag.value;
                const tagCategory = typeof tag === 'string' ? category : tag.category;

                if (tagCategory === category && tagValue === oldValue) {
                  hasModification = true;
                  if (typeof tag === 'string') {
                    return {
                      id: createTagId(newValue, category),
                      value: newValue,
                      category: category,
  
                    };
                  }
                  return { ...tag, value: newValue };
                }
                return tag;
              });
            }

            if (hasModification) {
              updatedEnquete.tags = updatedTags;
            }
          }

          // Nettoyer services[] si c'est un service (pour éviter la désync)
          if (category === 'services' && enquete.services && Array.isArray(enquete.services)) {
            if (newValue === '') {
              // Suppression
              const filteredServices = enquete.services.filter((service: string) => service !== oldValue);
              if (filteredServices.length !== enquete.services.length) {
                updatedEnquete.services = filteredServices;
                hasModification = true;
              }
            } else {
              // Renommage
              const updatedServices = enquete.services.map((service: string) =>
                service === oldValue ? newValue : service
              );
              if (JSON.stringify(updatedServices) !== JSON.stringify(enquete.services)) {
                updatedEnquete.services = updatedServices;
                hasModification = true;
              }
            }
          }
          
          if (hasModification) {
            modifiedCount++;
            updatedEnquete.dateMiseAJour = new Date().toISOString();
          }
          
          return updatedEnquete;
        });
        
        if (modifiedCount > 0) {
          await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.ENQUETES, updatedEnquetes);
          console.log(`${modifiedCount} enquête(s) mise(s) à jour`);
        }
      }
      
      // Mettre à jour les instructions
      const instructions = await ElectronBridge.getData('instructions', []);
      if (Array.isArray(instructions)) {
        let modifiedCount = 0;
        
        const updatedInstructions = instructions.map((instruction: any) => {
          if (!instruction.tags || !Array.isArray(instruction.tags)) return instruction;

          let hasModification = false;
          let updatedTags;

          if (newValue === '') {
            // Suppression : retirer le tag de la liste
            updatedTags = instruction.tags.filter((tag: any) => {
              const tagValue = typeof tag === 'string' ? tag : tag.value;
              const tagCategory = typeof tag === 'string' ? category : tag.category;
              if (tagCategory === category && tagValue === oldValue) {
                hasModification = true;
                return false;
              }
              return true;
            });
          } else {
            // Renommage : mettre à jour la valeur
            updatedTags = instruction.tags.map((tag: any) => {
              const tagValue = typeof tag === 'string' ? tag : tag.value;
              const tagCategory = typeof tag === 'string' ? category : tag.category;

              if (tagCategory === category && tagValue === oldValue) {
                hasModification = true;
                if (typeof tag === 'string') {
                  return {
                    id: createTagId(newValue, category),
                    value: newValue,
                    category: category,

                  };
                }
                return { ...tag, value: newValue };
              }

              return tag;
            });
          }

          if (hasModification) {
            modifiedCount++;
            return {
              ...instruction,
              tags: updatedTags,
              dateMiseAJour: new Date().toISOString()
            };
          }

          return instruction;
        });
        
        if (modifiedCount > 0) {
          await ElectronBridge.setData('instructions', updatedInstructions);
          console.log(`${modifiedCount} instruction(s) mise(s) à jour`);
        }
      }
      
    } catch (error) {
      console.error('Erreur lors de la propagation:', error);
      throw error;
    }
  }, [createTagId]);

  // Initialisation
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);
        
        const tagsData = await ElectronBridge.getData('tags', []);
        const migratedTags = Array.isArray(tagsData) ? tagsData : (tagsData?.data || []);
        setTags(Array.isArray(migratedTags) ? migratedTags : []);
        
      } catch (error) {
        console.error('Error initializing tags:', error);
        setTags([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    initialize();
  }, []);

  // Sauvegarde automatique avec debounce
  const debouncedSave = useCallback(async (tagsToSave: TagDefinition[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await ElectronBridge.setData('tags', tagsToSave);
      } catch (error) {
        console.error('Error saving tags:', error);
      }
    }, 500);
  }, []);

  // Sauvegarder les tags quand ils changent
  useEffect(() => {
    if (!isLoading) {
      debouncedSave(tags);
    }
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tags, isLoading, debouncedSave]);

  // Sélecteurs
  const getTagsByCategoryMemo = useCallback((category: TagCategory) => {
    return getTagsByCategory(tags, category);
  }, [tags]);

  const getTagById = useCallback((id: string) => {
    return tags.find(tag => tag.id === id);
  }, [tags]);

  const getTagByValue = useCallback((value: string, category?: TagCategory) => {
    return tags.find(tag => 
      tag.value === value && (category ? tag.category === category : true)
    );
  }, [tags]);

  const validateTag = useCallback((tag: Partial<TagDefinition>): string | null => {
    if (!tag.value || tag.value.trim() === '') {
      return 'La valeur du tag ne peut pas être vide';
    }
    
    if (!tag.category) {
      return 'La catégorie est obligatoire';
    }
    
    // Vérifier unicité de la valeur dans la catégorie
    const existingTag = tags.find(t => 
      t.value.toLowerCase() === tag.value!.toLowerCase() && 
      t.category === tag.category &&
      t.id !== tag.id
    );
    
    if (existingTag) {
      return `Un tag "${tag.value}" existe déjà dans cette catégorie`;
    }
    
    return null;
  }, [tags]);

  // Fonction de nettoyage des tags orphelins
  const cleanupOrphanTags = useCallback(async (): Promise<{ found: string[], cleaned: number }> => {
    try {
      console.log('🧹 Recherche des tags orphelins...');
      
      // Récupérer tous les tags utilisés dans les enquêtes et instructions
      const enquetes = await ElectronBridge.getData(APP_CONFIG.STORAGE_KEYS.ENQUETES, []);
      const instructions = await ElectronBridge.getData('instructions', []);
      
      const usedTags = new Set<string>();
      
      // Parcourir les enquêtes
      enquetes.forEach((enquete: any) => {
        if (enquete.tags && Array.isArray(enquete.tags)) {
          enquete.tags.forEach((tag: any) => {
            const tagValue = typeof tag === 'string' ? tag : tag.value;
            if (tagValue) usedTags.add(tagValue);
          });
        }
      });
      
      // Parcourir les instructions
      instructions.forEach((instruction: any) => {
        if (instruction.tags && Array.isArray(instruction.tags)) {
          instruction.tags.forEach((tag: any) => {
            const tagValue = typeof tag === 'string' ? tag : tag.value;
            if (tagValue) usedTags.add(tagValue);
          });
        }
      });
      
      // Tags centralisés disponibles
      const centralTagValues = new Set(tags.map(tag => tag.value));
      const orphanTags: string[] = [];
      
      // Tags utilisés dans les enquêtes mais ABSENTS de la gestion centrale
      usedTags.forEach(tagValue => {
        if (!centralTagValues.has(tagValue)) {
          orphanTags.push(tagValue);
        }
      });
      
      console.log(`📊 Tags orphelins trouvés: ${orphanTags.length}`);
      
      return { found: orphanTags, cleaned: 0 };
      
    } catch (error) {
      console.error('Erreur lors du nettoyage:', error);
      return { found: [], cleaned: 0 };
    }
  }, [tags]);

  // CRUD Tags
  const addTag = useCallback(async (newTag: Omit<TagDefinition, 'id'>): Promise<boolean> => {
    try {
      const validation = validateTag(newTag);
      if (validation) {
        throw new Error(validation);
      }
      
      const tagWithId: TagDefinition = {
        ...newTag,
        id: createTagId(newTag.value, newTag.category)
      };
      
      setTags(prev => [...prev, tagWithId]);
      return true;
      
    } catch (error) {
      console.error('Error adding tag:', error);
      return false;
    }
  }, [createTagId, validateTag]);

  // Fonction pour recréer les tags manquants
  const recreateOrphanTags = useCallback(async (orphanTagsToRecreate: string[]): Promise<number> => {
    try {
      console.log('🔧 Recréation des tags orphelins...');
      let createdCount = 0;
      
      for (const tagValue of orphanTagsToRecreate) {
        // Essayer de deviner la catégorie
        let category: TagCategory = 'services';
        const upperValue = tagValue.toUpperCase();
        
        if (['SR', 'PJ', 'BAC', 'BRIGADE', 'SLPJ', 'GENDARMERIE', 'SRPJ', 'BRI', 'CSP'].some(s => upperValue.includes(s))) {
          category = 'services';
        } else if (['STUP', 'VOL', 'ESCROQUERIE', 'VIOLENCE', 'HOMICIDE', 'TRAFIC', 'BLANCHIMENT'].some(s => upperValue.includes(s))) {
          category = 'infractions';
        } else if (tagValue.includes('enquête') || tagValue.includes('jours')) {
          category = 'duree';
        } else if (tagValue.toLowerCase().includes('prioritaire')) {
          category = 'priorite';
        }
        
        // Vérifier que le tag n'existe pas déjà 
        const existing = tags.find(t => t.value === tagValue && t.category === category);
        if (!existing) {
          const success = await addTag({
            value: tagValue,
            category: category
          });
          
          if (success) {
            createdCount++;
            console.log(`✅ Tag recréé: "${tagValue}" (${category})`);
          }
        }
      }
      
      console.log(`🎉 ${createdCount} tags orphelins recréés`);
      return createdCount;
      
    } catch (error) {
      console.error('Erreur lors de la recréation:', error);
      return 0;
    }
  }, [tags, addTag]);

  const updateTag = useCallback(async (id: string, updates: Partial<TagDefinition>): Promise<boolean> => {
    try {
      const existingTag = getTagById(id);
      if (!existingTag) {
        throw new Error('Tag non trouvé');
      }
      
      const updatedTag = { ...existingTag, ...updates };
      const validation = validateTag(updatedTag);
      if (validation) {
        throw new Error(validation);
      }
      
      // Si la valeur change, propager le changement
      if (updates.value && updates.value !== existingTag.value) {
        await propagateTagChange(existingTag.value, updates.value, existingTag.category);
      }
      
      // Mettre à jour l'état local
      setTags(prev => prev.map(tag => 
        tag.id === id ? updatedTag : tag
      ));
      
      return true;
      
    } catch (error) {
      console.error('Error updating tag:', error);
      return false;
    }
  }, [getTagById, validateTag, propagateTagChange]);

  const deleteTag = useCallback(async (id: string): Promise<boolean> => {
    try {
      const tagToDelete = getTagById(id);
      if (!tagToDelete) {
        throw new Error('Tag non trouvé');
      }
      
      // Supprimer des enquêtes et instructions
      await propagateTagChange(tagToDelete.value, '', tagToDelete.category);
      
      setTags(prev => prev.filter(tag => tag.id !== id));
      return true;
      
    } catch (error) {
      console.error('Error deleting tag:', error);
      return false;
    }
  }, [getTagById, propagateTagChange]);

  // Organisation
  const updateTagOrganization = useCallback(async (tagId: string, organization: TagOrganization | null): Promise<boolean> => {
    try {
      const success = await updateTag(tagId, { organization });
      return success;
    } catch (error) {
      console.error('Error updating tag organization:', error);
      return false;
    }
  }, [updateTag]);

  return {
    // État
    tags,
    isLoading,
    
    // Sélecteurs
    getTagsByCategory: getTagsByCategoryMemo,
    getTagById,
    getTagByValue,
    getServicesFromTags,
    
    // CRUD
    addTag,
    updateTag,
    deleteTag,
    
    // Organisation
    updateTagOrganization,
    
    // Nettoyage et migration
    cleanupOrphanTags,
    recreateOrphanTags
  };
};