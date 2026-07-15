'use client';

/**
 * SIRAL — Attaché de justice · propositions de CRÉATION (✓/✗).
 *
 * Contrairement à PropositionsBar (rattachée à un dossier existant), ce
 * bandeau surface les propositions globales, sans dossier support :
 *   - `dossier`        : nouveau dossier réel extrait d'un PV/résumé collé
 *                        dans le chat (créé dans le contentieux à la ✓) ;
 *   - `dossier_carto`  : dossier ex nihilo sur la carte, avec création
 *                        automatique des mis en cause inconnus à la ✓ ;
 *   - `mec_carto`      : personne ex nihilo autonome (suspect/surnom au 2nd
 *                        plan, absent des dossiers) ;
 *   - `lien`           : lien de renseignement personne↔personne détecté par
 *                        l'analyse transversale (module de revue de la carte).
 * Visible du SEUL administrateur (l'API renvoie 404 sinon). Le paramètre
 * `kinds` restreint aux types pertinents selon l'endroit d'affichage.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X, FolderPlus, Network, UserPlus, GitBranch, Loader2, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

type Kind = 'dossier' | 'dossier_carto' | 'mec_carto' | 'lien';

interface Mec { nom?: string; role?: string; statut?: string }

interface Proposition {
  id: string;
  numero: string;
  type: Kind;
  titre: string;
  payload: {
    numero?: string;
    label?: string;
    dateDebut?: string;
    dateApprox?: string;
    services?: string[];
    description?: string;
    natinfCodes?: string[];
    notes?: string;
    misEnCause?: Array<Mec | string>;
    // mec_carto
    nom?: string;
    alias?: string[];
    // lien
    sourceNom?: string;
    targetNom?: string;
  };
  source?: string;
  creeLe: string;
}

const TYPE_META: Record<Kind, { icon: typeof FolderPlus; label: string; tint: string }> = {
  dossier:       { icon: FolderPlus, label: 'Nouveau dossier',      tint: 'text-indigo-700 bg-indigo-50' },
  dossier_carto: { icon: Network,    label: 'Dossier ex nihilo',    tint: 'text-violet-700 bg-violet-50' },
  mec_carto:     { icon: UserPlus,   label: 'Personne ex nihilo',   tint: 'text-sky-700 bg-sky-50' },
  lien:          { icon: GitBranch,  label: 'Lien de renseignement', tint: 'text-teal-700 bg-teal-50' },
};

const CARTO_KINDS: Kind[] = ['dossier_carto', 'mec_carto', 'lien'];

function mecName(m: Mec | string): string {
  return typeof m === 'string' ? m : (m?.nom || '');
}

export function NouveauxDossiersPropositions({
  kinds = ['dossier', 'dossier_carto'],
  title = 'Propositions de dossier',
  reloadSignal,
}: {
  kinds?: readonly Kind[];
  title?: string;
  /** Toute variation déclenche un rechargement (ex. fin d'un tour de chat). */
  reloadSignal?: number;
}) {
  const [props, setProps] = useState<Proposition[]>([]);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Pas de `numero` : on récupère toutes les propositions en attente puis
      // on filtre sur les types de création demandés.
      const res = await fetch('/api/attache/propositions');
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      const all = ((await res.json()).propositions || []) as Proposition[];
      setProps(all.filter((p) => kinds.includes(p.type)));
    } catch {
      setAvailable(false);
    }
    // kinds sérialisé : un tableau inline (prop) change d'identité à chaque
    // rendu — sans cela, rechargement en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kinds.join(',')]);

  useEffect(() => { load(); }, [load, reloadSignal]);

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
        const p = props.find((x) => x.id === id);
        setProps((prev) => prev.filter((x) => x.id !== id));
        if (action === 'valider') {
          const onCarte = p && CARTO_KINDS.includes(p.type);
          setNotice(onCarte
            ? 'Enregistré sur la carte — la synchronisation l\'affichera dans quelques secondes.'
            : 'Dossier créé — la synchronisation le fera apparaître dans quelques secondes.');
        }
      } else {
        setNotice(data.error || 'Décision refusée par le serveur');
      }
    } finally {
      setBusy(null);
    }
  }, [props]);

  if (!available || props.length === 0) return null;

  const allCarto = props.every((p) => CARTO_KINDS.includes(p.type));

  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-xs font-bold text-gray-800">
          {props.length} {title.toLowerCase()}{props.length > 1 ? 's' : ''} de l'attaché
        </span>
        <span className="text-[10.5px] text-gray-400">visibles de vous seul · ✓ {allCarto ? 'trace sur la carte' : 'crée (signé de votre nom)'} · ✗ refuse</span>
      </div>
      <div className="divide-y divide-amber-100/70">
        {props.map((p) => {
          const meta = TYPE_META[p.type];
          const Icon = meta.icon;
          const isOpen = expanded === p.id;
          const mecs = (p.payload.misEnCause || []).map(mecName).filter(Boolean);
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
                      title={CARTO_KINDS.includes(p.type) ? 'Valider — tracer sur la carte' : 'Valider — créer le dossier'}
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
                <div className="mt-1.5 space-y-1 rounded-lg border border-amber-100 bg-white p-2 text-[11.5px] leading-relaxed text-gray-700">
                  {p.type === 'dossier' && (
                    <>
                      <Field label="Numéro" value={p.payload.numero} />
                      <Field label="Date de début" value={p.payload.dateDebut} />
                      <Field label="Service(s)" value={(p.payload.services || []).join(', ')} />
                      <Field label="Objet" value={p.payload.description} />
                    </>
                  )}
                  {p.type === 'dossier_carto' && (
                    <>
                      <Field label="Libellé" value={p.payload.label} />
                      <Field label="Date" value={p.payload.dateApprox} />
                      <Field label="NATINF" value={(p.payload.natinfCodes || []).join(', ')} />
                      <Field label="Notes" value={p.payload.notes} />
                    </>
                  )}
                  {p.type === 'mec_carto' && (
                    <>
                      <Field label="Personne" value={p.payload.nom} />
                      <Field label="Alias / surnoms" value={(p.payload.alias || []).join(', ')} />
                      <Field label="Notes" value={p.payload.notes} />
                    </>
                  )}
                  {p.type === 'lien' && (
                    <>
                      <Field label="Entre" value={`${p.payload.sourceNom || '?'}  ↔  ${p.payload.targetNom || '?'}`} />
                      <Field label="Nature" value={p.payload.label} />
                      <Field label="Notes" value={p.payload.notes} />
                    </>
                  )}
                  {mecs.length > 0 && (
                    <div>
                      <span className="font-semibold text-gray-600">Mis en cause ({mecs.length}) :</span>
                      <ul className="mt-0.5 list-disc pl-5">
                        {(p.payload.misEnCause || []).map((m, i) => {
                          const nom = mecName(m);
                          if (!nom) return null;
                          const role = typeof m === 'object' ? m.role : undefined;
                          return <li key={i}>{nom}{role ? <span className="text-gray-400"> — {role}</span> : null}</li>;
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {notice && <div className="border-t border-amber-100 px-3 py-1.5 text-[11px] text-gray-500">{notice}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  const v = String(value || '').trim();
  if (!v) return null;
  return (
    <div>
      <span className="font-semibold text-gray-600">{label} :</span>{' '}
      <span className="whitespace-pre-wrap">{v}</span>
    </div>
  );
}
