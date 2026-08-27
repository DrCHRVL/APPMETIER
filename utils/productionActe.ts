/**
 * Construction d'un acte d'enquête à partir d'une PRODUCTION validée
 * (acte rédigé par l'attaché de justice).
 *
 * Objectif : quand le magistrat VALIDE un acte rédigé, créer dans l'enquête un
 * acte STRICTEMENT IDENTIQUE à une saisie manuelle (fenêtre « Ajouter un acte »).
 * On réutilise donc la même logique de dérivation que :
 *   - components/modals/ActeModal.tsx (statut dérivé du type légal),
 *   - scripts/attache/dossier.mjs → enregistrerActe (rubrique écoute/géoloc/autre),
 *   - scripts/attache/acteTypes.mjs → deriveAutreActeFields / resolveAutreActeTypeKey.
 *
 * La nature exacte de l'acte (rubrique, catégorie, dates, durée, cible/objet)
 * est portée par les métadonnées `ActeMeta` que l'attaché attache à la
 * rédaction (cf. produire_document). À défaut de métadonnées (productions
 * anciennes, oubli de l'agent), la RUBRIQUE est inférée du titre — une
 * « Requête d'interception de correspondances téléphoniques » est une écoute
 * (rubrique Écoutes), pas un acte libre dans « Autres actes » — puis on tente
 * une résolution de catégorie, sinon acte libre.
 *
 * TROIS RÈGLES DE COHÉRENCE, appliquées par `planProductionActe` AVANT toute
 * création (une validation ne doit jamais fabriquer un acte de plus) :
 *
 *  1. PROLONGATION : une requête de prolongation ne crée RIEN. La mesure
 *     prolongée existe déjà dans l'enquête — la validation la fait entrer dans
 *     le chemin de prolongation DÉJÀ EN PLACE : statut « prolongation en
 *     attente JLD » (colonne « Prolongations » de l'encart Attente JLD), puis
 *     validation par la fenêtre « Validation de la prolongation » qui étend la
 *     date de fin et historise. Exactement ce que fait le bouton « Demander la
 *     prolongation » du détail d'enquête, et l'outil `acter_prolongation`
 *     (mode « demande ») côté attaché. Aucun acte cible retrouvé → on ne crée
 *     rien et on le DIT au magistrat.
 *  2. DOUBLON : si la mesure est déjà suivie dans l'enquête (même rubrique,
 *     même ligne interceptée / objet géolocalisé / catégorie, acte encore
 *     vivant), la validation ne crée pas un second acte — que l'acte vienne
 *     d'une saisie manuelle, de `enregistrer_acte` ou d'une proposition ✓.
 *  3. ÉCRIT SANS MESURE : une fiche d'analyse, une réponse à DML, un projet de
 *     réponse ne sont pas des mesures à suivre avec échéance — ils ne créent
 *     un acte que si l'attaché a explicitement décrit une structure d'acte.
 */

import { AUTRE_ACTE_TYPES, AutreActeTypeKey } from '@/config/acteTypes';
import { DateUtils } from '@/utils/dateUtils';
import { ActeMeta, ActeStatus, AutreActe, EcouteData, GeolocData } from '@/types/interfaces';

