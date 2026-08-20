// hooks/useGlobalSearch.ts
//
// Index de la recherche GLOBALE : rassemble en mémoire — déjà chargées par
// l'application, aucune lecture supplémentaire — les enquêtes de TOUS les
// contentieux accessibles (en cours ET terminées), les dossiers d'instruction,
// les mesures AIR, les personnes (mis en cause / mis en examen), les pages et
// les actions. L'index est reconstruit uniquement quand les données changent ;
// chaque frappe ne fait qu'interroger des chaînes prénormalisées.

import { useMemo } from 'react';
import { Enquete, AIRMesure } from '@/types/interfaces';
import { DossierInstruction } from '@/types/instructionTypes';
import { ContentieuxDefinition, ContentieuxId } from '@/types/userTypes';
import type { KnownPerson } from '@/utils/knownPersons';
import {
  GlobalSearchDoc,
  GlobalHitGroup,
  DocField,
  makeField,
  parseQuery,
  searchDocs,
  groupHits,
  squashAlnum,
} from '@/utils/globalSearch';

export interface GlobalSearchSources {
  /** Enquêtes par contentieux ACCESSIBLE (contentieux actif = données vives). */
  enquetesByContentieux: Map<ContentieuxId, Enquete[]>;
  instructions: DossierInstruction[];
  mesuresAIR: AIRMesure[];
  /** Contentieux accessibles à l'utilisateur (jamais plus). */
  contentieux: ContentieuxDefinition[];
  /** Contentieux dont l'utilisateur peut voir les statistiques. */
  statsContentieuxIds: ContentieuxId[];
  /** Contentieux où l'utilisateur peut créer une enquête. */
  createContentieuxIds: ContentieuxId[];
  modules: { instructions: boolean; air: boolean; mindmap: boolean };
  /** Fichier des personnes (mis en cause, mis en examen, suspects, victimes,
   *  fiches manuelles de la cartographie) déjà dédupliqué par `useKnownPersons`.
   *  Alimente le groupe « Personnes » de l'omnibox. */
  knownPersons?: KnownPerson[];
  hasOverboard: boolean;
  showAssistant: boolean;
}

const push = (fields: Array<DocField | null>, f: DocField | null) => {
  if (f) fields.push(f);
};

// ── Enquêtes ────────────────────────────────────

