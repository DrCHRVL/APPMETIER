import { useState, useEffect, useCallback, useRef } from 'react';
import { TagDefinition, TagCategory, TagOrganization, getTagsByCategory } from '@/config/tags';
import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { Tag, Enquete } from '@/types/interfaces';
import { tagSyncService, DELETED_TAG_IDS_KEY } from '@/utils/dataSync/TagSyncService';
import { emitSyncCompleted } from '@/utils/dataSync/globalSyncCommon';
import type { TagTombstone } from '@/types/globalSyncTypes';
import { ContentieuxManager } from '@/utils/contentieuxManager';
import { MultiSyncManager } from '@/utils/dataSync/MultiSyncManager';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import type { ContentieuxId } from '@/types/userTypes';

export interface DuplicateTagGroup {
  value: string;           // valeur "canonique" (celle du tag conservé)
  category: TagCategory;
  count: number;           // nombre total de tags dans le groupe (>= 2)
  removedCount: number;    // nombre qui seront supprimés = count - 1
}

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
  // Fusion : remplace toutes les références à `sourceId` par `targetId` dans
  // les enquêtes de tous les contentieux chargés, puis supprime le tag source
  // de la gestion centrale. Les deux tags doivent appartenir à la même
  // catégorie. Retourne le nombre d'enquêtes impactées (ou -1 en cas d'erreur).
  mergeTags: (sourceId: string, targetId: string) => Promise<number>;

  // Organisation
  updateTagOrganization: (tagId: string, organization: TagOrganization | null) => Promise<boolean>;

  // Utilitaire
  getTagUsageCount: (tagValue: string, category: TagCategory) => Promise<number>;

  // Nettoyage et migration
  cleanupOrphanTags: () => Promise<{ found: string[], cleaned: number }>;
  recreateOrphanTags: (orphanTags: string[]) => Promise<number>;

  // Déduplication (doublons issus des migrations)
  findDuplicateTags: () => DuplicateTagGroup[];
  mergeDuplicateTags: () => Promise<number>;
}

