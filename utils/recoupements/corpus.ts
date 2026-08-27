// utils/recoupements/corpus.ts
//
// CE QUE LA VEILLE A LE DROIT DE LIRE.
//
// Elle ne va rien chercher de nouveau : elle relit ce qui est déjà saisi ou
// déposé — mis en cause, description, comptes rendus, actes, et le texte des
// pièces déjà extrait pour la recherche documentaire. Aucune donnée ne sort du
// poste : le corpus est construit en mémoire, à partir de données déjà
// déchiffrées pour l'affichage.

import type { Enquete } from '@/types/interfaces';
import type { DossierInstruction } from '@/types/instructionTypes';
import type { CorpusFragment, DossierCorpus } from '@/types/recoupementTypes';

/** Clé d'un texte de pièce dans la table fournie au constructeur de corpus. */
export function docTextKey(enqueteNumero: string, cheminRelatif: string): string {
  return `${enqueteNumero}::${cheminRelatif}`;
}

/** Identifiant stable d'une enquête (les id repartent de 1 par contentieux). */
export function enqueteKey(contentieuxId: string, enqueteId: number): string {
  return `enq:${contentieuxId}#${enqueteId}`;
}

/** Identifiant stable d'un dossier d'instruction. */
export function instructionKey(dossierId: number): string {
  return `inst:${dossierId}`;
}

/** Retire le balisage d'un champ HTML (bloc-notes, événements d'instruction). */
function sansHtml(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ');
}

function pousser(fragments: CorpusFragment[], fragment: CorpusFragment): void {
  if (fragment.texte && fragment.texte.trim().length >= 3) fragments.push(fragment);
}

function dateFr(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
}

export interface CorpusOptions {
  /** Texte des pièces déjà extrait (clé `docTextKey`). Facultatif. */
  documentTexts?: Map<string, string>;
  /** Inclure les enquêtes archivées (par défaut oui : un dossier clos éclaire
   *  souvent une affaire en cours). */
  includeArchives?: boolean;
  /**
   * Contentieux où l'utilisateur est juriste assistant : les enquêtes qui y
   * sont dissimulées aux JA (`hiddenFromJA`) sortent du corpus. Un signal ne
   * doit jamais laisser entrevoir un dossier qu'on n'a pas le droit de voir.
   */
  contentieuxJA?: Set<string>;
}

/** Corpus d'une enquête préliminaire. */
export function corpusEnquete(
  enquete: Enquete,
  contentieuxId: string,
  options: CorpusOptions = {}
): DossierCorpus {
  const fragments: CorpusFragment[] = [];

  pousser(fragments, { origine: 'description', texte: enquete.description || '' });
  pousser(fragments, { origine: 'notes', texte: enquete.notes || '' });

  for (const mec of enquete.misEnCause || []) {
    // Le rôle porte souvent l'adresse, le surnom ou la ligne utilisée.
    pousser(fragments, { origine: 'mec', detail: mec.nom, texte: `${mec.nom || ''} ${mec.role || ''}`.trim() });
  }

  for (const cr of enquete.comptesRendus || []) {
    pousser(fragments, {
      origine: 'cr',
      detail: `CR du ${dateFr(cr.date)}${cr.enqueteur ? ` · ${cr.enqueteur}` : ''}`,
      texte: sansHtml(cr.description),
    });
  }

  for (const ecoute of enquete.ecoutes || []) {
    pousser(fragments, {
      origine: 'ecoute',
      detail: `Interception ${ecoute.numero || ''}`.trim(),
      texte: [ecoute.numero, ecoute.cible, ecoute.description].filter(Boolean).join(' — '),
    });
  }

  for (const geoloc of enquete.geolocalisations || []) {
    pousser(fragments, {
      origine: 'geolocalisation',
      detail: `Géolocalisation ${geoloc.objet || ''}`.trim(),
      texte: [geoloc.objet, geoloc.description].filter(Boolean).join(' — '),
    });
  }

  for (const acte of enquete.actes || []) {
    pousser(fragments, {
      origine: 'acte',
      detail: acte.type,
      texte: [acte.type, acte.description].filter(Boolean).join(' — '),
    });
  }

  if (options.documentTexts) {
    for (const doc of enquete.documents || []) {
      const texte = options.documentTexts.get(docTextKey(enquete.numero, doc.cheminRelatif));
      pousser(fragments, { origine: 'document', detail: doc.nomOriginal || doc.nom, texte: texte || '' });
    }
  }

  return {
    key: enqueteKey(contentieuxId, enquete.id),
    numero: enquete.numero,
    label: `Enquête ${enquete.numero}`,
    nature: 'enquete',
    contentieuxId,
    enqueteId: enquete.id,
    personnes: (enquete.misEnCause || []).map(m => m.nom).filter(Boolean),
    fragments,
  };
}

