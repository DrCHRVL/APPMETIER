'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Loader2, Database, AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { ElectronBridge } from '@/utils/electronBridge';
import { electronStorage } from '@/services/storage/electronStorage';
import { APP_CONFIG } from '@/config/constants';
import { useNatinf } from '@/hooks/useNatinf';
import { toRef } from '@/lib/natinf/natinfData';
import { deriveInfractionNatinfCodes, infractionTagsOf, type TagNatinfDef } from '@/utils/deriveEnqueteNatinf';
import { NatinfPicker } from './NatinfPicker';
import { NatinfBadge } from './NatinfBadge';
import type { Enquete } from '@/types/interfaces';
import type { ResultatAudience } from '@/types/audienceTypes';
import type { DossierInstruction } from '@/types/instructionTypes';
import type { NatinfEntry, NatinfRef } from '@/types/natinf';

const storageKey = (id: string) => `ctx_${id}_enquetes`;
const AUDIENCE_STORAGE_KEY = 'audience_resultats';
const instructionKey = (username: string) => `${APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS}__${username}`;

/** Infractions (valeurs de tag) d'un résultat d'audience, sous forme de
 *  pseudo-tags pour la résolution NATINF (résolus par valeur via les défs). */
const resultInfractionTags = (r: ResultatAudience): { id: string; value: string }[] => {
  const vals = r.typesInfraction?.length ? r.typesInfraction : (r.typeInfraction ? [r.typeInfraction] : []);
  return vals.map(v => ({ id: '', value: v }));
};

/** Tous les chefs d'un dossier d'instruction (mise en examen + saisine in rem). */
const chefsOf = (d: DossierInstruction): { qualification: string; natinfCode?: string }[] => [
  ...(d.misEnExamen || []).flatMap(m => m.infractions || []),
  ...(d.saisine || []),
];

/** Rattache un chef au NATINF en best-effort : résout sa qualification (souvent
 *  une valeur de tag) vers un code, et dénormalise le snapshot. Inchangé si déjà
 *  pourvu d'un code ou si la qualification n'est pas rattachable. */
function backfillChef<T extends { qualification: string; natinfCode?: string; natinfRef?: NatinfRef }>(
  chef: T,
  defs: TagNatinfDef[],
  getByCode: (code: string) => NatinfEntry | undefined,
): { chef: T; changed: boolean } {
  if (chef.natinfCode || !chef.qualification) return { chef, changed: false };
  const { codes } = deriveInfractionNatinfCodes([{ id: '', value: chef.qualification }], defs);
  const code = codes[0];
  if (!code) return { chef, changed: false };
  const entry = getByCode(code);
  return { chef: { ...chef, natinfCode: code, natinfRef: entry ? toRef(entry) : undefined }, changed: true };
}

/** Réécrit un dossier en rattachant ses chefs au NATINF ; renvoie le nb migrés. */
function migrateDossierChefs(
  d: DossierInstruction,
  defs: TagNatinfDef[],
  getByCode: (code: string) => NatinfEntry | undefined,
): { dossier: DossierInstruction; migres: number } {
  let migres = 0;
  const misEnExamen = (d.misEnExamen || []).map(m => ({
    ...m,
    infractions: (m.infractions || []).map(inf => {
      const r = backfillChef(inf, defs, getByCode);
      if (r.changed) migres++;
      return r.chef;
    }),
  }));
  const saisine = d.saisine
    ? d.saisine.map(s => {
        const r = backfillChef(s, defs, getByCode);
        if (r.changed) migres++;
        return r.chef;
      })
    : d.saisine;
  return { dossier: { ...d, misEnExamen, saisine }, migres };
}

type Phase = 'idle' | 'scanning' | 'preview' | 'applying' | 'done';

interface Scan {
  totalDossiers: number;
  avecInfractions: number;
  migrables: number;     // recevront des codes NATINF
  dejaMigres: number;    // possèdent déjà infractionNatinfCodes (non écrasés)
  nonRattaches: number;  // ont des infractions mais aucun code résolu
  unresolvedValues: string[];
  perContentieux: { id: string; label: string; total: number; migrables: number }[];
  // Résultats d'audience (clé globale audience_resultats)
  audienceAvecInfractions: number;
  audienceMigrables: number;
  audienceDejaMigres: number;
  audienceNonRattaches: number;
  // Chefs d'instruction (dossiers de l'utilisateur courant)
  chefsTotal: number;
  chefsMigrables: number;
  chefsDejaMigres: number;
  chefsNonRattaches: number;
}