function buildEnqueteDoc(e: Enquete, ctxId: ContentieuxId): GlobalSearchDoc {
  const fields: DocField[] = [];
  const acc: Array<DocField | null> = fields as Array<DocField | null>;

  push(acc, makeField(e.numero, 3, { fuzzy: true, ops: ['no', 'num', 'numero'] }));
  // Alias « écrasé » des identifiants : retrouve « 85103/843/2026 » même tapé
  // sans les barres, et couvre n° parquet / IDJ.
  push(acc, makeField(
    [squashAlnum(e.numero), squashAlnum(e.numeroParquet || ''), squashAlnum(e.numeroIDJ || '')]
      .filter(Boolean).join(' '),
    2.6,
    { ops: ['no', 'num', 'numero'] }
  ));
  push(acc, makeField(
    (e.misEnCause || []).map(m => m.role ? `${m.nom} (${m.role})` : m.nom).join(' · '),
    2.4,
    { label: 'Mis en cause', fuzzy: true, ops: ['mec', 'nom', 'personne'] }
  ));
  push(acc, makeField((e.services || []).filter(Boolean).join(' · '), 2, { label: 'Service', fuzzy: true, ops: ['service', 'sce'] }));
  push(acc, makeField((e.tags || []).map(t => t.value).join(' · '), 1.8, { label: 'Tag', fuzzy: true, ops: ['tag'] }));
  push(acc, makeField(e.directeurEnquete, 1.8, { label: 'Directeur d’enquête', fuzzy: true, ops: ['dir', 'directeur'] }));
  push(acc, makeField(e.description, 1.2, { label: 'Description', maxLength: 4000, ops: ['desc', 'description'] }));

  // Numéros de téléphone (lignes d'écoute + cible quand elle contient elle-même
  // un numéro). Le moteur retrouve un numéro même partiel — ex. « 47.11 » pour
  // les deux derniers groupes — grâce à la variante alphanumérique écrasée qui
  // ignore les points/espaces/tirets de formatage.
  const phones: string[] = [];
  for (const ec of e.ecoutes || []) {
    if (ec.numero) phones.push(ec.numero);
    if (ec.cible && ec.cible.replace(/\D/g, '').length >= 4) phones.push(ec.cible);
  }
  push(acc, makeField(phones.join(' • '), 1.6, { label: 'Téléphone', ops: ['tel', 'telephone', 'gsm', 'ligne'] }));

  // Cibles de géolocalisation (véhicule, immatriculation, individu suivi…).
  const geolocs: string[] = [];
  for (const g of e.geolocalisations || []) {
    if (g.objet) geolocs.push(g.objet);
    if (g.description) geolocs.push(g.description);
  }
  push(acc, makeField(geolocs.join(' • '), 1.6, { label: 'Géolocalisation', fuzzy: true, ops: ['geoloc', 'cible', 'immat', 'plaque', 'vtam'] }));

  // Noms des documents versés (le CONTENU, lui, est fouillé en asynchrone).
  push(acc, makeField(
    (e.documents || []).flatMap(d => [d.nom, d.nomOriginal]).filter(Boolean).join(' • '),
    1.1,
    { label: 'Document', maxLength: 8000, ops: ['doc', 'document', 'fichier'] }
  ));

  // Contenu « profond » restant : CR et actes. Sous-chaîne exacte uniquement
  // (pas de tolérance de frappe sur du texte long) — c'est ce qui garde la
  // recherche instantanée. Téléphones et géolocalisations sont déjà couverts
  // par leurs champs dédiés ci-dessus (avec un poids plus élevé).
  const deep: string[] = [];
  for (const cr of e.comptesRendus || []) deep.push(cr.enqueteur, cr.description);
  for (const ec of e.ecoutes || []) deep.push(ec.description || '');
  for (const a of e.actes || []) deep.push(a.type, a.description);
  if (e.notes) deep.push(e.notes);
  push(acc, makeField(deep.filter(Boolean).join(' • '), 0.9, { label: 'Contenu', maxLength: 20000, ops: ['contenu', 'cr'] }));

  const mecList = (e.misEnCause || []).map(m => m.nom).filter(Boolean).join(', ');
  return {
    key: `enq_${ctxId}_${e.id}`,
    kind: 'enquete',
    title: e.numero,
    subtitle: e.description?.trim() || mecList || undefined,
    ctxId,
    archived: e.statut !== 'en_cours',
    fields,
    data: { ctxId, id: e.id, numero: e.numero, statut: e.statut },
  };
}

// ── Instructions ────────────────────────────────

function buildInstructionDoc(d: DossierInstruction): GlobalSearchDoc {
  const fields: DocField[] = [];
  const acc: Array<DocField | null> = fields as Array<DocField | null>;

  push(acc, makeField(d.numeroInstruction, 3, { fuzzy: true, ops: ['no', 'num', 'numero'] }));
  push(acc, makeField(
    [squashAlnum(d.numeroInstruction), squashAlnum(d.numeroParquet || ''), squashAlnum(d.enquetePreliminaireNumero || '')]
      .filter(Boolean).join(' '),
    2.6,
    { ops: ['no', 'num', 'numero'] }
  ));
  push(acc, makeField(
    (d.misEnExamen || []).map(m => m.nom).join(' · '),
    2.4,
    { label: 'Mis en examen', fuzzy: true, ops: ['mex', 'mec', 'nom', 'personne'] }
  ));
  // Suspects et victimes sont saisis dans le module instruction et projetés sur
  // la cartographie : ils doivent être trouvables comme les mis en examen.
  push(acc, makeField(
    (d.suspects || []).map(s => s.nom).filter(Boolean).join(' · '),
    2.2,
    { label: 'Suspect', fuzzy: true, ops: ['suspect', 'nom', 'personne'] }
  ));
  push(acc, makeField(
    (d.victimes || []).map(v => v.nom).filter(Boolean).join(' · '),
    2,
    { label: 'Victime', fuzzy: true, ops: ['victime', 'partiecivile', 'nom', 'personne'] }
  ));
  push(acc, makeField(d.magistratInstructeur, 2, { label: 'Magistrat instructeur', fuzzy: true, ops: ['magistrat', 'juge'] }));
  push(acc, makeField(d.serviceEnqueteur, 1.8, { label: 'Service', fuzzy: true, ops: ['service', 'sce'] }));
  push(acc, makeField((d.tags || []).map(t => t.value).join(' · '), 1.8, { label: 'Tag', fuzzy: true, ops: ['tag'] }));
  push(acc, makeField(d.description, 1.2, { label: 'Description', maxLength: 4000, ops: ['desc', 'description'] }));

  const deep: string[] = [];
  for (const s of d.saisine || []) deep.push((s as { qualification?: string }).qualification || '');
  for (const m of d.misEnExamen || []) {
    for (const inf of (m as { infractions?: Array<{ qualification?: string }> }).infractions || []) {
      deep.push(inf.qualification || '');
    }
  }
  push(acc, makeField(deep.filter(Boolean).join(' • '), 0.9, { label: 'Saisine', maxLength: 8000, ops: ['saisine', 'qualification', 'contenu'] }));

  return {
    key: `inst_${d.id}`,
    kind: 'instruction',
    title: d.numeroInstruction || d.numeroParquet,
    subtitle: d.description?.trim()
      || (d.misEnExamen || []).map(m => m.nom).filter(Boolean).join(', ')
      || d.magistratInstructeur
      || undefined,
    ctxId: d.contentieuxId,
    archived: d.archived === true,
    fields,
    data: { id: d.id, numero: d.numeroInstruction, numeroParquet: d.numeroParquet },
  };
}

