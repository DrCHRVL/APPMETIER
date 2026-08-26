// hooks/useRecoupements.ts
//
// VEILLE DE RECOUPEMENTS — branchement sur les données de l'application.
//
// Deux régimes, calqués sur la recherche documentaire (cf.
// useGlobalDocumentSearch) : rien ne part sur le réseau en silence.
//   - automatique : les fiches, les comptes rendus, les actes et les pièces
//     DÉJÀ analysées pour la recherche. Coût nul, aucun téléchargement.
//   - à la demande : « Analyser les pièces » extrait le texte des documents
//     jamais lus, une fois pour toutes (le cache resservira partout ailleurs).
//
// Le calcul lui-même est repoussé dans un temps mort du navigateur : la veille
// ne doit jamais retarder une saisie ni la rédaction d'un acte.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Enquete } from '@/types/interfaces';
import type { DossierInstruction } from '@/types/instructionTypes';
import type { Recoupement, RecoupementAcks } from '@/types/recoupementTypes';
import { buildCorpus, docTextKey } from '@/utils/recoupements/corpus';
import { detecterRecoupements } from '@/utils/recoupements/engine';
import {
  getCachedDocumentSearchText,
  getDocumentSearchText,
  isExtractableDocument,
} from '@/utils/documents/documentTextSearch';
import { userPreferencesSyncService } from '@/utils/dataSync/UserPreferencesSyncService';

export interface DocScanState {
  /** Extraction en cours. */
  scanning: boolean;
  done: number;
  total: number;
  /** Pièces jamais analysées — matière du bouton « Analyser les pièces ». */
  pending: number;
  /** Dossiers qui portent ces pièces jamais analysées (numéros). C'est le
   *  périmètre exact du chantier d'analyse profonde qu'on peut en tirer. */
  numeros: string[];
}

export interface RecoupementsApi {
  /** Signaux retenus (les signaux écartés en sont exclus). */
  signaux: Recoupement[];
  /** Signaux jamais vus, ou dont l'empreinte a changé depuis le dernier geste. */
  nouveaux: Recoupement[];
  /** Signaux par dossier concerné (clé de corpus). */
  parDossier: Map<string, Recoupement[]>;
  /** Signaux jamais vus, par dossier — c'est ce qui allume la pastille. */
  nouveauxParDossier: Map<string, Recoupement[]>;
  /** Signaux écartés par l'utilisateur (consultables, réactivables). */
  ecartes: Recoupement[];
  /** Un premier calcul est en cours. */
  computing: boolean;
  docScan: DocScanState;
  /** Lance l'extraction des pièces jamais analysées. */
  analyserPieces: () => void;
  estNouveau: (signal: Recoupement) => boolean;
  marquerVu: (signal: Recoupement) => void;
  /** Marque une série de signaux comme vus (une seule écriture). */
  marquerVus: (signaux: Recoupement[]) => void;
  ecarter: (signal: Recoupement) => void;
  reactiver: (signal: Recoupement) => void;
}

export interface UseRecoupementsOptions {
  enquetesByContentieux: Map<string, Enquete[]>;
  instructions: DossierInstruction[];
  /** Coupe la veille (profil épuré, module désactivé). */
  enabled?: boolean;
  /** Contentieux où l'utilisateur est JA : les dossiers dissimulés aux JA
   *  sortent du corpus (cf. buildCorpus). */
  contentieuxJA?: Set<string>;
}

const VIDE: Recoupement[] = [];
const DEBOUNCE_MS = 1200;

// Une pièce qui vient d'arriver est précisément celle qu'il faut lire : un PV
// transmis par une autre unité, versé ce matin, porte les noms qui relient deux
// affaires. On l'analyse donc sans attendre — mais uniquement elle, et par
// petites quantités : le reste du fonds ne s'ouvre que sur demande explicite.
const JOURS_PIECE_RECENTE = 45;
const AUTO_EXTRACTIONS_MAX = 8;

/** Pièce versée récemment — donc susceptible de n'avoir jamais été lue. */
function estRecente(dateAjout: string | undefined): boolean {
  if (!dateAjout) return false;
  const t = Date.parse(dateAjout);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < JOURS_PIECE_RECENTE * 24 * 60 * 60 * 1000;
}

