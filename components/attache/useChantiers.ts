'use client';

/**
 * SIRAL — Chantiers d'analyse profonde · état partagé.
 *
 * Le même flux alimente les deux vues : la bande compacte de la page
 * Assistant de justice (ChantiersSection) et l'atelier plein écran
 * (ChantiersAtelier). Une seule source, un seul sondage, aucune divergence
 * d'affichage entre les deux.
 *
 * Admin uniquement de fait : /api/attache/chantiers refuse tout autre compte
 * — la vue se masque et cesse de sonder.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToastStore } from '@/stores/useToastStore';

export interface PochetteResume { nom: string; pieces: number; lots: number; faits: number; echecs: number }

/** Le pas qui tourne EN CE MOMENT côté service (marqueur posé avant le run, retiré après). */
export interface PasEnCours {
  etape: 'lot' | 'synthese';
  pochette?: string;
  lot?: number;
  pieces?: number;
  /** Numéro de tentative sur ce lot (2 ou 3 = le lot a déjà échoué). */
  tentative?: number;
  fiches?: number;
  depuis: string;
}

export interface Chantier {
  id: string; type: string; numero: string; consigne?: string;
  numeros?: string[] | null; sansFiches?: string[];
  etat: 'devis' | 'en_cours' | 'pause' | 'synthese' | 'termine';
  attente?: 'nuit' | 'forfait' | null;
  /** Le motif exact de l'attente (« fenêtre de 5 h à 104 % », « reprise vers 22 h »). */
  attenteDetail?: string | null;
  attenteDepuis?: string | null;
  /** Dérogation « Forcer maintenant » en cours : nuit et plafonds levés jusqu'à cette date. */
  forceJusqu?: string | null;
  nuitSeulement?: boolean;
  /** « attache » : devis déposé par l'assistant depuis une conversation (il attend votre validation). */
  origine?: 'magistrat' | 'attache';
  creeLe: string; majLe?: string;
  totalPieces: number; totalLots: number; lotsFaits: number; piecesFaites: number;
  /** Pièces déposées vs pièces à lire (copies exactes écartées au devis). */
  piecesDeposees?: number;
  doublonsExclus?: number;
  pochettes: PochetteResume[];
  fiches: Array<{ prodId: string; titre: string; pochette: string }>;
  syntheseProdId?: string | null;
  /** Tous les lots menés de front en ce moment (`enCours` = le premier, pour les vues compactes). */
  pas?: PasEnCours[];
  enCours?: PasEnCours | null;
  /** Nombre de lots que le moteur mène de front. */
  front?: number;
  estimation?: {
    pieces: number; lots: number; jetonsMin: number; jetonsMax: number; heures?: number; nuits: number;
    doublonsExclus?: number; dejaCouvertes?: number;
  };
  /** Le RÉEL à côté du devis : jetons consommés par ce chantier. */
  jetons?: { in: number; out: number; cacheW: number; cacheR: number; total: number } | null;
  /** Plafond de jetons posé au devis (le chantier se met en pause une fois atteint). */
  budgetJetons?: number | null;
  /** Minutes par lot OBSERVÉES — l'estimation de temps restant s'appuie dessus. */
  rythmeMinParLot?: number | null;
  /** Modèle des runs de fiches : celui des sous-agents (défaut) ou le principal. */
  modeleFiches?: 'sous-agent' | 'principal';
  journal?: Array<{ date: string; evenement: string }>;
}

/** Le détail à la demande (jamais dans le sondage) : journal complet, lots. */
export interface ChantierDetail {
  id: string;
  journal: Array<{ date: string; evenement: string }>;
  pochettes: Array<{
    nom: string;
    lots: Array<{ n: number; etat: string; pieces: number; echecs: number }>;
    fiches: Array<{ prodId: string; titre: string }>;
  }>;
}

/** Charge le détail d'un chantier (null si le service ne répond pas). */
export async function chargerDetailChantier(id: string): Promise<ChantierDetail | null> {
  try {
    const res = await fetch('/api/attache/chantiers/detail?id=' + encodeURIComponent(id));
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as ChantierDetail | null;
    return data && Array.isArray(data.pochettes) ? data : null;
  } catch {
    return null;
  }
}

export type TypeChantier = 'dossier' | 'liens' | 'carto' | 'histoire';
export type ActionChantier = 'lancer' | 'pause' | 'supprimer' | 'forcer' | 'relancer_echecs' | 'relancer_synthese';

/** L'état du feu, servi par le service : ce qui bloque, et quand ça repart. */
export interface FeuChantiers {
  nuit: boolean;
  prochaineNuit?: { heure: number; dansHeures: number; fuseau: string } | null;
  fuseau?: string;
  fenetreNuit?: { debut: number; fin: number } | null;
  pct5h?: number; pct7d?: number; cap5h?: number; capHebdo?: number;
  /** Le seul plafond qui arrête encore un chantier (le repère hebdomadaire ne fait que resserrer). */
  bloquant?: '5h' | null;
  resserre?: boolean;
}