// ── Mesures AIR ─────────────────────────────────

function buildAIRDoc(m: AIRMesure, idx: number): GlobalSearchDoc | null {
  if (!m.nomPrenom?.trim()) return null;
  const fields: DocField[] = [];
  const acc: Array<DocField | null> = fields as Array<DocField | null>;

  push(acc, makeField(m.nomPrenom, 3, { fuzzy: true, ops: ['nom', 'personne', 'mec'] }));
  push(acc, makeField(squashAlnum(m.refAEM || ''), 2.4, { ops: ['aem', 'ref', 'no', 'num'] }));
  push(acc, makeField(m.telephone, 1.6, { label: 'Téléphone', ops: ['tel', 'telephone', 'gsm', 'ligne'] }));
  push(acc, makeField(m.referent, 1.8, { label: 'Référent', fuzzy: true, ops: ['referent'] }));
  push(acc, makeField(m.secteurGeographique, 1.4, { label: 'Secteur', fuzzy: true, ops: ['secteur'] }));
  push(acc, makeField(m.faits, 1.1, { label: 'Faits', maxLength: 2000, ops: ['faits', 'desc', 'description'] }));
  push(acc, makeField(m.commentaires, 0.9, { label: 'Commentaires', maxLength: 2000, ops: ['contenu'] }));

  return {
    key: `air_${m.refAEM || idx}`,
    kind: 'air',
    title: m.nomPrenom,
    subtitle: [m.refAEM ? `AEM ${m.refAEM}` : '', m.faits?.trim() || ''].filter(Boolean).join(' · ') || undefined,
    archived: m.statut != null && m.statut !== 'en_cours',
    fields,
    data: { nomPrenom: m.nomPrenom },
  };
}

// ── Personnes (→ cartographie) ─────────────────

/**
 * Groupe « Personnes » : une ligne par personne du fichier applicatif (mis en
 * cause, mis en examen, suspects, victimes, fiches manuelles de la
 * cartographie), déjà dédupliquée par `useKnownPersons` — les variantes
 * d'orthographe d'une même personne ne produisent donc qu'un seul résultat.
 * L'exécution recentre la cartographie sur la personne.
 */
