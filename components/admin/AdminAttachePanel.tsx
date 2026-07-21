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
import { Scale, KeyRound, ShieldOff, RefreshCw, CheckCircle2, XCircle, Loader2, ScrollText, AlarmClock, Play, Trash2, Plus, SlidersHorizontal, Globe, PenLine, Sparkles, BookOpen, UploadCloud, AlertTriangle, Mail, Wifi, Gauge, Leaf, GraduationCap } from 'lucide-react';
import { MODEL_OPTIONS, EFFORT_OPTIONS, SUBMODEL_OPTIONS, PLAN_PRESETS, AttacheConfig, saveAttacheConfig, formatTokens, formatCostEur } from '../attache/modelOptions';
import { fileToMarkdown, titreDepuisFichier, decodeText } from '@/lib/web/fileToMarkdown';
import { skillFromArchive } from '@/lib/web/skillImport';
import { entrySlug } from '@/lib/web/slug';
import { AttacheKbSection } from './AttacheKbSection';
import { TramesFormePanel } from './TramesFormePanel';

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

interface Skill { nom: string; fileId?: string; description?: string; contenu: string; updatedAt?: string }
interface Trame { nom: string; fileId?: string; description?: string; contenu: string; updatedAt?: string }
/** Ligne éditable de la table « type d'acte → trame(s) + skill(s) ». */
interface AssocRow { id: string; acte: string; tramesText: string; skillsText: string; notes: string }

/** Identifiant hex stable pour une association (compatible côté service). */
const assocId = () => {
  const c = (typeof crypto !== 'undefined' ? crypto : undefined) as Crypto | undefined;
  const raw = c?.randomUUID ? c.randomUUID().replace(/-/g, '') : Math.floor(Math.random() * 1e16).toString(16);
  return raw.slice(0, 12).padEnd(6, '0');
};
const splitAssocList = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);

/** Trame en attente après conversion d'un fichier téléversé (avant chiffrement + enregistrement). */
interface StagedDoc {
  fichier: string;
  titre: string;        // deviendra le nom (slug) de la trame
  contenu: string;
  avertissement?: string;
  erreur?: string;
}

/** Skill importée d'un fichier .skill (Claude web) en attente d'enregistrement. */
interface StagedSkill {
  fichier: string;
  nom: string;
  description: string;
  contenu: string;
  avertissement?: string;
  erreur?: string;
}

// Nom de fichier d'une skill/trame — miroir serveur partagé (lib/web/slug).
const skillSlug = entrySlug;

const UPLOAD_ACCEPT = '.pdf,.odt,.ott,.docx,.doc,.txt,.md,.markdown,.csv,.html,.htm,.eml,.rtf,.log';
const SKILL_ACCEPT = '.skill,.zip,.md,.markdown';

function Dot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
      <span className={ok ? 'text-gray-700' : 'text-red-600'}>{label}</span>
    </span>
  );
}

/** Couleur d'une jauge selon le taux de remplissage (vert → ambre → rouge). */
function gaugeColor(pct: number): string {
  if (pct >= 90) return '#dc2626';
  if (pct >= 70) return '#d97706';
  return '#2B5746';
}

/** Grande jauge « % du forfait » avec repli sur le nombre brut si pas de plafond. */
function UsageGauge({ label, hint, total, cap }: { label: string; hint: string; total: number; cap: number }) {
  const pct = cap > 0 ? Math.min(999, Math.round((total / cap) * 100)) : null;
  const width = pct == null ? 0 : Math.min(100, pct);
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        {pct != null
          ? <span className="text-lg font-bold" style={{ color: gaugeColor(pct) }}>{pct} %</span>
          : <span className="text-sm font-semibold text-gray-700">{formatTokens(total)}</span>}
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: pct == null ? '#cbd5e1' : gaugeColor(pct) }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10.5px] text-gray-400">
        <span>{hint}</span>
        <span>{formatTokens(total)}{cap > 0 ? ` / ${formatTokens(cap)} jetons` : ' jetons'}</span>
      </div>
    </div>
  );
}

const USAGE_CATS: Record<string, { label: string; color: string }> = {
  conversations: { label: 'Vos conversations', color: '#2B5746' },
  'sous-agents': { label: 'Sous-agents (lots parallèles)', color: '#b45309' },
  mails: { label: 'Mails traités automatiquement', color: '#0e7490' },
  brief: { label: 'Brief quotidien', color: '#6d28d9' },
  routines: { label: 'Routines', color: '#be185d' },
  classements: { label: 'Classements (trames, base)', color: '#4b5563' },
  apprentissage: { label: 'Apprentissage (consolidations)', color: '#0f766e' },
  autres: { label: 'Autres', color: '#9ca3af' },
};

/** Libellé de la SOURCE d'un sous-agent (le run parent qui l'a lancé). */
function srcLabelOf(k?: string): string {
  const key = !k || k === 'autre' ? 'autres' : k;
  return (USAGE_CATS[key] || USAGE_CATS.autres).label;
}

/** Fenêtre de progression mesurée (30 j) — agrégats de signaux, aucun LLM. */
interface ApprFenetre {
  validees: number; refusees: number; revisions: number; editionsMain: number;
  portes: number; lecons: number; corrections: number; tauxAcceptation: number | null;
}

/** Statut de l'apprentissage progressif (GET /api/attache/apprentissage). */
interface ApprStatus {
  keyring?: boolean;
  pending?: number | null;
  parType?: Record<string, number>;
  memoire?: { chars: number; budget: number; over: boolean } | null;
  progression?: { j30: ApprFenetre; j30prec: ApprFenetre };
  lastRunAt?: string | null;
  lastRunOk?: boolean | null;
  lastTrigger?: string | null;
  seuilSignaux?: number;
  cadenceJours?: number;
  due?: string | null;
  running?: boolean;
  etude?: {
    corpus: number; dossiers: number; nouveaux: number; seuil: number; cadenceJours: number;
    lastRunAt?: string | null; lastRunOk?: boolean | null; running?: boolean;
  };
}

/** Libellés lisibles des types de signaux d'apprentissage. */
const SIGNAL_LABELS: Record<string, string> = {
  proposition_refusee: 'propositions refusées ✗',
  proposition_validee: 'propositions validées ✓',
  acte_revise: 'actes révisés',
  acte_edite_main: 'actes corrigés à la main',
  lecon: 'leçons notées',
  garde_qualite: 'portes de qualité déclenchées',
  correction_conversation: 'corrections repérées en conversation',
};

/** Proposition d'amélioration d'une trame/skill du magistrat, en attente de ✓/✗. */
interface MethodProp {
  id: string; type: 'trame' | 'skill'; titre: string; source?: string; creeLe?: string;
  payload: { nom: string; contenu: string; description?: string; motif?: string; existante?: boolean };
}

