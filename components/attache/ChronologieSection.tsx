'use client';

/**
 * SIRAL — Attaché de justice · chronologie d'un dossier.
 *
 * Section du détail d'enquête visible du SEUL administrateur (elle se
 * masque d'elle-même si le service attaché ne répond pas — les autres
 * comptes reçoivent 404 et ne soupçonnent pas son existence).
 *
 * Fusionne tout ce qui est daté côté SIRAL : lancement du dossier, actes
 * (débuts, poses, prolongations, échéances, attentes JLD), comptes-rendus,
 * modifications (apparition de mis en cause) et DML archivées.
 * (L'architecture NPP / cotes relève du module instruction, pas d'ici.)
 */
import { useCallback, useEffect, useState } from 'react';
import {
  History, RefreshCw, Loader2, ChevronDown, ChevronUp,
  FileText, MapPin, Gavel, AlertCircle, BookOpen, Landmark,
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
};

export function ChronologieSection({ numero }: { numero: string }) {
  const [chrono, setChrono] = useState<Chrono | null>(null);
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/chronologie?numero=' + encodeURIComponent(numero));
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      setChrono(await res.json());
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [numero]);

  useEffect(() => { load(); }, [load]);

  if (!available) return null;

  const entries = (chrono?.entries || []).filter((e) => e.source !== 'npp');

  return (
    <div className="rounded-xl border border-indigo-200/60 bg-white">
      {/* En-tête repliable */}
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <History className="h-4 w-4 text-indigo-600" />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          Chronologie
          <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-600">Attaché · vous seul</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3">
          {/* Barre d'action */}
          <div className="mb-3 flex items-center">
            <button onClick={load} disabled={loading} className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>

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
