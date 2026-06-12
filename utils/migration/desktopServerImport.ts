// utils/migration/desktopServerImport.ts
/**
 * SIRAL — import des données de l'app bureau vers le serveur, depuis le
 * navigateur (édition web uniquement).
 *
 * Reprend exactement la cartographie de `scripts/siral-import.js`, mais sans
 * SSH ni phrase de transit : les fichiers sont choisis dans l'app, chiffrés
 * ICI avec le trousseau de l'utilisateur, puis poussés vers les coffres.
 * Le serveur ne reçoit que des enveloppes opaques ; chaque écriture archive
 * la version précédente (rien n'est perdu en cas de fausse manœuvre).
 *
 * Deux étapes, comme le script : analyse (plan lisible, rien n'est envoyé)
 * puis exécution (rapport de complétude — l'import est « incomplet » à la
 * moindre erreur, jamais silencieusement partiel).
 */

export type PlanCategory =
  | 'partage'        // fichiers racine du partage (tags, audiences, alertes…)
  | 'contentieux'    // <ctx>/app-data.json
  | 'instructions'   // *-instructions.json (par utilisateur)
  | 'preferences'    // user-preferences/ et contentieux-alerts/
  | 'documents'      // documentenquete/<enquête>/<catégorie>/<fichier>
  | 'local'          // data.json (copie de travail locale de l'app bureau)
  | 'ignore'         // sauvegardes, fichiers techniques, non reconnus
  | 'bloque';        // clé de contentieux absente du trousseau, JSON illisible

interface VaultWrite {
  vault: string;
  payload: unknown;
  meta?: { savedAt?: string; savedBy?: string };
}

export interface PlanItem {
  id: string;
  /** Chemin relatif affiché (après le dossier racine sélectionné). */
  path: string;
  label: string;
  category: PlanCategory;
  size: number;
  /** Comptage ou raison (« 142 enquêtes », « sauvegarde automatique — ignoré »). */
  detail?: string;
  writes?: VaultWrite[];
  doc?: { enquete: string; rel: string; category?: string; originalName: string; file: File };
  localKv?: Record<string, unknown>;
}

export interface ImportPlan {
  items: PlanItem[];
  /** Éléments qui seront réellement envoyés (hors data.json local, optionnel). */
  actionable: number;
  documents: number;
  ignored: number;
  blocked: number;
  hasLocalData: boolean;
}

export interface ImportReport {
  total: number;
  written: number;
  docsWritten: number;
  docsTotal: number;
  localRestored: boolean;
  errors: Array<{ label: string; message: string }>;
  complete: boolean;
}

// Mêmes règles d'hygiène de noms que scripts/siral-import.js
const sanitizeUser = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
const sanitizeEnquete = (s: string) => s.replace(/[^a-zA-Z0-9._@-]/g, '_');

// Fichiers racine du partage → coffre (identique au script d'import)
const ROOT_FILES: Record<string, { vault: string; label: string }> = {
  'users.json': { vault: 'users-config', label: 'Utilisateurs du service' },
  'tag-data.json': { vault: 'tags', label: 'Tags partagés' },
  'audience-data.json': { vault: 'audience', label: 'Audiences partagées' },
  'alerts-data.json': { vault: 'alerts', label: 'Alertes partagées' },
  'deleted-ids.json': { vault: 'deleted-ids', label: 'Suppressions (tombstones)' },
  'cartographie-overlays.json': { vault: 'cartographie', label: 'Calques de cartographie' },
};

const IGNORED_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /(^|\/)backups?\//i, reason: 'sauvegarde automatique' },
  { re: /app-data-backup/i, reason: 'sauvegarde automatique' },
  { re: /data_backup_/i, reason: 'sauvegarde automatique' },
  { re: /(^|\/)(admin|audit|events|heartbeats|updates)\//i, reason: 'fichier technique (régénéré par le serveur)' },
  { re: /^update-approved\.json$/i, reason: 'fichier technique (mises à jour bureau)' },
  { re: /(^|\/)casiers\//i, reason: 'casiers — à rattacher aux enquêtes depuis l’app' },
  { re: /\.gitkeep$/i, reason: 'fichier technique' },
  { re: /^settings\.txt$/i, reason: 'réglages propres au poste' },
  { re: /^app-data-metadata\.json$/i, reason: 'métadonnées — intégrées avec app-data.json' },
];

/** Déballe les valeurs { version, data } écrites par ElectronBridge dans data.json. */
function unwrap(v: unknown): unknown {
  const o = v as { version?: unknown; data?: unknown } | null;
  return o && typeof o === 'object' && 'data' in o && 'version' in o ? o.data : v;
}

function looksLikeLocalKv(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload as object);
  return keys.some((k) => k === 'enquetes' || k.startsWith('ctx_') || k.startsWith('instructions__'));
}

