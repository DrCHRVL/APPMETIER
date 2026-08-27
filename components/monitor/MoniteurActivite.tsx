// components/monitor/MoniteurActivite.tsx
//
// MONITEUR D'ACTIVITÉ — le « gestionnaire des tâches » de SIRAL.
//
// Trois volets :
//  - NAVIGATEUR : ce que fait cet onglet (veille de recoupements, lecture des
//    pièces, synchronisations), les blocages du thread principal (le « lag »
//    ressenti) et la mémoire JS ;
//  - SERVEUR : retard de l'event loop et mémoire du serveur SIRAL ;
//  - ATTACHÉ (admin) : les travaux de fond du sidecar (ingestion, chantiers,
//    registre…) — en cours, dernières durées, bilans.
//
// Aucun coût quand la fenêtre est fermée : la collecte navigateur est passive
// (PerformanceObserver), le serveur n'est interrogé que fenêtre ouverte.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Cpu, Globe, HardDrive, Server } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  ActiviteNavigateur,
  activitesEnCours,
  activitesHistorique,
  longTasksInfo,
  memoireJs,
  surChangement,
} from '@/lib/monitor/clientMonitor';
import { getDocTextCacheStats } from '@/utils/documents/documentTextSearch';

interface ServeurInfo {
  demarreA: string;
  eventLoop: { moyenMs: number; maxMs: number; p99Ms: number };
  memoire: { rssMB: number; heapMB: number };
}

interface AttacheActivite {
  nom: string;
  libelle?: string;
  enCours?: boolean;
  debutAt?: string;
  finAt?: string;
  dureeMs?: number;
  erreur?: string | null;
  dernierBilan?: { dossiers: number; empreintes: number; extraites: number; entites: number; echecs: number; enAttente: number };
}

interface AttacheInfo {
  demarreA: string;
  activites: AttacheActivite[];
  runsEnCours: number;
  chantierActif: boolean;
  eventLoop: { moyenMs: number; maxMs: number; p99Ms: number };
  memoire: { rssMB: number; heapMB: number };
}

const FAMILLE_LIBELLE: Record<ActiviteNavigateur['famille'], string> = {
  veille: 'Veille de recoupements',
  pieces: 'Pièces',
  sync: 'Synchronisation',
  sauvegarde: 'Sauvegarde',
  autre: 'Autre',
};

function dureeLisible(ms: number | undefined): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function depuis(iso: string | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return `depuis ${dureeLisible(Math.max(0, ms))}`;
}

/** Pastille de santé : vert fluide, orange chargé, rouge saturé. */
function Sante({ niveau }: { niveau: 'ok' | 'charge' | 'sature' }) {
  const couleur = niveau === 'ok' ? 'bg-emerald-500' : niveau === 'charge' ? 'bg-amber-500' : 'bg-red-500';
  const anime = niveau === 'sature' ? 'animate-pulse' : '';
  return <span className={`inline-block w-2 h-2 rounded-full ${couleur} ${anime}`} />;
}

function niveauLag(msBloques: number): 'ok' | 'charge' | 'sature' {
  if (msBloques > 5000) return 'sature';
  if (msBloques > 1000) return 'charge';
  return 'ok';
}

function niveauEventLoop(p99Ms: number): 'ok' | 'charge' | 'sature' {
  if (p99Ms > 500) return 'sature';
  if (p99Ms > 100) return 'charge';
  return 'ok';
}

