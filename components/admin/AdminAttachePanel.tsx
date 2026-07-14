'use client';

/**
 * SIRAL — Attaché de justice · panneau d'administration.
 *
 * - État du service (clé-maître, trousseau, Claude Code, boîte mail).
 * - Remise des clés : depuis CE navigateur déverrouillé, les clés brutes des
 *   seuls périmètres confiés partent en HTTPS vers le service attaché, qui
 *   les enveloppe aussitôt avec sa clé-maître. L'app ne les stocke jamais.
 * - Révocation : suppression du trousseau — l'attaché est aveugle aussitôt.
 * - Journal d'audit : chaque action de l'attaché, déchiffrée ici.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Scale, KeyRound, ShieldOff, RefreshCw, CheckCircle2, XCircle, Loader2, ScrollText, AlarmClock, Play, Trash2, Plus, SlidersHorizontal, Globe, PenLine, Sparkles, BookOpen, Library, UploadCloud, AlertTriangle } from 'lucide-react';
import { MODEL_OPTIONS, EFFORT_OPTIONS, SUBMODEL_OPTIONS, AttacheConfig, saveAttacheConfig } from '../attache/modelOptions';
import { fileToMarkdown, titreDepuisFichier } from '@/lib/web/fileToMarkdown';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI?: Record<string, AnyFn> }).electronAPI;

/** Fonction du pont web/Electron — erreur claire si le bundle est périmé. */
function bridgeFn(name: string): AnyFn {
  const api = eapi();
  const fn = api?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`fonction « ${name} » indisponible — rechargez l'application (Ctrl+Maj+R) après mise à jour`);
  }
  return fn;
}

interface AuditEntry { action: string; at?: string; outil?: string; contexte?: string; [k: string]: unknown }

interface Routine {
  id: string; nom: string; prompt: string; heure?: string; intervalleHeures?: number;
  actif: boolean; lastRunAt?: string; lastRunOk?: boolean | null;
}

interface Skill { nom: string; description?: string; contenu: string; updatedAt?: string }
interface Trame { nom: string; description?: string; contenu: string; updatedAt?: string }
interface KbEntry { id: string; titre: string; categorie: string; description?: string; contenu: string; source?: string; updatedAt?: string }

/** Ligne en attente après conversion d'un fichier téléversé (avant chiffrement + enregistrement). */
interface StagedDoc {
  fichier: string;
  titre: string;        // trames : deviendra le nom (slug) ; kb : le titre affiché
  categorie: string;    // kb uniquement
  contenu: string;
  avertissement?: string;
  erreur?: string;
}

/** Nom de fichier d'une skill — miroir EXACT de safeSkillName (scripts/attache/skills.mjs). */
function skillSlug(nom: string): string {
  return String(nom).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Miroir de safeKbId (kb.mjs) et safeName (trames.mjs) — mêmes règles que skillSlug. */
const entrySlug = skillSlug;

/** Catégories proposées — miroir de KB_CATEGORIES (scripts/attache/kb.mjs), champ libre accepté. */
const KB_CATEGORIES = ['jurisprudence', 'textes-circulaires', 'modes-operatoires', 'fiches-reflexes', 'contacts-services', 'autre'];

const UPLOAD_ACCEPT = '.pdf,.odt,.ott,.docx,.doc,.txt,.md,.markdown,.csv,.html,.htm,.eml,.rtf,.log';

function Dot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
      <span className={ok ? 'text-gray-700' : 'text-red-600'}>{label}</span>
    </span>
  );
}

