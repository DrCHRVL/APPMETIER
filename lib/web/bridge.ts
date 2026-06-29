/**
 * SIRAL — pont web : implémente la surface complète de window.electronAPI
 * dans le navigateur, branchée sur l'API serveur SIRAL.
 *
 * Principe (identique à l'app Electron) :
 *  - « local » (data.json)   → IndexedDB (cache de travail, hors-ligne complet)
 *  - « serveur » (partage P:) → API /api/vaults (coffres chiffrés E2EE versionnés)
 *
 * Tout payload envoyé au serveur est chiffré ICI (AES-GCM) : le serveur ne
 * stocke que des enveloppes opaques. Les formes de retour reproduisent
 * fidèlement les contrats des handlers ipcMain de main.js.
 */
import { encryptJson, decryptJson, encryptBytes, decryptBytes, b64, CipherEnvelope } from './crypto'
import { idb, exportKv, importKv, getAllEntries } from './idb'
import { ScopedKeys, scopeOfVault, SCOPE_GLOBAL, generateInvitationCode, deriveRawKey, importAesKey, newKdfParams } from './keyring'

export interface BridgeIdentity { username: string, displayName: string, role: string }

interface BuildOptions { keys: ScopedKeys, me: BridgeIdentity }

// Magie binaire des documents chiffrés : 'SIR1' + iv(12) + ciphertext
const DOC_MAGIC = [0x53, 0x49, 0x52, 0x31]

// Coffres acceptés par l'import depuis l'app bureau (mêmes cibles que
// scripts/siral-import.js) : l'import ne peut pas toucher aux coffres
// d'accès (keyring-*, grant-*) ni à des noms arbitraires.
const DESKTOP_IMPORT_VAULT_RE = /^(users-config|tags|audience|alerts|deleted-ids|cartographie|cartographie-config|app-data|legacy-app-data|ctx-alerts-[a-zA-Z0-9._-]{1,64}|ctx-[a-zA-Z0-9._-]{1,64}|instructions-[a-zA-Z0-9._-]{1,64}|user-prefs-[a-zA-Z0-9._-]{1,64})$/

type AnyFn = (...args: unknown[]) => unknown

function nowIso() { return new Date().toISOString() }

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.keys(v as object).length === 0
  return false
}

class NetworkError extends Error {}

async function api(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), init?.timeoutMs ?? 15000)
  try {
    const res = await fetch(path, { ...init, signal: ctl.signal, credentials: 'same-origin' })
    if (res.status === 401) {
      // session expirée : on force le retour à l'écran de connexion
      window.dispatchEvent(new CustomEvent('siral:session-expired'))
      throw new NetworkError('Session expirée')
    }
    return res
  } catch (e) {
    if (e instanceof NetworkError) throw e
    throw new NetworkError(e instanceof Error ? e.message : 'Réseau injoignable')
  } finally {
    clearTimeout(t)
  }
}

