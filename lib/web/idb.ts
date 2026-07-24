/**
 * SIRAL — stockage local navigateur (IndexedDB) : cache de travail
 * hors-ligne. Trois magasins : kv (données), files (fichiers texte locaux),
 * backups (sauvegardes locales du kv complet).
 */

const DB_NAME = 'siral-local'
const DB_VERSION = 2

// Cloisonnement par TJ : chaque tribunal a SA base IndexedDB. Le TJ par
// défaut conserve le nom historique (aucune perte du cache existant) ; les
// autres TJ utilisent une base dédiée. À définir AVANT toute lecture/écriture
// (WebGate l'appelle dès que l'identité — donc le TJ actif — est connue).
let dbName = DB_NAME

export function setIdbNamespace(tjId: string) {
  const next = !tjId || tjId === 'default' ? DB_NAME : `${DB_NAME}--${tjId.replace(/[^a-z0-9-]/gi, '_')}`
  if (next !== dbName) {
    dbName = next
    dbPromise = null // la prochaine transaction ouvrira la base du bon TJ
  }
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION)
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

/** Exporte tout le magasin kv en un objet (équivalent du data.json complet) — une seule transaction. */
export async function exportKv(): Promise<Record<string, unknown>> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const store = db.transaction('kv', 'readonly').objectStore('kv')
    const keysReq = store.getAllKeys()
    const valsReq = store.getAll()
    let keys: IDBValidKey[] | null = null
    let vals: unknown[] | null = null
    const done = () => {
      if (!keys || !vals) return
      const out: Record<string, unknown> = {}
      keys.forEach((k, i) => { out[String(k)] = vals![i] })
      resolve(out)
    }
    keysReq.onsuccess = () => { keys = keysReq.result; done() }
    valsReq.onsuccess = () => { vals = valsReq.result; done() }
    keysReq.onerror = () => reject(keysReq.error)
    valsReq.onerror = () => reject(valsReq.error)
  })
}

/** Remplace tout le magasin kv par l'objet fourni — une seule transaction. */
export async function importKv(data: Record<string, unknown>): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', 'readwrite')
    const store = t.objectStore('kv')
    store.clear()
    for (const [k, v] of Object.entries(data)) store.put(v, k)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

/** Toutes les entrées d'un magasin (clé + valeur) en une transaction. */
export async function getAllEntries<T>(store: string): Promise<Array<{ key: string, value: T }>> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const s = db.transaction(store, 'readonly').objectStore(store)
    const keysReq = s.getAllKeys()
    const valsReq = s.getAll()
    let keys: IDBValidKey[] | null = null
    let vals: T[] | null = null
    const done = () => {
      if (!keys || !vals) return
      resolve(keys.map((k, i) => ({ key: String(k), value: vals![i] })))
    }
    keysReq.onsuccess = () => { keys = keysReq.result; done() }
    valsReq.onsuccess = () => { vals = valsReq.result; done() }
    keysReq.onerror = () => reject(keysReq.error)
    valsReq.onerror = () => reject(valsReq.error)
  })
}
