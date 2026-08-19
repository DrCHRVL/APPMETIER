'use client';

/**
 * SIRAL — Chantiers d'analyse profonde (page Assistant de justice).
 *
 * Le poste de pilotage des dépouillements massifs : lancer (avec DEVIS à
 * valider — rien ne part sans), suivre (progression pochette par pochette,
 * état nuit/forfait, pause/reprise), exploiter (fiches et synthèse, rangées
 * dans les productions du dossier et consultables ici même).
 *
 * Visible du SEUL administrateur (se masque si /api/attache/chantiers ≠ 200).
 * Le moteur tourne côté service attaché : fermer cette page ne change rien.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Layers, Plus, Loader2, ChevronDown, ChevronUp, Play, Pause as PauseIcon,
  Trash2, Moon, BatteryLow, CheckCircle2, FileText, X,
} from 'lucide-react';
import { useToastStore } from '@/stores/useToastStore';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { ProductionsSection } from './ProductionsSection';

interface PochetteResume { nom: string; pieces: number; lots: number; faits: number; echecs: number }
interface Chantier {
  id: string; type: string; numero: string; consigne?: string;
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

const POLL_MS = 60_000;

function etatBadge(ch: Chantier): { label: string; cls: string; Icon?: typeof Moon } {
  if (ch.etat === 'devis') return { label: 'Devis à valider', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (ch.etat === 'pause') return { label: 'En pause', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  if (ch.etat === 'termine') return { label: 'Terminé', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 };
  if (ch.etat === 'synthese') return { label: 'Synthèse en cours', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  if (ch.attente === 'nuit') return { label: 'Reprend cette nuit', cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: Moon };
  if (ch.attente === 'forfait') return { label: 'Forfait plein — reprise auto', cls: 'bg-orange-50 text-orange-600 border-orange-200', Icon: BatteryLow };
  return { label: 'En cours', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
}

const fmtJetons = (n: number) => (n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace('.', ',') + ' M' : Math.round(n / 1000) + ' k');

export function ChantiersSection() {
  const [available, setAvailable] = useState(false);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // formulaire de lancement
  const [showForm, setShowForm] = useState(false);
  const [numero, setNumero] = useState('');
  const [consigne, setConsigne] = useState('');
  const [nuitSeulement, setNuitSeulement] = useState(true);
  const [creating, setCreating] = useState(false);
  const showToast = useToastStore((s) => s.showToast);
  const enquetes = useEnquetesStore((s) => s.enquetes);
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

  const creer = useCallback(async () => {
    if (!numero.trim()) { showToast('Indiquez le dossier à dépouiller', 'warning'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/attache/chantiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: numero.trim(), consigne: consigne.trim(), nuitSeulement }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; id?: string }));
      if (!res.ok || data.error) {
        showToast(`Création impossible : ${data.error || 'service injoignable'}`, 'error');
        return;
      }
      showToast('Devis établi — validez-le pour lancer le dépouillement', 'success');
      setShowForm(false); setNumero(''); setConsigne('');
      setExpanded(String(data.id || ''));
      await load();
    } finally {
      setCreating(false);
    }
  }, [numero, consigne, nuitSeulement, showToast, load]);

  const action = useCallback(async (ch: Chantier, act: 'lancer' | 'pause' | 'supprimer') => {
    if (act === 'supprimer' && !window.confirm(
      ch.fiches.length
        ? `Supprimer ce chantier ? Les ${ch.fiches.length} fiche(s) déjà produites RESTENT dans « Actes rédigés » du dossier.`
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

  if (!available) return null;

  const enCours = chantiers.filter((c) => ['en_cours', 'synthese'].includes(c.etat)).length;

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white shadow-sm">
      {/* En-tête */}
      <div className="flex w-full items-center gap-2 px-4 py-2.5">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Layers className="h-4 w-4 text-[#2B5746]" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">
            Chantiers d&apos;analyse profonde
            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">vous seul</span>
            {enCours > 0 && (
              <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">{enCours} en cours</span>
            )}
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>
        <button
          onClick={() => { setOpen(true); setShowForm((v) => !v); }}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#234737]"
        >
          <Plus className="h-3.5 w-3.5" />Lancer une analyse profonde
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3">
          {/* Formulaire de lancement → DEVIS */}
          {showForm && (
            <div className="space-y-2 rounded-lg border border-[#2B5746]/20 bg-emerald-50/30 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">Nouveau chantier — dossier en détail</p>
                <button onClick={() => setShowForm(false)} className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><X className="h-3.5 w-3.5" /></button>
              </div>
              <input
                list="chantier-dossiers"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="Numéro du dossier (ex. 00387/00068/2026 - PRISON BREAK 2)"
                className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-[#2B5746] focus:outline-none"
              />
              <datalist id="chantier-dossiers">
                {enquetes.map((e) => <option key={e.id} value={String(e.numero)} />)}
              </datalist>
              <textarea
                value={consigne}
                onChange={(e) => setConsigne(e.target.value)}
                placeholder="Angle d'analyse (facultatif) — ex. « concentre-toi sur les rôles dans la livraison du 12/03, période janvier-mars »"
                rows={2}
                className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-[#2B5746] focus:outline-none"
              />
              <label className="flex items-center gap-2 text-[11px] text-gray-600">
                <input type="checkbox" checked={nuitSeulement} onChange={(e) => setNuitSeulement(e.target.checked)} className="h-3.5 w-3.5 accent-[#2B5746]" />
                Travailler uniquement la nuit (préserve le forfait de la journée)
              </label>
              <div className="flex justify-end">
                <button
                  onClick={creer}
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#234737] disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Établir le devis
                </button>
              </div>
              <p className="text-[10.5px] text-gray-400">
                Le devis (pochettes, pièces, estimation) s&apos;affiche AVANT tout dépouillement — rien ne se lance sans votre validation.
              </p>
            </div>
          )}

          {chantiers.length === 0 && !showForm && (
            <p className="py-3 text-center text-xs text-gray-400">
              Aucun chantier. Un chantier dépouille un dossier entier en fiches factuelles (la nuit, par lots, interruptible),
              puis en tire une synthèse — le tout reste exploitable indéfiniment.
            </p>
          )}

          {/* Cartes de chantiers */}
          {chantiers.map((ch) => {
            const badge = etatBadge(ch);
            const pct = ch.totalPieces ? Math.round((ch.piecesFaites / ch.totalPieces) * 100) : 0;
            const isExpanded = expanded === ch.id;
            return (
              <div key={ch.id} className="rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button onClick={() => setExpanded(isExpanded ? null : ch.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                      {badge.Icon && <badge.Icon className="h-3 w-3" />}{badge.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-800" title={ch.numero}>{ch.numero}</span>
                    <span className="flex-shrink-0 text-[10.5px] text-gray-400">
                      {ch.etat === 'devis'
                        ? `${ch.totalPieces} pièces · ${ch.totalLots} lots`
                        : `${ch.piecesFaites}/${ch.totalPieces} pièces · ${ch.lotsFaits}/${ch.totalLots} lots`}
                    </span>
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                  </button>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {ch.etat === 'devis' && (
                      <button onClick={() => action(ch, 'lancer')} disabled={busy === ch.id}
                        className="inline-flex items-center gap-1 rounded-md bg-[#2B5746] px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-[#234737] disabled:opacity-50">
                        <Play className="h-3 w-3" />Lancer
                      </button>
                    )}
                    {['en_cours', 'synthese'].includes(ch.etat) && (
                      <button onClick={() => action(ch, 'pause')} disabled={busy === ch.id}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[10.5px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        <PauseIcon className="h-3 w-3" />Pause
                      </button>
                    )}
                    {ch.etat === 'pause' && (
                      <button onClick={() => action(ch, 'lancer')} disabled={busy === ch.id}
                        className="inline-flex items-center gap-1 rounded-md bg-[#2B5746] px-2 py-1 text-[10.5px] font-semibold text-white hover:bg-[#234737] disabled:opacity-50">
                        <Play className="h-3 w-3" />Reprendre
                      </button>
                    )}
                    <button onClick={() => action(ch, 'supprimer')} disabled={busy === ch.id}
                      className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-50" title="Supprimer le chantier (les fiches produites restent dans le dossier)">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Barre de progression */}
                {ch.etat !== 'devis' && (
                  <div className="px-3 pb-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full rounded-full transition-all ${ch.etat === 'termine' ? 'bg-emerald-500' : 'bg-[#2B5746]'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="space-y-3 border-t border-gray-100 px-3 py-2.5">
                    {ch.consigne && (
                      <p className="text-[11px] text-gray-600"><span className="font-semibold">Angle :</span> {ch.consigne}</p>
                    )}

                    {/* DEVIS */}
                    {ch.etat === 'devis' && ch.estimation && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-[11px] text-gray-700">
                        <p className="font-semibold text-amber-800">Devis — à valider avant tout dépouillement</p>
                        <p className="mt-1">
                          {ch.estimation.pieces} pièces · {ch.estimation.lots} lots (~12 pièces/lot) ·
                          jetons ≈ {fmtJetons(ch.estimation.jetonsMin)}–{fmtJetons(ch.estimation.jetonsMax)} ·
                          ≈ {ch.estimation.nuits} nuit(s) de travail{ch.nuitSeulement ? '' : ' (jour autorisé)'}
                        </p>
                        <p className="mt-0.5 text-[10px] text-amber-700/80">Estimation grossière — le journal du chantier donne le réel au fil de l&apos;eau. Chaque pièce n&apos;est lue qu&apos;une fois : les fiches restent exploitables indéfiniment.</p>
                      </div>
                    )}

                    {/* Pochettes */}
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-gray-700">Pochettes ({ch.pochettes.length})</p>
                      <div className="max-h-44 space-y-0.5 overflow-y-auto">
                        {ch.pochettes.map((p) => (
                          <div key={p.nom} className="flex items-center gap-2 text-[11px]">
                            <span className="min-w-0 flex-1 truncate text-gray-600" title={p.nom}>{p.nom}</span>
                            <span className="flex-shrink-0 tabular-nums text-gray-400">
                              {ch.etat === 'devis' ? `${p.pieces} pièces` : `${p.faits}/${p.lots} lots`}
                              {p.echecs > 0 && <span className="ml-1 text-red-500">· {p.echecs} échec(s)</span>}
                            </span>
                            {ch.etat !== 'devis' && p.faits >= p.lots && p.echecs === 0 && <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-500" />}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Journal */}
                    {(ch.journal || []).length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-[11px] font-semibold text-gray-500">Journal</summary>
                        <ul className="mt-1 space-y-0.5 text-[10.5px] text-gray-500">
                          {(ch.journal || []).slice().reverse().map((j, i) => (
                            <li key={i}><span className="text-gray-400">{new Date(j.date).toLocaleString('fr-FR')}</span> — {j.evenement}</li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {/* Fiches + synthèse — les productions du chantier, lisibles ici même */}
                    {ch.fiches.length > 0 && (
                      <div>
                        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-gray-700">
                          <FileText className="h-3 w-3" />Fiches et synthèse ({ch.fiches.length}{ch.syntheseProdId ? ' + synthèse' : ''})
                        </p>
                        <ProductionsSection numero={ch.numero} titre="Fiches et synthèse du chantier" filtreSource={`chantier:${ch.id}`} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <p className="text-center text-[10px] text-gray-400">
            Le moteur tourne côté serveur : fermez la page, il continue (la nuit par défaut, dans les limites du forfait).
            Les fiches et la synthèse sont aussi dans « Actes rédigés » du dossier — l&apos;attaché du dossier s&apos;appuie dessus.
          </p>
        </div>
      )}
    </div>
  );
}
