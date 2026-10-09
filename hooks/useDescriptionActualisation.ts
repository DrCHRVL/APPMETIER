'use client';

/**
 * Actualisation « à la demande » de la description d'un dossier, côté
 * navigateur : lancement, suivi de l'avancement (pourcentage, temps restant,
 * étape en cours), toasts à chaque étape et à l'issue, et resynchronisation
 * de la fiche ouverte dès qu'une écriture de l'attaché tombe — la description,
 * les rôles et les propositions apparaissent sans fermer la fiche.
 *
 * Le travail tourne EN FOND côté service : fermer puis rouvrir la fiche
 * reprend le suivi là où il en est.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import type { ToastType } from '@/stores/useToastStore';

export interface DescriptionProgress {
  pourcent: number;
  restantMs: number;
  detail: string;
}

interface Etape { at: string; phase: string; texte: string }
interface Resultat {
  ok?: boolean;
  error?: string;
  chantier?: unknown;
  message?: string;
  descriptionEcrite?: boolean;
  proposees?: number;
  liens?: number;
  roles?: number;
  pieces?: number;
  fichees?: number;
}
interface Etat {
  numero: string;
  phase: string;
  detail: string;
  etapes: Etape[];
  pourcent: number;
  restantMs: number;
  fini: boolean;
  ecritures?: number;
  resultat?: Resultat;
}

const POLL_MS = 2500;
const ECHECS_MAX = 4;

export function formatRestant(ms: number): string {
  if (ms <= 15_000) return 'presque terminé';
  if (ms < 60_000) return 'moins d\'une minute';
  const min = Math.round(ms / 60_000);
  return `≈ ${min} min restante${min > 1 ? 's' : ''}`;
}

function pluriel(n: number, mot: string): string {
  return `${n} ${mot}${n > 1 ? 's' : ''}`;
}

/** Le bilan lisible d'une actualisation terminée. */
export function bilanActualisation(r: Resultat): string {
  const morceaux: string[] = [];
  if (r.roles) morceaux.push(`${pluriel(r.roles, 'rôle')} de mis en cause mis à jour`);
  if (r.proposees) morceaux.push(`${pluriel(r.proposees, 'mis en cause proposé')} à valider`);
  if (r.liens) morceaux.push(`${pluriel(r.liens, 'lien proposé')} pour la cartographie`);
  return morceaux.length ? `Description actualisée — ${morceaux.join(' · ')}` : 'Description actualisée';
}

