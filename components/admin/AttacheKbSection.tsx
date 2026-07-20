'use client';

/**
 * SIRAL — Attaché de justice · base de connaissances (le « cerveau »).
 *
 * Le fond documentaire durable du cabinet, pensé comme un Obsidian branché
 * sur l'IA : tout est MARKDOWN (tokens économisés), rangé en ARBORESCENCE
 * (téléversement de dossiers entiers, sous-pochettes comprises), consultable
 * ici comme dans un explorateur Windows (pochettes repliables, lecture au
 * clic), et connecté à l'attaché (sommaire dans son prompt, recherche
 * agentique kb_chercher/kb_lire, classement autonome via kb_decrire).
 *
 * E2EE : conversion markdown et chiffrement DANS le navigateur — le serveur
 * ne voit que des enveloppes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Library, UploadCloud, FolderOpen, FolderTree, Plus, PenLine, Trash2, Eye, X,
  ChevronRight, ChevronDown, FileText, Loader2, AlertTriangle, Sparkles, Star,
} from 'lucide-react';
import { fileToMarkdown, titreDepuisFichier } from '@/lib/web/fileToMarkdown';
import { collectDropEntries, incomingFromFileList, cleanRelPath, type Incoming } from '@/lib/web/folderUpload';
import { entrySlug as slug, hash8 } from '@/lib/web/slug';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI?: Record<string, AnyFn> }).electronAPI;

function bridgeFn(name: string): AnyFn {
  const fn = eapi()?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`fonction « ${name} » indisponible — rechargez l'application (Ctrl+Maj+R) après mise à jour`);
  }
  return fn;
}

export interface KbEntry {
  id: string;
  titre: string;
  categorie: string;
  /** Chemin d'arborescence (« Jurisprudence/Cassation/arret-2024.md ») — l'explorateur. */
  chemin?: string;
  description?: string;
  contenu: string;
  source?: string;
  updatedAt?: string;
  /** Document « réflexe » : référence de premier rang, consultée en priorité par l'attaché (2-3 au plus). */
  reflexe?: boolean;
}

interface StagedKb {
  fichier: string;
  chemin: string;       // chemin relatif préservé (sous-pochettes)
  titre: string;
  categorie: string;
  contenu: string;
  avertissement?: string;
  erreur?: string;
}

interface TreeNode { folders: Map<string, TreeNode>; files: KbEntry[] }

export const KB_CATEGORIES = ['jurisprudence', 'textes-circulaires', 'modes-operatoires', 'fiches-reflexes', 'contacts-services', 'autre'];

const MAX_FILES = 400;
/** Plafond de documents « réflexes » — la poignée de références mises en tête. */
const MAX_REFLEXE = 3;
const SKIP_RE = /\.(png|jpe?g|gif|bmp|tiff?|heic|mp3|wav|m4a|ogg|mp4|avi|mov|mkv|zip|rar|7z|exe|dll)$/i;

/** Identifiant d'une entrée versée en arborescence : slug du nom + empreinte du chemin. */
function kbIdFor(chemin: string, titre: string): string {
  const base = slug(titre) || 'entree';
  if (!chemin || !chemin.includes('/')) return base;
  return base.slice(0, 48).replace(/-+$/, '') + '-' + hash8(chemin);
}

function catFromPath(chemin: string): string {
  const seg = chemin.split('/')[0] || '';
  const s = slug(seg).slice(0, 40);
  return s && chemin.includes('/') ? s : 'autre';
}

