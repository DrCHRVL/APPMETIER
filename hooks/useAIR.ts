// hooks/useAIR.ts - Hook mis à jour pour gérer les mesures AIR et l'import greffe

import { useState, useEffect, useCallback, useRef } from 'react';
import { AIRImportData, AIRStatus } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';
import { useToast } from '@/contexts/ToastContext';
import { determineAIRStatus, formatDateIfNeeded } from '@/utils/airImportUtils';

const STORAGE_KEY = 'air_mesures';

export const useAIR = () => {
  const [mesures, setMesures] = useState<AIRImportData[]>([]);
  const [selectedMesure, setSelectedMesure] = useState<AIRImportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const { showToast } = useToast();

  // Charger les données au démarrage
  useEffect(() => {
    const loadMesures = async () => {
      try {
        setIsLoading(true);
        const data = await ElectronBridge.getData<AIRImportData[]>(STORAGE_KEY, []);
        setMesures(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error('Erreur lors du chargement des mesures AIR:', error);
        setMesures([]);
        showToast('Erreur lors du chargement des mesures AIR', 'error');
      } finally {
        setIsLoading(false);
      }
    };

    loadMesures();
  }, [showToast]);

  // Sauvegarde avec debounce (comme dans l'ancien hook)
  useEffect(() => {
    if (!mesures || isLoading) return;
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await ElectronBridge.setData(STORAGE_KEY, mesures);
      } catch (error) {
        console.error('Erreur lors de la sauvegarde des mesures AIR:', error);
        showToast('Erreur lors de la sauvegarde', 'error');
      }
    }, 1000); // 1 seconde de debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [mesures, isLoading, showToast]);

  // Fonctions utilitaires inspirées de l'ancien hook
  const normalizeInfraction = useCallback((infraction: string): string => {
    if (!infraction) return 'Inconnue';
    
    const lowerInfraction = infraction.toLowerCase().trim();
    
    if (lowerInfraction.includes('conduite')) {
      return 'Route';
    } else if (lowerInfraction === 'stups' || lowerInfraction === 'stup' || 
              lowerInfraction.includes('stupéfiant') || lowerInfraction.includes('cannabis') || 
              lowerInfraction === 'ils' || lowerInfraction === 'ild') {
      return 'ILS';
    } else if (lowerInfraction.includes('violence') || lowerInfraction === 'vif') {
      return 'Atteintes aux personnes';
    } else if (lowerInfraction.includes('vol') || lowerInfraction.includes('dégradation')) {
      return 'Atteintes aux biens';
    } else if (lowerInfraction.includes('alcool')) {
      return 'Alcool';
    }
    
    return infraction; // Garder l'original si pas de correspondance
  }, []);

  const detectAddiction = useCallback((faits: string): string => {
    if (!faits) return 'Inconnue';
    
    const lowerFaits = faits.toLowerCase().trim();
    
    if (lowerFaits.includes('alcool') && (lowerFaits.includes('stup') || 
       lowerFaits.includes('stupéfiant') || lowerFaits.includes('cannabis'))) {
      return 'Alcool et stupéfiants';
    } else if (lowerFaits.includes('alcool')) {
      return 'Alcool';
    } else if (lowerFaits.includes('stup') || lowerFaits.includes('stupéfiant') || 
              lowerFaits.includes('cannabis') || lowerFaits === 'ils' || 
              lowerFaits === 'ild') {
      return 'Stupéfiants';
    }
    
    return 'Inconnue';
  }, []);

  // Ajouter une nouvelle mesure
  const handleAddMesure = useCallback(async (
    newMesure: Omit<AIRImportData, 'refAEM'> & { refAEM: string }
  ) => {
    try {
      // Vérifier que la référence AEM n'existe pas déjà
      const exists = mesures.some(m => m.refAEM === newMesure.refAEM);
      if (exists) {
        throw new Error(`Une mesure avec la référence ${newMesure.refAEM} existe déjà`);
      }

      // Enrichir automatiquement les données
      const enrichedMesure: AIRImportData = {
        ...newMesure,
        // Détecter automatiquement l'addiction basée sur les faits
        // Normaliser l'infraction si nécessaire
        statut: newMesure.statut || determineAIRStatus(
          newMesure.resultatMesure,
          newMesure.dateCloture,
          newMesure.dateFinPriseEnCharge
        )
      };

      setMesures(prev => [...prev, enrichedMesure]);
      showToast('Mesure AIR ajoutée avec succès', 'success');
      return enrichedMesure;
    } catch (error) {
      console.error('Erreur lors de l\'ajout de la mesure:', error);
      showToast(error instanceof Error ? error.message : 'Erreur lors de l\'ajout', 'error');
      throw error;
    }
  }, [mesures, showToast]);

  // Mettre à jour une mesure existante
  const handleUpdateMesure = useCallback(async (
    refAEM: string, 
    updates: Partial<AIRImportData>
  ) => {
    try {
      // Vérifier et enrichir automatiquement si nécessaire
      const enrichedUpdates = { ...updates };
      
      // Recalculer le statut si les champs pertinents ont changé
      if (updates.resultatMesure !== undefined || 
          updates.dateCloture !== undefined || 
          updates.dateFinPriseEnCharge !== undefined) {
        
        const mesure = mesures.find(m => m.refAEM === refAEM);
        if (mesure) {
          enrichedUpdates.statut = determineAIRStatus(
            updates.resultatMesure ?? mesure.resultatMesure,
            updates.dateCloture ?? mesure.dateCloture,
            updates.dateFinPriseEnCharge ?? mesure.dateFinPriseEnCharge
          );
        }
      }

      const updatedMesures = mesures.map(mesure =>
        mesure.refAEM === refAEM
          ? { ...mesure, ...enrichedUpdates }
          : mesure
      );

      setMesures(updatedMesures);

      // Mettre à jour la mesure sélectionnée si c'est celle qui a été modifiée
      if (selectedMesure?.refAEM === refAEM) {
        setSelectedMesure({ ...selectedMesure, ...enrichedUpdates });
      }

      showToast('Mesure AIR mise à jour', 'success');
    } catch (error) {
      console.error('Erreur lors de la mise à jour de la mesure:', error);
      showToast('Erreur lors de la mise à jour', 'error');
      throw error;
    }
  }, [mesures, selectedMesure, showToast]);

  // Supprimer une mesure
  const handleDeleteMesure = useCallback(async (refAEM: string) => {
    try {
      const updatedMesures = mesures.filter(mesure => mesure.refAEM !== refAEM);
      setMesures(updatedMesures);

      // Désélectionner si c'est la mesure supprimée
      if (selectedMesure?.refAEM === refAEM) {
        setSelectedMesure(null);
      }

      showToast('Mesure AIR supprimée', 'success');
    } catch (error) {
      console.error('Erreur lors de la suppression de la mesure:', error);
      showToast('Erreur lors de la suppression', 'error');
      throw error;
    }
  }, [mesures, selectedMesure, showToast]);

  // Importer des mesures depuis Excel (version enrichie de l'ancien hook)
  const handleImportMesures = useCallback(async (
    importedData: AIRImportData[],
    strategy: 'merge' | 'replace'
  ) => {
    try {
      let updatedMesures: AIRImportData[];
      let nouveaux = 0;
      let modifies = 0;

      if (strategy === 'replace') {
        // Mode REMPLACER : supprimer tout et ajouter les nouvelles
        updatedMesures = importedData.map(data => ({
          ...data,
          statut: data.statut || determineAIRStatus(
            data.resultatMesure,
            data.dateCloture,
            data.dateFinPriseEnCharge
          )
        }));
        
        nouveaux = updatedMesures.length;
        console.log(`Mode REMPLACER: ${nouveaux} mesures importées`);
        
      } else {
        // Mode FUSION : logique intelligente de comparaison et mise à jour
        console.log(`Début fusion: ${mesures.length} existantes, ${importedData.length} à importer`);
        
        // Fonction pour normaliser les noms (gestion des différences de casse, espaces, etc.)
        const normalizeNom = (nom: string): string => {
          return nom.toLowerCase()
            .trim()
            .replace(/\s+/g, ' ') // Remplacer les espaces multiples par un seul
            .replace(/[^\w\s-]/g, '') // Supprimer la ponctuation
            .split(' ')
            .sort() // Trier les mots pour gérer "Jean Dupont" vs "Dupont Jean"
            .join(' ');
        };

        // Créer un index des mesures existantes par nom normalisé
        const existingByNom = new Map<string, AIRImportData>();
        mesures.forEach(mesure => {
          if (mesure.nomPrenom) {
            const normalizedNom = normalizeNom(mesure.nomPrenom);
            existingByNom.set(normalizedNom, mesure);
          }
        });

        // Traiter chaque mesure importée
        const processedMesures = new Set<string>(); // Pour éviter les doublons
        const finalMesures: AIRImportData[] = [];

        importedData.forEach(imported => {
          if (!imported.nomPrenom) {
            console.warn(`Mesure sans nom ignorée: ${imported.refAEM}`);
            return;
          }

          const normalizedImportedNom = normalizeNom(imported.nomPrenom);
          
          // Éviter les doublons dans l'import
          if (processedMesures.has(normalizedImportedNom)) {
            console.warn(`Doublon détecté dans l'import: ${imported.nomPrenom}`);
            return;
          }
          processedMesures.add(normalizedImportedNom);

          const existing = existingByNom.get(normalizedImportedNom);

          if (existing) {
            // FUSION : Mesure existante trouvée
            console.log(`Fusion pour: ${existing.nomPrenom} -> ${imported.nomPrenom}`);
            modifies++;

            // Fonction pour savoir si on doit protéger un champ
            const shouldProtectField = (field: keyof AIRImportData, existingValue: any, importedValue: any): boolean => {
              // Champs TOUJOURS protégés s'ils existent déjà
              const alwaysProtected = ['dateReception', 'dateFinPriseEnCharge', 'resultatMesure', 'dateCloture'];
              if (alwaysProtected.includes(field as string) && existingValue && String(existingValue).trim() !== '') {
                return true;
              }

              // Statut protégé si déjà clôturé
              if (field === 'statut' && existingValue && 
                  ['termine', 'reussite', 'echec'].includes(existingValue)) {
                return true;
              }

              // NOUVEAU : Protéger le numéro parquet s'il existe déjà
              if (field === 'numeroParquet' && existingValue && String(existingValue).trim() !== '') {
                return true;
              }

              // NOUVEAU : Protéger le flag sourceGreffe s'il existe déjà
              if (field === 'sourceGreffe' && existingValue) {
                return true;
              }

              return false;
            };

            const mergedMesure: AIRImportData = { ...existing };

            // Parcourir tous les champs de la mesure importée
            Object.keys(imported).forEach(key => {
              const field = key as keyof AIRImportData;
              const existingValue = existing[field];
              const importedValue = imported[field];

              // Gestion spéciale pour nombreRencontresPR : uniquement à la hausse
              if (field === 'nombreRencontresPR') {
                const existingCount = typeof existingValue === 'number' ? existingValue : 0;
                const importedCount = typeof importedValue === 'number' ? importedValue : 0;
                
                if (importedCount > existingCount) {
                  console.log(`  - Rencontres PR: ${existingCount} -> ${importedCount} (à la hausse)`);
                  mergedMesure[field] = importedCount;
                } else {
                  console.log(`  - Rencontres PR: gardé ${existingCount} (nouvelle valeur ${importedCount} inférieure)`);
                }
                return;
              }

              // Vérifier si le champ doit être protégé
              if (shouldProtectField(field, existingValue, importedValue)) {
                console.log(`  - ${field}: protégé (${existingValue})`);
                return;
              }

              // Mettre à jour si la nouvelle valeur n'est pas vide
              if (importedValue !== undefined && importedValue !== null && String(importedValue).trim() !== '') {
                // Pour les champs toujours mis à jour, ou si l'existant est vide
                if (!existingValue || String(existingValue).trim() === '' || 
                    ['faits', 'adresse', 'telephone', 'secteurGeographique', 'referent', 'origine',
                     'nombreEntretiensAIR', 'nombreCarences', 'nombreVAD'].includes(field as string)) {
                  console.log(`  - ${field}: ${existingValue} -> ${importedValue}`);
                  (mergedMesure as any)[field] = importedValue;
                }
              }
            });

            // Recalculer le statut seulement si pas déjà protégé
            if (!shouldProtectField('statut', existing.statut, imported.statut)) {
              mergedMesure.statut = determineAIRStatus(
                mergedMesure.resultatMesure,
                mergedMesure.dateCloture,
                mergedMesure.dateFinPriseEnCharge
              );
            }

            finalMesures.push(mergedMesure);
            
          } else {
            // NOUVELLE mesure
            console.log(`Nouvelle mesure: ${imported.nomPrenom}`);
            nouveaux++;
            
            const newMesure: AIRImportData = {
              ...imported,
              statut: imported.statut || determineAIRStatus(
                imported.resultatMesure,
                imported.dateCloture,
                imported.dateFinPriseEnCharge
              )
            };
            
            finalMesures.push(newMesure);
          }
        });

        // Ajouter les mesures existantes qui n'ont pas été touchées
        mesures.forEach(existing => {
          if (existing.nomPrenom) {
            const normalizedNom = normalizeNom(existing.nomPrenom);
            if (!processedMesures.has(normalizedNom)) {
              finalMesures.push(existing);
            }
          } else {
            // Garder les mesures sans nom (cas d'erreur)
            finalMesures.push(existing);
          }
        });

        updatedMesures = finalMesures;
        console.log(`Fusion terminée: ${nouveaux} nouvelles, ${modifies} modifiées, ${finalMesures.length} total`);
      }

      setMesures(updatedMesures);
      
      // Message d'information détaillé
      const message = strategy === 'replace' 
        ? `${nouveaux} mesures AIR importées (remplacement total)`
        : `Import fusionné: ${nouveaux} nouvelles, ${modifies} mises à jour`;
      
      showToast(message, 'success');
      
      return {
        total: importedData.length,
        nouveaux,
        modifies
      };
      
    } catch (error) {
      console.error('Erreur lors de l\'import des mesures:', error);
      showToast('Erreur lors de l\'import', 'error');
      throw error;
    }
  }, [mesures, showToast]);

  // NOUVELLES FONCTIONS POUR L'IMPORT GREFFE

  // Mettre à jour plusieurs mesures avec leur numéro de parquet
  const handleUpdateMesuresFromGreffe = useCallback(async (
    updates: { mesure: AIRImportData, numeroParquet: string }[]
  ) => {
    try {
      let updatedCount = 0;
      
      const updatedMesures = mesures.map(mesure => {
        const update = updates.find(u => u.mesure.refAEM === mesure.refAEM);
        if (update) {
          updatedCount++;
          return {
            ...mesure,
            numeroParquet: update.numeroParquet
          };
        }
        return mesure;
      });

      setMesures(updatedMesures);
      showToast(`${updatedCount} numéros de parquet mis à jour`, 'success');
    } catch (error) {
      console.error('Erreur lors de la mise à jour depuis le greffe:', error);
      showToast('Erreur lors de la mise à jour depuis le greffe', 'error');
      throw error;
    }
  }, [mesures, showToast]);

  // Ajouter plusieurs mesures depuis le greffe
  const handleAddMesuresFromGreffe = useCallback(async (
    newMesures: (Omit<AIRImportData, 'refAEM'> & { refAEM: string })[]
  ) => {
    try {
      // Marquer toutes les nouvelles mesures comme provenant du greffe
      const enrichedMesures = newMesures.map(mesure => ({
        ...mesure,
        sourceGreffe: true,
        statut: determineAIRStatus(
          mesure.resultatMesure,
          mesure.dateCloture,
          mesure.dateFinPriseEnCharge
        )
      }));

      setMesures(prev => [...prev, ...enrichedMesures]);
      showToast(`${newMesures.length} nouvelles mesures créées depuis le greffe`, 'success');
    } catch (error) {
      console.error('Erreur lors de l\'ajout des mesures greffe:', error);
      showToast('Erreur lors de l\'ajout des mesures greffe', 'error');
      throw error;
    }
  }, [showToast]);

  // Vérification automatique des statuts (comme dans l'ancien hook)
  useEffect(() => {
    if (isLoading || mesures.length === 0) return;
    
    let hasChanges = false;
    const updatedMesures = mesures.map(mesure => {
      const newStatus = determineAIRStatus(
        mesure.resultatMesure,
        mesure.dateCloture,
        mesure.dateFinPriseEnCharge
      );
      
      if (newStatus !== mesure.statut) {
        hasChanges = true;
        return { ...mesure, statut: newStatus };
      }
      
      return mesure;
    });
    
    if (hasChanges) {
      setMesures(updatedMesures);
    }
  }, [mesures, isLoading]);

  // Fonctions utilitaires
  const getMesureByRef = useCallback((refAEM: string): AIRImportData | undefined => {
    return mesures.find(m => m.refAEM === refAEM);
  }, [mesures]);

  const getMesuresByStatus = useCallback((statut: AIRStatus): AIRImportData[] => {
    return mesures.filter(m => m.statut === statut);
  }, [mesures]);

  const getStats = useCallback(() => {
    const total = mesures.length;
    const enCours = mesures.filter(m => m.statut === 'en_cours').length;
    const reussites = mesures.filter(m => m.statut === 'reussite').length;
    const echecs = mesures.filter(m => m.statut === 'echec').length;
    const terminees = mesures.filter(m => m.statut === 'termine').length;
    
    const totalFinies = reussites + echecs + terminees;
    const tauxReussite = totalFinies > 0 ? Math.round((reussites / totalFinies) * 100) : 0;
    
    // Statistiques avancées
    const dureeMoyenne = mesures
      .filter(m => m.dureeEnMois && m.dureeEnMois > 0)
      .reduce((acc, m) => acc + (m.dureeEnMois || 0), 0) / 
      mesures.filter(m => m.dureeEnMois && m.dureeEnMois > 0).length || 0;
    
    const moyenneEntretiens = mesures.length > 0 ? 
      mesures.reduce((acc, m) => acc + m.nombreEntretiensAIR, 0) / mesures.length : 0;

    // NOUVELLES STATISTIQUES pour le greffe
    const avecNumeroParquet = mesures.filter(m => m.numeroParquet && m.numeroParquet.trim() !== '').length;
    const sourceGreffe = mesures.filter(m => m.sourceGreffe).length;
    
    return {
      total,
      enCours,
      reussites,
      echecs,
      terminees,
      tauxReussite,
      dureeMoyenne: Math.round(dureeMoyenne * 10) / 10,
      moyenneEntretiens: Math.round(moyenneEntretiens * 10) / 10,
      avecNumeroParquet,
      sourceGreffe
    };
  }, [mesures]);

  // Filtrer par référent
  const getMesuresByReferent = useCallback((referent: string): AIRImportData[] => {
    return mesures.filter(m => m.referent === referent);
  }, [mesures]);

  // Filtrer par origine
  const getMesuresByOrigine = useCallback((origine: string): AIRImportData[] => {
    return mesures.filter(m => m.origine === origine);
  }, [mesures]);

  // Supprimer toutes les mesures
  const handleDeleteAllMesures = useCallback(async () => {
    try {
      setMesures([]);
      showToast('Toutes les mesures AIR ont été supprimées', 'success');
    } catch (error) {
      console.error('Erreur lors de la suppression de toutes les mesures:', error);
      showToast('Erreur lors de la suppression', 'error');
      throw error;
    }
  }, [showToast]);

  return {
    // Données
    mesures,
    selectedMesure,
    isLoading,
    isEditing,
    
    // Actions de base
    setSelectedMesure,
    setIsEditing,
    handleAddMesure,
    handleUpdateMesure,
    handleDeleteMesure,
    handleDeleteAllMesures,
    handleImportMesures,
    
    // NOUVELLES ACTIONS pour le greffe
    handleUpdateMesuresFromGreffe,
    handleAddMesuresFromGreffe,
    
    // Utilitaires
    getMesureByRef,
    getMesuresByStatus,
    getMesuresByReferent,
    getMesuresByOrigine,
    getStats,
    
    // Fonctions utilitaires
    normalizeInfraction,
    detectAddiction
  };
};