// utils/recoupements/engine.ts
//
// MOTEUR DE LA VEILLE DE RECOUPEMENTS.
//
// Entrée : le corpus de chaque dossier (personnes déclarées + textes).
// Sortie : les valeurs présentes dans PLUSIEURS dossiers, ordonnées par
// confiance, avec l'endroit exact où chacune a été vue.
//
// Deux garde-fous font toute la précision du dispositif :
//
//  1. UN SIGNAL DE PERSONNE EXIGE UN ANCRAGE DÉCLARÉ. Un nom lu dans une pièce
//     ne compte que s'il rejoint une personne inscrite aux mis en cause / mis
//     en examen d'un dossier. Sans cette règle, deux PV signés du même OPJ ou
//     visant le même substitut se « recouperaient » à longueur de journée.
//  2. UN PATRONYME TROP RÉPANDU NE DIT RIEN. Au-delà de quelques dossiers, un
//     nom de famille commun cesse d'être un indice : le signal est abandonné.
//
// Le moteur ne décide rien : il ne fait que montrer. C'est le magistrat qui
// juge si la coïncidence en est une.

import { mecSortedKey, normalizeMecName, sameMecPerson } from '@/utils/mindmapGraph';
import { extractNames, extractValues, extrait, motsDe, normalizeAligned, normalizeLoose } from './extract';
import type {
  DossierCorpus,
  Recoupement,
  RecoupementDossierRef,
  RecoupementKind,
  RecoupementOccurrence,
  RecoupementOrigine,
} from '@/types/recoupementTypes';

export interface RecoupementOptions {
  /** Nombre maximum de signaux rendus (les mieux notés d'abord). */
  maxSignals?: number;
  /** Confiance minimale d'un signal rendu. */
  minScore?: number;
  /** Occurrences conservées par signal (une par dossier au minimum). */
  maxOccurrences?: number;
  /** Occurrences conservées PAR DOSSIER (l'affichage les regroupe par dossier :
   *  ce qui compte est la diversité des provenances, pas la répétition). */
  maxOccurrencesParDossier?: number;
  /** Au-delà de ce nombre de dossiers, un patronyme est jugé trop répandu. */
  maxDossiersPatronyme?: number;
  /** Longueur maximale d'un fragment analysé (garde-fou de performance). */
  maxCharsFragment?: number;
  /**
   * Rend la main au navigateur pendant la lecture du corpus. Sans elle, un
   * fonds de plusieurs mégaoctets bloquerait l'interface le temps du calcul —
   * exactement ce que la veille ne doit jamais faire.
   */
  respirer?: () => Promise<void>;
  /** Interrompt le calcul en cours (les données ont changé, on recommencera). */
  annule?: () => boolean;
}

/** Réglages effectifs (les crochets `respirer`/`annule` n'en font pas partie). */
type Reglages = Required<Omit<RecoupementOptions, 'respirer' | 'annule'>>;

const DEFAUTS: Reglages = {
  maxSignals: 200,
  minScore: 0.4,
  maxOccurrences: 40,
  maxOccurrencesParDossier: 6,
  maxDossiersPatronyme: 5,
  maxCharsFragment: 300_000,
};

/** Confiance de base par nature de valeur. */
const SCORE_BASE: Record<RecoupementKind, number> = {
  telephone: 0.95,
  iban: 0.95,
  imei: 0.95,
  plaque: 0.9,
  personne: 0.85,
  compte: 0.8,
  adresse: 0.7,
  patronyme: 0.45,
};

export const LIBELLE_KIND: Record<RecoupementKind, string> = {
  personne: 'Même personne',
  patronyme: 'Même patronyme',
  telephone: 'Même ligne',
  adresse: 'Même adresse',
  plaque: 'Même véhicule',
  compte: 'Même compte',
  iban: 'Même compte bancaire',
  imei: 'Même appareil',
};

export const LIBELLE_ORIGINE: Record<RecoupementOrigine, string> = {
  mec: 'mis en cause',
  ecoute: 'interception',
  geolocalisation: 'géolocalisation',
  acte: 'acte',
  description: 'description',
  notes: 'notes',
  cr: 'compte rendu',
  document: 'pièce',
};