/** Normalisation robuste : sans accents, minuscules, séparateurs → espaces. */
function norm(s?: string): string {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Fait correspondre un `type`/libellé LIBRE à l'une des 12 clés de catégorie.
 * Port fidèle de `resolveAutreActeTypeKey` (scripts/attache/acteTypes.mjs).
 * Conservateur : ne renvoie une clé que sur correspondance fiable, sinon null.
 */
export function resolveAutreActeTypeKey(input?: string): AutreActeTypeKey | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if ((AUTRE_ACTE_TYPES as Record<string, unknown>)[raw]) return raw as AutreActeTypeKey;
  const t = norm(raw);
  if (!t) return null;
  const key = t.replace(/ /g, '_');
  if ((AUTRE_ACTE_TYPES as Record<string, unknown>)[key]) return key as AutreActeTypeKey;

  for (const k of Object.keys(AUTRE_ACTE_TYPES) as AutreActeTypeKey[]) {
    if (norm(AUTRE_ACTE_TYPES[k].label) === t) return k;
  }

  const tokens = t.split(' ');
  const has = (w: string) => t.includes(w);
  const hasTok = (w: string) => tokens.includes(w);

  if (has('infiltration') || has('706 81')) return 'infiltration';
  if (has('key logger') || has('keylogger') ||
      (has('captation') && has('donnees') && has('informatique')) ||
      (has('donnees') && has('informatique'))) return 'captation_donnees_informatiques';
  if (has('imsi') || has('706 95 4')) {
    return (has('interception') || has('communication')) ? 'imsi_interceptions' : 'imsi_donnees';
  }
  if (has('drone') || has('aeronef')) return has('prive') ? 'drone_prive' : 'drone_public';
  if (has('activation') || has('706 102 1')) {
    if (has('mobile')) return 'activation_mobile';
    if (has('fixe')) return 'activation_fixe';
    return null;
  }
  if (has('sonorisation') && !has('captation')) return 'sonorisation_prive';
  if (has('captation') && (has('image') || has('sonorisation'))) {
    return has('public') ? 'captation_images_public' : 'captation_images_prive';
  }
  if (has('procedure preliminaire') || (hasTok('76') && !has('706') && !hasTok('706'))) return 'art76';
  return null;
}

/**
 * Infère la RUBRIQUE (écoutes / géolocalisations) d'un acte depuis son titre
 * libre, quand l'attaché n'a pas fourni de métadonnées. Conservateur : ne
 * renvoie une rubrique que sur correspondance fiable, sinon null.
 *  - IMSI-catcher (« interceptions » 706-95-4) reste hors rubrique : c'est une
 *    catégorie d'« autre » acte, pas une écoute.
 * Le titre d'une PROLONGATION est lu comme celui de la mesure prolongée : la
 * rubrique sert alors à retrouver l'acte existant, jamais à en créer un
 * (cf. `planProductionActe`).
 */
export function inferActeKind(titre?: string): 'ecoute' | 'geolocalisation' | null {
  const t = norm(titre || '');
  if (!t) return null;
  if (t.includes('imsi') || t.includes('706 95 4')) return null;
  if (t.includes('ecoute') || t.includes('706 95') ||
      (t.includes('interception') &&
        ['telephon', 'correspondance', 'communication', 'ligne'].some((w) => t.includes(w)))) {
    return 'ecoute';
  }
  if (t.includes('geolocalisation') || t.includes('geoloc') || t.includes('balise') ||
      t.includes('230 32') || t.includes('230 33')) {
    return 'geolocalisation';
  }
  return null;
}

/**
 * Un titre en « Requête… / Demande… / Saisine… » désigne une mesure encore
 * soumise à l'autorisation du juge : validée, la production reste une demande —
 * l'acte doit naître « en attente JLD » (pour les mesures effectivement
 * soumises au JLD), pas « en cours » daté du jour.
 */
function isRequeteTitle(titre?: string): boolean {
  return /^(requete|demande|saisine)\b/.test(norm(titre || ''));
}

interface DerivedFields {
  statut: ActeStatus;
  dateDebut: string;
  dateFin: string;
  duree: string;
  dureeUnit: 'jours' | 'mois';
  maxProlongations: number;
  datePose: string;
}

/**
 * Dérive les champs d'un « autre » acte depuis sa catégorie légale, en
 * reproduisant components/modals/ActeModal.tsx (et deriveAutreActeFields côté
 * service) :
 *  - art. 76 (sans durée) → « en_cours » ;
 *  - mesure JLD en attente → « autorisation_pending » ;
 *  - mesure autorisée avec durée → « pose_pending » + date de fin calculée.
 */