function countOf(payload: unknown, kind: string): string | undefined {
  try {
    const p = payload as Record<string, unknown>;
    switch (kind) {
      case 'users-config': {
        const arr = Array.isArray(p) ? p : (p?.users as unknown[]);
        return Array.isArray(arr) ? `${arr.length} utilisateur(s)` : undefined;
      }
      case 'ctx': {
        const data = (p?.data ?? p) as Record<string, unknown>;
        const enq = data?.enquetes;
        return Array.isArray(enq) ? `${enq.length} enquête(s)` : undefined;
      }
      case 'instructions': {
        const arr = Array.isArray(p) ? p : (p?.instructions as unknown[]);
        return Array.isArray(arr) ? `${arr.length} dossier(s)` : undefined;
      }
      case 'tags': {
        const tags = (p?.tags ?? p) as Record<string, unknown>;
        return tags && typeof tags === 'object' ? `${Object.keys(tags).length} entrée(s)` : undefined;
      }
      case 'audience':
      case 'alerts':
      case 'cartographie':
      case 'deleted-ids': {
        if (Array.isArray(p)) return `${p.length} entrée(s)`;
        return p && typeof p === 'object' ? `${Object.keys(p).length} entrée(s)` : undefined;
      }
      case 'local': {
        let n = 0;
        for (const [k, v] of Object.entries(p || {})) {
          if (k === 'enquetes' || /^ctx_.+_enquetes$/.test(k)) {
            const data = unwrap(v);
            if (Array.isArray(data)) n += data.length;
          }
        }
        return n ? `${n} enquête(s) dans la copie de travail` : undefined;
      }
    }
  } catch { /* comptage best effort */ }
  return undefined;
}

/**
 * Chemin « utile » d'un fichier sélectionné : webkitRelativePath sans le
 * dossier racine choisi. Si un segment `documentenquete` est présent, tout
 * ce qui suit est traité comme documents d'enquête.
 */
function relevantPath(file: File): { path: string; isDoc: boolean } {
  const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const segments = raw.split('/').filter(Boolean);
  const docIdx = segments.findIndex((s) => s.toLowerCase() === 'documentenquete');
  if (docIdx >= 0) return { path: segments.slice(docIdx + 1).join('/'), isDoc: true };
  // sélection d'un dossier : on retire le dossier racine lui-même
  const path = segments.length > 1 ? segments.slice(1).join('/') : segments[0];
  return { path, isDoc: false };
}

async function readJson(file: File): Promise<unknown> {
  const text = await file.text();
  if (!text.trim()) throw new Error('fichier vide');
  return JSON.parse(text);
}

/**
 * Analyse les fichiers choisis et construit le plan d'import. Ne lit que des
 * JSON (les documents sont référencés, lus à l'exécution). `myScopes` vient
 * de e2ee_myScopes : un contentieux hors trousseau est bloqué, pas envoyé.
 */