// ──────────────────────────────────────────────
// MENTIONS DE PERSONNES
// ──────────────────────────────────────────────

interface Mention {
  nom: string;
  patronyme: string;
  dossierKey: string;
  origine: RecoupementOrigine;
  detail?: string;
  declaree: boolean;
  extrait?: string;
}

/**
 * Patronyme d'un nom saisi. Convention des fiches et des PV : le nom de
 * famille est en capitales (« MOKRANI Mickael »). À défaut de capitales, on
 * retient le premier mot — c'est l'ordre de saisie majoritaire.
 */
export function patronymeDe(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return '';
  const capitales = mots.filter(m => m.length >= 3 && m === m.toUpperCase() && /[A-ZÀ-ÖØ-Þ]/.test(m));
  const retenu = capitales.length > 0 ? capitales[0] : mots[0];
  return normalizeLoose(retenu);
}

/** Mots d'au moins 3 lettres — sert à borner les comparaisons approximatives. */
function tokens(nom: string): string[] {
  return normalizeMecName(nom).split(' ').filter(t => t.length >= 3);
}

interface GroupePersonne {
  mentions: Mention[];
  cles: Set<string>;
}

/** Un fragment prêt à être re-fouillé (texte + mots indexés). */
interface FragmentPrepare {
  dossierKey: string;
  origine: RecoupementOrigine;
  detail?: string;
  texte: string;
  mots: Set<string>;
}

/**
 * Position d'un nom dans un texte normalisé aligné, quel que soit l'ordre des
 * mots et la ponctuation qui les sépare (« ROUSSEAU, Jean-Pierre », « jean
 * pierre rousseau »). -1 si absent.
 */
function chercherNom(norm: string, mots: string[]): number {
  const sep = String.raw`[^a-z0-9]{1,4}`;
  // « MOKRANI Mickael » / « Mickael MOKRANI », mais aussi « ROUSSEAU Jean
  // Pierre » / « Jean Pierre ROUSSEAU » : on essaie les conventions d'écriture
  // du patronyme, pas toutes les permutations.
  const ordres = [
    mots,
    [...mots.slice(1), mots[0]],
    [mots[mots.length - 1], ...mots.slice(0, -1)],
    mots.slice().reverse(),
  ];
  const vus = new Set<string>();
  for (const ordre of ordres) {
    const cle = ordre.join(' ');
    if (vus.has(cle)) continue;
    vus.add(cle);
    const m = new RegExp(`\\b${ordre.join(sep)}\\b`).exec(norm);
    if (m) return m.index;
  }
  return -1;
}

/**
 * Regroupe les mentions en personnes distinctes : d'abord la clé « mots triés »
 * (ordre Nom/Prénom indifférent), puis fusion approximative des groupes
 * partageant un mot (coquille, composé recollé) — mêmes règles que la
 * cartographie, donc mêmes fusions.
 */
function grouperPersonnes(mentions: Mention[]): GroupePersonne[] {
  const parCle = new Map<string, Mention[]>();
  for (const m of mentions) {
    const cle = mecSortedKey(m.nom);
    if (!cle) continue;
    const arr = parCle.get(cle);
    if (arr) arr.push(m);
    else parCle.set(cle, [m]);
  }

  const cles = Array.from(parCle.keys());
  const parent = cles.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Représentant lisible de chaque clé : la variante la plus complète.
  const repr = cles.map(cle => {
    const noms = (parCle.get(cle) || []).map(m => m.nom);
    return noms.reduce((a, b) => (b.length > a.length ? b : a), noms[0] || '');
  });

  const parToken = new Map<string, number[]>();
  repr.forEach((nom, i) => {
    for (const t of tokens(nom)) {
      const arr = parToken.get(t);
      if (arr) arr.push(i);
      else parToken.set(t, [i]);
    }
  });

  const compares = new Set<string>();
  repr.forEach((nom, i) => {
    for (const t of tokens(nom)) {
      const candidats = parToken.get(t) || [];
      if (candidats.length > 200) continue; // mot trop fréquent : on ne dégénère pas
      for (const j of candidats) {
        if (j <= i) continue;
        const paire = `${i}:${j}`;
        if (compares.has(paire)) continue;
        compares.add(paire);
        if (find(i) === find(j)) continue;
        if (sameMecPerson(nom, repr[j])) union(i, j);
      }
    }
  });

  const groupes = new Map<number, GroupePersonne>();
  cles.forEach((cle, i) => {
    const racine = find(i);
    let g = groupes.get(racine);
    if (!g) { g = { mentions: [], cles: new Set() }; groupes.set(racine, g); }
    g.cles.add(cle);
    g.mentions.push(...(parCle.get(cle) || []));
  });

  return Array.from(groupes.values());
}

