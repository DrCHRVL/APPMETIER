'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { X, ClipboardPaste, Users, Scale, ListChecks, AlertTriangle, Download, Lock } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '@/contexts/ToastContext';
import { useNatinf } from '@/hooks/useNatinf';
import {
  parsePersonnesTable,
  parseInfractionsTable,
  parseEvenementsTable,
  buildMisEnExamen,
  buildSuspect,
  buildVictime,
  buildSaisineItem,
  buildEvenement,
  makeIdGen,
  normalizeNom,
  nameExists,
  suggestCasDPFromNatinfRefs,
  deriveDpPeriodesForPersonne,
  type ParsedPersonne,
  type CassiopeeRole,
} from '@/utils/cassiopeeImportUtils';
import { toRef } from '@/lib/natinf/natinfData';
import type { NatinfRef } from '@/types/natinf';
import type {
  MisEnExamen,
  Suspect,
  Victime,
  SaisineItem,
  EvenementInstruction,
} from '@/types/instructionTypes';

export interface CassiopeeImportResult {
  misEnExamen: MisEnExamen[];
  suspects: Suspect[];
  victimes: Victime[];
  saisine: SaisineItem[];
  evenements: EvenementInstruction[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (result: CassiopeeImportResult) => void;
  /** Données déjà présentes dans le dossier (détection des doublons + rattachements). */
  existingMisEnExamen: MisEnExamen[];
  existingSuspects: Suspect[];
  existingVictimes: Victime[];
  existingSaisine: SaisineItem[];
}

type PersonneTarget = 'mex' | 'suspect' | 'victime' | 'ignore';

const targetForRole = (role: CassiopeeRole): PersonneTarget => {
  switch (role) {
    case 'mis_en_examen':
      return 'mex';
    case 'mis_en_cause':
    case 'temoin_assiste':
      return 'suspect';
    case 'victime':
    case 'victime_beneficiaire':
    case 'partie_civile':
      return 'victime';
    default:
      return 'ignore';
  }
};

const TARGET_LABEL: Record<PersonneTarget, string> = {
  mex: 'Mis en examen',
  suspect: 'Suspect',
  victime: 'Victime / PC',
  ignore: 'Non importé',
};

const TARGET_COLOR: Record<PersonneTarget, string> = {
  mex: 'bg-red-100 text-red-800 border-red-300',
  suspect: 'bg-amber-100 text-amber-800 border-amber-300',
  victime: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  ignore: 'bg-gray-100 text-gray-500 border-gray-300',
};

const Chip = ({ target }: { target: PersonneTarget }) => (
  <span className={`shrink-0 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TARGET_COLOR[target]}`}>
    {TARGET_LABEL[target]}
  </span>
);

const SectionHeader = ({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
  children?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
      <Icon className="h-4 w-4" />
      {title}
      <span className="text-xs font-normal text-gray-400">({count})</span>
    </div>
    {children}
  </div>
);

export const CassiopeeImportModal = ({
  isOpen,
  onClose,
  onImport,
  existingMisEnExamen,
  existingSuspects,
  existingVictimes,
  existingSaisine,
}: Props) => {
  const { showToast } = useToast();
  const { getByCode } = useNatinf();

  const [personnesText, setPersonnesText] = useState('');
  const [infractionsText, setInfractionsText] = useState('');
  const [evenementsText, setEvenementsText] = useState('');

  // Clés désélectionnées (préfixées par catégorie).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  // ── Parsing (mémoïsé) ────────────────────────────────────────────
  const personnes = useMemo(() => parsePersonnesTable(personnesText), [personnesText]);
  const infractions = useMemo(() => parseInfractionsTable(infractionsText), [infractionsText]);
  const evenements = useMemo(() => parseEvenementsTable(evenementsText), [evenementsText]);

  const existingPersons = useMemo(
    () => [...existingMisEnExamen, ...existingSuspects, ...existingVictimes],
    [existingMisEnExamen, existingSuspects, existingVictimes],
  );
  const existingNatinfCodes = useMemo(
    () => new Set(existingSaisine.map(s => s.natinfCode).filter(Boolean) as string[]),
    [existingSaisine],
  );

  // Régime / cas légal de DP déduits de la saisine in rem (existante + collée).
  // Sert à poser le bon régime et les bonnes durées de période lors de la
  // reconstitution des DP.
  const dpSuggestion = useMemo(() => {
    const refs: (NatinfRef | undefined | null)[] = [
      ...existingSaisine.map(s => s.natinfRef),
      ...infractions.map(inf => {
        const e = getByCode(inf.natinfCode);
        return e ? toRef(e) : null;
      }),
    ];
    return suggestCasDPFromNatinfRefs(refs, getByCode);
  }, [existingSaisine, infractions, getByCode]);

  // Périodes de DP reconstituées par personne (aperçu, id jetables).
  const previewDp = useMemo(() => {
    const gen = makeIdGen();
    const map = new Map<string, ReturnType<typeof deriveDpPeriodesForPersonne>>();
    personnes.forEach(p => {
      if (p.categoriePenale !== 'DP') return;
      map.set(
        p.nom,
        deriveDpPeriodesForPersonne(p.nom, evenements, {
          regime: dpSuggestion?.regime ?? 'criminel',
          cas: dpSuggestion?.cas,
          newId: gen,
        }),
      );
    });
    return map;
  }, [personnes, evenements, dpSuggestion]);

  // Doublons : mêmes noms / mêmes codes déjà dans le dossier.
  const personneIsDup = (p: ParsedPersonne) => nameExists(p.nom, existingPersons);
  const infractionIsDup = (code: string) => existingNatinfCodes.has(code);

  // Par défaut : on décoche les doublons et les personnes « non importées ».
  useEffect(() => {
    const next = new Set<string>();
    personnes.forEach((p, i) => {
      if (targetForRole(p.role) === 'ignore' || personneIsDup(p)) next.add(`p:${i}`);
    });
    infractions.forEach(inf => {
      if (infractionIsDup(inf.natinfCode)) next.add(`i:${inf.natinfCode}`);
    });
    setDeselected(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personnes, infractions, evenements]);

  const isSel = (key: string) => !deselected.has(key);
  const toggle = (key: string) =>
    setDeselected(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const setSectionAll = (keys: string[], selected: boolean) =>
    setDeselected(prev => {
      const n = new Set(prev);
      keys.forEach(k => (selected ? n.delete(k) : n.add(k)));
      return n;
    });

  // ── Compteurs de ce qui sera importé ─────────────────────────────
  const counts = useMemo(() => {
    const c = { mex: 0, suspect: 0, victime: 0, saisine: 0, evt: 0 };
    personnes.forEach((p, i) => {
      if (!isSel(`p:${i}`)) return;
      const t = targetForRole(p.role);
      if (t === 'mex') c.mex++;
      else if (t === 'suspect') c.suspect++;
      else if (t === 'victime') c.victime++;
    });
    infractions.forEach(inf => {
      if (isSel(`i:${inf.natinfCode}`)) c.saisine++;
    });
    evenements.forEach((_, i) => {
      if (isSel(`e:${i}`)) c.evt++;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personnes, infractions, evenements, deselected]);

  const totalToImport = counts.mex + counts.suspect + counts.victime + counts.saisine + counts.evt;

  const handleImport = () => {
    const newId = makeIdGen();
    const ctx = { newId, resolveNatinf: getByCode };

    const misEnExamen: MisEnExamen[] = [];
    const suspects: Suspect[] = [];
    const victimes: Victime[] = [];
    personnes.forEach((p, i) => {
      if (!isSel(`p:${i}`)) return;
      const t = targetForRole(p.role);
      if (t === 'mex') {
        const dpPeriodes =
          p.categoriePenale === 'DP'
            ? deriveDpPeriodesForPersonne(p.nom, evenements, {
                regime: dpSuggestion?.regime ?? 'criminel',
                cas: dpSuggestion?.cas,
                newId,
              })
            : undefined;
        misEnExamen.push(
          buildMisEnExamen(p, ctx, {
            dpPeriodes,
            regime: dpSuggestion?.regime,
            casDPId: dpSuggestion?.casDPId,
          }),
        );
      } else if (t === 'suspect') suspects.push(buildSuspect(p, ctx));
      else if (t === 'victime') victimes.push(buildVictime(p, ctx));
    });

    const saisine: SaisineItem[] = infractions
      .filter(inf => isSel(`i:${inf.natinfCode}`))
      .map(inf => buildSaisineItem(inf, ctx));

    // Rattachement des événements aux personnes (nouvelles + existantes).
    const mexByName = new Map<string, number>();
    [...existingMisEnExamen, ...misEnExamen].forEach(m => mexByName.set(normalizeNom(m.nom), m.id));
    const victimeByName = new Map<string, number>();
    [...existingVictimes, ...victimes].forEach(v => victimeByName.set(normalizeNom(v.nom), v.id));

    const evts: EvenementInstruction[] = evenements
      .filter((_, i) => isSel(`e:${i}`))
      .map(ev => buildEvenement(ev, ctx, { mexByName, victimeByName }));

    if (misEnExamen.length + suspects.length + victimes.length + saisine.length + evts.length === 0) {
      showToast('Rien à importer : collez au moins un tableau Cassiopée', 'error');
      return;
    }

    onImport({ misEnExamen, suspects, victimes, saisine, evenements: evts });
    showToast(
      `Import Cassiopée : ${misEnExamen.length} MEX, ${suspects.length} suspect(s), ${victimes.length} victime(s), ${saisine.length} chef(s) de saisine, ${evts.length} événement(s)`,
      'success',
    );
    // Réinitialise pour un éventuel second import.
    setPersonnesText('');
    setInfractionsText('');
    setEvenementsText('');
    onClose();
  };

  if (!isOpen) return null;

  const personneKeys = personnes.map((_, i) => `p:${i}`);
  const infractionKeys = infractions.map(inf => `i:${inf.natinfCode}`);
  const evtKeys = evenements.map((_, i) => `e:${i}`);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-[92vw] max-w-[900px] max-h-[92vh] flex flex-col">
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div>
            <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
              <ClipboardPaste className="h-5 w-5 text-[#2B5746]" />
              Importer depuis Cassiopée
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Dans Cassiopée, sélectionnez un tableau (Personnes, Infractions, Événements),
              copiez-le (Ctrl+C) et collez-le ci-dessous. Vérifiez l'aperçu puis importez.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* PERSONNES */}
          <div className="space-y-2">
            <SectionHeader icon={Users} title="Personnes → mis en examen / suspects / victimes" count={personnes.length}>
              {personnes.length > 0 && (
                <div className="flex gap-1">
                  <button className="text-[11px] text-gray-500 hover:text-gray-800" onClick={() => setSectionAll(personneKeys, true)}>Tout cocher</button>
                  <span className="text-gray-300">·</span>
                  <button className="text-[11px] text-gray-500 hover:text-gray-800" onClick={() => setSectionAll(personneKeys, false)}>Tout décocher</button>
                </div>
              )}
            </SectionHeader>
            <textarea
              value={personnesText}
              onChange={e => setPersonnesText(e.target.value)}
              rows={3}
              placeholder="Collez ici le tableau « Personnes » (Rang / Identité / Rôle / …)"
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded resize-y font-mono"
            />
            {dpSuggestion && personnes.some(p => p.categoriePenale === 'DP') && (
              <div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50/60 px-2 py-1.5 text-[11px] text-red-800">
                <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  <b>Régime de DP déduit de la saisine in rem :</b>{' '}
                  {dpSuggestion.regime === 'criminel' ? 'criminel' : 'correctionnel'}
                  {dpSuggestion.cas ? ` — ${dpSuggestion.cas.label}` : ' — cas à préciser'}.
                  <span className="text-red-600"> {dpSuggestion.reason}</span>
                  {' '}Les périodes de DP sont reconstituées avec ces durées (à vérifier).
                </span>
              </div>
            )}
            {personnes.length > 0 && (
              <div className="max-h-48 overflow-y-auto border border-gray-100 rounded divide-y divide-gray-50">
                {personnes.map((p, i) => {
                  const target = targetForRole(p.role);
                  const dup = personneIsDup(p);
                  const dp = target === 'mex' && p.categoriePenale === 'DP' ? previewDp.get(p.nom) : undefined;
                  return (
                    <label key={i} className="block px-2 py-1 text-xs hover:bg-gray-50 cursor-pointer">
                      <span className="flex items-center gap-2">
                        <input type="checkbox" checked={isSel(`p:${i}`)} onChange={() => toggle(`p:${i}`)} className="shrink-0" />
                        <Chip target={target} />
                        <span className="font-medium text-gray-800 truncate">{p.nom}</span>
                        {p.dateNaissance && <span className="text-gray-400 shrink-0">{p.dateNaissance}</span>}
                        {p.categoriePenale && (
                          <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-600">{p.categoriePenale}</span>
                        )}
                        {dup && (
                          <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-[10px] text-orange-600">
                            <AlertTriangle className="h-3 w-3" /> déjà présent
                          </span>
                        )}
                      </span>
                      {dp && dp.length > 0 && (
                        <span className="block pl-7 pt-0.5 text-[10px] text-red-700">
                          DP reconstituée : placement {new Date(dp[0].dateDebut).toLocaleDateString()}
                          {dp.length > 1 ? ` + ${dp.length - 1} prolongation(s)` : ''} · fin actuelle {new Date(dp[dp.length - 1].dateFin).toLocaleDateString()}
                        </span>
                      )}
                      {target === 'mex' && p.categoriePenale === 'DP' && (!dp || dp.length === 0) && (
                        <span className="block pl-7 pt-0.5 text-[10px] text-gray-400 italic">
                          DP : aucun mandat de dépôt / ORDDP trouvé dans les événements collés → à saisir manuellement.
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* INFRACTIONS */}
          <div className="space-y-2">
            <SectionHeader icon={Scale} title="Infractions → saisine in rem" count={infractions.length}>
              {infractions.length > 0 && (
                <div className="flex gap-1">
                  <button className="text-[11px] text-gray-500 hover:text-gray-800" onClick={() => setSectionAll(infractionKeys, true)}>Tout cocher</button>
                  <span className="text-gray-300">·</span>
                  <button className="text-[11px] text-gray-500 hover:text-gray-800" onClick={() => setSectionAll(infractionKeys, false)}>Tout décocher</button>
                </div>
              )}
            </SectionHeader>
            <textarea
              value={infractionsText}
              onChange={e => setInfractionsText(e.target.value)}
              rows={3}
              placeholder="Collez ici le tableau « Infractions » (Rang / NATINF / QS / …)"
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded resize-y font-mono"
            />
            {infractions.length > 0 && (
              <div className="max-h-40 overflow-y-auto border border-gray-100 rounded divide-y divide-gray-50">
                {infractions.map(inf => {
                  const entry = getByCode(inf.natinfCode);
                  const dup = infractionIsDup(inf.natinfCode);
                  return (
                    <label key={inf.natinfCode} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={isSel(`i:${inf.natinfCode}`)} onChange={() => toggle(`i:${inf.natinfCode}`)} className="shrink-0" />
                      <span className="shrink-0 rounded bg-blue-50 px-1 font-mono text-[10px] text-blue-700">{inf.natinfCode}</span>
                      <span className="truncate text-gray-800">{entry?.libelle || inf.libelle || '(libellé inconnu)'}</span>
                      {!entry && <span className="shrink-0 text-[10px] text-orange-500">hors référentiel</span>}
                      {dup && (
                        <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-[10px] text-orange-600">
                          <AlertTriangle className="h-3 w-3" /> déjà présent
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* ÉVÉNEMENTS */}
          <div className="space-y-2">
            <SectionHeader icon={ListChecks} title="Événements → timeline" count={evenements.length}>
              {evenements.length > 0 && (
                <div className="flex gap-1">
                  <button className="text-[11px] text-gray-500 hover:text-gray-800" onClick={() => setSectionAll(evtKeys, true)}>Tout cocher</button>
                  <span className="text-gray-300">·</span>
                  <button className="text-[11px] text-gray-500 hover:text-gray-800" onClick={() => setSectionAll(evtKeys, false)}>Tout décocher</button>
                </div>
              )}
            </SectionHeader>
            <textarea
              value={evenementsText}
              onChange={e => setEvenementsText(e.target.value)}
              rows={3}
              placeholder="Collez ici le tableau « Événements » (Date / Emetteur / Événement / …). Plusieurs pages acceptées."
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded resize-y font-mono"
            />
            {evenements.length > 0 && (
              <div className="max-h-56 overflow-y-auto border border-gray-100 rounded divide-y divide-gray-50">
                {evenements.map((ev, i) => (
                  <label key={i} className="flex items-center gap-2 px-2 py-1 text-xs hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={isSel(`e:${i}`)} onChange={() => toggle(`e:${i}`)} className="shrink-0" />
                    <span className="shrink-0 text-gray-400 tabular-nums">{ev.date || ev.dateRaw}</span>
                    <span className="truncate text-gray-800">{ev.eventLabel}{ev.motif ? ` — ${ev.motif}` : ''}</span>
                    {ev.auteurs.length > 0 && (
                      <span className="ml-auto shrink-0 truncate max-w-[35%] text-[10px] text-gray-400">{ev.auteurs.join(', ')}</span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pied */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="text-xs text-gray-600">
            À importer : <b>{counts.mex}</b> MEX · <b>{counts.suspect}</b> suspect(s) · <b>{counts.victime}</b> victime(s) · <b>{counts.saisine}</b> chef(s) de saisine · <b>{counts.evt}</b> événement(s)
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={totalToImport === 0}
              className="bg-[#2B5746] hover:bg-[#1f3d2f] gap-1.5"
            >
              <Download className="h-4 w-4" />
              Importer {totalToImport > 0 ? `(${totalToImport})` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