function deriveAutreActeFields(
  key: AutreActeTypeKey,
  opts: { dateDebut?: string; duree?: number | string; pendingJld?: boolean },
): DerivedFields {
  const cfg = AUTRE_ACTE_TYPES[key];
  const dureeUnit: 'jours' | 'mois' = cfg.dureeUnit === 'mois' ? 'mois' : 'jours';
  const effectiveDuree = cfg.duree !== undefined ? String(cfg.duree) : String(opts.duree ?? '');
  const maxProlongations = cfg.maxProlongations;

  // L'attente JLD se teste EN PREMIER : un art. 76 (sans durée propre) demandé
  // au JLD naît « autorisation_pending » comme dans la fenêtre « Ajouter un
  // acte » et dans le miroir serveur (scripts/attache/acteTypes.mjs). L'ancien
  // ordre courtcircuitait le JLD pour toute catégorie sans durée : une requête
  // art. 76 validée devenait « en_cours »… sans date de début.
  const pendingJld = opts.pendingJld === true && cfg.autorisation === 'JLD';
  if (pendingJld) {
    return { statut: 'autorisation_pending', dateDebut: '', dateFin: '', duree: effectiveDuree || '0', dureeUnit, maxProlongations, datePose: '' };
  }
  if (!cfg.hasDuree) {
    // Art. 76 déjà autorisé : pas de durée propre ni de pose — directement en
    // cours, daté (même comportement que la saisie manuelle et le serveur).
    const dateDebut = opts.dateDebut || new Date().toISOString().slice(0, 10);
    return { statut: 'en_cours', dateDebut, dateFin: '', duree: '', dureeUnit, maxProlongations, datePose: '' };
  }
  const dateDebut = opts.dateDebut || new Date().toISOString().slice(0, 10);
  const dateFin = effectiveDuree && dateDebut
    ? DateUtils.calculateEndDateWithUnit(dateDebut, effectiveDuree, dureeUnit)
    : '';
  return { statut: 'pose_pending', dateDebut, dateFin, duree: effectiveDuree || '0', dureeUnit, maxProlongations, datePose: '' };
}

/** Libellé lisible d'un acte libre (hors catégorie), depuis le type de production. */
const PRODUCTION_TYPE_LABEL: Record<string, string> = {
  requisition: 'Réquisition',
  prolongation_jld: 'Prolongation JLD',
  saisine_jld: 'Saisine JLD',
  soit_transmis: 'Soit-transmis',
  reponse_dml: 'Réponse DML',
  projet_reponse: 'Projet de réponse',
  autre: 'Acte',
};

/** Types de production qui ne correspondent à AUCUN acte de procédure. */
const NON_ACTE_PRODUCTION_TYPES = new Set(['note', 'livrable', 'presentation', 'fiche']);

/**
 * Types de production qui ne sont pas, par eux-mêmes, une mesure à suivre :
 * une réponse à demande de mise en liberté ou un projet de réponse est un
 * ÉCRIT, pas un acte d'enquête avec cible, durée et échéance. Ils ne créent un
 * acte que si l'attaché a explicitement décrit une structure d'acte
 * (`acteMeta.kind` ou `acteMeta.categorie`) — sinon la validation les laisse
 * où ils sont, dans « Actes rédigés ».
 */
const ECRIT_SANS_MESURE_TYPES = new Set(['reponse_dml', 'projet_reponse']);

/** Une production est-elle une PROLONGATION de mesure existante ? */
export function isProlongation(type?: string, titre?: string, categorie?: string): boolean {
  if (String(type || '') === 'prolongation_jld') return true;
  return norm(titre).includes('prolongation') || norm(categorie).includes('prolongation');
}

/** Collection d'actes d'une enquête. */
export type ActeCollection = 'actes' | 'geolocalisations' | 'ecoutes';

export interface BuiltActe {
  /** Collection de l'enquête à mettre à jour. */
  collection: ActeCollection;
  acte: AutreActe | GeolocData | EcouteData;
}

/** La production validée, telle que la porte « Actes rédigés ». */
export interface ProductionRef {
  prodId: string;
  type: string;
  titre: string;
  meta?: ActeMeta;
  /** Objet porté par la production elle-même (n° de ligne interceptée, objet
   *  géolocalisé — cf. produire_document) : secours quand ActeMeta est absent. */
  objet?: string;
}

