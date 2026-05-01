// hooks/useInstructionAlerts.ts
//
// Génère et gère les alertes du module instruction à partir des règles
// configurables (useInstructionAlertRules) et des dossiers chargés.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import throttle from 'lodash/throttle';
import { useUserPreferences } from './useUserPreferences';
import { useInstructionAlertRules } from './useInstructionAlertRules';
import {
  getMoisRestantsAvantMaxLegal,
  motivationRenforceeRequise,
} from '@/utils/instructionUtils';
import type { AlerteInstruction } from '@/types/interfaces';
import type {
  DossierInstruction,
  InstructionAlertRule,
  InstructionAlertTrigger,
} from '@/types/instructionTypes';

const ALERT_REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const THROTTLE_DELAY = 2000;

const dayDiff = (target: Date, today: Date) =>
  Math.ceil((target.getTime() - today.getTime()) / 86400000);

/**
 * Génère la liste des alertes "actives" pour le set de dossiers donné, en
 * appliquant les règles tweakables (seuils + activation).
 */
const generateAlerts = (
  dossiers: DossierInstruction[],
  rules: InstructionAlertRule[],
): AlerteInstruction[] => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ruleMap = new Map<InstructionAlertTrigger, InstructionAlertRule>();
  for (const r of rules) if (r.enabled) ruleMap.set(r.trigger, r);

  const out: AlerteInstruction[] = [];
  let id = Date.now();
  const push = (a: Omit<AlerteInstruction, 'id'>) => {
    out.push({ ...a, id: id++ });
  };

  for (const dossier of dossiers) {
    // Dossier dormant
    const dormantRule = ruleMap.get('dossier_dormant');
    if (dormantRule) {
      const lastEvent = lastActivityDate(dossier);
      if (lastEvent) {
        const daysSince = Math.floor((today.getTime() - lastEvent.getTime()) / 86400000);
        if (daysSince >= dormantRule.seuil) {
          push({
            instructionId: dossier.id,
            enqueteId: dossier.id,
            cabinetId: dossier.cabinetId,
            type: 'dossier_dormant',
            alerteType: 'dossier_dormant',
            message: `Dossier sans activité depuis ${daysSince} j`,
            createdAt: new Date().toISOString(),
            status: 'active',
          });
        }
      }
    }

    // Vérification périodique due
    const verifRule = ruleMap.get('verif_periodique_due');
    if (verifRule) {
      const lastVerif = dossier.verifications
        .map(v => new Date(v.date))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const daysSince = lastVerif
        ? Math.floor((today.getTime() - lastVerif.getTime()) / 86400000)
        : Infinity;
      if (daysSince >= verifRule.seuil) {
        push({
          instructionId: dossier.id,
          enqueteId: dossier.id,
          cabinetId: dossier.cabinetId,
          type: 'verif_periodique_due',
          alerteType: 'verif_periodique_due',
          message: lastVerif
            ? `Vérification due (dernière il y a ${daysSince} j)`
            : `Aucune vérification jamais faite`,
          createdAt: new Date().toISOString(),
          status: 'active',
        });
      }
    }

    // Par MEX
    for (const mex of dossier.misEnExamen) {
      // DP fin proche / échue
      if (mex.mesureSurete.type === 'detenu') {
        const periode = [...mex.mesureSurete.periodes].sort(
          (a, b) => new Date(b.dateDebut).getTime() - new Date(a.dateDebut).getTime(),
        )[0];
        if (periode?.dateFin) {
          const fin = new Date(periode.dateFin);
          fin.setHours(0, 0, 0, 0);
          const days = dayDiff(fin, today);
          const echueRule = ruleMap.get('dp_fin_echue');
          const procheRule = ruleMap.get('dp_fin_proche');
          if (days < 0 && echueRule) {
            push({
              instructionId: dossier.id,
              enqueteId: dossier.id,
              cabinetId: dossier.cabinetId,
              type: 'dp_fin_echue',
              alerteType: 'dp_fin_echue',
              message: `Période DP de ${mex.nom} échue depuis ${Math.abs(days)} j`,
              createdAt: new Date().toISOString(),
              status: 'active',
              deadline: periode.dateFin,
              acteId: mex.id,
            });
          } else if (days >= 0 && procheRule && days <= procheRule.seuil) {
            push({
              instructionId: dossier.id,
              enqueteId: dossier.id,
              cabinetId: dossier.cabinetId,
              type: 'dp_fin_proche',
              alerteType: 'dp_fin_proche',
              message: `Fin DP de ${mex.nom} dans ${days} j`,
              createdAt: new Date().toISOString(),
              status: 'active',
              deadline: periode.dateFin,
              acteId: mex.id,
            });
          }
        }

        // Motivation renforcée requise
        const motivRule = ruleMap.get('motivation_renforcee_due');
        if (motivRule && motivationRenforceeRequise(mex)) {
          push({
            instructionId: dossier.id,
            enqueteId: dossier.id,
            cabinetId: dossier.cabinetId,
            type: 'motivation_renforcee_due',
            alerteType: 'motivation_renforcee_due',
            message: `${mex.nom} : motivation renforcée DP requise (>8 mois)`,
            createdAt: new Date().toISOString(),
            status: 'active',
            acteId: mex.id,
          });
        }

        // Durée légale max atteinte
        const maxRule = ruleMap.get('dp_max_legal_atteinte');
        if (maxRule) {
          const restant = getMoisRestantsAvantMaxLegal(mex);
          if (restant !== null && restant <= 0) {
            push({
              instructionId: dossier.id,
              enqueteId: dossier.id,
              cabinetId: dossier.cabinetId,
              type: 'dp_max_legal_atteinte',
              alerteType: 'dp_max_legal_atteinte',
              message: `${mex.nom} : durée légale max DP atteinte`,
              createdAt: new Date().toISOString(),
              status: 'active',
              acteId: mex.id,
            });
          }
        }
      }

      // DML retard / échéance proche
      for (const dml of mex.dmls) {
        if (dml.statut !== 'en_attente') continue;
        const ech = new Date(dml.dateEcheance);
        ech.setHours(0, 0, 0, 0);
        const days = dayDiff(ech, today);
        const retardRule = ruleMap.get('dml_retard');
        const procheRule = ruleMap.get('dml_echeance_proche');
        if (days < 0 && retardRule) {
          push({
            instructionId: dossier.id,
            enqueteId: dossier.id,
            cabinetId: dossier.cabinetId,
            type: 'dml_retard',
            alerteType: 'dml_retard',
            message: `DML de ${mex.nom} en retard de ${Math.abs(days)} j`,
            createdAt: new Date().toISOString(),
            status: 'active',
            deadline: dml.dateEcheance,
            acteId: dml.id,
          });
        } else if (days >= 0 && procheRule && days <= procheRule.seuil) {
          push({
            instructionId: dossier.id,
            enqueteId: dossier.id,
            cabinetId: dossier.cabinetId,
            type: 'dml_echeance_proche',
            alerteType: 'dml_echeance_proche',
            message: `Échéance DML de ${mex.nom} dans ${days} j`,
            createdAt: new Date().toISOString(),
            status: 'active',
            deadline: dml.dateEcheance,
            acteId: dml.id,
          });
        }
      }
    }

    // Débats JLD à venir
    const jldRule = ruleMap.get('debat_jld_proche');
    if (jldRule) {
      for (const debat of dossier.debatsJLD) {
        const date = new Date(debat.date);
        const dayOnly = new Date(date);
        dayOnly.setHours(0, 0, 0, 0);
        const days = dayDiff(dayOnly, today);
        if (days >= 0 && days <= jldRule.seuil) {
          push({
            instructionId: dossier.id,
            enqueteId: dossier.id,
            cabinetId: dossier.cabinetId,
            type: 'debat_jld_proche',
            alerteType: 'debat_jld_proche',
            message: `Débat JLD dans ${days} j${debat.heureExacte ? ` à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
            createdAt: new Date().toISOString(),
            status: 'active',
            deadline: debat.date,
            acteId: debat.id,
          });
        }
      }
    }

    // OP du JI à venir
    const opRule = ruleMap.get('op_ji_proche');
    if (opRule) {
      for (const op of dossier.ops) {
        const date = new Date(op.date);
        date.setHours(0, 0, 0, 0);
        const days = dayDiff(date, today);
        if (days >= 0 && days <= opRule.seuil) {
          push({
            instructionId: dossier.id,
            enqueteId: dossier.id,
            cabinetId: dossier.cabinetId,
            type: 'op_ji_proche',
            alerteType: 'op_ji_proche',
            message: `OP du JI dans ${days} j`,
            createdAt: new Date().toISOString(),
            status: 'active',
            deadline: op.date,
            acteId: op.id,
          });
        }
      }
    }
  }

  return out;
};