export function useDescriptionActualisation({
  numero,
  enabled,
  showToast,
  onPropositions,
}: {
  numero: string;
  /** Faux pour un compte sans attaché : aucune requête n'est faite. */
  enabled: boolean;
  showToast: (message: string, type: ToastType) => void;
  onPropositions: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DescriptionProgress | null>(null);
  const [lastResult, setLastResult] = useState<'success' | 'error' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vus = useRef({ etapes: 0, ecritures: 0, echecs: 0 });
  const actif = useRef(true);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const resync = useCallback(() => {
    useEnquetesStore.getState().syncAndRefresh().catch(() => {});
    onPropositions();
  }, [onPropositions]);

  const terminer = useCallback((etat: Etat) => {
    stop();
    setRunning(false);
    setProgress(null);
    const r = etat.resultat || {};
    if (r.chantier) {
      // Pas un échec : le dossier part en dépouillement de nuit.
      showToast(r.message || 'Dossier volumineux — actualisation basculée en chantier de dépouillement (Assistant de justice → Chantiers).', 'warning');
      setLastResult(null);
      return;
    }
    if (r.ok) {
      resync();
      showToast(bilanActualisation(r), 'success');
      setLastResult('success');
      const manquantes = (r.pieces || 0) - (r.fichees || 0);
      if (manquantes > 0) {
        // Toast suivant, après lecture du bilan.
        setTimeout(() => {
          if (actif.current) showToast(`${pluriel(manquantes, 'pièce')} pas encore résumée${manquantes > 1 ? 's' : ''} : elles seront intégrées au fil de l'eau ou à la prochaine actualisation.`, 'info');
        }, 4500);
      }
    } else {
      // Écritures partielles possibles (rôles, propositions) : on resynchronise quand même.
      resync();
      showToast(r.error || 'Actualisation impossible pour le moment', 'error');
      setLastResult('error');
    }
  }, [resync, showToast, stop]);

  const suivre = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/actualiser-description', { cache: 'no-store' });
      const data = await res.json().catch(() => ({})) as { etat?: Etat | null };
      const etat = data.etat;
      vus.current.echecs = 0;
      if (!etat || etat.numero !== numero) {
        // État perdu (service relancé) : on cesse de suivre, sans fausse issue.
        stop();
        setRunning(false);
        setProgress(null);
        showToast('Le suivi de l\'actualisation a été interrompu (service attaché relancé ?) — relancez-la si la description n\'a pas changé.', 'warning');
        return;
      }
      // Étapes nouvelles → toast (le dernier en date seulement : un toast à la fois).
      const nouvelles = etat.etapes.slice(vus.current.etapes);
      vus.current.etapes = etat.etapes.length;
      const derniere = nouvelles.filter((e) => e.phase !== 'fin').pop();
      if (derniere && !etat.fini) showToast(`Actualisation : ${derniere.texte}`, 'info');
      // Écriture tombée (description, rôle, proposition) → la fiche suit tout de suite.
      if ((etat.ecritures || 0) > vus.current.ecritures) {
        vus.current.ecritures = etat.ecritures || 0;
        resync();
      }
      if (etat.fini) { terminer(etat); return; }
      setProgress({ pourcent: etat.pourcent, restantMs: etat.restantMs, detail: etat.detail });
    } catch {
      vus.current.echecs += 1;
      if (vus.current.echecs >= ECHECS_MAX) {
        stop();
        setRunning(false);
        setProgress(null);
        showToast('Service de l\'attaché injoignable — l\'actualisation continue peut-être côté serveur ; rouvrez la fiche pour reprendre le suivi.', 'error');
        return;
      }
    }
    if (actif.current) timer.current = setTimeout(suivre, POLL_MS);
  }, [numero, resync, showToast, stop, terminer]);

  const commencerSuivi = useCallback((etat: Etat | undefined, reprise: boolean) => {
    vus.current = { etapes: reprise ? 0 : (etat?.etapes.length || 0), ecritures: reprise ? (etat?.ecritures || 0) : 0, echecs: 0 };
    setRunning(true);
    setLastResult(null);
    if (etat) setProgress({ pourcent: etat.pourcent, restantMs: etat.restantMs, detail: etat.detail });
    stop();
    timer.current = setTimeout(suivre, reprise ? 0 : POLL_MS);
  }, [stop, suivre]);

  const lancer = useCallback(async () => {
    if (running) {
      showToast('Actualisation déjà en cours sur ce dossier — suivez son avancement à côté du titre Description.', 'info');
      return;
    }
    try {
      const res = await fetch('/api/attache/actualiser-description', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; running?: boolean; memeDossier?: boolean; etat?: Etat; error?: string };
      if (res.status === 202 || data.running) {
        if (data.memeDossier) {
          showToast('Une actualisation de ce dossier tourne déjà — suivi repris.', 'info');
          commencerSuivi(data.etat, true);
        } else {
          showToast(`L'attaché actualise déjà un autre dossier${data.etat?.numero ? ` (${data.etat.numero})` : ''} — une seule actualisation à la fois, réessayez dans quelques minutes.`, 'warning');
        }
        return;
      }
      if (res.ok && data.ok && data.etat) {
        showToast(`Actualisation lancée — l'attaché relit tout le dossier (CR, actes, pièces) · ${formatRestant(data.etat.restantMs)}. Vous pouvez continuer à travailler.`, 'info');
        commencerSuivi(data.etat, false);
        return;
      }
      if (res.status === 409) {
        showToast('Trousseau de l\'attaché non remis — remettez-le depuis Paramètres → Attaché IA.', 'error');
      } else {
        showToast(data.error || 'Actualisation impossible pour le moment', 'error');
      }
      setLastResult('error');
    } catch {
      showToast('Service de l\'attaché indisponible', 'error');
      setLastResult('error');
    }
  }, [running, numero, showToast, commencerSuivi]);

  // À l'ouverture de la fiche : une actualisation de CE dossier déjà en cours
  // (lancée avant fermeture, ou depuis un autre poste) → on reprend le suivi.
  useEffect(() => {
    actif.current = true;
    if (!enabled) return;
    let annule = false;
    fetch('/api/attache/actualiser-description', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { etat?: Etat | null } | null) => {
        const etat = data?.etat;
        if (!annule && etat && etat.numero === numero && !etat.fini) commencerSuivi(etat, true);
      })
      .catch(() => {});
    return () => { annule = true; actif.current = false; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero, enabled]);

  // L'issue (✓/⚠) reste visible quelques secondes sur l'icône.
  useEffect(() => {
    if (!lastResult) return;
    const t = setTimeout(() => setLastResult(null), lastResult === 'error' ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [lastResult]);

  const status = running ? 'running' : (lastResult || 'idle');
  return { lancer, status, progress } as const;
}