/**
 * Construit l'acte à créer dans l'enquête depuis une production validée.
 * Renvoie null si la production ne crée aucun acte (note, fiche, livrable,
 * écrit sans mesure, PROLONGATION). Passer par `planProductionActe` : c'est
 * lui qui tranche entre créer, prolonger l'acte existant et ne rien faire.
 */
export function buildProductionActe(params: ProductionRef): BuiltActe | null {
  if (NON_ACTE_PRODUCTION_TYPES.has(params.type)) return null;
  if (ECRIT_SANS_MESURE_TYPES.has(params.type) && !params.meta?.kind && !params.meta?.categorie) return null;
  // Garde-fou : une prolongation ne crée JAMAIS d'acte, elle prolonge celui qui
  // existe (planProductionActe). Rien ici ne doit pouvoir la dupliquer.
  if (isProlongation(params.type, params.titre, params.meta?.categorie)) return null;

  const meta = params.meta || {};
  // Rubrique : celle des métadonnées quand l'attaché l'a fournie ; sinon,
  // inférée du titre — sauf si une catégorie d'« autre » acte est indiquée.
  const kind = meta.kind || (!meta.categorie ? inferActeKind(params.titre) : null) || 'autre';
  const id = Date.now();
  const description = params.titre;
  // Cible/objet d'un acte de rubrique « autre » : le schéma AutreActe n'a pas
  // de champ dédié — on les conserve dans la description (sinon l'information
  // structurée fournie par l'attaché était silencieusement perdue).
  const cibleObjet = String(meta.cible || meta.objet || '').trim();
  const descriptionAutre = cibleObjet && !description.toLowerCase().includes(cibleObjet.toLowerCase())
    ? `${description} — ${meta.cible ? 'cible' : 'objet'} : ${cibleObjet}`
    : description;
  const debut = meta.dateDebut || new Date().toISOString().slice(0, 10);
  // Mesure encore devant le JLD : métadonnée explicite, sinon inférée — une
  // production « saisine JLD » ou titrée « Requête / Demande / Saisine … »
  // est une demande, pas l'autorisation elle-même.
  const requete = params.type === 'saisine_jld' || isRequeteTitle(params.titre);
  const pendingJld = meta.pendingJld ?? requete;

  if (kind === 'ecoute') {
    // Schéma de la saisie manuelle (EcouteModal / EcouteSection) : durée
    // légale FIXE d'1 mois + 1 prolongation max, autorisation JLD par défaut ;
    // la date de fin n'est calculée qu'à la pose.
    const pending = meta.pendingJld ?? (requete || !meta.dateDebut);
    const acte: EcouteData = {
      id,
      prodId: params.prodId,
      numero: String(meta.cible || meta.objet || params.objet || 'ligne à préciser'),
      cible: meta.cible ? String(meta.cible) : undefined,
      description,
      dateDebut: pending ? '' : debut,
      dateFin: '',
      duree: '1',
      dureeUnit: 'mois',
      maxProlongations: 1,
      statut: pending ? 'autorisation_pending' : 'pose_pending',
      ...(pending ? { autorisationRequestedAt: new Date().toISOString() } : {}),
      prolongationsHistory: [],
    };
    return { collection: 'ecoutes', acte };
  }

  if (kind === 'geolocalisation') {
    // Schéma de la saisie manuelle (GeolocModal / GeolocSection) : 15 jours
    // par défaut, pas de plafond de prolongations, date de fin à la pose.
    const geoDuree = Number(meta.duree);
    const acte: GeolocData = {
      id,
      prodId: params.prodId,
      objet: String(meta.objet || meta.cible || params.objet || 'objet à préciser'),
      description,
      dateDebut: pendingJld ? '' : debut,
      dateFin: '',
      duree: Number.isFinite(geoDuree) && geoDuree > 0 ? String(meta.duree) : '15',
      dureeUnit: meta.dureeUnit === 'mois' ? 'mois' : 'jours',
      statut: pendingJld ? 'autorisation_pending' : 'pose_pending',
      ...(pendingJld ? { autorisationRequestedAt: new Date().toISOString() } : {}),
      prolongationsHistory: [],
    };
    return { collection: 'geolocalisations', acte };
  }

  // « Autre » acte : catégorie légale (pré-remplie comme « Ajouter un acte »)…
  // deriveAutreActeFields n'applique l'attente JLD qu'aux catégories
  // effectivement soumises au JLD (autorisation procureur : flag ignoré).
  const key = resolveAutreActeTypeKey(meta.categorie || params.titre);
  if (key) {
    const f = deriveAutreActeFields(key, { dateDebut: debut, duree: meta.duree, pendingJld });
    const acte: AutreActe = {
      id,
      prodId: params.prodId,
      type: key,
      description: descriptionAutre,
      dateDebut: f.dateDebut,
      dateFin: f.dateFin,
      duree: f.duree,
      dureeUnit: f.dureeUnit,
      maxProlongations: f.maxProlongations,
      statut: f.statut,
      ...(f.statut === 'autorisation_pending' ? { autorisationRequestedAt: new Date().toISOString() } : {}),
      ...(f.datePose ? { datePose: f.datePose } : {}),
    };
    return { collection: 'actes', acte };
  }

  // …ou acte libre hors catégorie (ex. comparution forcée art. 78 CPP).
  // Sans catégorie, on ne sait pas si la mesure est soumise au JLD : l'attente
  // n'est retenue que sur indication explicite (métadonnée, ou saisine JLD).
  const dureeUnit: 'jours' | 'mois' = meta.dureeUnit === 'mois' ? 'mois' : 'jours';
  const dureeNum = Number(meta.duree);
  const hasDuree = Number.isFinite(dureeNum) && dureeNum > 0;
  const pending = meta.pendingJld ?? params.type === 'saisine_jld';
  const statut: ActeStatus = pending ? 'autorisation_pending' : (hasDuree ? 'pose_pending' : 'en_cours');
  const acte: AutreActe = {
    id,
    prodId: params.prodId,
    type: (meta.categorie && String(meta.categorie).trim())
      || PRODUCTION_TYPE_LABEL[params.type]
      || 'Acte',
    description: descriptionAutre,
    dateDebut: pending ? '' : debut,
    dateFin: (!pending && hasDuree) ? DateUtils.calculateEndDateWithUnit(debut, String(meta.duree), dureeUnit) : '',
    duree: meta.duree != null ? String(meta.duree) : '0',
    dureeUnit,
    statut,
    ...(pending ? { autorisationRequestedAt: new Date().toISOString() } : {}),
  };
  return { collection: 'actes', acte };
}

