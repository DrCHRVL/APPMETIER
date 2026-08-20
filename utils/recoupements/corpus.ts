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

/** Corpus d'un dossier d'instruction. */
export function corpusInstruction(dossier: DossierInstruction): DossierCorpus {
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
 * Corpus complet : toutes les enquêtes accessibles + tous les dossiers
 * d'instruction. Une enquête préliminaire rattachée à une instruction est
 * ignorée : c'est le même dossier vu deux fois, et il se recouperait avec
 * lui-même.
 */
export function buildCorpus(
  enquetesByContentieux: Map<string, Enquete[]>,
  instructions: DossierInstruction[],
  options: CorpusOptions = {}
): DossierCorpus[] {
  const corpus: DossierCorpus[] = [];
  const prelimRattachees = new Set<string>();

  for (const dossier of instructions) {
    if (dossier.enquetePreliminaireId != null) {
      const ctx = dossier.enquetePreliminaireContentieuxId || dossier.contentieuxId;
      if (ctx) prelimRattachees.add(enqueteKey(ctx, dossier.enquetePreliminaireId));
    }
  }

  enquetesByContentieux.forEach((liste, contentieuxId) => {
    for (const enquete of liste || []) {
      if (!enquete) continue;
      if (options.includeArchives === false && enquete.statut === 'archive') continue;
      if (enquete.hiddenFromJA && options.contentieuxJA?.has(contentieuxId)) continue;
      const key = enqueteKey(contentieuxId, enquete.id);
      if (prelimRattachees.has(key)) continue;
      // Une enquête partagée entre contentieux est stockée par son contentieux
      // d'origine : on ne la compte qu'une fois.
      if (enquete.contentieuxOrigine && enquete.contentieuxOrigine !== contentieuxId) continue;
      corpus.push(corpusEnquete(enquete, contentieuxId, options));
    }
  });

  for (const dossier of instructions) {
    if (!dossier) continue;
    corpus.push(corpusInstruction(dossier));
  }

  return corpus;
}
