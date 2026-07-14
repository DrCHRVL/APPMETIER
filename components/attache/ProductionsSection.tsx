'use client';

/**
 * SIRAL — Attaché de justice · atelier des actes rédigés.
 *
 * Section du détail d'un dossier (admin only, auto-masquée) : la liste des
 * actes que l'attaché a rédigés (réquisitions, demandes de prolongation JLD,
 * saisines, projets de réponse — suivant les trames). Le magistrat :
 *  - les visionne et les édite légèrement à la main (textarea) puis enregistre ;
 *  - demande à l'IA de les retoucher via le chat flottant du dossier ;
 *  - les exporte (PDF / Word) et surtout les GLISSE directement vers son
 *    parapheur (portail de signature de l'État) grâce au drag « fichier ».
 *
 * Chiffrement E2E : l'app ne voit jamais le texte — le navigateur déchiffre
 * pour l'afficher et rechiffre lors d'une édition manuelle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileSignature, ChevronDown, ChevronUp, RefreshCw, Loader2, Save, Trash2,
  FileDown, FileText, MoveRight, Check,
} from 'lucide-react';

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
}

const TYPE_LABEL: Record<string, string> = {
  requisition: 'Réquisition',
  reponse_dml: 'Réponse DML',
  prolongation_jld: 'Prolongation JLD',
  saisine_jld: 'Saisine JLD',
  projet_reponse: 'Projet de réponse',
  soit_transmis: 'Soit-transmis',
  note: 'Note',
  autre: 'Acte',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function toHtmlDoc(titre: string, contenu: string): string {
  const paras = contenu.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<div style="font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;color:#000;">
    <h3 style="text-align:center;">${escapeHtml(titre)}</h3>${paras}</div>`;
}
function safeFile(s: string): string {
  return (s || 'acte').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'acte';
}

export function ProductionsSection({ numero }: { numero: string }) {
  const [available, setAvailable] = useState(false);
  const [items, setItems] = useState<Production[]>([]);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfUri, setPdfUri] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

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

  const save = useCallback(async (p: Production) => {
    setBusy(p.id);
    try {
      const contenu = draft[p.id] ?? p.contenu;
      const rec = { ...p, contenu, updatedAt: new Date().toISOString() };
      const envelope = await eapi().attache_encrypt(rec);
      const res = await fetch('/api/attache/productions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: p.numero, id: p.id, envelope }),
      });
      if (res.ok) {
        setItems((prev) => prev.map((x) => (x.id === p.id ? rec : x)));
        setPdfUri((m) => { const n = { ...m }; delete n[p.id]; return n; }); // invalide l'export
        setNotice('Enregistré.');
      } else {
        setNotice('Échec de l\'enregistrement.');
      }
    } finally {
      setBusy(null);
    }
  }, [draft]);

  const remove = useCallback(async (p: Production) => {
    if (!window.confirm(`Supprimer « ${p.titre} » ? (réversible)`)) return;
    await fetch('/api/attache/productions?numero=' + encodeURIComponent(p.numero) + '&id=' + encodeURIComponent(p.id), { method: 'DELETE' });
    setItems((prev) => prev.filter((x) => x.id !== p.id));
  }, []);

  // Génère un PDF (data-URI) pour l'export ET le glisser-déposer vers le parapheur.
  const genPdf = useCallback(async (p: Production): Promise<string | null> => {
    if (pdfUri[p.id]) return pdfUri[p.id];
    try {
      const html2pdf = (await import('html2pdf.js')).default as any;
      const el = document.createElement('div');
      el.style.padding = '24mm 20mm';
      el.innerHTML = toHtmlDoc(p.titre, draft[p.id] ?? p.contenu);
      const uri: string = await html2pdf().set({ margin: 0, filename: safeFile(p.titre) + '.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(el).outputPdf('datauristring');
      setPdfUri((m) => ({ ...m, [p.id]: uri }));
      return uri;
    } catch {
      return null;
    }
  }, [pdfUri, draft]);

  const downloadPdf = useCallback(async (p: Production) => {
    setBusy(p.id + ':pdf');
    try {
      const uri = await genPdf(p);
      if (!uri) { setNotice('Génération PDF impossible.'); return; }
      const a = document.createElement('a');
      a.href = uri; a.download = safeFile(p.titre) + '.pdf'; a.click();
    } finally { setBusy(null); }
  }, [genPdf]);

  const downloadDocx = useCallback(async (p: Production) => {
    setBusy(p.id + ':docx');
    try {
      const htmlDocx = (await import('html-docx-js/dist/html-docx')).default as any;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${toHtmlDoc(p.titre, draft[p.id] ?? p.contenu)}</body></html>`;
      const blob = htmlDocx.asBlob(html);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = safeFile(p.titre) + '.docx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally { setBusy(null); }
  }, [draft]);

  // Glisser vers le parapheur : on prépare le PDF puis on l'attache au drag
  // via DownloadURL (Chromium sait alors déposer un vrai fichier dans une
  // page/appli qui accepte les fichiers).
  const onDragStart = useCallback((e: React.DragEvent, p: Production) => {
    const uri = pdfUri[p.id];
    if (!uri) { e.preventDefault(); setNotice('Cliquez d\'abord « Préparer pour signature ».'); return; }
    e.dataTransfer.setData('DownloadURL', `application/pdf:${safeFile(p.titre)}.pdf:${uri}`);
    e.dataTransfer.setData('text/plain', p.titre);
    e.dataTransfer.effectAllowed = 'copy';
  }, [pdfUri]);

  if (!available) return null;

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        <FileSignature className="h-4 w-4 text-[#2B5746]" />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          Actes rédigés
          <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">Attaché · vous seul</span>
          {items.length > 0 && <span className="ml-2 text-[11px] font-normal text-gray-400">{items.length}</span>}
        </span>
        <button onClick={(e) => { e.stopPropagation(); load(); }} className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3">
          {notice && <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11.5px] text-emerald-800">{notice}</div>}
          {items.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-400">
              Aucun acte rédigé. Demandez-en un dans le chat du dossier (« rédige-moi une demande de prolongation JLD »).
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((p) => {
                const isOpen = expanded === p.id;
                return (
                  <div key={p.id} className="rounded-lg border border-gray-200">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">{TYPE_LABEL[p.type] || 'Acte'}</span>
                      <button onClick={() => setExpanded(isOpen ? null : p.id)} className="min-w-0 flex-1 truncate text-left text-[12.5px] font-semibold text-gray-800 hover:text-gray-900">
                        {p.titre}
                      </button>
                      <span className="hidden text-[10px] text-gray-400 sm:inline">{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('fr-FR') : ''}</span>
                      {/* Chip de glisser-vers-parapheur */}
                      <span
                        draggable={Boolean(pdfUri[p.id])}
                        onDragStart={(e) => onDragStart(e, p)}
                        title={pdfUri[p.id] ? 'Glisser vers le parapheur' : 'Préparer d\'abord pour signature'}
                        className={`inline-flex cursor-grab items-center gap-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold active:cursor-grabbing ${pdfUri[p.id] ? 'border-[#2B5746]/40 bg-emerald-50 text-[#2B5746]' : 'border-gray-200 text-gray-300'}`}
                      >
                        <MoveRight className="h-3 w-3" />parapheur
                      </span>
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
                          <button
                            onClick={async () => { setBusy(p.id + ':prep'); await genPdf(p); setBusy(null); setNotice('Prêt — glissez la puce « parapheur » vers le portail de signature.'); }}
                            disabled={busy === p.id + ':prep'}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2B5746]/30 px-2.5 py-1.5 text-[11px] font-semibold text-[#2B5746] hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {busy === p.id + ':prep' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pdfUri[p.id] ? <Check className="h-3.5 w-3.5" /> : <FileSignature className="h-3.5 w-3.5" />}
                            {pdfUri[p.id] ? 'Prêt à signer' : 'Préparer pour signature'}
                          </button>
                          <button onClick={() => downloadPdf(p)} disabled={busy === p.id + ':pdf'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                            <FileDown className="h-3.5 w-3.5" />PDF
                          </button>
                          <button onClick={() => downloadDocx(p)} disabled={busy === p.id + ':docx'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                            <FileText className="h-3.5 w-3.5" />Word
                          </button>
                          <button onClick={() => remove(p)} className="ml-auto rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {p.source && <div className="mt-1 text-[10px] text-gray-400">Trame : {p.source}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-center text-[10px] text-gray-400">
            « Préparer pour signature » génère le PDF ; glissez ensuite la puce « parapheur » vers votre portail de signature.
          </p>
        </div>
      )}
    </div>
  );
}