/**
 * Corpus d'un dossier d'instruction.
 *
 * Quand une enquête préliminaire lui est rattachée, TOUT ce qu'elle contient
 * (description, comptes rendus, actes, interceptions, pièces) est versé ici :
 * c'est le même dossier, et c'est là que dorment les PV du début d'affaire.
 * Sans cela, une adresse relevée en préliminaire disparaissait le jour de
 * l'ouverture d'information — la préliminaire étant écartée du corpus pour ne
 * pas se recouper avec elle-même.
 */
export function corpusInstruction(
  dossier: DossierInstruction,
  prelim?: { enquete: Enquete; contentieuxId: string },
  options: CorpusOptions = {}
): DossierCorpus {
  const fragments: CorpusFragment[] = [];
  const reference = dossier.numeroInstruction || dossier.numeroParquet;

  pousser(fragments, { origine: 'description', texte: dossier.description || '' });
  pousser(fragments, { origine: 'notes', texte: sansHtml(dossier.notesActesJI) });

  for (const item of dossier.saisine || []) {
    pousser(fragments, { origine: 'description', detail: item.qualification, texte: item.faits || '' });
  }

  for (const mex of dossier.misEnExamen || []) {
    pousser(fragments, {
      origine: 'mec',
      detail: mex.nom,
      texte: [mex.nom, mex.adresse, mex.profession, mex.elementsCharge, mex.notes].filter(Boolean).join(' — '),
    });
  }

  for (const suspect of dossier.suspects || []) {
    pousser(fragments, { origine: 'mec', detail: suspect.nom, texte: `${suspect.nom || ''} ${suspect.role || ''}`.trim() });
  }

  for (const note of dossier.notesPerso || []) {
    pousser(fragments, { origine: 'notes', detail: `Note du ${dateFr(note.date)}`, texte: sansHtml(note.contenu) });
  }

  for (const ev of dossier.evenements || []) {
    pousser(fragments, {
      origine: 'cr',
      detail: ev.titre || `Événement du ${dateFr(ev.date)}`,
      texte: sansHtml(ev.description),
    });
  }

  const personnes = [
    ...(dossier.misEnExamen || []).map(m => m.nom),
    ...(dossier.suspects || []).map(s => s.nom),
    ...(dossier.victimes || []).map(v => v.nom),
  ].filter(Boolean);

  // La préliminaire rattachée : ses textes et ses personnes rejoignent le
  // dossier d'instruction, en gardant sa référence pour que l'affichage dise
  // d'où sort la mention (« préliminaire 2024/1234 · CR du 12/03 »).
  if (prelim) {
    const source = corpusEnquete(prelim.enquete, prelim.contentieuxId, options);
    const marque = `préliminaire ${prelim.enquete.numero}`;
    for (const fragment of source.fragments) {
      fragments.push({
        ...fragment,
        detail: fragment.detail ? `${marque} · ${fragment.detail}` : marque,
      });
    }
    for (const nom of source.personnes) {
      if (nom && !personnes.includes(nom)) personnes.push(nom);
    }
  }

  return {
    key: instructionKey(dossier.id),
    numero: reference,
    label: `Instruction ${reference}`,
    nature: 'instruction',
    contentieuxId: dossier.contentieuxId,
    instructionId: dossier.id,
    personnes,
    fragments,
  };
}

/**
 * Mémoire des corpus déjà bâtis, d'un calcul à l'autre : identifiant du
 * dossier → empreinte de son contenu + corpus obtenu.
 *
 * La veille se relance à chaque pièce lue et à chaque synchronisation. Rebâtir
 * alors les 200 dossiers, c'est repasser toutes les expressions régulières de
 * `sansHtml` sur tous les comptes rendus, toutes les notes et tous les
 * événements — plusieurs secondes de thread principal, pour un résultat
 * identique à la virgule près. Un dossier dont l'empreinte n'a pas bougé rend
 * donc le corpus de la fois précédente.
 */
export type CorpusMemo = Map<string, { sig: string; corpus: DossierCorpus }>;

export interface BuildCorpusHooks {
  /** Rend la main au navigateur entre deux dossiers (cf. moteur). */
  respirer?: () => Promise<void>;
  /** Interrompt la construction : les données ont changé, on recommencera. */
  annule?: () => boolean;
  /** Mémoire d'un calcul à l'autre (cf. CorpusMemo). */
  memo?: CorpusMemo;
}

/**
 * Empreinte du contenu d'une enquête, en métadonnées seulement : jamais le
 * texte, jamais un parcours des comptes rendus. `dateMiseAJour` couvre les
 * saisies ; la liste des pièces DONT LE TEXTE EST EN MÉMOIRE couvre la lecture
 * progressive des pièces (une pièce de plus change le corpus du dossier).
 */
function signatureEnquete(enquete: Enquete, documentTexts?: Map<string, string>): string {
  const parts = [enquete.numero || '', enquete.dateMiseAJour || '', enquete.statut || ''];
  if (documentTexts) {
    for (const doc of enquete.documents || []) {
      const texte = documentTexts.get(docTextKey(enquete.numero, doc.cheminRelatif));
      if (texte !== undefined) parts.push(`${doc.cheminRelatif}:${texte.length}`);
    }
  }
  return parts.join('~');
}