export const useTags = (): UseTagsReturn => {
  const [tags, setTags] = useState<TagDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  // Snapshot sérialisé du dernier état connu comme "déjà sauvegardé".
  // Permet d'éviter un push inutile quand `setTags` provient d'une
  // hydratation (init + event sync) plutôt que d'une édition utilisateur.
  const lastPersistedRef = useRef<string>('');

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

  // Applique une transformation à la liste de tags + services[] d'une enquête.
  // Retourne null si rien n'a changé, l'enquête mise à jour sinon (avec
  // dateMiseAJour rafraîchie). Utilisé pour la propagation (rename/delete) et
  // la fusion : la logique ne dépend pas du persiste cible.
  const applyEnqueteTagTransform = useCallback((
    enquete: any,
    transform: {
      // null = supprimer ; sinon = nouvelle valeur (rename/merge target)
      tagMatcher: (tagValue: string, tagCategory: TagCategory | null) => boolean;
      replacement: { value: string; category: TagCategory; id?: string } | null;
      // pour services[] (catégorie services uniquement)
      servicesMatch?: (service: string) => boolean;
      servicesReplacement?: string | null;
    }
  ): any | null => {
    let hasModification = false;
    const updated = { ...enquete };

    if (Array.isArray(enquete.tags)) {
      const seenValues = new Set<string>(); // dédup par catégorie+valeur (anti-doublon après merge)
      const newTags: any[] = [];

      for (const tag of enquete.tags) {
        const tagValue = typeof tag === 'string' ? tag : tag.value;
        const tagCategory: TagCategory | null = typeof tag === 'string' ? null : tag.category;

        if (transform.tagMatcher(tagValue, tagCategory)) {
          hasModification = true;
          if (transform.replacement === null) {
            continue; // suppression
          }
          // remplacement (rename ou merge) — privilégie l'id explicite (merge),
          // puis l'id du tag remplacé (rename), puis génère un id (legacy
          // string-tag).
          const replId =
            transform.replacement.id
            ?? (typeof tag !== 'string' ? tag.id : undefined)
            ?? createTagId(transform.replacement.value, transform.replacement.category);
          const repl = {
            id: replId,
            value: transform.replacement.value,
            category: transform.replacement.category,
          };
          const dedupKey = `${repl.category}::${repl.value}`;
          if (seenValues.has(dedupKey)) continue;
          seenValues.add(dedupKey);
          newTags.push(repl);
        } else {
          if (typeof tag !== 'string') {
            const dedupKey = `${tag.category}::${tag.value}`;
            if (seenValues.has(dedupKey)) continue;
            seenValues.add(dedupKey);
          }
          newTags.push(tag);
        }
      }

      if (hasModification) updated.tags = newTags;
    }

    // services[] (catégorie services uniquement)
    if (transform.servicesMatch && Array.isArray(enquete.services)) {
      if (transform.servicesReplacement === null) {
        const filtered = enquete.services.filter((s: string) => !transform.servicesMatch!(s));
        if (filtered.length !== enquete.services.length) {
          updated.services = filtered;
          hasModification = true;
        }
      } else {
        const replacement = transform.servicesReplacement!;
        let changed = false;
        const remapped = enquete.services.map((s: string) => {
          if (transform.servicesMatch!(s)) {
            changed = true;
            return replacement;
          }
          return s;
        });
        if (changed) {
          // dédoublonner si la fusion crée des doublons
          updated.services = Array.from(new Set(remapped));
          hasModification = true;
        }
      }
    }

    if (!hasModification) return null;
    updated.dateMiseAJour = new Date().toISOString();
    return updated;
  }, [createTagId]);

  // Itère sur tous les contentieux chargés et applique `transformEnquete` à
  // chacune de leurs enquêtes. Met à jour le store Zustand pour le contentieux
  // actif (UI immédiate) et le ContentieuxManager pour les autres. Déclenche la
  // sync serveur pour chaque contentieux modifié.
  const updateEnquetesAcrossContentieux = useCallback(async (
    transformEnquete: (enquete: any) => any | null,
  ): Promise<number> => {
    const manager = ContentieuxManager.getInstance();
    const multiSync = MultiSyncManager.getInstance();
    const store = useEnquetesStore.getState();
    const activeId = store.contentieuxId;
    let totalModified = 0;

    for (const contentieuxId of manager.getLoadedContentieuxIds()) {
      if (manager.getSyncMode(contentieuxId) === 'read_only') continue;

      // Pour le contentieux actif, on travaille à partir des enquêtes du store
      // (qui est la source de vérité de l'UI) plutôt que de celles du manager
      // qui peuvent être plus anciennes si une édition n'a pas encore été
      // flushée.
      const source: Enquete[] = contentieuxId === activeId
        ? useEnquetesStore.getState().ownEnquetes
        : manager.getEnquetes(contentieuxId);

      let modifiedCount = 0;
      const updated: Enquete[] = source.map(enquete => {
        const next = transformEnquete(enquete);
        if (next) {
          modifiedCount++;
          return next as Enquete;
        }
        return enquete;
      });

      if (modifiedCount === 0) continue;
      totalModified += modifiedCount;

      // Persistance
      await manager.setEnquetes(contentieuxId as ContentieuxId, updated);

      if (contentieuxId === activeId) {
        // Resynchroniser le store Zustand : ses propres écritures ne passent
        // pas par le manager, donc l'UI ne se rafraîchirait pas autrement.
        await useEnquetesStore.getState().loadEnquetes();
      }

      multiSync.triggerPostSaveSync(contentieuxId as ContentieuxId);
      console.log(`[${contentieuxId}] ${modifiedCount} enquête(s) mise(s) à jour`);
    }

    return totalModified;
  }, []);

  // Fonction de propagation des changements de tags (rename/delete)
  const propagateTagChange = useCallback(async (oldValue: string, newValue: string, category: TagCategory) => {
    try {
      console.log(`Propagation du tag "${oldValue}" → "${newValue || '(suppression)'}" (${category})`);

      const replacement = newValue === ''
        ? null
        : { value: newValue, category };

      const isServiceCategory = category === 'services';

      const total = await updateEnquetesAcrossContentieux(enquete =>
        applyEnqueteTagTransform(enquete, {
          tagMatcher: (tagValue, tagCategory) =>
            (tagCategory === category || tagCategory === null) && tagValue === oldValue,
          replacement,
          servicesMatch: isServiceCategory ? (s) => s === oldValue : undefined,
          servicesReplacement: isServiceCategory ? (newValue === '' ? null : newValue) : undefined,
        })
      );

      if (total > 0) {
        console.log(`Propagation terminée : ${total} enquête(s) impactée(s) au total`);
      }
    } catch (error) {
      console.error('Erreur lors de la propagation:', error);
      throw error;
    }
  }, [applyEnqueteTagTransform, updateEnquetesAcrossContentieux]);

  // Initialisation
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);

        // Migration one-shot depuis l'ancienne clé 'tags' (jamais synchronisée)
        // Faite AVANT la sync serveur pour que le push remonte aussi ces tags-là.
        const firstRead = await ElectronBridge.getData<TagDefinition[] | { data?: TagDefinition[] }>(
          APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,
          [],
        );
        const hasCustomTags =
          (Array.isArray(firstRead) && firstRead.length > 0) ||
          (!Array.isArray(firstRead) && Array.isArray(firstRead?.data) && firstRead!.data!.length > 0);
        if (!hasCustomTags) {
          const legacyData = await ElectronBridge.getData<TagDefinition[] | { data?: TagDefinition[] }>('tags', []);
          const legacyArr: TagDefinition[] = Array.isArray(legacyData)
            ? legacyData
            : (legacyData?.data || []);
          if (legacyArr.length > 0) {
            await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS, legacyArr);
            console.log(`✅ Migration tags → customTags : ${legacyArr.length} tag(s) migré(s)`);
          }
        }

        // Pull/push serveur via le service dédié (tag-data.json)
        // Non bloquant pour l'UX : on affiche d'abord ce qu'on a en local,
        // puis on hydrate à nouveau au retour de la sync.
        await tagSyncService.sync();

        const tagsData = await ElectronBridge.getData<TagDefinition[] | { data?: TagDefinition[] }>(
          APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,
          [],
        );
        const normalized: TagDefinition[] = Array.isArray(tagsData)
          ? tagsData
          : (tagsData?.data || []);
        lastPersistedRef.current = JSON.stringify(normalized);
        setTags(normalized);
      } catch (error) {
        console.error('Error initializing tags:', error);
        setTags([]);
      } finally {
        setIsLoading(false);
      }
    };

    initialize();

    // Re-hydrater quand un autre poste pousse des tags (sync périodique)
    const handleExternalSync = (event: Event) => {
      const custom = event as CustomEvent<{ scope?: string }>;
      if (custom.detail?.scope && custom.detail.scope !== 'tags') return;
      ElectronBridge.getData<TagDefinition[] | { data?: TagDefinition[] }>(
        APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS,
        [],
      ).then(data => {
        const arr: TagDefinition[] = Array.isArray(data) ? data : (data?.data || []);
        lastPersistedRef.current = JSON.stringify(arr);
        setTags(arr);
      });
    };
    window.addEventListener('global-sync-completed', handleExternalSync);
    return () => window.removeEventListener('global-sync-completed', handleExternalSync);
  }, []);

  // Sauvegarde automatique avec debounce
  const debouncedSave = useCallback(async (tagsToSave: TagDefinition[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const serialized = JSON.stringify(tagsToSave);
    // No-op si ce snapshot provient d'une hydratation (init ou pull sync) :
    // inutile de réécrire localement ni de repousser au serveur.
    if (serialized === lastPersistedRef.current) return;

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.CUSTOM_TAGS, tagsToSave);
        lastPersistedRef.current = serialized;
        // Notifier les autres instances useTags (ex. NewEnqueteModal toujours monté)
        emitSyncCompleted('tags');
        // Propager vers tag-data.json (serveur commun)
        tagSyncService.schedulePush();
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

  // Sélecteurs — tri alphabétique (localeCompare FR, insensible à la casse/accents)
  const getTagsByCategoryMemo = useCallback((category: TagCategory) => {
    return [...getTagsByCategory(tags, category)].sort((a, b) =>
      a.value.localeCompare(b.value, 'fr', { sensitivity: 'base' })
    );
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

  // Compter le nombre d'enquêtes utilisant un tag (tous contentieux chargés).
  const getTagUsageCount = useCallback(async (tagValue: string, category: TagCategory): Promise<number> => {
    try {
      const manager = ContentieuxManager.getInstance();
      const store = useEnquetesStore.getState();
      const activeId = store.contentieuxId;
      let count = 0;

      for (const contentieuxId of manager.getLoadedContentieuxIds()) {
        const enquetes: Enquete[] = contentieuxId === activeId
          ? store.ownEnquetes
          : manager.getEnquetes(contentieuxId);

        for (const enquete of enquetes) {
          if (!Array.isArray(enquete.tags)) continue;
          const found = enquete.tags.some((tag: any) => {
            const tv = typeof tag === 'string' ? tag : tag.value;
            const tc = typeof tag === 'string' ? null : tag.category;
            return tv === tagValue && (!tc || tc === category);
          });
          if (found) count++;
        }
      }

      return count;
    } catch (error) {
      console.error('Error counting tag usage:', error);
      return 0;
    }
  }, []);

  // Fonction de nettoyage des tags orphelins
  const cleanupOrphanTags = useCallback(async (): Promise<{ found: string[], cleaned: number }> => {
    try {
      console.log('🧹 Recherche des tags orphelins...');

      const manager = ContentieuxManager.getInstance();
      const store = useEnquetesStore.getState();
      const activeId = store.contentieuxId;
      const usedTags = new Set<string>();

      for (const contentieuxId of manager.getLoadedContentieuxIds()) {
        const enquetes: Enquete[] = contentieuxId === activeId
          ? store.ownEnquetes
          : manager.getEnquetes(contentieuxId);

        for (const enquete of enquetes) {
          if (!Array.isArray(enquete.tags)) continue;
          for (const tag of enquete.tags as any[]) {
            const tagValue = typeof tag === 'string' ? tag : tag.value;
            if (tagValue) usedTags.add(tagValue);
          }
        }
      }

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
        } else if (tagValue.toLowerCase().includes('jirs') || tagValue.toLowerCase().includes('parquet général')) {
          category = 'suivi';
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

  // ─── Déduplication des tags (doublons hérités des anciennes migrations) ───
  // Regroupe par (catégorie, valeur normalisée : trim + lowercase). Pour chaque
  // groupe à plusieurs entrées, un seul tag est conservé — de préférence celui
  // qui porte déjà une `organization.section`. Si le conservé n'en a pas mais
  // qu'un doublon en a une, on la transfère pour ne rien perdre.
  const computeDuplicateGroups = useCallback((): Array<{
    keeper: TagDefinition;
    losers: TagDefinition[];
    transferOrg?: TagOrganization;
  }> => {
    const groups = new Map<string, TagDefinition[]>();
    for (const tag of tags) {
      if (!tag || !tag.value || !tag.category) continue;
      const key = `${tag.category}::${tag.value.trim().toLowerCase()}`;
      const arr = groups.get(key);
      if (arr) arr.push(tag);
      else groups.set(key, [tag]);
    }

    const out: Array<{ keeper: TagDefinition; losers: TagDefinition[]; transferOrg?: TagOrganization }> = [];
    groups.forEach(group => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a, b) => {
        const aOrg = a.organization?.section ? 1 : 0;
        const bOrg = b.organization?.section ? 1 : 0;
        if (aOrg !== bOrg) return bOrg - aOrg;
        return (a.id || '').localeCompare(b.id || '');
      });
      const keeper = sorted[0];
      const losers = sorted.slice(1);
      let transferOrg: TagOrganization | undefined;
      if (!keeper.organization?.section) {
        const donor = losers.find(l => l.organization?.section);
        if (donor?.organization) transferOrg = donor.organization;
      }
      out.push({ keeper, losers, transferOrg });
    });
    return out;
  }, [tags]);

  const findDuplicateTags = useCallback((): DuplicateTagGroup[] => {
    return computeDuplicateGroups().map(({ keeper, losers }) => ({
      value: keeper.value,
      category: keeper.category,
      count: 1 + losers.length,
      removedCount: losers.length,
    }));
  }, [computeDuplicateGroups]);

  const mergeDuplicateTags = useCallback(async (): Promise<number> => {
    const groups = computeDuplicateGroups();
    if (groups.length === 0) return 0;

    const loserIds = new Set<string>();
    const orgTransfers = new Map<string, TagOrganization>();
    for (const { keeper, losers, transferOrg } of groups) {
      losers.forEach(l => loserIds.add(l.id));
      if (transferOrg) orgTransfers.set(keeper.id, transferOrg);
    }

    setTags(prev => prev
      .filter(t => !loserIds.has(t.id))
      .map(t => {
        const org = orgTransfers.get(t.id);
        return org ? { ...t, organization: org } : t;
      })
    );

    // Les enquêtes référencent les tags par valeur (et non par ID) : la valeur
    // du tag conservé étant identique aux doublons supprimés, aucune
    // propagation n'est nécessaire.
    return loserIds.size;
  }, [computeDuplicateGroups]);

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

      // Tombstone : empêche la résurrection du tag lors du prochain merge serveur.
      // Le TagSyncService filtre les tags dont l'id apparaît ici et nettoie les
      // tombstones vieux de plus de 7 jours.
      const existing = await ElectronBridge.getData<TagTombstone[]>(DELETED_TAG_IDS_KEY, []);
      const tombstones: TagTombstone[] = Array.isArray(existing) ? existing : [];
      if (!tombstones.some(t => t.id === id)) {
        tombstones.push({ id, deletedAt: new Date().toISOString() });
        await ElectronBridge.setData(DELETED_TAG_IDS_KEY, tombstones);
      }

      setTags(prev => prev.filter(tag => tag.id !== id));
      tagSyncService.schedulePush();
      return true;

    } catch (error) {
      console.error('Error deleting tag:', error);
      return false;
    }
  }, [getTagById, propagateTagChange]);

  // Fusion d'un tag dans un autre : toutes les enquêtes référençant `sourceId`
  // pointent désormais sur `targetId`, et le tag source est supprimé.
  // Les deux tags doivent appartenir à la même catégorie.
  const mergeTags = useCallback(async (sourceId: string, targetId: string): Promise<number> => {
    try {
      if (sourceId === targetId) return 0;

      const source = getTagById(sourceId);
      const target = getTagById(targetId);
      if (!source || !target) {
        throw new Error('Tag source ou cible introuvable');
      }
      if (source.category !== target.category) {
        throw new Error('La fusion est limitée aux tags d\'une même catégorie');
      }

      const isServiceCategory = source.category === 'services';

      const impacted = await updateEnquetesAcrossContentieux(enquete =>
        applyEnqueteTagTransform(enquete, {
          tagMatcher: (tagValue, tagCategory) =>
            (tagCategory === source.category || tagCategory === null) && tagValue === source.value,
          replacement: { id: target.id, value: target.value, category: target.category },
          servicesMatch: isServiceCategory ? (s) => s === source.value : undefined,
          servicesReplacement: isServiceCategory ? target.value : undefined,
        })
      );

      // Supprimer le tag source de la gestion centrale + tombstone
      const existing = await ElectronBridge.getData<TagTombstone[]>(DELETED_TAG_IDS_KEY, []);
      const tombstones: TagTombstone[] = Array.isArray(existing) ? existing : [];
      if (!tombstones.some(t => t.id === sourceId)) {
        tombstones.push({ id: sourceId, deletedAt: new Date().toISOString() });
        await ElectronBridge.setData(DELETED_TAG_IDS_KEY, tombstones);
      }
      setTags(prev => prev.filter(tag => tag.id !== sourceId));
      tagSyncService.schedulePush();

      console.log(`Fusion "${source.value}" → "${target.value}" : ${impacted} enquête(s) impactée(s)`);
      return impacted;
    } catch (error) {
      console.error('Error merging tags:', error);
      return -1;
    }
  }, [getTagById, applyEnqueteTagTransform, updateEnquetesAcrossContentieux]);

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
    mergeTags,

    // Organisation
    updateTagOrganization,
    
    // Utilitaire
    getTagUsageCount,

    // Nettoyage et migration
    cleanupOrphanTags,
    recreateOrphanTags,

    // Déduplication
    findDuplicateTags,
    mergeDuplicateTags
  };
};