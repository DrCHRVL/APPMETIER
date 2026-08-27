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
import { buildCorpus, docTextKey, type CorpusMemo } from '@/utils/recoupements/corpus';
import { detecterRecoupements } from '@/utils/recoupements/engine';
import {
  ackPour,
  estNouveau as signalEstNouveau,
  estRevenuApresEcart,
  fusionnerAcks,
  patchVus,
  trierSelonGestes,
} from '@/utils/recoupements/gestes';
import {
  getCachedDocumentRawText,
  getDocumentSearchText,
  isExtractableDocument,
} from '@/utils/documents/documentTextSearch';
import { userPreferencesSyncService } from '@/utils/dataSync/UserPreferencesSyncService';
import { activiteDebut } from '@/lib/monitor/clientMonitor';

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
  /** Signaux jamais traités, ou qu'un dossier de plus a rejoints depuis le geste. */
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
  /** Signal écarté autrefois, remonté parce qu'un dossier de plus l'a rejoint. */
  estRevenu: (signal: Recoupement) => boolean;
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

// Budget mémoire des textes de pièces retenus pour la veille. Au-delà, les
// pièces suivantes ne sont plus gardées en mémoire (elles restent dans le
// cache IndexedDB et reviendront si de la place se libère au prochain
// démarrage). Sans cette borne, un fonds très analysé accumulait des centaines
// de Mo de texte — trois copies comprises — jusqu'au « la page ne répond pas ».
const DOC_TEXTS_MAX_CHARS = 24_000_000; // ~48 Mo de chaînes JS
// Un texte de pièce n'est utile à la veille qu'à hauteur de ce que le moteur
// lit (maxCharsFragment) : inutile d'en retenir davantage en mémoire.
const DOC_TEXT_MAX_PAR_PIECE = 300_000;

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

/**
 * Onglet au premier plan ?
 *
 * Un onglet passé derrière voit ses minuteries bridées à une seconde, puis
 * carrément gelées. Or la veille rend la main des MILLIERS de fois par calcul :
 * en arrière-plan, un calcul de trente secondes devient une affaire d'heures,
 * qui retient toute sa mémoire — et que le navigateur relâche d'un bloc au
 * retour, précisément quand le magistrat revient sur l'application. D'où le
 * gel systématique en repassant d'un autre onglet à SIRAL.
 *
 * La veille ne travaille donc que sur l'onglet visible.
 */
function useOngletVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const maj = () => setVisible(!document.hidden);
    maj();
    document.addEventListener('visibilitychange', maj);
    return () => document.removeEventListener('visibilitychange', maj);
  }, []);
  return visible;
}

