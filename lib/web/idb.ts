/**
 * SIRAL — stockage local navigateur (IndexedDB).
 * Joue le rôle du data.json local de l'app Electron : cache de travail
 * hors-ligne. Trois magasins : kv (données), files (fichiers texte locaux),
 * backups (sauvegardes locales du kv complet).
 */

const DB_NAME = 'siral-local'
const DB_VERSION = 2

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files')
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups')
      // v2 : poignées de dossiers locaux (File System Access) + copies en attente
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const r = fn(t.objectStore(store))
    r.onsuccess = () => resolve(r.result as T)
    r.onerror = () => reject(r.error)
  }))
}

export const idb = {
  get: <T>(store: string, key: string): Promise<T | undefined> => tx<T>(store, 'readonly', (s) => s.get(key)),
  set: (store: string, key: string, value: unknown): Promise<void> => tx<void>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: string, key: string): Promise<void> => tx<void>(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: string): Promise<string[]> => tx<string[]>(store, 'readonly', (s) => s.getAllKeys() as IDBRequest),
  getAll: <T>(store: string): Promise<T[]> => tx<T[]>(store, 'readonly', (s) => s.getAll()),
}

/** Exporte tout le magasin kv en un objet (équivalent du data.json complet). */
export async function exportKv(): Promise<Record<string, unknown>> {
  const keys = await idb.keys('kv')
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = await idb.get('kv', k)
  return out
}

/** Remplace tout le magasin kv par l'objet fourni. */
export async function importKv(data: Record<string, unknown>): Promise<void> {
  const existing = await idb.keys('kv')
  for (const k of existing) await idb.del('kv', k)
  for (const [k, v] of Object.entries(data)) await idb.set('kv', k, v)
}