export function buildWebBridge({ keys, me }: BuildOptions): Record<string, AnyFn> {
  // Clé « globale » : coffres partagés, documents, événements, audit, présence.
  const key = keys.global

  /** Clé du coffre selon son périmètre — refuse l'accès à un contentieux hors trousseau. */
  function keyFor(name: string): CryptoKey {
    const scope = scopeOfVault(name)
    const k = keys.byScope.get(scope)
    if (!k) throw new Error(`Accès non autorisé : votre trousseau ne contient pas la clé « ${scope} »`)
    return k
  }

  // ── Coffres chiffrés ──
  async function vaultPull(name: string): Promise<unknown | null> {
    try {
      const res = await api(`/api/vaults/${encodeURIComponent(name)}`)
      if (res.status === 404) { failedPulls.delete(name); return null }
      if (!res.ok) throw new NetworkError('Erreur serveur ' + res.status)
      const { envelope } = await res.json()
      const payload = await decryptJson(keyFor(name), envelope as CipherEnvelope)
      failedPulls.delete(name)
      return payload
    } catch (e) {
      if (e instanceof NetworkError) failedPulls.add(name)
      throw e
    }
  }

  // Coffres dont la dernière lecture a ÉCHOUÉ (réseau) : tant qu'une relecture
  // n'a pas confirmé leur état, on refuse d'écrire — sinon un faux « serveur
  // vide » pousserait une fusion locale qui écraserait les données partagées.
  const failedPulls = new Set<string>()

  /** Pull tolérant : null si absent OU injoignable (contrat globalSync). */
  async function vaultPullSoft(name: string): Promise<unknown | null> {
    try {
      const payload = await vaultPull(name)
      failedPulls.delete(name)
      return payload
    } catch {
      failedPulls.add(name)
      return null
    }
  }

  async function vaultPush(name: string, payload: unknown, meta?: { savedAt?: string, savedBy?: string }): Promise<true> {
    if (failedPulls.has(name)) {
      const probe = await api(`/api/vaults/${encodeURIComponent(name)}`)
      if (probe.status === 404) {
        failedPulls.delete(name) // réellement absent : écriture initiale sûre
      } else {
        if (probe.ok) failedPulls.delete(name)
        throw new NetworkError('Dernière lecture échouée — resynchronisation requise avant écriture')
      }
    }
    const envelope = await encryptJson(keyFor(name), payload, {
      savedAt: meta?.savedAt || nowIso(),
      savedBy: meta?.savedBy || me.username,
    })
    const res = await api(`/api/vaults/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
    if (!res.ok) throw new NetworkError('Écriture refusée (' + res.status + ')')
    return true
  }

  async function vaultVersions(name: string): Promise<string[]> {
    try {
      const res = await api(`/api/vaults/${encodeURIComponent(name)}/versions`)
      if (!res.ok) return []
      const { versions } = await res.json()
      return (versions as Array<{ filename: string }>).map((v) => v.filename)
    } catch { return [] }
  }

  async function vaultVersionRead(name: string, filename: string): Promise<unknown | null> {
    try {
      const res = await api(`/api/vaults/${encodeURIComponent(name)}/versions/${encodeURIComponent(filename)}`)
      if (!res.ok) return null
      const { envelope } = await res.json()
      return decryptJson(keyFor(name), envelope as CipherEnvelope)
    } catch { return null }
  }

  async function serverReachable(): Promise<boolean> {
    try {
      const res = await api('/api/health', { timeoutMs: 5000 })
      return res.ok
    } catch { return false }
  }

  /**
   * Énumère les usernames possédant un coffre du préfixe donné (ex. `air-`,
   * `instructions-`) — pour la découverte des invitations de partage. Renvoie les
   * usernames bruts (préfixe retiré), hors coffres de groupe `shared__…`.
   */
  async function listVaultUsers(prefix: string): Promise<string[]> {
    try {
      const res = await api(`/api/vaults?prefix=${encodeURIComponent(prefix)}`)
      if (!res.ok) return []
      const { names } = await res.json()
      return (names as string[])
        .map((n) => n.slice(prefix.length))
        .filter((u) => u && !u.startsWith('shared__'))
    } catch { return [] }
  }

  // ── Documents chiffrés ──
  function encodeDocName(s: string): string {
    return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/ +/g, '_').slice(0, 120)
  }

  // Clé serveur d'une enquête : le numéro métier (ex « 2025/112 », « 23 70/2025 »)
  // contient des « / » et espaces, refusés par le serveur (NAME_RE) et impossibles
  // à passer comme segment d'URL unique. On le transforme en identifiant stable et
  // sûr. Idempotent : une clé déjà sûre reste identique (pas de migration des docs
  // existants stockés sous un numéro déjà valide).
  function serverKey(enquete: string): string {
    const cleaned = String(enquete)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._@-]/g, '_')
    const safe = /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : 'e_' + cleaned
    return safe.slice(0, 121)
  }

  // Clé de comparaison robuste entre un nom de fichier serveur et un nom sur disque
  // (P:\). Les deux côtés normalisent différemment (accents, espaces, tirets) ; on
  // ramène tout à une forme commune pour ne JAMAIS recopier/réimporter — donc jamais
  // de doublon — un fichier déjà présent des deux côtés.
  const canonDoc = (s: string) => encodeDocName(s).replace(/[-_]+/g, '_').toLowerCase()

  async function docUpload(enquete: string, rel: string, bytes: Uint8Array, category?: string, originalName?: string) {
    const { iv, ct } = await encryptBytes(key, bytes)
    const ivBytes = b64.decode(iv)
    const blob = new Uint8Array(4 + 12 + ct.length)
    blob.set(DOC_MAGIC, 0)
    blob.set(ivBytes, 4)
    blob.set(ct, 16)
    const res = await api(`/api/docs/${encodeURIComponent(serverKey(enquete))}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rel, b64: b64.encode(blob), category, originalName }),
      timeoutMs: 120000,
    })
    if (!res.ok) throw new NetworkError('Dépôt du document refusé')
  }

  async function docDownload(enquete: string, rel: string): Promise<Uint8Array | null> {
    const res = await api(`/api/docs/${encodeURIComponent(serverKey(enquete))}/${rel.split('/').map(encodeURIComponent).join('/')}`, { timeoutMs: 120000 })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length < 16 || buf[0] !== DOC_MAGIC[0] || buf[1] !== DOC_MAGIC[1] || buf[2] !== DOC_MAGIC[2] || buf[3] !== DOC_MAGIC[3]) return null
    const iv = b64.encode(buf.subarray(4, 16))
    return decryptBytes(key, iv, buf.subarray(16))
  }

  async function docList(enquete: string): Promise<Array<{ rel: string, size: number, savedAt: string, category?: string, originalName?: string }>> {
    try {
      const res = await api(`/api/docs/${encodeURIComponent(serverKey(enquete))}`)
      if (!res.ok) return []
      const { documents } = await res.json()
      return documents
    } catch { return [] }
  }

  function mimeOf(name: string): string {
    const ext = name.toLowerCase().split('.').pop() || ''
    const map: Record<string, string> = {
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain', html: 'text/html', csv: 'text/csv',
    }
    return map[ext] || 'application/octet-stream'
  }

  function typeOf(name: string): string {
    const ext = name.toLowerCase().split('.').pop() || ''
    if (ext === 'pdf') return 'pdf'
    if (['doc', 'docx', 'odt'].includes(ext)) return 'word'
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) return 'image'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel'
    return 'autre'
  }

  // ── Fichiers choisis par l'utilisateur (pseudo-chemins navigateur) ──
  const pickedFiles = new Map<string, File>()

  function pickFile(options?: { filters?: Array<{ extensions?: string[] }> }): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      const exts = options?.filters?.flatMap((f) => f.extensions || []) || []
      if (exts.length) input.accept = exts.map((e) => '.' + e).join(',')
      input.onchange = () => {
        const f = input.files?.[0]
        if (!f) return resolve(null)
        const pseudo = `picked://${Date.now()}/${f.name}`
        pickedFiles.set(pseudo, f)
        resolve(pseudo)
      }
      // Safari ne déclenche pas toujours onchange après annulation : timeout doux
      input.oncancel = () => resolve(null)
      input.click()
    })
  }

  function downloadText(filename: string, content: string) {
    const blob = new Blob([content], { type: 'application/octet-stream' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 30000)
  }

  // ── Événements partagés et présence ──
  const sharedEventCallbacks: Array<(data: unknown) => void> = []
  const seenEventIds = new Set<string>()
  let lastEventTs = Date.now()
  let eventsTimer: ReturnType<typeof setInterval> | null = null

  async function pollEvents() {
    try {
      const res = await api(`/api/events?since=${lastEventTs - 5000}`, { timeoutMs: 8000 })
      if (!res.ok) return
      const { events } = await res.json()
      for (const ev of events as Array<{ id: string, ct: string, iv: string, timestamp: number }>) {
        if (seenEventIds.has(ev.id)) continue
        seenEventIds.add(ev.id)
        lastEventTs = Math.max(lastEventTs, ev.timestamp)
        try {
          const payload = await decryptJson(key, { v: 1, encrypted: true, iv: ev.iv, ct: ev.ct })
          sharedEventCallbacks.forEach((cb) => { try { cb(payload) } catch {} })
        } catch {}
      }
      if (seenEventIds.size > 2000) {
        // borne mémoire
        const keep = Array.from(seenEventIds).slice(-1000)
        seenEventIds.clear()
        keep.forEach((id) => seenEventIds.add(id))
      }
    } catch {}
  }

  // ── État réseau ──
  type NetState = 'healthy' | 'slow' | 'unreachable'
  let netStatus: { state: NetState, latency: number | null, lastProbeAt: string | null } = { state: 'healthy', latency: null, lastProbeAt: null }
  const netCallbacks: Array<(state: NetState) => void> = []
  let netTimer: ReturnType<typeof setInterval> | null = null

  async function probe(): Promise<typeof netStatus> {
    const start = performance.now()
    let state: NetState = 'unreachable'
    let latency: number | null = null
    try {
      const ok = await (async () => {
        const res = await api('/api/health', { timeoutMs: 3000 })
        return res.ok
      })()
      latency = Math.round(performance.now() - start)
      state = !ok ? 'unreachable' : latency < 800 ? 'healthy' : 'slow'
    } catch {
      state = 'unreachable'
    }
    const prev = netStatus.state
    netStatus = { state, latency, lastProbeAt: nowIso() }
    if (prev !== state) netCallbacks.forEach((cb) => { try { cb(state) } catch {} })
    return netStatus
  }

  // ── Extraction de texte PDF (dans le navigateur) ──
  async function extractPdfText(input: ArrayBuffer | Uint8Array): Promise<string> {
    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
      const data = input instanceof Uint8Array ? input : new Uint8Array(input)
      const doc = await pdfjs.getDocument({ data: data.slice() }).promise
      const parts: string[] = []
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p)
        const content = await page.getTextContent()
        parts.push(content.items.map((it) => ('str' in it ? (it as { str: string }).str : '')).join(' '))
      }
      await doc.destroy()
      return parts.join('\n')
    } catch (e) {
      console.warn('extractPDFText (web) :', e)
      return ''
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // LA SURFACE electronAPI
  // ════════════════════════════════════════════════════════════════════
  const bridge: Record<string, AnyFn> = {
    // ── Stockage local (IndexedDB ≙ data.json) ──
    getData: async (key1: unknown, defaultValue?: unknown) => {
      const v = await idb.get('kv', String(key1))
      return v === undefined ? (defaultValue ?? null) : v
    },
    setData: async (key1: unknown, value: unknown) => {
      const k = String(key1)
      const existing = await idb.get('kv', k)
      // ElectronBridge enveloppe en { version, data } : la garde doit comparer
      // le CONTENU, sinon l'enveloppe n'est jamais « vide » et la garde dort.
      const unwrap = (v: unknown) => {
        const o = v as { version?: unknown, data?: unknown } | null
        return o && typeof o === 'object' && 'data' in o && 'version' in o ? o.data : v
      }
      if (existing !== undefined && !isEmptyValue(unwrap(existing)) && isEmptyValue(unwrap(value))) {
        console.warn(`setData(${k}) : écrasement par une valeur vide refusé (garde anti-érosion)`)
        return false
      }
      await idb.set('kv', k, value)
      return true
    },
    clearData: async (key1: unknown) => { await idb.del('kv', String(key1)); return true },
    getAllKeys: async () => idb.keys('kv'),

    // ── Sauvegardes locales (instantanés du kv complet) ──
    copyDataJson: async (backupFileName: unknown) => {
      const snapshot = await exportKv()
      await idb.set('backups', String(backupFileName), { data: snapshot, created: nowIso(), size: JSON.stringify(snapshot).length })
      return true
    },
    restoreDataJson: async (backupFileName: unknown) => {
      const backup = await idb.get<{ data: Record<string, unknown> }>('backups', String(backupFileName))
      if (!backup) return false
      const safety = await exportKv()
      await idb.set('backups', `data_before_restore_${Date.now()}.json`, { data: safety, created: nowIso(), size: JSON.stringify(safety).length })
      await importKv(backup.data)
      return true
    },
    getDataJsonInfo: async () => {
      const snapshot = await exportKv()
      const size = JSON.stringify(snapshot).length
      return { size, created: new Date(), modified: new Date(), path: 'Navigateur (IndexedDB)' }
    },
    compareWithDataJson: async (backupFileName: unknown) => {
      const backup = await idb.get<{ data: Record<string, unknown>, created: string, size: number }>('backups', String(backupFileName))
      if (!backup) return null
      const current = JSON.stringify(await exportKv()).length
      return { currentSize: current, backupSize: backup.size, sizeDifference: current - backup.size, currentModified: new Date(), backupModified: new Date(backup.created) }
    },
    listDataJsonBackups: async () => {
      const entries = await getAllEntries<{ created: string, size: number }>('backups')
      return entries
        .map(({ key, value }) => ({ name: key, size: value.size, created: value.created, modified: value.created }))
        .sort((a, b2) => (a.created < b2.created ? 1 : -1))
    },
    getBackupStats: async () => {
      const entries = await getAllEntries<{ size: number }>('backups')
      const total = entries.reduce((acc, e) => acc + (e.value?.size || 0), 0)
      return { count: entries.length, totalSize: total, averageSize: entries.length ? Math.round(total / entries.length) : 0 }
    },
    cleanOldBackups: async (keepCount: unknown) => {
      const list = await (bridge.listDataJsonBackups as () => Promise<Array<{ name: string, size: number }>>)()
      const toDelete = list.slice(Number(keepCount) || 10)
      let freed = 0
      for (const b of toDelete) { freed += b.size; await idb.del('backups', b.name) }
      return { deleted: toDelete.length, remaining: list.length - toDelete.length, totalSizeFreed: freed }
    },

    // ── Fichiers texte locaux ──
    saveFile: async (folder: unknown, filename: unknown, content: unknown) => {
      await idb.set('files', `${folder}/${filename}`, { content: String(content), modified: nowIso() })
      return true
    },
    readFile: async (folder: unknown, filename: unknown) => {
      const f = await idb.get<{ content: string }>('files', `${folder}/${filename}`)
      return f ? f.content : null
    },
    listFiles: async (folder: unknown) => {
      const keys = await idb.keys('files')
      const prefix = `${folder}/`
      return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
    },
    deleteFile: async (folder: unknown, filename: unknown) => {
      const k = `${folder}/${filename}`
      const existed = (await idb.get('files', k)) !== undefined
      await idb.del('files', k)
      return existed
    },
    saveFileDialog: async (defaultName: unknown, content: unknown) => {
      downloadText(String(defaultName || 'export.txt'), String(content))
      return true
    },

    // ── Dialogues / ouvertures ──
    openFileDialog: async (options: unknown) => pickFile(options as { filters?: Array<{ extensions?: string[] }> }),
    saveCasierFile: async (sourcePath: unknown, fileName: unknown) => {
      const f = pickedFiles.get(String(sourcePath))
      if (!f) throw new Error('Fichier introuvable')
      const rel = `casiers/${encodeDocName(String(fileName))}`
      await docUpload('_casiers', rel, new Uint8Array(await f.arrayBuffer()), 'casiers', f.name)
      return rel
    },
    deleteCasierFile: async (filePath: unknown) => {
      try {
        const res = await api(`/api/docs/${encodeURIComponent(serverKey('_casiers'))}/${String(filePath).split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' })
        return res.ok
      } catch { return false }
    },
    openExternalFile: async () => false,
    openExternalUrl: async (url: unknown) => {
      const u = String(url)
      if (!/^https?:\/\//i.test(u)) return false
      window.open(u, '_blank', 'noopener')
      return true
    },

    // ── Documents d'enquête ──
    saveDocuments: async (enqueteNumero: unknown, files: unknown, category: unknown) => {
      const enq = String(enqueteNumero)
      const cat = String(category || 'Actes')
      const list = files as Array<{ name: string, arrayBuffer: ArrayBuffer }>
      const existing = await docList(enq)
      const results: Array<Record<string, unknown>> = []
      for (let i = 0; i < list.length; i++) {
        const f = list[i]
        let base = encodeDocName(f.name)
        let rel = `${cat}/${base}`
        let counter = 1
        while (existing.some((d) => d.rel === rel) || results.some((r) => r.cheminRelatif === rel)) {
          const dot = base.lastIndexOf('.')
          rel = `${cat}/${dot > 0 ? base.slice(0, dot) + '_' + counter + base.slice(dot) : base + '_' + counter}`
          counter++
        }
        const bytes = new Uint8Array(f.arrayBuffer)
        await docUpload(enq, rel, bytes, cat, f.name)
        const ext = '.' + (f.name.split('.').pop() || '')
        results.push({
          id: Date.now() + i,
          nom: rel.split('/').pop(),
          nomOriginal: f.name,
          extension: ext,
          taille: bytes.length,
          dateAjout: nowIso(),
          cheminRelatif: rel,
          type: typeOf(f.name),
        })
      }
      return results
    },
    deleteDocument: async (enqueteNumero: unknown, cheminRelatif: unknown) => {
      try {
        const res = await api(`/api/docs/${encodeURIComponent(serverKey(String(enqueteNumero)))}/${String(cheminRelatif).split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' })
        return res.ok
      } catch { return false }
    },
    openDocument: async (enqueteNumero: unknown, cheminRelatif: unknown) => {
      const name = String(cheminRelatif).split('/').pop() || 'document'
      // Ouvrir l'onglet IMMÉDIATEMENT, tant que le clic de l'utilisateur est encore
      // « actif » : sinon Edge/Chrome bloquent silencieusement l'ouverture après le
      // téléchargement (perte de l'activation utilisateur due aux await réseau/déchiffrement).
      const win = typeof window !== 'undefined' ? window.open('', '_blank') : null
      const bytes = await docDownload(String(enqueteNumero), String(cheminRelatif))
      if (!bytes) { if (win) win.close(); return false }
      const blob = new Blob([bytes as BlobPart], { type: mimeOf(name) })
      const url = URL.createObjectURL(blob)
      if (win) {
        win.location.href = url
      } else {
        // Onglet bloqué malgré tout : repli sur un téléchargement classique.
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 120000)
      return true
    },
    documentExists: async (enqueteNumero: unknown, cheminRelatif: unknown) => {
      const docs = await docList(String(enqueteNumero))
      return docs.some((d) => d.rel === String(cheminRelatif))
    },
    getDocumentSize: async (enqueteNumero: unknown, cheminRelatif: unknown) => {
      const docs = await docList(String(enqueteNumero))
      const d = docs.find((x) => x.rel === String(cheminRelatif))
      // taille chiffrée ≈ taille réelle + 16 octets de tag GCM
      return d ? Math.max(0, d.size - 32) : 0
    },
    extractPDFText: async (buffer: unknown) => extractPdfText(buffer as ArrayBuffer),
    readDocumentData: async (enqueteNumero: unknown, cheminRelatif: unknown) => {
      const bytes = await docDownload(String(enqueteNumero), String(cheminRelatif))
      return bytes ? b64.encode(bytes) : null
    },
    readDocumentText: async (enqueteNumero: unknown, cheminRelatif: unknown) => {
      if (!String(cheminRelatif).toLowerCase().endsWith('.pdf')) return ''
      const bytes = await docDownload(String(enqueteNumero), String(cheminRelatif))
      return bytes ? extractPdfText(bytes) : ''
    },

    // ── Dossier commun local (File System Access — règle 3-2-1) ──
    // Le « chemin externe » d'une enquête est un jeton fsa://… choisi via
    // selectFolder ; les copies en clair y sont déposées, avec file d'attente
    // quand le dossier (commun Windows) n'est pas joignable.
    copyToExternalPath: async (enqueteNumero: unknown, externalPath: unknown, files: unknown, category: unknown, useSubfolder: unknown = true) => {
      const fsa = await import('./folderAccess')
      const token = String(externalPath || '')
      if (!fsa.isFsaToken(token)) return false
      const enq = String(enqueteNumero)
      const sub = useSubfolder !== false
      const list = (files as Array<{ cheminRelatif: string, nomOriginal?: string, nom?: string }>) || []
      const reachable = await fsa.validateFolder(token)
      let allOk = true
      for (const f of list) {
        const cat = String(category || f.cheminRelatif.split('/')[0] || 'Actes')
        const name = f.nomOriginal || f.nom || f.cheminRelatif.split('/').pop() || 'document'
        if (!reachable) {
          await fsa.enqueueCopy({ enquete: enq, token, rel: f.cheminRelatif, originalName: name, category: cat, useSubfolder: sub })
          allOk = false
          continue
        }
        try {
          const bytes = await docDownload(enq, f.cheminRelatif)
          if (!bytes) { allOk = false; continue }
          await fsa.writeToFolder(token, enq, sub, cat, name, bytes)
        } catch {
          await fsa.enqueueCopy({ enquete: enq, token, rel: f.cheminRelatif, originalName: name, category: cat, useSubfolder: sub })
          allOk = false
        }
      }
      return allOk
    },
    validatePath: async (pathToValidate: unknown) => {
      const fsa = await import('./folderAccess')
      const token = String(pathToValidate || '')
      if (!fsa.isFsaToken(token)) return false
      const ok = await fsa.validateFolder(token)
      if (ok) fsa.flushPendingCopies(docDownload).catch(() => {})
      return ok
    },
    selectFolder: async () => {
      const fsa = await import('./folderAccess')
      return fsa.pickFolder()
    },
    openExternalFolder: async () => false, // un navigateur ne peut pas ouvrir l'Explorateur
    deleteFromExternalPath: async (externalPath: unknown, enqueteNumero: unknown, cheminRelatif: unknown) => {
      const fsa = await import('./folderAccess')
      const token = String(externalPath || '')
      if (!fsa.isFsaToken(token)) return false
      const rel = String(cheminRelatif)
      const cat = rel.split('/')[0] || ''
      const name = rel.split('/').pop() || ''
      // les deux dispositions possibles (avec/sans sous-dossier d'enquête)
      const a = await fsa.deleteFromFolder(token, String(enqueteNumero), true, cat, name)
      const b = await fsa.deleteFromFolder(token, String(enqueteNumero), false, cat, name)
      return a || b
    },
    syncDocuments: async (enqueteNumero: unknown, externalPath: unknown, useSubfolder: unknown = true) => {
      const fsa = await import('./folderAccess')
      const token = String(externalPath || '')
      const enq = String(enqueteNumero)
      const sub = useSubfolder !== false
      const result = {
        totalInternal: 0, totalExternal: 0,
        addedToInternal: [] as string[], addedToExternal: [] as string[],
        // Métadonnées complètes des fichiers importés depuis P:\ → permet à l'UI de
        // les afficher dans la liste de l'enquête sans re-scan.
        importedDocs: [] as Array<Record<string, unknown>>,
        // Chemins relatifs des documents internes non copiés sur le commun (badge « ✗ commun »).
        notOnCommun: [] as string[],
        errors: [] as string[], externalAccessible: true,
      }
      if (!fsa.isFsaToken(token)) {
        result.errors.push('Aucun dossier commun configuré sur cet appareil (bouton « Configurer chemin »)')
        result.externalAccessible = false
        return result
      }
      if (!(await fsa.validateFolder(token))) {
        result.errors.push('Dossier commun inaccessible actuellement')
        result.externalAccessible = false
        return result
      }
      await fsa.flushPendingCopies(docDownload).catch(() => {})
      const internal = await docList(enq)
      result.totalInternal = internal.length
      const cats = Array.from(new Set(['Geoloc', 'Ecoutes', 'Actes', 'PV', ...internal.map((d) => d.rel.split('/')[0])]))
      for (const cat of cats) {
        const externalNames = await fsa.listFolderFiles(token, enq, sub, cat)
        result.totalExternal += externalNames.length
        const inCat = internal.filter((d) => d.rel.startsWith(cat + '/'))
        // Clés canoniques des fichiers présents de chaque côté (comparaison robuste).
        const externalCanon = new Set(externalNames.map(canonDoc))
        const internalCanon = new Set(inCat.map((d) => canonDoc(d.originalName || d.rel.split('/').pop() || '')))
        // interne → externe : pousser ce qui manque (jamais ce qui est déjà là).
        for (const d of inCat) {
          const name = d.originalName || d.rel.split('/').pop() || ''
          if (externalCanon.has(canonDoc(name))) continue
          try {
            const bytes = await docDownload(enq, d.rel)
            if (bytes) { await fsa.writeToFolder(token, enq, sub, cat, name, bytes); result.addedToExternal.push(name) }
            else { result.notOnCommun.push(d.rel); result.errors.push(`Document introuvable en interne : ${name}`) }
          } catch (e) {
            result.notOnCommun.push(d.rel)
            result.errors.push(`Copie vers le commun échouée : ${name}`)
          }
        }
        // externe → interne : importer ce qui a été déposé à la main (jamais un doublon).
        const importedCanon = new Set<string>()
        for (const n of externalNames) {
          const key = canonDoc(n)
          if (internalCanon.has(key) || importedCanon.has(key)) continue
          importedCanon.add(key)
          try {
            const bytes = await fsa.readFromFolder(token, enq, sub, cat, n)
            if (!bytes) continue
            const rel = `${cat}/${encodeDocName(n)}`
            await docUpload(enq, rel, bytes, cat, n)
            result.addedToInternal.push(n)
            result.importedDocs.push({
              id: Date.now() + result.importedDocs.length,
              nom: rel.split('/').pop(),
              nomOriginal: n,
              extension: '.' + (n.split('.').pop() || ''),
              taille: bytes.length,
              dateAjout: nowIso(),
              cheminRelatif: rel,
              type: typeOf(n),
              copieCommun: 'ok',
            })
          } catch {
            result.errors.push(`Import depuis le commun échoué : ${n}`)
          }
        }
      }
      return result
    },
    scanForNewDocuments: async () => ({ newDocuments: [], errors: [] }), // sans objet : le serveur est la source interne
    scanExternalPDFs: async () => ({ documents: [], errors: ['Scan externe non disponible en mode web'], foldersScanned: [] }),

    // ── Configuration serveur (gérée par SIRAL côté web) ──
    serverConfig_get: async () => ({ isConfigured: true, serverRootPath: 'SIRAL — serveur chiffré', configPath: '' }),
    serverConfig_setup: async () => ({ success: true }),
    serverConfig_reset: async () => ({ success: false, error: 'Géré par le serveur SIRAL en mode web' }),
    paths_getEffective: async () => ({ general: 'siral://serveur/general', contentieux: {} }),
    paths_migrateContentieux: async () => ({ success: true, skipped: true, reason: 'mode web' }),
    paths_migrateGeneral: async () => ({ success: true, skipped: true, reason: 'mode web' }),

    // ── Synchronisation racine (legacy) ──
    dataSync_checkAccess: async () => serverReachable(),
    dataSync_pull: async () => {
      try {
        const payload = await vaultPull('app-data')
        return payload as { data: unknown, metadata: unknown } | null
      } catch { return null }
    },
    dataSync_push: async (data: unknown, metadata: unknown) => {
      await vaultPush('app-data', { data, metadata }, metaOf(metadata))
      return true
    },
    dataSync_backupServer: async () => true,            // le serveur versionne automatiquement
    dataSync_deleteServerBackup: async () => true,      // rétention gérée par le serveur
    dataSync_listServerBackups: async () => vaultVersions('app-data'),
    dataSync_readServerBackup: async (filename: unknown) => {
      const payload = await vaultVersionRead('app-data', String(filename))
      return (payload as { data: unknown, metadata: unknown } | null)
    },

    // ── Snapshot complet personnel (« sauvegarde ponctuelle de tout ») ──
    // Tout le local (sauf documents, stockés à part) est chiffré ici puis
    // poussé dans le coffre personnel `snapshot-<user>` (périmètre global).
    // Le serveur archive automatiquement la version précédente à chaque envoi.
    fullSnapshot_push: async (payload: unknown) => {
      await vaultPush(`snapshot-${sanitizeName(me.username)}`, payload)
      return true
    },
    fullSnapshot_info: async () => {
      const name = `snapshot-${sanitizeName(me.username)}`
      try {
        const res = await api(`/api/vaults/${encodeURIComponent(name)}`)
        if (!res.ok) return { exists: false }
        const { envelope } = await res.json()
        return { exists: true, savedAt: envelope?.savedAt ?? envelope?.receivedAt ?? null, savedBy: envelope?.savedBy ?? null }
      } catch { return { exists: false } }
    },
    fullSnapshot_listVersions: async () => vaultVersions(`snapshot-${sanitizeName(me.username)}`),
    fullSnapshot_readCurrent: async () => vaultPullSoft(`snapshot-${sanitizeName(me.username)}`),
    fullSnapshot_readVersion: async (filename: unknown) =>
      vaultVersionRead(`snapshot-${sanitizeName(me.username)}`, String(filename)),

    // ── Identité ──
    getCurrentUser: async () => ({ displayName: me.username, computerName: 'SIRAL Web' }),

    // ── Config multi-utilisateurs ──
    dataSync_pullUsersConfig: async () => {
      try {
        const res = await api('/api/vaults/users-config')
        if (res.status === 404) return { status: 'missing' }
        if (!res.ok) return { status: 'unreachable', error: 'Erreur serveur ' + res.status }
        const { envelope } = await res.json()
        const config = await decryptJson(key, envelope as CipherEnvelope)
        return { status: 'ok', config }
      } catch (e) {
        return { status: 'unreachable', error: e instanceof Error ? e.message : 'injoignable' }
      }
    },
    dataSync_pushUsersConfig: async (config: unknown) => { await vaultPush('users-config', config); return true },
    dataSync_listAdminBackups: async () => vaultVersions('users-config'),
    dataSync_restoreAdminBackup: async (filename: unknown) => {
      const payload = await vaultVersionRead('users-config', String(filename))
      if (!payload) return false
      await vaultPush('users-config', payload)
      return true
    },

    // ── Synchronisation par contentieux ──
    dataSync_checkContentieuxAccess: async () => serverReachable(),
    dataSync_pullContentieux: async (contentieuxId: unknown) => {
      const payload = await vaultPull(`ctx-${contentieuxId}`)
      return payload as { data: unknown, metadata: unknown } | null
    },
    dataSync_pushContentieux: async (contentieuxId: unknown, data: unknown, metadata: unknown) => {
      await vaultPush(`ctx-${contentieuxId}`, { data, metadata }, metaOf(metadata))
      return true
    },
    dataSync_backupContentieux: async () => true,       // versionnage serveur automatique
    dataSync_listContentieuxBackups: async (contentieuxId: unknown) => vaultVersions(`ctx-${contentieuxId}`),
    dataSync_readContentieuxBackup: async (contentieuxId: unknown, filename: unknown) => {
      const payload = await vaultVersionRead(`ctx-${contentieuxId}`, String(filename))
      return (payload as { data: unknown, metadata: unknown } | null)
    },

    // ── Fichiers globaux partagés ──
    globalSync_pullTags: async () => vaultPullSoft('tags'),
    globalSync_pushTags: async (payload: unknown) => { try { await vaultPush('tags', payload); return true } catch { return false } },
    globalSync_pullAudience: async () => vaultPullSoft('audience'),
    globalSync_pushAudience: async (payload: unknown) => { try { await vaultPush('audience', payload); return true } catch { return false } },
    globalSync_pullAlerts: async () => vaultPullSoft('alerts'),
    globalSync_pushAlerts: async (payload: unknown) => { try { await vaultPush('alerts', payload); return true } catch { return false } },
    globalSync_pullDeletedIds: async () => vaultPullSoft('deleted-ids'),
    globalSync_pushDeletedIds: async (payload: unknown) => { try { await vaultPush('deleted-ids', payload); return true } catch { return false } },
    globalSync_pullCartographie: async () => vaultPullSoft('cartographie'),
    globalSync_pushCartographie: async (payload: unknown) => { try { await vaultPush('cartographie', payload); return true } catch { return false } },
    globalSync_pullCartographieConfig: async () => vaultPullSoft('cartographie-config'),
    globalSync_pushCartographieConfig: async (payload: unknown) => { try { await vaultPush('cartographie-config', payload); return true } catch { return false } },
    globalSync_readLegacyAppData: async () => vaultPullSoft('legacy-app-data'),
    globalSync_pullUserPreferences: async (username: unknown) => vaultPullSoft(`user-prefs-${sanitizeName(username)}`),
    globalSync_pushUserPreferences: async (username: unknown, payload: unknown) => {
      await vaultPush(`user-prefs-${sanitizeName(username)}`, payload)
      return true
    },
    globalSync_pullContentieuxAlerts: async (contentieuxId: unknown) => vaultPullSoft(`ctx-alerts-${sanitizeName(contentieuxId)}`),
    globalSync_pushContentieuxAlerts: async (contentieuxId: unknown, payload: unknown) => {
      await vaultPush(`ctx-alerts-${sanitizeName(contentieuxId)}`, payload)
      return true
    },

    // ── Module instruction (privé par utilisateur) ──
    instructionSync_check: async () => serverReachable(),
    instructionSync_pull: async (_basePath: unknown, username: unknown) => {
      const payload = await vaultPull(`instructions-${sanitizeName(username)}`)
      return payload
    },
    instructionSync_push: async (_basePath: unknown, username: unknown, payload: unknown) => {
      await vaultPush(`instructions-${sanitizeName(username)}`, payload)
      return true
    },
    instructionSync_listBackups: async (_basePath: unknown, username: unknown) => vaultVersions(`instructions-${sanitizeName(username)}`),
    instructionSync_readBackup: async (_basePath: unknown, username: unknown, filename: unknown) =>
      vaultVersionRead(`instructions-${sanitizeName(username)}`, String(filename)),
    // Découverte des invitations entrantes côté web : énumère les coffres
    // `instructions-<user>` via /api/vaults (noms uniquement), le client lit
    // ensuite chacun pour vérifier qui le cite dans `shareWith`.
    instructionSync_listUsers: async () => listVaultUsers('instructions-'),

    // ── Module AIR (privé par utilisateur, partage réciproque optionnel) ──
    airSync_check: async () => serverReachable(),
    airSync_pull: async (_basePath: unknown, username: unknown) => {
      const payload = await vaultPull(`air-${sanitizeName(username)}`)
      return payload
    },
    airSync_push: async (_basePath: unknown, username: unknown, payload: unknown) => {
      await vaultPush(`air-${sanitizeName(username)}`, payload)
      return true
    },
    airSync_listBackups: async (_basePath: unknown, username: unknown) => vaultVersions(`air-${sanitizeName(username)}`),
    airSync_readBackup: async (_basePath: unknown, username: unknown, filename: unknown) =>
      vaultVersionRead(`air-${sanitizeName(username)}`, String(filename)),
    // Découverte des invitations entrantes côté web (cf. instructionSync_listUsers).
    airSync_listUsers: async () => listVaultUsers('air-'),

    // ── Présence ──
    writeHeartbeat: async (_username: unknown, heartbeat: unknown) => {
      try {
        const env = await encryptJson(key, heartbeat)
        const res = await api('/api/heartbeats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ct: env.ct, iv: env.iv }) })
        return res.ok
      } catch { return false }
    },
    removeHeartbeat: async () => {
      try { const res = await api('/api/heartbeats', { method: 'DELETE' }); return res.ok } catch { return false }
    },
    readAllHeartbeats: async () => {
      try {
        const res = await api('/api/heartbeats')
        if (!res.ok) return []
        const { heartbeats } = await res.json()
        const out: unknown[] = []
        for (const h of heartbeats as Array<{ username: string, ct: string, iv: string }>) {
          try {
            const payload = await decryptJson<Record<string, unknown>>(key, { v: 1, encrypted: true, iv: h.iv, ct: h.ct })
            out.push({ username: h.username, ...payload })
          } catch {}
        }
        return out
      } catch { return [] }
    },

    // ── Événements partagés ──
    writeSharedEvent: async (sharedEvent: unknown) => {
      try {
        const env = await encryptJson(key, sharedEvent)
        const res = await api('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ct: env.ct, iv: env.iv }) })
        return res.ok
      } catch { return false }
    },
    cleanupSharedEvents: async () => true,
    startEventsWatcher: async () => {
      if (!eventsTimer) eventsTimer = setInterval(pollEvents, 20000)
      return true
    },
    onSharedEvent: (callback: unknown) => { sharedEventCallbacks.push(callback as (d: unknown) => void) },
    readRecentSharedEvents: async (maxAgeMs: unknown) => {
      try {
        const since = Date.now() - (Number(maxAgeMs) || 24 * 3600 * 1000)
        const res = await api(`/api/events?since=${since}`, { timeoutMs: 8000 })
        if (!res.ok) return { events: [], partial: true }
        const { events } = await res.json()
        const out: unknown[] = []
        for (const ev of events as Array<{ id: string, ct: string, iv: string, timestamp: number }>) {
          seenEventIds.add(ev.id)
          lastEventTs = Math.max(lastEventTs, ev.timestamp)
          try { out.push(await decryptJson(key, { v: 1, encrypted: true, iv: ev.iv, ct: ev.ct })) } catch {}
        }
        return { events: out, partial: false }
      } catch { return { events: [], partial: true } }
    },

    // ── Réseau ──
    startNetworkMonitor: async () => {
      if (!netTimer) netTimer = setInterval(probe, 20000)
      return probe()
    },
    stopNetworkMonitor: async () => {
      if (netTimer) { clearInterval(netTimer); netTimer = null }
      return true
    },
    probeNetwork: async () => probe(),
    getNetworkStatus: async () => netStatus,
    onNetworkStatus: (callback: unknown) => { netCallbacks.push(callback as (s: NetState) => void) },

    // ── Journal d'audit ──
    appendAuditLog: async (entry: unknown) => {
      try {
        const env = await encryptJson(key, entry)
        const res = await api('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ct: env.ct, iv: env.iv }) })
        return res.ok
      } catch { return false }
    },
    readAuditLog: async () => {
      try {
        const res = await api('/api/audit')
        if (!res.ok) return []
        const { entries } = await res.json()
        const out: unknown[] = []
        for (const e of entries as Array<{ ct: string, iv: string }>) {
          try { out.push(await decryptJson(key, { v: 1, encrypted: true, iv: e.iv, ct: e.ct })) } catch {}
        }
        return out.reverse() // plus récent en premier
      } catch { return [] }
    },

    // ── Mises à jour (pilotées par le conteneur « updater » du serveur) ──
    // GET /api/update est réservé à l'admin : pour les autres comptes (403),
    // la mise à jour serveur est transparente — aucune notification.
    checkAppUpdate: async (force?: unknown) => {
      const empty = {
        hasUpdate: false, commits: 0,
        localSha: null as string | null, remoteSha: null as string | null,
        approvedSha: null as string | null, approvedBy: null, approvedAt: null,
      }
      try {
        const res = await api(`/api/update${force ? '?force=1' : ''}`, { timeoutMs: force ? 30000 : 15000 })
        if (res.status === 403) return empty
        if (!res.ok) return { ...empty, error: 'Vérification indisponible (' + res.status + ')' }
        const d = await res.json() as { available: boolean, error?: string, localSha: string | null, remoteSha: string | null, commits: number, fetchOk: boolean }
        if (!d.available) return { ...empty, error: d.error || 'Service de mise à jour non installé' }
        return {
          ...empty,
          hasUpdate: !!(d.localSha && d.remoteSha && d.localSha !== d.remoteSha),
          commits: d.commits || 0,
          localSha: d.localSha,
          remoteSha: d.remoteSha,
          // serveur unique : la version installée est de fait celle de tous
          approvedSha: d.localSha,
          ...(d.fetchOk === false ? { error: 'GitHub injoignable depuis le serveur — état possiblement périmé' } : {}),
        }
      } catch {
        return { ...empty, error: 'Serveur injoignable' }
      }
    },
    /**
     * Déclenche la mise à jour du serveur (git pull + rebuild Docker + redémarrage)
     * puis suit la progression jusqu'au retour du serveur. Les échecs réseau
     * pendant le redémarrage du conteneur sont attendus et ignorés.
     */
    applyAppUpdate: async () => {
      const fail = (error: string) => ({ success: false, needsInstall: false, needsRebuild: true, error })
      try {
        const res = await api('/api/update', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'apply' }),
          timeoutMs: 20000,
        })
        const d = await res.json().catch(() => ({})) as { success?: boolean, error?: string }
        if (!res.ok || !d.success) return fail(d.error || 'Demande refusée (' + res.status + ')')
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Serveur injoignable')
      }
      const startedAt = Date.now()
      const deadline = startedAt + 15 * 60 * 1000
      let sawUpdating = false
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000))
        try {
          const res = await api('/api/update', { timeoutMs: 8000 })
          if (!res.ok) continue
          const d = await res.json() as { status?: { state?: string, step?: string, message?: string } }
          const st = d.status?.state
          if (st === 'updating') { sawUpdating = true; continue }
          if (st === 'error') return fail(d.status?.message || ('Échec à l\'étape « ' + (d.status?.step || '?') + ' »'))
          if (st === 'done' && sawUpdating) return { success: true, needsInstall: false, needsRebuild: true, restarted: true }
          // état antérieur (idle/done) : la demande n'est pas encore consommée
          if (!sawUpdating && Date.now() - startedAt > 90000) {
            return fail('Le service de mise à jour ne répond pas — vérifiez le conteneur « updater » sur le serveur')
          }
        } catch { /* conteneur en cours de redémarrage */ }
      }
      return fail('Délai dépassé — vérifiez l\'état du serveur (journal du conteneur updater)')
    },
    getUpdateChangelog: async () => {
      try {
        const res = await api('/api/update')
        if (!res.ok) return { success: false, error: 'Changelog indisponible (' + res.status + ')', commits: [] }
        const d = await res.json() as { available?: boolean, error?: string, commitList?: Array<{ sha: string, message: string, author: string, date: string | null, url: null }> }
        if (d.available === false) return { success: false, error: d.error || 'Service de mise à jour non installé', commits: [] }
        return { success: true, commits: d.commitList || [] }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Serveur injoignable', commits: [] }
      }
    },
    // Publication : sans objet sur la version serveur — mettre à jour le serveur
    // publie de fait la nouvelle version pour tous les utilisateurs, immédiatement.
    approveAppUpdate: async () => ({ success: false, error: 'Sans objet en mode serveur : la mise à jour s\'applique immédiatement à tous les utilisateurs' }),
    unapproveAppUpdate: async () => ({ success: false, error: 'Sans objet en mode serveur' }),
    getApprovedAppUpdate: async () => ({ approvedSha: null, approvedBy: null, approvedAt: null }),

    // ── Mode consultation (spécifique Electron/partage réseau) ──
    consultation_getStatus: async () => ({ enabled: false, deployPath: '', targetUsername: '', activatedAt: '', lastRefreshedAt: '', lastError: '', shellAvailable: false }),
    consultation_pickFolder: async () => null,
    consultation_activate: async () => ({ success: false, error: 'Indisponible en mode web — utilisez un compte en lecture seule' }),
    consultation_deactivate: async () => ({ success: false, error: 'Indisponible en mode web' }),
    consultation_refreshNow: async () => ({ success: false, error: 'Indisponible en mode web' }),

    // ── Cloisonnement par clé individuelle (trousseaux) ──
    e2ee_myScopes: async () => Array.from(keys.byScope.keys()),
    e2ee_listAccounts: async () => {
      const res = await api('/api/accounts')
      if (!res.ok) throw new Error('Liste des comptes indisponible (' + res.status + ')')
      const { accounts } = await res.json()
      return accounts
    },
    /**
     * Invite un collègue : dépose une copie des clés (périmètres choisis,
     * global toujours inclus) chiffrée par un code à usage unique, et
     * retourne ce code — à lui transmettre hors-ligne.
     */
    e2ee_invite: async (username: unknown, scopes?: unknown) => {
      const user = sanitizeName(username)
      const wanted = Array.isArray(scopes) && scopes.length
        ? [SCOPE_GLOBAL, ...((scopes as string[]).filter((s) => s !== SCOPE_GLOBAL))]
        : Object.keys(keys.raw)
      const subset: Record<string, string> = {}
      for (const s of wanted) {
        if (!keys.raw[s]) throw new Error(`Votre trousseau ne contient pas la clé « ${s} »`)
        subset[s] = keys.raw[s]
      }
      const code = generateInvitationCode()
      const kdf = newKdfParams()
      const codeKey = await importAesKey(await deriveRawKey(code, kdf.salt, kdf.iterations))
      const envelope = await encryptJson(codeKey, { v: 1, keys: subset, grantedBy: me.username, grantedAt: nowIso() })
      const res = await api(`/api/vaults/grant-${encodeURIComponent(user)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...envelope, kdfSalt: kdf.salt, kdfIterations: kdf.iterations }),
      })
      if (!res.ok) throw new Error("Dépôt de l'invitation refusé (" + res.status + ')')
      return { code, scopes: Object.keys(subset) }
    },
    /** Révoque l'accès d'un compte : supprime son trousseau et toute invitation en attente. */
    e2ee_revoke: async (username: unknown) => {
      const user = sanitizeName(username)
      const r1 = await api(`/api/vaults/keyring-${encodeURIComponent(user)}`, { method: 'DELETE' })
      const r2 = await api(`/api/vaults/grant-${encodeURIComponent(user)}`, { method: 'DELETE' })
      if (!r1.ok && !r2.ok) throw new Error('Révocation refusée (' + r1.status + ')')
      return true
    },

    // ── Import depuis l'app bureau (Paramètres → Sauvegardes) ──
    /** Chiffre puis pousse un coffre de données — uniquement les cibles connues de l'import. */
    desktopImport_pushVault: async (name: unknown, payload: unknown, meta?: unknown) => {
      const n = String(name)
      if (!DESKTOP_IMPORT_VAULT_RE.test(n)) throw new Error(`Coffre non autorisé à l'import : ${n}`)
      await vaultPush(n, payload, metaOf(meta))
      return true
    },
    /** Dépose un document d'enquête en conservant son chemin relatif d'origine
     *  (saveDocuments renomme — ici les liens des enquêtes doivent rester valides). */
    desktopImport_uploadDocument: async (enquete: unknown, rel: unknown, buffer: unknown, category?: unknown, originalName?: unknown) => {
      await docUpload(
        String(enquete), String(rel), new Uint8Array(buffer as ArrayBuffer),
        category === undefined ? undefined : String(category),
        originalName === undefined ? undefined : String(originalName),
      )
      return true
    },
  }

  // Copies « dossier commun » en attente : tentative au démarrage (réussit si
  // la permission du dossier est encore accordée), sinon rejouées au prochain
  // passage par « Configurer chemin » ou « Synchroniser ».
  setTimeout(() => {
    import('./folderAccess').then((f) => f.flushPendingCopies(docDownload)).catch(() => {})
  }, 8000)

  function metaOf(metadata: unknown): { savedAt?: string, savedBy?: string } {
    const m = metadata as { savedAt?: string, savedBy?: string } | null
    return { savedAt: m?.savedAt, savedBy: m?.savedBy }
  }

  function sanitizeName(v: unknown): string {
    return String(v).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
  }

  return bridge
}