export function useRecoupements({
  enquetesByContentieux,
  instructions,
  enabled = true,
  contentieuxJA,
}: UseRecoupementsOptions): RecoupementsApi {
  const ongletVisible = useOngletVisible();
  const [signauxBruts, setSignauxBruts] = useState<Recoupement[]>(VIDE);
  const [computing, setComputing] = useState(false);
  const [acks, setAcks] = useState<RecoupementAcks>({});
  const [docScan, setDocScan] = useState<DocScanState>({ scanning: false, done: 0, total: 0, pending: 0, numeros: [] });
  const [docVersion, setDocVersion] = useState(0);
  const [extraire, setExtraire] = useState(false);

  // Texte des pièces, accumulé hors du cycle de rendu (une Map mutée + un
  // compteur de version : on ne rend pas un composant par document lu).
  const docTexts = useRef<Map<string, string>>(new Map());
  /** Volume total (caractères) retenu dans docTexts — borné par DOC_TEXTS_MAX_CHARS. */
  const docTextsCharsRef = useRef(0);
  const scanIdRef = useRef(0);
  /** Budget d'extractions automatiques (pièces récentes) pour cette session. */
  const budgetAutoRef = useRef(AUTO_EXTRACTIONS_MAX);
  /** Empreinte du dernier scan de pièces mené à terme : un changement
   *  d'identité des enquêtes (frappe, ouverture de fiche, sync) qui ne touche
   *  pas au fond documentaire ne relance plus la boucle sur toutes les pièces. */
  const scanEmpreinteRef = useRef('');
  /** Corpus déjà bâtis, d'un calcul à l'autre : seuls les dossiers dont le
   *  contenu a bougé sont relus (cf. CorpusMemo). */
  const corpusMemoRef = useRef<CorpusMemo>(new Map());

  // ── Gestes de l'utilisateur (préférences personnelles, synchronisées) ──
  //
  // Miroir hors rendu de `acks` : les écritures se calculent sur l'état
  // courant, sans attendre le prochain rendu ni dépendre de l'ordre des
  // rafraîchissements.
  const acksRef = useRef<RecoupementAcks>({});
  /**
   * Signaux remis en circulation à l'instant. Une relecture partie AVANT que
   * l'oubli ne soit écrit les rapporterait — et le signal retomberait dans les
   * écartés sous les yeux de l'utilisateur. On les tient à l'écart jusqu'à ce
   * que les préférences relues ne les portent plus.
   */
  const oubliesRef = useRef<Set<string>>(new Set());

  /**
   * (Re)lecture des gestes enregistrés, FUSIONNÉE avec ce qui est déjà là.
   *
   * Elle ne se contente pas du montage : au premier rendu, l'utilisateur
   * connecté n'est pas toujours résolu et les préférences reviennent vides.
   * La veille tournait alors sur une table de gestes vide — tout paraissait
   * neuf, et la première écriture écrasait les écartements de la veille.
   * On rejoue donc la lecture à chaque synchronisation de préférences.
   */
  const chargerAcks = useCallback(async () => {
    try {
      const prefs = await userPreferencesSyncService.getPreferences();
      const enregistres = prefs?.recoupements?.entries;
      if (!enregistres || Object.keys(enregistres).length === 0) return;
      const retenus: RecoupementAcks = { ...enregistres };
      for (const id of oubliesRef.current) {
        // Encore présent : l'oubli n'est pas retombé, on l'écarte de la relecture.
        // Absent : l'écriture a bien atterri, plus rien à surveiller.
        if (id in retenus) delete retenus[id];
        else oubliesRef.current.delete(id);
      }
      const suite = fusionnerAcks(acksRef.current, retenus);
      acksRef.current = suite;
      setAcks(suite);
    } catch {
      /* préférences indisponibles : la veille reste muette sur les gestes */
    }
  }, []);

  useEffect(() => {
    void chargerAcks();
    const onSync = (event: Event) => {
      const scope = (event as CustomEvent<{ scope?: string }>).detail?.scope;
      if (scope && scope !== 'userPreferences') return;
      void chargerAcks();
    };
    window.addEventListener('global-sync-completed', onSync);
    return () => window.removeEventListener('global-sync-completed', onSync);
  }, [chargerAcks]);

  /** Applique un lot de gestes : état local, puis écriture FUSIONNÉE. */
  const appliquer = useCallback((patch: RecoupementAcks) => {
    if (Object.keys(patch).length === 0) return;
    const suite = { ...acksRef.current, ...patch };
    for (const id of Object.keys(patch)) oubliesRef.current.delete(id);
    acksRef.current = suite;
    setAcks(suite);
    void userPreferencesSyncService.mergeRecoupementAcks(patch);
  }, []);

  const noter = useCallback((signal: Recoupement, action: 'vu' | 'ecarte') => {
    appliquer({ [signal.id]: ackPour(signal, action, new Date().toISOString()) });
  }, [appliquer]);

  const marquerVu = useCallback((signal: Recoupement) => noter(signal, 'vu'), [noter]);

  // Un seul lot pour toute une liste : déplier un bandeau ne doit pas
  // déclencher vingt allers-retours de préférences. Les signaux écartés en
  // sont exclus (cf. patchVus) : un regard ne défait pas une décision.
  const marquerVus = useCallback((liste: Recoupement[]) => {
    if (liste.length === 0) return;
    appliquer(patchVus(liste, acksRef.current, new Date().toISOString()));
  }, [appliquer]);

  const ecarter = useCallback((signal: Recoupement) => noter(signal, 'ecarte'), [noter]);

  const reactiver = useCallback((signal: Recoupement) => {
    const suite = { ...acksRef.current };
    delete suite[signal.id];
    oubliesRef.current.add(signal.id);
    acksRef.current = suite;
    setAcks(suite);
    void userPreferencesSyncService.removeRecoupementAck(signal.id);
  }, []);

  // ── Lecture des pièces ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !ongletVisible || !enquetesByContentieux) return;
    const scanId = ++scanIdRef.current;
    let annule = false;

    // Poser un état de scan SEULEMENT s'il change : deux setDocScan
    // inconditionnels par passage re-rendaient deux fois toute la page.
    const majDocScan = (suivant: DocScanState) => {
      setDocScan(prev => (
        prev.scanning === suivant.scanning
        && prev.done === suivant.done
        && prev.total === suivant.total
        && prev.pending === suivant.pending
        && prev.numeros.length === suivant.numeros.length
        && prev.numeros.every((n, i) => n === suivant.numeros[i])
      ) ? prev : suivant);
    };

    const travail = async () => {
      const jobs: Array<{ numero: string; doc: Enquete['documents'][number] }> = [];
      enquetesByContentieux.forEach(list => {
        for (const enquete of list || []) {
          for (const doc of enquete.documents || []) {
            if (isExtractableDocument(doc)) jobs.push({ numero: enquete.numero, doc });
          }
        }
      });

      // Empreinte du fond documentaire (métadonnées seulement) : si rien n'a
      // bougé depuis le dernier passage complet, on ne reparcourt pas les
      // pièces — ouvrir une fiche ou corriger un CR ne relit plus le fonds.
      // Le budget d'auto-extraction n'entre PAS dans l'empreinte : une pièce
      // récente lue faisait alors changer l'empreinte, donc repasser sur les
      // milliers de pièces du fonds — pour n'y rien trouver de plus, celles
      // qu'on vient de lire étant déjà en mémoire.
      const empreinte = [
        extraire ? 'x' : '-',
        ...jobs.map(j => `${j.numero}|${j.doc.cheminRelatif}|${j.doc.taille || 0}|${j.doc.dateAjout || ''}`),
      ].join('\n');
      if (!extraire && empreinte === scanEmpreinteRef.current) return;

      const moniteur = activiteDebut(
        extraire ? 'Analyse des pièces (veille)' : 'Lecture des pièces en cache (veille)',
        'veille',
        `${jobs.length} pièce(s) à parcourir`,
      );

      let done = 0;
      let pending = 0;
      let nouveaux = 0;
      const dossiersEnAttente = new Set<string>();
      majDocScan({ scanning: extraire && jobs.length > 0, done: 0, total: jobs.length, pending: 0, numeros: [] });

      for (const job of jobs) {
        if (annule || scanId !== scanIdRef.current) { moniteur.fin('interrompu (données modifiées)'); return; }
        const cle = docTextKey(job.numero, job.doc.cheminRelatif);
        if (docTexts.current.has(cle)) { done++; continue; }

        // Pièce récente jamais lue : on l'analyse d'office, dans la limite du
        // budget de la session. Tout le reste attend une demande explicite.
        //
        // Lecture en TEXTE BRUT : la veille n'a que faire de la forme
        // normalisée que la recherche documentaire construit, et la calculer
        // sur des milliers de pièces pour la jeter aussitôt tenait à elle
        // seule une bonne part du temps de ce passage.
        const cache = extraire ? undefined : await getCachedDocumentRawText(job.numero, job.doc);
        const auto = !extraire
          && cache === undefined
          && estRecente(job.doc.dateAjout)
          && budgetAutoRef.current > 0;

        let texte = cache;
        if (extraire || auto) {
          if (auto) budgetAutoRef.current--;
          texte = (await getDocumentSearchText(job.numero, job.doc))?.raw ?? null;
        }
        done++;
        if (texte === undefined) { pending++; dossiersEnAttente.add(job.numero); continue; } // jamais analysée
        if (texte) {
          // Borne mémoire : on ne retient que ce que le moteur lira, et jamais
          // au-delà du budget global — le reste demeure dans IndexedDB.
          const retenu = texte.length > DOC_TEXT_MAX_PAR_PIECE
            ? texte.slice(0, DOC_TEXT_MAX_PAR_PIECE)
            : texte;
          if (docTextsCharsRef.current + retenu.length <= DOC_TEXTS_MAX_CHARS) {
            docTexts.current.set(cle, retenu);
            docTextsCharsRef.current += retenu.length;
            nouveaux++;
          }
        }
        if (extraire && done % 5 === 0) {
          majDocScan({ scanning: done < jobs.length, done, total: jobs.length, pending, numeros: Array.from(dossiersEnAttente) });
          moniteur.progression(done, jobs.length);
          // Recalcul par paliers pendant une analyse explicite : les premiers
          // signaux arrivent sans attendre la fin — mais plus jamais toutes
          // les 15 pièces (chaque palier relance TOUT le moteur).
          if (nouveaux > 0 && done % 60 === 0) setDocVersion(v => v + 1);
          await new Promise(r => setTimeout(r, 0)); // respiration : l'app reste fluide
        }
      }

      if (annule || scanId !== scanIdRef.current) { moniteur.fin('interrompu (données modifiées)'); return; }
      scanEmpreinteRef.current = empreinte;
      majDocScan({ scanning: false, done, total: jobs.length, pending, numeros: Array.from(dossiersEnAttente) });
      moniteur.fin(`${done} lue(s), ${nouveaux} nouvelle(s), ${pending} en attente d'analyse`);
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
  }, [enabled, ongletVisible, enquetesByContentieux, extraire]);

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
    // Onglet passé derrière : le calcul en cours a déjà été interrompu par le
    // nettoyage de cet effet, et aucun autre ne part. Les signaux affichés
    // restent — c'est le calcul qui s'arrête, pas le résultat.
    if (!ongletVisible) {
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
        const moniteur = activiteDebut('Détection des recoupements', 'veille');

        // Les deux moitiés du calcul — bâtir le corpus, puis le comparer —
        // rendent la main au navigateur avec les MÊMES crochets. La
        // construction du corpus était jusqu'ici un bloc synchrone : sur deux
        // cents dossiers, elle repassait toutes les expressions régulières de
        // dé-balisage sur tous les comptes rendus d'un coup, et c'est ce bloc
        // que l'interface payait en gel de plusieurs secondes.
        const respirer = () => new Promise<void>(r => { setTimeout(r, 0); });
        const estAnnule = () => annule || document.hidden;
        // Le moniteur d'activité doit dire vrai : un calcul lâché parce que
        // l'onglet est passé derrière n'est pas un calcul périmé par une saisie.
        const raisonArret = () => (document.hidden
          ? 'interrompu (onglet en arrière-plan)'
          : 'interrompu (données modifiées)');

        void (async () => {
          try {
            const corpus = await buildCorpus(
              enquetesByContentieux,
              instructions || [],
              { documentTexts: docTexts.current, contentieuxJA },
              { respirer, annule: estAnnule, memo: corpusMemoRef.current },
            );
            if (corpus === null || annule) { moniteur.fin(raisonArret()); return; }
            if (corpus.length < 2) {
              empreinteRef.current = empreinte;
              setSignauxBruts(VIDE);
              moniteur.fin('corpus insuffisant');
              return;
            }
            moniteur.progression(0, corpus.length);
            const signaux = await detecterRecoupements(corpus, {
              respirer,
              annule: estAnnule,
              avancement: (lus, total) => moniteur.progression(lus, total),
            });
            if (annule) { moniteur.fin(raisonArret()); return; }
            // L'empreinte n'est retenue qu'au terme d'un calcul complet : un
            // run annulé en route sera refait, jamais considéré comme acquis.
            if (signaux) {
              empreinteRef.current = empreinte;
              setSignauxBruts(signaux);
              moniteur.fin(`${corpus.length} dossiers comparés — ${signaux.length} signal(aux)`);
            } else {
              moniteur.fin(raisonArret());
            }
          } catch (err) {
            console.error('Veille de recoupements', err);
            moniteur.echec(String((err as Error)?.message || err));
            if (!annule) setSignauxBruts(VIDE);
          } finally {
            if (!annule) setComputing(false);
          }
        })();
      });
    }, DEBOUNCE_MS);

    return () => {
      annule = true;
      clearTimeout(timer);
      cleanupIdle?.();
    };
    // docVersion : nouvelles pièces lues → corpus à rebâtir.
  }, [enabled, ongletVisible, enquetesByContentieux, instructions, contentieuxJA, docVersion]);

  // ── Tri selon les gestes de l'utilisateur ─────────────────────────────
  // Jamais traité, ou un dossier de PLUS depuis le geste : c'est neuf. Un
  // dossier qui s'en va ne réveille rien (cf. utils/recoupements/gestes.ts).
  const estNouveau = useCallback(
    (signal: Recoupement) => signalEstNouveau(acks, signal),
    [acks],
  );

  const estRevenu = useCallback(
    (signal: Recoupement) => estRevenuApresEcart(acks, signal),
    [acks],
  );

  const { signaux, nouveaux, ecartes } = useMemo(() => {
    const { retenus, nouveaux: neufs, ecartes: rejetes } = trierSelonGestes(signauxBruts, acks);
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
    estRevenu,
    marquerVu,
    marquerVus,
    ecarter,
    reactiver,
  }), [
    signaux, nouveaux, parDossier, nouveauxParDossier, ecartes, computing, docScan,
    analyserPieces, estNouveau, estRevenu, marquerVu, marquerVus, ecarter, reactiver,
  ]);
}
