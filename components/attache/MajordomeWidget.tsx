'use client';

/**
 * SIRAL — Attaché de justice · widget « majordome » du tableau de bord.
 *
 * Le brief du magistrat, visible du SEUL administrateur (le widget se
 * masque de lui-même si /api/attache/status ne répond pas 200 — les autres
 * utilisateurs reçoivent 404 et ne voient rien).
 *
 * Chaque item appelle UN geste : copier un projet de mail ou de DML (rien
 * ne part jamais vers les enquêteurs — c'est le magistrat qui colle et
 * envoie), noter une échéance, faire une vérification NPP, passer un appel.
 * « Traité » / « Ignorer » rangent l'item.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Scale, RefreshCw, Loader2, Copy, Check, X, ChevronDown, ChevronUp,
  CalendarClock, Mail, FileText, Eye, Phone, StickyNote, Sparkles,
} from 'lucide-react';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { electronAPI: Record<string, AnyFn> }).electronAPI;

interface Item {
  id: string;
  type: 'echeance' | 'projet_mail' | 'projet_dml' | 'verification' | 'appel' | 'note';
  titre: string;
  detail?: string;
  dossier?: string;
  echeance?: string;
  mail?: { destinataire: string; objet: string; corps: string };
  appel?: { qui: string; motif: string };
  at?: string;
  ts: number;
}

const TYPE_META: Record<Item['type'], { label: string; icon: React.ElementType; tint: string }> = {
  echeance:     { label: 'Échéances',        icon: CalendarClock, tint: 'text-amber-600' },
  projet_mail:  { label: 'Mails à envoyer',  icon: Mail,          tint: 'text-blue-600' },
  projet_dml:   { label: 'DML préparées',    icon: FileText,      tint: 'text-purple-600' },
  verification: { label: 'À vérifier (vous seul)', icon: Eye,     tint: 'text-rose-600' },
  appel:        { label: 'À appeler',        icon: Phone,         tint: 'text-emerald-700' },
  note:         { label: 'Notes',            icon: StickyNote,    tint: 'text-gray-500' },
};
const TYPE_ORDER: Item['type'][] = ['echeance', 'verification', 'projet_mail', 'projet_dml', 'appel', 'note'];

/** Échéance AAAA-MM-JJ → JJ-MM-AAAA (format français). Chaîne inchangée sinon. */
function formatEcheance(s?: string): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

/** Détail assez long pour risquer d'être tronqué (2 lignes) → mérite un dépliage. */
function detailIsLong(s?: string): boolean {
  return !!s && (s.length > 110 || s.includes('\n'));
}

/** Identifiants forts d'un objet (plaque, IMEI, ligne) pour reconnaître un doublon. */
function extractIdentifiers(text: string): string[] {
  const ids = new Set<string>();
  const s = text || '';
  // Plaques SIV (AB-123-CD, tirets optionnels)
  for (const m of s.matchAll(/\b[A-Z]{2}-?\d{3}-?[A-Z]{2}\b/g)) ids.add('plaque:' + m[0].replace(/-/g, '').toUpperCase());
  // IMEI (15 chiffres)
  for (const m of s.matchAll(/\b\d{15}\b/g)) ids.add('imei:' + m[0]);
  // Lignes téléphoniques FR (0X XX XX XX XX, séparateurs libres)
  for (const m of s.matchAll(/\b0[1-9](?:[ .\-]?\d{2}){4}\b/g)) ids.add('tel:' + m[0].replace(/[ .\-]/g, ''));
  return [...ids];
}

/** Signature d'un item : même type + même dossier + mêmes identifiants = doublon. */
function itemSignature(it: Item): string {
  const ids = extractIdentifiers(`${it.titre} ${it.detail || ''}`);
  if (ids.length) return `${it.type}|${it.dossier || ''}|${ids.sort().join(',')}`;
  const titre = it.titre.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  return `${it.type}|${it.dossier || ''}|${it.echeance || ''}|${titre}`;
}

/** Dédoublonne en gardant la 1re occurrence (la liste est triée du plus récent au plus ancien). */
function dedupeItems(items: Item[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of items) {
    const sig = itemSignature(it);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(it);
  }
  return out;
}

