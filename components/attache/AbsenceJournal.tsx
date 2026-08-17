'use client';

/**
 * SIRAL — Attaché de justice · journal « pendant votre absence » (tableau de bord).
 *
 * Pleine largeur, sur la page « Assistant de justice ». Il rassemble CE QUI A ÉTÉ FAIT en
 * l'absence du magistrat — hors décisions, qui restent dans le panneau
 * (« À trancher »). Les cartes sont groupées par dossier ; celles reliées à un
 * document rédigé (acte, livrable — champ `prodId`) s'ouvrent en grand pour
 * lecture / édition / retouche / export (ProductionPopup) ; les autres sont de
 * simples informations à parcourir.
 *
 * Admin only : la route /status renvoie 404 aux autres comptes → le widget se
 * masque de lui-même. Tout est chiffré : le navigateur déchiffre pour afficher.
 *
 * L'état de LECTURE (cartes rangées, repère « vu ») est partagé entre tous les
 * appareils via /api/attache/journal — sous forme d'empreintes opaques, jamais
 * de contenu. Ranger ou consulter sur l'ordinateur vaut donc sur le téléphone,
 * et inversement ; le localStorage n'est plus qu'un cache de secours. Le
 * journal se nettoie aussi TOUT SEUL : actes validés/supprimés, dossiers
 * entièrement traités, et cartes d'information déjà vues depuis plus de 48 h.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, FileText, ArrowRight, X, Undo2 } from 'lucide-react';
import { ProductionPopup } from './ProductionPopup';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface FeedCard {
  type: string;
  titre: string;
  resume: string;
  numero?: string;
  at?: string;
  convId?: string;
  qid?: string;
  /** Carte reliée à un document rédigé (production) : ouvre le popup. */
  prodId?: string;
}
/** `hid` : empreinte opaque de la carte (voir hashKey) — id de synchronisation. */
type Card = FeedCard & { ts: number; hid: string };

/** Statut des actes d'un dossier (déchiffré côté navigateur) — sert à
 * l'auto-nettoyage : une carte dont l'acte est validé ou supprimé disparaît. */
interface DossierProdStatus {
  /** ids de tous les actes présents sur disque (fiable sans déchiffrer). */
  existing: Set<string>;
  /** ids des actes VALIDÉS (traités) par le magistrat. */
  treated: Set<string>;
  /** Horodatage (ms) de la dernière validation quand TOUS les actes du dossier
   * sont traités ; null tant qu'il reste un acte en attente. */
  completedAt: number | null;
}

// Cartes d'INFORMATION qui n'appellent plus rien une fois le travail du dossier
// terminé (tous ses actes validés) : résumés, annonces d'actes, mails traités,
// livrables, projets de réponse… — à la clôture, elles s'effacent toutes.
// Seules les alertes restent jusqu'à rangement manuel ou expiration après
// lecture (voir AUTO_EXPIRE_SEEN_MS).
const AUTO_HIDE_SUMMARY_TYPES = new Set(['acte', 'prolongation', 'note', 'synthese', 'mail_traite', 'livrable', 'projet_reponse']);

const FEED_ICONS: Record<string, string> = {
  mail_traite: '📨', synthese: '📋', acte: '⚖️', prolongation: '🕐',
  projet_reponse: '✉️', alerte: '⚠️', note: '📝', livrable: '📦',
};

// État de lecture — la référence est le SERVEUR (/api/attache/journal), partagé
// entre appareils ; le localStorage n'est qu'un cache (affichage immédiat,
// repli hors-ligne, re-synchronisé à la visite suivante).
const JOURNAL_SEEN_KEY = 'attache_journal_seen_ts';
/** Ancien format local (clés en clair `ts|titre`) : migré en empreintes vers le
 * serveur à la première visite, puis retiré. */
const JOURNAL_DISMISSED_LEGACY_KEY = 'attache_journal_dismissed';
/** Empreintes (hex) des cartes rangées — miroir local de l'état serveur. */
const JOURNAL_DISMISSED_KEY = 'attache_journal_dismissed_v2';
/** Nettoyage par ancienneté : une carte d'INFORMATION déjà couverte par le
 * repère « vu » d'une visite PRÉCÉDENTE s'efface seule au bout de 48 h. Ne
 * concerne jamais une carte reliée à un acte encore en attente (travail à
 * faire) ni une carte jamais vue. Le journal est un fil de reprise, pas une
 * archive — l'historique complet reste dans les dossiers (« Actes rédigés »)
 * et le journal d'audit. */
