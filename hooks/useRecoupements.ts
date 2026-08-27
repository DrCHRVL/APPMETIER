// hooks/useRecoupements.ts
//
// RECOUPEMENTS ENTRE DOSSIERS — côté application : LECTURE SEULE.
//
// L'application ne calcule plus aucun rapprochement. Elle l'a fait un temps,
// dans l'onglet du magistrat, et c'était une erreur de principe : comparer deux
// cents dossiers et leurs pièces demande de tout tenir en mémoire, et un
// navigateur ne le peut pas. Il fallait donc brider le calcul — pièces
// tronquées, pièces abandonnées au-delà d'un budget, huit extractions par
// session — de sorte que la détection était à la fois INCOMPLÈTE et
// responsable des gels de l'interface.
//
// Le calcul appartient désormais au SERVICE ATTACHÉ, seul composant qui
// détienne les clés (le serveur web, lui, ne voit que des enveloppes
// chiffrées). Il tourne sur le fonds ENTIER, une fois par semaine dans la nuit
// du samedi au dimanche, et à la demande. Ce hook ne fait plus que :
//   · lire le coffre `recoupements` qu'il dépose ;
//   · retrancher ce que cet utilisateur n'a pas le droit de voir ;
//   · tenir les gestes du magistrat (signal vu, signal écarté).
//
// Coût pour l'interface : une lecture de coffre. Rien d'autre, jamais.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Enquete } from '@/types/interfaces';
import type { Recoupement, RecoupementAcks, RecoupementsSyncFile } from '@/types/recoupementTypes';
import { enqueteKey } from '@/utils/recoupements/corpus';
import {
  ackPour,
  estNouveau as signalEstNouveau,
  estRevenuApresEcart,
  fusionnerAcks,
  patchVus,
  trierSelonGestes,
} from '@/utils/recoupements/gestes';
import { userPreferencesSyncService } from '@/utils/dataSync/UserPreferencesSyncService';
import { activiteNote } from '@/lib/monitor/clientMonitor';

/** Ce que le dernier chantier du serveur a produit — et ce qu'il n'a pas pu lire. */
export interface RecoupementsChantier {
  calculeAt: string;
  dureeMs: number;
  perimetre: RecoupementsSyncFile['perimetre'];
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
  /** Première lecture du coffre en cours. */
  chargement: boolean;
  /** Le dernier chantier du serveur. `null` : aucun n'a encore tourné. */
  chantier: RecoupementsChantier | null;
  /** Un chantier lancé depuis cette fenêtre tourne en ce moment. */
  detectionEnCours: boolean;
  /** Relance le chantier sur le serveur (administrateur du TJ confié). */
  lancerDetection: () => Promise<{ ok: boolean; error?: string }>;
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
  /** Sert UNIQUEMENT à retrancher les dossiers dissimulés aux JA (cf. plus bas). */
  enquetesByContentieux: Map<string, Enquete[]>;
  /** Coupe la lecture (profil épuré, module désactivé). */
  enabled?: boolean;
  /** Contentieux où l'utilisateur est juriste assistant. */
  contentieuxJA?: Set<string>;
}

const VIDE: Recoupement[] = [];

