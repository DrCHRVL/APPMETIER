// utils/storage/validator.ts
import { APP_CONFIG } from '@/config/constants';

export const StorageValidator = {
  validateData: (data: any): boolean => {
    if (!data) return false;
    
    // Validation de base pour l'objet
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    
    // Si les données sont déjà dans un format d'enquêtes (array)
    if (Array.isArray(data)) {
      return data.every(item => 
        item && 
        typeof item === 'object' && 
        'id' in item && 
        'numero' in item
      );
    }
    
    // Validation pour un objet de sauvegarde
    const hasValidEnquetes = Array.isArray(data[APP_CONFIG.STORAGE_KEYS.ENQUETES]);
    const hasValidAlertRules = !data[APP_CONFIG.STORAGE_KEYS.ALERT_RULES] || 
      Array.isArray(data[APP_CONFIG.STORAGE_KEYS.ALERT_RULES]);
    const hasValidCustomTags = !data[APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS] || 
      (typeof data[APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS] === 'object' && 
       data[APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS] !== null);
    
    // Retourner true si au moins les enquêtes sont valides
    return hasValidEnquetes && hasValidAlertRules && hasValidCustomTags;
  },
  
  validateVersion: (version: number): boolean => {
    return Number.isInteger(version) && version >= 1;
  },
  
  validateBackupData: (backupData: any): boolean => {
    if (!backupData || typeof backupData !== 'object' || backupData === null) {
      return false;
    }
    
    // Vérifier si la structure contient au moins une clé importante
    const hasImportantKey = Object.keys(backupData).some(key => 
      key.includes('enquetes') || 
      key.includes('alertRules') || 
      key.includes('customTags')
    );
    
    return hasImportantKey;
  },
  
  // Fonction utilitaire pour vérifier la structure d'un tableau d'enquêtes
  validateEnquetes: (enquetes: any): boolean => {
    if (!Array.isArray(enquetes)) {
      return false;
    }
    
    return enquetes.every(enquete => {
      // Vérification de base pour une enquête
      return (
        enquete && 
        typeof enquete === 'object' &&
        typeof enquete.id === 'number' &&
        typeof enquete.numero === 'string' &&
        Array.isArray(enquete.comptesRendus) &&
        Array.isArray(enquete.tags)
      );
    });
  },
  
  // Fonction utilitaire pour vérifier la structure d'un tableau de règles d'alerte
  validateAlertRules: (rules: any): boolean => {
    if (!Array.isArray(rules)) {
      return false;
    }
    
    return rules.every(rule => {
      // Vérification de base pour une règle d'alerte
      return (
        rule &&
        typeof rule === 'object' &&
        typeof rule.id === 'number' &&
        typeof rule.type === 'string' &&
        typeof rule.name === 'string' &&
        typeof rule.enabled === 'boolean'
      );
    });
  },
  
  // Fonction utilitaire pour vérifier la structure des tags personnalisés
  validateCustomTags: (tags: any): boolean => {
    // Si customTags est undefined ou null, considérons-le comme valide (vide)
    if (!tags) {
      return true;
    }
    
    // Si ce n'est pas un objet, c'est invalide
    if (typeof tags !== 'object' || tags === null) {
      return false;
    }
    
    // Si c'est un tableau vide, c'est aussi valide
    if (Array.isArray(tags) && tags.length === 0) {
      return true;
    }
    
    // Si c'est un objet vide, c'est aussi valide
    if (Object.keys(tags).length === 0) {
      return true;
    }
    
    try {
      // Vérifier les propriétés des tags
      for (const category in tags) {
        // Vérifier que chaque catégorie est un tableau
        if (!Array.isArray(tags[category])) {
          console.warn(`La catégorie '${category}' n'est pas un tableau`);
          return false;
        }
        
        // Accepter les tableaux vides
        if (tags[category].length === 0) {
          continue;
        }
        
        // Vérifier chaque tag dans la catégorie
        for (let i = 0; i < tags[category].length; i++) {
          const tag = tags[category][i];
          
          // Accepter null ou undefined à l'intérieur d'un tableau (seront filtrés)
          if (tag === null || tag === undefined) {
            continue;
          }
          
          // Si c'est une simple chaîne, la convertir en objet avec structure correcte
          if (typeof tag === 'string') {
            tags[category][i] = {
              id: `legacy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              value: tag,
              category: category
            };
            continue;
          }
          
          // Vérifier et corriger la structure de l'objet tag
          if (typeof tag !== 'object' || tag === null) {
            console.warn(`Tag invalide à l'index ${i} dans la catégorie '${category}'`);
            return false;
          }
          
          // Si l'ID manque, en générer un
          if (!('id' in tag)) {
            tag.id = `autogen_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          }
          
          // Si la valeur manque, utiliser l'ID ou une valeur par défaut
          if (!('value' in tag)) {
            tag.value = tag.id || `Tag ${i}`;
          }
          
          // Ajouter la catégorie si manquante
          if (!('category' in tag)) {
            tag.category = category;
          }
        }
        
        // Nettoyer le tableau pour enlever les éléments null/undefined
        tags[category] = tags[category].filter(tag => tag !== null && tag !== undefined);
      }
      
      return true;
    } catch (error) {
      console.error('Erreur pendant la validation des tags:', error);
      // En cas d'erreur inattendue, permettre la sauvegarde
      return true;
    }
  }
};