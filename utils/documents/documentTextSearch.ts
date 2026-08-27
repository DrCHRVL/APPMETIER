// utils/documents/documentTextSearch.ts
//
// Texte des documents d'enquête pour la RECHERCHE.
//
// Le document est téléchargé via le pont (déchiffrement local) puis converti
// DANS le navigateur avec lib/web/fileToMarkdown (PDF, DOCX, DOC, ODT,
// tableurs, TXT/HTML/RTF/EML — aucune dépendance nouvelle). Côté serveur rien
// ne change : les documents restent chiffrés de bout en bout, l'extraction et
// le cache vivent sur le poste — au même titre que les données métier déjà
// présentes dans IndexedDB.
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

/** Extraction brute (sans cache) — renvoie null si illisible/indisponible. */
async function extractText(
  enqueteNumero: string,
  doc: Pick<DocumentEnquete, 'cheminRelatif' | 'nom' | 'nomOriginal' | 'taille' | 'type'>
): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.siralBridge : undefined;
  if (!api) return null;
  const rel = doc.cheminRelatif;
  if (!rel || !isExtractableDocument(doc)) return null;
  if ((doc.taille || 0) > MAX_DOC_BYTES) return null;

  // 1) Octets déchiffrés + conversion navigateur (tous formats).
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
  } catch { /* on tente le repli PDF */ }

  // 2) Repli PDF : texte extrait côté pont.
  try {
    if (rel.toLowerCase().endsWith('.pdf')) {
      const t = await api.readDocumentText(enqueteNumero, rel);
      if (t) return t;
    }
  } catch { /* document illisible */ }
  return null;
}

// Caches de session : extraction en vol (dédoublonnage) + forme normalisée.
const inFlight = new Map<string, Promise<DocumentText | null>>();
const sessionCache = new Map<string, DocumentText | null>();

// Le cache de session gardait raw + norm de CHAQUE pièce lue, sans jamais rien
// libérer : jusqu'à ~1,6 Mo par pièce, plusieurs centaines de Mo sur un fonds
// analysé — c'est ce qui finissait par tuer l'onglet (« la page ne répond
// pas »). On borne donc le nombre d'entrées AVEC texte (les entrées null,
// minuscules, ne comptent pas) : au-delà, la plus anciennement utilisée est
// libérée — IndexedDB la resservira à la demande.
const MAX_SESSION_TEXTS = 120;
let sessionTextCount = 0;

function sessionRemember(key: string, value: DocumentText | null): void {
  const previous = sessionCache.get(key);
  if (previous !== undefined) {
    sessionCache.delete(key);
    if (previous !== null) sessionTextCount--;
  }
  if (value !== null) {
    while (sessionTextCount >= MAX_SESSION_TEXTS) {
      let evicted = false;
      for (const [k, v] of sessionCache) {
        if (v === null) continue;
        sessionCache.delete(k);
        sessionTextCount--;
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
    sessionTextCount++;
  }
  sessionCache.set(key, value);
}

/** Recence une entrée lue (LRU : les plus consultées restent en mémoire). */
function sessionTouch(key: string, value: DocumentText | null): void {
  if (value === null) return;
  sessionCache.delete(key);
  sessionCache.set(key, value);
}

/** État du cache de session — affiché par le moniteur d'activité. */
export function getDocTextCacheStats(): { textes: number; caracteres: number } {
  let caracteres = 0;
  for (const v of sessionCache.values()) {
    if (v) caracteres += v.raw.length + v.norm.length;
  }
  return { textes: sessionTextCount, caracteres };
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
  if (cached !== undefined) { sessionTouch(key, cached); return cached; }
  if (notCached.has(key)) return undefined;
  const db = await openDb();
  if (!db) return undefined;
  const stored = await idbGet<{ text: string | null }>(db, STORE_TEXTS, key);
  if (stored === undefined) {
    notCached.add(key);
    return undefined;
  }
  const value = stored.text ? { raw: stored.text, norm: normalizeText(stored.text) } : null;
  sessionRemember(key, value);
  return value;
}

/**
 * Texte BRUT d'un document déjà analysé — sans la forme normalisée.
 *
 * La veille de recoupements repasse sur des MILLIERS de pièces à chaque tour,
 * et ne se sert que du texte brut. Passer par `getCachedDocumentSearchText`
 * revenait à normaliser chaque pièce — une copie intégrale de la chaîne, aussitôt
 * jetée — et à chasser du cache de session les pièces réellement consultées par
 * la recherche. Ce chemin-ci lit, rend, et ne retient rien de neuf.
 *
 * `undefined` = jamais analysée ; `null` = analysée, illisible.
 */
export async function getCachedDocumentRawText(
  enqueteNumero: string,
  doc: Pick<DocumentEnquete, 'cheminRelatif' | 'taille'>
): Promise<string | null | undefined> {
  const key = cacheKey(enqueteNumero, doc);
  const cached = sessionCache.get(key);
  if (cached !== undefined) { sessionTouch(key, cached); return cached ? cached.raw : null; }
  if (notCached.has(key)) return undefined;
  const db = await openDb();
  if (!db) return undefined;
  const stored = await idbGet<{ text: string | null }>(db, STORE_TEXTS, key);
  if (stored === undefined) {
    notCached.add(key);
    return undefined;
  }
  return stored.text ?? null;
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
  if (cached !== undefined) { sessionTouch(key, cached); return cached; }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async (): Promise<DocumentText | null> => {
    const db = await openDb();

    if (db) {
      const stored = await idbGet<{ text: string | null }>(db, STORE_TEXTS, key);
      if (stored !== undefined) {
        const value = stored.text ? { raw: stored.text, norm: normalizeText(stored.text) } : null;
        sessionRemember(key, value);
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
    sessionRemember(key, value);
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