const POLL_MS = 60_000;
// Quand un chantier tourne, on sonde plus vite : le magistrat doit voir le pas
// courant avancer, pas un compteur figé une minute durant.
const POLL_ACTIF_MS = 20_000;

/** Libellé, couleur et icône d'état — une seule table pour toutes les vues. */
export function etatBadge(ch: Chantier): { label: string; cls: string; icone?: 'nuit' | 'forfait' | 'fini' } {
  if (ch.etat === 'devis') return { label: 'Devis à valider', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (ch.etat === 'pause') return { label: 'En pause', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  if (ch.etat === 'termine') return { label: 'Terminé', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icone: 'fini' };
  if (ch.etat === 'synthese') return { label: 'Synthèse en cours', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  if (ch.forceJusqu) return { label: 'Forcé — en cours', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (ch.attente === 'nuit') return { label: 'Reprend cette nuit', cls: 'bg-slate-50 text-slate-600 border-slate-200', icone: 'nuit' };
  if (ch.attente === 'forfait') return { label: 'Forfait plein — reprise auto', cls: 'bg-orange-50 text-orange-600 border-orange-200', icone: 'forfait' };
  return { label: 'En cours', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
}

export const TYPE_LABEL: Record<string, string> = { dossier: 'Dossier en détail', liens: 'Liens entre dossiers', carto: 'Cartographie', histoire: 'Histoire d\'un clan' };

/** L'unité de compte : le chantier « dossier » avance en pièces, les autres en fiches. */
export const uniteChantier = (ch: Chantier) => (ch.type === 'dossier' ? 'pièces' : 'fiches');

export const titreChantier = (ch: Chantier) => (ch.numeros?.length ? ch.numeros.join('  ×  ') : ch.numero);

export const pourcentage = (ch: Chantier) => (ch.totalPieces ? Math.round((ch.piecesFaites / ch.totalPieces) * 100) : 0);

export const echecsChantier = (ch: Chantier) => ch.pochettes.reduce((n, p) => n + p.echecs, 0);

/** « 6 min », « 1 h 12 » — depuis quand le pas courant tourne. */
export function dureeDepuis(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Les lots menés de front à cet instant (vide si le chantier ne tourne pas). */
export const pasEnVol = (ch: Chantier): PasEnCours[] => ch.pas || (ch.enCours ? [ch.enCours] : []);

/** Ce que fait l'attaché en ce moment, dit en clair. */
export function libelleEnCours(ch: Chantier, pas?: PasEnCours): string | null {
  const p = pas || ch.enCours;
  if (!p) return null;
  if (p.etape === 'synthese') {
    const quoi = ch.type === 'liens' ? 'Rapport de recoupements' : ch.type === 'carto' ? 'Note de bilan' : ch.type === 'histoire' ? 'Récit' : 'Note de synthèse';
    return `${quoi} en cours de rédaction${p.fiches ? ` — ${p.fiches} ${ch.type === 'dossier' ? 'fiches' : 'lots'} en main` : ''}`;
  }
  const conteneur = ch.type === 'dossier' ? 'pochette' : 'dossier';
  const matiere = ch.type === 'dossier' ? 'pièces' : 'fiches';
  return [
    `Lot ${p.lot}`,
    p.pochette ? `${conteneur} « ${p.pochette} »` : '',
    p.pieces ? `${p.pieces} ${matiere}` : '',
    (p.tentative || 1) > 1 ? `tentative ${p.tentative}` : '',
  ].filter(Boolean).join(' · ');
}

export const fmtJetons = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace('.', ',') + ' M' : Math.round(n / 1000) + ' k');

export function useChantiers() {
  const [available, setAvailable] = useState(false);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [feu, setFeu] = useState<FeuChantiers | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const showToast = useToastStore((s) => s.showToast);
  const unavailableRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent && (unavailableRef.current || document.hidden)) return;
    try {
      const res = await fetch('/api/attache/chantiers');
      if (!res.ok) { unavailableRef.current = true; setAvailable(false); return; }
      unavailableRef.current = false;
      setAvailable(true);
      const data = (await res.json().catch(() => ({}))) as { chantiers?: Chantier[]; feu?: FeuChantiers };
      setChantiers(data.chantiers || []);
      setFeu(data.feu || null);
    } catch {
      setAvailable(false);
    }
  }, []);

  const actif = chantiers.some((c) => ['en_cours', 'synthese'].includes(c.etat));

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), actif ? POLL_ACTIF_MS : POLL_MS);
    return () => clearInterval(t);
  }, [load, actif]);

  // Horloge locale : le « depuis 6 min » avance sans attendre le prochain sondage.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [actif]);

  /**
   * Crée le chantier (état « devis ») — rien ne se lance sans validation.
   * Rend l'id du chantier créé, '' pour une création en masse acceptée
   * (les devis se créent en arrière-plan), null si rien n'a été créé.
   */
  const creer = useCallback(async (params: {
    type: TypeChantier; numero: string; numeros: string[]; consigne: string; nuitSeulement: boolean;
    cibleArchives?: boolean; relire?: boolean; modelePrincipal?: boolean; budgetJetons?: number;
    /** Type « histoire » : le sujet du récit (camp de la carte ou personne). */
    sujet?: string;
  }): Promise<string | null> => {
    const options = {
      ...(params.relire ? { relire: true } : {}),
      ...(params.modelePrincipal ? { modeleFiches: 'principal' } : {}),
      ...(params.budgetJetons && params.budgetJetons > 0 ? { budgetJetons: Math.floor(params.budgetJetons) } : {}),
    };
    // « Tous les dossiers archivés » : un chantier par dossier, chacun avec
    // son devis — le service répond tout de suite et crée en arrière-plan.
    if (params.type === 'dossier' && params.cibleArchives) {
      setCreating(true);
      try {
        const res = await fetch('/api/attache/chantiers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'dossier', portee: 'archives', consigne: params.consigne.trim(), nuitSeulement: params.nuitSeulement, ...options }),
        });
        const data = await res.json().catch(() => ({} as { error?: string; lances?: number; dejaEnChantier?: string[]; sansPieces?: string[]; note?: string }));
        if (!res.ok || data.error) {
          showToast(`Création impossible : ${data.error || 'service injoignable'}`, 'error');
          return null;
        }
        const ecartes = (data.dejaEnChantier?.length || 0) + (data.sansPieces?.length || 0);
        if (!data.lances) {
          showToast(data.note || 'Rien à créer : tous les dossiers archivés sont déjà en chantier ou sans pièces', 'warning');
          return null;
        }
        showToast(
          `${data.lances} devis en préparation — ils apparaissent au fil de l'eau, chacun à valider`
          + (ecartes ? ` · ${ecartes} dossier(s) écarté(s) (déjà en chantier ou sans pièces)` : ''),
          'success',
        );
        await load();
        return '';
      } finally {
        setCreating(false);
      }
    }
    const multi = params.type !== 'dossier';
    const tape = params.numero.trim();
    const liste = multi ? [...params.numeros, ...(tape && !params.numeros.includes(tape) ? [tape] : [])] : [];
    if (!multi && !tape) { showToast('Indiquez le dossier à dépouiller', 'warning'); return null; }
    if (params.type === 'liens' && liste.length < 2) { showToast('Un chantier « liens » croise au moins deux dossiers', 'warning'); return null; }
    if (params.type === 'carto' && liste.length < 1) { showToast('Indiquez au moins un dossier', 'warning'); return null; }
    if (params.type === 'histoire' && !(params.sujet || '').trim()) { showToast('Indiquez le sujet du récit (camp de la carte, ou personne)', 'warning'); return null; }
    setCreating(true);
    try {
      const res = await fetch('/api/attache/chantiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(multi
          ? {
              type: params.type, numeros: liste, consigne: params.consigne.trim(), nuitSeulement: params.nuitSeulement,
              ...(params.type === 'histoire' ? { sujet: (params.sujet || '').trim() } : {}),
              ...options,
            }
          : { numero: tape, consigne: params.consigne.trim(), nuitSeulement: params.nuitSeulement, ...options }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; id?: string }));
      if (!res.ok || data.error) {
        showToast(`Création impossible : ${data.error || 'service injoignable'}`, 'error');
        return null;
      }
      showToast('Devis établi — validez-le pour lancer le chantier', 'success');
      await load();
      return String(data.id || '') || null;
    } finally {
      setCreating(false);
    }
  }, [showToast, load]);

  const action = useCallback(async (ch: Chantier, act: ActionChantier) => {
    if (act === 'forcer' && !window.confirm(
      'Forcer le dépouillement maintenant ?\n\n'
      + 'La fenêtre de nuit et les plafonds de forfait sont levés pendant 2 h : '
      + 'les lots partent tout de suite, en pleine journée s\'il le faut. '
      + 'Le régime normal reprend ensuite tout seul.'
    )) return;
    if (act === 'supprimer' && !window.confirm(
      ch.fiches.length
        ? `Supprimer ce chantier ? Les ${ch.fiches.length} production(s) déjà rangées RESTENT dans « Actes rédigés » du dossier.`
        : 'Supprimer ce chantier ?'
    )) return;
    setBusy(ch.id);
    try {
      const res = await fetch('/api/attache/chantiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ch.id, action: act }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok || data.error) showToast(`Action impossible : ${data.error || 'service injoignable'}`, 'error');
      else if (act === 'lancer') showToast(ch.etat === 'devis' ? 'Chantier lancé — le dépouillement commence dès que le feu est vert' : 'Chantier relancé', 'success');
      else if (act === 'forcer') showToast('Forcé — les premiers lots partent dans quelques secondes', 'success');
      else if (act === 'relancer_echecs') showToast('Lots en échec relancés — tentatives remises à zéro', 'success');
      else if (act === 'relancer_synthese') showToast('Synthèse relancée — elle repart des fiches déjà produites', 'success');
      await load();
    } finally {
      setBusy(null);
    }
  }, [showToast, load]);

  return { available, chantiers, feu, busy, creating, load, creer, action, now };
}