function LigneActivite({ a }: { a: ActiviteNavigateur }) {
  const enCours = a.termineA === undefined;
  return (
    <div className="flex items-start justify-between gap-2 py-1 text-xs">
      <div className="min-w-0">
        <span className="text-gray-700">
          {enCours && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5 align-middle" />}
          {a.label}
        </span>
        {a.detail && <span className="text-gray-400 ml-1.5">{a.detail}</span>}
        {a.fait !== undefined && a.total !== undefined && a.total > 0 && (
          <span className="text-gray-400 ml-1.5">{a.fait}/{a.total}</span>
        )}
      </div>
      <span className={`shrink-0 tabular-nums ${a.erreur ? 'text-red-500' : 'text-gray-400'}`}>
        {enCours ? depuis(new Date(a.demarreA).toISOString()) : dureeLisible(a.dureeMs)}
      </span>
    </div>
  );
}

export function MoniteurActivite({ isAdmin = false }: { isAdmin?: boolean }) {
  const [open, setOpen] = useState(false);
  const [, setTic] = useState(0);
  const [serveur, setServeur] = useState<ServeurInfo | null>(null);
  const [attache, setAttache] = useState<AttacheInfo | null>(null);
  const [serveurErreur, setServeurErreur] = useState(false);

  // Rafraîchissement local : sur changement d'activité + un battement d'une
  // seconde pour les durées « en cours ». Fenêtre ouverte uniquement.
  useEffect(() => {
    if (!open) return;
    const off = surChangement(() => setTic(t => t + 1));
    const timer = setInterval(() => setTic(t => t + 1), 1000);
    return () => { off(); clearInterval(timer); };
  }, [open]);

  const interroger = useCallback(async () => {
    try {
      const res = await fetch('/api/monitor', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) { setServeurErreur(true); return; }
      const data = await res.json();
      setServeur(data.serveur || null);
      setAttache(data.attache || null);
      setServeurErreur(false);
    } catch {
      setServeurErreur(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void interroger();
    const timer = setInterval(() => { void interroger(); }, 5000);
    return () => clearInterval(timer);
  }, [open, interroger]);

  const enCours = activitesEnCours();
  const historique = activitesHistorique();
  const lag = longTasksInfo();
  const memJs = memoireJs();
  const cachePieces = getDocTextCacheStats();

  const chargeNavigateur = niveauLag(lag.msBloquesDerniereMinute);
  const attacheOccupe = Boolean(attache && (attache.activites.some(a => a.enCours) || attache.runsEnCours > 0));

  return (
    <>
      <TooltipProvider>
        <TooltipRoot>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="relative h-8 w-8 p-0 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              onClick={() => setOpen(true)}
            >
              <Activity className="h-4 w-4" />
              {(enCours.length > 0 || chargeNavigateur !== 'ok') && (
                <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${chargeNavigateur === 'ok' ? 'bg-blue-500' : chargeNavigateur === 'charge' ? 'bg-amber-500' : 'bg-red-500'} animate-pulse`} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Moniteur d&apos;activité — processus en cours et charge</p>
          </TooltipContent>
        </TooltipRoot>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-emerald-700" />
              Moniteur d&apos;activité
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            {/* ── NAVIGATEUR ── */}
            <section>
              <h3 className="flex items-center gap-2 font-semibold text-gray-800 mb-2">
                <Globe className="h-4 w-4 text-gray-500" /> Cet onglet
                <Sante niveau={chargeNavigateur} />
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                <div className="rounded-lg bg-gray-50 p-2">
                  <div className="text-[11px] text-gray-500">Interface bloquée (1 min)</div>
                  <div className="font-medium tabular-nums">
                    {dureeLisible(lag.msBloquesDerniereMinute)}
                    <span className="text-gray-400 font-normal"> · {lag.derniereMinute} blocage{lag.derniereMinute > 1 ? 's' : ''}</span>
                  </div>
                </div>
                {memJs && (
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Mémoire JS</div>
                    <div className="font-medium tabular-nums">{memJs.usedMB} Mo <span className="text-gray-400 font-normal">/ {memJs.limitMB} Mo</span></div>
                  </div>
                )}
                <div className="rounded-lg bg-gray-50 p-2">
                  <div className="text-[11px] text-gray-500">Textes de pièces en mémoire</div>
                  <div className="font-medium tabular-nums">{cachePieces.textes} <span className="text-gray-400 font-normal">· {(cachePieces.caracteres / 500_000).toFixed(1)} Mo</span></div>
                </div>
              </div>
              {enCours.length > 0 ? (
                <div className="divide-y divide-gray-100">
                  {enCours.map(a => <LigneActivite key={a.id} a={a} />)}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Aucun travail de fond en cours dans cet onglet.</p>
              )}
              {historique.length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-400 cursor-pointer select-none">Derniers travaux ({historique.length})</summary>
                  <div className="divide-y divide-gray-100 mt-1">
                    {historique.slice(0, 12).map(a => <LigneActivite key={a.id} a={a} />)}
                  </div>
                </details>
              )}
            </section>

            {/* ── SERVEUR ── */}
            <section>
              <h3 className="flex items-center gap-2 font-semibold text-gray-800 mb-2">
                <Server className="h-4 w-4 text-gray-500" /> Serveur SIRAL
                {serveur && <Sante niveau={niveauEventLoop(serveur.eventLoop.p99Ms)} />}
              </h3>
              {serveur ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Réactivité (retard p99)</div>
                    <div className="font-medium tabular-nums">{serveur.eventLoop.p99Ms} ms <span className="text-gray-400 font-normal">· pic {serveur.eventLoop.maxMs} ms</span></div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Mémoire</div>
                    <div className="font-medium tabular-nums">{serveur.memoire.rssMB} Mo</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <div className="text-[11px] text-gray-500">Démarré</div>
                    <div className="font-medium">{new Date(serveur.demarreA).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400">{serveurErreur ? 'Serveur injoignable ou occupé — nouvel essai dans 5 s.' : 'Interrogation…'}</p>
              )}
            </section>

            {/* ── ATTACHÉ (admin) ── */}
            {isAdmin && (
              <section>
                <h3 className="flex items-center gap-2 font-semibold text-gray-800 mb-2">
                  <Cpu className="h-4 w-4 text-gray-500" /> Attaché de justice (travail de fond)
                  {attache && <Sante niveau={attacheOccupe ? 'charge' : niveauEventLoop(attache.eventLoop.p99Ms)} />}
                </h3>
                {attache ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Réactivité (retard p99)</div>
                        <div className="font-medium tabular-nums">{attache.eventLoop.p99Ms} ms <span className="text-gray-400 font-normal">· pic {attache.eventLoop.maxMs} ms</span></div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Mémoire</div>
                        <div className="font-medium tabular-nums">{attache.memoire.rssMB} Mo</div>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <div className="text-[11px] text-gray-500">Runs IA en cours</div>
                        <div className="font-medium tabular-nums">{attache.runsEnCours}{attache.chantierActif ? ' · chantier actif' : ''}</div>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {attache.activites
                        .slice()
                        .sort((a, b) => Number(Boolean(b.enCours)) - Number(Boolean(a.enCours)))
                        .map(a => (
                          <div key={a.nom} className="flex items-start justify-between gap-2 py-1 text-xs">
                            <div className="min-w-0">
                              <span className="text-gray-700">
                                {a.enCours && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse mr-1.5 align-middle" />}
                                {a.libelle || a.nom}
                              </span>
                              {a.erreur && <span className="text-red-500 ml-1.5">{a.erreur}</span>}
                              {a.nom === 'ingestion' && a.dernierBilan && (
                                <span className="text-gray-400 ml-1.5">
                                  {a.dernierBilan.empreintes} empreinte{a.dernierBilan.empreintes > 1 ? 's' : ''},{' '}
                                  {a.dernierBilan.extraites} texte{a.dernierBilan.extraites > 1 ? 's' : ''}
                                  {a.dernierBilan.enAttente ? `, ${a.dernierBilan.enAttente} à suivre` : ''}
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 tabular-nums text-gray-400">
                              {a.enCours ? depuis(a.debutAt) : (a.dureeMs !== undefined ? dureeLisible(a.dureeMs) : '—')}
                            </span>
                          </div>
                        ))}
                      {attache.activites.length === 0 && (
                        <p className="text-xs text-gray-400">Aucun travail suivi depuis le démarrage du service.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" /> Service attaché non configuré, éteint, ou occupé.
                  </p>
                )}
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
