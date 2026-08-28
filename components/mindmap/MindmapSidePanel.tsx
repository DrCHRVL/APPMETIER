// components/mindmap/MindmapSidePanel.tsx
// Panneau latéral détaillant un MEC : identité, score (replié par défaut),
// rôle hiérarchique, camp, notes/surnoms éditables, liens avec les autres
// personnes, dossiers cités.

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X, ChevronDown, ChevronRight, FileText, Loader2, Minus, Pencil, Plus, Star, Users,
  Link as LinkIcon, StickyNote, Sparkles, Flag, Crown,
} from 'lucide-react';
import type { ContentieuxDefinition } from '@/types/userTypes';
import type { MecRole } from '@/stores/useCartographieOverlayStore';
import { MEC_ROLE_POINTS, type DossierNode, type MecNode, type MindmapGraph } from '@/utils/mindmapGraph';
import { CAMP_COLOR_PRESETS } from './campColors';

interface MindmapSidePanelProps {
  mec: MecNode;
  graph: MindmapGraph;
  contentieuxDefs: ContentieuxDefinition[];
  /** Camps déjà posés sur la carte (pour proposer la réutilisation). */
  existingCamps?: Array<{ label: string; color: string; count: number }>;
  onClose: () => void;
  /** Click sur un dossier listé → focus sur ce dossier */
  onDossierClick?: (dossier: DossierNode) => void;
  /** Double click → ouverture du modal d'enquête */
  onDossierOpen?: (dossier: DossierNode) => void;
  /** Click sur une personne liée → focus + fiche de cette personne */
  onPersonClick?: (mec: MecNode) => void;
  /** Modifie le bonus de score manuel du MEC (peut être négatif). */
  onSetScoreBoost?: (mecId: string, bonus: number, reason?: string) => void;
  /** Coche/décoche le rôle hiérarchique (lieutenant / chef de réseau). */
  onSetRole?: (mecId: string, role: MecRole | undefined) => void;
  /** Assigne / retire le camp (réseau d'appartenance). */
  onSetCamp?: (mecId: string, label: string, color: string) => void;
  onRemoveCamp?: (mecId: string) => void;
  /** Renomme la personne PARTOUT où elle est enregistrée (dossiers compris).
   *  Absent = le nom n'est pas éditable depuis la carte. */
  onRename?: (mec: MecNode, nouveauNom: string) => void;
  /** Vrai pendant l'écriture du renommage : le formulaire attend. */
  renamePending?: boolean;
  /** Enregistre notes + surnoms de la fiche manuelle (créée au besoin). */
  onSaveFiche?: (mec: MecNode, data: { notes?: string; alias: string[] }) => void;
  /** Demande à l'attaché IA d'enrichir la fiche (action explicite, admin). */
  onEnrichRequest?: (mec: MecNode) => void;
  /** Supprime un lien de renseignement (croix rouge, avec confirmation). */
  onDeleteLien?: (lienId: string) => void;
}

const BOOST_MIN = -10;
const BOOST_MAX = 20;