export function AdminAttachePanel() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [audit, setAudit] = useState<Array<AuditEntry & { ts: number }>>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [showRoutineForm, setShowRoutineForm] = useState(false);
  const [rForm, setRForm] = useState({ nom: '', prompt: '', heure: '07:00', mode: 'heure' as 'heure' | 'intervalle', intervalleHeures: 4 });
  const [config, setConfig] = useState<AttacheConfig>({});
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillForm, setSkillForm] = useState<{ open: boolean; original?: string; nom: string; description: string; contenu: string }>({ open: false, nom: '', description: '', contenu: '' });
  const [skillSaving, setSkillSaving] = useState(false);
  // ── Bibliothèque de trames + base de connaissances (téléversement en masse) ──
  const [trames, setTrames] = useState<Trame[]>([]);
  const [trameForm, setTrameForm] = useState<{ open: boolean; original?: string; nom: string; description: string; contenu: string }>({ open: false, nom: '', description: '', contenu: '' });
  const [kbEntries, setKbEntries] = useState<KbEntry[]>([]);
  const [kbForm, setKbForm] = useState<{ open: boolean; original?: string; titre: string; categorie: string; description: string; contenu: string }>({ open: false, titre: '', categorie: KB_CATEGORIES[0], description: '', contenu: '' });
  const [staged, setStaged] = useState<StagedDoc[]>([]);
  const [stagedKind, setStagedKind] = useState<'trames' | 'kb' | null>(null);
  const [converting, setConverting] = useState(false);
  const [analyseAfter, setAnalyseAfter] = useState(true);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null); // « 3/12 » pendant l'enregistrement
  const trameFileInput = useRef<HTMLInputElement>(null);
  const kbFileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setConfig(data.config || {});
      } else {
        setStatus({ unavailable: true, code: res.status });
      }
    } catch {
      setStatus({ unavailable: true });
    } finally {
      setLoading(false);
    }
  }, []);

  /** Modèle / effort / web : appliqué à TOUS les runs (chat, mails, brief, routines). */
  const updateConfig = useCallback(async (patch: AttacheConfig) => {
    const next = { ...config, ...patch };
    setConfig(next);
    const ok = await saveAttacheConfig(patch);
    if (!ok) setNotice('Enregistrement de la configuration refusé — service attaché injoignable ?');
  }, [config]);

  const loadRoutines = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/routines');
      if (res.ok) setRoutines((await res.json()).routines || []);
    } catch { /* silencieux */ }
  }, []);

  // ── Skills (comme Claude web) : enveloppes déchiffrées dans CE navigateur ──
  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/skills');
      if (!res.ok) return;
      const { skills: envs } = await res.json();
      const decrypt = bridgeFn('attache_decrypt');
      const out: Skill[] = [];
      for (const e of (envs || []) as Array<{ id: string; envelope: unknown }>) {
        const payload = await decrypt(e.envelope) as Skill | null;
        if (payload?.contenu) out.push({ ...payload, nom: payload.nom || e.id });
      }
      setSkills(out.sort((a, b) => a.nom.localeCompare(b.nom)));
    } catch { /* silencieux — les erreurs remontent sur les actions */ }
  }, []);

  // ── Trames et base de connaissances : mêmes enveloppes, déchiffrées ICI ──
  const loadTrames = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/trames');
      if (!res.ok) return;
      const { trames: envs } = await res.json();
      const decrypt = bridgeFn('attache_decrypt');
      const out: Trame[] = [];
      for (const e of (envs || []) as Array<{ id: string; envelope: unknown }>) {
        const payload = await decrypt(e.envelope) as Trame | null;
        if (payload?.contenu) out.push({ ...payload, nom: payload.nom || e.id });
      }
      setTrames(out.sort((a, b) => a.nom.localeCompare(b.nom)));
    } catch { /* silencieux — les erreurs remontent sur les actions */ }
  }, []);

  const loadKb = useCallback(async () => {
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
      setKbEntries(out.sort((a, b) => a.categorie.localeCompare(b.categorie) || a.titre.localeCompare(b.titre)));
    } catch { /* silencieux */ }
  }, []);

  useEffect(() => { refresh(); loadRoutines(); loadSkills(); loadTrames(); loadKb(); }, [refresh, loadRoutines, loadSkills, loadTrames, loadKb]);

  /** Conversion des fichiers choisis — tout se passe dans CE navigateur (E2EE). */
  const stageFiles = useCallback(async (kind: 'trames' | 'kb', files: FileList | null) => {
    if (!files?.length) return;
    setConverting(true);
    setStagedKind(kind);
    setStaged([]);
    const rows: StagedDoc[] = [];
    for (const file of Array.from(files)) {
      const base = { fichier: file.name, titre: titreDepuisFichier(file.name), categorie: KB_CATEGORIES[0], contenu: '' };
      try {
        const { markdown, avertissement } = await fileToMarkdown(file);
        if (!markdown.trim()) rows.push({ ...base, erreur: 'aucun texte extractible' });
        else rows.push({ ...base, contenu: markdown, avertissement });
      } catch (e) {
        rows.push({ ...base, erreur: e instanceof Error ? e.message : String(e) });
      }
      setStaged([...rows]); // progression visible fichier par fichier
    }
    setConverting(false);
  }, []);

  /** Enregistrement en masse : chiffrement navigateur puis dépôt enveloppe par enveloppe. */
  const saveStaged = useCallback(async () => {
    if (!stagedKind) return;
    const valid = staged.filter((s) => !s.erreur && s.contenu.trim() && entrySlug(s.titre));
    if (!valid.length) return;
    const encrypt = bridgeFn('attache_encrypt');
    const savedNoms: string[] = [];
    const failed: string[] = [];
    let n = 0;
    for (const s of valid) {
      n++;
      setUploadBusy(`${n}/${valid.length}`);
      const id = entrySlug(s.titre);
      const record = stagedKind === 'trames'
        ? { nom: id, description: '', contenu: s.contenu.slice(0, 200_000), updatedAt: new Date().toISOString() }
        : { id, titre: s.titre.trim().slice(0, 160), categorie: s.categorie || 'autre', description: '', contenu: s.contenu.slice(0, 400_000), source: s.fichier, updatedAt: new Date().toISOString() };
      try {
        const envelope = await encrypt(record);
        const res = await fetch(stagedKind === 'trames' ? '/api/attache/trames' : '/api/attache/kb', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, envelope }),
        });
        if (res.ok) savedNoms.push(id); else failed.push(s.fichier);
      } catch {
        failed.push(s.fichier);
      }
    }
    setUploadBusy(null);
    setStaged([]);
    const kind = stagedKind;
    setStagedKind(null);
    if (kind === 'trames') {
      loadTrames();
      if (savedNoms.length && analyseAfter) {
        const res = await fetch('/api/attache/trames', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ analyse: savedNoms }),
        }).catch(() => null);
        setNotice(
          `${savedNoms.length} trame(s) enregistrée(s)${failed.length ? ` — échec : ${failed.join(', ')}` : ''}. ` +
          (res?.ok ? 'Analyse lancée : classement et propositions d\'amélioration arriveront dans le fil « pendant votre absence ».'
            : 'Analyse non lancée (service occupé ou injoignable) — relancez depuis ce panneau.')
        );
      } else {
        setNotice(`${savedNoms.length} trame(s) enregistrée(s)${failed.length ? ` — échec : ${failed.join(', ')}` : ''}.`);
      }
    } else {
      loadKb();
      setNotice(`${savedNoms.length} entrée(s) ajoutée(s) à la base de connaissances${failed.length ? ` — échec : ${failed.join(', ')}` : ''}.`);
    }
  }, [staged, stagedKind, analyseAfter, loadTrames, loadKb]);

  /** Relance l'analyse IA (classement + propositions) sur des trames déjà en bibliothèque. */
  const analyseTrames = useCallback(async (noms: string[]) => {
    if (!noms.length) return;
    const res = await fetch('/api/attache/trames', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analyse: noms }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({} as { error?: string })) : { error: 'service injoignable' };
    setNotice(res?.ok
      ? `Analyse de ${noms.length} trame(s) lancée — résultat dans le fil « pendant votre absence ».`
      : `Analyse impossible : ${data.error || 'erreur'}`);
  }, []);

  const saveTrameForm = useCallback(async () => {
    const id = entrySlug(trameForm.nom);
    if (!id) { setNotice('Nom de trame invalide — lettres, chiffres et tirets.'); return; }
    if (!trameForm.contenu.trim()) return;
    try {
      const envelope = await bridgeFn('attache_encrypt')({
        nom: id,
        description: trameForm.description.trim().slice(0, 300),
        contenu: trameForm.contenu.slice(0, 200_000),
        updatedAt: new Date().toISOString(),
      });
      const res = await fetch('/api/attache/trames', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, envelope }),
      });
      if (!res.ok) { setNotice(`Enregistrement refusé : ${(await res.json().catch(() => ({} as { error?: string }))).error || res.status}`); return; }
      if (trameForm.original && trameForm.original !== id) {
        await fetch('/api/attache/trames?id=' + encodeURIComponent(trameForm.original), { method: 'DELETE' }).catch(() => {});
      }
      setTrameForm({ open: false, nom: '', description: '', contenu: '' });
      setNotice(`Trame « ${id} » enregistrée — l'attaché la suivra pour les rédactions de ce type.`);
      loadTrames();
    } catch (e) {
      setNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [trameForm, loadTrames]);

  const removeTrame = useCallback(async (nom: string) => {
    if (!window.confirm(`Supprimer la trame « ${nom} » ?\nLa dernière version reste archivée côté serveur.`)) return;
    await fetch('/api/attache/trames?id=' + encodeURIComponent(nom), { method: 'DELETE' }).catch(() => {});
    loadTrames();
  }, [loadTrames]);

  const saveKbForm = useCallback(async () => {
    const id = entrySlug(kbForm.titre);
    if (!id) { setNotice('Titre invalide — lettres, chiffres et tirets.'); return; }
    if (!kbForm.contenu.trim()) return;
    try {
      const envelope = await bridgeFn('attache_encrypt')({
        id,
        titre: kbForm.titre.trim().slice(0, 160),
        categorie: entrySlug(kbForm.categorie) || 'autre',
        description: kbForm.description.trim().slice(0, 300),
        contenu: kbForm.contenu.slice(0, 400_000),
        updatedAt: new Date().toISOString(),
      });
      const res = await fetch('/api/attache/kb', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, envelope }),
      });
      if (!res.ok) { setNotice(`Enregistrement refusé : ${(await res.json().catch(() => ({} as { error?: string }))).error || res.status}`); return; }
      if (kbForm.original && kbForm.original !== id) {
        await fetch('/api/attache/kb?id=' + encodeURIComponent(kbForm.original), { method: 'DELETE' }).catch(() => {});
      }
      setKbForm({ open: false, titre: '', categorie: KB_CATEGORIES[0], description: '', contenu: '' });
      setNotice(`Entrée « ${id} » enregistrée — l'attaché la voit dès le prochain échange.`);
      loadKb();
    } catch (e) {
      setNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [kbForm, loadKb]);

  const removeKbEntry = useCallback(async (id: string) => {
    if (!window.confirm(`Supprimer l'entrée « ${id} » de la base de connaissances ?\nLa dernière version reste archivée côté serveur.`)) return;
    await fetch('/api/attache/kb?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
    loadKb();
  }, [loadKb]);

  const saveSkill = useCallback(async () => {
    const id = skillSlug(skillForm.nom);
    if (!id) { setNotice('Nom de skill invalide — lettres, chiffres et tirets.'); return; }
    if (!skillForm.contenu.trim()) return;
    setSkillSaving(true);
    try {
      const envelope = await bridgeFn('attache_encrypt')({
        nom: id,
        description: skillForm.description.trim().slice(0, 300),
        contenu: skillForm.contenu.slice(0, 200_000),
        updatedAt: new Date().toISOString(),
      });
      const res = await fetch('/api/attache/skills', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, envelope }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setNotice(`Enregistrement refusé : ${data.error || res.status}`);
        return;
      }
      // renommage : l'ancien fichier est retiré (version archivée côté serveur)
      if (skillForm.original && skillForm.original !== id) {
        await fetch('/api/attache/skills?id=' + encodeURIComponent(skillForm.original), { method: 'DELETE' }).catch(() => {});
      }
      setSkillForm({ open: false, nom: '', description: '', contenu: '' });
      setNotice(`Skill « ${id} » enregistrée — l'attaché l'applique dès le prochain échange.`);
      loadSkills();
    } catch (e) {
      setNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSkillSaving(false);
    }
  }, [skillForm, loadSkills]);

  const removeSkill = useCallback(async (nom: string) => {
    if (!window.confirm(`Supprimer la skill « ${nom} » ?\nLa dernière version reste archivée côté serveur.`)) return;
    await fetch('/api/attache/skills?id=' + encodeURIComponent(nom), { method: 'DELETE' }).catch(() => {});
    loadSkills();
  }, [loadSkills]);

  const saveRoutine = useCallback(async () => {
    if (!rForm.nom.trim() || !rForm.prompt.trim()) return;
    setWorking('routine');
    try {
      const res = await fetch('/api/attache/routines', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nom: rForm.nom,
          prompt: rForm.prompt,
          heure: rForm.mode === 'heure' ? rForm.heure : undefined,
          intervalleHeures: rForm.mode === 'intervalle' ? rForm.intervalleHeures : undefined,
          actif: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowRoutineForm(false);
        setRForm({ nom: '', prompt: '', heure: '07:00', mode: 'heure', intervalleHeures: 4 });
        loadRoutines();
      } else {
        setNotice(data.error || 'Enregistrement refusé');
      }
    } finally {
      setWorking(null);
    }
  }, [rForm, loadRoutines]);

  const toggleRoutine = useCallback(async (r: Routine) => {
    await fetch('/api/attache/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...r, actif: !r.actif }),
    }).catch(() => {});
    loadRoutines();
  }, [loadRoutines]);

  const removeRoutine = useCallback(async (id: string) => {
    if (!window.confirm('Supprimer cette routine ?')) return;
    await fetch('/api/attache/routines?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
    loadRoutines();
  }, [loadRoutines]);

  const runRoutineNow = useCallback(async (id: string) => {
    await fetch('/api/attache/routines?run=' + encodeURIComponent(id), { method: 'POST' }).catch(() => {});
    setNotice('Routine lancée — le résultat arrivera dans le fil « pendant votre absence ».');
  }, []);

  const grantKeys = useCallback(async () => {
    if (!status?.scopesAttendus?.length) return;
    if (!window.confirm(
      'Remettre les clés à l\'attaché ?\n\n' +
      `Périmètres : ${status.scopesAttendus.join(', ')}.\n` +
      'Le service attaché pourra déchiffrer ces données pour travailler en votre absence. ' +
      'Révocable à tout moment depuis ce panneau.'
    )) return;
    setWorking('grant');
    setNotice(null);
    try {
      const keys = await bridgeFn('attache_exportKeys')(status.scopesAttendus);
      const missing = (status.scopesAttendus as string[]).filter((s) => !keys[s]);
      if (missing.length) {
        setNotice(`Votre trousseau ne contient pas : ${missing.join(', ')} — impossible de remettre ces clés.`);
        return;
      }
      const res = await fetch('/api/attache/keyring', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json().catch(() => ({}));
      setNotice(res.ok ? 'Clés remises — l\'attaché peut travailler.' : `Refusé : ${data.error || res.status}`);
      refresh();
    } catch (e) {
      // JAMAIS d'échec silencieux ici : un clic sans effet est indéchiffrable pour l'admin.
      setNotice(`Échec de la remise des clés : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWorking(null);
    }
  }, [status, refresh]);

  const revoke = useCallback(async () => {
    if (!window.confirm('Révoquer le trousseau de l\'attaché ?\nIl ne pourra plus rien déchiffrer, immédiatement. Les données ne sont pas touchées.')) return;
    setWorking('revoke');
    try {
      await fetch('/api/attache/keyring', { method: 'DELETE' });
      setNotice('Trousseau révoqué — l\'attaché est aveugle.');
      refresh();
    } finally {
      setWorking(null);
    }
  }, [refresh]);

  const checkMail = useCallback(async () => {
    setWorking('mail');
    try {
      const res = await fetch('/api/attache/inbox', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setNotice(data.ok ? `Relève effectuée${data.ingested?.length ? ` — ${data.ingested.length} nouveau(x) message(s)` : ' — rien de nouveau'}` : `Relève impossible : ${data.error || ''}`);
      refresh();
    } finally {
      setWorking(null);
    }
  }, [refresh]);

  const loadAudit = useCallback(async () => {
    setShowAudit(true);
    try {
      const res = await fetch('/api/attache/audit');
      if (!res.ok) return;
      const { entries } = await res.json();
      const decrypt = bridgeFn('attache_decrypt');
      const out: Array<AuditEntry & { ts: number }> = [];
      for (const e of entries as Array<{ ts: number; iv: string; ct: string }>) {
        const payload = await decrypt({ v: 1, encrypted: true, iv: e.iv, ct: e.ct });
        if (payload) out.push({ ...(payload as AuditEntry), ts: e.ts });
      }
      setAudit(out.reverse());
    } catch (e) {
      setNotice(`Lecture du journal impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // ── Consignes permanentes : le « prompt » du magistrat, chiffré côté navigateur ──
  const openInstructions = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/instructions');
      const { envelope } = await res.json();
      if (envelope) {
        const payload = await bridgeFn('attache_decrypt')(envelope);
        setInstructions((payload as { content?: string } | null)?.content || '');
      } else {
        setInstructions('');
      }
      setShowInstructions(true);
    } catch (e) {
      setNotice(`Lecture des consignes impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const saveInstructions = useCallback(async () => {
    setInstructionsSaving(true);
    try {
      const envelope = await bridgeFn('attache_encrypt')({ content: instructions });
      const res = await fetch('/api/attache/instructions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope }),
      });
      if (res.ok) {
        setShowInstructions(false);
        setNotice('Consignes enregistrées — l\'attaché les relira à chaque intervention.');
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice(`Enregistrement refusé : ${data.error || res.status}`);
      }
    } catch (e) {
      setNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstructionsSaving(false);
    }
  }, [instructions]);

  if (loading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Interrogation du service attaché…</div>;
  }

  if (status?.unavailable) {
    return (
      <div className="space-y-3 p-2">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-[#2B5746]" />
          <h3 className="text-base font-semibold text-gray-900">Attaché de justice (IA)</h3>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Le service attaché n'est pas joignable. Vérifiez sur le serveur :
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-gray-500">
            <li><code>SIRAL_ATTACHE_URL</code> défini pour l'app (ex. <code>http://attache:8787</code>)</li>
            <li>le conteneur <code>attache</code> démarré (<code>docker compose up -d attache</code>)</li>
            <li><code>SIRAL_ATTACHE_MASTER_KEY</code> défini (générer : <code>openssl rand -hex 32</code>)</li>
          </ul>
          Guide complet : <code>docs/ATTACHE.md</code>
        </div>
      </div>
    );
  }

  const kr = status?.keyring;

  return (
    <div className="space-y-4 p-2">
      <div className="flex items-center gap-2">
        <Scale className="h-5 w-5 text-[#2B5746]" />
        <h3 className="text-base font-semibold text-gray-900">Attaché de justice (IA)</h3>
        <button onClick={refresh} className="ml-auto rounded-md p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs leading-relaxed text-gray-500">
        Assistant réservé à l'administrateur — invisible des autres utilisateurs. TJ : <b>{status?.tj}</b> ·
        contentieux confié : <b>{status?.contentieux}</b>. Il prépare et agit dans SIRAL (réversible, journalisé) ;
        son unique sortie est un mail vers <b>{status?.mail?.owner || 'votre adresse (non configurée)'}</b>.
      </p>

      {/* État */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
        <Dot ok={status?.masterKey} label="Clé-maître du service" />
        <Dot ok={kr?.granted} label={kr?.granted ? `Trousseau remis (${(kr.scopes || []).join(', ')})` : 'Trousseau non remis'} />
        <Dot ok={status?.claude?.ok} label={status?.claude?.ok ? `Claude Code ${status.claude.version || ''}` : 'Claude Code non authentifié'} />
        <Dot ok={status?.mail?.imap} label="Boîte dédiée (IMAP)" />
        <Dot ok={status?.mail?.smtp} label="Envoi au magistrat (SMTP)" />
        <span className="text-xs text-gray-500">
          Boîte : {status?.inbox ? `${status.inbox.nonTraites} à traiter / ${status.inbox.total}` : '—'}
          {status?.state?.lastFetchAt ? ` · relevée ${new Date(status.state.lastFetchAt).toLocaleString('fr-FR')}` : ''}
        </span>
      </div>

      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</div>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={grantKeys}
          disabled={working !== null || !status?.masterKey}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {working === 'grant' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {kr?.granted ? 'Renouveler les clés' : 'Remettre les clés'}
        </button>
        <button
          onClick={revoke}
          disabled={working !== null || !kr?.granted}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          {working === 'revoke' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
          Révoquer
        </button>
        <button
          onClick={checkMail}
          disabled={working !== null || !kr?.granted}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {working === 'mail' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Relever la boîte
        </button>
        <button
          onClick={loadAudit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <ScrollText className="h-3.5 w-3.5" />
          Journal d'audit
        </button>
      </div>

      {kr?.granted && (
        <p className="text-[11px] text-gray-400">
          Clés remises par <b>{kr.grantedBy}</b> le {kr.grantedAt ? new Date(kr.grantedAt).toLocaleString('fr-FR') : '?'}.
          Pour les périmètres confiés, le serveur de l'attaché peut déchiffrer — révoquez au moindre doute.
        </p>
      )}

      {/* Cerveau — modèle, effort, accès web : mêmes réglages que Claude web */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <SlidersHorizontal className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Cerveau</span>
          <span className="text-[11px] text-gray-400">appliqué à tous les runs — chat, mails, brief, routines</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <select
            value={config.model || ''}
            onChange={(e) => updateConfig({ model: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#2B5746]/50"
            title="Modèle Claude utilisé par l'attaché"
          >
            {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select
            value={config.effort || ''}
            onChange={(e) => updateConfig({ effort: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#2B5746]/50"
            title="Niveau d'effort de raisonnement"
          >
            {EFFORT_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select
            value={config.subModel || ''}
            onChange={(e) => updateConfig({ subModel: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#2B5746]/50"
            title="Modèle des sous-agents (lots parallèles : analyse de PDF, balayage du brief, trames) — un modèle rapide suffit souvent"
          >
            {SUBMODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={config.webAccess === true}
              onChange={(e) => updateConfig({ webAccess: e.target.checked })}
            />
            <Globe className="h-3.5 w-3.5 text-gray-400" />
            Recherche web
          </label>
        </div>
        {config.webAccess === true && (
          <p className="border-t border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            L'attaché peut interroger Internet (WebSearch / WebFetch) comme Claude web — utile pour jurisprudence et textes.
            Ses requêtes de recherche partent vers l'extérieur : il reste tenu au secret, mais décochez au moindre doute.
            Shell, fichiers et tout autre accès restent interdits.
          </p>
        )}
      </div>

      {/* Consignes permanentes — le « prompt » du magistrat, relu à chaque run */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <PenLine className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Consignes permanentes</span>
          <span className="text-[11px] text-gray-400">votre prompt — relu à chaque intervention · chiffré, versionné</span>
          <button
            onClick={() => (showInstructions ? setShowInstructions(false) : openInstructions())}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            {showInstructions ? 'Fermer' : 'Modifier'}
          </button>
        </div>
        {showInstructions ? (
          <div className="space-y-2 p-3">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={9}
              placeholder={'Écrivez ici ce que vous colleriez en préambule de Claude web : votre façon de travailler, vos exigences de style, vos réflexes métier.\n\nEx. « Cite toujours la pièce et sa date. Pour toute DML, suis ma trame et rappelle le délai. Réponds en plan apparent I/II. Tutoie-moi. »'}
              className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#2B5746]/50"
            />
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-[10.5px] text-gray-400">S'ajoute à la persona et aux règles de gouvernance (docs/ATTACHE.md) — ne les remplace pas.</span>
              <button onClick={() => setShowInstructions(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
              <button onClick={saveInstructions} disabled={instructionsSaving} className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {instructionsSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-gray-400">
            Vos consignes libres (l'équivalent de vos instructions Claude web) : style, méthode, réflexes.
            L'attaché les relit avant chaque chat, mail traité, brief et routine.
          </p>
        )}
      </div>

      {/* Skills — méthodes réutilisables, comme les skills Claude web */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Sparkles className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Skills</span>
          <span className="text-[11px] text-gray-400">vos méthodes réutilisables — comme dans Claude web · chiffrées, versionnées</span>
          <button
            onClick={() => setSkillForm({ open: !skillForm.open, nom: '', description: '', contenu: '' })}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-3 w-3" />Nouvelle
          </button>
        </div>

        {skillForm.open && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <div className="flex gap-2">
              <input
                value={skillForm.nom}
                onChange={(e) => setSkillForm({ ...skillForm, nom: e.target.value })}
                placeholder="Nom (ex. preparation-audience)"
                className="w-52 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50"
              />
              <input
                value={skillForm.description}
                onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })}
                placeholder="Description — QUAND l'utiliser (c'est elle qui déclenche la skill)"
                className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50"
              />
            </div>
            <textarea
              value={skillForm.contenu}
              onChange={(e) => setSkillForm({ ...skillForm, contenu: e.target.value })}
              rows={8}
              placeholder={'Le contenu de la skill (markdown) — collez ici telle quelle une skill de Claude web.\n\nEx. « # Préparation d\'audience\\nPour chaque affaire du rôle : 1) faits et qualification… 2) personnalité… 3) points faibles du dossier… 4) réquisitions envisageables… »'}
              className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#2B5746]/50"
            />
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-[10.5px] text-gray-400">
                {skillForm.nom ? `Enregistrée sous « ${skillSlug(skillForm.nom) || '?'} »` : 'L\'attaché la chargera (skill_lire) dès qu\'une tâche correspondra à sa description.'}
              </span>
              <button
                onClick={() => setSkillForm({ open: false, nom: '', description: '', contenu: '' })}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={saveSkill}
                disabled={skillSaving || !skillForm.nom.trim() || !skillForm.contenu.trim()}
                className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {skillSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}

        {skills.length === 0 && !skillForm.open ? (
          <p className="px-3 py-3 text-xs text-gray-400">
            Aucune skill. Collez ici vos skills Claude web (nom, description, contenu) : l'attaché en voit la liste
            en permanence et charge la bonne dès qu'une tâche correspond. En chat, « enregistre cette skill » fonctionne aussi.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {skills.map((s) => (
              <div key={s.nom} className="flex items-center gap-2 px-3 py-2">
                <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-gray-800">{s.nom}</div>
                  <div className="truncate text-[10.5px] text-gray-400">
                    {s.description || 'sans description — ajoutez-en une : c\'est elle qui déclenche la skill'}
                    {s.updatedAt ? ` · maj ${new Date(s.updatedAt).toLocaleDateString('fr-FR')}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => setSkillForm({ open: true, original: s.nom, nom: s.nom, description: s.description || '', contenu: s.contenu })}
                  title="Modifier"
                  className="rounded-md p-1 text-gray-400 hover:bg-emerald-50 hover:text-[#2B5746]"
                >
                  <PenLine className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeSkill(s.nom)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bibliothèque de trames — plans-types d'actes, téléversables en masse */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <BookOpen className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Trames</span>
          <span className="text-[11px] text-gray-400">plans-types d'actes (ST, ddeJLD, saisines…) · converties en markdown au téléversement · chiffrées, versionnées</span>
          <input ref={trameFileInput} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden"
            onChange={(e) => { stageFiles('trames', e.target.files); e.target.value = ''; }} />
          <button
            onClick={() => trameFileInput.current?.click()}
            disabled={converting || uploadBusy !== null}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <UploadCloud className="h-3 w-3" />Téléverser
          </button>
          <button
            onClick={() => setTrameForm({ open: !trameForm.open, nom: '', description: '', contenu: '' })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-3 w-3" />Nouvelle
          </button>
        </div>

        {stagedKind === 'trames' && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <div className="text-[11px] font-semibold text-gray-600">
              {converting ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Conversion en markdown ({staged.length} fichier{staged.length > 1 ? 's' : ''})…</span>
                : `${staged.filter((s) => !s.erreur).length} trame(s) prête(s) sur ${staged.length} — vérifiez les noms avant d'enregistrer.`}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {staged.map((s, i) => (
                <div key={s.fichier + i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                  <span className="max-w-[30%] truncate text-[10.5px] text-gray-400" title={s.fichier}>{s.fichier}</span>
                  {s.erreur ? (
                    <span className="flex-1 truncate text-[11px] text-red-500" title={s.erreur}>✗ {s.erreur}</span>
                  ) : (
                    <>
                      <input
                        value={s.titre}
                        onChange={(e) => setStaged(staged.map((r, j) => (j === i ? { ...r, titre: e.target.value } : r)))}
                        className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                      />
                      <span className="whitespace-nowrap text-[10px] text-gray-400">{Math.round(s.contenu.length / 1000)} k</span>
                      {s.avertissement && <span title={s.avertissement}><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /></span>}
                    </>
                  )}
                </div>
              ))}
            </div>
            {staged.some((s) => s.avertissement) && (
              <p className="text-[10.5px] text-amber-600">⚠ {staged.find((s) => s.avertissement)?.avertissement}</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600">
                <input type="checkbox" checked={analyseAfter} onChange={(e) => setAnalyseAfter(e.target.checked)} />
                Faire analyser par l'attaché : classement + propositions d'amélioration légale/structurelle (fil « pendant votre absence »)
              </label>
              <button onClick={() => { setStaged([]); setStagedKind(null); }} disabled={uploadBusy !== null}
                className="ml-auto rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Annuler</button>
              <button onClick={saveStaged} disabled={converting || uploadBusy !== null || !staged.some((s) => !s.erreur)}
                className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {uploadBusy ? `Enregistrement ${uploadBusy}…` : `Enregistrer ${staged.filter((s) => !s.erreur).length} trame(s)`}
              </button>
            </div>
          </div>
        )}

        {trameForm.open && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <div className="flex gap-2">
              <input value={trameForm.nom} onChange={(e) => setTrameForm({ ...trameForm, nom: e.target.value })}
                placeholder="Nom (ex. ddejld-sonorisation)"
                className="w-52 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
              <input value={trameForm.description} onChange={(e) => setTrameForm({ ...trameForm, description: e.target.value })}
                placeholder="Description — type d'acte, cadre juridique, quand l'utiliser"
                className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
            </div>
            <textarea value={trameForm.contenu} onChange={(e) => setTrameForm({ ...trameForm, contenu: e.target.value })} rows={8}
              placeholder="Le plan-type complet (markdown) — l'attaché le suivra fidèlement avant toute rédaction du même type."
              className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#2B5746]/50" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setTrameForm({ open: false, nom: '', description: '', contenu: '' })}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
              <button onClick={saveTrameForm} disabled={!trameForm.nom.trim() || !trameForm.contenu.trim()}
                className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Enregistrer</button>
            </div>
          </div>
        )}

        {trames.length === 0 && !trameForm.open && stagedKind !== 'trames' ? (
          <p className="px-3 py-3 text-xs text-gray-400">
            Aucune trame. Téléversez votre stock (.odt, .docx, .pdf…) : conversion en markdown ici même, puis
            classement et propositions d'amélioration par l'attaché. En chat, « enregistre cette trame » fonctionne aussi.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {trames.map((t) => (
              <div key={t.nom} className="flex items-center gap-2 px-3 py-2">
                <BookOpen className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-gray-800">{t.nom}</div>
                  <div className="truncate text-[10.5px] text-gray-400">
                    {t.description || 'pas encore classée — lancez l\'analyse ou ajoutez une description'}
                    {t.updatedAt ? ` · maj ${new Date(t.updatedAt).toLocaleDateString('fr-FR')}` : ''}
                  </div>
                </div>
                <button onClick={() => setTrameForm({ open: true, original: t.nom, nom: t.nom, description: t.description || '', contenu: t.contenu })}
                  title="Modifier" className="rounded-md p-1 text-gray-400 hover:bg-emerald-50 hover:text-[#2B5746]">
                  <PenLine className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeTrame(t.nom)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {trames.length > 0 && (
          <div className="border-t border-gray-100 px-3 py-2">
            <button onClick={() => analyseTrames(trames.map((t) => t.nom))} disabled={!kr?.granted}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              title="L'attaché relit chaque trame, met à jour son classement et publie ses propositions d'amélioration">
              <Sparkles className="h-3 w-3" />Analyser toute la bibliothèque
            </button>
          </div>
        )}
      </div>

      {/* Base de connaissances — le fond documentaire du cabinet */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Library className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Base de connaissances</span>
          <span className="text-[11px] text-gray-400">jurisprudences, circulaires, modes opératoires, fiches, contacts · convertie en markdown au téléversement</span>
          <input ref={kbFileInput} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden"
            onChange={(e) => { stageFiles('kb', e.target.files); e.target.value = ''; }} />
          <button
            onClick={() => kbFileInput.current?.click()}
            disabled={converting || uploadBusy !== null}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            <UploadCloud className="h-3 w-3" />Téléverser
          </button>
          <button
            onClick={() => setKbForm({ open: !kbForm.open, titre: '', categorie: KB_CATEGORIES[0], description: '', contenu: '' })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-3 w-3" />Nouvelle
          </button>
        </div>

        {stagedKind === 'kb' && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <div className="text-[11px] font-semibold text-gray-600">
              {converting ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Conversion en markdown ({staged.length} fichier{staged.length > 1 ? 's' : ''})…</span>
                : `${staged.filter((s) => !s.erreur).length} entrée(s) prête(s) sur ${staged.length} — ajustez titre et catégorie avant d'enregistrer.`}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {staged.map((s, i) => (
                <div key={s.fichier + i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                  <span className="max-w-[22%] truncate text-[10.5px] text-gray-400" title={s.fichier}>{s.fichier}</span>
                  {s.erreur ? (
                    <span className="flex-1 truncate text-[11px] text-red-500" title={s.erreur}>✗ {s.erreur}</span>
                  ) : (
                    <>
                      <input
                        value={s.titre}
                        onChange={(e) => setStaged(staged.map((r, j) => (j === i ? { ...r, titre: e.target.value } : r)))}
                        className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                      />
                      <select
                        value={s.categorie}
                        onChange={(e) => setStaged(staged.map((r, j) => (j === i ? { ...r, categorie: e.target.value } : r)))}
                        className="rounded border border-gray-200 bg-white px-1.5 py-1 text-[10.5px] text-gray-600 outline-none"
                      >
                        {KB_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <span className="whitespace-nowrap text-[10px] text-gray-400">{Math.round(s.contenu.length / 1000)} k</span>
                      {s.avertissement && <span title={s.avertissement}><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /></span>}
                    </>
                  )}
                </div>
              ))}
            </div>
            {staged.some((s) => s.avertissement) && (
              <p className="text-[10.5px] text-amber-600">⚠ {staged.find((s) => s.avertissement)?.avertissement}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <span className="mr-auto text-[10.5px] text-gray-400">Seul le markdown est conservé (pas le fichier d'origine) : place et tokens économisés.</span>
              <button onClick={() => { setStaged([]); setStagedKind(null); }} disabled={uploadBusy !== null}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Annuler</button>
              <button onClick={saveStaged} disabled={converting || uploadBusy !== null || !staged.some((s) => !s.erreur)}
                className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {uploadBusy ? `Enregistrement ${uploadBusy}…` : `Enregistrer ${staged.filter((s) => !s.erreur).length} entrée(s)`}
              </button>
            </div>
          </div>
        )}

        {kbForm.open && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <div className="flex gap-2">
              <input value={kbForm.titre} onChange={(e) => setKbForm({ ...kbForm, titre: e.target.value })}
                placeholder="Titre (ex. Circulaire captation de données 2024)"
                className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
              <input value={kbForm.categorie} onChange={(e) => setKbForm({ ...kbForm, categorie: e.target.value })}
                list="kb-categories" placeholder="Catégorie"
                className="w-44 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
              <datalist id="kb-categories">
                {KB_CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <input value={kbForm.description} onChange={(e) => setKbForm({ ...kbForm, description: e.target.value })}
              placeholder="Description — ce que contient l'entrée et quand s'en servir (guide la recherche de l'attaché)"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
            <textarea value={kbForm.contenu} onChange={(e) => setKbForm({ ...kbForm, contenu: e.target.value })} rows={8}
              placeholder="Le contenu (markdown) — collez un texte, une jurisprudence, une fiche, une liste de contacts…"
              className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none focus:border-[#2B5746]/50" />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setKbForm({ open: false, titre: '', categorie: KB_CATEGORIES[0], description: '', contenu: '' })}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
              <button onClick={saveKbForm} disabled={!kbForm.titre.trim() || !kbForm.contenu.trim()}
                className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Enregistrer</button>
            </div>
          </div>
        )}

        {kbEntries.length === 0 && !kbForm.open && stagedKind !== 'kb' ? (
          <p className="px-3 py-3 text-xs text-gray-400">
            Base vide. Téléversez votre fond documentaire (jurisprudences, conventions et circulaires, modes opératoires,
            contacts utiles…) : converti en markdown ici même, chiffré, puis consulté par l'attaché à la demande
            (kb_chercher / kb_lire) avant ses analyses et rédactions.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {kbEntries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-32 flex-shrink-0 truncate rounded bg-gray-100 px-1.5 py-0.5 text-center text-[10px] font-medium text-gray-500" title={e.categorie}>{e.categorie}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-gray-800">{e.titre}</div>
                  <div className="truncate text-[10.5px] text-gray-400">
                    {e.description || (e.source ? `depuis ${e.source}` : 'sans description')}
                    {` · ${Math.round((e.contenu || '').length / 1000)} k`}
                    {e.updatedAt ? ` · maj ${new Date(e.updatedAt).toLocaleDateString('fr-FR')}` : ''}
                  </div>
                </div>
                <button onClick={() => setKbForm({ open: true, original: e.id, titre: e.titre, categorie: e.categorie, description: e.description || '', contenu: e.contenu })}
                  title="Modifier" className="rounded-md p-1 text-gray-400 hover:bg-emerald-50 hover:text-[#2B5746]">
                  <PenLine className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeKbEntry(e.id)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Routines — consignes récurrentes exécutées sans vous */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <AlarmClock className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Routines</span>
          <span className="text-[11px] text-gray-400">quotidiennes (HH:MM) ou toutes les N heures</span>
          <button
            onClick={() => setShowRoutineForm((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-3 w-3" />Nouvelle
          </button>
        </div>

        {showRoutineForm && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <input
              value={rForm.nom}
              onChange={(e) => setRForm({ ...rForm, nom: e.target.value })}
              placeholder="Nom (ex. Préparation d'audience)"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs outline-none focus:border-[#2B5746]/50"
            />
            <textarea
              value={rForm.prompt}
              onChange={(e) => setRForm({ ...rForm, prompt: e.target.value })}
              rows={3}
              placeholder="La consigne, comme vous la donneriez dans le panneau (ex. « Chaque veille d'audience, prépare pour chaque affaire du rôle une fiche : faits, personnalité, points faibles, réquisitions envisageables — et envoie-la-moi par mail. »)"
              className="w-full resize-y rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs leading-relaxed outline-none focus:border-[#2B5746]/50"
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={rForm.mode === 'heure'} onChange={() => setRForm({ ...rForm, mode: 'heure' })} />
                Chaque jour à
                <input
                  type="time"
                  value={rForm.heure}
                  onChange={(e) => setRForm({ ...rForm, heure: e.target.value })}
                  className="rounded border border-gray-200 px-1.5 py-0.5"
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={rForm.mode === 'intervalle'} onChange={() => setRForm({ ...rForm, mode: 'intervalle' })} />
                Toutes les
                <input
                  type="number" min={1} max={168}
                  value={rForm.intervalleHeures}
                  onChange={(e) => setRForm({ ...rForm, intervalleHeures: Number(e.target.value) })}
                  className="w-14 rounded border border-gray-200 px-1.5 py-0.5"
                />
                heures
              </label>
              <button
                onClick={saveRoutine}
                disabled={working === 'routine' || !rForm.nom.trim() || !rForm.prompt.trim()}
                className="ml-auto rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {working === 'routine' ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        )}

        {routines.length === 0 ? (
          <p className="px-3 py-3 text-center text-xs text-gray-400">Aucune routine — le brief quotidien du majordome tourne déjà tout seul.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {routines.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => toggleRoutine(r)}
                  title={r.actif ? 'Active — cliquer pour suspendre' : 'Suspendue — cliquer pour activer'}
                  className={`h-4 w-7 rounded-full transition-colors ${r.actif ? 'bg-[#2B5746]' : 'bg-gray-300'}`}
                >
                  <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${r.actif ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-gray-800">{r.nom}</div>
                  <div className="text-[10.5px] text-gray-400">
                    {r.heure ? `chaque jour à ${r.heure}` : `toutes les ${r.intervalleHeures} h`}
                    {r.lastRunAt ? ` · dernier run ${new Date(r.lastRunAt).toLocaleString('fr-FR')} ${r.lastRunOk === false ? '⚠️' : r.lastRunOk ? '✓' : '…'}` : ' · jamais exécutée'}
                  </div>
                </div>
                <button onClick={() => runRoutineNow(r.id)} title="Exécuter maintenant" className="rounded-md p-1 text-gray-400 hover:bg-emerald-50 hover:text-[#2B5746]">
                  <Play className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeRoutine(r.id)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Journal d'audit */}
      {showAudit && (
        <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-200">
          <table className="w-full text-left text-[11.5px]">
            <thead className="sticky top-0 bg-gray-50 text-gray-500">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Quand</th>
                <th className="px-2.5 py-1.5 font-medium">Action</th>
                <th className="px-2.5 py-1.5 font-medium">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {audit.length === 0 && (
                <tr><td colSpan={3} className="px-2.5 py-3 text-center text-gray-400">Journal vide (ou déchiffrement en cours)</td></tr>
              )}
              {audit.map((a, i) => (
                <tr key={i} className="align-top">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-400">{new Date(a.ts).toLocaleString('fr-FR')}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-gray-700">{a.action}{a.outil ? ` · ${a.outil}` : ''}</td>
                  <td className="px-2.5 py-1.5 text-gray-500">
                    {Object.entries(a)
                      .filter(([k]) => !['action', 'at', 'ts', 'outil'].includes(k))
                      .map(([k, v]) => `${k}: ${String(v).slice(0, 120)}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
