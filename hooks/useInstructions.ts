// hooks/useInstructions.ts
//
// Hook de gestion des dossiers d'instruction (refonte complète).
// Stockage : `instructions` via ElectronBridge (table rase, ancien format
// abandonné — les dossiers existants au format `EnqueteInstruction` sont
// ignorés au chargement).

import { useCallback, useEffect, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import type {
  DossierInstruction,
  NewDossierInstructionData,
} from '@/types/instructionTypes';

const SAVE_DEBOUNCE = 2500;

/**
 * Vérifie qu'un objet stocké correspond au nouveau modèle DossierInstruction.
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
  const [dossiers, setDossiers] = useState<DossierInstruction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const dossiersRef = useRef<DossierInstruction[]>([]);
  const isDirtyRef = useRef(false);
  const isLoadingRef = useRef(true);

  // ──────────────────────────────────────────────
  // Chargement initial
  // ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        const stored = await ElectronBridge.getData<unknown>(
          APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,
          [],
        );
        const list = Array.isArray(stored) ? stored.filter(isNewModelDossier) : [];
        if (!cancelled) {
          setDossiers(list);
          dossiersRef.current = list;
        }
      } catch (e) {
        console.error('useInstructions: erreur de chargement', e);
        if (!cancelled) setDossiers([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          isLoadingRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      try {
        const ok = await ElectronBridge.setData(
          APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,
          dossiersRef.current,
        );
        if (ok) isDirtyRef.current = false;
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
      if (isDirtyRef.current && !isLoadingRef.current) {
        // sauvegarde synchrone-ish (best-effort)
        ElectronBridge.setData(
          APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS,
          dossiersRef.current,
        ).catch(e => console.error('useInstructions: sauvegarde finale échouée', e));
      }
    };
  }, [persist]);

  return {
    dossiers,
    isLoading,
    addDossier,
    updateDossier,
    deleteDossier,
  };
};
