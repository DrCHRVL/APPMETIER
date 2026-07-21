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
 *    (récupérable via « voir les actes traités ») ;
 *  - ou les REFUSE (✗) en disant pourquoi — le motif nourrit l'apprentissage
 *    de l'attaché (il en tire une règle pour ne pas refaire l'erreur) ;
 *  - ou les fait RECOMMENCER de zéro, soit en relisant le mail d'origine,
 *    soit avec une nouvelle instruction.
 *
 * Chiffrement E2E : l'app ne voit jamais le texte — le navigateur déchiffre
 * pour l'afficher et rechiffre lors d'une édition manuelle.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  FileSignature, ChevronDown, ChevronUp, RefreshCw, Loader2, Save, Trash2,
  FileDown, FileText, CheckCircle2, Undo2, Wand2, XCircle, RotateCcw, Mail,
} from 'lucide-react';
import { downloadActePdf, downloadActeDocx, acteFileBase } from '@/lib/web/acteExport';
import { useToast } from '@/contexts/ToastContext';
import { useActeRunsStore, runKey, acteDoneToastMessage } from '@/stores/useActeRunsStore';

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
  /** Acte refusé par le magistrat (avec motif d'apprentissage) : sorti de la liste courante. */
  refuse?: boolean;
  refuseLe?: string;
  refuseMotif?: string;
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
  // Recommencer de zéro : nouvelle instruction libre par acte.
  const [redoInput, setRedoInput] = useState<Record<string, string>>({});
  // Un seul appel IA à la fois par acte (retouche OU recommencer).
  const [chatBusy, setChatBusy] = useState<{ id: string; kind: 'retouche' | 'redo-mail' | 'redo-instruction' } | null>(null);
  const [aiTools, setAiTools] = useState<string[]>([]);
  // Refus : acte dont la boîte « motif du refus » est ouverte + motif saisi.
  const [refusOpen, setRefusOpen] = useState<string | null>(null);
  const [refusMotif, setRefusMotif] = useState<Record<string, string>>({});
  // Runs IA DURABLES (retouche / recommencer) — persistés hors composant, ils
  // survivent à la fermeture de l'enquête et au rechargement. La notif
  // « en cours » et le toast de fin s'appuient dessus.
  const acteRuns = useActeRunsStore((s) => s.runs);
  const startRun = useActeRunsStore((s) => s.startRun);
  const finishRun = useActeRunsStore((s) => s.finishRun);
  const { showToast } = useToast();
  // Un acte est « en cours » s'il a un run persisté OU un flux ouvert ici.
  const isRunning = useCallback(
    (id: string) => Boolean(acteRuns[runKey(numero, id)]) || chatBusy?.id === id,
    [acteRuns, numero, chatBusy],
  );
  // Nature du run en cours (retouche / redo-*), qu'il soit persisté ou en flux.
  const runKindOf = useCallback(
    (id: string) => acteRuns[runKey(numero, id)]?.kind ?? (chatBusy?.id === id ? chatBusy.kind : undefined),
    [acteRuns, numero, chatBusy],
  );

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

  /**
   * Refuse l'acte : le magistrat dit POURQUOI (motif obligatoire). L'acte
   * quitte la liste courante (comme une validation), mais le motif nourrit
   * l'apprentissage de l'attaché — le service capte un signal fort à la
   * transition vers le refus (voir attache-service.mjs). Le contenu n'est PAS
   * réécrit : on ne veut pas déclencher, en plus, un signal « corrigé à la main ».
   */
  const refuser = useCallback(async (p: Production) => {
    const motif = (refusMotif[p.id] ?? '').trim();
    if (!motif) { setNotice('Indiquez le motif du refus — il sert à l\'apprentissage de l\'attaché.'); return; }
    setBusy(p.id + ':val');
    try {
      const rec = {
        ...p,
        contenu: p.contenu,
        refuse: true,
        refuseMotif: motif.slice(0, 2000),
        refuseLe: new Date().toISOString(),
        traite: false,
        traiteLe: undefined,
        updatedAt: new Date().toISOString(),
      };
      if (await persist(rec)) {
        setItems((prev) => prev.map((x) => (x.id === p.id ? rec : x)));
        setRefusOpen(null);
        setExpanded(null);
        setNotice(`« ${p.titre} » refusé — l'attaché en tirera la leçon. Retrouvez-le via « voir les actes traités ».`);
      } else {
        setNotice('Refus impossible (service injoignable ?).');
      }
    } finally {
      setBusy(null);
    }
  }, [refusMotif, persist]);

  /** Remet un acte traité ou refusé dans la liste courante. */
  const rouvrir = useCallback(async (p: Production) => {
    setBusy(p.id + ':val');
    try {
      const rec = { ...p, traite: false, traiteLe: undefined, refuse: false, refuseLe: undefined, refuseMotif: undefined, updatedAt: new Date().toISOString() };
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
   * Relaie un message à l'attaché sur le CANAL du chat du dossier (même
   * conversation, donc même contexte : le mail d'origine, la trame, la skill).
   * L'attaché ré-enregistre l'acte au MÊME id ; on recharge la liste ensuite.
   * Mutualisé par la retouche (« Demander à l'IA ») et par le recommencer.
   * Rend true si le run a abouti.
   */
  const runActeChat = useCallback(async (
    p: Production,
    message: string,
    kind: 'retouche' | 'redo-mail' | 'redo-instruction',
  ): Promise<boolean> => {
    setChatBusy({ id: p.id, kind });
    setAiTools([]);
    setNotice(null);
    // Marque le run comme DURABLE : la notif « en cours » et le toast de fin
    // survivront à la fermeture de l'enquête et au rechargement. On mémorise
    // l'updatedAt AVANT le run — le watcher détecte la fin quand il change.
    startRun({ numero: p.numero, prodId: p.id, titre: p.titre, kind, startedAt: Date.now(), prevUpdatedAt: p.updatedAt });
    const convKey = `attache_dossier_conv_${p.numero}`;
    let convId: string | null = null;
    try { convId = localStorage.getItem(convKey); } catch { /* */ }
    try {
      const res = await fetch('/api/attache/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, dossier: p.numero, convId: convId || undefined }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Service indisponible' }));
        finishRun(p.numero, p.id);
        setNotice(`Demande à l'IA impossible : ${err.error || res.status}`);
        return false;
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
      if (!ok) { finishRun(p.numero, p.id); setNotice(`Run interrompu : ${finalErr || 'run interrompu'}`); return false; }
      // Oublier le brouillon local (obsolète), puis recharger la version à jour.
      setDraft((d) => { const n = { ...d }; delete n[p.id]; return n; });
      await load();
      // Fin détectée ICI (le magistrat est resté) : on clôt le run et on émet
      // le toast tout de suite. S'il était parti, le flux ne revient pas et
      // c'est le watcher global qui détectera la fin et émettra le même toast.
      finishRun(p.numero, p.id);
      showToast(acteDoneToastMessage(p.numero, p.titre, kind), 'success');
      return true;
    } catch {
      // Connexion interrompue CÔTÉ CLIENT (navigation, réseau) : le run peut
      // très bien se terminer côté service. On NE clôt PAS le run — le watcher
      // global prendra le relais et signalera la fin.
      setNotice('Demande à l\'IA impossible — connexion interrompue.');
      return false;
    } finally {
      setChatBusy(null);
      setAiTools([]);
    }
  }, [load, startRun, finishRun, showToast]);

  /**
   * Retouche l'acte par l'IA, en place : consigne libre du magistrat, l'attaché
   * relit l'acte, applique la demande en conservant tout le reste, puis
   * ré-enregistre au même id. Un simple ajustement — PAS un nouveau jet.
   */
  const askAiRevise = useCallback(async (p: Production) => {
    const instruction = (aiInput[p.id] ?? '').trim();
    if (!instruction || chatBusy) return;
    const message = [
      `Retouche l'acte déjà rédigé « ${p.titre} » (id: ${p.id}) du dossier ${p.numero}, sans repartir de zéro.`,
      '',
      `Demande du magistrat : ${instruction}`,
      '',
      `Méthode : relis d'abord le texte EXACT de l'acte (production_lire numero="${p.numero}" id="${p.id}"). ` +
        `TRAME — si ma demande ci-dessus désigne une trame précise (« prends la trame X », « suis plutôt Y »), c'est CELLE-LÀ qui prime : retrouve-la (trames_lister pour son nom exact), lis-la (trame_lire), applique-la et renseigne « source » avec son nom.` +
        `${p.source ? ` À défaut de trame demandée, conforme-toi à la trame déjà suivie « ${p.source} » (trame_lire).` : ''} ` +
        `Charge aussi la skill de rédaction d'acte applicable (skill_lire) puis suis-la. ` +
        `Applique précisément la demande ci-dessus en conservant tout le reste de l'acte (structure, visas, motivation). ` +
        `Ré-enregistre ensuite l'acte avec produire_document en réutilisant le MÊME id ("${p.id}"). Termine par une phrase indiquant ce que tu as changé.`,
    ].join('\n');
    if (await runActeChat(p, message, 'retouche')) {
      setAiInput((m) => ({ ...m, [p.id]: '' }));
      setNotice(`« ${p.titre} » retouché par l'IA — relisez la nouvelle version.`);
    }
  }, [aiInput, chatBusy, runActeChat]);

  /**
   * Recommence l'acte de ZÉRO (nouveau jet, pas une retouche). Deux entrées :
   *  - mode « mail » : l'attaché relit le mail / la consigne d'origine et
   *    réécrit l'acte entièrement (« recommencer en relisant le mail ») ;
   *  - mode « instruction » : le magistrat donne une nouvelle consigne globale.
   * Si l'acte avait été REFUSÉ, on rappelle le motif pour que l'attaché corrige
   * précisément le défaut. Il réécrit au même id ; côté service, un nouveau
   * contenu lève automatiquement le refus (l'acte repart « en attente »).
   */
  const recommencer = useCallback(async (p: Production, mode: 'mail' | 'instruction') => {
    if (chatBusy) return;
    const instruction = mode === 'instruction' ? (redoInput[p.id] ?? '').trim() : '';
    if (mode === 'instruction' && !instruction) return;
    const motifRefus = p.refuse && p.refuseMotif ? String(p.refuseMotif).trim() : '';
    const lignes = [
      `Recommence ENTIÈREMENT l'acte « ${p.titre} » (id: ${p.id}) du dossier ${p.numero} — repars de zéro, ne te contente pas de retoucher la version actuelle.`,
      '',
    ];
    if (motifRefus) {
      lignes.push(`La version précédente a été REFUSÉE par le magistrat pour ce motif : ${motifRefus}. Corrige précisément ce défaut.`, '');
    }
    if (mode === 'instruction') {
      lignes.push(`Nouvelle instruction du magistrat : ${instruction}`, '');
    } else {
      lignes.push(
        `Point de départ : RELIS le mail (ou la consigne) qui a donné lieu à cet acte dans notre conversation ; ` +
          `si tu ne le retrouves pas dans le fil, cherche-le dans la boîte (boite_lister puis boite_lire). ` +
          `Repars de la demande d'origine, telle qu'elle a été formulée.`,
        '',
      );
    }
    lignes.push(
      `Méthode de rédaction : relis le texte actuel (production_lire numero="${p.numero}" id="${p.id}"). ` +
        `TRAME — si ma consigne désigne une trame précise (« prends la trame X », « change de trame pour Y »), c'est CELLE-LÀ que tu appliques : retrouve-la (trames_lister), lis-la (trame_lire), renseigne « source » avec son nom exact ; ne conserve PAS l'ancienne trame contre ma demande.` +
        `${p.source ? ` À défaut de trame demandée, conserve la trame « ${p.source} » (trame_lire).` : ''} ` +
        `Charge la skill de rédaction d'acte applicable (skill_lire) puis suis-la. ` +
        `Rédige un acte NEUF, complet et densément motivé, sans reprendre les défauts du jet précédent. ` +
        `Ré-enregistre-le avec produire_document en réutilisant le MÊME id ("${p.id}"). Termine par une phrase indiquant ce qui a changé par rapport au jet précédent.`,
    );
    if (await runActeChat(p, lignes.join('\n'), mode === 'mail' ? 'redo-mail' : 'redo-instruction')) {
      if (mode === 'instruction') setRedoInput((m) => ({ ...m, [p.id]: '' }));
      setNotice(`« ${p.titre} » recommencé par l'IA — relisez la nouvelle version.`);
    }
  }, [chatBusy, redoInput, runActeChat]);

  if (!available) return null;
  if (masquerSiVide && items.length === 0) return null;

  // « traités » au sens large = ayant reçu une décision (validé OU refusé) :
  // les deux quittent la liste courante et se retrouvent dans l'archive.
  const enAttente = items.filter((p) => !p.traite && !p.refuse);
  const traites = items.filter((p) => p.traite || p.refuse);
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
                  <div key={p.id} className={`rounded-lg border ${p.refuse ? 'border-amber-200 bg-amber-50/40' : p.traite ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">{TYPE_LABEL[p.type] || 'Acte'}</span>
                      {p.refuse && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-700">Refusé</span>}
                      {p.traite && !p.refuse && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#2B5746]">Validé</span>}
                      {/* Indicateur DURABLE « modification en cours » : reste visible même acte replié et après rechargement, jusqu'à ce que le watcher détecte la fin. */}
                      {isRunning(p.id) && (
                        <span className="inline-flex items-center gap-1 rounded bg-[#2B5746]/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[#2B5746]" title="L'IA retouche cet acte — le travail continue en arrière-plan, vous serez prévenu à la fin.">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />En cours
                        </span>
                      )}
                      <button onClick={() => setExpanded(isOpen ? null : p.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-gray-800 hover:text-gray-900">
                        {p.titre}
                      </button>
                      <span className="hidden text-[10px] text-gray-400 sm:inline">{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('fr-FR') : ''}</span>
                      {(p.traite || p.refuse) ? (
                        <button
                          onClick={() => rouvrir(p)}
                          disabled={busy === p.id + ':val'}
                          title={p.refuse
                            ? `Refusé le ${p.refuseLe ? new Date(p.refuseLe).toLocaleDateString('fr-FR') : '?'} — cliquer pour le remettre en attente`
                            : `Validé le ${p.traiteLe ? new Date(p.traiteLe).toLocaleDateString('fr-FR') : '?'} — cliquer pour le remettre en attente`}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-1 text-[10px] font-semibold text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                        >
                          <Undo2 className="h-3 w-3" />rouvrir
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => valider(p)}
                            disabled={busy === p.id + ':val'}
                            title="Valider l'acte : considéré traité, il n'apparaît plus dans cette liste"
                            className="inline-flex items-center gap-1 rounded-md border border-[#2B5746]/40 bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold text-[#2B5746] hover:bg-emerald-100"
                          >
                            {busy === p.id + ':val' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}Valider
                          </button>
                          <button
                            onClick={() => { setExpanded(p.id); setRefusOpen(p.id); }}
                            disabled={busy === p.id + ':val'}
                            title="Refuser l'acte en expliquant pourquoi — le motif nourrit l'apprentissage de l'attaché"
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                          >
                            <XCircle className="h-3 w-3" />Refus
                          </button>
                        </>
                      )}
                      <button onClick={() => setExpanded(isOpen ? null : p.id)} className="rounded p-1 text-gray-400 hover:bg-gray-50">
                        {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {isOpen && (
                      <div className="border-t border-gray-100 p-2.5">
                        {p.refuse && p.refuseMotif && (
                          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[11px] text-amber-800">
                            <b>Refusé{p.refuseLe ? ` le ${new Date(p.refuseLe).toLocaleDateString('fr-FR')}` : ''}</b> — {p.refuseMotif}
                          </div>
                        )}
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

                        {/* Refus motivé — alternative à la validation, pour l'apprentissage */}
                        {!p.traite && !p.refuse && refusOpen === p.id && (
                          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50/60 p-2">
                            <label className="mb-1 block text-[10.5px] font-semibold text-amber-800">
                              Motif du refus — dites pourquoi cet acte ne convient pas. L'attaché l'étudiera pour ne pas refaire l'erreur.
                            </label>
                            <textarea
                              value={refusMotif[p.id] ?? ''}
                              onChange={(e) => setRefusMotif((m) => ({ ...m, [p.id]: e.target.value }))}
                              rows={2}
                              placeholder="Ex. « motivation trop légère sur la nécessité », « mauvaise trame », « visa 230-33 manquant », « ne répond pas à la demande du mail »…"
                              className="w-full resize-y rounded-md border border-amber-200 bg-white px-2 py-1.5 text-[11.5px] leading-relaxed text-gray-800 outline-none focus:border-amber-400"
                            />
                            <div className="mt-1.5 flex items-center gap-2">
                              <button
                                onClick={() => refuser(p)}
                                disabled={busy === p.id + ':val' || !(refusMotif[p.id] ?? '').trim()}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
                              >
                                {busy === p.id + ':val' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}Confirmer le refus
                              </button>
                              <button onClick={() => setRefusOpen(null)} className="text-[11px] font-medium text-gray-400 hover:text-gray-600">Annuler</button>
                              <span className="ml-auto hidden text-[10px] text-amber-700/70 sm:inline">Après un refus, « Recommencer » ci-dessous.</span>
                            </div>
                          </div>
                        )}

                        {/* Retouche IA en place — « là je veux plus comme ça » */}
                        <div className="mt-2 rounded-lg border border-[#2B5746]/20 bg-emerald-50/30 p-2">
                          <div className="flex items-end gap-1.5">
                            <textarea
                              value={aiInput[p.id] ?? ''}
                              onChange={(e) => setAiInput((m) => ({ ...m, [p.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAiRevise(p); } }}
                              disabled={isRunning(p.id)}
                              rows={1}
                              placeholder="Retoucher sur place : « motive davantage la nécessité », « ajoute le visa 706-96 », « allège le rappel des faits »…"
                              className="max-h-28 flex-1 resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11.5px] leading-relaxed text-gray-800 outline-none focus:border-[#2B5746]/40 disabled:opacity-60"
                            />
                            <button
                              onClick={() => askAiRevise(p)}
                              disabled={isRunning(p.id) || !(aiInput[p.id] ?? '').trim()}
                              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                              title="L'attaché relit l'acte, applique votre demande en suivant la trame et la skill, puis réécrit l'acte — retouche ciblée, sans repartir de zéro"
                            >
                              {runKindOf(p.id) === 'retouche' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}Demander à l'IA
                            </button>
                          </div>
                        </div>

                        {/* Recommencer de zéro — relire le mail, ou nouvelle instruction */}
                        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/40 p-2">
                          <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold text-sky-800">
                            <RotateCcw className="h-3 w-3" />Recommencer de zéro
                          </div>
                          <div className="flex flex-wrap items-end gap-1.5">
                            <button
                              onClick={() => recommencer(p, 'mail')}
                              disabled={isRunning(p.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-40"
                              title="L'attaché relit le mail (ou la consigne) d'origine et réécrit l'acte entièrement"
                            >
                              {runKindOf(p.id) === 'redo-mail' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}En relisant le mail
                            </button>
                          </div>
                          <div className="mt-1.5 flex items-end gap-1.5">
                            <textarea
                              value={redoInput[p.id] ?? ''}
                              onChange={(e) => setRedoInput((m) => ({ ...m, [p.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); recommencer(p, 'instruction'); } }}
                              disabled={isRunning(p.id)}
                              rows={1}
                              placeholder="…ou avec une nouvelle instruction : « pars plutôt sur le fondement 230-33 », « change de trame », « reprends tout, le plan ne va pas »…"
                              className="max-h-28 flex-1 resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11.5px] leading-relaxed text-gray-800 outline-none focus:border-sky-400 disabled:opacity-60"
                            />
                            <button
                              onClick={() => recommencer(p, 'instruction')}
                              disabled={isRunning(p.id) || !(redoInput[p.id] ?? '').trim()}
                              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-sky-700 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                              title="L'attaché repart de zéro en suivant votre nouvelle instruction"
                            >
                              {runKindOf(p.id) === 'redo-instruction' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Recommencer
                            </button>
                          </div>
                        </div>

                        {isRunning(p.id) && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[#2B5746]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>{runKindOf(p.id) === 'retouche' ? 'Retouche' : 'Nouvelle rédaction'} en cours — le travail continue en arrière-plan même si vous quittez l'enquête ; vous serez prévenu à la fin.</span>
                            {aiTools.length > 0 && <span className="text-gray-400">{aiTools.join(' · ')}</span>}
                          </div>
                        )}

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