// ───────────────────────────────────────────────────────────────────────────
// Rapprochement avec les actes DÉJÀ SUIVIS dans l'enquête
// ───────────────────────────────────────────────────────────────────────────

/** Vue minimale d'un acte de l'enquête, toutes rubriques confondues. */
export interface ActeExistant {
  id: number;
  statut: ActeStatus;
  prodId?: string;
  prolongationRequest?: { prodId: string; prevStatut: ActeStatus };
  /** Écoute : ligne interceptée. */
  numero?: string;
  cible?: string;
  /** Géoloc : objet suivi. */
  objet?: string;
  /** Autre acte : clé de catégorie ou libellé libre. */
  type?: string;
  description?: string;
}

/** Les trois collections d'actes d'une enquête. */
export type ActesEnquete = Partial<Record<ActeCollection, ActeExistant[]>>;

const COLLECTIONS: ActeCollection[] = ['ecoutes', 'geolocalisations', 'actes'];

/** Rubrique portée par une collection. */
function kindOf(c: ActeCollection): 'ecoute' | 'geolocalisation' | 'autre' {
  return c === 'ecoutes' ? 'ecoute' : c === 'geolocalisations' ? 'geolocalisation' : 'autre';
}

/** Actes encore SUIVIS : un acte refusé par le JLD ou avorté ne fait doublon avec rien. */
const STATUTS_VIVANTS = new Set<ActeStatus>(['autorisation_pending', 'pose_pending', 'en_cours', 'prolongation_pending', 'a_renouveler']);

