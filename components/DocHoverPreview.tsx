'use client';

/**
 * Aperçu de la première page d'un PDF au survol (tooltip des documents).
 * Rendu localement via pdfjs ; résultat mis en cache (30 derniers documents).
 * En cas d'échec (PDF illisible, worker absent), le tooltip reste tel quel.
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const cache = new Map<string, string>(); // clé enquête/rel → dataURL
const MAX_CACHE = 30;

async function renderFirstPage(enquete: string, rel: string): Promise<string | null> {
  const key = `${enquete}/${rel}`;
  if (cache.has(key)) return cache.get(key)!;
  const api = window.electronAPI as unknown as { readDocumentData?: (e: string, r: string) => Promise<string | null> };
  const b64 = await api.readDocumentData?.(enquete, rel);
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const scale = 240 / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(scaled.width);
  canvas.height = Math.ceil(scaled.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) { await doc.destroy(); return null; }
  // le type RenderParameters de pdfjs v5 exige `canvas` ; l'appel contexte+viewport reste valide
  await page.render({ canvasContext: ctx, viewport: scaled } as unknown as Parameters<typeof page.render>[0]).promise;
  await doc.destroy();
  const url = canvas.toDataURL('image/jpeg', 0.8);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, url);
  return url;
}

export const DocHoverPreview = ({ enquete, rel }: { enquete: string; rel: string }) => {
  const [img, setImg] = useState<string | null>(cache.get(`${enquete}/${rel}`) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (img || failed) return;
    let cancelled = false;
    renderFirstPage(enquete, rel)
      .then(url => { if (!cancelled) (url ? setImg(url) : setFailed(true)); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [enquete, rel, img, failed]);

  if (failed) return null;
  if (!img) {
    return (
      <div className="flex items-center justify-center w-[240px] h-[120px] bg-gray-50 rounded-md border border-gray-100">
        <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
      </div>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img src={img} alt="" className="w-[240px] rounded-md border border-gray-200 shadow-sm" />
  );
};
