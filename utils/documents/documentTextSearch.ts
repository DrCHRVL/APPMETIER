// utils/documents/documentTextSearch.ts
//
// Texte des documents d'enquête pour la RECHERCHE — édition web comprise.
//
// L'édition web télécharge le document via le pont (déchiffrement local) puis
// le convertit DANS le navigateur avec lib/web/fileToMarkdown (PDF, DOCX, DOC,
// ODT, tableurs, TXT/HTML/RTF/EML — aucune dépendance nouvelle). Les anciennes
// API de l'édition bureau (extractPdfText par chemin, readFile) restent en
// repli. Côté serveur rien ne change : les documents restent chiffrés de bout
// en bout, l'extraction et le cache vivent sur le poste — au même titre que
// les données métier déjà présentes dans IndexedDB.
//
// Chaque document n'est extrait qu'UNE fois : cache persistant IndexedDB
// (clé numéro + chemin + taille, invalidée par re-téléversement), doublé d'un
// cache de session portant la forme normalisée prête à chercher.

import type { DocumentEnquete } from '@/types/interfaces';
import { normalizeText } from '@/utils/globalSearch';

export interface DocumentText {
  /** Texte d'origine (extraits affichés). */
  raw: string;
  /** Texte normalisé (minuscules sans accents, index alignés sur `raw`). */
  norm: string;
}

// Extensions que la conversion navigateur sait traiter.
const EXTRACTABLE_RE = /\.(pdf|docx?|odt|ott|txt|md|markdown|csv|tsv|eml|log|rtf|html?|xlsx|xlsm|xltx|xls|ods)$/i;
/** Au-delà : on ne télécharge pas (scan de recherche ≠ rapatrier un scellé). */
const MAX_DOC_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;

const DB_NAME = 'siral-doc-text-v1';
const STORE_TEXTS = 'texts';
const STORE_META = 'meta';
const MAX_CACHE_ENTRIES = 800;
const PRUNE_EVERY = 20;

export function isExtractableDocument(doc: Pick<DocumentEnquete, 'cheminRelatif' | 'nom'>): boolean {
  return EXTRACTABLE_RE.test(doc.cheminRelatif || doc.nom || '');
}

// ── Mini-IndexedDB (indépendant du pont — utilisable sur les deux éditions) ──

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_TEXTS)) db.createObjectStore(STORE_TEXTS);
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

function idbSet(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

function idbDel(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

function idbEntries<T>(db: IDBDatabase, store: string): Promise<Array<{ key: string; value: T }>> {
  return new Promise((resolve) => {
    const out: Array<{ key: string; value: T }> = [];
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { out.push({ key: String(cur.key), value: cur.value as T }); cur.continue(); }
        else resolve(out);
      };
      req.onerror = () => resolve(out);
    } catch { resolve(out); }
  });
}

// Le magasin `meta` (clé → date) reste minuscule : c'est lui qu'on parcourt
// pour élaguer, jamais les textes.
let writesSincePrune = 0;
async function pruneIfNeeded(db: IDBDatabase): Promise<void> {
  writesSincePrune++;
  if (writesSincePrune < PRUNE_EVERY) return;
  writesSincePrune = 0;
  const metas = await idbEntries<{ at: number }>(db, STORE_META);
  if (metas.length <= MAX_CACHE_ENTRIES) return;
  metas.sort((a, b) => (a.value?.at || 0) - (b.value?.at || 0));
  const toDrop = metas.slice(0, metas.length - MAX_CACHE_ENTRIES);
  for (const m of toDrop) {
    await idbDel(db, STORE_TEXTS, m.key);
    await idbDel(db, STORE_META, m.key);
  }
}

// ── Extraction ──

function cacheKey(enqueteNumero: string, doc: Pick<DocumentEnquete, 'cheminRelatif' | 'taille'>): string {
  return `${enqueteNumero}||${doc.cheminRelatif}||${doc.taille || 0}`;
}

type ElectronDocApi = {
  readDocumentData?: (e: string, r: string) => Promise<string | null>;
  readDocumentText?: (e: string, r: string) => Promise<string>;
  extractPdfText?: (rel: string) => Promise<string | null>;
  readFile?: (folder: string, filename: string) => Promise<string | null>;
};