/**
 * Empreinte légère du fond documentaire : identifiants et dates de mise à
 * jour, jamais le texte. Elle change quand un dossier change VRAIMENT — pas
 * quand la liste est simplement reconstruite à l'identique par une sync.
 */
function empreinteVeille(
  enquetesByContentieux: Map<string, Enquete[]>,
  instructions: DossierInstruction[],
  docVersion: number,
  contentieuxJA: Set<string> | undefined,
): string {
  // Le périmètre JA fait partie de l'empreinte : il filtre ce que le corpus a
  // le droit de contenir — deux périmètres différents ne sont jamais « le même
  // fond » même à dossiers identiques.
  const parts: string[] = [`v${docVersion}`, `ja:${[...(contentieuxJA || [])].sort().join(',')}`];
  for (const [ctx, enquetes] of enquetesByContentieux) {
    parts.push(`${ctx}#${enquetes.length}`);
    for (const e of enquetes) parts.push(`${e.id}.${e.dateMiseAJour || ''}`);
  }
  parts.push(`i#${instructions.length}`);
  for (const d of instructions) parts.push(`${d.id}.${d.dateMiseAJour || ''}`);
  return parts.join('|');
}

/** Repousse un travail à un temps mort du navigateur (repli : minuterie). */
function auRepos(fn: () => void): () => void {
  const w = typeof window !== 'undefined' ? (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  }) : undefined;
  if (w?.requestIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 3000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
}

