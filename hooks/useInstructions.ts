// hooks/useInstructions.ts
//
// Hook de gestion des dossiers d'instruction.
//
// Stockage : `instructions__<windowsUsername>` via ElectronBridge.
// Les dossiers d'instruction sont **par utilisateur** : chaque magistrat
// (ou utilisateur Windows) a sa propre liste, isolée des autres. Les
// cabinets (config) restent en revanche partagés via instructionConfig.

import { useCallback, useEffect, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import { useUser } from '@/contexts/UserContext';
import { instructionSyncService } from '@/utils/dataSync/InstructionSyncService';
import type {
  DossierInstruction,
  NewDossierInstructionData,
} from '@/types/instructionTypes';

const SAVE_DEBOUNCE = 2500;

/**
 * Construit la clé de stockage user-scoped pour un utilisateur donné.
 * Retourne `null` si pas d'utilisateur (cas de chargement initial avant login).
 */
const buildStorageKey = (windowsUsername: string | null | undefined): string | null => {
  if (!windowsUsername) return null;
  return `${APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS}__${windowsUsername}`;
};

/**
 * Vérifie qu'un objet stocké correspond au modèle DossierInstruction.
 * Les anciens dossiers (format `EnqueteInstruction`) sont rejetés.
 */
const isNewModelDossier = (raw: unknown): raw is DossierInstruction => {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.numeroInstruction === 'string' &&
    typeof o.cabinetId === 'string' &&
    typeof o.dateRI === 'string' &&
    Array.isArray(o.misEnExamen) &&
    Array.isArray(o.notesPerso) &&
    Array.isArray(o.ops) &&
    Array.isArray(o.debatsJLD)
  );
};

export const useInstructions = () => {
  const { user } = useUser();
  const username = user?.windowsUsername || null;

  const [dossiers, setDossiers] = useState<DossierInstruction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const dossiersRef = useRef<DossierInstruction[]>([]);
  const isDirtyRef = useRef(false);
  const isLoadingRef = useRef(true);
  // Clé courante : indispensable pour que `persist` (throttled) écrive
  // toujours sur la bonne clé même quand l'utilisateur change.
  const storageKeyRef = useRef<string | null>(buildStorageKey(username));

  // ──────────────────────────────────────────────
  // Chargement (initial + sur demande via `refresh`)
  // ──────────────────────────────────────────────
  const reload = useCallback(async () => {
    const key = storageKeyRef.current;
    if (!key) {
      setDossiers([]);
      dossiersRef.current = [];
      setIsLoading(false);
      isLoadingRef.current = false;
      return;
    }
    try {
      setIsLoading(true);
      const stored = await ElectronBridge.getData<unknown>(key, []);
      const list = Array.isArray(stored) ? stored.filter(isNewModelDossier) : [];
      setDossiers(list);
      dossiersRef.current = list;
    } catch (e) {
      console.error('useInstructions: erreur de chargement', e);
      setDossiers([]);
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
    }
  }, []);

  // Recharge dès que le username change (clé de stockage différente)
  useEffect(() => {
    storageKeyRef.current = buildStorageKey(username);
    void reload();
  }, [username, reload]);

  // Re-hydrate quand la synchro réseau (privée par utilisateur) rapatrie des
  // dossiers modifiés sur un autre poste du même magistrat.
  useEffect(() => {
    const onSync = () => { void reload(); };
    window.addEventListener('instructions-sync-completed', onSync);
    return () => window.removeEventListener('instructions-sync-completed', onSync);
  }, [reload]);

  useEffect(() => {
    dossiersRef.current = dossiers;
  }, [dossiers]);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // ──────────────────────────────────────────────
  // Sauvegarde throttlée
  // ──────────────────────────────────────────────
  const persist = useCallback(
    throttle(async () => {
      if (!isDirtyRef.current || isLoadingRef.current) return;
      const key = storageKeyRef.current;
      if (!key) return; // pas d'utilisateur connecté → on n'écrit nulle part
      try {
        const ok = await ElectronBridge.setData(key, dossiersRef.current);
        if (ok) {
          isDirtyRef.current = false;
          // Sauvegarde réseau privée (no-op si aucun dossier réseau configuré)
          instructionSyncService.schedulePush();
        }
      } catch (e) {
        console.error('useInstructions: erreur de sauvegarde', e);
      }
    }, SAVE_DEBOUNCE),
    [],
  );

  // ──────────────────────────────────────────────
  // Mutateur central
  // ──────────────────────────────────────────────
  const mutate = useCallback(
    (updater: (prev: DossierInstruction[]) => DossierInstruction[]) => {
      setDossiers(prev => {
        const next = updater(prev);
        dossiersRef.current = next;
        isDirtyRef.current = true;
        // déclenche persist au prochain tick
        Promise.resolve().then(() => persist());
        return next;
      });
    },
    [persist],
  );

  // ──────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────

  const addDossier = useCallback(
    (data: NewDossierInstructionData): DossierInstruction => {
      const now = new Date().toISOString();
      const dossier: DossierInstruction = {
        ...data,
        id: Date.now(),
        dateCreation: now,
        dateMiseAJour: now,
      };
      mutate(prev => [...prev, dossier]);
      return dossier;
    },
    [mutate],
  );

  const updateDossier = useCallback(
    (id: number, updates: Partial<DossierInstruction>) => {
      mutate(prev =>
        prev.map(d =>
          d.id === id
            ? { ...d, ...updates, id: d.id, dateMiseAJour: new Date().toISOString() }
            : d,
        ),
      );
    },
    [mutate],
  );

  const deleteDossier = useCallback(
    (id: number) => {
      // Tombstone pour propager la suppression aux autres postes du magistrat.
      void instructionSyncService.recordDeletion(id);
      mutate(prev => prev.filter(d => d.id !== id));
    },
    [mutate],
  );

  // ──────────────────────────────────────────────
  // Sauvegarde finale au démontage
  // ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      persist.cancel();
      const key = storageKeyRef.current;
      if (key && isDirtyRef.current && !isLoadingRef.current) {
        // sauvegarde synchrone-ish (best-effort)
        ElectronBridge.setData(key, dossiersRef.current)
          .then(() => instructionSyncService.schedulePush())
          .catch(e =>
            console.error('useInstructions: sauvegarde finale échouée', e),
          );
      }
    };
  }, [persist]);

  return {
    dossiers,
    isLoading,
    addDossier,
    updateDossier,
    deleteDossier,
    refresh: reload,
  };
};