/** Échéance strictement dépassée (hier ou avant) : l'item est périmé, plus la peine de l'afficher. */
function isPastDeadline(s?: string): boolean {
  if (!s) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

/** Regroupe une liste d'items par dossier (groupe « Autres dossiers » pour ceux sans tag), en conservant
 * l'ordre de récence des items et en plaçant en tête le groupe dont l'item le plus récent est le plus récent. */
function groupByDossier(items: Item[]): Array<{ dossier: string; items: Item[] }> {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = it.dossier || 'Autres dossiers';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  return [...groups.entries()]
    .map(([dossier, items]) => ({ dossier, items }))
    .sort((a, b) => (b.items[0]?.ts || 0) - (a.items[0]?.ts || 0));
}

function CopyButton({ text, label = 'Copier' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* refus navigateur */ }
      }}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-[#2B5746] text-white hover:brightness-110'}`}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? 'Copié' : label}
    </button>
  );
}

export function MajordomeWidget({ onOpenDossier }: { onOpenDossier?: (numero: string) => void }) {
  const [available, setAvailable] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [briefRunning, setBriefRunning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/majordome');
      if (!res.ok) { setAvailable(false); return; }
      setAvailable(true);
      const { entries, statuses } = await res.json();
      const out: Item[] = [];
      for (const e of entries as Array<{ ts: number; id?: string; iv: string; ct: string }>) {
        if (e.id && statuses?.[e.id]) continue; // traité ou ignoré : rangé
        const item = await eapi().attache_decrypt({ v: 1, encrypted: true, iv: e.iv, ct: e.ct });
        if (item) out.push({ ...(item as Item), ts: e.ts });
      }
      // Plus récent d'abord, puis dédoublonnage (un objet = un seul item), puis
      // autonettoyage des items dont l'échéance est déjà dépassée (périmés, plus
      // la peine de les faire relire — s'ils appellent encore un geste, l'attaché
      // les republiera avec une date à jour au prochain brief).
      setItems(dedupeItems(out.reverse()).filter((it) => !isPastDeadline(it.echeance)));
    } catch {
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const mark = useCallback(async (id: string, status: 'traite' | 'ignore') => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch('/api/attache/majordome', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  }, []);

  const runBrief = useCallback(async () => {
    setBriefRunning(true);
    try {
      await fetch('/api/attache/majordome/run', { method: 'POST' });
      // le brief tourne en fond : on laisse un délai avant recharge
      setTimeout(() => { load(); setBriefRunning(false); }, 90_000);
    } catch {
      setBriefRunning(false);
    }
  }, [load]);

  if (!available) return null;

  const byType = new Map<Item['type'], Item[]>();
  for (const t of TYPE_ORDER) byType.set(t, []);
  for (const it of items) byType.get(it.type)?.push(it);

  return (
    <div className="rounded-2xl border border-[#2B5746]/20 bg-gradient-to-b from-emerald-50/50 to-white shadow-[0_1px_2px_rgba(20,32,27,0.04)]">
      {/* En-tête */}
      <div className="flex items-center gap-2.5 px-5 py-3.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#2B5746] to-[#3c7a5f] text-white">
          <Scale className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-[13.5px] font-bold text-gray-900">Votre attaché a préparé</div>
          <div className="text-[11px] text-gray-500">
            {items.length ? `${items.length} point(s) appellent un geste de votre part` : 'Rien en attente — alimenté par vos routines de nuit et le bouton « Générer le brief »'}
          </div>
        </div>
        <button
          onClick={runBrief}
          disabled={briefRunning}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2B5746]/25 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#2B5746] hover:bg-emerald-50 disabled:opacity-50"
          title="Balayer tous les dossiers et regénérer le brief"
        >
          {briefRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {briefRunning ? 'Brief en cours…' : 'Générer le brief'}
        </button>
        <button onClick={load} disabled={loading} className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-600" title="Actualiser">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={() => setCollapsed((v) => !v)} className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-gray-600">
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {/* Sections par type */}
      {!collapsed && items.length > 0 && (
        <div className="grid gap-3 px-5 pb-4 lg:grid-cols-2">
          {TYPE_ORDER.map((type) => {
            const list = byType.get(type) || [];
            if (!list.length) return null;
            const meta = TYPE_META[type];
            const Icon = meta.icon;
            return (
              <div key={type} className="rounded-xl border border-gray-200 bg-white">
                <div className={`flex items-center gap-1.5 border-b border-gray-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide ${meta.tint}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                  <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[10px] font-bold text-gray-500">{list.length}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {groupByDossier(list).map((group) => (
                    <div key={group.dossier}>
                      <div
                        className={`flex items-center gap-1.5 bg-gray-50/70 px-3 py-1 text-[10px] font-bold text-gray-500 ${onOpenDossier && group.dossier !== 'Autres dossiers' ? 'cursor-pointer hover:text-[#2B5746]' : ''}`}
                        onClick={onOpenDossier && group.dossier !== 'Autres dossiers' ? () => onOpenDossier(group.dossier) : undefined}
                      >
                        {group.dossier}
                        <span className="rounded-full bg-white px-1.5 text-[9px] font-bold text-gray-400">{group.items.length}</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {group.items.map((it) => (
                          <div key={it.id} className="px-3 py-2.5">
                            <div className="flex items-start gap-2">
                              <div
                                className={`min-w-0 flex-1 ${onOpenDossier && it.dossier ? 'cursor-pointer' : ''}`}
                                onClick={onOpenDossier && it.dossier ? () => onOpenDossier(it.dossier!) : undefined}
                                title={onOpenDossier && it.dossier ? 'Ouvrir la fiche du dossier (l\'acte rédigé est dans « Actes rédigés »)' : undefined}
                              >
                                <div className={`text-[12.5px] font-semibold leading-snug text-gray-800 ${onOpenDossier && it.dossier ? 'hover:text-[#2B5746]' : ''}`}>
                                  {it.titre}
                                  {it.echeance && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">→ {formatEcheance(it.echeance)}</span>}
                                </div>
                                {it.appel && (
                                  <div className="mt-0.5 text-[11.5px] text-gray-600"><b>{it.appel.qui}</b> — {it.appel.motif}</div>
                                )}
                                {it.mail && (
                                  <div className="mt-0.5 text-[11.5px] text-gray-500">À : {it.mail.destinataire} · <i>{it.mail.objet}</i></div>
                                )}
                                {it.detail && !it.mail && (
                                  <div className={`mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-gray-600 ${expanded === it.id ? '' : 'line-clamp-2'}`}>
                                    {it.detail}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-1">
                                {it.mail && <CopyButton text={`À : ${it.mail.destinataire}\nObjet : ${it.mail.objet}\n\n${it.mail.corps}`} />}
                                {!it.mail && it.detail && it.type === 'projet_dml' && <CopyButton text={it.detail} />}
                                <button onClick={() => mark(it.id, 'traite')} title="Traité" className="rounded-md p-1 text-gray-300 hover:bg-emerald-50 hover:text-emerald-600">
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => mark(it.id, 'ignore')} title="Ignorer" className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500">
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            {/* Dépliage : corps de mail à copier, OU tout détail long
                                (échéance, vérification, appel, note…) que le clamp à
                                2 lignes coupait — le texte doit être lisible en entier. */}
                            {(it.mail || detailIsLong(it.detail)) && (
                              <button
                                onClick={() => setExpanded(expanded === it.id ? null : it.id)}
                                className="mt-1 text-[10.5px] font-medium text-gray-400 hover:text-gray-600"
                              >
                                {expanded === it.id ? '▲ replier' : (it.mail ? '▼ relire le texte complet' : '▼ voir tout le détail')}
                              </button>
                            )}
                            {/* Corps du mail : bloc dédié copiable. Le détail non-mail
                                est déplié directement dans la ligne ci-dessus (plus de
                                clamp), inutile de le répéter ici. */}
                            {expanded === it.id && it.mail?.corps && (
                              <pre className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-2.5 font-sans text-[11.5px] leading-relaxed text-gray-700">
                                {it.mail.corps}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!collapsed && (
        <div className="border-t border-emerald-100/60 px-5 py-1.5 text-center text-[10px] text-gray-400">
          Rien ne part vers les enquêteurs : vous copiez, vous envoyez. Visible de vous seul.
        </div>
      )}
    </div>
  );
}