const AUTO_EXPIRE_SEEN_MS = 48 * 3600_000;

/** Clé stable d'une carte (le fil n'a pas d'id) : horodatage + titre. */
const cardKey = (c: { ts: number; titre?: string }) => `${c.ts}|${c.titre || ''}`;

/** Le serveur n'accepte qu'un lot borné d'empreintes par requête (MAX_BATCH) :
 * un « tout ranger » sur des centaines de cartes est découpé. */
const DISMISS_CHUNK = 300;

/** Signature de CONTENU d'une carte — indépendante de son horodatage. Deux
 * cartes qui disent exactement la même chose (le gouverneur de consommation
 * republiait sa note de mise en pause toutes les heures : des CENTAINES de
 * lignes identiques qui noyaient le vrai travail) sont repliées en UNE SEULE
 * ligne portant le nombre de répétitions. */
const contentKey = (c: FeedCard) =>
  `${c.numero || ''}|${c.type}|${c.titre || ''}|${c.resume || ''}`;

/** Un groupe de cartes identiques : la plus récente représente le lot. */
interface CardGroup {
  /** Carte représentative (la plus récente du lot). */
  head: Card;
  /** Toutes les cartes du lot, plus récente d'abord. */
  all: Card[];
  /** Horodatage de la plus ANCIENNE occurrence (affiché quand count > 1). */
  firstTs: number;
}

/** Replie les cartes identiques (même dossier, type, titre et résumé). Les
 * cartes reliées à un document (prodId) ne sont JAMAIS repliées : chacune
 * ouvre un acte distinct. */
function groupIdentical(list: Card[]): CardGroup[] {
  const byContent = new Map<string, CardGroup>();
  const out: CardGroup[] = [];
  for (const c of list) {
    if (c.prodId) { out.push({ head: c, all: [c], firstTs: c.ts }); continue; }
    const k = contentKey(c);
    const g = byContent.get(k);
    if (!g) {
      const fresh: CardGroup = { head: c, all: [c], firstTs: c.ts };
      byContent.set(k, fresh);
      out.push(fresh);
      continue;
    }
    // `list` est déjà triée du plus récent au plus ancien : `head` reste la
    // première rencontrée, et chaque nouvelle occurrence recule `firstTs`.
    g.all.push(c);
    g.firstTs = Math.min(g.firstTs, c.ts);
  }
  return out;
}

/** Empreinte opaque (SHA-256 tronqué, hex) d'une clé de carte. Seule cette
 * empreinte — jamais le titre — est envoyée au serveur : le fichier de statuts
 * partagé est en clair sur disque et ne doit rien apprendre du contenu. */
async function hashKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Résumé assez long pour être coupé par le clamp (2 lignes) → dépliable. */
const resumeIsLong = (s?: string) => !!s && (s.length > 110 || s.includes('\n'));

