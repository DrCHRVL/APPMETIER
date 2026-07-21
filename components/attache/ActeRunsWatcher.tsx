'use client';

/**
 * ActeRunsWatcher — surveillance GLOBALE des retouches / réécritures IA d'actes.
 *
 * Monté une seule fois au niveau de l'application (sous ToastProvider), il
 * accompagne le store useActeRunsStore : tant qu'un run est en cours, il sonde
 * les actes du dossier concerné et détecte la fin lorsque l'`updatedAt` de
 * l'acte a changé (le service attaché a ré-enregistré la nouvelle version).
 *
 * À la fin, il émet un TOAST global — « Enquête X — acte retouché » — de sorte
 * que le magistrat soit prévenu MÊME s'il a quitté l'enquête pour un autre
 * dossier. Il clôt aussi les runs restés trop longtemps sans conclusion (app
 * fermée pendant le run, service tombé), pour ne pas laisser un indicateur
 * « en cours » fantôme.
 *
 * Chiffrement E2E : le déchiffrement se fait ICI dans le navigateur (comme la
 * section « Actes rédigés »), l'app ne voit jamais le texte des actes.
 */
import { useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useActeRunsStore, RUN_MAX_AGE_MS, acteDoneToastMessage, type ActeRun } from '@/stores/useActeRunsStore';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI?: Record<string, AnyFn> }).electronAPI;

/** Cadence de sondage tant qu'au moins un run est en cours. */
const POLL_MS = 6000;

export function ActeRunsWatcher() {
  const runs = useActeRunsStore((s) => s.runs);
  const hydrate = useActeRunsStore((s) => s.hydrate);
  const finishRun = useActeRunsStore((s) => s.finishRun);
  const { showToast } = useToast();

  // Restaure les runs persistés au tout premier montage (côté client).
  useEffect(() => { hydrate(); }, [hydrate]);

  const hasRuns = Object.keys(runs).length > 0;

  useEffect(() => {
    if (!hasRuns) return;
    let cancelled = false;

    const tick = async () => {
      // Toujours relire l'état frais du store (pas la valeur capturée à l'effet).
      const active = Object.values(useActeRunsStore.getState().runs);
      if (active.length === 0) return;

      // Regroupe par dossier : une seule requête liste par numéro.
      const byNumero = new Map<string, ActeRun[]>();
      for (const r of active) {
        const list = byNumero.get(r.numero);
        if (list) list.push(r); else byNumero.set(r.numero, [r]);
      }

      for (const [numero, list] of byNumero) {
        if (cancelled) return;
        const now = Date.now();
        const wanted = new Set(list.map((r) => r.prodId));

        // Déchiffre uniquement les actes qui nous intéressent.
        let updatedById: Record<string, string | undefined> | null = null;
        try {
          const res = await fetch('/api/attache/productions?numero=' + encodeURIComponent(numero));
          if (res.ok) {
            const { productions } = await res.json();
            updatedById = {};
            for (const p of (productions || []) as Array<{ id: string; envelope: unknown }>) {
              if (!wanted.has(p.id)) continue;
              const decrypt = eapi()?.attache_decrypt;
              if (!decrypt) { updatedById = null; break; }
              const rec = await decrypt(p.envelope).catch(() => null);
              if (rec && typeof rec === 'object') updatedById[p.id] = (rec as { updatedAt?: string }).updatedAt;
            }
          }
        } catch {
          updatedById = null; // service injoignable : on retentera au prochain tick
        }

        for (const r of list) {
          if (cancelled) return;
          // Filet anti-fantôme : run trop vieux → on clôt sans toast (issue inconnue).
          if (now - r.startedAt > RUN_MAX_AGE_MS) { finishRun(r.numero, r.prodId); continue; }
          if (!updatedById) continue;
          const updatedAt = updatedById[r.prodId];
          if (!updatedAt) continue; // acte pas encore ré-enregistré (ou supprimé)
          if (updatedAt !== r.prevUpdatedAt) {
            finishRun(r.numero, r.prodId);
            showToast(acteDoneToastMessage(r.numero, r.titre, r.kind), 'success');
          }
        }
      }
    };

    // Premier tick rapide, puis à intervalle régulier.
    const t0 = setTimeout(tick, 1500);
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearTimeout(t0); clearInterval(id); };
  }, [hasRuns, finishRun, showToast]);

  return null;
}