export function useRecoupements({
  enquetesByContentieux,
  enabled = true,
  contentieuxJA,
}: UseRecoupementsOptions): RecoupementsApi {
  const [fichier, setFichier] = useState<RecoupementsSyncFile | null>(null);
  const [chargement, setChargement] = useState(true);
  const [detectionEnCours, setDetectionEnCours] = useState(false);
  const [acks, setAcks] = useState<RecoupementAcks>({});

  // ── Lecture du coffre déposé par le service attaché ───────────────────
  const lire = useCallback(async () => {
    if (!enabled) { setFichier(null); setChargement(false); return; }
    const debut = Date.now();
    try {
      const pull = window.siralBridge?.globalSync_pullRecoupements;
      if (!pull) { setFichier(null); return; }
      const payload = await pull();
      setFichier(payload || null);
      if (payload) {
        activiteNote(
          'Lecture des recoupements',
          'sync',
          Date.now() - debut,
          `${payload.signaux?.length || 0} signal(aux) · chantier du ${new Date(payload.calculeAt).toLocaleDateString('fr-FR')}`,
        );
      }
    } catch {
      /* coffre indisponible : on garde ce qu'on avait, sans rien inventer */
    } finally {
      setChargement(false);
    }
  }, [enabled]);

  useEffect(() => {
    void lire();
    // Une synchronisation vient de passer : le chantier de la nuit a pu déposer
    // son coffre depuis la dernière lecture.
    const onSync = () => { void lire(); };
    window.addEventListener('global-sync-completed', onSync);
    return () => window.removeEventListener('global-sync-completed', onSync);
  }, [lire]);

  /**
   * Déclenchement manuel. La route est réservée à l'administrateur du TJ
   * confié — pour tout autre utilisateur elle répond 404, comme une route
   * inexistante : l'existence même de l'attaché ne doit rien laisser paraître.
   */
  const lancerDetection = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (detectionEnCours) return { ok: false, error: 'Un chantier est déjà en cours.' };
    setDetectionEnCours(true);
    const debut = Date.now();
    try {
      const res = await fetch('/api/attache/recoupements', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const erreur = String(data.error || (res.status === 404
          ? 'Détection sur serveur indisponible (service attaché non configuré).'
          : `Erreur ${res.status}`));
        activiteNote('Chantier de recoupements', 'veille', Date.now() - debut, erreur);
        return { ok: false, error: erreur };
      }
      activiteNote('Chantier de recoupements', 'veille', Date.now() - debut, 'terminé');
      await lire();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      setDetectionEnCours(false);
    }
  }, [detectionEnCours, lire]);

  // ── Ce que cet utilisateur n'a pas le droit de voir ───────────────────
  //
  // Le chantier tourne sur le fonds entier : il ignore qui lira ses signaux.
  // Un dossier dissimulé aux juristes assistants est donc retranché ICI, à
  // l'affichage — exactement comme il l'était du temps où le corpus se
  // construisait dans le navigateur (la donnée y était déjà ; seule la
  // construction du corpus l'écartait). Un signal qui ne touche QUE des
  // dossiers interdits disparaît ; s'il en touche d'autres, il reste, amputé
  // de ceux-là.
  const clesInterdites = useMemo(() => {
    const out = new Set<string>();
    if (!contentieuxJA?.size || !enquetesByContentieux) return out;
    enquetesByContentieux.forEach((liste, ctx) => {
      if (!contentieuxJA.has(ctx)) return;
      for (const enquete of liste || []) {
        if (enquete?.hiddenFromJA) out.add(enqueteKey(ctx, enquete.id));
      }
    });
    return out;
  }, [enquetesByContentieux, contentieuxJA]);

  const signauxBruts = useMemo<Recoupement[]>(() => {
    const bruts = fichier?.signaux || VIDE;
    if (clesInterdites.size === 0) return bruts;
    const out: Recoupement[] = [];
    for (const signal of bruts) {
      const dossierKeys = signal.dossierKeys.filter(k => !clesInterdites.has(k));
      if (dossierKeys.length < 2) continue; // un recoupement demande deux dossiers
      if (dossierKeys.length === signal.dossierKeys.length) { out.push(signal); continue; }
      out.push({
        ...signal,
        dossierKeys,
        stateKey: dossierKeys.join('|'),
        occurrences: signal.occurrences.filter(o => !clesInterdites.has(o.dossier.key)),
        pairesInedites: signal.pairesInedites.filter(([a, b]) => !clesInterdites.has(a) && !clesInterdites.has(b)),
      });
    }
    return out;
  }, [fichier, clesInterdites]);

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
   * connecté n'est pas toujours résolu et les préférences reviennent vides. Le
   * tri tournait alors sur une table de gestes vide — tout paraissait neuf, et
   * la première écriture écrasait les écartements de la veille. On rejoue donc
   * la lecture à chaque synchronisation de préférences.
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
      /* préférences indisponibles : les gestes restent muets */
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

  const chantier = useMemo<RecoupementsChantier | null>(
    () => (fichier
      ? { calculeAt: fichier.calculeAt, dureeMs: fichier.dureeMs, perimetre: fichier.perimetre }
      : null),
    [fichier],
  );

  // Identité stable : la fiche de dossier est mémoïsée sur cet objet.
  return useMemo(() => ({
    signaux,
    nouveaux,
    parDossier,
    nouveauxParDossier,
    ecartes,
    chargement,
    chantier,
    detectionEnCours,
    lancerDetection,
    estNouveau,
    estRevenu,
    marquerVu,
    marquerVus,
    ecarter,
    reactiver,
  }), [
    signaux, nouveaux, parDossier, nouveauxParDossier, ecartes, chargement, chantier,
    detectionEnCours, lancerDetection, estNouveau, estRevenu, marquerVu, marquerVus, ecarter, reactiver,
  ]);
}