/** Variante affichée d'un groupe : la plus complète, l'alphabet départageant. */
function nomAffiche(mentions: Mention[]): string {
  const declarees = mentions.filter(m => m.declaree).map(m => m.nom);
  const source = declarees.length > 0 ? declarees : mentions.map(m => m.nom);
  return source.slice().sort((a, b) => b.length - a.length || a.localeCompare(b, 'fr'))[0] || '';
}

// ──────────────────────────────────────────────
// MOTEUR
// ──────────────────────────────────────────────

interface ValeurIndex {
  kind: RecoupementKind;
  canon: string;
  valeur: string;
  parDossier: Map<string, RecoupementOccurrence[]>;
}

function refDe(d: DossierCorpus): RecoupementDossierRef {
  return {
    key: d.key,
    numero: d.numero,
    label: d.label,
    nature: d.nature,
    contentieuxId: d.contentieuxId,
    enqueteId: d.enqueteId,
    instructionId: d.instructionId,
  };
}

/**
 * Conserve au plus `max` occurrences, en garantissant au moins une par dossier
 * et en privilégiant les occurrences déclarées (une fiche vaut mieux qu'une
 * mention au fil d'une pièce).
 *
 * Ce qui compte à l'écran, c'est la DIVERSITÉ DES PROVENANCES d'un même
 * dossier — « mis en cause + description + interception + pièce X » — et non
 * la répétition d'une mention dix fois dans le même compte rendu. On ne garde
 * donc qu'une occurrence par provenance (origine + détail) et par dossier.
 */
function choisirOccurrences(
  parDossier: Map<string, RecoupementOccurrence[]>,
  max: number,
  maxParDossier: number
): RecoupementOccurrence[] {
  const meilleures: RecoupementOccurrence[] = [];
  const reste: RecoupementOccurrence[] = [];
  parDossier.forEach(list => {
    const triees = list.slice().sort((a, b) => Number(b.declaree) - Number(a.declaree));
    const vues = new Set<string>();
    const retenues: RecoupementOccurrence[] = [];
    for (const occ of triees) {
      const provenance = `${occ.origine}|${occ.detail || ''}`;
      if (vues.has(provenance)) continue;
      vues.add(provenance);
      retenues.push(occ);
      if (retenues.length >= maxParDossier) break;
    }
    meilleures.push(retenues[0]);
    reste.push(...retenues.slice(1));
  });
  reste.sort((a, b) => Number(b.declaree) - Number(a.declaree));
  return meilleures.concat(reste).slice(0, Math.max(max, meilleures.length));
}

