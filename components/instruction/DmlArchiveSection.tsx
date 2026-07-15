'use client';

/**
 * SIRAL — module instruction · archive des DML du dossier.
 *
 * Zone de dépôt des réponses aux demandes de mise en liberté (et des DML
 * elles-mêmes) : les PDF déposés sont conservés INTACTS sur le serveur
 * (chiffrés, catégorie DML/) — on doit pouvoir retrouver l'original signé
 * numériquement. Chaque nouvelle DML se rédige à partir de la précédente :
 * cette archive est la mémoire du dossier.
 *
 * Le stockage rejoint la zone DML des documents d'enquête (docs chiffrés,
 * clé du numéro de dossier) : les mêmes fichiers sont lisibles des deux
 * côtés quand l'instruction est liée à une enquête du contentieux.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileArchive, UploadCloud, Trash2, ExternalLink, Loader2 } from 'lucide-react';

type AnyFn = (...args: unknown[]) => Promise<any>;

function bridgeFn(name: string): AnyFn {
  const api = (window as unknown as { electronAPI?: Record<string, AnyFn> }).electronAPI;
  const fn = api?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`fonction « ${name} » indisponible — rechargez l'application (Ctrl+Maj+R) après mise à jour`);
  }
  return fn;
}

interface DmlDoc { rel: string; size: number; savedAt?: string; originalName?: string }

export function DmlArchiveSection({ numero }: { numero: string }) {
  const [docs, setDocs] = useState<DmlDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await bridgeFn('listServerDocuments')(numero) as DmlDoc[];
      setDocs((all || []).filter((d) => d.rel.startsWith('DML/'))
        .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || ''))));
    } catch { /* silencieux — les erreurs remontent sur les actions */ }
  }, [numero]);

  useEffect(() => { refresh(); }, [refresh]);

  const upload = useCallback(async (files: FileList | File[] | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await Promise.all(list.map(async (f) => ({ name: f.name, arrayBuffer: await f.arrayBuffer() })));
      await bridgeFn('saveDocuments')(numero, payload, 'DML');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [numero, refresh]);

  const open = useCallback(async (rel: string) => {
    try { await bridgeFn('openDocument')(numero, rel); } catch { /* rien */ }
  }, [numero]);

  const remove = useCallback(async (rel: string) => {
    if (!window.confirm(`Supprimer « ${rel.split('/').pop()} » de l'archive DML ?`)) return;
    try { await bridgeFn('deleteDocument')(numero, rel); await refresh(); } catch { /* rien */ }
  }, [numero, refresh]);

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
        <FileArchive className="h-4 w-4 text-indigo-600" />
        Archive DML
        <span className="text-[11px] font-normal text-gray-400">réponses signées conservées intactes — base de la prochaine rédaction</span>
      </h3>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files); }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-3 text-xs transition-all
          ${dragOver ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:bg-gray-50'}
          ${busy ? 'pointer-events-none opacity-50' : ''}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? 'Dépôt en cours…' : 'Déposer ici les DML et réponses signées (PDF) — glisser ou cliquer'}
        <input type="file" multiple accept=".pdf,.doc,.docx,.odt" className="hidden"
          onChange={(e) => { upload(e.target.files); e.currentTarget.value = ''; }} />
      </label>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
      {docs.length > 0 && (
        <div className="mt-2 divide-y divide-gray-50 rounded-lg border border-gray-100">
          {docs.map((d) => (
            <div key={d.rel} className="flex items-center gap-2 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-gray-700">{d.originalName || d.rel.split('/').pop()}</div>
                <div className="text-[10.5px] text-gray-400">
                  {d.savedAt ? new Date(d.savedAt).toLocaleDateString('fr-FR') : ''} · {Math.max(1, Math.round((d.size || 0) / 1024))} Ko
                </div>
              </div>
              <button onClick={() => open(d.rel)} title="Ouvrir" className="rounded-md p-1 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600">
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => remove(d.rel)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
