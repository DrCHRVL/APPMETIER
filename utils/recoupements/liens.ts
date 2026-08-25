// utils/recoupements/liens.ts
//
// CE QU'IL RESTE À TRACER — passerelle entre la veille de recoupements et la
// cartographie.
//
// La veille dit « ces deux dossiers parlent de la même adresse ». La carte,
// elle, sait déjà relier ce qui partage un mis en cause, et porte les liens de
// renseignement tracés à la main. Ce module fait la soustraction : il ne
// propose QUE ce qui manque, et il ne propose jamais deux fois la même chose.
//
// Règle d'or : un lien déjà présent — quel que soit son sens, quel que soit son
// libellé — vaut réponse. On ne le repropose pas, et le signal cesse d'être
// annoncé comme « inédit ».

import { normalizeMecName } from '@/utils/mindmapGraph';
import { LIBELLE_KIND, LIBELLE_ORIGINE, clePaire } from './engine';
import type {
  Recoupement,
  RecoupementDossierRef,
  RecoupementOccurrence,
} from '@/types/recoupementTypes';

/** Vue minimale d'un lien de renseignement existant (cf. le store overlay). */
export interface LienExistant {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/**
 * Identifiant du nœud « dossier » sur la cartographie.
 * Doit rester aligné sur buildMindmapGraph : `${contentieuxId}_${enqueteId}`,
 * les dossiers d'instruction étant projetés sous leur propre id.
 */
export function nodeIdDossier(ref: RecoupementDossierRef): string | null {
  if (!ref.contentieuxId) return null;
  const id = ref.nature === 'instruction' ? ref.instructionId : ref.enqueteId;
  return id == null ? null : `${ref.contentieuxId}_${id}`;
}

/** Identifiant du nœud « personne » sur la cartographie (nom canonique). */
export function nodeIdPersonne(nom: string): string {
  return normalizeMecName(nom);
}

/** Le lien qui joint déjà ces deux nœuds, dans un sens ou dans l'autre. */
export function trouverLien(
  liens: LienExistant[],
  a: string | null,
  b: string | null
): LienExistant | undefined {
  if (!a || !b) return undefined;
  return liens.find(l =>
    (l.source === a && l.target === b) || (l.source === b && l.target === a)
  );
}

// ──────────────────────────────────────────────
// RÉSUMÉ PAR DOSSIER
// ──────────────────────────────────────────────

/** Une provenance dans un dossier : « compte rendu · CR du 20/07/2026 ». */
export interface Provenance {
  libelle: string;
  /** Précision (nom de pièce, date de CR, numéro d'interception). */
  detail?: string;
}

/** Tout ce que la veille sait d'un dossier POUR CE SIGNAL, en une fois. */
export interface DossierResume {
  key: string;
  ref: RecoupementDossierRef;
  nodeId: string | null;
  /** La valeur est inscrite dans une fiche du dossier (mis en cause, ligne
   *  interceptée…) et non seulement citée au fil d'un texte. */
  declaree: boolean;
  /** Vrai pour un signal de personne dont le dossier ne fait que parler :
   *  elle n'est pas dans sa liste de mis en cause. */
  citeeSansEtreMiseEnCause: boolean;
  provenances: Provenance[];
  extraits: string[];
}

/**
 * Regroupe les occurrences PAR DOSSIER. Un même nom cité six fois dans un
 * dossier n'est pas six informations : c'est un dossier, et la liste des
 * endroits où il apparaît.
 */
export function grouperParDossier(signal: Recoupement): DossierResume[] {
  const parCle = new Map<string, RecoupementOccurrence[]>();
  for (const occ of signal.occurrences) {
    const arr = parCle.get(occ.dossier.key);
    if (arr) arr.push(occ);
    else parCle.set(occ.dossier.key, [occ]);
  }

  const resumes: DossierResume[] = [];
  // On garde l'ordre des dossiers du signal : stable d'un rendu à l'autre.
  for (const key of signal.dossierKeys) {
    const occurrences = parCle.get(key);
    if (!occurrences || occurrences.length === 0) continue;
    const ref = occurrences[0].dossier;

    const provenances: Provenance[] = [];
    const vues = new Set<string>();
    const extraits: string[] = [];
    let declaree = false;
    let fiche = false;

    for (const occ of occurrences) {
      if (occ.declaree) declaree = true;
      if (occ.declaree && occ.origine === 'mec') fiche = true;
      const libelle = LIBELLE_ORIGINE[occ.origine];
      const cle = `${libelle}|${occ.detail || ''}`;
      if (!vues.has(cle)) {
        vues.add(cle);
        provenances.push({ libelle, detail: occ.detail });
      }
      if (occ.extrait && !extraits.includes(occ.extrait)) extraits.push(occ.extrait);
    }

    resumes.push({
      key,
      ref,
      nodeId: nodeIdDossier(ref),
      declaree,
      citeeSansEtreMiseEnCause:
        (signal.kind === 'personne' || signal.kind === 'patronyme') && !fiche,
      provenances,
      extraits,
    });
  }
  return resumes;
}

/** Nom sous lequel la personne est DÉCLARÉE dans un dossier donné, s'il y en a. */
function nomDeclare(signal: Recoupement, dossierKey: string): string | undefined {
  return signal.occurrences
    .find(o => o.dossier.key === dossierKey && o.declaree && o.origine === 'mec')
    ?.valeurBrute;
}

// ──────────────────────────────────────────────
// PROPOSITIONS DE LIEN
// ──────────────────────────────────────────────

export type NatureProposition = 'personne-dossier' | 'personne-personne' | 'dossier-dossier';

/** Un lien de renseignement qui n'existe pas encore et que la veille propose. */
export interface PropositionLien {
  /** Identité stable de la proposition (idempotence côté bouton). */
  cle: string;
  nature: NatureProposition;
  source: string;
  target: string;
  label: string;
  notes: string;
  /** Texte du bouton. */
  libelle: string;
  /** Infobulle : ce qui sera écrit, en clair. */
  titre: string;
  /** Dossier sur la ligne duquel poser le bouton (personne ↔ dossier). */
  dossierKey?: string;
  /** Libellé de repli quand plusieurs liens du même type sont proposés : il
   *  dit lequel des deux couples on relie. */
  distinction?: string;
}

/** « 2026/3472 - Saint Maurice » → « 2026/3472 » : de quoi tenir dans un bouton. */
function court(texte: string): string {
  const base = texte.split(' - ')[0].trim() || texte.trim();
  return base.length > 22 ? `${base.slice(0, 21)}…` : base;
}

export interface AnalyseSignal {
  parDossier: DossierResume[];
  /**
   * Reste-t-il quelque chose que la carte ne montre pas ? Faux dès que tous
   * les dossiers du signal sont déjà reliés — par un mis en cause commun ou
   * par un lien de renseignement déjà tracé.
   */
  inedit: boolean;
  /** Liens manquants, prêts à être créés. Vide = tout est déjà tracé. */
  propositions: PropositionLien[];
  /** Liens déjà en place que ce signal recoupe (on ne les repropose pas). */
  liensExistants: LienExistant[];
}

/** Union-find minimal — sert à savoir si deux nœuds se touchent déjà. */
function creerUnion() {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) { parent.set(x, x); return x; }
    let racine = x;
    while (parent.get(racine) !== racine) racine = parent.get(racine)!;
    // Compression du chemin : les signaux se relisent à chaque rendu.
    let courant = x;
    while (parent.get(courant) !== racine) {
      const suivant = parent.get(courant)!;
      parent.set(courant, racine);
      courant = suivant;
    }
    return racine;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { find, union, relies: (a: string, b: string) => find(a) === find(b) };
}

