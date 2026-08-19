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

export interface Chantier {
  id: string; type: string; numero: string; consigne?: string;
  numeros?: string[] | null; sansFiches?: string[];
  etat: 'devis' | 'en_cours' | 'pause' | 'synthese' | 'termine';
  attente?: 'nuit' | 'forfait' | null;
  nuitSeulement?: boolean;
  creeLe: string; majLe?: string;
  totalPieces: number; totalLots: number; lotsFaits: number; piecesFaites: number;
  pochettes: PochetteResume[];
  fiches: Array<{ prodId: string; titre: string; pochette: string }>;
  syntheseProdId?: string | null;
  estimation?: { pieces: number; lots: number; jetonsMin: number; jetonsMax: number; nuits: number };
  journal?: Array<{ date: string; evenement: string }>;
}

export type TypeChantier = 'dossier' | 'liens' | 'carto';
export type ActionChantier = 'lancer' | 'pause' | 'supprimer';

const POLL_MS = 60_000;

/** Libellé, couleur et icône d'état — une seule table pour toutes les vues. */
export function etatBadge(ch: Chantier): { label: string; cls: string; icone?: 'nuit' | 'forfait' | 'fini' } {
  if (ch.etat === 'devis') return { label: 'Devis à valider', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (ch.etat === 'pause') return { label: 'En pause', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  if (ch.etat === 'termine') return { label: 'Terminé', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icone: 'fini' };
  if (ch.etat === 'synthese') return { label: 'Synthèse en cours', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  if (ch.attente === 'nuit') return { label: 'Reprend cette nuit', cls: 'bg-slate-50 text-slate-600 border-slate-200', icone: 'nuit' };
  if (ch.attente === 'forfait') return { label: 'Forfait plein — reprise auto', cls: 'bg-orange-50 text-orange-600 border-orange-200', icone: 'forfait' };
  return { label: 'En cours', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
}

export const TYPE_LABEL: Record<string, string> = { dossier: 'Dossier en détail', liens: 'Liens entre dossiers', carto: 'Cartographie' };

/** L'unité de compte : le chantier « dossier » avance en pièces, les autres en fiches. */
export const uniteChantier = (ch: Chantier) => (ch.type === 'dossier' ? 'pièces' : 'fiches');

export const titreChantier = (ch: Chantier) => (ch.numeros?.length ? ch.numeros.join('  ×  ') : ch.numero);

export const pourcentage = (ch: Chantier) => (ch.totalPieces ? Math.round((ch.piecesFaites / ch.totalPieces) * 100) : 0);

export const echecsChantier = (ch: Chantier) => ch.pochettes.reduce((n, p) => n + p.echecs, 0);

export const fmtJetons = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace('.', ',') + ' M' : Math.round(n / 1000) + ' k');

export function useChantiers() {
  const [available, setAvailable] = useState(false);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
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
      const data = (await res.json().catch(() => ({}))) as { chantiers?: Chantier[] };
      setChantiers(data.chantiers || []);
    } catch {
      setAvailable(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  /** Crée le chantier (état « devis ») — rien ne se lance sans validation. */
  const creer = useCallback(async (params: {
    type: TypeChantier; numero: string; numeros: string[]; consigne: string; nuitSeulement: boolean;
  }): Promise<string | null> => {
    const multi = params.type !== 'dossier';
    const tape = params.numero.trim();
    const liste = multi ? [...params.numeros, ...(tape && !params.numeros.includes(tape) ? [tape] : [])] : [];
    if (!multi && !tape) { showToast('Indiquez le dossier à dépouiller', 'warning'); return null; }
    if (params.type === 'liens' && liste.length < 2) { showToast('Un chantier « liens » croise au moins deux dossiers', 'warning'); return null; }
    if (params.type === 'carto' && liste.length < 1) { showToast('Indiquez au moins un dossier', 'warning'); return null; }
    setCreating(true);
    try {
      const res = await fetch('/api/attache/chantiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(multi
          ? { type: params.type, numeros: liste, consigne: params.consigne.trim(), nuitSeulement: params.nuitSeulement }
          : { numero: tape, consigne: params.consigne.trim(), nuitSeulement: params.nuitSeulement }),
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
      await load();
    } finally {
      setBusy(null);
    }
  }, [showToast, load]);

  return { available, chantiers, busy, creating, load, creer, action };
}
