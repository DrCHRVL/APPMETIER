/**
 * SIRAL — référentiel des tribunaux judiciaires (juridictions de rattachement).
 *
 * Objectif : NORMALISER la juridiction d'un compte. Sans référentiel, un même
 * tribunal pouvait être saisi de trois façons incompatibles pour le code
 * (« TJ AMIENS », « Amiens », « Tribunal judiciaire d'Amiens »). Ce module
 * fournit :
 *   - une liste officielle pour l'autocomplétion à l'enrôlement ;
 *   - `slugifyTribunal()` : identifiant stable et déterministe (ex. « amiens »)
 *     servant de clé de CLOISONNEMENT (préfixe des coffres, garde-fou serveur) ;
 *   - `canonicalTribunalLabel()` : libellé d'affichage normalisé.
 *
 * Important : ce fichier est pur TypeScript (aucune dépendance DOM ni Node) afin
 * d'être importable à la fois côté serveur (`lib/server`) et côté client
 * (`lib/web`) — les deux DOIVENT calculer le même slug pour que le
 * cloisonnement soit cohérent.
 */

export interface Tribunal {
  /** Identifiant stable (slug) — clé de cloisonnement. */
  slug: string
  /** Libellé canonique affiché à l'utilisateur. */
  label: string
}

/**
 * Liste des tribunaux judiciaires français (sièges). Source : organisation
 * judiciaire (ex-TGI devenus TJ au 1ᵉʳ janvier 2020). La liste peut être
 * complétée sans risque : le cloisonnement repose sur le slug, pas sur
 * l'appartenance à cette liste.
 */
const TRIBUNAUX_NOMS: string[] = [
  'Agen', 'Aix-en-Provence', 'Ajaccio', 'Albi', 'Alençon', 'Amiens', 'Angers',
  'Angoulême', 'Annecy', 'Argentan', 'Arras', 'Auch', 'Aurillac', 'Auxerre',
  'Avesnes-sur-Helpe', 'Avignon', 'Bar-le-Duc', 'Bastia', 'Bayonne', 'Beauvais',
  'Belfort', 'Bergerac', 'Besançon', 'Béthune', 'Béziers', 'Blois', 'Bobigny',
  'Bonneville', 'Bordeaux', 'Boulogne-sur-Mer', 'Bourg-en-Bresse', 'Bourges',
  'Bressuire', 'Brest', 'Brive-la-Gaillarde', 'Caen', 'Cahors', 'Cambrai',
  'Carcassonne', 'Carpentras', 'Castres', 'Chalon-sur-Saône', 'Châlons-en-Champagne',
  'Chambéry', 'Charleville-Mézières', 'Chartres', 'Châteauroux', 'Cherbourg-en-Cotentin',
  'Clermont-Ferrand', 'Compiègne', 'Coutances', 'Créteil', 'Cusset', 'Dax',
  'Dieppe', 'Digne-les-Bains', 'Dijon', 'Dinan', 'Douai', 'Draguignan', 'Dunkerque',
  'Épinal', 'Évreux', 'Évry', 'Foix', 'Fontainebleau', 'Fort-de-France', 'Gap',
  'Grasse', 'Grenoble', 'Guéret', 'Le Havre', 'Le Mans', 'Le Puy-en-Velay',
  'Libourne', 'Lille', 'Limoges', 'Lisieux', 'Lons-le-Saunier', 'Lorient', 'Lyon',
  'Mâcon', 'Marseille', 'Meaux', 'Melun', 'Mende', 'Metz', 'Millau', 'Mont-de-Marsan',
  'Montargis', 'Montauban', 'Montbéliard', 'Montluçon', 'Montpellier', 'Moulins',
  'Mulhouse', 'Nancy', 'Nanterre', 'Nantes', 'Narbonne', 'Nevers', 'Nice', 'Nîmes',
  'Niort', 'Orléans', 'Paris', 'Pau', 'Périgueux', 'Perpignan', 'Poitiers',
  'Pontoise', 'Privas', 'Quimper', 'Reims', 'Rennes', 'Roanne', 'Rodez', 'Romans-sur-Isère',
  'Rouen', 'Saint-Brieuc', 'Saint-Denis', 'Saint-Étienne', 'Saint-Gaudens',
  'Saint-Malo', 'Saint-Nazaire', 'Saint-Omer', 'Saint-Pierre', 'Saint-Quentin',
  'Saintes', 'Sarreguemines', 'Saverne', 'Senlis', 'Sens', 'Soissons', 'Strasbourg',
  'Tarascon', 'Tarbes', 'Thonon-les-Bains', 'Thionville', 'Toulon', 'Toulouse',
  'Tours', 'Troyes', 'Tulle', 'Valence', 'Valenciennes', 'Vannes', 'Verdun',
  'Versailles', 'Vesoul', 'Vienne', 'Villefranche-sur-Saône',
  'Basse-Terre', 'Pointe-à-Pitre', 'Cayenne', 'Mamoudzou', 'Nouméa', 'Papeete',
]

/**
 * Slug stable d'une juridiction. Tolère les saisies libres :
 *   « TJ AMIENS », « Amiens », « Tribunal judiciaire d'Amiens » → « amiens ».
 *   « Le Havre » → « le-havre » ; « Aix-en-Provence » → « aix-en-provence ».
 * Retourne '' si l'entrée est vide après nettoyage.
 */
export function slugifyTribunal(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/['’]/g, ' ')
  // Retrait des préfixes parasites (tribunal judiciaire / TJ / de / d' / du / des)
  s = s
    .replace(/\btribunal\s+judiciaire\b/g, ' ')
    .replace(/\btribunal\b/g, ' ')
    .replace(/\bt\s*j\b/g, ' ')
    .replace(/^\s*(de|du|des|d)\b/g, ' ')
    .replace(/\b(de|du|des|d)\b/g, ' ')
  return s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** « de »/« d' »/« du » correct selon le nom de la ville. */
function frenchComplement(nom: string): string {
  if (/^le\s+/i.test(nom)) return 'du ' + nom.replace(/^le\s+/i, '')
  if (/^les\s+/i.test(nom)) return 'des ' + nom.replace(/^les\s+/i, '')
  if (/^[aeiouyàâäéèêëîïôöûüh]/i.test(nom)) return "d'" + nom
  return 'de ' + nom
}

const BY_SLUG: Map<string, Tribunal> = new Map(
  TRIBUNAUX_NOMS.map((nom) => {
    const slug = slugifyTribunal(nom)
    return [slug, { slug, label: `Tribunal judiciaire ${frenchComplement(nom)}` }] as const
  }),
)

/** Liste triée (libellés canoniques) pour l'autocomplétion. */
export const TRIBUNAUX: Tribunal[] = Array.from(BY_SLUG.values())
  .sort((a, b) => a.label.localeCompare(b.label, 'fr'))

/** Recherche d'une juridiction connue par saisie libre (via son slug). */
export function findTribunal(input: string | null | undefined): Tribunal | null {
  const slug = slugifyTribunal(input)
  return slug ? BY_SLUG.get(slug) || null : null
}

/**
 * Libellé d'affichage normalisé. Si la juridiction est au référentiel, renvoie
 * sa forme canonique (« Tribunal judiciaire de Marseille ») ; sinon renvoie la
 * saisie nettoyée (jamais perdue) pour ne pas brider les cas hors liste.
 */
export function canonicalTribunalLabel(input: string | null | undefined): string {
  const known = findTribunal(input)
  if (known) return known.label
  return String(input || '').trim()
}