/** Une tuile de progression : valeur sur 30 j, flèche face aux 30 j précédents. */
function ProgressionTile({ label, now, before, invert = false, unit = '' }: { label: string; now: number | null; before: number | null; invert?: boolean; unit?: string }) {
  const delta = now != null && before != null ? now - before : null;
  // invert : pour les compteurs d'erreurs, BAISSER est un progrès
  const good = delta == null || delta === 0 ? null : (invert ? delta < 0 : delta > 0);
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-800">{now == null ? '—' : `${now}${unit}`}</div>
      <div className="text-[10px]" style={{ color: good == null ? '#9ca3af' : good ? '#059669' : '#d97706' }}>
        {delta == null ? '30 j précédents : n/a' : delta === 0 ? 'stable vs 30 j précédents' : `${delta > 0 ? '+' : ''}${delta}${unit} vs 30 j précédents`}
      </div>
    </div>
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
  const [usage, setUsage] = useState<any>(null);
  const [governor, setGovernor] = useState<any>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [showMailDiag, setShowMailDiag] = useState(false);
  const [mailTest, setMailTest] = useState<any>(null);
  const [mailTesting, setMailTesting] = useState(false);
  const [mailForm, setMailForm] = useState<{ open: boolean; imapHost: string; imapPort: string; imapSecure: boolean; imapUser: string; imapPassword: string }>({ open: false, imapHost: '', imapPort: '993', imapSecure: true, imapUser: '', imapPassword: '' });
  const [mailSaving, setMailSaving] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillForm, setSkillForm] = useState<{ open: boolean; original?: string; nom: string; description: string; contenu: string }>({ open: false, nom: '', description: '', contenu: '' });
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillStaged, setSkillStaged] = useState<StagedSkill[]>([]);
  const [skillAnalyseBusy, setSkillAnalyseBusy] = useState(false);   // « Classer les skills » en cours
  // ── Bibliothèque de trames (téléversement en masse) ──
  const [trames, setTrames] = useState<Trame[]>([]);
  const [trameForm, setTrameForm] = useState<{ open: boolean; original?: string; nom: string; description: string; contenu: string }>({ open: false, nom: '', description: '', contenu: '' });
  const [staged, setStaged] = useState<StagedDoc[]>([]);
  const [converting, setConverting] = useState(false);
  const [analyseAfter, setAnalyseAfter] = useState(true);
  const [uploadBusy, setUploadBusy] = useState<string | null>(null); // « 3/12 » pendant l'enregistrement
  const [trameAnalyseBusy, setTrameAnalyseBusy] = useState(false);    // « Classer la bibliothèque » en cours
  const [trameAnalyseMsg, setTrameAnalyseMsg] = useState<string | null>(null); // retour affiché AU BOUTON (le toast est loin en haut)
  const trameFileInput = useRef<HTMLInputElement>(null);
  const skillFileInput = useRef<HTMLInputElement>(null);
  // ── Associations « type d'acte → trame(s) + skill(s) » (table durable, éditable) ──
  const [assoc, setAssoc] = useState<AssocRow[]>([]);
  const [assocSaving, setAssocSaving] = useState(false);
  const [assocSuggesting, setAssocSuggesting] = useState(false);

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

  /** Bilan de consommation de jetons (nombres seulement, aucune donnée d'enquête). */
  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await fetch('/api/attache/usage');
      if (res.ok) {
        const data = await res.json();
        setUsage(data.usage || null);
        setGovernor(data.governor ? { ...data.governor, autoDeferredAt: data.autoDeferredAt || null } : null);
      }
    } catch { /* silencieux : le bilan est secondaire */ } finally {
      setUsageLoading(false);
    }
  }, []);

  useEffect(() => { loadUsage(); }, [loadUsage]);

  // ── Apprentissage progressif : signaux captés, consolidation de la mémoire ──
  const [appr, setAppr] = useState<ApprStatus | null>(null);
  const [apprLoading, setApprLoading] = useState(false);
  const [apprMsg, setApprMsg] = useState<string | null>(null);

  const loadAppr = useCallback(async () => {
    setApprLoading(true);
    try {
      const res = await fetch('/api/attache/apprentissage');
      if (res.ok) setAppr((await res.json()).apprentissage || null);
    } catch { /* silencieux : statut secondaire */ } finally {
      setApprLoading(false);
    }
  }, []);

  useEffect(() => { loadAppr(); }, [loadAppr]);

  const runAppr = useCallback(async (action: 'consolidation' | 'etude' = 'consolidation') => {
    setApprMsg(null);
    try {
      const res = await fetch('/api/attache/apprentissage', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      setApprMsg(res.ok && data.ok
        ? (action === 'etude'
          ? 'Étude du corpus lancée — l\'attaché dépouille vos actes validés (sous-agents) ; les modèles extraits (trames « modele-… ») et le livrable arriveront dans le fil « pendant votre absence ».'
          : 'Consolidation lancée (run court, modèle économe) — la carte « Apprentissage » arrivera dans le fil « pendant votre absence », et la mémoire distillée sera visible dans le panneau de l\'attaché.')
        : `Lancement refusé : ${data.error || res.status}`);
      setTimeout(loadAppr, 1500);
    } catch (e) {
      setApprMsg(`Lancement impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [loadAppr]);

  /** Applique un forfait de référence : remplit les plafonds repères. */
  const applyPlan = useCallback((plan: string) => {
    const preset = PLAN_PRESETS.find((p) => p.value === plan);
    if (!preset) return;
    if (plan === 'custom' || plan === '') updateConfig({ plan });
    else updateConfig({ plan, cap5h: preset.cap5h, capHebdo: preset.capHebdo });
  }, [updateConfig]);

  const loadRoutines = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/routines');
      if (res.ok) setRoutines((await res.json()).routines || []);
    } catch { /* silencieux */ }
  }, []);

  // ── Skills (comme Claude web) : enveloppes déchiffrées dans CE navigateur ──
  // fileId = nom du fichier serveur (clé de suppression) — peut différer du
  // champ « nom » déchiffré sur d'anciens enregistrements.
  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/skills');
      if (!res.ok) return;
      const { skills: envs } = await res.json();
      const decrypt = bridgeFn('attache_decrypt');
      const out: Skill[] = [];
      for (const e of (envs || []) as Array<{ id: string; envelope: unknown }>) {
        const payload = await decrypt(e.envelope) as Skill | null;
        if (payload?.contenu) out.push({ ...payload, nom: payload.nom || e.id, fileId: e.id });
      }
      setSkills(out.sort((a, b) => a.nom.localeCompare(b.nom)));
    } catch { /* silencieux — les erreurs remontent sur les actions */ }
  }, []);

  // ── Trames : mêmes enveloppes, déchiffrées ICI ──
  const loadTrames = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/trames');
      if (!res.ok) return;
      const { trames: envs } = await res.json();
      const decrypt = bridgeFn('attache_decrypt');
      const out: Trame[] = [];
      for (const e of (envs || []) as Array<{ id: string; envelope: unknown }>) {
        const payload = await decrypt(e.envelope) as Trame | null;
        if (payload?.contenu) out.push({ ...payload, nom: payload.nom || e.id, fileId: e.id });
      }
      setTrames(out.sort((a, b) => a.nom.localeCompare(b.nom)));
    } catch { /* silencieux — les erreurs remontent sur les actions */ }
  }, []);

  // ── Associations : enveloppe unique, déchiffrée ICI (comme la mémoire) ──
  const loadAssociations = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/associations');
      if (!res.ok) return;
      const { envelope } = await res.json();
      if (!envelope) { setAssoc([]); return; }
      const payload = await bridgeFn('attache_decrypt')(envelope) as { entries?: Array<{ id?: string; acte?: string; trames?: string[]; skills?: string[]; notes?: string }> } | null;
      setAssoc((payload?.entries || []).map((e) => ({
        id: /^[a-f0-9]{6,32}$/.test(String(e.id || '')) ? e.id! : assocId(),
        acte: e.acte || '',
        tramesText: (e.trames || []).join(', '),
        skillsText: (e.skills || []).join(', '),
        notes: e.notes || '',
      })));
    } catch { /* silencieux — les erreurs remontent sur l'enregistrement */ }
  }, []);

  const saveAssociations = useCallback(async () => {
    setAssocSaving(true);
    try {
      const entries = assoc
        .map((r) => ({
          id: /^[a-f0-9]{6,32}$/.test(r.id) ? r.id : assocId(),
          acte: r.acte.trim().slice(0, 120),
          trames: splitAssocList(r.tramesText),
          skills: splitAssocList(r.skillsText),
          notes: r.notes.trim().slice(0, 500) || undefined,
          updatedAt: new Date().toISOString(),
        }))
        .filter((e) => e.acte);
      const envelope = await bridgeFn('attache_encrypt')({ entries });
      const res = await fetch('/api/attache/associations', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ envelope }),
      });
      if (res.ok) setNotice('Associations enregistrées — l\'attaché appliquera d\'office la trame et la skill du type d\'acte, sans reposer la question.');
      else { const d = await res.json().catch(() => ({} as { error?: string })); setNotice(`Enregistrement refusé : ${d.error || res.status}`); }
      loadAssociations();
    } catch (e) {
      setNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssocSaving(false);
    }
  }, [assoc, loadAssociations]);

  /**
   * Suggère des associations acte → trame + skill à partir de la bibliothèque.
   * L'attaché PROPOSE (une passe rapide, quelques secondes) : les suggestions
   * sont chargées en lignes de BROUILLON — rien n'est appliqué tant que vous
   * n'avez pas cliqué « Enregistrer ». On n'ajoute que les types d'acte absents.
   */
  const suggestAssociations = useCallback(async () => {
    setAssocSuggesting(true);
    try {
      const res = await fetch('/api/attache/associations', { method: 'POST' });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string; suggestions?: Array<{ acte: string; trames?: string[]; skills?: string[]; notes?: string }> }));
      if (!res.ok || !data.ok) { setNotice(`Suggestion impossible : ${data.error || 'service injoignable'}`); return; }
      const sugg = Array.isArray(data.suggestions) ? data.suggestions : [];
      let ajoutes = 0;
      setAssoc((rows) => {
        const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
        const seen = new Set(rows.map((r) => norm(r.acte)));
        const add: AssocRow[] = [];
        for (const s of sugg) {
          const key = norm(s.acte);
          if (!s.acte || !key || seen.has(key)) continue;
          seen.add(key);
          add.push({ id: assocId(), acte: String(s.acte).slice(0, 120), tramesText: (s.trames || []).join(', '), skillsText: (s.skills || []).join(', '), notes: (s.notes || '').slice(0, 500) });
        }
        ajoutes = add.length;
        return [...rows, ...add];
      });
      setNotice(ajoutes
        ? `${ajoutes} association(s) suggérée(s) et ajoutée(s) en brouillon — vérifiez et ajustez, puis « Enregistrer ». Rien n'est appliqué tant que vous n'avez pas enregistré.`
        : 'Aucune nouvelle association à suggérer (celles pertinentes existent déjà, ou la bibliothèque de trames est vide).');
    } catch (e) {
      setNotice(`Suggestion impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssocSuggesting(false);
    }
  }, []);

  // ── Propositions de méthode (trames & skills révisées par l'attaché, ✓/✗) ──
  const [methodProps, setMethodProps] = useState<MethodProp[]>([]);
  const [methodBusy, setMethodBusy] = useState<string | null>(null);

  const loadMethodProps = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/propositions');
      if (!res.ok) return;
      const { propositions } = await res.json();
      setMethodProps(((propositions || []) as MethodProp[]).filter((p) => p.type === 'trame' || p.type === 'skill'));
    } catch { /* silencieux */ }
  }, []);

  const decideMethodProp = useCallback(async (p: MethodProp, action: 'valider' | 'refuser') => {
    setMethodBusy(p.id);
    try {
      const res = await fetch('/api/attache/propositions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, action }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (res.ok && data.ok) {
        setNotice(action === 'valider'
          ? `${p.type === 'trame' ? 'Trame' : 'Skill'} « ${p.payload.nom} » mise à jour (l'ancienne version reste archivée).`
          : 'Proposition refusée — l\'attaché en tirera la leçon à la prochaine consolidation.');
        if (action === 'valider') { loadTrames(); loadSkills(); }
      } else {
        setNotice(`Décision refusée : ${data.error || res.status}`);
      }
      loadMethodProps();
    } catch (e) {
      setNotice(`Décision impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMethodBusy(null);
    }
  }, [loadMethodProps, loadTrames, loadSkills]);

  useEffect(() => { refresh(); loadRoutines(); loadSkills(); loadTrames(); loadAssociations(); loadMethodProps(); }, [refresh, loadRoutines, loadSkills, loadTrames, loadAssociations, loadMethodProps]);

  /** Conversion des fichiers choisis en trames — tout se passe dans CE navigateur (E2EE). */
  const stageFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setConverting(true);
    setStaged([]);
    const rows: StagedDoc[] = [];
    for (const file of Array.from(files)) {
      const base = { fichier: file.name, titre: titreDepuisFichier(file.name), contenu: '' };
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
      const record = { nom: id, description: '', contenu: s.contenu.slice(0, 200_000), updatedAt: new Date().toISOString() };
      try {
        const envelope = await encrypt(record);
        const res = await fetch('/api/attache/trames', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, envelope }),
        });
        if (res.ok) savedNoms.push(id);
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
    loadTrames();
    if (savedNoms.length && analyseAfter) {
      const res = await fetch('/api/attache/trames', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analyse: savedNoms }),
      }).catch(() => null);
      setNotice(
        `${savedNoms.length} trame(s) enregistrée(s)${failed.length ? ` — échec : ${failed.join(', ')}` : ''}. ` +
        (res?.ok ? 'Classement lancé : une description par trame arrivera dans le fil « pendant votre absence » (quelques secondes).'
          : 'Classement non lancé (service occupé ou injoignable) — relancez depuis ce panneau.')
      );
    } else {
      setNotice(`${savedNoms.length} trame(s) enregistrée(s)${failed.length ? ` — échec : ${failed.join(', ')}` : ''}.`);
    }
  }, [staged, analyseAfter, loadTrames]);

  // ── Import des .skill Claude web : déballés ici, enregistrés comme skills ──
  const stageSkillFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setConverting(true);
    setSkillStaged([]);
    const rows: StagedSkill[] = [];
    for (const file of Array.from(files)) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (/\.(skill|zip)$/i.test(file.name)) {
          const imported = await skillFromArchive(file.name, bytes);
          rows.push({ fichier: file.name, ...imported, description: imported.description });
        } else {
          // markdown nu : le nom de fichier devient le nom de la skill
          const contenu = decodeText(bytes);
          rows.push({ fichier: file.name, nom: titreDepuisFichier(file.name), description: '', contenu: contenu.slice(0, 200_000) });
        }
      } catch (e) {
        rows.push({ fichier: file.name, nom: titreDepuisFichier(file.name), description: '', contenu: '', erreur: e instanceof Error ? e.message : String(e) });
      }
      setSkillStaged([...rows]);
    }
    setConverting(false);
  }, []);

  const saveStagedSkills = useCallback(async () => {
    const valid = skillStaged.filter((s) => !s.erreur && s.contenu.trim() && skillSlug(s.nom));
    if (!valid.length) return;
    const encrypt = bridgeFn('attache_encrypt');
    const saved: string[] = [];
    const failed: string[] = [];
    let n = 0;
    for (const s of valid) {
      n++;
      setUploadBusy(`${n}/${valid.length}`);
      const id = skillSlug(s.nom);
      try {
        const envelope = await encrypt({
          nom: id,
          description: s.description.trim().slice(0, 300),
          contenu: s.contenu.slice(0, 200_000),
          updatedAt: new Date().toISOString(),
        });
        const res = await fetch('/api/attache/skills', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id, envelope }),
        });
        if (res.ok) saved.push(id);
        else {
          const data = await res.json().catch(() => ({} as { error?: string }));
          failed.push(`${s.fichier} (${data.error || res.status})`);
        }
      } catch (e) {
        failed.push(`${s.fichier} (${e instanceof Error ? e.message : 'erreur'})`);
      }
    }
    setUploadBusy(null);
    setSkillStaged([]);
    loadSkills();
    // Classement incrémental : ne décrit QUE les skills fraîchement importées et
    // sans description (le service ignore celles déjà décrites — front-matter
    // .skill intact). Pas de sous-agent : une passe rapide, comme les trames.
    if (saved.length) {
      fetch('/api/attache/skills', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analyse: saved }),
      }).catch(() => null);
    }
    setNotice(`${saved.length} skill(s) importée(s)${failed.length ? ` — échec : ${failed.join(', ')}` : ''}. L'attaché les applique dès le prochain échange${saved.length ? ' ; description auto pour celles qui n\'en avaient pas' : ''}.`);
  }, [skillStaged, loadSkills]);

  /** Classe (décrit) les skills sans description — passe rapide, une par skill, sans sous-agent. */
  const analyseSkills = useCallback(async (noms: string[]) => {
    if (!noms.length) return;
    if (!status?.keyring?.granted) {
      setNotice('Remettez d\'abord les clés à l\'attaché (bouton « Remettre les clés » en haut) — sans elles, il ne peut pas lire les skills pour les décrire.');
      return;
    }
    setSkillAnalyseBusy(true);
    setNotice('Classement des skills en cours de lancement…');
    const res = await fetch('/api/attache/skills', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analyse: noms }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({} as { error?: string })) : { error: 'service injoignable' };
    setNotice(res?.ok
      ? 'Classement des skills lancé — seules celles sans description sont décrites (le résultat arrive dans le fil « pendant votre absence »).'
      : `Classement impossible : ${data.error || 'erreur'}`);
    setSkillAnalyseBusy(false);
  }, [status]);

  /** Classe (décrit) les trames de la bibliothèque : une passe rapide, une description par trame. */
  const analyseTrames = useCallback(async (noms: string[]) => {
    if (!noms.length) return;
    // Sans trousseau, le service attaché ne peut pas déchiffrer les trames : on le
    // dit clairement AU LIEU d'un bouton mort qui ne réagit pas (feedback local + toast).
    if (!status?.keyring?.granted) {
      const m = 'Remettez d\'abord les clés à l\'attaché (bouton « Remettre les clés » en haut) — sans elles, il ne peut pas lire les trames pour les classer.';
      setTrameAnalyseMsg(m);
      setNotice(m);
      return;
    }
    setTrameAnalyseBusy(true);
    setTrameAnalyseMsg('Classement en cours de lancement…');
    setNotice('Classement en cours de lancement…');
    const res = await fetch('/api/attache/trames', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ analyse: noms }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({} as { error?: string })) : { error: 'service injoignable' };
    const msg = res?.ok
      ? `Classement de ${noms.length} trame(s) lancé — une description par trame ; le résultat arrive dans le fil « pendant votre absence » (quelques secondes).`
      : `Classement impossible : ${data.error || 'erreur'}`;
    setTrameAnalyseMsg(msg);
    setNotice(msg);
    setTrameAnalyseBusy(false);
  }, [status]);

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

  /** Suppression d'une trame — par l'identifiant FICHIER, erreurs affichées. */
  const removeTrame = useCallback(async (t: Trame) => {
    if (!window.confirm(`Supprimer la trame « ${t.nom} » ?\nLa dernière version reste archivée côté serveur.`)) return;
    try {
      const res = await fetch('/api/attache/trames?id=' + encodeURIComponent(t.fileId || t.nom), { method: 'DELETE' });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (!res.ok) setNotice(`Suppression refusée : ${data.error || res.status}`);
      else if (data.ok === false) setNotice(`Trame « ${t.nom} » introuvable côté serveur — liste actualisée.`);
      else setNotice(`Trame « ${t.nom} » supprimée (version archivée côté serveur).`);
    } catch (e) {
      setNotice(`Suppression impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
    loadTrames();
  }, [loadTrames]);

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

  /** Suppression d'une skill — par l'identifiant FICHIER, erreurs affichées. */
  const removeSkill = useCallback(async (s: Skill) => {
    if (!window.confirm(`Supprimer la skill « ${s.nom} » ?\nLa dernière version reste archivée côté serveur.`)) return;
    try {
      const res = await fetch('/api/attache/skills?id=' + encodeURIComponent(s.fileId || s.nom), { method: 'DELETE' });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
      if (!res.ok) setNotice(`Suppression refusée : ${data.error || res.status}`);
      else if (data.ok === false) setNotice(`Skill « ${s.nom} » introuvable côté serveur — liste actualisée.`);
      else setNotice(`Skill « ${s.nom} » supprimée (version archivée côté serveur).`);
    } catch (e) {
      setNotice(`Suppression impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
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

  /** Diagnostic boîte mail : teste la connexion IMAP (lecture seule, rien n'est relevé). */
  const testMail = useCallback(async () => {
    setShowMailDiag(true);
    setMailTesting(true);
    setMailTest(null);
    try {
      const res = await fetch('/api/attache/mail-test', { method: 'POST' });
      const data = await res.json().catch(() => ({ ok: false, error: 'réponse illisible du service' }));
      setMailTest(data);
    } catch (e) {
      setMailTest({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setMailTesting(false);
    }
  }, []);

  /** Ouvre le formulaire de réglages mail, pré-rempli avec la config connue (jamais le mot de passe). */
  const openMailForm = useCallback(() => {
    const m = status?.mail || {};
    setMailForm({
      open: true,
      imapHost: m.imapHost || '',
      imapPort: String(m.imapPort || 993),
      imapSecure: m.imapSecure !== false,
      imapUser: m.imapUser || '',
      imapPassword: '',
    });
  }, [status]);

  /** Enregistre les réglages IMAP saisis dans l'app, puis teste aussitôt la connexion. */
  const saveMailForm = useCallback(async () => {
    setMailSaving(true);
    try {
      const body: Record<string, unknown> = {
        imapHost: mailForm.imapHost.trim(),
        imapPort: Number(mailForm.imapPort) || 993,
        imapSecure: mailForm.imapSecure,
        imapUser: mailForm.imapUser.trim(),
      };
      if (mailForm.imapPassword) body.imapPassword = mailForm.imapPassword;
      const res = await fetch('/api/attache/mail-config', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false } as { ok?: boolean; error?: string }));
      if (data.ok) {
        setMailForm((f) => ({ ...f, open: false, imapPassword: '' }));
        setNotice('Réglages mail enregistrés — test de connexion en cours…');
        await refresh();
        await testMail();
      } else {
        setNotice(`Enregistrement refusé : ${data.error || res.status}`);
      }
    } catch (e) {
      setNotice(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMailSaving(false);
    }
  }, [mailForm, refresh, testMail]);

  /** Efface les réglages in-app : retour aux variables d'environnement du serveur. */
  const revertMailConfig = useCallback(async () => {
    if (!window.confirm('Revenir aux réglages du serveur (.env) et effacer ceux saisis dans l\'app ?')) return;
    setMailSaving(true);
    try {
      const res = await fetch('/api/attache/mail-config', { method: 'DELETE' });
      const data = await res.json().catch(() => ({ ok: false } as { ok?: boolean; error?: string }));
      setNotice(data.ok ? 'Réglages in-app effacés — retour aux réglages du serveur.' : `Échec : ${data.error || res.status}`);
      await refresh();
    } finally {
      setMailSaving(false);
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
        ses livrables et réponses s'affichent <b>dans l'application</b> (fil « pendant votre absence », actes rédigés) —
        aucun mail sortant.
      </p>

      {/* État */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
        <Dot ok={status?.masterKey} label="Clé-maître du service" />
        <Dot ok={kr?.granted} label={kr?.granted ? `Trousseau remis (${(kr.scopes || []).join(', ')})` : 'Trousseau non remis'} />
        <Dot ok={status?.claude?.ok} label={status?.claude?.ok ? `Claude Code ${status.claude.version || ''}` : 'Claude Code non authentifié'} />
        <Dot ok={status?.mail?.imap} label="Boîte dédiée (IMAP)" />
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

      {/* Boîte mail — diagnostic : vérifier que la boîte dédiée fonctionne */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Mail className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Boîte mail (diagnostic)</span>
          <span className="text-[11px] text-gray-400">vérifier que la boîte dédiée répond — sans rien relever</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={openMailForm}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
              title="Saisir l'adresse, le serveur IMAP et le mot de passe de la boîte dédiée directement dans l'app"
            >
              <PenLine className="h-3 w-3" />Régler
            </button>
            <button
              onClick={testMail}
              disabled={mailTesting}
              className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
              title="Se connecte à la boîte dédiée en lecture seule et compte les messages — aucun message n'est relevé ni marqué lu."
            >
              {mailTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}Tester la connexion
            </button>
            <button
              onClick={() => setShowMailDiag((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              {showMailDiag ? 'Masquer' : 'Détails'}
            </button>
          </div>
        </div>

        <div className="space-y-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Dot ok={status?.mail?.imapReady} label={status?.mail?.imapReady ? 'Boîte configurée' : 'Boîte non configurée'} />
            {status?.state?.lastFetchAt && (
              <span className="text-[11px] text-gray-500">
                Dernière relève : {new Date(status.state.lastFetchAt).toLocaleString('fr-FR')}
                {status.state.lastFetchOk === false ? ' · en échec' : status.state.lastFetchOk ? ' · réussie' : ''}
              </span>
            )}
          </div>

          {status?.mail && (
            <div className="flex items-center gap-2 text-[10.5px] text-gray-400">
              <span>Réglages {status.mail.overrideActive ? "saisis dans l'app" : 'du serveur (.env)'}.</span>
              {status.mail.overrideActive && (
                <button onClick={revertMailConfig} disabled={mailSaving} className="underline hover:text-gray-600 disabled:opacity-50">Revenir aux réglages du serveur</button>
              )}
            </div>
          )}

          {/* Formulaire de réglages IMAP saisis dans l'app */}
          {mailForm.open && (
            <div className="space-y-2 rounded-lg border border-[#2B5746]/25 bg-emerald-50/30 p-3">
              <div className="text-[11px] font-semibold text-gray-700">Réglages de la boîte dédiée (IMAP)</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-[11px] text-gray-600">Adresse de la boîte
                  <input value={mailForm.imapUser} onChange={(e) => setMailForm({ ...mailForm, imapUser: e.target.value })}
                    placeholder="crimorg@siral.fr"
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
                </label>
                <label className="block text-[11px] text-gray-600">Mot de passe
                  <input type="password" value={mailForm.imapPassword} onChange={(e) => setMailForm({ ...mailForm, imapPassword: e.target.value })}
                    placeholder={status?.mail?.imapPasswordSet ? '•••••• (laisser vide = inchangé)' : 'mot de passe de la boîte'}
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
                </label>
                <label className="block text-[11px] text-gray-600">Serveur IMAP
                  <input value={mailForm.imapHost} onChange={(e) => setMailForm({ ...mailForm, imapHost: e.target.value })}
                    placeholder="zimbra1.mail.ovh.net"
                    className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
                </label>
                <div className="flex items-end gap-3">
                  <label className="block text-[11px] text-gray-600">Port
                    <input value={mailForm.imapPort} onChange={(e) => setMailForm({ ...mailForm, imapPort: e.target.value.replace(/[^0-9]/g, '') })}
                      className="mt-0.5 w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50" />
                  </label>
                  <label className="inline-flex items-center gap-1.5 pb-1.5 text-[11px] text-gray-600">
                    <input type="checkbox" checked={mailForm.imapSecure} onChange={(e) => setMailForm({ ...mailForm, imapSecure: e.target.checked })} />SSL/TLS
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="mr-auto text-[10.5px] text-gray-400">Boîte OVH/Zimbra : <code>zimbra1.mail.ovh.net</code> · 993 · SSL · identifiant = adresse complète.</span>
                <button onClick={() => setMailForm({ ...mailForm, open: false })} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Annuler</button>
                <button onClick={saveMailForm} disabled={mailSaving || !mailForm.imapHost.trim() || !mailForm.imapUser.trim()}
                  className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {mailSaving ? 'Enregistrement…' : 'Enregistrer et tester'}
                </button>
              </div>
              <p className="text-[10.5px] leading-relaxed text-gray-400">
                Le mot de passe est confié au service attaché, qui le chiffre avec sa clé-maître — l'app ne le conserve jamais.
                L'envoi (SMTP) reste désactivé : ces réglages ne servent qu'à <b>relever</b> la boîte.
              </p>
            </div>
          )}

          {/* Dernière erreur de relève automatique, si présente */}
          {status?.state?.lastFetchOk === false && status?.state?.lastFetchError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              Dernière relève automatique en échec : {String(status.state.lastFetchError).slice(0, 300)}
            </p>
          )}

          {/* Résultat du test manuel */}
          {mailTesting && (
            <p className="inline-flex items-center gap-1.5 text-[11px] text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Connexion à la boîte dédiée…</p>
          )}
          {mailTest && !mailTesting && (
            mailTest.ok ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-800">
                <div className="font-semibold"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Connexion réussie.</div>
                <div className="mt-0.5">
                  {mailTest.messages} message(s) dans la boîte, dont {mailTest.unseen} non lu(s).
                  {mailTest.messages === 0 && ' La boîte est réellement vide — c\'est normal tant qu\'aucun mail n\'y a été transféré.'}
                  {mailTest.messages > 0 && mailTest.unseen === 0 && ' Tout est déjà relevé (les messages lus ne réapparaissent pas ici).'}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
                <div className="font-semibold"><XCircle className="mr-1 inline h-3.5 w-3.5" />Connexion impossible.</div>
                <div className="mt-0.5">{String(mailTest.error || 'erreur inconnue').slice(0, 400)}</div>
                {mailTest.configured === false ? (
                  <div className="mt-1 text-red-600">Renseignez sur le serveur <code>SIRAL_ATTACHE_IMAP_HOST</code>, <code>_USER</code> et <code>_PASSWORD</code> (voir <code>docs/ATTACHE.md</code>), puis redémarrez le service attaché.</div>
                ) : (
                  <div className="mt-1 text-red-600">Vérifiez l'adresse de la boîte, le mot de passe (mot de passe d'application si le fournisseur l'exige), l'hôte et le port IMAP ci-dessous.</div>
                )}
              </div>
            )
          )}

          {/* Détail de configuration (non secret) */}
          {showMailDiag && status?.mail && (
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2 text-[11px] text-gray-600 sm:grid-cols-2">
              <div><span className="text-gray-400">Adresse de la boîte : </span>{status.mail.imapUser || <span className="text-red-500">non renseignée</span>}</div>
              <div><span className="text-gray-400">Mot de passe : </span>{status.mail.imapPasswordSet ? 'défini' : <span className="text-red-500">absent</span>}</div>
              <div><span className="text-gray-400">Serveur IMAP : </span>{status.mail.imapHost ? `${status.mail.imapHost}:${status.mail.imapPort} ${status.mail.imapSecure ? '(TLS)' : '(non chiffré)'}` : <span className="text-red-500">non renseigné</span>}</div>
              <div><span className="text-gray-400">Relève automatique : </span>toutes les 5 min</div>
            </div>
          )}

          <p className="text-[10.5px] leading-relaxed text-gray-400">
            Une boîte <b>vide</b> n'est pas forcément un problème : elle le reste tant qu'aucun mail n'y est transféré,
            et les messages déjà relevés n'y réapparaissent pas (ils passent dans le fil « pendant votre absence »).
            Le test ci-dessus se connecte en <b>lecture seule</b> et ne relève rien — il sert à distinguer « boîte vide »
            d'un vrai problème de connexion. Les identifiants de la boîte se règlent sur le serveur (<code>docs/ATTACHE.md</code>) ;
            l'envoi de mails est désactivé (les réponses restent dans l'application).
          </p>
        </div>
      </div>

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
            title="Modèle des sous-agents (lots parallèles : analyse de PDF, balayage du brief, trames). Par défaut Sonnet (Haiku en mode économe) — jamais le modèle du run principal, pour ne pas lancer plusieurs runs lourds à la fois. Ne le montez que si l'analyse manque de finesse."
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
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-2.5">
          <label className="text-xs font-medium text-gray-600" htmlFor="attache-signature-cr">Signature des comptes rendus</label>
          <input
            id="attache-signature-cr"
            type="text"
            maxLength={60}
            placeholder="ex. AUDRAN C — sinon votre nom"
            value={config.signatureCR ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, signatureCR: e.target.value }))}
            onBlur={(e) => updateConfig({ signatureCR: e.target.value })}
            className="min-w-[180px] flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#2B5746]/50"
            title="Nom apposé sur les comptes rendus que l'attaché rédige (dans la chronologie et la liste des CR). Vide = nom de l'administrateur. Le mot « attaché » n'apparaît jamais."
          />
        </div>
      </div>

      {/* Consommation IA — traduire les jetons pour le magistrat (profane) */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Gauge className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Consommation IA</span>
          <span className="text-[11px] text-gray-400">où passent vos jetons — mesuré à chaque run</span>
          <button
            onClick={loadUsage}
            disabled={usageLoading}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${usageLoading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        </div>

        <div className="space-y-3 p-3">
          {(() => {
            const u = usage;
            if (!u || !u.entries) {
              return (
                <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-[12px] text-gray-500">
                  Aucun run mesuré pour l'instant. Dès que l'attaché travaille (chat, mails, brief, sous-agents),
                  sa consommation de jetons s'affiche ici, traduite en pourcentage de votre forfait.
                </p>
              );
            }
            const cap5h = config.cap5h || 0;
            const capHebdo = config.capHebdo || 0;
            const w5h = u.w5h || {}; const w7d = u.w7d || {}; const w30d = u.w30d || {}; const today = u.today || {};
            const total7 = w7d.total || 0;
            const cats = Object.entries(w7d.byCategory || {})
              .map(([k, v]: [string, any]) => ({ k, ...(USAGE_CATS[k] || USAGE_CATS.autres), total: v.total || 0, runs: v.runs || 0 }))
              .sort((a, b) => b.total - a.total)
              .filter((c) => c.total > 0);
            const top = cats[0];
            const subShare = total7 > 0 ? Math.round(((w7d.byCategory?.['sous-agents']?.total || 0) / total7) * 100) : 0;
            const pct5h = cap5h > 0 ? Math.round(((w5h.total || 0) / cap5h) * 100) : null;
            return (
              <>
                {/* Traduction en clair */}
                <p className="text-[12px] leading-relaxed text-gray-600">
                  {pct5h != null ? (
                    <>Sur la <b>fenêtre glissante de 5 h</b> (celle qui vous bride le plus vite), l'attaché a consommé
                      environ <b style={{ color: gaugeColor(pct5h) }}>{pct5h} %</b> de votre forfait
                      {config.plan ? ` ${PLAN_PRESETS.find((p) => p.value === config.plan)?.label?.replace('Claude ', '') || ''}` : ''}.{' '}</>
                  ) : (
                    <>Renseignez votre forfait ci-dessous pour traduire la consommation en pourcentage.{' '}</>
                  )}
                  Sur 7 jours : <b>{formatTokens(total7)} jetons</b> (équivalent crédits API ≈ {formatCostEur(w7d.cost || 0)}).
                  {top ? <> Premier poste : <b style={{ color: top.color }}>{top.label.toLowerCase()}</b>.</> : null}
                </p>

                {/* Gouverneur de consommation : bridage automatique en cours */}
                {governor && governor.level === 'stop' && (
                  <p className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-[11px] leading-relaxed text-red-700">
                    <b>Runs automatiques en pause</b> — forfait saturé ({governor.raison}). Le brief, l'étude et les
                    routines de fond sont suspendus et repartiront seuls dès que la fenêtre de 5 h sera redescendue.
                    Vos conversations et le traitement des mails continuent (les sous-agents sont automatiquement bridés).
                  </p>
                )}
                {governor && governor.level === 'serrer' && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    <b>Bridage automatique actif</b> — vous approchez du plafond ({governor.raison}). Les sous-agents
                    passent d'office en régime économe (modèle rapide, moins de tours, moins de parallélisme), sans
                    toucher à vos conversations.
                  </p>
                )}

                {/* Deux jauges : maintenant (5 h) et 7 jours */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <UsageGauge label="Maintenant · 5 h" hint="fenêtre glissante du forfait" total={w5h.total || 0} cap={cap5h} />
                  <UsageGauge label="7 derniers jours" hint="plafond hebdomadaire" total={total7} cap={capHebdo} />
                </div>

                {/* Chiffres bruts sur plusieurs fenêtres */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { l: "Aujourd'hui", b: today },
                    { l: '7 jours', b: w7d },
                    { l: '30 jours', b: w30d },
                  ].map(({ l, b }) => (
                    <div key={l} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">{l}</div>
                      <div className="text-sm font-semibold text-gray-800">{formatTokens(b?.total || 0)}</div>
                      <div className="text-[10px] text-gray-400">{b?.runs || 0} run{(b?.runs || 0) > 1 ? 's' : ''} · ≈ {formatCostEur(b?.cost || 0)}</div>
                    </div>
                  ))}
                </div>

                {/* Répartition par poste (7 jours) — met les sous-agents en évidence */}
                {cats.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-semibold text-gray-500">Où passent les jetons (7 jours)</div>
                    {cats.map((c) => {
                      const pct = total7 > 0 ? Math.round((c.total / total7) * 100) : 0;
                      return (
                        <div key={c.k} className="flex items-center gap-2">
                          <span className="w-40 shrink-0 truncate text-[11px] text-gray-600" title={c.label}>{c.label}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: c.color }} />
                          </div>
                          <span className="w-24 shrink-0 text-right text-[10.5px] text-gray-400">{formatTokens(c.total)} · {pct} %</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* « Lots parallèles, wtf ? » — d'OÙ viennent les sous-agents */}
                {(() => {
                  const src = w7d.sousAgentsBySource || {};
                  const subTotal = w7d.byCategory?.['sous-agents']?.total || 0;
                  const rows = Object.entries(src)
                    .map(([k, v]: [string, any]) => ({ k, total: v.total || 0, runs: v.runs || 0 }))
                    .filter((r) => r.total > 0)
                    .sort((a, b) => b.total - a.total);
                  if (!rows.length || subTotal <= 0) return null;
                  const srcLabel = srcLabelOf;
                  return (
                    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                      <div className="text-[11px] font-semibold text-amber-800">« Sous-agents (lots parallèles) », concrètement : des runs Claude lancés en parallèle pour lire vos dossiers — voici QUI les lance</div>
                      {rows.map((r) => {
                        const pct = Math.round((r.total / subTotal) * 100);
                        return (
                          <div key={r.k} className="flex items-center gap-2 text-[11px] text-amber-900">
                            <span className="w-40 shrink-0 truncate" title={srcLabel(r.k)}>{srcLabel(r.k)}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-100">
                              <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="w-24 shrink-0 text-right text-[10.5px]">{formatTokens(r.total)} · {r.runs} run{r.runs > 1 ? 's' : ''}</span>
                          </div>
                        );
                      })}
                      <p className="pt-0.5 text-[10.5px] leading-relaxed text-amber-700">
                        Le poste dominant vous dit quoi couper. Le <b>brief quotidien</b> (balayage matinal de tous les dossiers)
                        se désactive plus bas ; le balayage à la demande, planifiez-le en <b>routine de nuit</b>.
                      </p>
                    </div>
                  );
                })()}

                {/* Repli si l'attribution manque (anciens runs) : l'alerte simple */}
                {subShare >= 40 && !Object.keys(w7d.sousAgentsBySource || {}).length && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    Les <b>sous-agents</b> représentent {subShare} % de votre consommation sur 7 jours : des runs lancés en
                    parallèle (un par dossier / PDF). Le <b>brief quotidien</b> ci-dessous en est la première source — coupez-le
                    et planifiez le balayage en routine de nuit.
                  </p>
                )}

                {/* Derniers runs — VOIR ce qui a consommé, et quand */}
                {Array.isArray(u.recent) && u.recent.length > 0 && (
                  <details className="rounded-lg border border-gray-100 bg-gray-50/40 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-gray-600">Derniers runs — voir ce qui a consommé, et quand</summary>
                    <div className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
                      {u.recent.map((r: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-[10.5px] text-gray-500">
                          <span className="w-24 shrink-0 tabular-nums text-gray-400">{new Date(r.ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="flex-1 truncate">
                            {r.cat === 'sous-agents'
                              ? `sous-agent · ${srcLabelOf(r.src).toLowerCase()}`
                              : (USAGE_CATS[r.cat] || USAGE_CATS.autres).label.toLowerCase()}
                          </span>
                          <span className="w-16 shrink-0 text-right tabular-nums">{formatTokens(r.total)}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            );
          })()}

          {/* Forfait de référence — le dénominateur du pourcentage (ajustable) */}
          <div className="rounded-lg border border-gray-100 bg-gray-50/40 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-600">Votre forfait</span>
              <select
                value={config.plan || ''}
                onChange={(e) => applyPlan(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-[#2B5746]/50"
                title="Sert de repère pour le pourcentage"
              >
                {PLAN_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {(config.plan === 'custom') && (
                <>
                  <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                    5 h
                    <input
                      type="number" min={0} step={1000000}
                      value={config.cap5h || 0}
                      onChange={(e) => updateConfig({ cap5h: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-28 rounded border border-gray-200 px-1.5 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                    7 j
                    <input
                      type="number" min={0} step={1000000}
                      value={config.capHebdo || 0}
                      onChange={(e) => updateConfig({ capHebdo: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-28 rounded border border-gray-200 px-1.5 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                    />
                  </label>
                </>
              )}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-400">
              Repère indicatif : l'abonnement Claude ne publie pas ses plafonds en jetons (limites en messages/heures,
              fenêtre glissante de 5 h + plafond hebdomadaire). Ces valeurs donnent un dénominateur au pourcentage —
              ajustez-les à votre ressenti. Les jetons mesurés, eux, sont exacts.
            </p>
          </div>

          {/* Mode économe — le levier pour freiner la consommation */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={config.econome === true}
              onChange={(e) => updateConfig({ econome: e.target.checked })}
            />
            <span className="text-[11.5px] leading-relaxed text-gray-700">
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-800"><Leaf className="h-3.5 w-3.5" /> Mode économe</span>
              {' '}— pour freiner la consommation, surtout des sous-agents : ils basculent sur un modèle rapide
              (Haiku), avec moins de tours et un effort réduit ; le run principal est aussi resserré. Vos conversations
              gardent le modèle choisi. À activer quand les jetons filent vite ; à couper pour les dépouillements lourds.
            </span>
          </label>

          {/* Brief quotidien automatique — le PREMIER poste de dépense, coupé par défaut */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/40 px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={config.briefAuto === true}
              onChange={(e) => updateConfig({ briefAuto: e.target.checked })}
            />
            <span className="text-[11.5px] leading-relaxed text-gray-700">
              <span className="font-semibold text-gray-800">Brief quotidien automatique</span>
              {' '}— chaque matin, l&apos;attaché balaye <b>tous vos dossiers</b> en lançant <b>un sous-agent par dossier</b>
              {' '}(les fameux « lots parallèles »). C&apos;est de loin votre premier poste de jetons. <b>Désactivé par défaut :</b>
              {' '}tant qu&apos;il l&apos;est, aucun balayage automatique ne part le matin. Pour faire remonter les incohérences
              sans exploser votre fenêtre de 5 h, créez plutôt une <b>routine de nuit</b> (section Routines) ; le bouton
              {' '}« Générer le brief » reste disponible à la demande.
            </span>
          </label>
        </div>
      </div>

      {/* Apprentissage progressif — signaux captés gratuitement, mémoire consolidée sous budget */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <GraduationCap className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Apprentissage</span>
          <span className="text-[11px] text-gray-400">il apprend de vos corrections — mémoire distillée sous budget</span>
          <button
            onClick={loadAppr}
            disabled={apprLoading}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${apprLoading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        </div>
        <div className="space-y-3 p-3">
          <p className="text-[12px] leading-relaxed text-gray-600">
            <b>Entièrement automatique — vous n&apos;avez rien à faire.</b> Chaque correction de votre part est
            captée au vol, <b>sans consommer un seul jeton</b> : proposition refusée ✗ ou validée ✓, acte que
            l&apos;attaché a dû réviser, acte que vous corrigez à la main, reprise en conversation (« non, refais »,
            « je t&apos;avais dit… » — repérée d&apos;elle-même). Périodiquement, un <b>run court sur le modèle
            économe</b> distille ces signaux en règles générales, réécrit sa mémoire <b>sous un budget strict</b> et
            fait évoluer ses skills — l&apos;attaché s&apos;améliore <b>en faisant baisser</b> la consommation
            (moins d&apos;erreurs, moins de retouches), pas en l&apos;alourdissant.
          </p>

          {(() => {
            const a = appr;
            if (!a) {
              return <p className="rounded-lg bg-gray-50 px-3 py-3 text-center text-[12px] text-gray-500">Statut indisponible — service attaché injoignable ?</p>;
            }
            const mem = a.memoire;
            const memPct = mem && mem.budget > 0 ? Math.min(999, Math.round((mem.chars / mem.budget) * 100)) : 0;
            const types = Object.entries(a.parType || {}).filter(([, n]) => n > 0);
            return (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Signaux à distiller</div>
                    <div className="text-lg font-bold text-gray-800">{a.keyring === false ? '—' : a.pending ?? 0}</div>
                    <div className="text-[10px] text-gray-400">consolidation à {a.seuilSignaux ?? 12} signaux, ou tous les {a.cadenceJours ?? 7} j</div>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Dernière consolidation</div>
                    <div className="text-sm font-semibold text-gray-800">
                      {a.running ? 'en cours…' : a.lastRunAt ? new Date(a.lastRunAt).toLocaleDateString('fr-FR') : 'jamais'}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {a.running ? 'run économe lancé' : a.lastRunAt ? (a.lastRunOk === false ? 'échouée — retentera' : 'réussie') : 'rien encore à distiller'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">Mémoire</div>
                    <div className="text-sm font-semibold" style={{ color: mem?.over ? '#d97706' : '#1f2937' }}>
                      {mem ? `${memPct} % du budget` : '—'}
                    </div>
                    <div className="text-[10px] text-gray-400">{mem ? `${mem.chars.toLocaleString('fr-FR')} / ${mem.budget.toLocaleString('fr-FR')} caractères` : 'trousseau non remis'}</div>
                  </div>
                </div>

                {a.progression && (() => {
                  const p = a.progression;
                  const retouches = (f: ApprFenetre) => f.revisions + f.editionsMain;
                  const aDesDonnees = p.j30.tauxAcceptation != null || retouches(p.j30) + p.j30.portes + p.j30.corrections > 0
                    || p.j30prec.tauxAcceptation != null || retouches(p.j30prec) + p.j30prec.portes + p.j30prec.corrections > 0;
                  if (!aDesDonnees) return null;
                  return (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-gray-500">Progression mesurée (30 jours)</div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <ProgressionTile label="Propositions acceptées" now={p.j30.tauxAcceptation} before={p.j30prec.tauxAcceptation} unit=" %" />
                        <ProgressionTile label="Actes retouchés" now={retouches(p.j30)} before={retouches(p.j30prec)} invert />
                        <ProgressionTile label="Corrections & portes" now={p.j30.corrections + p.j30.portes} before={p.j30prec.corrections + p.j30prec.portes} invert />
                      </div>
                    </div>
                  );
                })()}
                {types.length > 0 && (
                  <div className="text-[11px] text-gray-500">
                    En attente : {types.map(([t, n]) => `${n} ${SIGNAL_LABELS[t] || t}`).join(' · ')}
                  </div>
                )}
                {a.due && !a.running && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-700">
                    Consolidation due ({a.due}) — elle partira automatiquement au prochain passage du service.
                  </p>
                )}
              </>
            );
          })()}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runAppr()}
              disabled={appr?.running === true || appr?.keyring === false}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#234639] disabled:opacity-50"
              title="Run court sur le modèle économe : distille les signaux et la mémoire, puis dépose une carte « Apprentissage » dans le fil."
            >
              {appr?.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Consolider maintenant
            </button>
            <span className="text-[10.5px] text-gray-400">
              Optionnel : tout part tout seul (accumulation, budget dépassé, ou au plus tard sous {appr?.cadenceJours ?? 7} jours dès le
              premier signal) — ce bouton sert seulement à ne pas attendre. La mémoire distillée reste lisible et corrigeable
              (icône livre du panneau) ; le coût des consolidations apparaît dans « Consommation IA », poste « Apprentissage ».
            </span>
          </div>

          {/* Étude du corpus : vos actes validés (zones Actes/DML) deviennent des modèles */}
          <div className="rounded-lg border border-gray-100 bg-gray-50/40 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-600">Étude du corpus d&apos;actes validés</span>
              <span className="text-[10.5px] text-gray-400">
                {appr?.etude
                  ? <>{appr.etude.corpus} acte{appr.etude.corpus > 1 ? 's' : ''} en zones Actes/DML ({appr.etude.dossiers} dossier{appr.etude.dossiers > 1 ? 's' : ''})
                    {appr.etude.nouveaux > 0 ? <> · <b className="text-gray-600">{appr.etude.nouveaux} nouveau{appr.etude.nouveaux > 1 ? 'x' : ''}</b> depuis la dernière étude</> : null}
                    {appr.etude.lastRunAt ? <> · dernière étude {new Date(appr.etude.lastRunAt).toLocaleDateString('fr-FR')}{appr.etude.lastRunOk === false ? ' (échouée)' : ''}</> : ' · jamais étudié'}</>
                  : 'statut indisponible'}
              </span>
              <button
                onClick={() => runAppr('etude')}
                disabled={appr?.etude?.running === true || appr?.keyring === false}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#2B5746]/30 px-2.5 py-1 text-[11px] font-semibold text-[#2B5746] hover:bg-[#2B5746]/5 disabled:opacity-50"
                title="Dépouille les actes signés et ordonnances JLD téléversés (sous-agents, copies markdown) et en extrait des modèles par type d'acte (trames « modele-… », versionnées)."
              >
                {appr?.etude?.running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Étudier mes actes maintenant
              </button>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-gray-400">
              Vos actes téléversés en zones <b>Actes</b> et <b>DML</b> sont des versions <b>validées</b> — vos actes signés, et les
              ordonnances des JLD qui reprennent ou reformulent vos requêtes. L&apos;attaché les étudie tout seul (à l&apos;arrivée de{' '}
              {appr?.etude?.seuil ?? 5} nouveaux actes, ou tous les {appr?.etude?.cadenceJours ?? 30} jours s&apos;il y a du nouveau) et en extrait des{' '}
              <b>modèles par type d&apos;acte</b> (trames « modele-… », anonymisées, versionnées — supprimables d&apos;un geste), plus les exigences de
              motivation des juges (paires requête ↔ ordonnance). Vos propres trames ne sont jamais modifiées.
            </p>
          </div>
          {appr?.keyring === false && (
            <p className="text-[11px] text-amber-700">Remettez d&apos;abord les clés à l&apos;attaché (bouton « Remettre les clés » en haut) pour consulter les signaux et consolider.</p>
          )}
          {apprMsg && <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11.5px] text-gray-600">{apprMsg}</p>}
        </div>
      </div>

      {/* Propositions de méthode — trames/skills révisées par l'attaché, appliquées d'un ✓ */}
      {methodProps.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/30">
          <div className="flex items-center gap-2 border-b border-amber-100 px-3 py-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold text-gray-800">Propositions de méthode</span>
            <span className="text-[11px] text-gray-500">
              {methodProps.length} amélioration{methodProps.length > 1 ? 's' : ''} de trame/skill en attente de votre décision — rien n&apos;est modifié sans votre ✓
            </span>
          </div>
          <div className="space-y-2 p-3">
            {methodProps.map((p) => (
              <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{p.type}</span>
                  <span className="text-xs font-semibold text-gray-800">{p.titre}</span>
                  {p.creeLe && <span className="text-[10px] text-gray-400">{new Date(p.creeLe).toLocaleDateString('fr-FR')}</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={() => decideMethodProp(p, 'valider')}
                      disabled={methodBusy === p.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#234639] disabled:opacity-50"
                      title="Applique le texte révisé (l'ancienne version reste archivée — réversible)."
                    >
                      {methodBusy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Appliquer
                    </button>
                    <button
                      onClick={() => decideMethodProp(p, 'refuser')}
                      disabled={methodBusy === p.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" /> Refuser
                    </button>
                  </span>
                </div>
                {p.payload.motif && (
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-600"><b>Pourquoi :</b> {p.payload.motif}</p>
                )}
                {p.source && <p className="mt-0.5 text-[10.5px] text-gray-400">Source : {p.source}</p>}
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] font-semibold text-[#2B5746]">Voir le texte proposé ({(p.payload.contenu || '').length.toLocaleString('fr-FR')} caractères)</summary>
                  {p.payload.description && <p className="mt-1 text-[11px] text-gray-500">Description : {p.payload.description}</p>}
                  <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 font-mono text-[11px] leading-relaxed text-gray-700">{p.payload.contenu}</pre>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <span className="text-[11px] text-gray-400">vos méthodes réutilisables — téléversez vos .skill Claude web tels quels · chiffrées, versionnées</span>
          <input ref={skillFileInput} type="file" multiple accept={SKILL_ACCEPT} className="hidden"
            onChange={(e) => { stageSkillFiles(e.target.files); e.currentTarget.value = ''; }} />
          <button
            onClick={() => analyseSkills(skills.map((s) => s.nom))}
            disabled={skillAnalyseBusy || skills.length === 0}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Décrit les skills qui n'ont pas encore de description — passe rapide (un appel modèle, sans sous-agent). Les skills déjà décrites (front-matter .skill) sont laissées intactes."
          >
            {skillAnalyseBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Classer
          </button>
          <button
            onClick={() => skillFileInput.current?.click()}
            disabled={converting || uploadBusy !== null}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Téléverser vos fichiers .skill exportés de Claude web (ou des .md)"
          >
            <UploadCloud className="h-3 w-3" />Téléverser
          </button>
          <button
            onClick={() => setSkillForm({ open: !skillForm.open, nom: '', description: '', contenu: '' })}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Plus className="h-3 w-3" />Nouvelle
          </button>
        </div>

        {skillStaged.length > 0 && (
          <div className="space-y-2 border-b border-gray-100 bg-gray-50/50 p-3">
            <div className="text-[11px] font-semibold text-gray-600">
              {converting
                ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Lecture des skills ({skillStaged.length})…</span>
                : `${skillStaged.filter((s) => !s.erreur).length} skill(s) prête(s) sur ${skillStaged.length} — vérifiez noms et descriptions avant d'enregistrer.`}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {skillStaged.map((s, i) => (
                <div key={s.fichier + i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                  <span className="max-w-[24%] truncate text-[10.5px] text-gray-400" title={s.fichier}>{s.fichier}</span>
                  {s.erreur ? (
                    <span className="flex-1 truncate text-[11px] text-red-500" title={s.erreur}>✗ {s.erreur}</span>
                  ) : (
                    <>
                      <input
                        value={s.nom}
                        onChange={(e) => setSkillStaged(skillStaged.map((r, j) => (j === i ? { ...r, nom: e.target.value } : r)))}
                        className="w-44 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                      />
                      <input
                        value={s.description}
                        placeholder="Description — QUAND l'utiliser"
                        onChange={(e) => setSkillStaged(skillStaged.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))}
                        className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-[11px] outline-none focus:border-[#2B5746]/50"
                      />
                      <span className="whitespace-nowrap text-[10px] text-gray-400">{Math.round(s.contenu.length / 1000)} k</span>
                      {s.avertissement && <span title={s.avertissement}><AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /></span>}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setSkillStaged([])} disabled={uploadBusy !== null}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Annuler</button>
              <button onClick={saveStagedSkills} disabled={converting || uploadBusy !== null || !skillStaged.some((s) => !s.erreur)}
                className="rounded-lg bg-[#2B5746] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {uploadBusy ? `Enregistrement ${uploadBusy}…` : `Enregistrer ${skillStaged.filter((s) => !s.erreur).length} skill(s)`}
              </button>
            </div>
          </div>
        )}

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

        {skills.length === 0 && !skillForm.open && skillStaged.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">
            Aucune skill. Téléversez directement vos fichiers .skill exportés de Claude web (bouton Téléverser) ou
            collez-en une (nom, description, contenu) : l'attaché en voit la liste en permanence et charge la bonne
            dès qu'une tâche correspond. En chat, « enregistre cette skill » fonctionne aussi.
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
                <button onClick={() => removeSkill(s)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
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
            onChange={(e) => { stageFiles(e.target.files); e.target.value = ''; }} />
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

        {staged.length > 0 && (
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
                Faire classer par l'attaché après l'enregistrement : une description par trame (rapide, fil « pendant votre absence »)
              </label>
              <button onClick={() => setStaged([])} disabled={uploadBusy !== null}
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

        {trames.length === 0 && !trameForm.open && staged.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">
            Aucune trame. Téléversez votre stock (.odt, .docx, .pdf…) : conversion en markdown ici même, puis
            classement rapide (une description par trame) par l'attaché. En chat, « enregistre cette trame » fonctionne aussi.
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
                <button onClick={() => removeTrame(t)} title="Supprimer" className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {trames.length > 0 && (
          <div className="space-y-1.5 border-t border-gray-100 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => analyseTrames(trames.map((t) => t.nom))} disabled={trameAnalyseBusy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                title="L'attaché parcourt la bibliothèque et donne à chaque trame une description (type d'acte, cadre juridique, articles visés, régime 706-80). Passe rapide et économe — quelques secondes. Pour une analyse juridique en profondeur d'une trame (nullités, contrôle de légalité), demandez-la dans le chat de l'attaché.">
                {trameAnalyseBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Classer la bibliothèque
              </button>
              <span className="text-[10.5px] text-gray-400">{trames.length} trame(s) · description rapide de chaque trame</span>
            </div>
            {!kr?.granted && (
              <p className="text-[10.5px] text-amber-600">
                Remettez d&apos;abord les clés à l&apos;attaché (bouton « Remettre les clés » en haut) pour lancer l&apos;analyse.
              </p>
            )}
            {trameAnalyseMsg && (
              <p className="text-[10.5px] leading-relaxed text-gray-500">{trameAnalyseMsg}</p>
            )}
          </div>
        )}
      </div>

      {/* Trames de forme — papeteries Word (.docx) de l'utilisateur, remplies à l'export */}
      <div className="rounded-xl border border-gray-200 p-3">
        <TramesFormePanel />
      </div>

      {/* Associations « type d'acte → trame + skill » — appliquées d'office par l'attaché */}
      <div className="rounded-xl border border-gray-200">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <SlidersHorizontal className="h-4 w-4 text-[#2B5746]" />
          <span className="text-sm font-semibold text-gray-800">Associations acte → trame + skill</span>
          <span className="hidden text-[11px] text-gray-400 sm:inline">la trame et la skill appliquées d&apos;office pour chaque type d&apos;acte</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={suggestAssociations}
              disabled={assocSuggesting || trames.length === 0}
              title="L'attaché parcourt vos trames et vos skills et propose les liens acte → trame + skill. Les suggestions arrivent en brouillon : vous vérifiez, ajustez, puis « Enregistrer ». Rien n'est appliqué sans votre validation. (Classez d'abord la bibliothèque pour de meilleures suggestions.)"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              {assocSuggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Suggérer
            </button>
            <button
              onClick={() => setAssoc((rows) => [...rows, { id: assocId(), acte: '', tramesText: '', skillsText: '', notes: '' }])}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              <Plus className="h-3 w-3" />Ajouter
            </button>
            <button
              onClick={saveAssociations}
              disabled={assocSaving}
              className="inline-flex items-center gap-1 rounded-lg bg-[#2B5746] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {assocSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}Enregistrer
            </button>
          </div>
        </div>

        {/* Autocomplétion depuis les trames/skills existantes */}
        <datalist id="assoc-trames">{trames.map((t) => <option key={t.nom} value={t.nom} />)}</datalist>
        <datalist id="assoc-skills">{skills.map((s) => <option key={s.nom} value={s.nom} />)}</datalist>

        <div className="space-y-2 p-3">
          <p className="text-[11px] leading-relaxed text-gray-500">
            L&apos;attaché consulte cette table avant de rédiger : si le type d&apos;acte y figure, il applique directement la
            trame et la skill indiquées — il ne redemande plus. Plusieurs noms séparés par des virgules.
            <b> « Suggérer »</b> pré-remplit la table à partir de votre bibliothèque — en brouillon, à vérifier puis enregistrer.
          </p>
          {assoc.length === 0 && (
            <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-[11px] text-gray-400">
              Aucune association. <b>« Suggérer »</b> pour que l&apos;attaché propose les liens acte → trame + skill, ou « Ajouter » pour en créer un à la main.
            </p>
          )}
          {assoc.map((r, i) => (
            <div key={r.id} className="grid grid-cols-1 gap-1.5 rounded-lg border border-gray-200 p-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
              <input
                value={r.acte}
                onChange={(e) => setAssoc((rows) => rows.map((x, j) => (j === i ? { ...x, acte: e.target.value } : x)))}
                placeholder="Type d'acte (ex. prolongation géoloc JLD)"
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50"
              />
              <input
                value={r.tramesText}
                onChange={(e) => setAssoc((rows) => rows.map((x, j) => (j === i ? { ...x, tramesText: e.target.value } : x)))}
                placeholder="Trame(s)"
                list="assoc-trames"
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50"
              />
              <input
                value={r.skillsText}
                onChange={(e) => setAssoc((rows) => rows.map((x, j) => (j === i ? { ...x, skillsText: e.target.value } : x)))}
                placeholder="Skill(s)"
                list="assoc-skills"
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-[#2B5746]/50"
              />
              <button
                onClick={() => setAssoc((rows) => rows.filter((_, j) => j !== i))}
                title="Retirer cette ligne"
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <input
                value={r.notes}
                onChange={(e) => setAssoc((rows) => rows.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                placeholder="Note (optionnel)"
                className="rounded-lg border border-gray-100 bg-gray-50/60 px-2 py-1.5 text-[11px] outline-none focus:border-[#2B5746]/40 sm:col-span-4"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Base de connaissances — le cerveau documentaire, explorateur + arborescence */}
      <AttacheKbSection granted={Boolean(kr?.granted)} onNotice={setNotice} />

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
