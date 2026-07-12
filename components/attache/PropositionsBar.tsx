'use client';

/**
 * SIRAL — Attaché de justice · propositions en attente (✓/✗ discrets).
 *
 * Bandeau du détail d'enquête, visible du SEUL administrateur (auto-masqué
 * sinon — 404 pour tout autre compte). Chaque ligne est une écriture déjà
 * construite par l'attaché (nouveau MEC, acte, CR en prise de notes) :
 *   ✓ = appliquée au dossier, signée du nom de l'administrateur
 *   ✗ = refusée, sans trace.
 * Après décision, recharger la page du dossier reflète l'écriture (la
 * synchro du client web récupère la nouvelle version du coffre).
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X, UserPlus, Gavel, FileText, Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface Proposition {
  id: string;
  numero: string;
  type: 'mec' | 'acte' | 'cr';
  titre: string;
  payload: Record<string, unknown>;
  source?: string;
  creeLe: string;
}

const TYPE_META = {
  mec:  { icon: UserPlus, label: 'Mis en cause', tint: 'text-purple-700 bg-purple-50' },
  acte: { icon: Gavel,    label: 'Acte',         tint: 'text-emerald-700 bg-emerald-50' },
  cr:   { icon: FileText, label: 'CR',           tint: 'text-blue-700 bg-blue-50' },
} as const;

export function PropositionsBar({ numero }: { numero: string }) {
  const [props, setProps] = useState<Proposition[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/propositions?numero=' + encodeURIComponent(numero));
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      setProps(((await res.json()).propositions || []) as Proposition[]);
    } catch {
      setAvailable(false);
    }
  }, [numero]);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id: string, action: 'valider' | 'refuser') => {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch('/api/attache/propositions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setProps((prev) => prev.filter((p) => p.id !== id));
        if (action === 'valider') setNotice('Appliqué au dossier — la synchronisation reflétera l\'ajout dans quelques secondes.');
      } else {
        setNotice(data.error || 'Décision refusée par le serveur');
      }
    } finally {
      setBusy(null);
    }
  }, []);

  if (!available || props.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-bold text-gray-800">
          {props.length} proposition{props.length > 1 ? 's' : ''} de l'attaché
        </span>
        <span className="text-[10.5px] text-gray-400">visibles de vous seul · ✓ applique (signé de votre nom) · ✗ refuse</span>
      </div>
      <div className="divide-y divide-amber-100/70">
        {props.map((p) => {
          const meta = TYPE_META[p.type];
          const Icon = meta.icon;
          const isOpen = expanded === p.id;
          return (
            <div key={p.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${meta.tint}`}>
                  <Icon className="h-2.5 w-2.5" />{meta.label}
                </span>
                <button
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium text-gray-800 hover:text-gray-900"
                  title="Voir le détail"
                >
                  {p.titre}
                  {isOpen ? <ChevronUp className="ml-1 inline h-3 w-3 text-gray-400" /> : <ChevronDown className="ml-1 inline h-3 w-3 text-gray-400" />}
                </button>
                {busy === p.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                ) : (
                  <>
                    <button
                      onClick={() => decide(p.id, 'valider')}
                      title="Valider — appliquer au dossier"
                      className="grid h-6 w-6 place-items-center rounded-md text-emerald-600 hover:bg-emerald-100"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => decide(p.id, 'refuser')}
                      title="Refuser"
                      className="grid h-6 w-6 place-items-center rounded-md text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
              {p.source && <div className="mt-0.5 pl-1 text-[10.5px] text-gray-400">Source : {p.source}</div>}
              {isOpen && (
                <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-amber-100 bg-white p-2 font-sans text-[11.5px] leading-relaxed text-gray-700">
                  {p.type === 'cr'
                    ? String(p.payload.contenu || '')
                    : Object.entries(p.payload).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k} : ${v}`).join('\n')}
                </pre>
              )}
            </div>
          );
        })}
      </div>
      {notice && <div className="border-t border-amber-100 px-3 py-1.5 text-[11px] text-gray-500">{notice}</div>}
    </div>
  );
}