/** Actes PROLONGEABLES : la mesure a été autorisée (une demande d'autorisation
 *  encore pendante ne se prolonge pas — elle n'a pas commencé). Un acte échu
 *  reste prolongeable : l'app le permet, à charge d'antidater l'autorisation. */
const STATUTS_PROLONGEABLES = new Set<ActeStatus>(['en_cours', 'termine', 'a_renouveler', 'prolongation_pending']);

/** Suite de chiffres d'une chaîne (n° de ligne, plaque) — 6 chiffres au moins. */
function digitsOf(s?: string): string {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 6 ? d : '';
}

/**
 * Clé d'IDENTITÉ d'une mesure dans sa rubrique : ce qui fait que deux actes
 * désignent la même chose. Écoute → la ligne (comparée sur ses chiffres, pour
 * que « 07 64 45 45 16 » et « 0764454516 » se rejoignent) ; géoloc → l'objet
 * suivi ; autre acte → sa catégorie légale (ou son libellé). '' si inconnue.
 */
function acteIdentite(kind: 'ecoute' | 'geolocalisation' | 'autre', a: ActeExistant): string {
  if (kind === 'ecoute') return digitsOf(a.numero || a.cible) || norm(a.cible || a.numero);
  if (kind === 'geolocalisation') return digitsOf(a.objet) || norm(a.objet);
  return resolveAutreActeTypeKey(a.type) || norm(a.type);
}

/** Même clé d'identité, mais lue sur la PRODUCTION (métadonnées, objet, titre). */
function productionIdentite(kind: 'ecoute' | 'geolocalisation' | 'autre', p: ProductionRef): string {
  const meta = p.meta || {};
  if (kind === 'ecoute') {
    const brut = meta.cible || meta.objet || p.objet || '';
    return digitsOf(brut) || digitsOf(p.titre) || norm(brut);
  }
  if (kind === 'geolocalisation') {
    const brut = meta.objet || meta.cible || p.objet || '';
    return digitsOf(brut) || norm(brut);
  }
  return resolveAutreActeTypeKey(meta.categorie || p.titre) || norm(meta.categorie);
}

/** Rubrique visée par une production (métadonnées d'abord, titre ensuite). */
function rubriqueDe(p: ProductionRef): 'ecoute' | 'geolocalisation' | 'autre' {
  const meta = p.meta || {};
  return meta.kind || (!meta.categorie ? inferActeKind(p.titre) : null) || 'autre';
}

/** Libellé lisible d'un acte de l'enquête (pour le message rendu au magistrat). */
export function libelleActe(collection: ActeCollection, a: ActeExistant): string {
  if (collection === 'ecoutes') return `écoute ${a.numero || a.cible || ''}`.trim();
  if (collection === 'geolocalisations') return `géolocalisation ${a.objet || ''}`.trim();
  const key = resolveAutreActeTypeKey(a.type);
  return key ? AUTRE_ACTE_TYPES[key].label : (a.type || 'acte');
}

/** Premier acte de `actes` satisfaisant le prédicat, avec sa collection. */
function chercher(
  actes: ActesEnquete,
  pred: (c: ActeCollection, a: ActeExistant) => boolean,
): { collection: ActeCollection; acte: ActeExistant } | null {
  for (const c of COLLECTIONS) {
    const found = (actes[c] || []).find((a) => pred(c, a));
    if (found) return { collection: c, acte: found };
  }
  return null;
}

/**
 * Retrouve l'acte EXISTANT que prolonge une production de prolongation.
 *  1. l'id désigné par l'attaché (`acteMeta.acteId`) — le chemin sûr ;
 *  2. sinon, même rubrique + même identité (ligne, objet, catégorie) ;
 *  3. sinon, si la rubrique est certaine (écoute / géoloc) et qu'un SEUL acte
 *     prolongeable y figure, c'est celui-là — le cas courant d'un dossier qui
 *     ne suit qu'une ligne. Au-delà, on préfère ne rien faire.
 */