export const MindmapSidePanel: React.FC<MindmapSidePanelProps> = ({
  mec,
  graph,
  contentieuxDefs,
  existingCamps = [],
  onClose,
  onDossierClick,
  onDossierOpen,
  onPersonClick,
  onSetScoreBoost,
  onSetRole,
  onSetCamp,
  onRemoveCamp,
  onRename,
  renamePending = false,
  onSaveFiche,
  onEnrichRequest,
  onDeleteLien,
}) => {
  const ctxColorById = new Map<string, { color: string; label: string }>(
    contentieuxDefs.map(d => [d.id, { color: d.color, label: d.label }]),
  );

  const dossiers = mec.dossierIds
    .map(id => graph.dossierById.get(id))
    .filter((d): d is DossierNode => Boolean(d))
    .sort((a, b) => b.dateCreation.localeCompare(a.dateCreation));

  // ── Score : replié par défaut pour laisser la place au reste ──
  const [scoreOpen, setScoreOpen] = useState(false);

  // Édition locale du boost : on n'écrit dans le store qu'au commit
  // (Enregistrer / clavier Entrée) pour éviter de relancer le layout à
  // chaque frappe.
  const [boostDraft, setBoostDraft] = useState(mec.manualBonus);
  const [reasonDraft, setReasonDraft] = useState(mec.manualBonusReason || '');
  useEffect(() => {
    setBoostDraft(mec.manualBonus);
    setReasonDraft(mec.manualBonusReason || '');
  }, [mec.id, mec.manualBonus, mec.manualBonusReason]);
  const boostDirty = boostDraft !== mec.manualBonus
    || (reasonDraft || '') !== (mec.manualBonusReason || '');

  const commitBoost = () => {
    if (!onSetScoreBoost) return;
    const clamped = Math.max(BOOST_MIN, Math.min(BOOST_MAX, Math.round(boostDraft)));
    onSetScoreBoost(mec.id, clamped, reasonDraft.trim() || undefined);
  };
  const resetBoost = () => {
    if (!onSetScoreBoost) return;
    onSetScoreBoost(mec.id, 0);
    setBoostDraft(0);
    setReasonDraft('');
  };

  // ── Rôle hiérarchique (cases exclusives, commit immédiat) ──
  const toggleRole = (role: MecRole) => {
    if (!onSetRole) return;
    onSetRole(mec.id, mec.role === role ? undefined : role);
  };

  // ── Notes & surnoms (fiche manuelle, éditée depuis le panneau) ──
  const [notesDraft, setNotesDraft] = useState(mec.manualNotes || '');
  const [aliasDraft, setAliasDraft] = useState<string[]>(mec.manualAlias || []);
  const [aliasInput, setAliasInput] = useState('');
  useEffect(() => {
    setNotesDraft(mec.manualNotes || '');
    setAliasDraft(mec.manualAlias || []);
    setAliasInput('');
  }, [mec.id, mec.manualNotes, mec.manualAlias]);
  const ficheDirty = (notesDraft || '') !== (mec.manualNotes || '')
    || JSON.stringify(aliasDraft) !== JSON.stringify(mec.manualAlias || []);
  const addAlias = () => {
    const v = aliasInput.trim();
    if (v && !aliasDraft.includes(v)) setAliasDraft(prev => [...prev, v]);
    setAliasInput('');
  };
  const commitFiche = () => {
    if (!onSaveFiche) return;
    onSaveFiche(mec, { notes: notesDraft.trim() || undefined, alias: aliasDraft });
  };

  // ── Nom (renommage propagé) ──
  // Le nom d'une personne n'est pas une donnée de la carte : il vient des
  // dossiers. L'éditer ici réécrit donc les dossiers eux-mêmes — d'où le
  // crayon discret plutôt qu'un champ toujours ouvert.
  const [nomFormOpen, setNomFormOpen] = useState(false);
  const [nomDraft, setNomDraft] = useState('');
  const openNomForm = () => {
    setNomDraft(mec.displayName);
    setNomFormOpen(true);
  };
  const submitNom = () => {
    const nouveau = nomDraft.trim();
    if (!nouveau || !onRename || nouveau === mec.displayName) {
      setNomFormOpen(false);
      return;
    }
    onRename(mec, nouveau);
  };
  // On change de personne (clic sur un autre nœud) : le formulaire se ferme,
  // sinon la saisie en cours se retrouverait sur le mauvais dossier.
  useEffect(() => {
    setNomFormOpen(false);
  }, [mec.id]);

  // ── Camp ──
  const [campFormOpen, setCampFormOpen] = useState(false);
  const [campLabelDraft, setCampLabelDraft] = useState('');
  const [campColorDraft, setCampColorDraft] = useState(CAMP_COLOR_PRESETS[0]);
  useEffect(() => {
    setCampFormOpen(false);
    setCampLabelDraft('');
  }, [mec.id]);
  const createCamp = () => {
    const lbl = campLabelDraft.trim();
    if (!lbl || !onSetCamp) return;
    onSetCamp(mec.id, lbl, campColorDraft);
    setCampFormOpen(false);
    setCampLabelDraft('');
  };

  // ── Liens avec les autres personnes ──
  // 1. Liens de renseignement personne ↔ personne (tracés à la main ou
  //    validés depuis les propositions de l'attaché), avec leur libellé.
  // 2. Co-mis en cause : personnes qui partagent au moins un dossier.
  const { liensPersonnes, coMisEnCause } = useMemo(() => {
    const liens: Array<{ lienId: string; other: MecNode; label?: string; notes?: string }> = [];
    for (const e of graph.edges) {
      if (e.kind !== 'renseignement') continue;
      const otherId = e.source === mec.id ? e.target : e.target === mec.id ? e.source : undefined;
      if (!otherId) continue;
      const other = graph.mecById.get(otherId);
      if (other) liens.push({ lienId: e.id, other, label: e.label, notes: e.notes });
    }
    const dossierSet = new Set(mec.dossierIds);
    const shared = new Map<string, number>();
    for (const e of graph.edges) {
      if (e.kind === 'renseignement') continue;
      if (!dossierSet.has(e.target)) continue;
      if (e.source === mec.id) continue;
      shared.set(e.source, (shared.get(e.source) || 0) + 1);
    }
    const co = [...shared.entries()]
      .map(([id, n]) => ({ other: graph.mecById.get(id), n }))
      .filter((x): x is { other: MecNode; n: number } => Boolean(x.other))
      .sort((a, b) => b.n - a.n || a.other.displayName.localeCompare(b.other.displayName, 'fr'));
    return { liensPersonnes: liens, coMisEnCause: co };
  }, [graph, mec.id, mec.dossierIds]);

  const [showAllCo, setShowAllCo] = useState(false);
  useEffect(() => { setShowAllCo(false); }, [mec.id]);
  const coShown = showAllCo ? coMisEnCause : coMisEnCause.slice(0, 8);

  return (
    <div className="absolute top-0 right-0 h-full w-96 bg-white border-l border-slate-200 shadow-xl flex flex-col z-20">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-slate-200 bg-slate-50">
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Mis en cause</div>
          {nomFormOpen ? (
            <div className="mb-1">
              <input
                type="text"
                value={nomDraft}
                onChange={e => setNomDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitNom();
                  if (e.key === 'Escape') setNomFormOpen(false);
                }}
                disabled={renamePending}
                className="w-full h-8 px-2 text-sm font-semibold border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:bg-slate-100"
                autoFocus
              />
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[10px] text-slate-500 flex-1 leading-tight">
                  Corrige le nom dans tous les dossiers où il figure.
                </span>
                <button
                  onClick={() => setNomFormOpen(false)}
                  disabled={renamePending}
                  className="text-[10px] px-2 py-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  onClick={submitNom}
                  disabled={renamePending || !nomDraft.trim() || nomDraft.trim() === mec.displayName}
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded ${
                    !renamePending && nomDraft.trim() && nomDraft.trim() !== mec.displayName
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {renamePending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {renamePending ? 'Renommage…' : 'Renommer'}
                </button>
              </div>
            </div>
          ) : (
            <div className="group/nom flex items-center gap-1">
              <div className="text-lg font-semibold text-slate-900 truncate" title={mec.displayName}>
                {mec.displayName}
              </div>
              {onRename && (
                <button
                  onClick={openNomForm}
                  title="Corriger le nom (propagé à tous les dossiers)"
                  aria-label="Corriger le nom"
                  className="flex-shrink-0 p-1 rounded text-slate-300 hover:text-slate-700 hover:bg-slate-200/70 opacity-0 group-hover/nom:opacity-100 focus:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {(mec.manualAlias?.length || 0) > 0 && (
            <div className="text-xs text-slate-600 mt-0.5 truncate" title={mec.manualAlias!.join(', ')}>
              dit <span className="font-medium">{mec.manualAlias!.join(' · ')}</span>
            </div>
          )}
          {mec.variants.length > 0 && (
            <div className="text-xs text-slate-500 mt-1">
              Aussi orthographié : {mec.variants.slice(0, 3).join(', ')}
              {mec.variants.length > 3 ? '…' : ''}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1 empty:mt-0">
            {mec.campLabel && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full text-white"
                style={{ background: mec.campColor || '#475569' }}
              >
                <Flag className="h-3 w-3" />
                {mec.campLabel}
              </span>
            )}
            {mec.role && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                <Crown className="h-3 w-3" />
                {mec.role === 'chef_reseau' ? 'Chef de réseau' : 'Lieutenant'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Score composite — REPLIÉ par défaut : le chiffre reste visible,
            le détail (et l'importance manuelle) se déplie à la demande. */}
        <div className="border-b border-slate-200">
          <button
            onClick={() => setScoreOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 text-left"
          >
            {scoreOpen
              ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />}
            <span className="text-xs uppercase tracking-wide text-slate-500 flex-1">
              Score composite
            </span>
            <span className="text-sm font-bold text-slate-900 bg-slate-100 rounded px-2 py-0.5">
              {mec.rawScore.toFixed(1)}
            </span>
            {mec.manualBonus !== 0 && (
              <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
                {mec.manualBonus > 0 ? '+' : ''}{mec.manualBonus}
              </span>
            )}
            {mec.role && (
              <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
                +{MEC_ROLE_POINTS[mec.role]}
              </span>
            )}
          </button>

          {scoreOpen && (
            <div className="px-4 pb-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Dossiers" value={mec.dossierIds.length} />
                <Stat
                  label="Chefs cumulés"
                  value={
                    mec.nbChefsViaLien > 0
                      ? `${mec.nbChefs} (dont ${mec.nbChefsViaLien} via lien)`
                      : mec.nbChefs
                  }
                />
                <Stat label="Liens renseignement" value={mec.nbLiensRenseignement} />
                {mec.infractionWeight > 0 && (
                  <Stat label="Bonus infraction" value={`+${mec.infractionWeight.toFixed(1)}`} />
                )}
                {mec.propagatedWeight > 0 && (
                  <Stat
                    label="Contamination latente"
                    value={`+${mec.propagatedWeight.toFixed(1)}`}
                  />
                )}
                {mec.activityYears.length > 0 && (
                  <Stat
                    label="Facteur temporel"
                    value={`×${mec.temporalFactor.toFixed(2)}`}
                  />
                )}
                {mec.role && (
                  <Stat
                    label={mec.role === 'chef_reseau' ? 'Chef de réseau' : 'Lieutenant'}
                    value={`+${MEC_ROLE_POINTS[mec.role]}`}
                  />
                )}
                <Stat label="Score brut" value={mec.rawScore.toFixed(1)} />
              </div>
              {/* Lecture de la pondération temporelle : période d'implication connue
                  et sens du facteur appliqué (malus d'ancienneté / bonus continuité). */}
              {mec.activityYears.length > 0 && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Implication connue{' '}
                  <span className="font-medium text-slate-700">
                    {mec.firstActivityYear === mec.lastActivityYear
                      ? mec.lastActivityYear
                      : `${mec.firstActivityYear} – ${mec.lastActivityYear}`}
                  </span>
                  {' · '}
                  {mec.activityYears.length} année{mec.activityYears.length > 1 ? 's' : ''} d&apos;activité
                </div>
              )}
              {/* D'OÙ vient le poids reçu : sans ce détail, la contamination est un
                  total inexplicable au moment de justifier un classement. */}
              {mec.propagationTop && mec.propagationTop.length > 0 && (
                <div className="mt-2 text-[11px] text-slate-500">
                  Entourage :{' '}
                  {mec.propagationTop.map((c, i) => (
                    <span key={c.mecId}>
                      {i > 0 ? ', ' : ''}
                      <span className="font-medium text-slate-700">{c.displayName}</span>
                      {' +'}
                      {c.points.toFixed(1)}
                      <span className="text-slate-400">
                        {c.via === 'dossier' ? ' (dossier)' : ' (lien)'}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1 empty:mt-0">
                {/* « Mention récente » (dossier touché dans les 12 mois) est masquée
                    quand le malus d'ancienneté s'applique : les deux étiquettes se
                    contrediraient, le facteur temporel se lisant sur les dates
                    judiciaires et non sur la date de dernière saisie. */}
                {mec.recent && mec.temporalFactor >= 0.99 && (
                  <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Mention récente (12 derniers mois)
                  </span>
                )}
                {mec.temporalFactor < 0.99 && (
                  <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    Dormant — malus d&apos;ancienneté ×{mec.temporalFactor.toFixed(2)}
                  </span>
                )}
                {mec.temporalFactor > 1.01 && (
                  <span className="text-[11px] font-medium text-sky-800 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                    Activité continue — bonus ×{mec.temporalFactor.toFixed(2)}
                  </span>
                )}
                {/* Entourage : ce que la personne doit à ceux qui l'entourent (liens de
                    renseignement et dossiers partagés). Signalé à part car c'est la
                    seule part du score qui ne vient pas de ses propres dossiers —
                    utile pour ne pas surinterpréter un Top. */}
                {mec.propagatedWeight > 0 && (
                  <span
                    className="text-[11px] font-medium text-violet-800 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded"
                    title="Poids reçu de l'entourage : personnes reliées par un lien de renseignement et membres les plus lourds des dossiers partagés (atténué à chaque saut)."
                  >
                    Entourage impliqué — +{mec.propagatedWeight.toFixed(1)} pt
                    {mec.propagatedWeight >= 2 ? 's' : ''}
                    {mec.dossierIds.length === 0 ? ' (aucun dossier propre)' : ''}
                  </span>
                )}
              </div>
              {mec.statuts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {mec.statuts.map(s => (
                    <span key={s} className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {/* Rôle hiérarchique : bonus fixes, commit immédiat. */}
              {onSetRole && (
                <div className="mt-3 border border-slate-200 rounded-md p-2.5 bg-slate-50/60">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1">
                    <Crown className="h-3 w-3 text-amber-500" />
                    Rôle dans le réseau
                  </div>
                  <label className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mec.role === 'lieutenant'}
                      onChange={() => toggleRole('lieutenant')}
                      className="h-3.5 w-3.5 accent-amber-600"
                    />
                    <span className="text-xs text-slate-800">Lieutenant</span>
                    <span className="text-[10px] text-slate-500 ml-auto">+{MEC_ROLE_POINTS.lieutenant} pts</span>
                  </label>
                  <label className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mec.role === 'chef_reseau'}
                      onChange={() => toggleRole('chef_reseau')}
                      className="h-3.5 w-3.5 accent-amber-600"
                    />
                    <span className="text-xs text-slate-800">Chef de réseau</span>
                    <span className="text-[10px] text-slate-500 ml-auto">+{MEC_ROLE_POINTS.chef_reseau} pts</span>
                  </label>
                </div>
              )}

              {/* Importance manuelle — vit DANS le bloc score déplié. */}
              {onSetScoreBoost && (
                <div className="mt-3 border border-amber-200 rounded-md p-2.5 bg-amber-50/40">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                      <Star className="h-3.5 w-3.5 text-amber-500" />
                      Importance manuelle
                    </div>
                    {mec.manualBonus !== 0 && (
                      <button
                        onClick={resetBoost}
                        className="text-[10px] text-slate-500 hover:text-slate-800 underline"
                      >
                        réinitialiser
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setBoostDraft(b => Math.max(BOOST_MIN, b - 1))}
                      className="h-8 w-8 flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-50"
                      title="Diminuer"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      value={boostDraft}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setBoostDraft(Number.isNaN(v) ? 0 : v);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitBoost(); }}
                      min={BOOST_MIN}
                      max={BOOST_MAX}
                      className="flex-1 h-8 text-center text-sm font-semibold border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                    <button
                      onClick={() => setBoostDraft(b => Math.min(BOOST_MAX, b + 1))}
                      className="h-8 w-8 flex items-center justify-center rounded border border-slate-300 bg-white hover:bg-slate-50"
                      title="Augmenter"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input
                    type="text"
                    value={reasonDraft}
                    onChange={(e) => setReasonDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitBoost(); }}
                    placeholder="Justification (optionnel)…"
                    className="mt-2 w-full h-8 px-2 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>
                      Bonus appliqué après formule (de {BOOST_MIN} à +{BOOST_MAX}).
                    </span>
                    <button
                      onClick={commitBoost}
                      disabled={!boostDirty}
                      className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${
                        boostDirty
                          ? 'bg-amber-500 text-white hover:bg-amber-600'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      Enregistrer
                    </button>
                  </div>
                  {mec.manualBonus !== 0 && (
                    <div className="mt-2 text-[11px] text-amber-800 bg-amber-100 border border-amber-200 rounded px-2 py-1">
                      Bonus actif : {mec.manualBonus > 0 ? '+' : ''}{mec.manualBonus} pt{Math.abs(mec.manualBonus) > 1 ? 's' : ''}
                      {mec.manualBonusReason ? ` — ${mec.manualBonusReason}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Camp (réseau d'appartenance) : distingue visuellement deux groupes
            rivaux enchevêtrés dans les mêmes dossiers. */}
        {onSetCamp && (
          <div className="px-4 py-3 border-b border-slate-200">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5 text-slate-400" />
              Camp
              {mec.campLabel && onRemoveCamp && (
                <button
                  onClick={() => onRemoveCamp(mec.id)}
                  className="ml-auto text-[10px] text-slate-500 hover:text-slate-800 underline normal-case tracking-normal"
                >
                  retirer
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {existingCamps.map(c => {
                const active = mec.campLabel === c.label;
                return (
                  <button
                    key={c.label}
                    onClick={() => onSetCamp(mec.id, c.label, c.color)}
                    className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-all ${
                      active ? 'text-white shadow-sm' : 'bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    style={active
                      ? { background: c.color, borderColor: c.color }
                      : { borderColor: c.color }}
                    title={`${c.count} membre${c.count > 1 ? 's' : ''}`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: active ? '#fff' : c.color }} />
                    {c.label}
                    <span className={active ? 'text-white/80' : 'text-slate-400'}>{c.count}</span>
                  </button>
                );
              })}
              <button
                onClick={() => setCampFormOpen(o => !o)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              >
                <Plus className="h-3 w-3" />
                nouveau camp
              </button>
            </div>
            {campFormOpen && (
              <div className="mt-2 border border-slate-200 rounded-md p-2 bg-slate-50/60">
                <input
                  type="text"
                  value={campLabelDraft}
                  onChange={e => setCampLabelDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') createCamp(); }}
                  placeholder="ex. Réseau Ben Cherki, Groupe le Corner…"
                  className="w-full h-8 px-2 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                  autoFocus
                />
                <div className="flex items-center gap-1.5 mt-2">
                  {CAMP_COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      onClick={() => setCampColorDraft(c)}
                      className={`h-5 w-5 rounded-full transition-transform ${
                        campColorDraft === c ? 'ring-2 ring-offset-1 ring-slate-400 scale-110' : 'hover:scale-110'
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                  <button
                    onClick={createCamp}
                    disabled={!campLabelDraft.trim()}
                    className={`ml-auto text-[10px] font-semibold px-2 py-1 rounded ${
                      campLabelDraft.trim()
                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    Assigner
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notes & surnoms : fiche manuelle éditable pour TOUT MEC (réel ou
            ex nihilo). Les valeurs déjà saisies (fiche créée via « Ajouter »)
            sont reprises telles quelles. */}
        {onSaveFiche && (
          <div className="px-4 py-3 border-b border-slate-200">
            <div className="flex items-center gap-1.5 mb-2">
              <StickyNote className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs uppercase tracking-wide text-slate-500 flex-1">Notes &amp; surnoms</span>
              {onEnrichRequest && (
                <button
                  onClick={() => onEnrichRequest(mec)}
                  title="Demander à l'attaché IA de rechercher cette personne dans les dossiers et pièces, puis de PROPOSER un enrichissement de la fiche (✓/✗ — vos notes ne sont jamais modifiées ni effacées)"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                >
                  <Sparkles className="h-3 w-3" />
                  Enrichir (attaché)
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={aliasInput}
                onChange={e => setAliasInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                placeholder="Surnom — entrée pour valider"
                className="flex-1 h-8 px-2 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
              <button
                onClick={addAlias}
                className="h-8 px-2 text-xs rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-600"
              >
                Ajouter
              </button>
            </div>
            {aliasDraft.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {aliasDraft.map(a => (
                  <span key={a} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 rounded px-2 py-0.5">
                    {a}
                    <button
                      onClick={() => setAliasDraft(prev => prev.filter(x => x !== a))}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="Contexte, rôle supposé, éléments de renseignement…"
              rows={3}
              className="mt-2 w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 resize-y"
            />
            <div className="mt-1.5 flex justify-end">
              <button
                onClick={commitFiche}
                disabled={!ficheDirty}
                className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${
                  ficheDirty
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                Enregistrer la fiche
              </button>
            </div>
          </div>
        )}

        {/* Liens avec les autres personnes */}
        {(liensPersonnes.length > 0 || coMisEnCause.length > 0) && (
          <div className="border-b border-slate-200 pb-2">
            <div className="px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              Liens avec les personnes ({liensPersonnes.length + coMisEnCause.length})
            </div>
            {liensPersonnes.length > 0 && (
              <ul className="px-2">
                {liensPersonnes.map(({ lienId, other, label, notes }, i) => (
                  <li key={`lien_${other.id}_${i}`} className="flex items-center group/row">
                    <button
                      onClick={() => onPersonClick?.(other)}
                      className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-50 group text-left"
                      title={notes || undefined}
                    >
                      <LinkIcon className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-slate-900 truncate block">{other.displayName}</span>
                        <span className="text-[11px] text-blue-700 truncate block">
                          {label || 'lien de renseignement'}
                        </span>
                      </div>
                      {other.campLabel && (
                        <span
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{ background: other.campColor || '#475569' }}
                          title={other.campLabel}
                        />
                      )}
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                    </button>
                    {onDeleteLien && (
                      <button
                        onClick={() => {
                          if (window.confirm(
                            `Supprimer le lien de renseignement entre ${mec.displayName} et ${other.displayName}`
                            + `${label ? ` (« ${label} »)` : ''} ?`,
                          )) onDeleteLien(lienId);
                        }}
                        title="Supprimer ce lien de renseignement"
                        className="mr-2 p-1 rounded text-red-300 hover:text-red-600 hover:bg-red-50 flex-shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {coMisEnCause.length > 0 && (
              <>
                <div className="px-4 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                  Co-mis en cause (dossiers partagés)
                </div>
                <ul className="px-2">
                  {coShown.map(({ other, n }) => (
                    <li key={`co_${other.id}`}>
                      <button
                        onClick={() => onPersonClick?.(other)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-50 group text-left"
                      >
                        <Users className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                        <span className="flex-1 min-w-0 text-sm text-slate-900 truncate">{other.displayName}</span>
                        {other.campLabel && (
                          <span
                            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ background: other.campColor || '#475569' }}
                            title={other.campLabel}
                          />
                        )}
                        <span className="text-[10px] text-slate-400 flex-shrink-0">
                          {n} dossier{n > 1 ? 's' : ''}
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
                {coMisEnCause.length > 8 && (
                  <button
                    onClick={() => setShowAllCo(s => !s)}
                    className="mx-4 mt-1 text-[11px] text-slate-500 hover:text-slate-800 underline"
                  >
                    {showAllCo ? 'réduire' : `voir les ${coMisEnCause.length - 8} autres…`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Dossiers */}
        <div>
          <div className="px-4 pt-3 pb-1 text-xs uppercase tracking-wide text-slate-500">
            Dossiers ({dossiers.length})
          </div>
          <ul className="px-2 pb-2">
            {dossiers.map(d => {
              const ctx = ctxColorById.get(d.contentieuxId);
              return (
                <li key={d.id}>
                  <button
                    onClick={() => onDossierClick?.(d)}
                    onDoubleClick={() => onDossierOpen?.(d)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-slate-50 group text-left"
                  >
                    <div
                      className="h-2 w-2 rounded-full flex-shrink-0"
                      style={{ background: ctx?.color || '#64748b' }}
                    />
                    <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm text-slate-900 truncate">{d.numero}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {ctx?.label || d.contentieuxId}
                        {d.statut !== 'en_cours' && ` • ${d.statut}`}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="px-4 pb-4 text-[11px] text-slate-400">
            Clic = recentrer · Double-clic = ouvrir le dossier
          </div>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
  <div className="bg-slate-50 rounded p-2">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-base font-semibold text-slate-900">{value}</div>
  </div>
);
