'use client';

/**
 * SIRAL — Attaché de justice · chronologie probatoire d'un dossier.
 *
 * Section du détail d'enquête visible du SEUL administrateur (elle se
 * masque d'elle-même si le service attaché ne répond pas — les autres
 * comptes reçoivent 404 et ne soupçonnent pas son existence).
 *
 * Fusionne tout ce qui est daté : lancement du dossier, actes (débuts,
 * poses, prolongations, échéances, attentes JLD), comptes-rendus,
 * modifications (apparition de mis en cause), DML archivées, et — une
 * fois l'architecture NPP importée (coller l'arborescence des cotes) —
 * les pièces cotées datées du dossier d'instruction.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  History, RefreshCw, Loader2, ClipboardPaste, X, ChevronDown, ChevronUp,
  FileText, Phone, MapPin, Gavel, AlertCircle, BookOpen, Landmark,
} from 'lucide-react';

interface ChronoEntry {
  date: string;
  type: string;
  titre: string;
  detail?: string;
  source: 'siral' | 'npp';
}

interface Chrono {
  numero: string;
  reference?: string;
  architectureImportee: boolean;
  nbCotes?: number;
  entries: ChronoEntry[];
}

const TYPE_STYLE: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  ouverture:    { icon: Landmark,    color: 'text-gray-700 bg-gray-100',      label: 'Ouverture' },
  op:           { icon: Landmark,    color: 'text-gray-700 bg-gray-100',      label: 'OP' },
  acte_debut:   { icon: Gavel,       color: 'text-emerald-700 bg-emerald-50', label: 'Acte' },
  pose:         { icon: MapPin,      color: 'text-emerald-700 bg-emerald-50', label: 'Pose' },
  prolongation: { icon: History,     color: 'text-blue-700 bg-blue-50',       label: 'Prolongation' },
  attente_jld:  { icon: AlertCircle, color: 'text-amber-700 bg-amber-50',     label: 'JLD' },
  acte_fin:     { icon: AlertCircle, color: 'text-red-600 bg-red-50',         label: 'Échéance' },
  cr:           { icon: FileText,    color: 'text-gray-600 bg-gray-50',       label: 'CR' },
  modification: { icon: History,     color: 'text-purple-600 bg-purple-50',   label: 'Modif.' },
  dml:          { icon: BookOpen,    color: 'text-rose-700 bg-rose-50',       label: 'DML' },
  cote:         { icon: FileText,    color: 'text-indigo-700 bg-indigo-50',   label: 'Cote NPP' },
};

export function ChronologieSection({ numero }: { numero: string }) {
  const [chrono, setChrono] = useState<Chrono | null>(null);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<'tout' | 'siral' | 'npp'>('tout');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/chronologie?numero=' + encodeURIComponent(numero));
      if (!res.ok) { setAvailable(res.status === 404 ? false : false); return; }
      setAvailable(true);
      setChrono(await res.json());
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [numero]);

  useEffect(() => { load(); }, [load]);

  const runImport = useCallback(async () => {
    if (!importText.trim()) return;
    setImporting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/attache/chronologie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero, texte: importText }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setNotice(`${data.nbCotes} cotes importées${data.reference ? ` (${data.reference})` : ''}.`);
        setImportText('');
        setShowImport(false);
        load();
      } else {
        setNotice(data.error || 'Import refusé');
      }
    } finally {
      setImporting(false);
    }
  }, [numero, importText, load]);

  if (!available) return null;

  const entries = (chrono?.entries || []).filter((e) => filter === 'tout' || e.source === filter);

  return (
    <div className="rounded-xl border border-indigo-200/60 bg-white">
      {/* En-tête repliable */}
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <History className="h-4 w-4 text-indigo-600" />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          Chronologie probatoire
          <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-600">Attaché · vous seul</span>
        </span>
        {chrono?.architectureImportee && (
          <span className="text-[11px] text-gray-400">{chrono.nbCotes} cotes NPP{chrono.reference ? ` · ${chrono.reference}` : ''}</span>
        )}
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          {/* Barre d'action */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 p-0.5 text-[11px] font-medium">
              {(['tout', 'siral', 'npp'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2 py-1 ${filter === f ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  {f === 'tout' ? 'Tout' : f === 'siral' ? 'SIRAL' : 'Cotes NPP'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowImport((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              {chrono?.architectureImportee ? 'Réimporter l\'architecture NPP' : 'Importer l\'architecture NPP'}
            </button>
            <button onClick={load} disabled={loading} className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

          {notice && <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11.5px] text-emerald-800">{notice}</div>}

          {/* Zone d'import NPP */}
          {showImport && (
            <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-gray-600">
                Collez l'arborescence des cotes telle qu'affichée dans NPP (sections E, D, C, B, A, G, S, Z…).
                L'attaché comprendra le sens et l'ordre du dossier ; les cotes datées alimentent la chronologie.
                <button onClick={() => setShowImport(false)} className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600"><X className="h-3.5 w-3.5" /></button>
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={8}
                placeholder={'AMI-25-064-061\n  E - Procédure d\'audience\n  E1 - copie CD…\n  D - Fond\n  D1-D1211 - Enquête initiale\n  …'}
                className="w-full resize-y rounded-lg border border-gray-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-gray-800 outline-none focus:border-indigo-400"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={runImport}
                  disabled={importing || !importText.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
                  Importer
                </button>
              </div>
            </div>
          )}

          {/* Frise */}
          {entries.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-400">
              {loading ? 'Construction de la chronologie…' : 'Aucun événement daté (ou trousseau non remis).'}
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <div className="relative ml-2 border-l-2 border-gray-200 pl-4">
                {entries.map((ev, i) => {
                  const meta = TYPE_STYLE[ev.type] || TYPE_STYLE.cr;
                  const Icon = meta.icon;
                  const newYear = i === 0 || ev.date.slice(0, 4) !== entries[i - 1].date.slice(0, 4);
                  return (
                    <div key={i}>
                      {newYear && (
                        <div className="-ml-[1.35rem] my-2 flex items-center gap-2">
                          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-bold text-white">{ev.date.slice(0, 4)}</span>
                        </div>
                      )}
                      <div className="relative mb-2.5">
                        <span className="absolute -left-[1.45rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-gray-300" />
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 whitespace-nowrap font-mono text-[10.5px] tabular-nums text-gray-400">{ev.date.slice(5)}</span>
                          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${meta.color}`}>
                            <Icon className="h-2.5 w-2.5" />{meta.label}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-medium leading-snug text-gray-800">{ev.titre}</div>
                            {ev.detail && <div className="text-[11px] leading-snug text-gray-500">{ev.detail}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