/** Empreinte d'un dossier d'instruction, préliminaire rattachée comprise. */
function signatureInstruction(
  dossier: DossierInstruction,
  prelim: { enquete: Enquete; contentieuxId: string } | undefined,
  documentTexts?: Map<string, string>
): string {
  const base = `${dossier.numeroInstruction || ''}~${dossier.numeroParquet || ''}~${dossier.dateMiseAJour || ''}`;
  return prelim ? `${base}~+${signatureEnquete(prelim.enquete, documentTexts)}` : base;
}

/**
 * Corpus complet : toutes les enquêtes accessibles + tous les dossiers
 * d'instruction. Une enquête préliminaire rattachée à une instruction n'est
 * pas un dossier de plus — ce serait le même vu deux fois, se recoupant avec
 * lui-même : elle est VERSÉE dans son dossier d'instruction, contenu compris.
 *
 * Asynchrone par construction : la lecture rend régulièrement la main
 * (`respirer`) pour ne jamais figer une saisie en cours. Renvoie `null` si la
 * construction a été interrompue (`annule`).
 */
export async function buildCorpus(
  enquetesByContentieux: Map<string, Enquete[]>,
  instructions: DossierInstruction[],
  options: CorpusOptions = {},
  hooks: BuildCorpusHooks = {}
): Promise<DossierCorpus[] | null> {
  const corpus: DossierCorpus[] = [];
  /** Clé de l'enquête préliminaire → dossier d'instruction qui la prolonge. */
  const prelimRattachees = new Map<string, number>();
  /** Préliminaire retrouvée, prête à être versée dans son instruction. */
  const prelimParInstruction = new Map<number, { enquete: Enquete; contentieuxId: string }>();

  // Une respiration toutes les 25 ms, comme dans le moteur : en dessous,
  // l'interface reste fluide.
  const TRANCHE_MS = 25;
  let dernierRepos = Date.now();
  const souffler = async (): Promise<boolean> => {
    if (hooks.annule?.()) return false;
    if (!hooks.respirer || Date.now() - dernierRepos < TRANCHE_MS) return true;
    await hooks.respirer();
    dernierRepos = Date.now();
    return !hooks.annule?.();
  };

  const memo = hooks.memo;
  const vus = new Set<string>();
  /** Corpus mémoïsé si l'empreinte est inchangée, rebâti sinon. */
  const memoiser = (cle: string, sig: string, bâtir: () => DossierCorpus): DossierCorpus => {
    vus.add(cle);
    if (!memo) return bâtir();
    const connu = memo.get(cle);
    if (connu && connu.sig === sig) return connu.corpus;
    const frais = bâtir();
    memo.set(cle, { sig, corpus: frais });
    return frais;
  };

  for (const dossier of instructions) {
    if (dossier.enquetePreliminaireId != null) {
      const ctx = dossier.enquetePreliminaireContentieuxId || dossier.contentieuxId;
      if (ctx) prelimRattachees.set(enqueteKey(ctx, dossier.enquetePreliminaireId), dossier.id);
    }
  }

  for (const [contentieuxId, liste] of enquetesByContentieux) {
    for (const enquete of liste || []) {
      if (!enquete) continue;
      if (options.includeArchives === false && enquete.statut === 'archive') continue;
      if (enquete.hiddenFromJA && options.contentieuxJA?.has(contentieuxId)) continue;
      const key = enqueteKey(contentieuxId, enquete.id);
      const instructionId = prelimRattachees.get(key);
      if (instructionId !== undefined) {
        prelimParInstruction.set(instructionId, { enquete, contentieuxId });
        continue; // versée dans son dossier d'instruction, pas comptée à part
      }
      // Une enquête partagée entre contentieux est stockée par son contentieux
      // d'origine : on ne la compte qu'une fois.
      if (enquete.contentieuxOrigine && enquete.contentieuxOrigine !== contentieuxId) continue;
      if (!await souffler()) return null;
      corpus.push(memoiser(
        key,
        signatureEnquete(enquete, options.documentTexts),
        () => corpusEnquete(enquete, contentieuxId, options),
      ));
    }
  }

  for (const dossier of instructions) {
    if (!dossier) continue;
    const prelim = prelimParInstruction.get(dossier.id);
    if (!await souffler()) return null;
    corpus.push(memoiser(
      instructionKey(dossier.id),
      signatureInstruction(dossier, prelim, options.documentTexts),
      () => corpusInstruction(dossier, prelim, options),
    ));
  }

  // Un dossier qui a quitté le périmètre ne doit pas rester en mémoire.
  if (memo && memo.size > vus.size) {
    for (const cle of Array.from(memo.keys())) if (!vus.has(cle)) memo.delete(cle);
  }

  return corpus;
}