function chercherActeAProlonger(
  actes: ActesEnquete,
  p: ProductionRef,
): { collection: ActeCollection; acte: ActeExistant } | null {
  const acteId = p.meta?.acteId;
  if (acteId != null) {
    const parId = chercher(actes, (_c, a) => Number(a.id) === Number(acteId));
    if (parId) return parId;
  }
  const kind = rubriqueDe(p);
  const identite = productionIdentite(kind, p);
  if (identite) {
    const parIdentite = chercher(
      actes,
      (c, a) => kindOf(c) === kind && STATUTS_PROLONGEABLES.has(a.statut) && acteIdentite(kind, a) === identite,
    );
    if (parIdentite) return parIdentite;
  }
  if (kind === 'autre') return null;
  const collection: ActeCollection = kind === 'ecoute' ? 'ecoutes' : 'geolocalisations';
  const candidats = (actes[collection] || []).filter((a) => STATUTS_PROLONGEABLES.has(a.statut));
  return candidats.length === 1 ? { collection, acte: candidats[0] } : null;
}

/** Acte déjà suivi qui désigne la MÊME mesure que la production (anti-doublon). */
function chercherActeEquivalent(
  actes: ActesEnquete,
  p: ProductionRef,
  built: BuiltActe,
): { collection: ActeCollection; acte: ActeExistant } | null {
  const kind = kindOf(built.collection);
  const identite = productionIdentite(kind, p) || acteIdentite(kind, built.acte as ActeExistant);
  if (!identite) return null;
  const found = (actes[built.collection] || []).find(
    (a) => STATUTS_VIVANTS.has(a.statut) && acteIdentite(kind, a) === identite,
  );
  return found ? { collection: built.collection, acte: found } : null;
}

/**
 * Ce que la validation d'un acte rédigé doit faire dans l'enquête. Une seule
 * décision, prise ici, appliquée par le store (useEnquetesStore).
 *  - `creer`     : la mesure n'est pas encore suivie → acte créé, identique à
 *                  une saisie manuelle ;
 *  - `prolonger` : requête de prolongation → l'acte EXISTANT passe
 *                  « prolongation en attente JLD » (rien n'est créé) ;
 *  - `existant`  : la mesure est déjà suivie → on ne touche à rien ;
 *  - `aucun`     : la production ne porte aucune mesure, ou la mesure
 *                  prolongée est introuvable (le magistrat en est averti).
 */
export type ProductionActePlan =
  | { action: 'creer'; collection: ActeCollection; acte: AutreActe | GeolocData | EcouteData }
  | { action: 'prolonger'; collection: ActeCollection; acteId: number; libelle: string }
  | { action: 'existant'; collection: ActeCollection; acteId: number; libelle: string }
  | { action: 'aucun'; raison: 'deja_fait' | 'sans_mesure' | 'prolongation_orpheline' };

export function planProductionActe(p: ProductionRef, actes: ActesEnquete): ProductionActePlan {
  // Déjà appliqué (acte créé, ou prolongation demandée) : rien à refaire.
  const dejaFait = chercher(
    actes,
    (_c, a) => a.prodId === p.prodId || a.prolongationRequest?.prodId === p.prodId,
  );
  if (dejaFait) return { action: 'aucun', raison: 'deja_fait' };

  // PROLONGATION : jamais de création — on rejoint le chemin de prolongation.
  if (isProlongation(p.type, p.titre, p.meta?.categorie)) {
    const cible = chercherActeAProlonger(actes, p);
    if (!cible) return { action: 'aucun', raison: 'prolongation_orpheline' };
    return {
      action: 'prolonger',
      collection: cible.collection,
      acteId: cible.acte.id,
      libelle: libelleActe(cible.collection, cible.acte),
    };
  }

  const built = buildProductionActe(p);
  if (!built) return { action: 'aucun', raison: 'sans_mesure' };

  const equivalent = chercherActeEquivalent(actes, p, built);
  if (equivalent) {
    return {
      action: 'existant',
      collection: equivalent.collection,
      acteId: equivalent.acte.id,
      libelle: libelleActe(equivalent.collection, equivalent.acte),
    };
  }
  return { action: 'creer', collection: built.collection, acte: built.acte };
}