/** Données brutes chargées une fois au scan, recalculables sans relire le stockage. */
interface RawData {
  contentieux: { id: string; label: string; enquetes: Enquete[] }[];
  resultats: ResultatAudience[];
  chefs: { qualification: string; natinfCode?: string }[];
}

/**
 * Rattachements manuels « valeur de tag → NATINF » saisis dans le dialogue, sous
 * forme de définitions de tag synthétiques. Permet de rattacher d'ANCIENS tags
 * (supprimés de la nomenclature) qui n'existent plus que comme valeurs sur les
 * dossiers et sont donc hors de portée de l'assistant de réconciliation.
 *
 * Id préfixé (non vide, unique) pour ne pas percuter la résolution par id des
 * pseudo-tags d'audience/chefs (qui utilisent `id: ''`) ; placés en tête pour
 * primer sur d'éventuelles définitions homonymes lors de la résolution par valeur.
 */
const overrideDefs = (overrides: Record<string, NatinfEntry>): TagNatinfDef[] =>
  Object.entries(overrides).map(([value, entry]) => ({
    id: `__natinf_override__${value}`,
    value,
    natinfCodes: [entry.code],
  }));

/** Calcule l'aperçu de migration depuis les données brutes (pur, recalculable). */
function computeScan(raw: RawData, defs: TagNatinfDef[]): Scan {
  const unresolved = new Set<string>();
  let totalDossiers = 0, avecInfractions = 0, migrables = 0, dejaMigres = 0, nonRattaches = 0;
  const perContentieux: Scan['perContentieux'] = [];

  for (const c of raw.contentieux) {
    let ctxMig = 0;
    for (const e of c.enquetes) {
      totalDossiers++;
      const infra = infractionTagsOf(e.tags || []);
      if (infra.length === 0) continue;
      avecInfractions++;
      if (Array.isArray(e.infractionNatinfCodes)) { dejaMigres++; continue; }
      const { codes, unresolved: u } = deriveInfractionNatinfCodes(infra, defs);
      u.forEach(v => unresolved.add(v));
      if (codes.length > 0) { migrables++; ctxMig++; }
      else nonRattaches++;
    }
    perContentieux.push({ id: c.id, label: c.label, total: c.enquetes.length, migrables: ctxMig });
  }

  let audienceAvecInfractions = 0, audienceMigrables = 0, audienceDejaMigres = 0, audienceNonRattaches = 0;
  for (const r of raw.resultats) {
    const infra = resultInfractionTags(r);
    if (infra.length === 0) continue;
    audienceAvecInfractions++;
    if (Array.isArray(r.infractionNatinfCodes)) { audienceDejaMigres++; continue; }
    const { codes, unresolved: u } = deriveInfractionNatinfCodes(infra, defs);
    u.forEach(v => unresolved.add(v));
    if (codes.length > 0) audienceMigrables++;
    else audienceNonRattaches++;
  }

  let chefsTotal = 0, chefsMigrables = 0, chefsDejaMigres = 0, chefsNonRattaches = 0;
  for (const chef of raw.chefs) {
    if (!chef.qualification) continue;
    chefsTotal++;
    if (chef.natinfCode) { chefsDejaMigres++; continue; }
    const { codes, unresolved: u } = deriveInfractionNatinfCodes([{ id: '', value: chef.qualification }], defs);
    u.forEach(v => unresolved.add(v));
    if (codes.length > 0) chefsMigrables++;
    else chefsNonRattaches++;
  }

  return {
    totalDossiers, avecInfractions, migrables, dejaMigres, nonRattaches,
    unresolvedValues: [...unresolved].sort((a, b) => a.localeCompare(b, 'fr')),
    perContentieux,
    audienceAvecInfractions, audienceMigrables, audienceDejaMigres, audienceNonRattaches,
    chefsTotal, chefsMigrables, chefsDejaMigres, chefsNonRattaches,
  };
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
  const { accessibleContentieux, user } = useUser();
  const { getByCode } = useNatinf();
  const { showToast } = useToast();

  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<Scan | null>(null);
  const [applied, setApplied] = useState<{ dossiers: number; contentieux: number; audience: number; chefs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Liste figée (au scan) des valeurs orphelines à rattacher manuellement, et
  // rattachements choisis (valeur de tag -> NATINF) appliqués à la migration.
  const [orphanValues, setOrphanValues] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, NatinfEntry>>({});
  const rawRef = useRef<RawData | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('idle');
      setScan(null);
      setApplied(null);
      setError(null);
      setOrphanValues([]);
      setOverrides({});
      rawRef.current = null;
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

      // Chargement unique des données brutes (réutilisées pour le recalcul à chaud
      // quand l'utilisateur rattache manuellement d'anciens tags).
      const contentieux: RawData['contentieux'] = [];
      for (const c of accessibleContentieux) {
        contentieux.push({ id: c.id, label: c.label, enquetes: await loadCtx(c.id) });
      }
      const resultatsMap = (await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY)) || {};
      const resultats = Object.values(resultatsMap);
      const chefs: RawData['chefs'] = [];
      const iKey = user?.windowsUsername ? instructionKey(user.windowsUsername) : null;
      if (iKey) {
        const dossiers = await ElectronBridge.getData<DossierInstruction[]>(iKey, []);
        for (const d of (Array.isArray(dossiers) ? dossiers : [])) {
          for (const chef of chefsOf(d)) chefs.push({ qualification: chef.qualification, natinfCode: chef.natinfCode });
        }
      }

      const raw: RawData = { contentieux, resultats, chefs };
      rawRef.current = raw;
      const fresh = computeScan(raw, defs);
      setOverrides({});
      setOrphanValues(fresh.unresolvedValues);
      setScan(fresh);
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’analyse des dossiers.');
      setPhase('idle');
    }
  };

  /** Recalcule l'aperçu à chaud en intégrant les rattachements manuels. */
  const recompute = (next: Record<string, NatinfEntry>) => {
    if (!rawRef.current) return;
    const defs = [...overrideDefs(next), ...getTagsByCategory('infractions')];
    setScan(computeScan(rawRef.current, defs));
  };

  const assignOverride = (value: string, entry: NatinfEntry) => {
    const next = { ...overrides, [value]: entry };
    setOverrides(next);
    recompute(next);
  };

  const removeOverride = (value: string) => {
    const next = { ...overrides };
    delete next[value];
    setOverrides(next);
    recompute(next);
  };

  const apply = async () => {
    setError(null);
    setPhase('applying');
    try {
      // Définitions réelles + rattachements manuels des anciens tags orphelins.
      const defs = [...overrideDefs(overrides), ...getTagsByCategory('infractions')];
      let dossiers = 0, ctxTouched = 0;

      for (const c of accessibleContentieux) {
        const enquetes = await loadCtx(c.id);
        let changed = false;
        const next = enquetes.map(e => {
          const infra = infractionTagsOf(e.tags || []);
          if (infra.length === 0) return e;
          // Ne jamais écraser des codes déjà présents (saisie NATINF native).
          if (Array.isArray(e.infractionNatinfCodes)) return e;
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

      // Résultats d'audience (clé globale) : même dérivation, sans écraser un
      // résultat déjà pourvu de codes.
      const resultats = (await electronStorage.read<Record<string, ResultatAudience>>(AUDIENCE_STORAGE_KEY)) || {};
      let audienceMigres = 0;
      let audienceChanged = false;
      const nextResultats: Record<string, ResultatAudience> = {};
      for (const [key, r] of Object.entries(resultats)) {
        const infra = resultInfractionTags(r);
        if (infra.length === 0 || Array.isArray(r.infractionNatinfCodes)) { nextResultats[key] = r; continue; }
        const { codes } = deriveInfractionNatinfCodes(infra, defs);
        if (codes.length === 0) { nextResultats[key] = r; continue; }
        nextResultats[key] = { ...r, infractionNatinfCodes: codes };
        audienceChanged = true; audienceMigres++;
      }
      if (audienceChanged) await electronStorage.createOrUpdate(AUDIENCE_STORAGE_KEY, nextResultats);

      // Chefs d'instruction (dossiers de l'utilisateur courant)
      let chefsMigres = 0;
      const iKey = user?.windowsUsername ? instructionKey(user.windowsUsername) : null;
      if (iKey) {
        const dossiers = await ElectronBridge.getData<DossierInstruction[]>(iKey, []);
        if (Array.isArray(dossiers) && dossiers.length) {
          let changed = false;
          const next = dossiers.map(d => {
            const r = migrateDossierChefs(d, defs, getByCode);
            if (r.migres > 0) { changed = true; chefsMigres += r.migres; }
            return r.dossier;
          });
          if (changed) {
            await ElectronBridge.setData(iKey, next);
            await ElectronBridge.flush(iKey);
          }
        }
      }

      setApplied({ dossiers, contentieux: ctxTouched, audience: audienceMigres, chefs: chefsMigres });
      setPhase('done');
      showToast(`${dossiers} dossier(s) + ${audienceMigres} audience(s) + ${chefsMigres} chef(s) migré(s)`, 'success');
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
            <Database className="h-5 w-5 text-emerald-600" />
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

              {scan.audienceAvecInfractions > 0 && (
                <div className="flex items-center justify-between text-xs border border-slate-200 rounded px-2.5 py-1.5">
                  <span className="text-gray-700">Résultats d&apos;audience (stats de peines)</span>
                  <span className="font-medium text-emerald-700">
                    {scan.audienceMigrables} à migrer
                    {scan.audienceDejaMigres > 0 && <span className="text-gray-400"> · {scan.audienceDejaMigres} déjà</span>}
                    {scan.audienceNonRattaches > 0 && <span className="text-amber-600"> · {scan.audienceNonRattaches} non rattaché(s)</span>}
                  </span>
                </div>
              )}

              {scan.chefsTotal > 0 && (
                <div className="flex items-center justify-between text-xs border border-slate-200 rounded px-2.5 py-1.5">
                  <span className="text-gray-700">Chefs d&apos;instruction (cartographie)</span>
                  <span className="font-medium text-emerald-700">
                    {scan.chefsMigrables} à migrer
                    {scan.chefsDejaMigres > 0 && <span className="text-gray-400"> · {scan.chefsDejaMigres} déjà</span>}
                    {scan.chefsNonRattaches > 0 && <span className="text-amber-600"> · {scan.chefsNonRattaches} non rattaché(s)</span>}
                  </span>
                </div>
              )}

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

              {orphanValues.length > 0 && (
                <div className="text-xs space-y-1.5">
                  <p className="text-amber-700 font-medium">
                    {orphanValues.length} type(s) d&apos;infraction non rattaché(s) au NATINF.
                    Rattachez ici les anciens tags qui n&apos;existent plus dans la nomenclature
                    (hors de portée de l&apos;assistant de réconciliation) :
                  </p>
                  <div className="border border-amber-200 rounded-md divide-y divide-amber-100 max-h-56 overflow-auto">
                    {orphanValues.map((value) => {
                      const chosen = overrides[value];
                      return (
                        <div key={value} className="flex items-center gap-2 px-2 py-1.5">
                          <span className="w-32 shrink-0 truncate font-medium text-gray-800" title={value}>{value}</span>
                          <span className="text-gray-300">→</span>
                          <div className="flex-1 min-w-0">
                            {chosen ? (
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-gray-500">{chosen.code}</span>
                                <span className="min-w-0 flex-1 truncate text-gray-700" title={chosen.libelle}>{chosen.libelle}</span>
                                <NatinfBadge nature={chosen.nature} quantumLabel={chosen.quantumLabel} className="shrink-0" />
                                <button
                                  type="button"
                                  onClick={() => removeOverride(value)}
                                  className="shrink-0 text-gray-400 hover:text-red-600"
                                  title="Retirer le rattachement"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <NatinfPicker onSelect={(e) => assignOverride(value, e)} placeholder="Rechercher un NATINF…" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {Object.keys(overrides).length > 0 ? (
                    <p className="text-emerald-700">
                      {Object.keys(overrides).length} ancien(s) tag(s) rattaché(s) — pris en compte dans la migration.
                    </p>
                  ) : (
                    <p className="text-gray-400">Les types laissés sans rattachement resteront en tag.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {phase === 'done' && applied && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-emerald-700 font-medium">
                <Check className="h-4 w-4" />
                {applied.dossiers} dossier(s) sur {applied.contentieux} contentieux
                {applied.audience > 0 && ` + ${applied.audience} résultat(s) d'audience`}
                {applied.chefs > 0 && ` + ${applied.chefs} chef(s) d'instruction`} migré(s).
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
              <Button onClick={apply} disabled={scan.migrables === 0 && scan.audienceMigrables === 0 && scan.chefsMigrables === 0}>
                Appliquer la migration ({scan.migrables + scan.audienceMigrables + scan.chefsMigrables})
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