export function AttacheKbSection({ granted, onNotice }: { granted: boolean; onNotice: (m: string) => void }) {
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [staged, setStaged] = useState<StagedKb[]>([]);
  const [converting, setConverting] = useState(false);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null);
  const [analyseAfter, setAnalyseAfter] = useState(true);
  const [analyseBusy, setAnalyseBusy] = useState(false);            // « Faire ranger toute la base » en cours
  const [analyseMsg, setAnalyseMsg] = useState<string | null>(null); // retour affiché AU BOUTON (le toast est loin en haut)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<KbEntry | null>(null);
  const [form, setForm] = useState<{ open: boolean; original?: string; titre: string; categorie: string; chemin: string; description: string; contenu: string; reflexe?: boolean }>({ open: false, titre: '', categorie: KB_CATEGORIES[0], chemin: '', description: '', contenu: '' });
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/kb');
      if (!res.ok) return;
      const { entries: envs } = await res.json();
      const decrypt = bridgeFn('attache_decrypt');
      const out: KbEntry[] = [];
      for (const e of (envs || []) as Array<{ id: string; envelope: unknown }>) {
        const payload = await decrypt(e.envelope) as KbEntry | null;
        if (payload?.contenu) out.push({ ...payload, id: payload.id || e.id, categorie: payload.categorie || 'autre' });
      }
      setEntries(out.sort((a, b) => (a.chemin || a.titre).localeCompare(b.chemin || b.titre)));
    } catch { /* silencieux — les erreurs remontent sur les actions */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Conversion markdown de l'arborescence choisie — tout dans CE navigateur. */
  const stage = useCallback(async (incoming: Incoming[]) => {
    const list = incoming.slice(0, MAX_FILES);
    if (!list.length) return;
    setConverting(true);
    setStaged([]);
    const rows: StagedKb[] = [];
    for (const { file, path } of list) {
      const chemin = cleanRelPath(path);
      const base = {
        fichier: file.name,
        chemin,
        titre: titreDepuisFichier(file.name),
        categorie: catFromPath(chemin),
        contenu: '',
      };
      try {
        if (SKIP_RE.test(file.name)) throw new Error('pas de texte à extraire (image/média/archive)');
        const { markdown, avertissement } = await fileToMarkdown(file);
        if (!markdown.trim()) rows.push({ ...base, erreur: avertissement || 'aucun texte extractible' });
        else rows.push({ ...base, contenu: markdown, avertissement });
      } catch (e) {
        rows.push({ ...base, erreur: e instanceof Error ? e.message : String(e) });
      }
      setStaged([...rows]);
    }
    if (incoming.length > MAX_FILES) {
      rows.push({ fichier: `… ${incoming.length - MAX_FILES} fichier(s) au-delà de la limite de ${MAX_FILES}`, chemin: '', titre: '', categorie: 'autre', contenu: '', erreur: 'limite par versement atteinte — versez le reste séparément' });
      setStaged([...rows]);
    }
    setConverting(false);
  }, []);

  /** Met à jour l'état local (upsert) — évite de re-télécharger et re-déchiffrer toute la base. */
  const upsertLocal = useCallback((records: KbEntry[]) => {
    setEntries((prev) => {
      const byId = new Map(prev.map((e) => [e.id, e]));
      for (const r of records) byId.set(r.id, r);
      return [...byId.values()].sort((a, b) => (a.chemin || a.titre).localeCompare(b.chemin || b.titre));
    });
  }, []);

  const reflexes = useMemo(() => entries.filter((e) => e.reflexe), [entries]);

  /**
   * Étoile « réflexe » : bascule le marquage d'une entrée. Plafonné à
   * MAX_REFLEXE — le flag voyage DANS l'enveloppe chiffrée (re-chiffrée ici),
   * l'attaché le lit ensuite pour consulter ces documents en priorité.
   */
  const toggleReflexe = useCallback(async (entry: KbEntry) => {
    const want = !entry.reflexe;
    if (want && entries.filter((e) => e.reflexe && e.id !== entry.id).length >= MAX_REFLEXE) {
      onNotice(`Déjà ${MAX_REFLEXE} documents réflexes — retirez l'étoile d'un autre avant d'en désigner un nouveau.`);
      return;
    }
    const record: KbEntry = { ...entry, updatedAt: new Date().toISOString() };
    if (want) record.reflexe = true; else delete record.reflexe;
    try {
      const envelope = await bridgeFn('attache_encrypt')(record);
      const res = await fetch('/api/attache/kb', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: record.id, envelope }),
      });
      if (!res.ok) { onNotice(`Marquage refusé : ${(await res.json().catch(() => ({} as { error?: string }))).error || res.status}`); return; }
      upsertLocal([record]);
      onNotice(want
        ? `« ${entry.titre} » est désormais un document réflexe — l'attaché le consultera par réflexe, avant les autres.`
        : `« ${entry.titre} » n'est plus un document réflexe.`);
    } catch (e) {
      onNotice(`Marquage impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [entries, upsertLocal, onNotice]);

  const saveStaged = useCallback(async () => {
    const valid = staged.filter((s) => !s.erreur && s.contenu.trim() && slug(s.titre));
    if (!valid.length) return;
    const encrypt = bridgeFn('attache_encrypt');
    const savedIds: string[] = [];
    const savedRecords: KbEntry[] = [];
    const failed: string[] = [];
    let n = 0;
    for (const s of valid) {
      n++;
      setUploadBusy(`${n}/${valid.length}`);
      const cheminMd = s.chemin ? s.chemin.replace(/\.[^./]+$/, '') + '.md' : '';
      const id = kbIdFor(cheminMd, s.titre);
      const record: KbEntry = {
        id,
        titre: s.titre.trim().slice(0, 160),
        categorie: slug(s.categorie).slice(0, 40) || 'autre',
        chemin: cheminMd || undefined,
        description: '',
        contenu: s.contenu.slice(0, 400_000),
        source: s.fichier,
        updatedAt: new Date().toISOString(),
      };
      try {
        const envelope = await encrypt(record);
        const res = await fetch('/api/attache/kb', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, envelope }),
        });
        if (res.ok) { savedIds.push(id); savedRecords.push(record); }
        else {
          const data = await res.json().catch(() => ({} as { error?: string }));
          failed.push(`${s.fichier} (${data.error || res.status})`);
        }
      } catch (e) {
        failed.push(`${s.fichier} (${e instanceof Error ? e.message : 'erreur'})`);
      }
    }
    setUploadBusy(null);
    setStaged([]);
    upsertLocal(savedRecords);
    let msg = `${savedIds.length} entrée(s) ajoutée(s) à la base de connaissances${failed.length ? ` — échec : ${failed.join(', ')}` : ''}.`;
    if (savedIds.length && analyseAfter) {
      const res = await fetch('/api/attache/kb', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analyse: savedIds }),
      }).catch(() => null);
      msg += res?.ok
        ? ' Classement lancé : l\'attaché décrit et range chaque entrée — résultat dans le fil « pendant votre absence » (rapide).'
        : ' Classement non lancé (service occupé ou injoignable) — relancez depuis ce panneau.';
    }
    onNotice(msg);
  }, [staged, analyseAfter, upsertLocal, onNotice]);

  const saveForm = useCallback(async () => {
    const chemin = cleanRelPath(form.chemin || '');
    const id = form.original || kbIdFor(chemin, form.titre);
    if (!slug(form.titre)) { onNotice('Titre invalide — lettres, chiffres et tirets.'); return; }
    if (!form.contenu.trim()) return;
    try {
      const record: KbEntry = {
        id,
        titre: form.titre.trim().slice(0, 160),
        categorie: slug(form.categorie).slice(0, 40) || 'autre',
        chemin: chemin || undefined,
        description: form.description.trim().slice(0, 300),
        contenu: form.contenu.slice(0, 400_000),
        updatedAt: new Date().toISOString(),
        ...(form.reflexe ? { reflexe: true } : {}),
      };
      const envelope = await bridgeFn('attache_encrypt')(record);
      const res = await fetch('/api/attache/kb', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, envelope }),
      });
      if (!res.ok) { onNotice(`Enregistrement refusé : ${(await res.json().catch(() => ({} as { error?: string }))).error || res.status}`); return; }
      setForm({ open: false, titre: '', categorie: KB_CATEGORIES[0], chemin: '', description: '', contenu: '' });
      onNotice(`Entrée « ${form.titre} » enregistrée — l'attaché la voit dès le prochain échange.`);
      upsertLocal([record]);
    } catch (e) {
      onNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [form, upsertLocal, onNotice]);

  const removeEntries = useCallback(async (list: KbEntry[], label: string) => {
    if (!window.confirm(`Supprimer ${label} (${list.length} entrée(s)) ?\nLa dernière version de chacune reste archivée côté serveur.`)) return;
    const failed: string[] = [];
    const removedIds = new Set<string>();
    for (const e of list) {
      try {
        const res = await fetch('/api/attache/kb?id=' + encodeURIComponent(e.id), { method: 'DELETE' });
        const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
        if (!res.ok) failed.push(`${e.titre} (${data.error || res.status})`);
        else removedIds.add(e.id); // ok:false = déjà absent côté serveur : retiré aussi
      } catch {
        failed.push(e.titre);
      }
    }
    setEntries((prev) => prev.filter((e) => !removedIds.has(e.id)));
    if (failed.length) onNotice(`Suppression incomplète : ${failed.join(', ')}`);
    else onNotice(`${list.length} entrée(s) supprimée(s) (versions archivées côté serveur).`);
  }, [onNotice]);

  const analyse = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    // Sans trousseau, le service ne peut pas déchiffrer la base : on le dit
    // clairement AU LIEU d'un bouton mort qui ne réagit pas (feedback local + toast).
    if (!granted) {
      const m = 'Remettez d\'abord les clés à l\'attaché (bouton « Remettre les clés » en haut du panneau) — sans elles, il ne peut pas lire la base pour la ranger.';
      setAnalyseMsg(m);
      onNotice(m);
      return;
    }
    setAnalyseBusy(true);
    setAnalyseMsg(`Rangement de ${ids.length} entrée(s) en cours de lancement…`);
    onNotice(`Rangement de ${ids.length} entrée(s) en cours de lancement…`);
    const res = await fetch('/api/attache/kb', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analyse: ids }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({} as { error?: string })) : { error: 'service injoignable' };
    const msg = res?.ok
      ? `Rangement de ${ids.length} entrée(s) lancé — l'attaché lit chaque document, le décrit, le classe et signale doublons/contenu périmé (fil « pendant votre absence »).`
      : `Rangement impossible : ${data.error || 'erreur'}`;
    setAnalyseMsg(msg);
    onNotice(msg);
    setAnalyseBusy(false);
  }, [granted, onNotice]);

  // ── Arborescence type explorateur : chemin > catégorie/titre ──
  const tree = useMemo(() => {
    const root: TreeNode = { folders: new Map(), files: [] };
    for (const e of entries) {
      const chemin = e.chemin || `${e.categorie || 'autre'}/${e.titre}`;
      const segs = chemin.split('/').filter(Boolean);
      let node = root;
      for (const seg of segs.slice(0, -1)) {
        if (!node.folders.has(seg)) node.folders.set(seg, { folders: new Map(), files: [] });
        node = node.folders.get(seg)!;
      }
      node.files.push(e);
    }
    return root;
  }, [entries]);

  const countFiles = (node: TreeNode): number => {
    let n = node.files.length;
    for (const child of node.folders.values()) n += countFiles(child);
    return n;
  };
  const collectEntries = (node: TreeNode): KbEntry[] => {
    const out = [...node.files];
    for (const child of node.folders.values()) out.push(...collectEntries(child));
    return out;
  };

  const renderNode = (node: TreeNode, prefix: string, depth: number): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    for (const [name, child] of [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const key = prefix + name + '/';
      const isCollapsed = collapsed.has(key);
      rows.push(
        <div key={key} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 16 }}>
          <button onClick={() => setCollapsed((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {isCollapsed ? <ChevronRight className="h-3 w-3 flex-shrink-0 text-gray-400" /> : <ChevronDown className="h-3 w-3 flex-shrink-0 text-gray-400" />}
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
            <span className="truncate text-xs font-medium text-gray-700">{name}</span>
            <span className="text-[10px] text-gray-400">({countFiles(child)})</span>
          </button>
          <button onClick={() => removeEntries(collectEntries(child), `la pochette « ${name} »`)}
            title="Supprimer la pochette" className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      );
      if (!isCollapsed) rows.push(...renderNode(child, key, depth + 1));
    }
    for (const e of [...node.files].sort((a, b) => a.titre.localeCompare(b.titre))) {
      rows.push(
        <div key={e.id} className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50" style={{ paddingLeft: 8 + depth * 16 + 16 }}>
          {e.reflexe
            ? <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" />
            : <FileText className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />}
          <button onClick={() => setPreview(e)} className="min-w-0 flex-1 truncate text-left text-xs text-gray-700 hover:text-gray-900" title={e.description || e.titre}>
            {e.titre}
            {e.description && <span className="ml-1.5 text-[10px] text-gray-400">— {e.description}</span>}
          </button>
          <span className="whitespace-nowrap text-[10px] text-gray-400">{Math.round((e.contenu || '').length / 1000)} k</span>
          <button onClick={() => toggleReflexe(e)}
            title={e.reflexe ? 'Document réflexe — cliquer pour retirer l’étoile' : `Désigner comme document réflexe (consulté en priorité par l’attaché, ${MAX_REFLEXE} au plus)`}
            className={`rounded p-0.5 ${e.reflexe ? 'text-amber-400 hover:bg-amber-50 hover:text-amber-500' : 'text-gray-300 hover:bg-amber-50 hover:text-amber-400'}`}>
            <Star className={`h-3 w-3 ${e.reflexe ? 'fill-amber-400' : ''}`} />
          </button>
          <button onClick={() => setPreview(e)} title="Lire" className="rounded p-0.5 text-gray-300 hover:bg-indigo-50 hover:text-indigo-600">
            <Eye className="h-3 w-3" />
          </button>
          <button
            onClick={() => setForm({ open: true, original: e.id, titre: e.titre, categorie: e.categorie, chemin: e.chemin || '', description: e.description || '', contenu: e.contenu, reflexe: e.reflexe })}
            title="Modifier" className="rounded p-0.5 text-gray-300 hover:bg-emerald-50 hover:text-[#2B5746]">
            <PenLine className="h-3 w-3" />
          </button>
          <button onClick={() => removeEntries([e], `« ${e.titre} »`)} title="Supprimer" className="rounded p-0.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      );
    }
    return rows;
  };

  return (
    <div className="rounded-xl border border-gray-200">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Library className="h-4 w-4 text-[#2B5746]" />
        <span className="text-sm font-semibold text-gray-800">Base de connaissances</span>
        <span className="text-[11px] text-gray-400">le cerveau documentaire de l&apos;attaché — markdown, arborescence préservée, classement IA · ★ documents réflexes</span>
        <input ref={fileInput} type="file" multiple className="hidden"
          onChange={(e) => { stage(incomingFromFileList(e.target.files)); e.currentTarget.value = ''; }} />
        <input ref={folderInput} type="file" multiple className="hidden" {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => { stage(incomingFromFileList(e.target.files)); e.currentTarget.value = ''; }} />
        <button
          onClick={() => folderInput.current?.click()}
          disabled={converting || uploadBusy !== null}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          title="Téléverser un dossier entier — sous-pochettes comprises, arborescence préservée"
        >
          <FolderTree className="h-3 w-3" />Dossier
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={converting || uploadBusy !== null}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <UploadCloud className="h-3 w-3" />Fichiers
        </button>
        <button
          onClick={() => setForm({ open: !form.open, titre: '', categorie: KB_CATEGORIES[0], chemin: '', description: '', contenu: '' })}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          <Plus className="h-3 w-3" />Nouvelle
        </button>
      </div>

      {/* Zone de dépôt : dossiers entiers acceptés (récursif) */}
      <div
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault(); setDragOver(false);
          const incoming = await collectDropEntries(e.dataTransfer.items);
          if (incoming.length) stage(incoming);
          else if (e.dataTransfer.files?.length) stage(incomingFromFileList(e.dataTransfer.files));
        }}
        className={`mx-3 mt-2 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 text-[11px] transition-all
          ${dragOver ? 'border-[#2B5746]/60 bg-emerald-50 text-[#2B5746]' : 'border-gray-200 text-gray-400'}`}
      >
        <UploadCloud className="h-3.5 w-3.5" />
        Glissez ici des fichiers OU un dossier entier (sous-pochettes comprises) — converti en markdown dans ce navigateur, arborescence préservée
      </div>

      {staged.length > 0 && (
        <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
          <div className="text-[11px] font-semibold text-gray-600">
            {converting
              ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Conversion en markdown ({staged.length} fichier{staged.length > 1 ? 's' : ''})…</span>
              : `${staged.filter((s) => !s.erreur).length} entrée(s) prête(s) sur ${staged.length} — ajustez titre et catégorie avant d'enregistrer.`}
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {staged.map((s, i) => (
              <div key={s.fichier + i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                <span className="max-w-[30%] truncate text-[10.5px] text-gray-400" title={s.chemin || s.fichier}>{s.chemin || s.fichier}</span>
                {s.erreur ? (
                  <span className="flex-1 truncate text-[11px] text-red-500" title={s.erreur}>✗ {s.erreur}</span>
                ) : (
                  <>
                    <input
                      value={s.titre}
                      onChange={(e) => setStaged(staged.map((r, j) => (j === i ? { ...r, titre: e.target.value } : r)))}
                      className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                    />
                    <input
                      value={s.categorie}
                      list="kb-categories-staged"
                      onChange={(e) => setStaged(staged.map((r, j) => (j === i ? { ...r, categorie: e.target.value } : r)))}
                      className="w-36 rounded border border-gray-200 bg-white px-1.5 py-1 text-[10.5px] text-gray-600 outline-none"
                    />
                    <span className="whitespace-nowrap text-[10px] text-gray-400">{Math.round(s.contenu.length / 1000)} k</span>
                    {s.avertissement && <span title={s.avertissement}><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /></span>}
                  </>
                )}
              </div>
            ))}
          </div>
          <datalist id="kb-categories-staged">
            {KB_CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
              <input type="checkbox" checked={analyseAfter} onChange={(e) => setAnalyseAfter(e.target.checked)} />
              Faire analyser et classer par l&apos;attaché (description + catégorie mises à jour, fil « pendant votre absence »)
            </label>
            <button onClick={() => setStaged([])} disabled={uploadBusy !== null}
              className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Annuler</button>
            <button onClick={saveStaged} disabled={converting || uploadBusy !== null || !staged.some((s) => !s.erreur)}
              className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {uploadBusy ? `Enregistrement ${uploadBusy}…` : `Enregistrer ${staged.filter((s) => !s.erreur).length} entrée(s)`}
            </button>
          </div>
        </div>
      )}

      {form.open && (
        <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
          <div className="flex gap-2">
            <input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })}
              placeholder="Titre (ex. Circulaire captation de données 2024)"
              className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
            <input value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}
              list="kb-categories" placeholder="Catégorie"
              className="w-40 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
            <datalist id="kb-categories">
              {KB_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div className="flex gap-2">
            <input value={form.chemin} onChange={(e) => setForm({ ...form, chemin: e.target.value })}
              placeholder="Pochette (ex. Jurisprudence/Cassation/arret-2024.md) — optionnel, range l'entrée dans l'explorateur"
              className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
          </div>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description — ce que contient l'entrée et quand s'en servir (guide la recherche de l'attaché)"
            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
          <textarea value={form.contenu} onChange={(e) => setForm({ ...form, contenu: e.target.value })} rows={8}
            placeholder="Le contenu (markdown) — collez un texte, une jurisprudence, une fiche, une liste de contacts…"
            className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#2B5746]/50" />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setForm({ open: false, titre: '', categorie: KB_CATEGORIES[0], chemin: '', description: '', contenu: '' })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
            <button onClick={saveForm} disabled={!form.titre.trim() || !form.contenu.trim()}
              className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Enregistrer</button>
          </div>
        </div>
      )}

      {reflexes.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50/50 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-400" />
            <span className="text-[11px] font-semibold text-amber-700">Documents réflexes</span>
            <span className="text-[10px] text-amber-600/80">consultés en priorité par l&apos;attaché, avant le reste du fond · {reflexes.length}/{MAX_REFLEXE}</span>
          </div>
          {reflexes.map((e) => (
            <div key={e.id} className="flex items-center gap-1.5 py-0.5">
              <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-400" />
              <button onClick={() => setPreview(e)} className="min-w-0 flex-1 truncate text-left text-xs text-gray-800 hover:text-gray-900" title={e.description || e.titre}>
                {e.titre}
                {e.description && <span className="ml-1.5 text-[10px] text-gray-500">— {e.description}</span>}
              </button>
              <button onClick={() => toggleReflexe(e)} title="Retirer des documents réflexes"
                className="rounded p-0.5 text-amber-500 hover:bg-amber-100 hover:text-amber-700">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && staged.length === 0 && !form.open ? (
        <p className="px-3 py-3 text-xs text-gray-400">
          Base vide. Téléversez votre fond documentaire — un DOSSIER ENTIER avec ses sous-pochettes si vous voulez :
          l&apos;arborescence est préservée, tout est converti en markdown ici même, chiffré, puis consulté par l&apos;attaché
          à la demande (kb_chercher / kb_lire) avant ses analyses et rédactions.
        </p>
      ) : entries.length > 0 && (
        <div className="max-h-80 overflow-y-auto py-1">
          {renderNode(tree, '', 0)}
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-100 px-3 py-2">
          <div className="flex items-center gap-2">
            <button onClick={() => analyse(entries.map((e) => e.id))} disabled={analyseBusy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              title="L'attaché relit chaque entrée, met à jour description et catégorie, signale les doublons et le contenu périmé">
              {analyseBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Faire ranger toute la base par l&apos;attaché
            </button>
            <span className="ml-auto text-[10.5px] text-gray-400">{entries.length} entrée(s) · tout est markdown, chiffré, versionné</span>
          </div>
          {!granted && (
            <p className="text-[10.5px] text-amber-600">
              Remettez d&apos;abord les clés à l&apos;attaché (bouton « Remettre les clés » en haut du panneau) pour lancer le rangement.
            </p>
          )}
          {analyseMsg && (
            <p className="text-[10.5px] leading-relaxed text-gray-500">{analyseMsg}</p>
          )}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={() => setPreview(null)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
              <FileText className="h-4 w-4 text-[#2B5746]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-800">{preview.titre}</div>
                <div className="truncate text-[10.5px] text-gray-400">
                  {preview.chemin || preview.categorie}{preview.description ? ` — ${preview.description}` : ''}
                </div>
              </div>
              <button
                onClick={() => { setForm({ open: true, original: preview.id, titre: preview.titre, categorie: preview.categorie, chemin: preview.chemin || '', description: preview.description || '', contenu: preview.contenu, reflexe: preview.reflexe }); setPreview(null); }}
                className="rounded-md p-1 text-gray-400 hover:bg-emerald-50 hover:text-[#2B5746]" title="Modifier"
              >
                <PenLine className="h-4 w-4" />
              </button>
              <button onClick={() => setPreview(null)} className="rounded-md p-1 text-gray-400 hover:bg-gray-50"><X className="h-4 w-4" /></button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap px-4 py-3 font-sans text-[12.5px] leading-relaxed text-gray-700">{preview.contenu.slice(0, 200_000)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
