'use client';

/**
 * SIRAL — Attaché de justice · PROMPT DE RÉDACTION DES DESCRIPTIONS.
 *
 * Section dédiée de Paramètres → Attaché IA : le prompt EXACT que reçoit
 * l'attaché quand on clique « Actualiser » sur la description d'un dossier.
 *  - le magistrat l'édite directement (zone de texte) ;
 *  - ou il demande une amélioration en une ligne (« ajoute les téléphones de
 *    chaque mis en cause ») : l'attaché rend le prompt réécrit, que le
 *    magistrat adopte ou écarte avant d'enregistrer.
 *
 * Même stockage que les « Consignes par domaine » (consignes.json, entrée
 * `description`, mode remplacement) : chiffré dans le navigateur, versionné.
 * Les données du dossier (CR, actes, sommaire des pièces) restent jointes
 * par le moteur, quel que soit le texte.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, RotateCcw, Send, Check, X } from 'lucide-react';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { siralBridge?: Record<string, AnyFn> }).siralBridge;

function bridgeFn(name: string): AnyFn {
  const fn = eapi()?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`fonction « ${name} » indisponible — rechargez l'application (Ctrl+Maj+R) après mise à jour`);
  }
  return fn;
}

const ID = 'description';
type Consigne = { mode: 'complement' | 'remplacement'; texte: string };

async function lireConsignes(): Promise<{ socle: string; consignes: Record<string, Consigne> }> {
  const res = await fetch('/api/attache/consignes');
  const data = await res.json().catch(() => ({})) as { catalogue?: Array<{ id: string; socle: string }>; envelope?: unknown };
  const socle = (data.catalogue || []).find((c) => c.id === ID)?.socle || '';
  let consignes: Record<string, Consigne> = {};
  if (data.envelope) {
    const payload = await bridgeFn('attache_decrypt')(data.envelope);
    const content = (payload as { content?: Record<string, Consigne> } | null)?.content;
    if (content && typeof content === 'object') consignes = content;
  }
  return { socle, consignes };
}

function texteEffectif(socle: string, c?: Consigne): string {
  if (!c || !c.texte?.trim()) return socle;
  if (c.mode === 'remplacement') return c.texte;
  return `${socle}\n\n${c.texte}`;
}

export function AttacheDescriptionPromptSection({ onNotice }: { onNotice?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [socle, setSocle] = useState('');
  const [texte, setTexte] = useState('');
  const [personnalise, setPersonnalise] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [demande, setDemande] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [proposition, setProposition] = useState<{ demande: string; texte: string } | null>(null);

  const notice = useCallback((m: string) => { if (onNotice) onNotice(m); }, [onNotice]);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const { socle: s, consignes } = await lireConsignes();
      setSocle(s);
      setTexte(texteEffectif(s, consignes[ID]));
      setPersonnalise(Boolean(consignes[ID]?.texte?.trim()));
      setDirty(false);
      if (!s) notice('Prompt intégré indisponible — le service attaché est injoignable.');
    } catch (e) {
      notice(`Lecture du prompt des descriptions impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [notice]);

  useEffect(() => { if (open && !socle && !loading) charger(); }, [open, socle, loading, charger]);

  const enregistrer = useCallback(async () => {
    setSaving(true);
    try {
      // Relecture juste avant l'écriture : on ne touche QU'À l'entrée
      // « description », les autres consignes par domaine sont préservées.
      const { socle: s, consignes } = await lireConsignes();
      const suivantes = { ...consignes };
      const propre = texte.trim();
      if (!propre || propre === (s || socle).trim()) delete suivantes[ID];
      else suivantes[ID] = { mode: 'remplacement', texte };
      const envelope = await bridgeFn('attache_encrypt')({ content: suivantes });
      const res = await fetch('/api/attache/consignes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope }),
      });
      if (res.ok) {
        setPersonnalise(Boolean(suivantes[ID]));
        setDirty(false);
        notice('Prompt des descriptions enregistré — il s\'applique à la prochaine actualisation.');
      } else {
        const data = await res.json().catch(() => ({}));
        notice(`Enregistrement refusé : ${data.error || res.status}`);
      }
    } catch (e) {
      notice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [texte, socle, notice]);

  const demander = useCallback(async () => {
    const d = demande.trim();
    if (!d || envoi) return;
    setEnvoi(true);
    try {
      const res = await fetch('/api/attache/consignes/ameliorer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ID, texte, demande: d }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; texte?: string; error?: string };
      if (res.ok && data.ok && data.texte) {
        setProposition({ demande: d, texte: data.texte });
        setDemande('');
      } else {
        notice(data.error || 'Amélioration impossible pour le moment');
      }
    } catch {
      notice('Service de l\'attaché indisponible');
    } finally {
      setEnvoi(false);
    }
  }, [demande, envoi, texte, notice]);

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <FileText className="h-4 w-4 text-[#2B5746]" />
        <span className="text-sm font-semibold text-gray-800">Rédaction des descriptions</span>
        <span className="text-[11px] text-gray-400">le prompt du bouton « Actualiser » de la description</span>
        {personnalise && (
          <span className="rounded-full bg-[#2B5746]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#2B5746]">personnalisé</span>
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
          Le texte exact que suit l&apos;attaché pour rédiger la description d&apos;un dossier. Tous les CR, les actes et le
          sommaire de toutes les pièces serveur lui sont joints automatiquement. Éditez-le, ou demandez une amélioration.
        </p>
      ) : (
        <div className="space-y-2.5 p-3">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Lecture du prompt…</p>
          ) : (
            <>
              {/* Ligne de chat : demander une amélioration du prompt */}
              <div className="flex items-center gap-1.5">
                <input
                  value={demande}
                  onChange={(e) => setDemande(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); demander(); } }}
                  disabled={envoi}
                  placeholder="Demander une amélioration — ex. « ajoute pour chaque mis en cause ses téléphones et véhicules »"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50 disabled:bg-gray-50"
                />
                <button
                  onClick={demander}
                  disabled={envoi || !demande.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  title="L'attaché réécrit le prompt selon votre demande ; vous adoptez ou écartez"
                >
                  {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {envoi ? 'Réécriture…' : 'Envoyer'}
                </button>
              </div>

              {proposition && (
                <div className="rounded-lg border border-[#2B5746]/35 bg-emerald-50/30">
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-gray-600">
                      Proposition pour : <span className="font-semibold text-gray-800">« {proposition.demande} »</span>
                    </span>
                    <button
                      onClick={() => { setTexte(proposition.texte); setDirty(true); setProposition(null); }}
                      className="inline-flex items-center gap-1 rounded border border-[#2B5746] bg-[#2B5746] px-1.5 py-0.5 text-[10.5px] font-semibold text-white"
                    >
                      <Check className="h-3 w-3" />Adopter
                    </button>
                    <button
                      onClick={() => setProposition(null)}
                      className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      <X className="h-3 w-3" />Écarter
                    </button>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-[#2B5746]/20 px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-gray-700">{proposition.texte}</pre>
                </div>
              )}

              {/* Édition directe */}
              <textarea
                value={texte}
                onChange={(e) => { setTexte(e.target.value); setDirty(true); }}
                rows={16}
                className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed outline-none focus:border-[#2B5746]/50"
              />
              <p className="text-[10px] text-gray-400">
                <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[9.5px]">{'{{dossier}}'}</code> est remplacé par le numéro du dossier.
                Conservez l&apos;appel à <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[9.5px]">actualiser_description</code> : c&apos;est lui qui écrit la description.
              </p>

              <div className="flex items-center gap-2 border-t border-gray-100 pt-2.5">
                <button
                  onClick={() => { setTexte(socle); setDirty(true); }}
                  disabled={!socle || texte === socle}
                  className="mr-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  title="Revenir au prompt intégré"
                >
                  <RotateCcw className="h-3 w-3" />Prompt intégré
                </button>
                <button onClick={charger} disabled={loading || saving} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                  Annuler
                </button>
                <button onClick={enregistrer} disabled={saving || !dirty || !texte.trim()} className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
