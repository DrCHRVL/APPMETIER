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
 * ne peut PAS être devinée de façon fiable depuis le texte libre : elle est
 * portée par les métadonnées `ActeMeta` que l'attaché attache à la rédaction
 * (cf. produire_document). À défaut de métadonnées (productions anciennes), on
 * tente une résolution de catégorie depuis le titre, sinon acte libre.
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

  if (!cfg.hasDuree) {
    return { statut: 'en_cours', dateDebut: '', dateFin: '', duree: '', dureeUnit, maxProlongations, datePose: '' };
  }
  const pendingJld = opts.pendingJld === true && cfg.autorisation === 'JLD';
  if (pendingJld) {
    return { statut: 'autorisation_pending', dateDebut: '', dateFin: '', duree: effectiveDuree || '0', dureeUnit, maxProlongations, datePose: '' };
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
}): BuiltActe | null {
  if (NON_ACTE_PRODUCTION_TYPES.has(params.type)) return null;

  const meta = params.meta || {};
  const kind = meta.kind || 'autre';
  const id = Date.now();
  const description = params.titre;
  const dureeUnit: 'jours' | 'mois' = meta.dureeUnit === 'mois' ? 'mois' : 'jours';
  const debut = meta.dateDebut || new Date().toISOString().slice(0, 10);
  const dureeNum = Number(meta.duree);
  const hasDuree = Number.isFinite(dureeNum) && dureeNum > 0;
  const pendingJld = meta.pendingJld === true;

  // Socle commun aux rubriques écoute / géoloc / acte libre — mêmes règles de
  // statut que la saisie manuelle (en attente JLD / en attente de pose / en cours).
  const statut: ActeStatus = pendingJld ? 'autorisation_pending' : (hasDuree ? 'pose_pending' : 'en_cours');
  const base = {
    id,
    prodId: params.prodId,
    dateDebut: pendingJld ? '' : debut,
    dateFin: (!pendingJld && hasDuree) ? DateUtils.calculateEndDateWithUnit(debut, String(meta.duree), dureeUnit) : '',
    duree: meta.duree != null ? String(meta.duree) : '0',
    dureeUnit,
    statut,
    ...(pendingJld ? { autorisationRequestedAt: new Date().toISOString() } : {}),
  };

  if (kind === 'ecoute') {
    const acte: EcouteData = {
      ...base,
      numero: String(meta.cible || meta.objet || 'ligne à préciser'),
      cible: meta.cible ? String(meta.cible) : undefined,
      description,
    };
    return { collection: 'ecoutes', acte };
  }

  if (kind === 'geolocalisation') {
    const acte: GeolocData = {
      ...base,
      objet: String(meta.objet || meta.cible || 'objet à préciser'),
      description,
    };
    return { collection: 'geolocalisations', acte };
  }

  // « Autre » acte : catégorie légale (pré-remplie comme « Ajouter un acte »)…
  const key = resolveAutreActeTypeKey(meta.categorie || params.titre);
  if (key) {
    const f = deriveAutreActeFields(key, { dateDebut: debut, duree: meta.duree, pendingJld });
    const acte: AutreActe = {
      id,
      prodId: params.prodId,
      type: key,
      description,
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
  const acte: AutreActe = {
    ...base,
    type: (meta.categorie && String(meta.categorie).trim())
      || PRODUCTION_TYPE_LABEL[params.type]
      || 'Acte',
    description,
  };
  return { collection: 'actes', acte };
}