export async function analyzeDesktopFiles(files: File[], myScopes: string[]): Promise<ImportPlan> {
  const items: PlanItem[] = [];
  const seenInstructionUsers = new Set<string>();
  const seenVaults = new Set<string>();
  let rootAppData: { file: File; path: string; payload: unknown } | null = null;
  let rootAppDataMeta: unknown = null;
  let nextId = 0;
  const push = (item: Omit<PlanItem, 'id'>) => items.push({ ...item, id: String(nextId++) });
  const scopeOk = (ctx: string) => myScopes.includes(`ctx-${ctx}`);

  for (const file of files) {
    const { path, isDoc } = relevantPath(file);
    if (!path) continue;

    // ── Documents d'enquête : <enquête>/<catégorie>/<fichier> ──
    if (isDoc) {
      const segs = path.split('/');
      if (segs.length < 2) {
        push({ path, label: file.name, category: 'ignore', size: file.size, detail: 'document hors dossier d’enquête' });
        continue;
      }
      const enquete = sanitizeEnquete(segs[0]);
      const rel = segs.slice(1).join('/');
      push({
        path, label: `${segs[0]} — ${rel}`, category: 'documents', size: file.size,
        doc: { enquete, rel, category: segs.length > 2 ? segs[1] : undefined, originalName: segs[segs.length - 1], file },
      });
      continue;
    }

    const ignored = IGNORED_PATTERNS.find((p) => p.re.test(path));
    if (ignored) {
      // les métadonnées racine sont consommées avec app-data.json
      if (/^app-data-metadata\.json$/i.test(path)) {
        try { rootAppDataMeta = await readJson(file); } catch { /* absentes : import sans métadonnées */ }
      }
      push({ path, label: file.name, category: 'ignore', size: file.size, detail: ignored.reason });
      continue;
    }

    if (!path.toLowerCase().endsWith('.json')) {
      push({ path, label: file.name, category: 'ignore', size: file.size, detail: 'non reconnu' });
      continue;
    }

    let payload: unknown;
    try {
      payload = await readJson(file);
    } catch (e) {
      push({ path, label: file.name, category: 'bloque', size: file.size, detail: `JSON illisible (${e instanceof Error ? e.message : 'erreur'})` });
      continue;
    }

    const segs = path.split('/');
    const base = segs[segs.length - 1];

    // ── data.json : copie de travail locale de l'app bureau ──
    if (segs.length === 1 && base === 'data.json' && looksLikeLocalKv(payload)) {
      push({
        path, label: 'data.json (copie de travail locale)', category: 'local', size: file.size,
        detail: countOf(payload, 'local'), localKv: payload as Record<string, unknown>,
      });
      continue;
    }

    // ── Fichiers racine du partage ──
    if (segs.length === 1 && ROOT_FILES[base]) {
      const { vault, label } = ROOT_FILES[base];
      if (seenVaults.has(vault)) {
        push({ path, label: base, category: 'ignore', size: file.size, detail: 'doublon — déjà sélectionné' });
        continue;
      }
      seenVaults.add(vault);
      push({
        path, label, category: 'partage', size: file.size,
        detail: countOf(payload, vault === 'users-config' ? 'users-config' : vault),
        writes: [{ vault, payload }],
      });
      continue;
    }

    // ── app-data.json racine (ancien format mono-contentieux) ──
    if (segs.length === 1 && base === 'app-data.json') {
      rootAppData = { file, path, payload };
      continue; // émis après la boucle (métadonnées éventuelles à associer)
    }

    // ── Contentieux : <dossier>/app-data.json ──
    if (segs.length === 2 && base === 'app-data.json') {
      const ctx = sanitizeUser(segs[0]).toLowerCase();
      const p = payload as { data?: unknown; metadata?: { savedAt?: string; savedBy?: string } | null };
      const normalized = p.data !== undefined ? p : { data: payload, metadata: null };
      if (!scopeOk(ctx)) {
        push({ path, label: `Contentieux ${segs[0]}`, category: 'bloque', size: file.size, detail: `la clé « ${ctx} » n'est pas dans votre trousseau — demandez l'accès à ce contentieux` });
        continue;
      }
      push({
        path, label: `Contentieux ${segs[0]}`, category: 'contentieux', size: file.size,
        detail: countOf(normalized, 'ctx'),
        writes: [{ vault: `ctx-${ctx}`, payload: normalized, meta: normalized.metadata || undefined }],
      });
      continue;
    }

    // ── Instructions par utilisateur : *-instructions.json (racine ou sous-dossier) ──
    if (segs.length <= 2 && base.endsWith('-instructions.json')) {
      const username = sanitizeUser(base.slice(0, -'-instructions.json'.length));
      if (seenInstructionUsers.has(username)) {
        push({ path, label: base, category: 'ignore', size: file.size, detail: 'doublon — déjà sélectionné' });
        continue;
      }
      seenInstructionUsers.add(username);
      push({
        path, label: `Instructions de ${username}`, category: 'instructions', size: file.size,
        detail: countOf(payload, 'instructions'),
        writes: [{ vault: `instructions-${username}`, payload }],
      });
      continue;
    }

    // ── Préférences utilisateur ──
    if (segs.length === 2 && segs[0] === 'user-preferences') {
      const user = sanitizeUser(base.slice(0, -5));
      push({
        path, label: `Préférences de ${base.slice(0, -5)}`, category: 'preferences', size: file.size,
        writes: [{ vault: `user-prefs-${user}`, payload }],
      });
      continue;
    }

    // ── Alertes par contentieux ──
    if (segs.length === 2 && segs[0] === 'contentieux-alerts') {
      const ctx = sanitizeUser(base.slice(0, -5)).toLowerCase();
      if (!scopeOk(ctx)) {
        push({ path, label: `Alertes ${base.slice(0, -5)}`, category: 'bloque', size: file.size, detail: `la clé « ${ctx} » n'est pas dans votre trousseau` });
        continue;
      }
      push({
        path, label: `Règles d'alertes ${base.slice(0, -5)}`, category: 'preferences', size: file.size,
        writes: [{ vault: `ctx-alerts-${ctx}`, payload }],
      });
      continue;
    }

    push({ path, label: base, category: 'ignore', size: file.size, detail: 'non reconnu' });
  }

  // app-data.json racine : coffre legacy + coffre app-data (comme le script)
  if (rootAppData) {
    push({
      path: rootAppData.path, label: 'Données racine (ancien format)', category: 'partage', size: rootAppData.file.size,
      detail: countOf({ data: rootAppData.payload }, 'ctx'),
      writes: [
        { vault: 'app-data', payload: { data: rootAppData.payload, metadata: rootAppDataMeta }, meta: (rootAppDataMeta as { savedAt?: string; savedBy?: string }) || undefined },
        { vault: 'legacy-app-data', payload: rootAppData.payload },
      ],
    });
  }

  const actionable = items.filter((i) => i.writes).length;
  const documents = items.filter((i) => i.doc).length;
  return {
    items,
    actionable,
    documents,
    ignored: items.filter((i) => i.category === 'ignore').length,
    blocked: items.filter((i) => i.category === 'bloque').length,
    hasLocalData: items.some((i) => i.category === 'local'),
  };
}