function buildPersonneDocs(knownPersons: KnownPerson[]): GlobalSearchDoc[] {
  const docs: GlobalSearchDoc[] = [];
  for (const person of knownPersons) {
    // Une personne sans nœud sur la carte (victime non cochée « sur la
    // cartographie ») n'a rien à ouvrir : elle reste trouvable via son dossier.
    if (!person.onCarto) continue;
    const nameField = makeField(person.nom, 3, { fuzzy: true, ops: ['nom', 'personne', 'mec', 'mex'] });
    if (!nameField) continue;
    const fields: DocField[] = [nameField];
    // Les autres orthographes rencontrées restent interrogeables : on trouve la
    // personne en tapant le nom tel qu'il figure dans SON dossier.
    const autresVariantes = person.variants.filter(v => v !== person.nom);
    push(
      fields as Array<DocField | null>,
      makeField(autresVariantes.join(' · '), 1.6, { label: 'Aussi saisi', fuzzy: true, ops: ['nom', 'personne'] }),
    );
    docs.push({
      key: `pers_${person.key}`,
      kind: 'personne',
      title: person.nom,
      subtitle: `${person.hint} · voir sur la cartographie`,
      fields,
      data: { nom: person.nom },
    });
  }
  return docs;
}

// ── Pages & actions ─────────────────────────────

function pageDoc(
  view: string,
  title: string,
  keywords: string,
  data: Record<string, unknown>,
  ctxId?: ContentieuxId
): GlobalSearchDoc {
  const fields: DocField[] = [];
  push(fields as Array<DocField | null>, makeField(title, 3, { fuzzy: true }));
  push(fields as Array<DocField | null>, makeField(keywords, 1.2, { fuzzy: true }));
  return { key: `page_${view}`, kind: 'page', title, ctxId, fields, data };
}

function actionDoc(
  key: string,
  title: string,
  keywords: string,
  data: Record<string, unknown>,
  ctxId?: ContentieuxId
): GlobalSearchDoc {
  const fields: DocField[] = [];
  push(fields as Array<DocField | null>, makeField(title, 3, { fuzzy: true }));
  push(fields as Array<DocField | null>, makeField(keywords, 1.2, { fuzzy: true }));
  return { key: `act_${key}`, kind: 'action', title, ctxId, fields, data };
}

function buildNavigationDocs(s: GlobalSearchSources): { pages: GlobalSearchDoc[]; actions: GlobalSearchDoc[]; quickLinks: GlobalSearchDoc[] } {
  const pages: GlobalSearchDoc[] = [];
  const quickLinks: GlobalSearchDoc[] = [];

  const dash = pageDoc('dashboard', 'Tableau de bord', 'accueil dashboard synthese jour', { view: 'dashboard' });
  pages.push(dash);
  quickLinks.push(dash);

  for (const ctx of s.contentieux) {
    const enq = pageDoc(`enquetes_${ctx.id}`, `Enquêtes — ${ctx.label}`, 'dossiers en cours liste preliminaires', { view: `enquetes_${ctx.id}`, ctxId: ctx.id }, ctx.id);
    pages.push(enq);
    quickLinks.push(enq);
    pages.push(pageDoc(`archives_${ctx.id}`, `Enquêtes terminées — ${ctx.label}`, 'archives archivees closes anciennes', { view: `archives_${ctx.id}`, ctxId: ctx.id }, ctx.id));
    if (s.statsContentieuxIds.includes(ctx.id)) {
      pages.push(pageDoc(`stats_${ctx.id}`, `Statistiques — ${ctx.label}`, 'stats chiffres graphiques bilan activite', { view: `stats_${ctx.id}`, ctxId: ctx.id }, ctx.id));
    }
  }

  if (s.modules.instructions) {
    const inst = pageDoc('instructions', 'Instructions judiciaires', 'juge instruction cabinets dossiers ouvertes', { view: 'instructions' });
    pages.push(inst);
    quickLinks.push(inst);
    pages.push(pageDoc('instructions_archives', 'Instructions terminées', 'archives instruction reglees closes', { view: 'instructions_archives' }));
  }
  if (s.modules.air) {
    const air = pageDoc('air', 'Suivi AIR', 'alternatives incarceration mesures suivis', { view: 'air' });
    pages.push(air);
    quickLinks.push(air);
  }
  if (s.modules.mindmap) {
    const mm = pageDoc('mindmap', 'Cartographie', 'mindmap carte reseau liens criminels graphe', { view: 'mindmap' });
    pages.push(mm);
    quickLinks.push(mm);
  }
  if (s.hasOverboard) {
    const ob = pageDoc('overboard', 'Overboard', 'vue transversale tous contentieux pilotage', { view: 'overboard' });
    pages.push(ob);
    quickLinks.push(ob);
    pages.push(pageDoc('global_stats', 'Statistiques globales', 'stats chiffres tous contentieux bilan', { view: 'global_stats' }));
  }
  if (s.showAssistant) {
    pages.push(pageDoc('assistant', 'Assistant de justice', 'attache ia journal absence propositions', { view: 'assistant' }));
  }

  const actions: GlobalSearchDoc[] = [];
  for (const ctxId of s.createContentieuxIds) {
    const def = s.contentieux.find(c => c.id === ctxId);
    if (!def) continue;
    actions.push(actionDoc(`new_enq_${ctxId}`, `Nouvelle enquête — ${def.label}`, 'creer ajouter ouvrir dossier', { action: 'new-enquete', ctxId }, ctxId));
  }
  if (s.modules.instructions) {
    actions.push(actionDoc('new_inst', 'Nouvelle instruction judiciaire', 'creer ajouter ouvrir dossier instruction', { action: 'new-instruction' }));
  }
  actions.push(actionDoc('settings', 'Ouvrir les paramètres', 'reglages configuration preferences options', { action: 'settings' }));

  return { pages, actions, quickLinks: quickLinks.slice(0, 7) };
}

