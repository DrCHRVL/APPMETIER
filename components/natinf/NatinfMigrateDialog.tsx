'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Loader2, DatabaseZap, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { ElectronBridge } from '@/utils/electronBridge';
import { deriveInfractionNatinfCodes, infractionTagsOf } from '@/utils/deriveEnqueteNatinf';
import type { Enquete } from '@/types/interfaces';

const storageKey = (id: string) => `ctx_${id}_enquetes`;

type Phase = 'idle' | 'scanning' | 'preview' | 'applying' | 'done';

interface Scan {
  totalDossiers: number;
  avecInfractions: number;
  migrables: number;     // recevront des codes NATINF
  dejaMigres: number;    // possèdent déjà infractionNatinfCodes (non écrasés)
  nonRattaches: number;  // ont des infractions mais aucun code résolu
  unresolvedValues: string[];
  perContentieux: { id: string; label: string; total: number; migrables: number }[];
}

/**
 * Migration batch « tags d'infraction → NATINF » des DOSSIERS (enquêtes).
 *
 * Backfill non destructif : pour chaque enquête de chaque contentieux accessible,
 * on résout ses tags d'infraction vers des codes NATINF (via le rattachement des
 * définitions de tag) et on les écrit dans `Enquete.infractionNatinfCodes`. Les
 * tags ne sont PAS supprimés (sécurité / rollback). Un dossier déjà migré n'est
 * jamais réécrit. Aperçu à blanc obligatoire avant toute écriture.
 *
 * À lancer APRÈS avoir rattaché les tags au NATINF (assistant de réconciliation).
 */