export function AbsenceJournal({ onOpenDossier }: { onOpenDossier?: (numero: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [qStatuses, setQStatuses] = useState<Record<string, { status: string }>>({});
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [popup, setPopup] = useState<{ numero: string; prodId: string } | null>(null);
  const [seenTs, setSeenTs] = useState(0);
  /** Repère « vu » TEL QU'AU CHARGEMENT (visites précédentes) : sert au
   * nettoyage par ancienneté — figé pour ne pas faire disparaître des cartes
   * sous les yeux du magistrat pendant qu'il les lit. */
  const [seenAtLoad, setSeenAtLoad] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [prodStatus, setProdStatus] = useState<Record<string, DossierProdStatus>>({});
  /** Dernier rangement en lot — permet de le DÉFAIRE (« Annuler »). Un « tout
   * ranger » porte sur des centaines de cartes : il ne doit jamais être
   * irréversible. */
  const [lastBulk, setLastBulk] = useState<{ ids: string[]; label: string } | null>(null);
  /** Confirmation en deux temps du « tout ranger » (pas de fenêtre modale). */
  const [confirmClear, setConfirmClear] = useState(false);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/feed');
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      const { entries } = await res.json();
      const out: Array<FeedCard & { ts: number }> = [];
      for (const e of entries as Array<{ ts: number; iv: string; ct: string }>) {
        const card = await eapi().attache_decrypt({ v: 1, encrypted: true, iv: e.iv, ct: e.ct });
        if (card) out.push({ ...(card as FeedCard), ts: e.ts });
      }
      out.reverse(); // plus récent d'abord
      setCards(await Promise.all(out.map(async (c): Promise<Card> => ({ ...c, hid: await hashKey(cardKey(c)) }))));
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const postJournal = useCallback(async (body: { dismiss?: string[]; restore?: string[]; seenTs?: number }) => {
    const res = await fetch('/api/attache/journal', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('synchronisation refusée');
  }, []);

  /** Pousse un lot d'empreintes au serveur en respectant sa borne par requête. */
  const postIdsChunked = useCallback(async (field: 'dismiss' | 'restore', ids: string[]) => {
    for (let i = 0; i < ids.length; i += DISMISS_CHUNK) {
      await postJournal({ [field]: ids.slice(i, i + DISMISS_CHUNK) });
    }
  }, [postJournal]);

  // État de lecture : serveur d'abord (il fait foi entre appareils), fusionné
  // avec le cache local — qui reprend seul la main hors-ligne. Les rangements
  // que le serveur ne connaît pas encore (hors-ligne passé, ancien format en
  // clair) lui sont poussés ici, en une fois.
  const loadJournalState = useCallback(async () => {
    let localSeen = 0;
    let localIds: string[] = [];
    let legacyIds: string[] = [];
    try { localSeen = Number(localStorage.getItem(JOURNAL_SEEN_KEY) || 0); } catch { /* */ }
    try {
      const raw = JSON.parse(localStorage.getItem(JOURNAL_DISMISSED_KEY) || '[]') as unknown[];
      localIds = raw.filter((s): s is string => typeof s === 'string');
    } catch { /* */ }
    try {
      const legacy = JSON.parse(localStorage.getItem(JOURNAL_DISMISSED_LEGACY_KEY) || '[]') as unknown[];
      legacyIds = await Promise.all(legacy.filter((s): s is string => typeof s === 'string').map(hashKey));
    } catch { /* */ }
    let serverIds: string[] = [];
    let serverSeen = 0;
    let serverOk = false;
    try {
      const res = await fetch('/api/attache/journal');
      if (res.ok) {
        const d = await res.json() as { dismissed?: unknown; seenTs?: unknown };
        serverIds = Array.isArray(d.dismissed) ? d.dismissed.map(String) : [];
        serverSeen = Number(d.seenTs) || 0;
        serverOk = true;
      }
    } catch { /* hors-ligne : le cache local suffit */ }
    const union = new Set([...serverIds, ...localIds, ...legacyIds]);
    // Fusions MONOTONES : ne jamais écraser un rangement ou un « vu » survenu
    // pendant le chargement.
    setDismissed((prev) => {
      const merged = new Set([...prev, ...union]);
      try { localStorage.setItem(JOURNAL_DISMISSED_KEY, JSON.stringify([...merged])); } catch { /* */ }
      return merged;
    });
    const seen = Math.max(serverSeen, localSeen);
    setSeenTs((v) => Math.max(v, seen));
    setSeenAtLoad((v) => Math.max(v, seen));
    try {
      if (seen > (Number(localStorage.getItem(JOURNAL_SEEN_KEY)) || 0)) localStorage.setItem(JOURNAL_SEEN_KEY, String(seen));
    } catch { /* */ }
    if (serverOk) {
      try {
        const known = new Set(serverIds);
        const missing = [...union].filter((id) => !known.has(id));
        if (missing.length) await postJournal({ dismiss: missing });
        if (localSeen > serverSeen) await postJournal({ seenTs: localSeen });
        // migration terminée : l'ancien format (clés en clair) ne sert plus
        localStorage.removeItem(JOURNAL_DISMISSED_LEGACY_KEY);
      } catch { /* re-tentera à la prochaine visite */ }
    }
  }, [postJournal]);

  // Statuts des questions (répondu / ignoré) — pour compter les décisions restantes.
  const loadStatuses = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/questions');
      if (res.ok) setQStatuses((await res.json()).statuses || {});
    } catch { /* silencieux */ }
  }, []);

  // Statut des actes par dossier (validés / supprimés) — sert à effacer
  // automatiquement du journal les cartes dont le travail est fait. Tout reste
  // chiffré : le navigateur déchiffre pour lire le seul champ `traite`.
  const loadProdStatus = useCallback(async (list: Card[]) => {
    const dossiers = new Set<string>();
    for (const c of list) {
      if (c.type === 'question') continue;
      dossiers.add(c.numero && c.numero !== '_hors-dossier' ? c.numero : '_hors-dossier');
    }
    if (dossiers.size === 0) { setProdStatus({}); return; }
    const out: Record<string, DossierProdStatus> = {};
    await Promise.all([...dossiers].map(async (numero) => {
      try {
        const res = await fetch('/api/attache/productions?numero=' + encodeURIComponent(numero));
        if (!res.ok) return; // réponse non fiable → on ne masque rien pour ce dossier
        const { productions } = await res.json();
        const existing = new Set<string>();
        const treated = new Set<string>();
        let decryptFailed = false;
        let completedAt = 0;
        for (const p of (productions || []) as Array<{ id: string; envelope: unknown }>) {
          existing.add(p.id); // présence disque : fiable même sans déchiffrer
          const rec = await eapi().attache_decrypt(p.envelope) as
            { traite?: boolean; traiteLe?: string; updatedAt?: string } | null;
          if (!rec) { decryptFailed = true; continue; }
          if (rec.traite) {
            treated.add(p.id);
            const t = Date.parse(rec.traiteLe || rec.updatedAt || '') || 0;
            if (t > completedAt) completedAt = t;
          }
        }
        // « Dossier clos » seulement si l'on a pu tout déchiffrer et que tout est traité.
        const allTreated = existing.size > 0 && treated.size === existing.size && !decryptFailed;
        out[numero] = { existing, treated, completedAt: allTreated ? (completedAt || Date.now()) : null };
      } catch { /* dossier ignoré */ }
    }));
    setProdStatus(out);
  }, []);

  useEffect(() => {
    loadFeed();
    loadStatuses();
    loadJournalState();
  }, [loadFeed, loadStatuses, loadJournalState]);

  // Recalcule l'auto-nettoyage dès que le fil change (chargement, actualisation,
  // validation d'un acte depuis le popup…) : les cartes traitées s'effacent seules.
  useEffect(() => { if (available) loadProdStatus(cards); }, [available, cards, loadProdStatus]);

  // Ranger une ou PLUSIEURS cartes d'un coup : elles disparaissent du journal
  // ICI ET SUR LES AUTRES APPAREILS (empreintes poussées au serveur).
  // L'affichage réagit tout de suite ; si le réseau manque, le cache local
  // garde le rangement et la synchronisation se rejouera à la prochaine visite.
  const dismissMany = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      try { localStorage.setItem(JOURNAL_DISMISSED_KEY, JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
    postIdsChunked('dismiss', ids).catch(() => { /* re-poussé à la prochaine visite */ });
  }, [postIdsChunked]);

  // Défaire le dernier rangement en lot : les cartes reviennent au fil, ici et
  // sur les autres appareils.
  const undoBulk = useCallback(() => {
    if (!lastBulk) return;
    const { ids } = lastBulk;
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      try { localStorage.setItem(JOURNAL_DISMISSED_KEY, JSON.stringify([...next])); } catch { /* */ }
      return next;
    });
    setLastBulk(null);
    postIdsChunked('restore', ids).catch(() => { /* re-tenté à la prochaine visite */ });
  }, [lastBulk, postIdsChunked]);

  const reload = useCallback(() => { loadFeed(); loadStatuses(); }, [loadFeed, loadStatuses]);

  // Décisions en attente = questions du fil non encore répondues/ignorées.
  const decisions = useMemo(
    () => cards.filter((c) => c.type === 'question' && (!c.qid || !qStatuses[c.qid])).length,
    [cards, qStatuses],
  );

  const openPanel = useCallback(() => {
    try { window.dispatchEvent(new CustomEvent('siral:open-attache')); } catch { /* */ }
  }, []);

  // Une carte est « faite » (auto-nettoyée) quand :
  //  - son acte relié (prodId) a été validé par le magistrat, ou supprimé ;
  //  - ou, pour une carte d'information faisant doublon, quand TOUT le dossier
  //    est traité — et seulement si elle est antérieure à cette clôture, pour
  //    ne jamais masquer une nouveauté arrivée depuis.
  const isCardDone = useCallback((c: Card) => {
    const numero = c.numero && c.numero !== '_hors-dossier' ? c.numero : '_hors-dossier';
    const st = prodStatus[numero];
    if (c.prodId) return !!st && (st.treated.has(c.prodId) || !st.existing.has(c.prodId));
    return !!st?.completedAt && c.ts <= st.completedAt + 1000 && AUTO_HIDE_SUMMARY_TYPES.has(c.type);
  }, [prodStatus]);

  // Nettoyage par ancienneté : déjà vue lors d'une visite précédente ET vieille
  // de plus de 48 h → la carte s'efface seule, sans rangement manuel. Deux
  // garde-fous : une carte jamais vue n'expire JAMAIS (retour de longue
  // absence : tout attend), et une carte reliée à un acte (prodId) n'expire
  // pas non plus — tant que l'acte attend sa validation, c'est du travail à
  // faire ; elle disparaîtra par isCardDone (validation ou suppression).
  const isExpired = useCallback(
    (c: Card) => !c.prodId && seenAtLoad > 0 && c.ts <= seenAtLoad && Date.now() - c.ts > AUTO_EXPIRE_SEEN_MS,
    [seenAtLoad],
  );

  // Journal = tout sauf les questions (qui vivent dans « À trancher »), les
  // cartes rangées par le magistrat (ici ou sur un autre appareil) et celles
  // auto-nettoyées (travail fait, ou information vue depuis plus de 48 h).
  const journal = cards.filter((c) => c.type !== 'question' && !dismissed.has(c.hid) && !isCardDone(c) && !isExpired(c));

  // Horodatage le plus récent du fil (hors questions) : c'est le repère « vu »
  // à pousser — calculé sur TOUT le fil, pas seulement les cartes visibles,
  // pour ne jamais reculer quand la carte la plus récente vient d'être rangée.
  const newestTs = useMemo(
    () => cards.reduce((m, c) => (c.type !== 'question' && c.ts > m ? c.ts : m), 0),
    [cards],
  );

  // Avance le repère « vu » (serveur + cache local), sans toucher aux pastilles
  // de la session en cours.
  const pushSeen = useCallback((ts: number) => {
    if (!ts) return;
    try {
      if (ts > (Number(localStorage.getItem(JOURNAL_SEEN_KEY)) || 0)) localStorage.setItem(JOURNAL_SEEN_KEY, String(ts));
    } catch { /* */ }
    postJournal({ seenTs: ts }).catch(() => { /* re-poussé à la prochaine visite */ });
  }, [postJournal]);

  const markSeen = useCallback(() => {
    if (!newestTs) return;
    pushSeen(newestTs);
    setSeenTs((v) => Math.max(v, newestTs));
  }, [newestTs, pushSeen]);

  // « Vu » automatique : quelques secondes d'affichage du journal suffisent —
  // plus besoin de replier le bandeau pour que la consultation compte. Les
  // pastilles « nouveau » de CETTE session restent affichées ; mais le
  // téléphone ne recomptera plus en « nouvelles » ce qui a déjà été consulté
  // sur l'ordinateur (et inversement), et l'expiration à 48 h courra.
  useEffect(() => {
    if (!available || collapsed || !newestTs) return;
    const t = setTimeout(() => { if (!document.hidden) pushSeen(newestTs); }, 5000);
    return () => clearTimeout(t);
  }, [available, collapsed, newestTs, pushSeen]);

  if (!available) return null;
  if (journal.length === 0 && decisions === 0 && !lastBulk) return null;

  // Groupement par dossier. Ordre STABLE par numéro de dossier — et NON par
  // activité la plus récente : ranger une carte ne doit pas réordonner les
  // dossiers. Le tri par récence faisait « sauter » un dossier dès qu'on rangeait
  // sa carte la plus récente, obligeant à rechercher les autres à chaque geste.
  // Chaque dossier garde une place fixe ; « Sans dossier » reste en dernier.
  const groups = new Map<string, Card[]>();
  for (const c of journal) {
    const key = c.numero || '__sans__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => {
    if (a[0] === b[0]) return 0;
    if (a[0] === '__sans__') return 1;
    if (b[0] === '__sans__') return -1;
    return a[0].localeCompare(b[0], 'fr', { numeric: true });
  });
  const nouveaux = journal.filter((c) => c.ts > seenTs).length;

  // Ranger tout le fil d'un coup. Le fil se remplit de notes répétitives (le
  // gouverneur de consommation en publiait une par heure, des jours durant) :
  // sans geste de masse, il fallait fermer les cartes une par une.
  const clearAll = () => {
    // Dédoublonné : deux cartes de même horodatage ET même titre partagent leur
    // empreinte — sans quoi le compte annoncé serait faux et le lot gonflé.
    const ids = [...new Set(journal.map((c) => c.hid))];
    dismissMany(ids);
    setLastBulk({ ids, label: `${ids.length} carte${ids.length > 1 ? 's' : ''} rangée${ids.length > 1 ? 's' : ''}` });
    setConfirmClear(false);
  };

  return (
    <div className="rounded-2xl border border-[#2B5746]/20 bg-white shadow-[0_1px_2px_rgba(20,32,27,0.04)]">
      {/* Bandeau de reprise */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[13.5px] font-bold text-gray-900">Pendant votre absence</div>
            <div className="text-[11px] text-gray-500">
              {journal.length} action{journal.length > 1 ? 's' : ''} préparée{journal.length > 1 ? 's' : ''}
              {nouveaux > 0 && <span className="ml-1 text-[#2B5746]">· {nouveaux} nouvelle{nouveaux > 1 ? 's' : ''}</span>}
            </div>
          </div>
        </div>

        {decisions > 0 && (
          <button
            onClick={openPanel}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-white">{decisions}</span>
            décision{decisions > 1 ? 's' : ''} vous attend{decisions > 1 ? 'ent' : ''}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Tout ranger — confirmation en deux temps, puis annulable. */}
          {journal.length > 0 && (
            confirmClear ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={clearAll}
                  className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                >
                  Ranger les {journal.length}
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg px-1.5 py-1 text-[11px] text-gray-400 hover:text-gray-600"
                >
                  Annuler
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                title="Ranger toutes les cartes du fil (annulable)"
                className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              >
                Tout ranger
              </button>
            )
          )}
          <button onClick={reload} disabled={loading} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => { if (!collapsed) markSeen(); setCollapsed((v) => !v); }}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Rangement en lot : annulable tant que le bandeau est là. */}
      {lastBulk && (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11.5px] text-gray-600">
          <span>{lastBulk.label}.</span>
          <button
            onClick={undoBulk}
            className="inline-flex items-center gap-1 font-semibold text-[#2B5746] hover:underline"
          >
            <Undo2 className="h-3.5 w-3.5" />Annuler
          </button>
          <button onClick={() => setLastBulk(null)} className="ml-auto rounded p-0.5 text-gray-300 hover:text-gray-500" title="Fermer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Journal groupé par dossier — UNE seule colonne (et non deux) : ranger une
          carte fait juste remonter la suivante à sa place, sans réorganisation en
          travers entre colonnes. On garde ainsi ses repères d'un geste à l'autre. */}
      {!collapsed && journal.length > 0 && (
        <div className="grid gap-3 px-5 pb-4">
          {orderedGroups.map(([key, list]) => (
            <div key={key} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <span className="rounded bg-[#2B5746]/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#2B5746]">
                  {key === '__sans__' ? 'Sans dossier' : key}
                </span>
                <span className="ml-auto text-[10.5px] text-gray-400">{list.length} action{list.length > 1 ? 's' : ''}</span>
                {/* Vider ce dossier seul — sans toucher au reste du fil. */}
                <button
                  onClick={() => {
                    const ids = [...new Set(list.map((c) => c.hid))];
                    dismissMany(ids);
                    setLastBulk({ ids, label: `${ids.length} carte${ids.length > 1 ? 's' : ''} rangée${ids.length > 1 ? 's' : ''} (${key === '__sans__' ? 'sans dossier' : key})` });
                  }}
                  title="Ranger toutes les cartes de ce dossier (annulable)"
                  className="rounded px-1.5 py-0.5 text-[10.5px] text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  Tout ranger
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {groupIdentical(list).map((g) => {
                  const c = g.head;
                  const repeats = g.all.length;
                  const isDoc = !!c.prodId;
                  const isNew = c.ts > seenTs;
                  const k = cardKey(c);
                  const isExpanded = expandedKey === k;
                  // Clic : dossier réel → ouvre l'EnquêteDetail (l'acte rédigé y
                  // est dans « Actes rédigés »). Hors dossier avec document →
                  // ouvre le document. Sinon, non cliquable.
                  const canOpenDossier = !!onOpenDossier && !!c.numero && c.numero !== '_hors-dossier';
                  const onCardClick = canOpenDossier
                    ? () => onOpenDossier!(c.numero!)
                    : isDoc
                      ? () => setPopup({ numero: c.numero || '_hors-dossier', prodId: c.prodId! })
                      : undefined;
                  return (
                    <div key={k} className={`flex items-start gap-2.5 px-3 py-2.5 ${onCardClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      onClick={onCardClick}
                      title={canOpenDossier ? 'Ouvrir la fiche du dossier (acte rédigé dans « Actes rédigés »)' : undefined}
                    >
                      <span className="mt-0.5 text-[15px] leading-none">{FEED_ICONS[c.type] || '•'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-800">
                          <span className="truncate">{c.titre}</span>
                          {/* Cartes identiques repliées : le compteur remplace
                              les N lignes que le fil affichait auparavant. */}
                          {repeats > 1 && (
                            <span
                              className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500"
                              title={`${repeats} fois — la première le ${new Date(g.firstTs).toLocaleString('fr-FR')}`}
                            >
                              ×{repeats}
                            </span>
                          )}
                          {isNew && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2B5746]" title="Nouveau" />}
                        </div>
                        {!isDoc && c.resume && (
                          <>
                            <div className={`mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-500 ${isExpanded ? '' : 'line-clamp-2'}`}>{c.resume}</div>
                            {resumeIsLong(c.resume) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedKey(isExpanded ? null : k); }}
                                className="mt-0.5 text-[10.5px] font-medium text-gray-400 hover:text-gray-600"
                              >
                                {isExpanded ? '▲ replier' : '▼ voir tout le détail'}
                              </button>
                            )}
                          </>
                        )}
                        <div className="mt-0.5 text-[10px] text-gray-400">
                          {c.at ? new Date(c.at).toLocaleString('fr-FR') : ''}
                          {repeats > 1 && <span> · répétée {repeats} fois depuis le {new Date(g.firstTs).toLocaleString('fr-FR')}</span>}
                        </div>
                      </div>
                      {onCardClick && (
                        <span className="mt-0.5 inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-[#2B5746]/30 bg-emerald-50 px-2 py-1 text-[10.5px] font-semibold text-[#2B5746]">
                          <FileText className="h-3 w-3" />Ouvrir
                        </span>
                      )}
                      {/* Ranger la carte — et, si elle est repliée, TOUTES ses
                          répétitions d'un seul geste. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissMany(g.all.map((x) => x.hid)); }}
                        title={repeats > 1 ? `Ranger ces ${repeats} cartes identiques` : 'Ranger cette carte'}
                        className="mt-0.5 flex-shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!collapsed && (
        <div className="border-t border-gray-100 px-5 py-1.5 text-center text-[10px] text-gray-400">
          Documents éditables et exportables ici comme dans le dossier · décisions dans le panneau Attaché · visible de vous seul
        </div>
      )}

      {popup && (
        <ProductionPopup
          numero={popup.numero}
          prodId={popup.prodId}
          onClose={() => { setPopup(null); reload(); }}
          onChanged={reload}
        />
      )}
    </div>
  );
}
