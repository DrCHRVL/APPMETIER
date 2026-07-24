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
 */

import { AUTRE_ACTE_TYPES, AutreActeTypeKey } from '@/config/acteTypes';
import { DateUtils } from '@/utils/dateUtils';
import { ActeMeta, ActeStatus, AutreActe, EcouteData, GeolocData } from '@/types/interfaces';

/** Normalisation robuste : sans accents, minuscules, séparateurs → espaces. */
function norm(s: string): string {
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
 *    catégorie d'« autre » acte, pas une écoute ;
 *  - une prolongation ne crée jamais de rubrique : l'écoute/géoloc prolongée
 *    existe déjà dans l'enquête, il ne faut pas la dupliquer.
 */
export function inferActeKind(titre?: string): 'ecoute' | 'geolocalisation' | null {
  const t = norm(titre || '');
  if (!t) return null;
  if (t.includes('prolongation')) return null;
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
const NON_ACTE_PRODUCTION_TYPES = new Set(['note', 'livrable']);

export interface BuiltActe {
  /** Collection de l'enquête à mettre à jour. */
  collection: 'actes' | 'geolocalisations' | 'ecoutes';
  acte: AutreActe | GeolocData | EcouteData;
}

/**
 * Construit l'acte à créer dans l'enquête depuis une production validée.
 * Renvoie null si la production ne correspond à aucun acte (note, livrable).
 */
export function buildProductionActe(params: {
  prodId: string;
  type: string;
  titre: string;
  meta?: ActeMeta;
  /** Objet porté par la production elle-même (n° de ligne interceptée, objet
   *  géolocalisé — cf. produire_document) : secours quand ActeMeta est absent. */
  objet?: string;
}): BuiltActe | null {
  if (NON_ACTE_PRODUCTION_TYPES.has(params.type)) return null;

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
