'use client';

/**
 * SIRAL — Attaché de justice · CONSIGNES PAR DOMAINE (les prompts métier).
 *
 * Les « Consignes permanentes » valent pour tout ce que fait l'attaché. Ici,
 * c'est l'étage en dessous : le prompt de CHAQUE tâche automatique — la
 * description d'un dossier, la recherche profonde dans la cartographie,
 * chaque étage d'un chantier d'analyse profonde.
 *
 * Ces prompts étaient figés dans le code : le magistrat les voit désormais
 * tels quels (le « socle »), et pour chacun choisit de les COMPLÉTER (son
 * texte s'ajoute) ou de les REMPLACER (son texte prend leur place). Le moteur
 * garde en main l'entête (dossier, lot, angle) et les données (pièces,
 * fiches) : une consigne change la méthode et le format, jamais
 * l'acheminement du contexte.
 *
 * E2EE : chiffrement DANS le navigateur — le serveur ne voit qu'une enveloppe.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SlidersHorizontal, ChevronDown, ChevronRight, Loader2, RotateCcw,
  AlertTriangle, Copy, Check,
} from 'lucide-react';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { siralBridge?: Record<string, AnyFn> }).siralBridge;

function bridgeFn(name: string): AnyFn {
  const fn = eapi()?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`fonction « ${name} » indisponible — rechargez l'application (Ctrl+Maj+R) après mise à jour`);
  }
  return fn;
}

interface CatalogueEntry {
  id: string;
  groupe: string;
  label: string;
  resume: string;
  quand: string;
  variables?: string[];
  avertissement?: string;
  socle: string;
}

type Mode = 'complement' | 'remplacement';
interface Consigne { mode: Mode; texte: string }

export function AttacheConsignesSection({ onNotice }: { onNotice?: (m: string) => void }) {
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [consignes, setConsignes] = useState<Record<string, Consigne>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [socleVisible, setSocleVisible] = useState<string | null>(null);
  const [copie, setCopie] = useState<string | null>(null);

  const notice = useCallback((m: string) => { if (onNotice) onNotice(m); }, [onNotice]);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/consignes');
      const data = await res.json().catch(() => ({})) as { catalogue?: CatalogueEntry[]; envelope?: unknown };
      setCatalogue(data.catalogue || []);
      if (data.envelope) {
        const payload = await bridgeFn('attache_decrypt')(data.envelope);
        const content = (payload as { content?: Record<string, Consigne> } | null)?.content;
        setConsignes(content && typeof content === 'object' ? content : {});
      } else {
        setConsignes({});
      }
      setDirty(false);
    } catch (e) {
      notice(`Lecture des consignes par domaine impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [notice]);

  useEffect(() => { if (open && !catalogue.length && !loading) charger(); }, [open, catalogue.length, loading, charger]);

  const enregistrer = useCallback(async () => {
    setSaving(true);
    try {
      // On ne conserve que les consignes réellement écrites : une case vidée
      // rend la tâche à son socle intégré, sans laisser d'entrée fantôme.
      const propre: Record<string, Consigne> = {};
      for (const [id, c] of Object.entries(consignes)) {
        if (c && c.texte && c.texte.trim()) propre[id] = { mode: c.mode === 'remplacement' ? 'remplacement' : 'complement', texte: c.texte };
      }
      const envelope = await bridgeFn('attache_encrypt')({ content: propre });
      const res = await fetch('/api/attache/consignes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope }),
      });
      if (res.ok) {
        setConsignes(propre);
        setDirty(false);
        notice('Consignes par domaine enregistrées — elles s\'appliquent au prochain run de chaque tâche.');
      } else {
        const data = await res.json().catch(() => ({}));
        notice(`Enregistrement refusé : ${data.error || res.status}`);
      }
    } catch (e) {
      notice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [consignes, notice]);

  const majConsigne = useCallback((id: string, patch: Partial<Consigne>) => {
    setConsignes((prev) => {
      const courant = prev[id] || { mode: 'complement' as Mode, texte: '' };
      return { ...prev, [id]: { ...courant, ...patch } };
    });
    setDirty(true);
  }, []);

  const copier = useCallback(async (id: string, texte: string) => {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(id);
      setTimeout(() => setCopie((c) => (c === id ? null : c)), 1500);
    } catch {
      notice('Copie impossible — sélectionnez le texte à la main.');
    }
  }, [notice]);

  const groupes = useMemo(() => {
    const map = new Map<string, CatalogueEntry[]>();
    for (const c of catalogue) {
      if (!map.has(c.groupe)) map.set(c.groupe, []);
      map.get(c.groupe)!.push(c);
    }
    return [...map.entries()];
  }, [catalogue]);

  const nbPersonnalisees = useMemo(
    () => Object.values(consignes).filter((c) => c && c.texte && c.texte.trim()).length,
    [consignes],
  );

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <SlidersHorizontal className="h-4 w-4 text-[#2B5746]" />
        <span className="text-sm font-semibold text-gray-800">Consignes par domaine</span>
        <span className="text-[11px] text-gray-400">
          les prompts métier — descriptions, recherches profondes, analyse profonde
        </span>
        {nbPersonnalisees > 0 && (
          <span className="rounded-full bg-[#2B5746]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#2B5746]">
            {nbPersonnalisees} personnalisé{nbPersonnalisees > 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          {open ? 'Fermer' : 'Ouvrir'}
        </button>
      </div>

      {!open ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          Le texte exact que reçoit l&apos;attaché pour chaque tâche automatique : rédaction des descriptions,
          recherche profonde dans la cartographie, chaque étage d&apos;un chantier d&apos;analyse profonde.
          Vous le lisez, vous le complétez, ou vous le remplacez.
        </p>
      ) : (
        <div className="space-y-3 p-3">
          {loading && (
            <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Lecture du catalogue…</p>
          )}
          {!loading && !catalogue.length && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
              Catalogue indisponible — le service attaché est injoignable. Vos consignes déjà enregistrées restent
              actives ; réessayez une fois le service relancé.
            </p>
          )}

          {groupes.map(([groupe, entrees]) => (
            <div key={groupe} className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{groupe}</p>
              {entrees.map((c) => {
                const consigne = consignes[c.id];
                const actif = Boolean(consigne?.texte?.trim());
                const isOpen = expanded === c.id;
                return (
                  <div key={c.id} className={`rounded-lg border ${actif ? 'border-[#2B5746]/35 bg-emerald-50/20' : 'border-gray-200'}`}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                      className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-gray-800">{c.label}</span>
                        <span className="block truncate text-[10.5px] text-gray-500">{c.resume}</span>
                      </span>
                      {actif && (
                        <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
                          consigne?.mode === 'remplacement' ? 'bg-orange-100 text-orange-700' : 'bg-[#2B5746]/10 text-[#2B5746]'
                        }`}>
                          {consigne?.mode === 'remplacement' ? 'Remplacé' : 'Complété'}
                        </span>
                      )}
                    </button>

                    {isOpen && (
                      <div className="space-y-2 border-t border-gray-100 px-2.5 py-2.5">
                        <p className="text-[10.5px] text-gray-500"><span className="font-semibold text-gray-600">Quand :</span> {c.quand}</p>

                        {/* Le socle intégré — ce que reçoit l'attaché aujourd'hui */}
                        <div className="rounded-lg border border-gray-200 bg-gray-50/70">
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            <button
                              onClick={() => setSocleVisible(socleVisible === c.id ? null : c.id)}
                              className="text-[11px] font-semibold text-gray-600 hover:text-[#2B5746]"
                            >
                              {socleVisible === c.id ? 'Masquer' : 'Voir'} le prompt intégré
                            </button>
                            <button
                              onClick={() => copier(c.id, c.socle)}
                              className="ml-auto inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                              title="Copier pour partir de ce texte dans un remplacement"
                            >
                              {copie === c.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                              Copier
                            </button>
                          </div>
                          {socleVisible === c.id && (
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-gray-200 px-2 py-2 font-mono text-[10.5px] leading-relaxed text-gray-700">{c.socle}</pre>
                          )}
                        </div>

                        {/* Complément / remplacement */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(['complement', 'remplacement'] as const).map((m) => (
                            <button
                              key={m}
                              onClick={() => majConsigne(c.id, { mode: m })}
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                (consigne?.mode || 'complement') === m
                                  ? 'border-[#2B5746] bg-[#2B5746] text-white'
                                  : 'border-gray-200 bg-white text-gray-600 hover:border-[#2B5746]/40'
                              }`}
                            >
                              {m === 'complement' ? 'Compléter le prompt' : 'Remplacer le prompt'}
                            </button>
                          ))}
                          {actif && (
                            <button
                              onClick={() => majConsigne(c.id, { texte: '' })}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
                              title="Revenir au prompt intégré"
                            >
                              <RotateCcw className="h-3 w-3" />Revenir au socle
                            </button>
                          )}
                        </div>

                        <textarea
                          value={consigne?.texte || ''}
                          onChange={(e) => majConsigne(c.id, { texte: e.target.value })}
                          rows={6}
                          placeholder={(consigne?.mode || 'complement') === 'complement'
                            ? 'Ce que vous ajoutez au prompt intégré — ex. « Pour chaque personne, précise systématiquement la source du numéro de téléphone. »'
                            : 'Le prompt COMPLET qui remplacera le socle. Partez du texte intégré (bouton Copier ci-dessus) et modifiez-le.'}
                          className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed outline-none focus:border-[#2B5746]/50"
                        />

                        {(c.variables || []).length > 0 && (
                          <p className="text-[10px] text-gray-400">
                            Variables substituées au run : {(c.variables || []).map((v) => <code key={v} className="mx-0.5 rounded bg-gray-100 px-1 py-0.5 font-mono text-[9.5px]">{v}</code>)}
                          </p>
                        )}

                        {(consigne?.mode === 'remplacement' && (actif || c.avertissement)) && (
                          <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10.5px] text-amber-800">
                            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                            <span>
                              {c.avertissement || 'Votre texte prend la place du prompt intégré.'} L&apos;entête (dossier, lot,
                              angle demandé) et les données jointes restent bâties par le moteur.
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {catalogue.length > 0 && (
            <div className="flex items-center gap-2 border-t border-gray-100 pt-2.5">
              <span className="mr-auto text-[10.5px] text-gray-400">
                Chiffré, versionné. Une case vide rend la tâche à son prompt intégré.
              </span>
              <button onClick={charger} disabled={loading || saving} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                Recharger
              </button>
              <button onClick={enregistrer} disabled={saving || !dirty} className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