export function NatinfMigrateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { getTagsByCategory } = useTags();
  const { accessibleContentieux } = useUser();
  const { showToast } = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<Scan | null>(null);
  const [applied, setApplied] = useState<{ dossiers: number; contentieux: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setScan(null);
      setApplied(null);
      setError(null);
    }
  }, [open]);

  const loadCtx = async (id: string): Promise<Enquete[]> => {
    const data = await ElectronBridge.getData<Enquete[]>(storageKey(id), []);
    return Array.isArray(data) ? data : [];
  };

  const runScan = async () => {
    setError(null);
    setPhase('scanning');
    try {
      const defs = getTagsByCategory('infractions');
      const unresolved = new Set<string>();
      let totalDossiers = 0, avecInfractions = 0, migrables = 0, dejaMigres = 0, nonRattaches = 0;
      const perContentieux: Scan['perContentieux'] = [];

      for (const c of accessibleContentieux) {
        const enquetes = await loadCtx(c.id);
        let ctxMig = 0;
        for (const e of enquetes) {
          totalDossiers++;
          const infra = infractionTagsOf(e.tags || []);
          if (infra.length === 0) continue;
          avecInfractions++;
          if (e.infractionNatinfCodes && e.infractionNatinfCodes.length > 0) { dejaMigres++; continue; }
          const { codes, unresolved: u } = deriveInfractionNatinfCodes(infra, defs);
          u.forEach(v => unresolved.add(v));
          if (codes.length > 0) { migrables++; ctxMig++; }
          else nonRattaches++;
        }
        perContentieux.push({ id: c.id, label: c.label, total: enquetes.length, migrables: ctxMig });
      }

      setScan({
        totalDossiers, avecInfractions, migrables, dejaMigres, nonRattaches,
        unresolvedValues: [...unresolved].sort((a, b) => a.localeCompare(b, 'fr')),
        perContentieux,
      });
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’analyse des dossiers.');
      setPhase('idle');
    }
  };

  const apply = async () => {
    setError(null);
    setPhase('applying');
    try {
      const defs = getTagsByCategory('infractions');
      let dossiers = 0, ctxTouched = 0;

      for (const c of accessibleContentieux) {
        const enquetes = await loadCtx(c.id);
        let changed = false;
        const next = enquetes.map(e => {
          const infra = infractionTagsOf(e.tags || []);
          if (infra.length === 0) return e;
          // Ne jamais écraser des codes déjà présents (saisie NATINF native).
          if (e.infractionNatinfCodes && e.infractionNatinfCodes.length > 0) return e;
          const { codes } = deriveInfractionNatinfCodes(infra, defs);
          if (codes.length === 0) return e;
          changed = true; dossiers++;
          return { ...e, infractionNatinfCodes: codes };
        });
        if (changed) {
          await ElectronBridge.setData(storageKey(c.id), next);
          await ElectronBridge.flush(storageKey(c.id));
          ctxTouched++;
        }
      }

      setApplied({ dossiers, contentieux: ctxTouched });
      setPhase('done');
      showToast(`${dossiers} dossier(s) migré(s) vers NATINF`, 'success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la migration.');
      setPhase('preview');
    }
  };

  const busy = phase === 'scanning' || phase === 'applying';

  return (
    <Dialog open={open} onOpenChange={() => { if (!busy) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DatabaseZap className="h-5 w-5 text-emerald-600" />
            Migrer les infractions des dossiers vers NATINF
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-gray-600">
            Convertit les tags d&apos;infraction des dossiers en codes NATINF (champ
            <code className="mx-1 px-1 bg-gray-100 rounded text-xs">infractionNatinfCodes</code>),
            pour tous les contentieux accessibles. <strong>Non destructif</strong> : les tags
            ne sont pas supprimés et les dossiers déjà migrés ne sont pas réécrits.
          </p>
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 text-xs flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            À lancer <strong>après</strong> avoir rattaché les tags au NATINF (assistant de
            réconciliation). Sauvegardez vos données avant : l&apos;écriture porte sur les
            enquêtes de tous les contentieux.
          </p>

          {error && (
            <p className="text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 text-xs">{error}</p>
          )}

          {phase === 'scanning' && (
            <p className="flex items-center gap-2 text-gray-600 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Analyse des dossiers…
            </p>
          )}
          {phase === 'applying' && (
            <p className="flex items-center gap-2 text-gray-600 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Migration en cours…
            </p>
          )}

          {phase === 'preview' && scan && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="À migrer" value={scan.migrables} accent="emerald" />
                <Stat label="Déjà migrés" value={scan.dejaMigres} />
                <Stat label="Non rattachés" value={scan.nonRattaches} accent={scan.nonRattaches ? 'amber' : undefined} />
              </div>
              <p className="text-xs text-gray-500">
                {scan.avecInfractions} dossier(s) avec infraction sur {scan.totalDossiers} au total.
              </p>

              {scan.perContentieux.some(p => p.migrables > 0) && (
                <div className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-32 overflow-auto">
                  {scan.perContentieux.filter(p => p.migrables > 0).map(p => (
                    <div key={p.id} className="flex justify-between px-2.5 py-1.5 text-xs">
                      <span className="text-gray-700">{p.label}</span>
                      <span className="font-medium text-emerald-700">{p.migrables} à migrer</span>
                    </div>
                  ))}
                </div>
              )}

              {scan.unresolvedValues.length > 0 && (
                <div className="text-xs">
                  <p className="text-amber-700 font-medium mb-1">
                    {scan.unresolvedValues.length} type(s) d&apos;infraction non rattaché(s) au NATINF
                    (ces infractions resteront en tag) :
                  </p>
                  <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-h-24 overflow-auto">
                    {scan.unresolvedValues.join(' · ')}
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === 'done' && applied && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-emerald-700 font-medium">
                <Check className="h-4 w-4" />
                {applied.dossiers} dossier(s) migré(s) sur {applied.contentieux} contentieux.
              </p>
              <p className="text-xs text-gray-600">
                Rechargez l&apos;application pour que tous les écrans relisent les données migrées.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {phase === 'idle' && (
            <>
              <Button variant="outline" onClick={onClose}>Annuler</Button>
              <Button onClick={runScan}>Analyser les dossiers</Button>
            </>
          )}
          {phase === 'preview' && scan && (
            <>
              <Button variant="outline" onClick={onClose}>Annuler</Button>
              <Button onClick={apply} disabled={scan.migrables === 0}>
                Appliquer la migration ({scan.migrables})
              </Button>
            </>
          )}
          {phase === 'done' && (
            <>
              <Button variant="outline" onClick={onClose}>Fermer</Button>
              <Button onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Recharger maintenant
              </Button>
            </>
          )}
          {busy && <Button disabled><Loader2 className="h-4 w-4 animate-spin" /></Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'amber' }) {
  const color = accent === 'emerald' ? 'text-emerald-700' : accent === 'amber' ? 'text-amber-700' : 'text-gray-800';
  return (
    <div className="border border-slate-200 rounded-md px-2.5 py-2 text-center">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-[11px] text-gray-500">{label}</div>
    </div>
  );
}
