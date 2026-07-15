'use client';

/**
 * SIRAL — module instruction · « Dossier complet ».
 *
 * Le magistrat verse ici une grande partie (ou la totalité) du dossier :
 * une ARBORESCENCE entière (sélection d'un dossier ou glisser-déposer,
 * sous-pochettes comprises — l'organisation d'origine est préservée).
 * Chaque pièce est convertie en MARKDOWN dans le navigateur au passage
 * (fileToMarkdown) puis chiffrée : ici on ne conserve QUE le texte — les
 * originaux signés vivent ailleurs (Archive DML, zones documents). Place
 * serveur et tokens réduits d'autant ; l'assistant lit tout, pochette par
 * pochette.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, FolderTree, UploadCloud, Trash2, Eye, Loader2, ChevronRight, ChevronDown, FileText, X } from 'lucide-react';
import { fileToMarkdown } from '@/lib/web/fileToMarkdown';
import { collectDropEntries, incomingFromFileList, type Incoming } from '@/lib/web/folderUpload';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

const ROOT = 'Dossier/';
const MAX_FILES = 500;
// formats sans texte : inutile d'essayer la conversion, on les signale
const SKIP_RE = /\.(png|jpe?g|gif|bmp|tiff?|heic|mp3|wav|m4a|ogg|mp4|avi|mov|mkv|zip|rar|7z|exe|dll)$/i;

interface DocRow { rel: string; size: number; savedAt?: string; originalName?: string }
interface TreeNode { folders: Map<string, TreeNode>; files: DocRow[] }

export function DossierCompletSection({ numero }: { numero: string }) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ ok: number; ignores: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ rel: string; texte: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await eapi().listServerDocuments(numero) as DocRow[];
      setDocs((all || []).filter((d) => d.rel.startsWith(ROOT)).sort((a, b) => a.rel.localeCompare(b.rel)));
    } catch { /* silencieux */ }
  }, [numero]);

  useEffect(() => { refresh(); }, [refresh]);

  const verser = useCallback(async (incoming: Incoming[]) => {
    const list = incoming.slice(0, MAX_FILES);
    if (!list.length) return;
    setReport(null);
    setProgress({ done: 0, total: list.length });
    const ignores: string[] = [];
    let ok = 0;
    for (const { file, path } of list) {
      try {
        if (SKIP_RE.test(file.name)) throw new Error('pas de texte à extraire (image/média/archive)');
        const { markdown, avertissement } = await fileToMarkdown(file);
        if (!markdown.trim()) throw new Error(avertissement || 'aucun texte extractible');
        const rel = ROOT + path.replace(/\.[^./]+$/, '') + '.md';
        const bytes = new TextEncoder().encode(markdown);
        await eapi().depositDocument(numero, rel, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'Dossier', file.name);
        ok++;
        if (avertissement) ignores.push(`${path} — ⚠ ${avertissement}`);
      } catch (e) {
        ignores.push(`${path} — ${e instanceof Error ? e.message : String(e)}`);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    if (incoming.length > MAX_FILES) ignores.push(`${incoming.length - MAX_FILES} fichier(s) au-delà de la limite de ${MAX_FILES} par versement`);
    setProgress(null);
    setReport({ ok, ignores });
    refresh();
  }, [numero, refresh]);

  const onPickFolder = useCallback((files: FileList | null) => {
    verser(incomingFromFileList(files));
  }, [verser]);

  const supprimer = useCallback(async (rels: string[], label: string) => {
    if (!window.confirm(`Supprimer ${label} (${rels.length} pièce(s) texte) ?\nLes originaux, conservés ailleurs, ne sont pas concernés.`)) return;
    for (const rel of rels) await eapi().deleteDocument(numero, rel).catch(() => {});
    refresh();
  }, [numero, refresh]);

  const ouvrir = useCallback(async (rel: string) => {
    try {
      const b64 = await eapi().readDocumentData(numero, rel) as string | null;
      if (!b64) return;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      setPreview({ rel, texte: new TextDecoder().decode(bytes).slice(0, 200_000) });
    } catch { /* silencieux */ }
  }, [numero]);

  // Arbre replié depuis les chemins (Dossier/A/B/x.md)
  const tree = useMemo(() => {
    const root: TreeNode = { folders: new Map(), files: [] };
    for (const d of docs) {
      const segs = d.rel.slice(ROOT.length).split('/');
      let node = root;
      for (const seg of segs.slice(0, -1)) {
        if (!node.folders.has(seg)) node.folders.set(seg, { folders: new Map(), files: [] });
        node = node.folders.get(seg)!;
      }
      node.files.push(d);
    }
    return root;
  }, [docs]);

  const renderNode = (node: TreeNode, prefix: string, depth: number): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    for (const [name, child] of [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const key = prefix + name + '/';
      const isCollapsed = collapsed.has(key);
      const count = countFiles(child);
      rows.push(
        <div key={key} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 16 }}>
          <button onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {isCollapsed ? <ChevronRight className="h-3 w-3 flex-shrink-0 text-gray-400" /> : <ChevronDown className="h-3 w-3 flex-shrink-0 text-gray-400" />}
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
            <span className="truncate text-xs font-medium text-gray-700">{name}</span>
            <span className="text-[10px] text-gray-400">({count})</span>
          </button>
          <button onClick={() => supprimer(collectRels(child, ROOT + key.slice(0)), `la pochette « ${name} »`)}
            title="Supprimer la pochette" className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      );
      if (!isCollapsed) rows.push(...renderNode(child, key, depth + 1));
    }
    for (const f of node.files) {
      rows.push(
        <div key={f.rel} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 16 + 16 }}>
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
          <span className="min-w-0 flex-1 truncate text-xs text-gray-700" title={f.originalName || f.rel}>{f.rel.split('/').pop()}</span>
          <span className="text-[10px] text-gray-400">{Math.max(1, Math.round(f.size / 1024))} Ko</span>
          <button onClick={() => ouvrir(f.rel)} title="Lire" className="rounded p-0.5 text-gray-300 hover:bg-indigo-50 hover:text-indigo-600">
            <Eye className="h-3 w-3" />
          </button>
          <button onClick={() => supprimer([f.rel], `« ${f.rel.split('/').pop()} »`)} title="Supprimer" className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      );
    }
    return rows;
  };

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
        <FolderTree className="h-4 w-4 text-indigo-600" />
        Dossier complet
        <span className="text-[11px] font-normal text-gray-400">versez le dossier entier, sous-pochettes comprises — converti en texte au passage</span>
      </h3>

      <label
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault(); setDragOver(false);
          const incoming = await collectDropEntries(e.dataTransfer.items);
          if (incoming.length) verser(incoming);
          else if (e.dataTransfer.files?.length) onPickFolder(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-3 text-xs transition-all
          ${dragOver ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:bg-gray-50'}
          ${progress ? 'pointer-events-none opacity-60' : ''}`}
      >
        {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {progress
          ? `Conversion et versement… ${progress.done}/${progress.total}`
          : 'Glissez un dossier entier (ou cliquez pour le choisir) — PDF, ODT, DOCX, TXT… convertis en markdown, arborescence préservée'}
        <input type="file" multiple className="hidden" {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => { onPickFolder(e.target.files); e.currentTarget.value = ''; }} />
      </label>
      <p className="mt-1 text-[10.5px] text-gray-400">
        Seul le TEXTE est conservé ici (pas les originaux — gardez les pièces signées dans l&apos;Archive DML ou les zones documents).
      </p>

      {report && (
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-600">
          {report.ok} pièce(s) versée(s) en texte.
          {report.ignores.length > 0 && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-amber-600">{report.ignores.length} ignorée(s) / avec avertissement</summary>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10.5px] text-gray-500">
                {report.ignores.slice(0, 30).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-gray-100 py-1">
          {renderNode(tree, '', 0)}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={() => setPreview(null)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
              <FileText className="h-4 w-4 text-indigo-600" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{preview.rel.slice(ROOT.length)}</span>
              <button onClick={() => setPreview(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-50"><X className="h-4 w-4" /></button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-[12.5px] leading-relaxed text-gray-700">{preview.texte}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function countFiles(node: TreeNode): number {
  let n = node.files.length;
  for (const child of node.folders.values()) n += countFiles(child);
  return n;
}

function collectRels(node: TreeNode, _prefix: string): string[] {
  const rels = node.files.map((f) => f.rel);
  for (const child of node.folders.values()) rels.push(...collectRels(child, _prefix));
  return rels;
}
