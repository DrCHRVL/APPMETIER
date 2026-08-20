/**
 * SIRAL — aiguillage des papeteries : règles apprises et décision d'export.
 *
 * Porte ce que le cœur (`papeterieRoutageCore.mjs`) ne peut pas porter : la
 * persistance des règles (même canal chiffré que les autres réglages) et
 * l'appel au service Attaché quand — et seulement quand — le doute subsiste.
 *
 * Le parcours d'un export Word tient en trois temps :
 *
 *   1. `preparerExport()` décide SANS RIEN DÉPENSER : règle déjà retenue par
 *      le magistrat, sinon règle apprise, sinon concordance évidente. Il dit
 *      aussi si le découpage heuristique de l'acte est douteux.
 *   2. `affinerParIA()` n'est appelé que dans le doute. Le modèle choisit une
 *      papeterie parmi celles enregistrées et rend des NUMÉROS DE LIGNE pour
 *      le découpage — il ne réécrit pas l'acte.
 *   3. `retenirRegle()` grave la décision. Prise par le magistrat, elle prime
 *      définitivement sur l'IA pour ce type d'acte : l'aiguillage se resserre
 *      à l'usage, sans jamais redemander deux fois la même chose.
 *
 * Hors ligne ou service Attaché arrêté : rien ne casse — on retombe sur le
 * découpage heuristique et sur la papeterie du type déduit, exactement comme
 * avant. L'IA est un renfort, jamais un passage obligé.
 */

import { SiralBridge } from '@/utils/siralBridge';
import { APP_CONFIG } from '@/config/constants';
import type { TrameForme, TrameFormeType } from './trameFill';
import {
  choisirLocalement,
  cleRegle,
  decoupageDouteux,
  libelleCle,
  lignesPourIA,
  normCle,
  validerDecoupage,
  appliquerDecoupage,
} from './papeterieRoutageCore.mjs';

const KEY = APP_CONFIG.STORAGE_KEYS.PAPETERIE_ROUTAGE;

/** Qui a décidé : le magistrat fait autorité, l'IA propose, `auto` déduit. */
export type OrigineChoix = 'magistrat' | 'ia' | 'auto' | 'aucune';

export interface RegleRoutage {
  /** Clé d'acte visée (« source:enq-art-76 », « type:requisition »…). */
  cle: string;
  /** Papeterie à appliquer. */
  trameId: string;
  origine: 'magistrat' | 'ia';
  /** Motif lisible, affiché au magistrat pour qu'il puisse contester la règle. */
  motif?: string;
  /** Nombre d'exports passés par cette règle (tri du panneau). */
  hits: number;
  updatedAt: string;
}

/** Découpage d'un acte en régions, tel qu'appliqué au texte d'origine. */
export interface DecoupageActe {
  titre: string;
  article: string;
  corps: string;
  signature: string;
  objet: string;
  date: string;
  destinataire: string;
}

export interface DecisionPapeterie {
  /** Papeterie retenue (null : aucune enregistrée → gabarit intégré). */
  trame: TrameForme | null;
  /** Vrai si la décision peut partir au téléchargement sans confirmation. */
  certain: boolean;
  origine: OrigineChoix;
  motif: string;
  /** Clé sur laquelle une règle serait écrite si le magistrat confirme. */
  cle?: string;
  /** Bibliothèque, pour le sélecteur de la fenêtre de confirmation. */
  papeteries: TrameForme[];
  /** Pourquoi le découpage heuristique inspire le doute (vide = il tient). */
  doutes: string[];
  /** Découpage rendu par l'IA, déjà appliqué au texte d'origine. */
  decoupage?: DecoupageActe;
  /** Renseigné quand l'IA n'a pas pu répondre (service arrêté, hors ligne…). */
  iaIndisponible?: string;
}

/** Acte soumis à l'aiguillage (sous-ensemble d'`ActeExportable`). */
export interface ActeAAiguiller {
  titre?: string;
  contenu: string;
  source?: string;
  type?: string;
}

// ── Règles persistées ────────────────────────────────────────────────────────

export async function loadRegles(): Promise<RegleRoutage[]> {
  try {
    const list = await SiralBridge.getData<RegleRoutage[]>(KEY, []);
    return Array.isArray(list) ? list.filter((r) => r && r.cle && r.trameId) : [];
  } catch {
    return [];
  }
}

