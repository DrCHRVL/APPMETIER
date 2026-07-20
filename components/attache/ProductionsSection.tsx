'use client';

/**
 * SIRAL — Attaché de justice · atelier des actes rédigés.
 *
 * Section du détail d'un dossier (admin only, auto-masquée) : la liste des
 * actes que l'attaché a rédigés (réquisitions, demandes de prolongation JLD,
 * saisines, projets de réponse — suivant les trames). Le magistrat :
 *  - les visionne et les édite légèrement à la main (textarea) puis enregistre ;
 *  - demande à l'IA de les retoucher SUR PLACE (mini-zone « Demander à l'IA »)
 *    ou via le chat flottant du dossier ;
 *  - les exporte en PDF / Word — mise en forme de la trame suivie, sans
 *    habillage imposé, nom de fichier au formalisme de la trame ;
 *  - les VALIDE (✓) une fois traités : l'acte quitte la liste courante
 *    (récupérable via « voir les actes traités »).
 *
 * Chiffrement E2E : l'app ne voit jamais le texte — le navigateur déchiffre
 * pour l'afficher et rechiffre lors d'une édition manuelle.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FileSignature, ChevronDown, ChevronUp, RefreshCw, Loader2, Save, Trash2,
  FileDown, FileText, CheckCircle2, Undo2, Wand2,
} from 'lucide-react';
import { downloadActePdf, downloadActeDocx, acteFileBase } from '@/lib/web/acteExport';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface Production {
  id: string;
  numero: string;
  type: string;
  titre: string;
  contenu: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  /** Acte validé par le magistrat : sorti de la liste courante. */
  traite?: boolean;
  traiteLe?: string;
}

const TYPE_LABEL: Record<string, string> = {
  requisition: 'Réquisition',
  reponse_dml: 'Réponse DML',
  prolongation_jld: 'Prolongation JLD',
  saisine_jld: 'Saisine JLD',
  projet_reponse: 'Projet de réponse',
  soit_transmis: 'Soit-transmis',
  note: 'Note',
  livrable: 'Livrable',
  autre: 'Acte',
};