/** Extraction brute (sans cache) — renvoie null si illisible/indisponible. */
async function extractText(
  enqueteNumero: string,
  doc: Pick<DocumentEnquete, 'cheminRelatif' | 'nom' | 'nomOriginal' | 'taille' | 'type'>
): Promise<string | null> {
  const api = (typeof window !== 'undefined' ? window.electronAPI : undefined) as ElectronDocApi | undefined;
  if (!api) return null;
  const rel = doc.cheminRelatif;
  if (!rel || !isExtractableDocument(doc)) return null;
  if ((doc.taille || 0) > MAX_DOC_BYTES) return null;

  // 1) Édition web : octets déchiffrés + conversion navigateur (tous formats).
  if (typeof api.readDocumentData === 'function') {
    try {
      const b64 = await api.readDocumentData(enqueteNumero, rel);
      if (b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const { fileToMarkdown } = await import('@/lib/web/fileToMarkdown');
        const file = new File([bytes as unknown as BlobPart], doc.nomOriginal || doc.nom || rel.split('/').pop() || 'document');
        const { markdown } = await fileToMarkdown(file);
        return markdown || null;
      }
    } catch { /* on tente les replis */ }
  }

  // 2) Repli : texte PDF extrait côté pont (web `readDocumentText`, bureau `extractPdfText`).
  const lower = rel.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      if (typeof api.readDocumentText === 'function') {
        const t = await api.readDocumentText(enqueteNumero, rel);
        if (t) return t;
      }
      if (typeof api.extractPdfText === 'function') {
        return (await api.extractPdfText(rel)) || null;
      }
    } else if (/\.(txt|html?)$/.test(lower) && typeof api.readFile === 'function') {
      // Ancienne édition bureau : fichiers texte lus par le dossier d'enquête.
      return (await api.readFile(enqueteNumero, rel)) || null;
    }
  } catch { /* document illisible */ }
  return null;
}

// Caches de session : extraction en vol (dédoublonnage) + forme normalisée.
const inFlight = new Map<string, Promise<DocumentText | null>>();
const sessionCache = new Map<string, DocumentText | null>();

/** L'édition WEB expose readDocumentData : chaque extraction est un
 *  téléchargement + déchiffrement — on ne la déclenche jamais en silence. */
export function isWebDocumentBridge(): boolean {
  const api = (typeof window !== 'undefined' ? window.electronAPI : undefined) as ElectronDocApi | undefined;
  return typeof api?.readDocumentData === 'function';
}

// Mémoire de session des clés ABSENTES d'IndexedDB : évite de refaire un
// aller-retour IDB par document jamais analysé à chaque frappe. Une extraction
// réussie retire sa clé (getDocumentSearchText ci-dessous).
const notCached = new Set<string>();

/**
 * Texte d'un document DÉJÀ analysé (session ou IndexedDB) — aucun réseau,
 * aucune extraction. `undefined` = jamais tenté ; `null` = tenté, illisible.
 */
export async function getCachedDocumentSearchText(
  enqueteNumero: string,
  doc: Pick<DocumentEnquete, 'cheminRelatif' | 'taille'>
): Promise<DocumentText | null | undefined> {
  const key = cacheKey(enqueteNumero, doc);
  const cached = sessionCache.get(key);
  if (cached !== undefined) return cached;
  if (notCached.has(key)) return undefined;
  const db = await openDb();
  if (!db) return undefined;
  const stored = await idbGet<{ text: string | null }>(db, STORE_TEXTS, key);
  if (stored === undefined) {
    notCached.add(key);
    return undefined;
  }
  const value = stored.text ? { raw: stored.text, norm: normalizeText(stored.text) } : null;
  sessionCache.set(key, value);
  return value;
}

// Deux extractions lourdes à la fois maximum (pdfjs + déchiffrement).
let running = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (running < 2) { running++; return; }
  await new Promise<void>((r) => waiters.push(r));
  running++;
}
function release(): void {
  running--;
  const next = waiters.shift();
  if (next) next();
}

/**
 * Texte prêt à chercher d'un document (cache session → IndexedDB → extraction).
 * Renvoie null si le document est illisible : l'échec est mémorisé pour ne pas
 * retenter à chaque frappe.
 */
export async function getDocumentSearchText(
  enqueteNumero: string,
  doc: Pick<DocumentEnquete, 'cheminRelatif' | 'nom' | 'nomOriginal' | 'taille' | 'type'>
): Promise<DocumentText | null> {
  const key = cacheKey(enqueteNumero, doc);

  const cached = sessionCache.get(key);
  if (cached !== undefined) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<DocumentText | null> => {
    const db = await openDb();

    if (db) {
      const stored = await idbGet<{ text: string | null }>(db, STORE_TEXTS, key);
      if (stored !== undefined) {
        const value = stored.text ? { raw: stored.text, norm: normalizeText(stored.text) } : null;
        sessionCache.set(key, value);
        return value;
      }
    }

    await acquire();
    let raw: string | null = null;
    try {
      raw = await extractText(enqueteNumero, doc);
    } finally {
      release();
    }
    if (raw && raw.length > MAX_TEXT_CHARS) raw = raw.slice(0, MAX_TEXT_CHARS);

    if (db) {
      await idbSet(db, STORE_TEXTS, key, { text: raw });
      await idbSet(db, STORE_META, key, { at: Date.now() });
      await pruneIfNeeded(db);
    }

    const value = raw ? { raw, norm: normalizeText(raw) } : null;
    sessionCache.set(key, value);
    notCached.delete(key);
    return value;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