export async function saveRegles(list: RegleRoutage[]): Promise<void> {
  // Comme les trames de forme : la garde anti-érosion refuse d'écrire un
  // tableau vide — vider la table passe donc par clearData.
  if (!list.length) {
    await SiralBridge.clearData(KEY);
    return;
  }
  await SiralBridge.setData(KEY, list.slice(0, 400));
}

/**
 * Grave la décision sur la clé la PLUS SPÉCIFIQUE dont dispose l'acte (sa
 * trame métier, à défaut son titre, à défaut son type). Une règle du magistrat
 * remplace celle de l'IA ; l'inverse n'est jamais vrai.
 */
export async function retenirRegle(
  acte: ActeAAiguiller,
  trameId: string,
  origine: 'magistrat' | 'ia',
  motif?: string,
): Promise<RegleRoutage | null> {
  const cle = cleRegle(acte) as string;
  if (!cle || !trameId) return null;
  const list = await loadRegles();
  const existante = list.find((r) => r.cle === cle);
  if (existante && existante.origine === 'magistrat' && origine === 'ia') {
    // L'IA n'écrase jamais un choix explicite : on se contente de le rejouer.
    return existante;
  }
  const regle: RegleRoutage = {
    cle,
    trameId,
    origine,
    motif,
    hits: (existante?.trameId === trameId ? existante.hits || 0 : 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  await saveRegles([...list.filter((r) => r.cle !== cle), regle]);
  return regle;
}

/** Oublie une règle : le prochain acte du même type repassera par la question. */
export async function oublierRegle(cle: string): Promise<void> {
  const list = await loadRegles();
  await saveRegles(list.filter((r) => r.cle !== cle));
}

/** Libellé lisible d'une clé de règle (panneau d'administration). */
export const libelleRegle = (cle: string): string => libelleCle(cle);

// ── Décision locale ──────────────────────────────────────────────────────────

/**
 * Décide sans dépenser un jeton, et signale les doutes sur le découpage.
 * `structure` est ce que le découpage heuristique a su isoler : c'est lui qui
 * dit s'il faut ou non déranger le modèle.
 */
export async function preparerExport(
  acte: ActeAAiguiller,
  typeDeduit: TrameFormeType,
  structure: Partial<DecoupageActe>,
  estCourrier: boolean,
): Promise<DecisionPapeterie> {
  const { loadTramesForme, pickTrameForme } = await import('./tramesFormeStore');
  const papeteries = await loadTramesForme();
  const doutes = decoupageDouteux(structure, { courrier: estCourrier }) as string[];

  if (!papeteries.length) {
    return { trame: null, certain: true, origine: 'aucune', motif: 'aucune papeterie enregistrée', papeteries, doutes: [] };
  }

  // Ménage : une règle qui vise une papeterie supprimée ne se rejouera jamais.
  // L'export est le bon moment pour s'en débarrasser — c'est là qu'on a les deux
  // listes sous la main.
  const toutes = await loadRegles();
  const regles = toutes.filter((r) => papeteries.some((p) => p.id === r.trameId));
  if (regles.length !== toutes.length) await saveRegles(regles);

  const local = choisirLocalement({ papeteries, regles, acte, typeDeduit }) as
    { trameId: string; origine: OrigineChoix; certain: boolean; motif: string; cle?: string } | null;

  if (local) {
    const trame = papeteries.find((p) => p.id === local.trameId) || null;
    return {
      trame,
      certain: local.certain,
      origine: local.origine,
      motif: local.motif,
      cle: local.cle || (cleRegle(acte) as string),
      papeteries,
      doutes,
    };
  }

  // Rien de tranché : on propose le repli historique (papeterie du type
  // déduit), mais sans le donner pour sûr — c'est là que l'IA vaut le détour.
  return {
    trame: pickTrameForme(papeteries, typeDeduit),
    certain: false,
    origine: 'auto',
    motif: 'déduit du titre de l\'acte, sans certitude',
    cle: cleRegle(acte) as string,
    papeteries,
    doutes,
  };
}

// ── Renfort du modèle ────────────────────────────────────────────────────────

interface ReponseIA {
  ok?: boolean;
  papeterieId?: string;
  motif?: string;
  decoupage?: Record<string, unknown>;
  error?: string;
}

/**
 * Demande au service Attaché de trancher : quelle papeterie, et où sont les
 * frontières de l'acte. N'envoie que les EXTRÉMITÉS numérotées du texte (les
 * frontières y sont ; le ventre de l'acte est du corps par construction) et ne
 * reçoit que des numéros de ligne — le texte remis reste celui du magistrat.
 *
 * Ne lève jamais : une panne, un service arrêté ou un mode hors ligne rendent
 * la décision inchangée, avec `iaIndisponible` renseigné pour l'affichage.
 */
export async function affinerParIA(
  acte: ActeAAiguiller,
  decision: DecisionPapeterie,
  signal?: AbortSignal,
): Promise<DecisionPapeterie> {
  const extrait = lignesPourIA(acte.contenu) as { lignes: { n: number; t: string }[]; total: number; tronque: boolean };
  try {
    const res = await fetch('/api/attache/papeterie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        acte: { titre: acte.titre || '', source: acte.source || '', type: acte.type || '' },
        lignes: extrait.lignes,
        total: extrait.total,
        tronque: extrait.tronque,
        papeteries: decision.papeteries.map((p) => ({ id: p.id, nom: p.nom, type: p.type, usage: p.usage || '' })),
        regles: await reglesLisibles(decision.papeteries),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as ReponseIA;
    if (!res.ok || data.ok === false) {
      return { ...decision, iaIndisponible: data.error || `service indisponible (${res.status})` };
    }

    const trame = decision.papeteries.find((p) => p.id === data.papeterieId) || decision.trame;
    // Découpage : validé (bornes cohérentes) puis appliqué au texte D'ORIGINE.
    const valide = validerDecoupage(data.decoupage, extrait.total);
    const decoupage = valide
      ? (appliquerDecoupage(acte.contenu, valide) as DecoupageActe)
      : decision.decoupage;
    return {
      ...decision,
      trame,
      origine: 'ia',
      motif: data.motif ? String(data.motif).slice(0, 200) : decision.motif,
      decoupage,
    };
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'appel interrompu' : 'service Attaché injoignable';
    return { ...decision, iaIndisponible: msg };
  }
}

/**
 * Règles déjà retenues, rendues lisibles pour le modèle : ce sont les habitudes
 * du magistrat, et le meilleur guide dont dispose l'IA pour un acte inédit.
 */
async function reglesLisibles(papeteries: TrameForme[]): Promise<string[]> {
  const regles = await loadRegles();
  const nom = new Map(papeteries.map((p) => [p.id, p.nom]));
  return regles
    .filter((r) => nom.has(r.trameId))
    .sort((a, b) => (b.hits || 0) - (a.hits || 0))
    .slice(0, 40)
    .map((r) => `${libelleCle(r.cle)} → papeterie « ${nom.get(r.trameId)} »`);
}

// ── Apprentissage ────────────────────────────────────────────────────────────

/**
 * Consigne au journal d'apprentissage de l'attaché que le magistrat a CHANGÉ
 * la papeterie proposée. Signal faible mais net : répété, il apprend à
 * l'attaché quel habillage va avec quel type d'acte. Best-effort — un journal
 * injoignable ne doit jamais empêcher un téléchargement.
 */
export async function signalerCorrection(
  acte: ActeAAiguiller,
  propose: TrameForme | null,
  retenu: TrameForme,
): Promise<void> {
  try {
    await fetch('/api/attache/papeterie', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'signal',
        source: acte.source || '',
        titre: (acte.titre || '').slice(0, 80),
        propose: propose?.nom || '(aucune)',
        retenu: retenu.nom,
      }),
    });
  } catch { /* la capture ne doit jamais gêner l'export */ }
}

/** Clé sur laquelle une règle serait gravée pour cet acte (affichage). */
export const cleActe = (acte: ActeAAiguiller): string => (cleRegle(acte) as string) || '';

/** Forme comparable d'un libellé (réexport, pour les composants). */
export const normaliser = (s: string): string => normCle(s) as string;