/**
 * Date du dernier événement enregistré sur un dossier (note, vérif, OP, JLD,
 * DML, période DP, dateMiseAJour). Utile pour détecter un dossier dormant.
 */
const lastActivityDate = (d: DossierInstruction): Date | null => {
  const candidates: number[] = [];
  if (d.dateMiseAJour) candidates.push(new Date(d.dateMiseAJour).getTime());
  for (const n of d.notesPerso) candidates.push(new Date(n.date).getTime());
  for (const v of d.verifications) candidates.push(new Date(v.date).getTime());
  for (const op of d.ops) candidates.push(new Date(op.date).getTime());
  for (const j of d.debatsJLD) candidates.push(new Date(j.date).getTime());
  for (const mex of d.misEnExamen) {
    for (const dml of mex.dmls) candidates.push(new Date(dml.dateDepot).getTime());
    if (mex.mesureSurete.type === 'detenu') {
      for (const p of mex.mesureSurete.periodes) candidates.push(new Date(p.dateDebut).getTime());
    }
  }
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates));
};

export const useInstructionAlerts = (dossiers: DossierInstruction[]) => {
  const {
    instructionAlerts: prefs,
    isLoading: prefsLoading,
    setInstructionAlerts,
  } = useUserPreferences();
  const { rules, isLoading: rulesLoading } = useInstructionAlertRules();

  const allAlerts = useMemo<AlerteInstruction[]>(
    () => prefs?.alerts || [],
    [prefs?.alerts],
  );

  const refreshAlerts = useCallback(
    throttle(async () => {
      if (prefsLoading || rulesLoading) return;

      const generated = generateAlerts(dossiers, rules);
      const existingMap = new Map<string, AlerteInstruction>();
      for (const a of allAlerts) {
        const key = `${a.instructionId}-${a.type}-${a.acteId || ''}`;
        existingMap.set(key, a);
      }

      const merged = generated.map(a => {
        const key = `${a.instructionId}-${a.type}-${a.acteId || ''}`;
        const existing = existingMap.get(key);
        if (existing?.status === 'snoozed' && existing.snoozedUntil) {
          if (new Date() < new Date(existing.snoozedUntil)) {
            return {
              ...a,
              status: 'snoozed' as const,
              snoozedUntil: existing.snoozedUntil,
              snoozedCount: existing.snoozedCount,
            };
          }
        }
        return a;
      });

      await setInstructionAlerts(merged);
    }, THROTTLE_DELAY),
    [dossiers, rules, prefsLoading, rulesLoading, allAlerts, setInstructionAlerts],
  );

  // Refresh initial + interval
  useEffect(() => {
    if (prefsLoading || rulesLoading) return;
    const t0 = setTimeout(() => refreshAlerts(), 800);
    const interval = setInterval(refreshAlerts, ALERT_REFRESH_INTERVAL);
    return () => {
      clearTimeout(t0);
      clearInterval(interval);
      refreshAlerts.cancel();
    };
  }, [refreshAlerts, prefsLoading, rulesLoading]);

  const handleValidateAlert = useCallback(
    async (alertId: number | number[]) => {
      const ids = Array.isArray(alertId) ? alertId : [alertId];
      await setInstructionAlerts(allAlerts.filter(a => !ids.includes(a.id)));
    },
    [allAlerts, setInstructionAlerts],
  );

  const handleSnoozeAlert = useCallback(
    async (alertId: number, days = 7) => {
      const snoozedUntil = new Date();
      snoozedUntil.setDate(snoozedUntil.getDate() + days);
      const next = allAlerts.map(a =>
        a.id === alertId
          ? {
              ...a,
              status: 'snoozed' as const,
              snoozedUntil: snoozedUntil.toISOString(),
              snoozedCount: (a.snoozedCount || 0) + 1,
            }
          : a,
      );
      await setInstructionAlerts(next);
    },
    [allAlerts, setInstructionAlerts],
  );

  const activeAlerts = useMemo(
    () => allAlerts.filter(a => a.status === 'active'),
    [allAlerts],
  );

  return {
    instructionAlerts: activeAlerts,
    allInstructionAlerts: allAlerts,
    isLoading: prefsLoading || rulesLoading,
    updateInstructionAlerts: refreshAlerts,
    handleValidateInstructionAlert: handleValidateAlert,
    handleSnoozeInstructionAlert: handleSnoozeAlert,
  };
};