// ── Hook ────────────────────────────────────────

export interface GlobalSearchApi {
  /** Interroge l'index ; groupes triés par pertinence, plafonnés à 20 hits. */
  search: (query: string) => GlobalHitGroup[];
  /** Pages principales proposées quand la requête est vide. */
  quickLinks: GlobalSearchDoc[];
  /** Taille de l'index (indicatif). */
  docCount: number;
}

export const useGlobalSearch = (sources: GlobalSearchSources): GlobalSearchApi => {
  const {
    enquetesByContentieux,
    instructions,
    mesuresAIR,
    contentieux,
    statsContentieuxIds,
    createContentieuxIds,
    modules,
    hasOverboard,
    showAssistant,
    knownPersons,
  } = sources;

  // Signatures stables pour ne pas reconstruire l'index à chaque rendu.
  const statsSig = statsContentieuxIds.join(',');
  const createSig = createContentieuxIds.join(',');

  const docs = useMemo<GlobalSearchDoc[]>(() => {
    const out: GlobalSearchDoc[] = [];

    // Enquêtes — contentieux accessibles uniquement.
    for (const ctx of contentieux) {
      const list = enquetesByContentieux.get(ctx.id);
      if (!Array.isArray(list)) continue;
      for (const e of list) out.push(buildEnqueteDoc(e, ctx.id));
    }

    if (modules.instructions) {
      for (const d of instructions) out.push(buildInstructionDoc(d));
    }

    if (modules.air) {
      mesuresAIR.forEach((m, i) => {
        const doc = buildAIRDoc(m, i);
        if (doc) out.push(doc);
      });
    }

    if (modules.mindmap && knownPersons) {
      out.push(...buildPersonneDocs(knownPersons));
    }

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enquetesByContentieux, instructions, mesuresAIR, contentieux, modules.instructions, modules.air, modules.mindmap, knownPersons]);

  const nav = useMemo(
    () => buildNavigationDocs({
      enquetesByContentieux,
      instructions,
      mesuresAIR,
      contentieux,
      statsContentieuxIds,
      createContentieuxIds,
      modules,
      hasOverboard,
      showAssistant,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contentieux, statsSig, createSig, modules.instructions, modules.air, modules.mindmap, hasOverboard, showAssistant]
  );

  const search = useMemo(() => {
    const all = [...docs, ...nav.pages, ...nav.actions];
    return (query: string): GlobalHitGroup[] => {
      const tokens = parseQuery(query);
      if (tokens.length === 0) return [];
      // Un seul caractère : trop bruyant pour un index global.
      if (tokens.length === 1 && tokens[0].t.length < 2) return [];
      return groupHits(searchDocs(all, tokens), 20);
    };
  }, [docs, nav]);

  // Objet stable : les mémos du composant (résultats par frappe) tiennent
  // tant que ni les données ni les droits ne changent.
  return useMemo(
    () => ({ search, quickLinks: nav.quickLinks, docCount: docs.length }),
    [search, nav.quickLinks, docs.length]
  );
};