export function ProductionsSection({ numero, titre, masquerSiVide }: {
  numero: string;
  /** Titre de la section (défaut : « Actes rédigés »). */
  titre?: string;
  /** Ne rien afficher tant qu'aucun acte n'existe (usage tableau de bord). */
  masquerSiVide?: boolean;
}) {
  const [available, setAvailable] = useState(false);
  const [items, setItems] = useState<Production[]>([]);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTraites, setShowTraites] = useState(false);
  // Retouche IA en place : consigne libre par acte + acte en cours de retouche.
  const [aiInput, setAiInput] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiTools, setAiTools] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/productions?numero=' + encodeURIComponent(numero));
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      const { productions } = await res.json();
      const out: Production[] = [];
      for (const p of (productions || []) as Array<{ id: string; envelope: unknown }>) {
        const rec = await eapi().attache_decrypt(p.envelope);
        if (rec) out.push(rec as Production);
      }
      out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      setItems(out);
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [numero]);

  useEffect(() => { load(); }, [load]);

  /** Rechiffre et PUT une version modifiée de l'acte (édition, validation…). */
  const persist = useCallback(async (rec: Production): Promise<boolean> => {
    try {
      const envelope = await eapi().attache_encrypt(rec);
      const res = await fetch('/api/attache/productions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: rec.numero, id: rec.id, envelope }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const save = useCallback(async (p: Production) => {
    setBusy(p.id);
    try {
      const contenu = draft[p.id] ?? p.contenu;
      const rec = { ...p, contenu, updatedAt: new Date().toISOString() };
      if (await persist(rec)) {
        setItems((prev) => prev.map((x) => (x.id === p.id ? rec : x)));
        setNotice('Enregistré — l\'attaché étudiera votre correction pour ne pas refaire l\'erreur.');
      } else {
        setNotice('Échec de l\'enregistrement.');
      }
    } finally {
      setBusy(null);
    }
  }, [draft, persist]);

  /** Valide l'acte : considéré traité, il quitte la liste courante. */
  const valider = useCallback(async (p: Production) => {
    setBusy(p.id + ':val');
    try {
      const rec = { ...p, contenu: draft[p.id] ?? p.contenu, traite: true, traiteLe: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (await persist(rec)) {
        setItems((prev) => prev.map((x) => (x.id === p.id ? rec : x)));
        setExpanded(null);
        setNotice(`« ${p.titre} » validé — retrouvez-le via « voir les actes traités ».`);
      } else {
        setNotice('Validation impossible (service injoignable ?).');
      }
    } finally {
      setBusy(null);
    }
  }, [draft, persist]);

  /** Remet un acte traité dans la liste courante. */
  const rouvrir = useCallback(async (p: Production) => {
    setBusy(p.id + ':val');
    try {
      const rec = { ...p, traite: false, traiteLe: undefined, updatedAt: new Date().toISOString() };
      if (await persist(rec)) {
        setItems((prev) => prev.map((x) => (x.id === p.id ? rec : x)));
        setNotice(`« ${p.titre} » remis dans les actes en attente.`);
      }
    } finally {
      setBusy(null);
    }
  }, [persist]);

  const remove = useCallback(async (p: Production) => {
    if (!window.confirm(`Supprimer « ${p.titre} » ? (réversible)`)) return;
    try {
      const res = await fetch('/api/attache/productions?numero=' + encodeURIComponent(p.numero) + '&id=' + encodeURIComponent(p.id), { method: 'DELETE' });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (!res.ok || data.ok === false) {
        setNotice(`Suppression refusée : ${data.error || res.status}`);
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      setNotice('Suppression impossible — réessayez.');
    }
  }, []);

  const downloadPdf = useCallback(async (p: Production) => {
    setBusy(p.id + ':pdf');
    try {
      await downloadActePdf({ ...p, contenu: draft[p.id] ?? p.contenu });
    } catch {
      setNotice('Génération PDF impossible.');
    } finally { setBusy(null); }
  }, [draft]);

  const downloadDocx = useCallback(async (p: Production) => {
    setBusy(p.id + ':docx');
    try {
      await downloadActeDocx({ ...p, contenu: draft[p.id] ?? p.contenu });
    } catch {
      setNotice('Génération Word impossible.');
    } finally { setBusy(null); }
  }, [draft]);

  /**
   * Retouche l'acte par l'IA, en place : on relaie la consigne libre du
   * magistrat à l'attaché (même canal que le chat du dossier), en lui donnant
   * l'id de l'acte à réécrire. L'attaché relit l'acte, applique la demande en
   * suivant la trame et la skill, puis ré-enregistre au même id ; on recharge
   * la liste pour afficher la nouvelle version.
   */
  const askAiRevise = useCallback(async (p: Production) => {
    const instruction = (aiInput[p.id] ?? '').trim();
    if (!instruction || aiBusy) return;
    setAiBusy(p.id);
    setAiTools([]);
    setNotice(null);
    const convKey = `attache_dossier_conv_${p.numero}`;
    let convId: string | null = null;
    try { convId = localStorage.getItem(convKey); } catch { /* */ }
    const message = [
      `Retouche l'acte déjà rédigé « ${p.titre} » (id: ${p.id}) du dossier ${p.numero}, sans repartir de zéro.`,
      '',
      `Demande du magistrat : ${instruction}`,
      '',
      `Méthode : relis d'abord le texte EXACT de l'acte (production_lire numero="${p.numero}" id="${p.id}")` +
        `${p.source ? `, relis la trame « ${p.source} » (trame_lire)` : ''}, et charge la skill de rédaction d'acte applicable (skill_lire) puis suis-la. ` +
        `Applique précisément la demande ci-dessus en conservant tout le reste de l'acte (structure, visas, motivation). ` +
        `Ré-enregistre ensuite l'acte avec produire_document en réutilisant le MÊME id ("${p.id}"). Termine par une phrase indiquant ce que tu as changé.`,
    ].join('\n');
    try {
      const res = await fetch('/api/attache/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, dossier: p.numero, convId: convId || undefined }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Service indisponible' }));
        setNotice(`Retouche impossible : ${err.error || res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let finalConv: string | null = null;
      let finalErr: string | undefined;
      let ok = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const dataLine = buf.slice(0, idx).split('\n').find((l) => l.startsWith('data: '));
          buf = buf.slice(idx + 2);
          if (!dataLine) continue;
          let ev: { type?: string; name?: string; convId?: string; ok?: boolean; error?: string };
          try { ev = JSON.parse(dataLine.slice(6)); } catch { continue; }
          if (ev.type === 'tool' && ev.name) {
            setAiTools((t) => (t.length > 8 ? t : [...t, String(ev.name).replace(/^mcp__siral__/, '')]));
          } else if (ev.type === 'final') {
            finalConv = ev.convId || null; finalErr = ev.error; ok = ev.ok !== false;
          }
        }
      }
      if (finalConv) { try { localStorage.setItem(convKey, finalConv); } catch { /* */ } }
      if (!ok) { setNotice(`Retouche interrompue : ${finalErr || 'run interrompu'}`); return; }
      // Vider la consigne et le brouillon local, puis recharger la version à jour.
      setAiInput((m) => ({ ...m, [p.id]: '' }));
      setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; });
      await load();
      setNotice(`« ${p.titre} » retouché par l'IA — relisez la nouvelle version.`);
    } catch {
      setNotice('Retouche impossible — connexion interrompue.');
    } finally {
      setAiBusy(null);
      setAiTools([]);
    }
  }, [aiInput, aiBusy, load]);

  if (!available) return null;
  if (masquerSiVide && items.length === 0) return null;

  const enAttente = items.filter((p) => !p.traite);
  const traites = items.filter((p) => p.traite);
  const visibles = showTraites ? traites : enAttente;

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <FileSignature className="h-4 w-4 text-[#2B5746]" />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          {titre || 'Actes rédigés'}
          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">Attaché</span>
          {enAttente.length > 0 && <span className="ml-2 text-[11px] font-normal text-gray-400">{enAttente.length}</span>}
        </span>
        <button onClick={(e) => { e.stopPropagation(); load(); }} className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          {notice && <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11.5px] text-emerald-800">{notice}</div>}
          {visibles.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-400">
              {showTraites
                ? 'Aucun acte traité pour l\'instant.'
                : traites.length
                  ? 'Tous les actes de ce dossier sont traités.'
                  : 'Aucun acte rédigé. Demandez-en un dans le chat du dossier (« rédige-moi une demande de prolongation JLD »).'}
            </p>
          ) : (
            <div className="space-y-2">
              {visibles.map((p) => {
                const isOpen = expanded === p.id;
                return (
                  <div key={p.id} className={`rounded-lg border ${p.traite ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">{TYPE_LABEL[p.type] || 'Acte'}</span>
                      <button onClick={() => setExpanded(isOpen ? null : p.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-gray-800 hover:text-gray-900">
                        {p.titre}
                      </button>
                      <span className="hidden text-[10px] text-gray-400 sm:inline">{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('fr-FR') : ''}</span>
                      {p.traite ? (
                        <button
                          onClick={() => rouvrir(p)}
                          disabled={busy === p.id + ':val'}
                          title={`Traité le ${p.traiteLe ? new Date(p.traiteLe).toLocaleDateString('fr-FR') : '?'} — cliquer pour le remettre en attente`}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-1 text-[10px] font-semibold text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                        >
                          <Undo2 className="h-3 w-3" />rouvrir
                        </button>
                      ) : (
                        <button
                          onClick={() => valider(p)}
                          disabled={busy === p.id + ':val'}
                          title="Valider l'acte : considéré traité, il n'apparaît plus dans cette liste"
                          className="inline-flex items-center gap-1 rounded-md border border-[#2B5746]/40 bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold text-[#2B5746] hover:bg-emerald-100"
                        >
                          {busy === p.id + ':val' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}Valider
                        </button>
                      )}
                      <button onClick={() => setExpanded(isOpen ? null : p.id)} className="rounded p-1 text-gray-400 hover:bg-gray-50">
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {isOpen && (
                      <div className="border-t border-gray-100 p-2.5">
                        <textarea
                          value={draft[p.id] ?? p.contenu}
                          onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                          rows={12}
                          className="w-full resize-y rounded-lg border border-gray-200 p-2.5 font-serif text-[12.5px] leading-relaxed text-gray-800 outline-none focus:border-[#2B5746]/40"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => save(p)}
                            disabled={busy === p.id || (draft[p.id] ?? p.contenu) === p.contenu}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                          >
                            {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Enregistrer
                          </button>
                          <button onClick={() => downloadPdf(p)} disabled={busy === p.id + ':pdf'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50" title={`Télécharge « ${acteFileBase(p)}.pdf » — mise en forme de la trame suivie`}>
                            {busy === p.id + ':pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}PDF
                          </button>
                          <button onClick={() => downloadDocx(p)} disabled={busy === p.id + ':docx'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50" title={`Télécharge « ${acteFileBase(p)}.docx » — mise en forme de la trame suivie`}>
                            {busy === p.id + ':docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Word
                          </button>
                          <button onClick={() => remove(p)} className="ml-auto rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Retouche IA en place — « là je veux plus comme ça » */}
                        <div className="mt-2 rounded-lg border border-[#2B5746]/20 bg-emerald-50/30 p-2">
                          <div className="flex items-end gap-1.5">
                            <textarea
                              value={aiInput[p.id] ?? ''}
                              onChange={(e) => setAiInput((m) => ({ ...m, [p.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAiRevise(p); } }}
                              disabled={aiBusy === p.id}
                              rows={1}
                              placeholder="Dire à l'IA comment retoucher : « motive davantage la nécessité », « ajoute le visa 706-96 », « allège le rappel des faits »…"
                              className="max-h-28 flex-1 resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11.5px] leading-relaxed text-gray-800 outline-none focus:border-[#2B5746]/40 disabled:opacity-60"
                            />
                            <button
                              onClick={() => askAiRevise(p)}
                              disabled={aiBusy === p.id || !(aiInput[p.id] ?? '').trim()}
                              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                              title="L'attaché relit l'acte, applique votre demande en suivant la trame et la skill, puis réécrit l'acte"
                            >
                              {aiBusy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}Demander à l'IA
                            </button>
                          </div>
                          {aiBusy === p.id && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#2B5746]">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Retouche en cours — l'acte se rechargera à la fin.</span>
                              {aiTools.length > 0 && <span className="text-gray-400">{aiTools.join(' · ')}</span>}
                            </div>
                          )}
                        </div>

                        {p.source && <div className="mt-1 text-[10px] text-gray-400">Trame : {p.source} — fichier : {acteFileBase(p)}.pdf</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {(traites.length > 0 || showTraites) && (
            <button
              onClick={() => setShowTraites((v) => !v)}
              className="mt-2 w-full text-center text-[10.5px] font-medium text-gray-400 hover:text-gray-600"
            >
              {showTraites ? '← Revenir aux actes en attente' : `Voir les ${traites.length} acte(s) traité(s)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