/** Clé d'une paire de dossiers, indépendante de l'ordre. */
export function clePaire(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Signaux de recoupement d'un corpus de dossiers.
 *
 * Asynchrone par construction : la lecture du corpus rend régulièrement la
 * main (cf. `respirer`) pour ne jamais figer la saisie en cours. Renvoie
 * `null` si le calcul a été interrompu (`annule`).
 */
export async function detecterRecoupements(
  corpus: DossierCorpus[],
  options: RecoupementOptions = {}
): Promise<Recoupement[] | null> {
  const opts = { ...DEFAUTS, ...options };
  if (corpus.length < 2) return [];

  // Une respiration toutes les 25 ms : en dessous, l'interface reste fluide.
  const TRANCHE_MS = 25;
  let dernierRepos = Date.now();
  /** Rend la main si la tranche est épuisée. Renvoie false si on doit s'arrêter. */
  const souffler = async (): Promise<boolean> => {
    if (options.annule?.()) return false;
    if (!options.respirer || Date.now() - dernierRepos < TRANCHE_MS) return true;
    await options.respirer();
    dernierRepos = Date.now();
    return !options.annule?.();
  };

  const refs = new Map<string, RecoupementDossierRef>();
  const personnesDeclarees = new Map<string, Set<string>>(); // dossier → clés MEC
  const index = new Map<string, ValeurIndex>();
  const mentions: Mention[] = [];
  const fragments: FragmentPrepare[] = [];

  const ajouterValeur = (
    kind: RecoupementKind,
    canon: string,
    valeur: string,
    dossierKey: string,
    occ: RecoupementOccurrence
  ) => {
    const cle = `${kind}:${canon}`;
    let entree = index.get(cle);
    if (!entree) {
      entree = { kind, canon, valeur, parDossier: new Map() };
      index.set(cle, entree);
    }
    const list = entree.parDossier.get(dossierKey);
    if (list) { if (list.length < 12) list.push(occ); }
    else entree.parDossier.set(dossierKey, [occ]);
  };

  for (const dossier of corpus) {
    refs.set(dossier.key, refDe(dossier));
    const cles = new Set<string>();

    for (const nom of dossier.personnes) {
      const propre = (nom || '').trim();
      if (propre.length < 2) continue;
      const cle = mecSortedKey(propre);
      if (cle) cles.add(cle);
      mentions.push({
        nom: propre,
        patronyme: patronymeDe(propre),
        dossierKey: dossier.key,
        origine: 'mec',
        declaree: true,
      });
    }
    personnesDeclarees.set(dossier.key, cles);

    for (const fragment of dossier.fragments) {
      if (!await souffler()) return null;
      const texte = (fragment.texte || '').slice(0, opts.maxCharsFragment);
      if (texte.trim().length < 3) continue;

      const structure = fragment.origine === 'ecoute'
        || fragment.origine === 'geolocalisation'
        || fragment.origine === 'mec';

      fragments.push({
        dossierKey: dossier.key,
        origine: fragment.origine,
        detail: fragment.detail,
        texte,
        mots: motsDe(normalizeAligned(texte)),
      });

      for (const v of extractValues(texte)) {
        ajouterValeur(v.kind, v.canon, v.valeur, dossier.key, {
          dossier: refs.get(dossier.key)!,
          origine: fragment.origine,
          detail: fragment.detail,
          valeurBrute: v.brut,
          extrait: structure ? undefined : extrait(texte, v.index),
          declaree: structure,
        });
      }

      for (const n of extractNames(texte)) {
        mentions.push({
          nom: n.brut,
          patronyme: n.patronyme,
          dossierKey: dossier.key,
          origine: fragment.origine,
          detail: fragment.detail,
          declaree: false,
          extrait: extrait(texte, n.index),
        });
      }
    }
  }

  // Une personne déclarée quelque part peut être citée EN MINUSCULES ailleurs
  // (tableaux d'annuaire, listes de correspondants) : la détection typographique
  // la manque. On cherche donc chaque personne déclarée, mot à mot, dans les
  // textes des AUTRES dossiers.
  const declareesUniques = new Map<string, string>(); // clé triée → nom affiché
  for (const m of mentions) {
    if (!m.declaree) continue;
    const cle = mecSortedKey(m.nom);
    if (cle && !declareesUniques.has(cle)) declareesUniques.set(cle, m.nom);
  }
  const recherches = Array.from(declareesUniques.entries())
    .map(([cle, nom]) => ({ cle, nom, mots: tokens(nom) }))
    .filter(r => r.mots.length >= 2);

  for (const fragment of fragments) {
    if (!await souffler()) return null;
    const clesDuDossier = personnesDeclarees.get(fragment.dossierKey) || new Set<string>();
    let norm: string | null = null;
    for (const rech of recherches) {
      if (clesDuDossier.has(rech.cle)) continue; // déjà déclarée ici : rien à révéler
      // Prétri par mots présents : évite de balayer la pièce entière pour
      // chacune des personnes du fichier.
      if (!rech.mots.every(mot => fragment.mots.has(mot))) continue;
      if (norm === null) norm = normalizeAligned(fragment.texte);
      const pos = chercherNom(norm, rech.mots);
      if (pos < 0) continue;
      mentions.push({
        nom: rech.nom,
        patronyme: patronymeDe(rech.nom),
        dossierKey: fragment.dossierKey,
        origine: fragment.origine,
        detail: fragment.detail,
        declaree: false,
        extrait: extrait(fragment.texte, pos),
      });
    }
  }

  // ── Personnes ──────────────────────────────────────────────────────────
  const groupes = grouperPersonnes(mentions);
  const signaux: Recoupement[] = [];
  const paireCouverteParPersonne = new Set<string>(); // `${patronyme}|${dossierA}|${dossierB}`

  // Pré-passe : les paires de dossiers que la CARTOGRAPHIE relie déjà, parce
  // qu'une même personne y est déclarée des deux côtés (mis en cause, mis en
  // examen, suspect, victime). Les groupes viennent d'être formés avec les
  // tolérances de la carte : deux graphies d'un même nom comptent pour une.
  const pairesDejaReliees = new Set<string>();
  for (const groupe of groupes) {
    const dossiers = Array.from(new Set(
      groupe.mentions.filter(m => m.declaree).map(m => m.dossierKey)
    ));
    for (let i = 0; i < dossiers.length; i++) {
      for (let j = i + 1; j < dossiers.length; j++) {
        pairesDejaReliees.add(clePaire(dossiers[i], dossiers[j]));
      }
    }
  }

  for (const groupe of groupes) {
    const parDossier = new Map<string, RecoupementOccurrence[]>();
    let ancree = false;
    let dossiersDeclares = 0;

    const parDossierMentions = new Map<string, Mention[]>();
    for (const m of groupe.mentions) {
      const arr = parDossierMentions.get(m.dossierKey);
      if (arr) arr.push(m);
      else parDossierMentions.set(m.dossierKey, [m]);
    }
    if (parDossierMentions.size < 2) continue;

    parDossierMentions.forEach((list, dossierKey) => {
      const declaree = list.some(m => m.declaree);
      if (declaree) { ancree = true; dossiersDeclares++; }
      parDossier.set(dossierKey, list.map(m => ({
        dossier: refs.get(dossierKey)!,
        origine: m.origine,
        detail: m.detail,
        valeurBrute: m.nom,
        extrait: m.extrait,
        declaree: m.declaree,
      })));
    });

    if (!ancree) continue; // aucune personne déclarée : simple homonymie de pièces

    const nom = nomAffiche(groupe.mentions);
    const canon = mecSortedKey(nom);
    const dossierKeys = Array.from(parDossier.keys()).sort();
    const patronyme = patronymeDe(nom);
    for (let i = 0; i < dossierKeys.length; i++) {
      for (let j = i + 1; j < dossierKeys.length; j++) {
        paireCouverteParPersonne.add(`${patronyme}|${dossierKeys[i]}|${dossierKeys[j]}`);
      }
    }

    signaux.push(construire('personne', canon, nom, parDossier, dossierKeys, pairesDejaReliees, opts, {
      bonus: dossiersDeclares >= 2 ? 0.05 : -0.1,
    }));
  }

  // ── Patronymes (lien familial possible) ────────────────────────────────
  const parPatronyme = new Map<string, Mention[]>();
  for (const m of mentions) {
    if (!m.patronyme || m.patronyme.length < 4) continue;
    const arr = parPatronyme.get(m.patronyme);
    if (arr) arr.push(m);
    else parPatronyme.set(m.patronyme, [m]);
  }

  parPatronyme.forEach((list, patronyme) => {
    const parDossierMentions = new Map<string, Mention[]>();
    for (const m of list) {
      const arr = parDossierMentions.get(m.dossierKey);
      if (arr) arr.push(m);
      else parDossierMentions.set(m.dossierKey, [m]);
    }
    if (parDossierMentions.size < 2) return;
    // Patronyme trop répandu : il n'indique plus rien.
    if (parDossierMentions.size > opts.maxDossiersPatronyme) return;
    if (!list.some(m => m.declaree)) return;

    const dossierKeys = Array.from(parDossierMentions.keys()).sort();
    // Si toutes les paires sont déjà expliquées par un signal « même personne »,
    // le patronyme ne dit rien de plus.
    let inedit = false;
    for (let i = 0; i < dossierKeys.length && !inedit; i++) {
      for (let j = i + 1; j < dossierKeys.length && !inedit; j++) {
        if (!paireCouverteParPersonne.has(`${patronyme}|${dossierKeys[i]}|${dossierKeys[j]}`)) inedit = true;
      }
    }
    if (!inedit) return;

    const parDossier = new Map<string, RecoupementOccurrence[]>();
    parDossierMentions.forEach((mens, dossierKey) => {
      parDossier.set(dossierKey, mens.map(m => ({
        dossier: refs.get(dossierKey)!,
        origine: m.origine,
        detail: m.detail,
        valeurBrute: m.nom,
        extrait: m.extrait,
        declaree: m.declaree,
      })));
    });

    const affiche = list.find(m => m.declaree)?.nom || list[0].nom;
    const patronymeAffiche = affiche.trim().split(/\s+/).find(mot => normalizeLoose(mot) === patronyme) || patronyme.toUpperCase();

    signaux.push(construire('patronyme', patronyme, patronymeAffiche, parDossier, dossierKeys, pairesDejaReliees, opts, {}));
  });

  // ── Valeurs (téléphones, adresses, plaques, comptes…) ──────────────────
  index.forEach(entree => {
    if (entree.parDossier.size < 2) return;
    const dossierKeys = Array.from(entree.parDossier.keys()).sort();
    signaux.push(construire(entree.kind, entree.canon, entree.valeur, entree.parDossier, dossierKeys, pairesDejaReliees, opts, {}));
  });

  return signaux
    .filter(s => s.score >= opts.minScore)
    .sort((a, b) =>
      b.score - a.score
      || b.dossierKeys.length - a.dossierKeys.length
      || a.valeur.localeCompare(b.valeur, 'fr')
    )
    .slice(0, opts.maxSignals);
}

/** Au-delà, on ne détaille plus les paires : le signal est de toute façon lu
 *  comme « ces dossiers-là se touchent », pas paire par paire. */
const MAX_PAIRES = 60;

function construire(
  kind: RecoupementKind,
  canon: string,
  valeur: string,
  parDossier: Map<string, RecoupementOccurrence[]>,
  dossierKeys: string[],
  pairesDejaReliees: Set<string>,
  opts: Reglages,
  extra: { bonus?: number }
): Recoupement {
  // Paire inédite : rien ne relie encore ces deux dossiers sur la carte —
  // aucune personne n'y est DÉCLARÉE des deux côtés. Une paire déjà reliée ne
  // fait que confirmer un trait qu'on voit déjà : elle ne mérite ni la mention
  // « inédit », ni une proposition de lien.
  //
  // On se cale exactement sur la règle de fusion de la cartographie (mêmes
  // groupes de personnes, mêmes tolérances d'orthographe et d'ordre des mots) :
  // sans quoi la veille annoncerait comme inédit un lien déjà tracé.
  const pairesInedites: Array<[string, string]> = [];
  for (let i = 0; i < dossierKeys.length; i++) {
    for (let j = i + 1; j < dossierKeys.length; j++) {
      if (pairesInedites.length >= MAX_PAIRES) break;
      if (pairesDejaReliees.has(clePaire(dossierKeys[i], dossierKeys[j]))) continue;
      pairesInedites.push([dossierKeys[i], dossierKeys[j]]);
    }
  }
  const pontInedit = pairesInedites.length > 0;

  const score = Math.max(
    0,
    Math.min(1, SCORE_BASE[kind] + (extra.bonus || 0) + (pontInedit ? 0.05 : -0.05))
  );

  return {
    id: `${kind}:${canon}`,
    kind,
    valeur,
    canon,
    score: Math.round(score * 100) / 100,
    stateKey: dossierKeys.join('|'),
    dossierKeys,
    occurrences: choisirOccurrences(parDossier, opts.maxOccurrences, opts.maxOccurrencesParDossier),
    pontInedit,
    pairesInedites,
  };
}