const NOTE_SOURCE = 'Relevé par la veille de recoupements de SIRAL — à vérifier.';

/**
 * Ce qu'il reste à tracer pour ce signal, une fois retranché tout ce que la
 * cartographie montre déjà.
 *
 * @param liens liens de renseignement existants (surcouche de cartographie)
 */
export function analyserSignal(signal: Recoupement, liens: LienExistant[]): AnalyseSignal {
  const parDossier = grouperParDossier(signal);
  const resumeParCle = new Map(parDossier.map(d => [d.key, d]));

  // Graphe local : dossiers du signal + personne(s) en cause. On y verse ce que
  // la carte relie déjà, puis on regarde ce qui reste séparé.
  const { union, relies } = creerUnion();
  const paireInedite = new Set(signal.pairesInedites.map(([a, b]) => clePaire(a, b)));
  for (let i = 0; i < signal.dossierKeys.length; i++) {
    for (let j = i + 1; j < signal.dossierKeys.length; j++) {
      const a = signal.dossierKeys[i], b = signal.dossierKeys[j];
      if (!paireInedite.has(clePaire(a, b))) union(a, b);
    }
  }

  const liensExistants: LienExistant[] = [];
  const propositions: PropositionLien[] = [];

  // Personne du signal, telle qu'elle est déclarée quelque part : c'est ce nom
  // qui porte le nœud de la cartographie.
  const personneNom = signal.occurrences.find(o => o.declaree && o.origine === 'mec')?.valeurBrute
    || signal.valeur;
  const personneId = nodeIdPersonne(personneNom);

  // ── Personne citée dans un dossier sans y être mise en cause ────────────
  if (signal.kind === 'personne') {
    for (const d of parDossier) {
      if (!d.citeeSansEtreMiseEnCause) continue;
      const existant = trouverLien(liens, personneId, d.nodeId);
      if (existant) {
        liensExistants.push(existant);
        if (d.nodeId) union(d.key, `mec:${personneId}`);
        continue;
      }
      if (!d.nodeId) continue; // dossier absent de la carte : rien à relier
      propositions.push({
        cle: `${signal.id}::mec-dossier::${d.key}`,
        nature: 'personne-dossier',
        source: personneId,
        target: d.nodeId,
        label: 'Cité dans la procédure',
        notes: `${personneNom} apparaît dans ${d.ref.numero} (${d.provenances.map(p => p.libelle).join(', ')}) sans y figurer parmi les mis en cause. ${NOTE_SOURCE}`,
        libelle: 'Lier au dossier',
        titre: `Créer un lien de renseignement « Cité dans la procédure » entre ${personneNom} et ${d.ref.numero}`,
        dossierKey: d.key,
      });
    }
    // Une personne déclarée quelque part relie de fait tous ces dossiers-là ;
    // les liens qu'on vient de compter les rapprochent aussi.
    for (const d of parDossier) {
      if (d.declaree) union(d.key, `mec:${personneId}`);
    }
  }

  // ── Même patronyme : lien de famille à confirmer ────────────────────────
  if (signal.kind === 'patronyme') {
    const personnes: Array<{ id: string; nom: string; dossierKey: string }> = [];
    for (const d of parDossier) {
      const nom = nomDeclare(signal, d.key);
      if (!nom) continue;
      const id = nodeIdPersonne(nom);
      if (personnes.some(p => p.id === id)) continue;
      personnes.push({ id, nom, dossierKey: d.key });
    }
    for (let i = 0; i < personnes.length; i++) {
      for (let j = i + 1; j < personnes.length; j++) {
        const a = personnes[i], b = personnes[j];
        const existant = trouverLien(liens, a.id, b.id);
        if (existant) {
          liensExistants.push(existant);
          union(a.dossierKey, b.dossierKey);
          continue;
        }
        if (propositions.length >= 4) break;
        propositions.push({
          cle: `${signal.id}::famille::${a.id}::${b.id}`,
          nature: 'personne-personne',
          source: a.id,
          target: b.id,
          label: `Famille ? — ${signal.valeur}`,
          notes: `${a.nom} (${resumeParCle.get(a.dossierKey)?.ref.numero || ''}) et ${b.nom} (${resumeParCle.get(b.dossierKey)?.ref.numero || ''}) portent le même patronyme. ${NOTE_SOURCE}`,
          libelle: 'Lien de famille ?',
          distinction: `Famille ? ${court(a.nom)} ↔ ${court(b.nom)}`,
          titre: `Créer un lien de renseignement « Famille ? » entre ${a.nom} et ${b.nom}`,
        });
      }
    }
  }

  // ── Même adresse, même ligne, même véhicule… : lien entre dossiers ──────
  if (signal.kind !== 'personne' && signal.kind !== 'patronyme') {
    for (const [a, b] of signal.pairesInedites) {
      const da = resumeParCle.get(a), db = resumeParCle.get(b);
      if (!da || !db) continue;
      const existant = trouverLien(liens, da.nodeId, db.nodeId);
      if (existant) {
        liensExistants.push(existant);
        union(a, b);
        continue;
      }
      if (!da.nodeId || !db.nodeId) continue;
      if (propositions.length >= 8) break;
      propositions.push({
        cle: `${signal.id}::dossiers::${clePaire(a, b)}`,
        nature: 'dossier-dossier',
        source: da.nodeId,
        target: db.nodeId,
        label: `${LIBELLE_KIND[signal.kind]} — ${signal.valeur}`,
        notes: `${LIBELLE_KIND[signal.kind].toLowerCase()} « ${signal.valeur} » relevée dans ${da.ref.numero} et ${db.ref.numero}. ${NOTE_SOURCE}`,
        libelle: 'Créer le lien',
        distinction: `Lier ${court(da.ref.numero)} ↔ ${court(db.ref.numero)}`,
        titre: `Créer un lien de renseignement « ${LIBELLE_KIND[signal.kind]} — ${signal.valeur} » entre ${da.ref.numero} et ${db.ref.numero}`,
      });
    }
  }

  // Plusieurs liens à tracer d'un même type : le bouton doit dire LEQUEL.
  // Un seul : « Créer le lien » suffit, la valeur est juste au-dessus.
  for (const nature of ['dossier-dossier', 'personne-personne'] as NatureProposition[]) {
    const lot = propositions.filter(p => p.nature === nature);
    if (lot.length < 2) continue;
    for (const p of lot) p.libelle = p.distinction || p.libelle;
  }

  // Inédit = il reste au moins deux dossiers que rien ne relie encore.
  let inedit = false;
  for (let i = 0; i < signal.dossierKeys.length && !inedit; i++) {
    for (let j = i + 1; j < signal.dossierKeys.length && !inedit; j++) {
      if (!relies(signal.dossierKeys[i], signal.dossierKeys[j])) inedit = true;
    }
  }

  return { parDossier, inedit, propositions, liensExistants };
}