export function useRecoupements({
  enquetesByContentieux,
  instructions,
  enabled = true,
  contentieuxJA,
}: UseRecoupementsOptions): RecoupementsApi {
  const [signauxBruts, setSignauxBruts] = useState<Recoupement[]>(VIDE);
  const [computing, setComputing] = useState(false);
  const [acks, setAcks] = useState<RecoupementAcks>({});
  const [docScan, setDocScan] = useState<DocScanState>({ scanning: false, done: 0, total: 0, pending: 0, numeros: [] });
  const [docVersion, setDocVersion] = useState(0);
  const [extraire, setExtraire] = useState(false);

  // Texte des pièces, accumulé hors du cycle de rendu (une Map mutée + un
  // compteur de version : on ne rend pas un composant par document lu).
  const docTexts = useRef<Map<string, string>>(new Map());
  const scanIdRef = useRef(0);
  /** Budget d'extractions automatiques (pièces récentes) pour cette session. */
  const budgetAutoRef = useRef(AUTO_EXTRACTIONS_MAX);

  // ── Gestes de l'utilisateur (préférences personnelles, synchronisées) ──
  useEffect(() => {
    let vivant = true;
    userPreferencesSyncService.getPreferences()
      .then(prefs => { if (vivant) setAcks(prefs?.recoupements?.entries || {}); })
      .catch(() => { /* préférences indisponibles : la veille reste muette sur les gestes */ });
    return () => { vivant = false; };
  }, []);

  const noter = useCallback((signal: Recoupement, action: 'vu' | 'ecarte') => {
    const ack = { stateKey: signal.stateKey, action, at: new Date().toISOString() };
    setAcks(prev => ({ ...prev, [signal.id]: ack }));
    void userPreferencesSyncService.setRecoupementAck(signal.id, ack);
  }, []);

  const marquerVu = useCallback((signal: Recoupement) => noter(signal, 'vu'), [noter]);

  const marquerVus = useCallback((liste: Recoupement[]) => {
    if (liste.length === 0) return;
    const at = new Date().toISOString();
    setAcks(prev => {
      const suite = { ...prev };
      let change = false;
      for (const signal of liste) {
        if (suite[signal.id]?.stateKey === signal.stateKey) continue;
        suite[signal.id] = { stateKey: signal.stateKey, action: 'vu', at };
        change = true;
      }
      // Une seule écriture pour tout le lot : déplier un bandeau ne doit pas
      // déclencher vingt allers-retours de préférences.
      if (change) void userPreferencesSyncService.setRecoupementAcks(suite);
      return change ? suite : prev;
    });
  }, []);
  const ecarter = useCallback((signal: Recoupement) => noter(signal, 'ecarte'), [noter]);
  const reactiver = useCallback((signal: Recoupement) => {
    setAcks(prev => {
      const suite = { ...prev };
      delete suite[signal.id];
      void userPreferencesSyncService.setRecoupementAcks(suite);
      return suite;
    });
  }, []);

  // ── Lecture des pièces ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !enquetesByContentieux) return;
    const scanId = ++scanIdRef.current;
    let annule = false;

    const travail = async () => {
      const jobs: Array<{ numero: string; doc: Enquete['documents'][number] }> = [];
      enquetesByContentieux.forEach(list => {
        for (const enquete of list || []) {
          for (const doc of enquete.documents || []) {
            if (isExtractableDocument(doc)) jobs.push({ numero: enquete.numero, doc });
          }
        }
      });

      let done = 0;
      let pending = 0;
      let nouveaux = 0;
      const dossiersEnAttente = new Set<string>();
      setDocScan({ scanning: extraire && jobs.length > 0, done: 0, total: jobs.length, pending: 0, numeros: [] });

      for (const job of jobs) {
        if (annule || scanId !== scanIdRef.current) return;
        const cle = docTextKey(job.numero, job.doc.cheminRelatif);
        if (docTexts.current.has(cle)) { done++; continue; }

        // Pièce récente jamais lue : on l'analyse d'office, dans la limite du
        // budget de la session. Tout le reste attend une demande explicite.
        const cache = extraire ? undefined : await getCachedDocumentSearchText(job.numero, job.doc);
        const auto = !extraire
          && cache === undefined
          && estRecente(job.doc.dateAjout)
          && budgetAutoRef.current > 0;

        let texte = cache;
        if (extraire || auto) {
          if (auto) budgetAutoRef.current--;
          texte = await getDocumentSearchText(job.numero, job.doc);
        }
        done++;
        if (texte === undefined) { pending++; dossiersEnAttente.add(job.numero); continue; } // jamais analysée
        if (texte?.raw) {
          docTexts.current.set(cle, texte.raw);
          nouveaux++;
          // Recalcul par paliers : une pièce lue ne relance pas tout le moteur.
          if (nouveaux % 15 === 0) setDocVersion(v => v + 1);
        }
        if (extraire && done % 5 === 0) {
          setDocScan({ scanning: done < jobs.length, done, total: jobs.length, pending, numeros: Array.from(dossiersEnAttente) });
          await new Promise(r => setTimeout(r, 0)); // respiration : l'app reste fluide
        }
      }

      if (annule || scanId !== scanIdRef.current) return;
      setDocScan({ scanning: false, done, total: jobs.length, pending, numeros: Array.from(dossiersEnAttente) });
      if (nouveaux > 0) setDocVersion(v => v + 1);
      if (extraire) setExtraire(false);
    };

    // Les enquêtes changent d'identité à chaque frappe : on laisse la saisie
    // se poser avant de repasser sur les pièces.
    let annulerRepos: (() => void) | null = null;
    const timer = setTimeout(() => { annulerRepos = auRepos(() => { void travail(); }); }, DEBOUNCE_MS);

    return () => {
      annule = true;
      clearTimeout(timer);
      annulerRepos?.();
    };
  }, [enabled, enquetesByContentieux, extraire]);

  const analyserPieces = useCallback(() => setExtraire(true), []);

  // ── Corpus puis détection : TOUT au repos, RIEN pendant le rendu ──────
  //
  // Le corpus était un useMemo — donc construit PENDANT le rendu. Or la liste
  // des enquêtes change d'identité à chaque frappe et à chaque cycle de
  // synchronisation : l'application relisait tous les comptes rendus, toutes
  // les notes et tout le texte des pièces au beau milieu d'un clic ou d'une
  // saisie. C'était le lag — celui de la saisie comme celui du défilement.
  //
  // Désormais l'effet débouncé fait tout : il attend que la saisie se pose
  // (1,2 s), attend un temps mort du navigateur, prend une EMPREINTE LÉGÈRE
  // des données (identifiants + dates de mise à jour — quelques microsecondes)
  // et ne construit le corpus puis ne lance la détection QUE si l'empreinte a
  // changé. Une sync qui n'apporte rien, un simple changement d'identité
  // d'objets : zéro octet relu, zéro calcul.
  const empreinteRef = useRef('');

  useEffect(() => {
    if (!enabled) {
      setSignauxBruts(VIDE);
      setComputing(false);
      return;
    }
    let annule = false;
    let cleanupIdle: (() => void) | null = null;
    const timer = setTimeout(() => {
      cleanupIdle = auRepos(() => {
        if (annule) return;
        const empreinte = empreinteVeille(enquetesByContentieux, instructions || [], docVersion, contentieuxJA);
        if (empreinte === empreinteRef.current) return; // rien n'a bougé sur le fond
        setComputing(true);
        const corpus = buildCorpus(enquetesByContentieux, instructions || [], {
          documentTexts: docTexts.current,
          contentieuxJA,
        });
        if (annule) return;
        if (corpus.length < 2) {
          empreinteRef.current = empreinte;
          setSignauxBruts(VIDE);
          setComputing(false);
          return;
        }
        detecterRecoupements(corpus, {
          respirer: () => new Promise<void>(r => { setTimeout(r, 0); }),
          annule: () => annule,
        })
          .then(signaux => {
            if (annule) return;
            // L'empreinte n'est retenue qu'au terme d'un calcul complet : un
            // run annulé en route sera refait, jamais considéré comme acquis.
            if (signaux) { empreinteRef.current = empreinte; setSignauxBruts(signaux); }
          })
          .catch(err => {
            console.error('Veille de recoupements', err);
            if (!annule) setSignauxBruts(VIDE);
          })
          .finally(() => { if (!annule) setComputing(false); });
      });
    }, DEBOUNCE_MS);

    return () => {
      annule = true;
      clearTimeout(timer);
      cleanupIdle?.();
    };
    // docVersion : nouvelles pièces lues → corpus à rebâtir.
  }, [enabled, enquetesByContentieux, instructions, contentieuxJA, docVersion]);

  // ── Tri selon les gestes de l'utilisateur ─────────────────────────────
  const estNouveau = useCallback((signal: Recoupement) => {
    const ack = acks[signal.id];
    // Jamais vu, ou vu dans une autre configuration de dossiers : c'est neuf.
    return !ack || ack.stateKey !== signal.stateKey;
  }, [acks]);

  const { signaux, nouveaux, ecartes } = useMemo(() => {
    const retenus: Recoupement[] = [];
    const neufs: Recoupement[] = [];
    const rejetes: Recoupement[] = [];
    for (const signal of signauxBruts) {
      const ack = acks[signal.id];
      if (ack?.action === 'ecarte' && ack.stateKey === signal.stateKey) { rejetes.push(signal); continue; }
      retenus.push(signal);
      if (!ack || ack.stateKey !== signal.stateKey) neufs.push(signal);
    }
    return { signaux: retenus, nouveaux: neufs, ecartes: rejetes };
  }, [signauxBruts, acks]);

  const { parDossier, nouveauxParDossier } = useMemo(() => {
    const tous = new Map<string, Recoupement[]>();
    const neufs = new Map<string, Recoupement[]>();
    const ranger = (map: Map<string, Recoupement[]>, signal: Recoupement) => {
      for (const key of signal.dossierKeys) {
        const arr = map.get(key);
        if (arr) arr.push(signal);
        else map.set(key, [signal]);
      }
    };
    for (const signal of signaux) ranger(tous, signal);
    for (const signal of nouveaux) ranger(neufs, signal);
    return { parDossier: tous, nouveauxParDossier: neufs };
  }, [signaux, nouveaux]);

  // Identité stable : la fiche de dossier est mémoïsée sur cet objet.
  return useMemo(() => ({
    signaux,
    nouveaux,
    parDossier,
    nouveauxParDossier,
    ecartes,
    computing,
    docScan,
    analyserPieces,
    estNouveau,
    marquerVu,
    marquerVus,
    ecarter,
    reactiver,
  }), [
    signaux, nouveaux, parDossier, nouveauxParDossier, ecartes, computing, docScan,
    analyserPieces, estNouveau, marquerVu, marquerVus, ecarter, reactiver,
  ]);
}