interface DesktopImportApi {
  desktopImport_pushVault: (name: string, payload: unknown, meta?: unknown) => Promise<boolean>;
  desktopImport_uploadDocument: (enquete: string, rel: string, buffer: ArrayBuffer, category?: string, originalName?: string) => Promise<boolean>;
}

/**
 * Exécute le plan : chiffre et pousse chaque élément, puis rend le rapport de
 * complétude. Comme le script, l'import est déclaré incomplet à la moindre
 * erreur — on n'affiche jamais un succès partiel comme un succès.
 */
export async function executeImportPlan(
  plan: ImportPlan,
  options: {
    importLocalData: boolean;
    onProgress?: (done: number, total: number, label: string) => void;
  },
): Promise<ImportReport> {
  const api = window.electronAPI as unknown as DesktopImportApi;
  if (typeof api?.desktopImport_pushVault !== 'function') {
    throw new Error("Import disponible uniquement dans l'édition web");
  }

  const vaultItems = plan.items.filter((i) => i.writes);
  const docItems = plan.items.filter((i) => i.doc);
  const localItem = options.importLocalData ? plan.items.find((i) => i.localKv) : undefined;
  const total = vaultItems.length + docItems.length + (localItem ? 1 : 0);
  const report: ImportReport = {
    total, written: 0, docsWritten: 0, docsTotal: docItems.length,
    localRestored: false, errors: [], complete: false,
  };
  let done = 0;
  const progress = (label: string) => options.onProgress?.(++done, total, label);

  for (const item of vaultItems) {
    try {
      for (const w of item.writes!) {
        await api.desktopImport_pushVault(w.vault, w.payload, w.meta);
      }
      report.written++;
    } catch (e) {
      report.errors.push({ label: item.label, message: e instanceof Error ? e.message : 'échec de l’envoi' });
    }
    progress(item.label);
  }

  for (const item of docItems) {
    try {
      const d = item.doc!;
      const buffer = await d.file.arrayBuffer();
      await api.desktopImport_uploadDocument(d.enquete, d.rel, buffer, d.category, d.originalName);
      report.docsWritten++;
    } catch (e) {
      report.errors.push({ label: item.label, message: e instanceof Error ? e.message : 'échec du dépôt' });
    }
    progress(item.label);
  }

  if (localItem?.localKv) {
    try {
      // instantané de sécurité de la copie de travail actuelle, puis écriture
      const ts = new Date().toISOString().replace(/:/g, '-');
      await window.electronAPI.copyDataJson(`data_backup_avant_import_${ts}.json`);
      for (const [k, v] of Object.entries(localItem.localKv)) {
        await window.electronAPI.setData(k, v);
      }
      report.localRestored = true;
      report.written++;
    } catch (e) {
      report.errors.push({ label: localItem.label, message: e instanceof Error ? e.message : 'échec de la restauration locale' });
    }
    progress(localItem.label);
  }

  report.complete = report.errors.length === 0
    && report.docsWritten === report.docsTotal
    && report.written === vaultItems.length + (localItem ? 1 : 0);
  return report;
}
