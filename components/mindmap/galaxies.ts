// components/mindmap/galaxies.ts
//
// Modèle "carte stellaire" pour la cartographie.
//
//   Planète  = MEC exclusif (lié à 1 seul dossier).
//   Système  = 1 dossier + ses planètes.
//   Galaxie  = ensemble de systèmes reliés entre eux par ≥1 MEC partagé
//              (composante connexe du sous-graphe dossier↔dossier).
//   Comète   = MEC partagé entre plusieurs dossiers. Sa position est le
//              barycentre pondéré de ses dossiers (= chaque dossier compte
//              pour 1, donc la comète penche du côté où elle a le plus de
//              liens).
//
// Toute la géométrie de placement *au-dessus* des nœuds individuels vit ici.
// Le layout intra-système (nœuds dans une galaxie) reste géré par d3-force
// dans useForceLayout.ts, qui consomme les ancres galactiques calculées ici.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Force,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdge, GraphNode, MecNode } from '@/utils/mindmapGraph';

export interface Galaxy {
  /** Index numérique stable au sein d'un calcul. */
  index: number;
  /** Identifiant stable inter-rendus : min lexicographique des ids dossier
   *  membres (ou des MEC si galaxie sans dossier — cas dégénéré). Permet
   *  de re-corréler une galaxie d'un rendu à l'autre malgré l'ajout/retrait
   *  de membres. */
  anchorId: string;
  /** Ids dossier appartenant à la galaxie. */
  dossierIds: Set<string>;
  /** Ids MEC exclusifs (planètes) de la galaxie. */
  exclusiveMecIds: Set<string>;
  /** Ids MEC partagés (comètes) dont *tous* les dossiers sont dans cette
   *  galaxie. Par définition de la galaxie (composante connexe via partage),
   *  un MEC partagé n'enjambe jamais 2 galaxies différentes — il est
   *  toujours intra-galactique. */
  cometMecIds: Set<string>;
  /** Tous les nœuds membres (dossiers + MECs exclusifs + comètes). */
  memberIds: Set<string>;
  /** Rayon estimé du disque englobant, calculé en fonction du nombre de
   *  membres. Utilisé pour le placement inter-galactique. */
  estimatedRadius: number;
}

export interface GalaxyPlacement {
  /** Centre de la galaxie dans l'espace monde. */
  x: number;
  y: number;
  /** Rayon estimé (cohérent avec galaxy.estimatedRadius). */
  r: number;
}

// ──────────────────────────────────────────────────────────────────────
// PARAMÈTRES (calibrés pour des graphes typiques de 5 à 500 nœuds)
// ──────────────────────────────────────────────────────────────────────

/** Rayon nominal d'orbite d'une planète autour de son étoile (px). */
export const PLANET_ORBIT_RADIUS = 110;
/** Rayon nominal d'un système (étoile + 1 anneau de planètes). */
const SYSTEM_RADIUS = 160;
/** Marge ajoutée entre deux galaxies pour le placement inter-galactique
 *  (≈ deux systèmes complets de respiration). C'est LE levier de l'air entre
 *  dossiers *sans lien* : les groupes reliés restent serrés (layout
 *  intra-galactique inchangé), mais deux réseaux indépendants ne se frôlent
 *  plus — la carte respire. Les paires reliées par un lien renseignement
 *  gardent leur propre marge réduite (INTER_GALAXY_PADDING_RENS), donc rester
 *  généreux ici n'éloigne pas les galaxies qu'on veut proches. Au-dessous,
 *  hull-SAT garantit le décollage en tenant compte de l'extension visuelle
 *  réelle des nœuds. */
const INTER_GALAXY_PADDING = 300;
/** Marge réduite entre deux galaxies reliées par un lien renseignement :
 *  on veut qu'elles soient *proches* (lecture du lien immédiate) sans pour
 *  autant fusionner ni se superposer. Hull-SAT garantit le non-recouvrement. */
const INTER_GALAXY_PADDING_RENS = 60;
/** Bonus de répulsion proportionnel à la "masse" de la galaxie : plus une
 *  galaxie est grosse (rayon estimé au-delà du système nominal), plus elle
 *  pousse ses voisines loin. Effet : un gros amas ne se laisse pas coller
 *  par un petit dossier indépendant — il y a un halo de respiration. */
const GALAXY_MASS_PADDING_RATIO = 0.35;
/** Pas du relâchement hull-SAT (px) : on translate au max de cette
 *  amplitude par itération pour éviter les sur-corrections. */
const HULL_SAT_STEP = 0.5;
/** Nombre maximal d'itérations hull-SAT. Convergence typique en <20. */
const HULL_SAT_MAX_ITER = 60;
/** Itérations / alpha pour la simulation inter-galactique. */
const GALAXY_SIM_ITERATIONS = 200;

/** Séparation inter-service : répulsion entre les centroïdes de services
 *  *différents*. C'est cette force (et non la cohésion seule) qui creuse un
 *  "désert" entre les zones et rend les services lisibles à l'œil. Volontairement
 *  modérée : elle ne s'applique PAS aux galaxies-pont (reliées par un lien
 *  renseignement à un autre service), pour ne pas casser ces liens. */
const SERVICE_SEPARATION_STRENGTH = 0.1;
/** Échelle de distance de la séparation inter-service : la poussée décroît en
 *  ~RANGE/d, donc reste bornée et n'explose pas quand deux services sont déjà
 *  loin l'un de l'autre. */
const SERVICE_SEPARATION_RANGE = 600;

/** Répulsion "de masse" des grosses galaxies sur leurs voisines : plus une
 *  galaxie est grosse, plus elle repousse les dossiers alentour (qui n'ont
 *  rien à voir). Indépendant du regroupement par service. Exemptée pour les
 *  paires reliées par un lien renseignement (on veut qu'elles restent proches). */
const BIG_GALAXY_REPEL_STRENGTH = 0.035;
/** Seuil au-delà duquel une galaxie est considérée "grosse" et se met à
 *  repousser ses voisines (multiple du rayon nominal d'un système). */
const BIG_GALAXY_REPEL_THRESHOLD = SYSTEM_RADIUS * 1.5;
/** Portée max de la répulsion de masse (multiple du rayon de la grosse
 *  galaxie). Au-delà, deux réseaux lointains s'ignorent (comme la gravité,
 *  qui devient négligeable avec la distance). */
const BIG_GALAXY_REPEL_RANGE_RATIO = 2.5;

/** Amorçage par secteur de service : rayon nominal auquel une zone de service
 *  est posée autour du centre. La croissance radiale par galaxie évite
 *  l'empilement ; la séparation inter-service écarte ensuite les zones. */
const SERVICE_SECTOR_RADIUS = 600;
/** Anneau périphérique où sont seedées les galaxies vraiment isolées (ni
 *  service ni lien) pour qu'elles ne polluent ni le centre ni les zones. */
const SERVICE_PERIPHERY_RADIUS = 1800;
/** Ressort radial doux maintenant les galaxies isolées sur l'anneau
 *  périphérique (force centrifuge bornée). */
const ORPHAN_CENTRIFUGAL_STRENGTH = 0.05;

/** Halo de répulsion supplémentaire d'une galaxie au-delà de son rayon
 *  estimé. Croit linéairement avec la "taille au-dessus du système
 *  nominal", capé pour rester raisonnable sur les très gros graphes. */
function massHalo(r: number): number {
  return Math.min(220, Math.max(0, r - SYSTEM_RADIUS) * GALAXY_MASS_PADDING_RATIO);
}

// ──────────────────────────────────────────────────────────────────────
// DÉTECTION DES GALAXIES
// ──────────────────────────────────────────────────────────────────────

/**
 * Construit la liste des galaxies à partir des nœuds + arêtes.
 *
 * Étapes :
 *   1. Index dossier-dossier : arête si ≥1 MEC commun (ou lien
 *      renseignement direct entre 2 dossiers).
 *   2. BFS sur ce graphe → composantes connexes = galaxies.
 *   3. Affectation des MEC : un MEC dont tous les dossiers sont dans la
 *      même galaxie y est rattaché ; sa qualification (exclusive/comète)
 *      dépend du nombre de dossiers (1 = exclusive, ≥2 = comète).
 *
 * Les nœuds totalement isolés (MEC sans dossier, dossier sans MEC) forment
 * chacun leur propre galaxie naine.
 */
export function detectGalaxies(nodes: GraphNode[], edges: GraphEdge[]): {
  galaxies: Galaxy[];
  galaxyIdxByNodeId: Map<string, number>;
} {
  const dossiers = new Map<string, GraphNode>();
  const mecs = new Map<string, MecNode>();
  for (const n of nodes) {
    if (n.type === 'dossier') dossiers.set(n.id, n);
    else mecs.set(n.id, n);
  }

  // 1. Adjacence pour la détection des galaxies. SEULES les arêtes "data"
  //    (MEC ↔ dossier via mec.dossierIds) définissent l'appartenance à une
  //    galaxie. Les liens "renseignement" sont volontairement IGNORÉS ici :
  //    un simple lien de renseignement entre deux réseaux ne doit pas les
  //    fusionner en une seule galaxie (même couleur, même hull). Ils restent
  //    rendus visuellement (force d'attraction au layer micro) mais les deux
  //    réseaux gardent leur identité distincte.
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const mec of mecs.values()) {
    for (const did of mec.dossierIds) {
      if (!dossiers.has(did)) continue;
      adj.get(mec.id)!.add(did);
      adj.get(did)!.add(mec.id);
    }
  }
  for (const e of edges) {
    if (e.kind === 'renseignement') continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  // 2. Composantes connexes → galaxies. On distingue ensuite les rôles
  //    de chaque membre (dossier=étoile, MEC=planète/comète).
  const galaxyIdxByNodeId = new Map<string, number>();
  const galaxies: Galaxy[] = [];
  for (const n of nodes) {
    if (galaxyIdxByNodeId.has(n.id)) continue;
    const idx = galaxies.length;
    const members: string[] = [];
    const queue: string[] = [n.id];
    galaxyIdxByNodeId.set(n.id, idx);
    while (queue.length) {
      const cur = queue.shift()!;
      members.push(cur);
      for (const nb of adj.get(cur) || []) {
        if (galaxyIdxByNodeId.has(nb)) continue;
        galaxyIdxByNodeId.set(nb, idx);
        queue.push(nb);
      }
    }
    const galaxyDossiers = new Set<string>();
    const exclusiveMecs = new Set<string>();
    const cometMecs = new Set<string>();
    for (const id of members) {
      if (dossiers.has(id)) galaxyDossiers.add(id);
      else {
        const mec = mecs.get(id);
        if (!mec) continue;
        const linkedCount = mec.dossierIds.filter(d => dossiers.has(d)).length;
        if (linkedCount <= 1) exclusiveMecs.add(id);
        else cometMecs.add(id);
      }
    }
    // Ancre stable inter-rendus : priorité à un dossier (les MECs peuvent
    // être recalculés ou renommés ; les dossiers ont des ids structurels).
    // Fallback sur le min lexicographique des membres pour les galaxies
    // sans dossier (MEC ex nihilo isolé).
    const sortedDossiers = Array.from(galaxyDossiers).sort();
    const anchorId = sortedDossiers[0] ?? members.slice().sort()[0];
    galaxies.push({
      index: idx,
      anchorId,
      dossierIds: galaxyDossiers,
      exclusiveMecIds: exclusiveMecs,
      cometMecIds: cometMecs,
      memberIds: new Set(members),
      estimatedRadius: 0,
    });
  }

  // 4. Rayon estimé : √(N) × constante, plancher pour les galaxies naines.
  for (const g of galaxies) {
    const n = g.memberIds.size;
    g.estimatedRadius = Math.max(SYSTEM_RADIUS, Math.sqrt(n) * 90);
  }

  return { galaxies, galaxyIdxByNodeId };
}

// ──────────────────────────────────────────────────────────────────────
// PLACEMENT DES CENTRES DE GALAXIES (puits gravitationnels)
// ──────────────────────────────────────────────────────────────────────

interface GalaxySimNode extends SimulationNodeDatum {
  index: number;
  r: number;
  // d3-force injecte x/y au runtime (SimulationNodeDatum les déclare
  // optionnels), on les redéclare ici pour que TS ne perde pas l'info
  // quand les types d3-force ne sont pas résolus.
  x?: number;
  y?: number;
  /** Position préférée (depuis cache), utilisée comme seed pour la stabilité. */
  seedX?: number;
  seedY?: number;
}

/**
 * Calcule un centre pour chaque galaxie en faisant tourner une mini-simu
 * d3-force au niveau galactique :
 *   - chaque galaxie = 1 corps de rayon `estimatedRadius`
 *   - répulsion (charge) modérée : juste de quoi écarter
 *   - collision dure entre disques galactiques (pas de chevauchement)
 *   - répulsion symétrique → la gravité centrale n'est pas nécessaire,
 *     forceCenter introduit un biais inward parasite. À la place, on
 *     part de positions seedées (cache ou jitter déterministe) et on
 *     laisse la collision faire le travail.
 *
 * Si `cachedCenters` est fourni, on initialise les positions depuis le
 * cache pour préserver la disposition entre rendus.
 */
/**
 * Ancrage zonal optionnel : attire les galaxies partageant un même service
 * dominant vers leur centroïde commun. Le centroïde est recalculé à chaque
 * tick depuis les positions courantes (auto-organisé, aucun puits codé en
 * dur). Un service présent sur une seule galaxie ne génère aucune force
 * (centroïde = sa propre position). Force volontairement faible : elle
 * s'ajoute aux liens data/renseignement existants sans les écraser, donc
 * une galaxie reliée à une autre de service différent reste tirée entre les
 * deux (effet "pont" lisible).
 */
export interface ServiceGravityInput {
  /** Service dominant par index de galaxie. Galaxies absentes = pas d'ancrage. */
  serviceByGalaxyIdx: Map<number, string>;
  /** Intensité de l'attraction (comparable à une strength forceX/forceY). */
  strength: number;
}

export function layoutGalaxyCenters(
  galaxies: Galaxy[],
  cachedCenters?: Map<string, { x: number; y: number }>,
  rensGalaxyPairs?: Array<{ aIdx: number; bIdx: number }>,
  serviceGravity?: ServiceGravityInput,
  applyBigGalaxyRepel?: boolean,
): Map<number, GalaxyPlacement> {
  const result = new Map<number, GalaxyPlacement>();
  if (galaxies.length === 0) return result;
  if (galaxies.length === 1) {
    result.set(galaxies[0].index, { x: 0, y: 0, r: galaxies[0].estimatedRadius });
    return result;
  }

  // ── Amorçage par secteur de service ──────────────────────────────────
  // Quand le regroupement par service est actif, on assigne à chaque service
  // un secteur angulaire déterministe (tri alphabétique → disposition
  // reproductible d'un recompactage à l'autre). On pose alors chaque galaxie
  // dans le secteur de son service dominant ; les galaxies-pont à la frontière
  // de leurs deux secteurs ; les galaxies vraiment isolées sur un anneau
  // périphérique. Sans regroupement actif, on garde la spirale d'origine.
  const serviceByGalaxyIdx = serviceGravity?.serviceByGalaxyIdx;
  const useSectorSeed = !!serviceByGalaxyIdx && serviceByGalaxyIdx.size > 0;
  const sectorAngle = new Map<string, number>();
  if (useSectorSeed) {
    const services = Array.from(new Set(serviceByGalaxyIdx!.values())).sort();
    services.forEach((svc, i) => sectorAngle.set(svc, (i / services.length) * Math.PI * 2));
  }
  const rensPartners = new Map<number, number[]>();
  if (rensGalaxyPairs) {
    const addPartner = (from: number, to: number) => {
      const list = rensPartners.get(from);
      if (list) list.push(to);
      else rensPartners.set(from, [to]);
    };
    for (const p of rensGalaxyPairs) {
      addPartner(p.aIdx, p.bIdx);
      addPartner(p.bIdx, p.aIdx);
    }
  }
  // Milieu angulaire de deux directions (gère le wrap via somme vectorielle).
  const midAngle = (a: number, b: number) =>
    Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
  const sectorCount = new Map<string, number>();
  let peripheryCount = 0;

  const simNodes: GalaxySimNode[] = galaxies.map((g, i) => {
    const cached = cachedCenters?.get(g.anchorId);
    if (cached && Number.isFinite(cached.x) && Number.isFinite(cached.y)) {
      return { index: g.index, r: g.estimatedRadius, x: cached.x, y: cached.y, seedX: cached.x, seedY: cached.y };
    }
    if (!useSectorSeed) {
      // Spirale d'Archimède : θ et r croissent ensemble → aucun chevauchement
      // initial même quand toutes les galaxies sont nouvelles.
      const theta = i * 2.4;
      const r = 200 + i * 60;
      return { index: g.index, r: g.estimatedRadius, x: r * Math.cos(theta), y: r * Math.sin(theta) };
    }
    const svc = serviceByGalaxyIdx!.get(g.index);
    const partners = rensPartners.get(g.index) ?? [];
    let angle: number;
    let radius: number;
    if (svc !== undefined && sectorAngle.has(svc)) {
      // Galaxie-pont ? reliée par renseignement à un service différent.
      let bridgeAngle: number | undefined;
      for (const pj of partners) {
        const psvc = serviceByGalaxyIdx!.get(pj);
        if (psvc && psvc !== svc && sectorAngle.has(psvc)) {
          bridgeAngle = midAngle(sectorAngle.get(svc)!, sectorAngle.get(psvc)!);
          break;
        }
      }
      const k = sectorCount.get(svc) ?? 0;
      sectorCount.set(svc, k + 1);
      const halfWidth = (Math.PI * 2 / sectorAngle.size) * 0.35;
      // Pont : posé pile à la frontière. Sinon : éventail déterministe dans le secteur.
      angle = bridgeAngle ?? (sectorAngle.get(svc)! + (k % 2 === 0 ? 1 : -1) * halfWidth * ((k + 1) / (k + 3)));
      radius = SERVICE_SECTOR_RADIUS + k * 80;
    } else {
      // Pas de service : si reliée par renseignement à un service, on la pose
      // près de ce partenaire (lien court). Sinon, vraiment isolée → périphérie.
      let nearAngle: number | undefined;
      for (const pj of partners) {
        const psvc = serviceByGalaxyIdx!.get(pj);
        if (psvc && sectorAngle.has(psvc)) { nearAngle = sectorAngle.get(psvc); break; }
      }
      if (nearAngle !== undefined) {
        angle = nearAngle;
        radius = SERVICE_SECTOR_RADIUS + 120;
      } else {
        const k = peripheryCount++;
        angle = k * 2.39996; // angle d'or → répartition uniforme sur l'anneau
        radius = SERVICE_PERIPHERY_RADIUS + (k % 5) * 90;
      }
    }
    return { index: g.index, r: g.estimatedRadius, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });

  // Ensemble des galaxies vraiment isolées (ni service ni lien) : maintenues
  // sur l'anneau périphérique par un ressort radial doux.
  const isolatedSet = new Set<number>();
  if (useSectorSeed) {
    for (const g of galaxies) {
      const svc = serviceByGalaxyIdx!.get(g.index);
      const hasPartner = (rensPartners.get(g.index)?.length ?? 0) > 0;
      if ((svc === undefined || !sectorAngle.has(svc)) && !hasPartner) isolatedSet.add(g.index);
    }
  }

  const sim = forceSimulation(simNodes)
    .alpha(1)
    // Charge faible : la collision tient déjà le terrain, la charge n'aide
    // qu'à fluidifier la convergence quand 2 galaxies veulent la même place.
    .force('charge', forceManyBody<GalaxySimNode>().strength(d => -150 * d.r / 100))
    .force(
      'collide',
      // Rayon de collision = rayon estimé + padding fixe + halo de masse.
      // Le halo donne aux grosses galaxies un "espace personnel" plus grand
      // que les petites : un dossier indépendant ne vient plus se coller
      // au bord d'un gros amas, il reste à distance respectueuse.
      forceCollide<GalaxySimNode>()
        .radius(d => d.r + INTER_GALAXY_PADDING + massHalo(d.r))
        .strength(1)
        .iterations(2),
    );

  // Attraction inter-galactique sur les liens renseignement : on tisse un
  // forceLink macro entre les *centres* de galaxies reliées par ≥1 lien
  // renseignement. Distance cible = juste de quoi se toucher hull-à-hull
  // (collision les empêchera de fusionner), strength bien inférieure à
  // celle des liens data intra-galactique (0.6) pour rester un effet de
  // "gravité douce" et non un lien dur.
  //
  //   Important : on NE FUSIONNE PAS les galaxies (detectGalaxies les a
  //   gardées distinctes), on NE COLORE PAS différemment (les hulls
  //   d'influence ignorent aussi les liens rens), on rapproche juste les
  //   *centres*. Le résultat visuel : deux réseaux qui se "frôlent" sans
  //   se mélanger, et le trait renseignement court devient court et
  //   lisible au lieu de traverser toute la carte.
  if (rensGalaxyPairs && rensGalaxyPairs.length > 0) {
    const simNodeByIdx = new Map<number, GalaxySimNode>();
    for (const sn of simNodes) simNodeByIdx.set(sn.index, sn);
    // Dédupliquer les paires (plusieurs liens rens entre deux galaxies ne
    // doivent pas multiplier la force d'attraction).
    const seen = new Set<string>();
    const macroLinks: SimulationLinkDatum<GalaxySimNode>[] = [];
    for (const p of rensGalaxyPairs) {
      if (p.aIdx === p.bIdx) continue;
      const a = simNodeByIdx.get(p.aIdx);
      const b = simNodeByIdx.get(p.bIdx);
      if (!a || !b) continue;
      const key = p.aIdx < p.bIdx ? `${p.aIdx}|${p.bIdx}` : `${p.bIdx}|${p.aIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      macroLinks.push({ source: a, target: b });
    }
    if (macroLinks.length > 0) {
      sim.force(
        'rensLink',
        forceLink<GalaxySimNode, SimulationLinkDatum<GalaxySimNode>>(macroLinks)
          .distance(l => {
            const a = l.source as GalaxySimNode;
            const b = l.target as GalaxySimNode;
            // Distance cible = somme des rayons + un padding réduit. La
            // collision (rayon + INTER_GALAXY_PADDING) empêche d'aller plus
            // près : les galaxies se posent au minimum admissible.
            return a.r + b.r + INTER_GALAXY_PADDING_RENS + (massHalo(a.r) + massHalo(b.r)) / 2;
          })
          .strength(0.18),
      );
    }
  }

  // Ancrage zonal par service : force custom d3 qui, à chaque tick, recalcule
  // le centroïde de chaque service (sur les galaxies qui le portent) puis tire
  // chaque galaxie vers le centroïde de SON service. Les services à une seule
  // galaxie sont ignorés (count < 2 → pas de cible). Effet émergent : un
  // service majoritaire occupe le centre de masse, les services minoritaires
  // s'agrègent en périphérie.
  if (serviceGravity && serviceGravity.strength > 0 && serviceGravity.serviceByGalaxyIdx.size > 0) {
    const { serviceByGalaxyIdx, strength } = serviceGravity;
    // Galaxies-pont : reliées par un lien renseignement à une galaxie d'un
    // service DIFFÉRENT. Exemptées de la séparation inter-service pour ne pas
    // casser ce lien — elles restent libres de se loger entre les deux zones.
    const serviceBridge = new Set<number>();
    if (rensGalaxyPairs) {
      for (const p of rensGalaxyPairs) {
        const sa = serviceByGalaxyIdx.get(p.aIdx);
        const sb = serviceByGalaxyIdx.get(p.bIdx);
        if (sa && sb && sa !== sb) { serviceBridge.add(p.aIdx); serviceBridge.add(p.bIdx); }
      }
    }
    let forceNodes: GalaxySimNode[] = simNodes;
    const serviceForce: Force<GalaxySimNode, undefined> = Object.assign(
      (alpha: number) => {
        const sums = new Map<string, { x: number; y: number; count: number }>();
        for (const n of forceNodes) {
          const svc = serviceByGalaxyIdx.get(n.index);
          if (!svc) continue;
          const x = Number.isFinite(n.x) ? n.x! : 0;
          const y = Number.isFinite(n.y) ? n.y! : 0;
          let s = sums.get(svc);
          if (!s) { s = { x: 0, y: 0, count: 0 }; sums.set(svc, s); }
          s.x += x; s.y += y; s.count++;
        }
        for (const n of forceNodes) {
          const svc = serviceByGalaxyIdx.get(n.index);
          if (!svc) continue;
          const x = Number.isFinite(n.x) ? n.x! : 0;
          const y = Number.isFinite(n.y) ? n.y! : 0;
          // Cohésion : attraction vers le centroïde de SON service.
          const s = sums.get(svc);
          if (s && s.count >= 2) {
            const cx = s.x / s.count;
            const cy = s.y / s.count;
            n.vx = (n.vx ?? 0) + (cx - x) * strength * alpha;
            n.vy = (n.vy ?? 0) + (cy - y) * strength * alpha;
          }
          // Séparation : répulsion par rapport aux centroïdes des AUTRES
          // services → creuse le désert entre zones. Pas pour les ponts.
          if (SERVICE_SEPARATION_STRENGTH > 0 && !serviceBridge.has(n.index)) {
            for (const [osvc, os] of sums) {
              if (osvc === svc) continue;
              const ocx = os.x / os.count;
              const ocy = os.y / os.count;
              const dx = x - ocx;
              const dy = y - ocy;
              const d = Math.hypot(dx, dy) || 1;
              const f = SERVICE_SEPARATION_STRENGTH * alpha * (SERVICE_SEPARATION_RANGE / d);
              n.vx = (n.vx ?? 0) + (dx / d) * f;
              n.vy = (n.vy ?? 0) + (dy / d) * f;
            }
          }
        }
      },
      { initialize: (nodes: GalaxySimNode[]) => { forceNodes = nodes; } },
    );
    sim.force('serviceGravity', serviceForce);
  }

  // Répulsion de masse : les grosses galaxies poussent leurs voisines au
  // loin (sauf paires renseignement, qu'on veut proches). Force asymétrique :
  // seule la voisine bouge, la grosse galaxie reste un point d'ancrage stable.
  if (applyBigGalaxyRepel) {
    const rensPairKeys = new Set<string>();
    if (rensGalaxyPairs) {
      for (const p of rensGalaxyPairs) {
        const k = p.aIdx < p.bIdx ? `${p.aIdx}|${p.bIdx}` : `${p.bIdx}|${p.aIdx}`;
        rensPairKeys.add(k);
      }
    }
    const hasBig = simNodes.some(n => n.r > BIG_GALAXY_REPEL_THRESHOLD);
    if (hasBig) {
      let forceNodes: GalaxySimNode[] = simNodes;
      const bigRepel: Force<GalaxySimNode, undefined> = Object.assign(
        (alpha: number) => {
          for (const big of forceNodes) {
            if (big.r <= BIG_GALAXY_REPEL_THRESHOLD) continue;
            const mass = big.r - SYSTEM_RADIUS;
            const bx = Number.isFinite(big.x) ? big.x! : 0;
            const by = Number.isFinite(big.y) ? big.y! : 0;
            for (const h of forceNodes) {
              if (h === big) continue;
              const key = big.index < h.index ? `${big.index}|${h.index}` : `${h.index}|${big.index}`;
              if (rensPairKeys.has(key)) continue;
              const hx = Number.isFinite(h.x) ? h.x! : 0;
              const hy = Number.isFinite(h.y) ? h.y! : 0;
              const dx = hx - bx;
              const dy = hy - by;
              const d = Math.hypot(dx, dy) || 1;
              // Portée bornée : au-delà de RANGE_RATIO × rayon, effet nul.
              const range = big.r * BIG_GALAXY_REPEL_RANGE_RATIO;
              if (d >= range) continue;
              // Profil quasi-1/d² (fort tout près, négligeable au loin) + fondu
              // linéaire jusqu'à 0 à la portée max pour éviter une coupure nette.
              const taper = 1 - d / range;
              const f = (BIG_GALAXY_REPEL_STRENGTH * alpha * mass * taper * taper) / d;
              h.vx = (h.vx ?? 0) + (dx / d) * f;
              h.vy = (h.vy ?? 0) + (dy / d) * f;
            }
          }
        },
        { initialize: (nodes: GalaxySimNode[]) => { forceNodes = nodes; } },
      );
      sim.force('bigGalaxyRepel', bigRepel);
    }
  }

  // Ressort centrifuge : maintient les galaxies isolées (ni service ni lien)
  // sur l'anneau périphérique, pour qu'elles ne dérivent pas vers le centre
  // ni dans le désert entre zones.
  if (isolatedSet.size > 0) {
    let forceNodes: GalaxySimNode[] = simNodes;
    const centrifugal: Force<GalaxySimNode, undefined> = Object.assign(
      (alpha: number) => {
        for (const n of forceNodes) {
          if (!isolatedSet.has(n.index)) continue;
          const x = Number.isFinite(n.x) ? n.x! : 0;
          const y = Number.isFinite(n.y) ? n.y! : 0;
          const dist = Math.hypot(x, y) || 1;
          // Ressort vers l'anneau : pousse dehors si trop au centre, retient si trop loin.
          const f = (SERVICE_PERIPHERY_RADIUS - dist) * ORPHAN_CENTRIFUGAL_STRENGTH * alpha;
          n.vx = (n.vx ?? 0) + (x / dist) * f;
          n.vy = (n.vy ?? 0) + (y / dist) * f;
        }
      },
      { initialize: (nodes: GalaxySimNode[]) => { forceNodes = nodes; } },
    );
    sim.force('orphanCentrifugal', centrifugal);
  }

  sim.stop();
  for (let i = 0; i < GALAXY_SIM_ITERATIONS; i++) sim.tick();

  for (const sn of simNodes) {
    result.set(sn.index, {
      x: Number.isFinite(sn.x) ? sn.x! : 0,
      y: Number.isFinite(sn.y) ? sn.y! : 0,
      r: sn.r,
    });
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────
// HULL-SAT POST-PASS
// ──────────────────────────────────────────────────────────────────────

/**
 * Relaxation finale : on regarde les positions effectives des galaxies
 * APRÈS le layout intra-système, et on pousse rigidement les galaxies
 * qui se chevauchent encore. Opère sur les disques englobants (cercle
 * couvrant tous les membres) — pas sur les polygones hull, c'est
 * suffisant pour le visuel et 100× moins coûteux.
 *
 * Retourne un Map<galaxyIdx, delta {dx, dy}> à appliquer à TOUS les
 * nœuds membres de chaque galaxie (translation rigide → l'orbite
 * relative de chaque planète autour de son étoile reste intacte).
 */
export function hullSatRelax(
  galaxies: Galaxy[],
  positionsByNodeId: Map<string, { x: number; y: number }>,
  nodeRadiusById?: Map<string, number>,
  rensGalaxyPairs?: Array<{ aIdx: number; bIdx: number }>,
): Map<number, { dx: number; dy: number }> {
  const deltas = new Map<number, { dx: number; dy: number }>();
  if (galaxies.length < 2) return deltas;

  // Index des paires de galaxies reliées par un lien renseignement : pour
  // celles-ci, hull-SAT autorise une proximité plus serrée (padding réduit)
  // — on veut qu'elles se touchent presque sans pour autant se chevaucher.
  const rensPairSet = new Set<string>();
  if (rensGalaxyPairs) {
    for (const p of rensGalaxyPairs) {
      if (p.aIdx === p.bIdx) continue;
      const k = p.aIdx < p.bIdx ? `${p.aIdx}|${p.bIdx}` : `${p.bIdx}|${p.aIdx}`;
      rensPairSet.add(k);
    }
  }
  const isRensPair = (a: number, b: number) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    return rensPairSet.has(k);
  };

  // Cercles englobants effectifs (post-layout). Le rayon estimé peut
  // sur-estimer la réalité (galaxie compacte) → on prend le vrai max.
  // IMPORTANT : on inclut la *taille visuelle* de chaque nœud (collisionRadius)
  // au bout de la distance au centroïde, sinon un gros dossier sur le bord
  // de la galaxie déborde du disque englobant et finit par chevaucher la
  // galaxie voisine — c'est la cause principale des galaxies "qui se
  // superposent alors qu'elles n'ont aucun lien".
  const discs = galaxies.map(g => {
    let cx = 0, cy = 0, count = 0;
    for (const id of g.memberIds) {
      const p = positionsByNodeId.get(id);
      if (!p) continue;
      cx += p.x; cy += p.y; count++;
    }
    if (count > 0) { cx /= count; cy /= count; }
    let r = 0;
    for (const id of g.memberIds) {
      const p = positionsByNodeId.get(id);
      if (!p) continue;
      const visualR = nodeRadiusById?.get(id) ?? 0;
      const d = Math.hypot(p.x - cx, p.y - cy) + visualR;
      if (d > r) r = d;
    }
    // Disque effectif = enveloppe (incluant la taille des nœuds) + plein
    // padding + halo de masse. Hull-SAT applique désormais le MÊME budget
    // d'espace que la simulation macro — pas de marche d'escalier où le
    // post-pass relâche un contact que la simu avait soigneusement écarté.
    return { idx: g.index, x: cx, y: cy, r: r + INTER_GALAXY_PADDING / 2 + massHalo(r) / 2 };
  });

  // Translations cumulées par galaxie.
  const dx = new Map<number, number>();
  const dy = new Map<number, number>();
  for (const d of discs) { dx.set(d.idx, 0); dy.set(d.idx, 0); }

  for (let iter = 0; iter < HULL_SAT_MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i], b = discs[j];
        const ax = a.x + (dx.get(a.idx) || 0);
        const ay = a.y + (dy.get(a.idx) || 0);
        const bx = b.x + (dx.get(b.idx) || 0);
        const by = b.y + (dy.get(b.idx) || 0);
        let vx = bx - ax;
        let vy = by - ay;
        let d2 = vx * vx + vy * vy;
        if (d2 < 0.0001) {
          // Centres confondus : on injecte une direction déterministe (fonction
          // de l'index) pour décoller proprement sans aléatoire.
          vx = Math.cos(a.idx + b.idx);
          vy = Math.sin(a.idx + b.idx);
          d2 = vx * vx + vy * vy;
        }
        const d = Math.sqrt(d2);
        // Paires reliées par un lien renseignement : on autorise un
        // rapprochement plus serré (réduit le padding mais garde la
        // somme des rayons → toujours pas de chevauchement, juste un
        // espace inter-galactique plus court).
        const rensShrink = isRensPair(a.idx, b.idx)
          ? (INTER_GALAXY_PADDING - INTER_GALAXY_PADDING_RENS)
          : 0;
        const minDist = a.r + b.r - rensShrink;
        const penetration = minDist - d;
        if (penetration <= 0) continue;
        // On translate chacun de moitié dans la direction opposée. Pondération
        // par taille : la grosse galaxie bouge moins que la petite (inertie).
        const totalSize = (a.r * a.r) + (b.r * b.r);
        const shareA = (b.r * b.r) / totalSize;
        const shareB = (a.r * a.r) / totalSize;
        const step = Math.min(penetration, penetration * HULL_SAT_STEP);
        const ux = vx / d;
        const uy = vy / d;
        dx.set(a.idx, (dx.get(a.idx) || 0) - ux * step * shareA);
        dy.set(a.idx, (dy.get(a.idx) || 0) - uy * step * shareA);
        dx.set(b.idx, (dx.get(b.idx) || 0) + ux * step * shareB);
        dy.set(b.idx, (dy.get(b.idx) || 0) + uy * step * shareB);
        moved = true;
      }
    }
    if (!moved) break;
  }

  for (const g of galaxies) {
    const ddx = dx.get(g.index) || 0;
    const ddy = dy.get(g.index) || 0;
    if (ddx !== 0 || ddy !== 0) deltas.set(g.index, { dx: ddx, dy: ddy });
  }
  return deltas;
}

// ──────────────────────────────────────────────────────────────────────
// LAYOUT ORBITAL INTRA-SYSTÈME
// ──────────────────────────────────────────────────────────────────────

/** Largeur angulaire (rad) masquée autour de la direction d'un voisin
 *  proche. ±27° → on évite que les planètes pointent vers le voisin. */
const NEIGHBOR_MASK_HALF_WIDTH = (27 * Math.PI) / 180;
/** Plafond du masque géométrique d'un dossier voisin : on ne laisse jamais
 *  un seul voisin manger plus de ±60° du cercle, sinon une étoile entourée
 *  de 3 dossiers larges n'a plus aucun angle valide. Le reste est résolu
 *  par le node-SAT final qui pousse hors collision. */
const FOREIGN_DOSSIER_MASK_MAX_HALF_WIDTH = (60 * Math.PI) / 180;
/** Buffer (px) entre une planète et un dossier *non-parent* de la même
 *  galaxie. Ajouté en plus du rayon de collision visuel pour que la
 *  planète reste lisiblement "à l'écart" du dossier voisin et qu'on
 *  voie clairement à quelle étoile elle appartient. Volontairement
 *  généreux : la lisibilité prime sur la compacité. */
const FOREIGN_DOSSIER_BUFFER = 40;
/** Au-delà de ce ratio (distance voisin / rayon orbite), le voisin n'est
 *  plus considéré comme "proche" et ne masque plus de secteur. */
const NEIGHBOR_MASK_RANGE_RATIO = 4;
/** Espacement angulaire minimal entre deux planètes adjacentes (rad).
 *  Avec ≈6° on a au max 60 planètes par anneau ; au-delà on bascule sur
 *  un 2ème anneau. */
const MIN_PLANET_ARC_GAP = (6 * Math.PI) / 180;
/** Diamètre nominal de secours (collision radius * 2 + padding) si aucune
 *  fonction de mesure n'est fournie. Calibré sur un MEC de score moyen.
 *  En pratique le caller fournit collisionRadiusOf et on utilise la
 *  taille réelle, qui peut atteindre ~180 px pour un gros MEC. */
const FALLBACK_PLANET_DIAMETER = 140;
/** Padding additionnel entre planètes sur l'anneau (px). */
const PLANET_RING_PADDING = 18;
/** Rayon maximal cible d'un anneau avant qu'on ne crée un anneau
 *  supplémentaire. Au-delà, les planètes "dérivent" visuellement loin de
 *  leur étoile — on préfère empiler plusieurs anneaux concentriques. */
const MAX_RING_RADIUS = 420;
/** Demi-largeur (rad) du secteur préféré autour de la direction d'un lien
 *  renseignement. Quand une planète a un lien rens, on essaye de la placer
 *  dans cette plage ±15° vers le partenaire pour raccourcir le trait et
 *  éviter qu'il traverse la galaxie. */
const RENSEIGNEMENT_PREFERRED_HALF_WIDTH = (15 * Math.PI) / 180;

/**
 * Place chaque planète (MEC exclusif d'un dossier) sur un anneau autour
 * de son étoile. Les positions des étoiles et des comètes ne sont pas
 * touchées — seules les planètes sont repositionnées.
 *
 * Pour chaque étoile :
 *   1. On identifie les directions de ses voisines proches (autres
 *      dossiers de la même galaxie à portée).
 *   2. On masque un secteur angulaire autour de chacune (les bras de
 *      planètes ne se déploient pas vers le voisin).
 *   3. On distribue les planètes uniformément dans les secteurs libres.
 *      Si trop nombreuses pour un seul anneau, on en crée un 2ème.
 *   4. Si une planète a un angle en cache compatible avec un secteur
 *      libre, on le préserve (stabilité inter-rendus).
 */
export interface OrbitalLayoutOptions {
  /** Rayon de collision réel par nœud (≈ taille visuelle + padding). Si
   *  fourni, l'anneau est dimensionné à partir de la planète la plus grosse
   *  du système au lieu d'un diamètre nominal — évite les chevauchements
   *  visibles entre deux gros MEC voisins sur le même anneau. */
  collisionRadiusOf?: (node: GraphNode) => number;
  /** Pour chaque MEC, ids des autres nœuds auxquels il est lié par un
   *  lien renseignement (toutes galaxies confondues). Si fourni, on
   *  privilégie un angle orbital tourné VERS le partenaire pour que le
   *  trait soit court et ne traverse pas le reste du système. */
  renseignementTargetsByMecId?: Map<string, string[]>;
}

export function applyOrbitalLayout(
  galaxies: Galaxy[],
  nodes: GraphNode[],
  positions: Map<string, { x: number; y: number }>,
  cachedAngleByMecId?: Map<string, number>,
  options: OrbitalLayoutOptions = {},
): Map<string, number> {
  // Nouvelle map angle par MEC (sortie + nouveau cache).
  const newAngles = new Map<string, number>();

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const dossierToPlanets = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.type !== 'mec') continue;
    if (n.dossierIds.length !== 1) continue;
    const did = n.dossierIds[0];
    if (!dossierToPlanets.has(did)) dossierToPlanets.set(did, []);
    dossierToPlanets.get(did)!.push(n.id);
  }

  const planetDiameter = (id: string): number => {
    const n = nodeById.get(id);
    if (!n || !options.collisionRadiusOf) return FALLBACK_PLANET_DIAMETER;
    return options.collisionRadiusOf(n) * 2 + PLANET_RING_PADDING;
  };

  for (const galaxy of galaxies) {
    const galaxyDossiers = Array.from(galaxy.dossierIds);

    for (const starId of galaxyDossiers) {
      const planets = dossierToPlanets.get(starId);
      if (!planets || planets.length === 0) continue;
      const starPos = positions.get(starId);
      if (!starPos) continue;

      // Diamètre effectif d'une planète sur l'anneau (max sur le système :
      // le plus gros MEC dicte la maille). Padding inclus pour ne pas que
      // deux planètes voisines se touchent visuellement.
      let maxPlanetDiameter = 0;
      for (const pid of planets) {
        const d = planetDiameter(pid);
        if (d > maxPlanetDiameter) maxPlanetDiameter = d;
      }
      if (maxPlanetDiameter === 0) maxPlanetDiameter = FALLBACK_PLANET_DIAMETER;

      // Taille visuelle réelle de l'étoile (dossier) : la box d'un dossier
      // peut atteindre ~360 px de large (collisionRadius ≈ 180). Avec
      // l'ancien minRingRadius=140 fixe, les planètes étaient placées
      // *à l'intérieur* du rectangle du dossier — leur nom passait sous
      // le numéro du dossier ("noms de dossier par dessus les noms de
      // mis en cause"). On dimensionne désormais le rayon minimal au
      // contact étoile↔planète, plus une marge de respiration.
      const starNode = nodeById.get(starId);
      const starRadius = starNode && options.collisionRadiusOf
        ? options.collisionRadiusOf(starNode)
        : 80;

      // Direction préférée par planète (vers son partenaire renseignement
      // le plus proche, le cas échéant). On l'utilisera comme biais lors
      // du choix d'angle.
      const preferredAngleByPlanet = new Map<string, number>();
      const rensTargets = options.renseignementTargetsByMecId;
      if (rensTargets) {
        for (const pid of planets) {
          const targets = rensTargets.get(pid);
          if (!targets || targets.length === 0) continue;
          // Barycentre des positions des partenaires connus → un seul
          // angle préféré (et si plusieurs partenaires, c'est le compromis
          // qui minimise les liens longs).
          let sx = 0, sy = 0, count = 0;
          for (const tid of targets) {
            const tp = positions.get(tid);
            if (!tp) continue;
            sx += tp.x; sy += tp.y; count++;
          }
          if (count === 0) continue;
          const cx = sx / count, cy = sy / count;
          const dx = cx - starPos.x;
          const dy = cy - starPos.y;
          if (dx === 0 && dy === 0) continue;
          preferredAngleByPlanet.set(pid, normalizeAngle(Math.atan2(dy, dx)));
        }
      }

      const computeMasks = (r: number): Array<[number, number]> => {
        const masks: Array<[number, number]> = [];
        // Voisins = autres étoiles (dossiers) de la galaxie.
        for (const otherId of galaxyDossiers) {
          if (otherId === starId) continue;
          const op = positions.get(otherId);
          if (!op) continue;
          const dx = op.x - starPos.x;
          const dy = op.y - starPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist > r * NEIGHBOR_MASK_RANGE_RATIO) continue;
          const theta = Math.atan2(dy, dx);
          // Masque directionnel original (proximité du voisin → planètes
          // poussées de l'autre côté). Reste utile pour la respiration
          // visuelle même quand la géométrie n'imposerait rien.
          const proximity = Math.max(0, 1 - dist / (r * NEIGHBOR_MASK_RANGE_RATIO));
          const directionalHalf = NEIGHBOR_MASK_HALF_WIDTH * (1 + proximity);
          // Masque géométrique exact : arc d'angles autour de θ pour
          // lesquels la planète posée à (star + r·(cos a, sin a)) tombe
          // dans le disque de rayon (R_voisin + buffer) autour du voisin.
          //   Distance² planète↔voisin = r² + D² − 2rD·cos(a−θ)
          //   Interdit ssi cette distance < R²
          //   ⇔ cos(a−θ) > (r² + D² − R²) / (2rD)
          // Capé à FOREIGN_DOSSIER_MASK_MAX_HALF_WIDTH pour ne pas
          // condamner une étoile cernée par 3 dossiers à 0 angle libre.
          const otherNode = nodeById.get(otherId);
          let geometricHalf = 0;
          if (otherNode && options.collisionRadiusOf) {
            const R = options.collisionRadiusOf(otherNode) + FOREIGN_DOSSIER_BUFFER;
            const cosThreshold = (r * r + dist * dist - R * R) / (2 * r * dist);
            if (cosThreshold < 1) {
              // cosThreshold ≤ −1 = anneau entièrement dedans : on
              // mettrait π → on cape juste après.
              const raw = cosThreshold <= -1 ? Math.PI : Math.acos(cosThreshold);
              geometricHalf = Math.min(raw, FOREIGN_DOSSIER_MASK_MAX_HALF_WIDTH);
            }
          }
          const halfWidth = Math.max(directionalHalf, geometricHalf);
          masks.push([theta - halfWidth, theta + halfWidth]);
        }
        // Comètes (MEC partagés) de la galaxie : elles vivent au barycentre
        // de leurs dossiers, donc parfois sur l'anneau cible d'une planète.
        // Sans masquage on a vu deux MEC s'empiler visuellement ("noms de
        // mis en cause qui se superposent"). On masque un petit secteur
        // angulaire centré sur la comète quand elle se trouve dans la zone
        // de l'anneau.
        for (const cometId of galaxy.cometMecIds) {
          const cp = positions.get(cometId);
          if (!cp) continue;
          const dx = cp.x - starPos.x;
          const dy = cp.y - starPos.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 1 || dist > r * NEIGHBOR_MASK_RANGE_RATIO) continue;
          const theta = Math.atan2(dy, dx);
          // Masque proportionnel à la taille visuelle (estimée) de la
          // comète : on bloque un cône qui équivaut à un diamètre de
          // planète sur l'anneau le plus représentatif. Toujours capé
          // pour ne pas dévorer un demi-cercle.
          const halfWidth = Math.min(
            NEIGHBOR_MASK_HALF_WIDTH,
            Math.atan2(maxPlanetDiameter / 2, dist),
          );
          masks.push([theta - halfWidth, theta + halfWidth]);
        }
        return masks;
      };

      // Masque "estimation" : sert UNIQUEMENT au calcul de capacité
      // d'anneau (combien de planètes par anneau). Calculé au rayon
      // max pour capter tous les voisins. La passe de placement utilise
      // un masque RECALCULÉ par anneau (le masque géométrique d'un
      // dossier voisin dépend du rayon de l'anneau).
      const capacityMasks = computeMasks(MAX_RING_RADIUS);
      const unmaskedFraction = Math.max(0.08, computeUnmaskedFraction(capacityMasks));

      // ─── Construction multi-anneaux ────────────────────────────────
      // Au lieu de gonfler un seul anneau jusqu'à ce que toutes les
      // planètes tiennent (formule N×d/2π → ∞ quand N grandit ou que
      // les voisins masquent), on EMPILE des anneaux concentriques.
      // Chaque anneau est cappé à MAX_RING_RADIUS (sauf en dernier
      // recours, si le compte de planètes excède la capacité d'une
      // poignée d'anneaux) — une planète ne dérive donc plus à 1000 px
      // de son étoile, elle reste dans un disque ≤ ~500 px.
      const ringGap = maxPlanetDiameter * 1.1;
      // Rayon minimal = étoile (rayon de collision réel) + demi-diamètre
      // d'une planète + marge. Garantit qu'aucune planète n'empiète sur
      // la boîte du dossier, même quand la boîte est très large.
      const minRingRadius = Math.max(
        140,
        starRadius + maxPlanetDiameter / 2 + 20,
        maxPlanetDiameter,
      );
      const ringCapacity = (r: number): number => Math.max(
        1,
        Math.floor((2 * Math.PI * r * unmaskedFraction) / maxPlanetDiameter),
      );

      const ringRadii: number[] = [];
      const ringCapacities: number[] = [];
      let remaining = planets.length;
      let nextRadius = minRingRadius;
      // Plafond logiciel : 8 anneaux suffisent pour des systèmes
      // pathologiques (≈ 200+ planètes). Au-delà, on dépasse MAX
      // plutôt que d'empiler à l'infini.
      while (remaining > 0 && ringRadii.length < 8) {
        const r = Math.min(nextRadius, MAX_RING_RADIUS);
        const cap = ringCapacity(r);
        ringRadii.push(r);
        ringCapacities.push(Math.min(cap, remaining));
        remaining -= cap;
        nextRadius += ringGap;
        // Une fois MAX atteint, les anneaux suivants doivent pousser
        // plus loin pour ne pas se confondre — sinon deux anneaux à
        // MAX_RING_RADIUS se superposeraient.
        if (r >= MAX_RING_RADIUS) nextRadius = MAX_RING_RADIUS + ringRadii.length * ringGap;
      }
      // Si remaining > 0, on a vraiment trop de planètes : on étend
      // un dernier anneau en débordement plutôt que de jeter des nœuds.
      if (remaining > 0) {
        ringCapacities[ringCapacities.length - 1] += remaining;
      }

      // Distribution des planètes : on remplit anneau par anneau dans
      // l'ordre fourni (les angles préférés/cachés seront triés ensuite
      // dans la boucle de placement).
      const ringAssignments: Array<{ radius: number; planets: string[] }> = [];
      let cursor = 0;
      for (let i = 0; i < ringRadii.length; i++) {
        const slice = planets.slice(cursor, cursor + ringCapacities[i]);
        if (slice.length === 0) continue;
        ringAssignments.push({ radius: ringRadii[i], planets: slice });
        cursor += slice.length;
      }

      for (const ring of ringAssignments) {
        // Masque recalculé spécifiquement pour ce rayon : un dossier
        // voisin large impose une fenêtre interdite plus ou moins
        // grande selon la distance et le rayon de l'anneau.
        const ringMasks = computeMasks(ring.radius);
        // Préserve les angles en cache compatibles avec les secteurs libres.
        const preserved: Array<{ id: string; angle: number }> = [];
        const remaining: string[] = [];
        for (const pid of ring.planets) {
          const cached = cachedAngleByMecId?.get(pid);
          // Si la planète a un partenaire renseignement, on ne préserve
          // le cache que s'il est déjà proche de la direction préférée :
          // sinon on rebascule pour la rapprocher du partenaire.
          const preferred = preferredAngleByPlanet.get(pid);
          const cachedIsAcceptable = cached !== undefined
            && !isAngleMasked(cached, ringMasks)
            && (preferred === undefined
                || angleDistance(cached, preferred) <= RENSEIGNEMENT_PREFERRED_HALF_WIDTH * 2);
          if (cachedIsAcceptable) {
            preserved.push({ id: pid, angle: normalizeAngle(cached!) });
          } else {
            remaining.push(pid);
          }
        }
        // Tri des préservées par angle pour pouvoir intercaler les nouvelles
        // dans les écarts entre angles existants.
        preserved.sort((a, b) => a.angle - b.angle);

        // Ordre de placement des "remaining" : d'abord celles qui ont une
        // direction préférée (lien renseignement), pour qu'elles obtiennent
        // un secteur libre orienté vers leur partenaire avant que les
        // autres ne le prennent.
        remaining.sort((a, b) => {
          const ap = preferredAngleByPlanet.has(a) ? 0 : 1;
          const bp = preferredAngleByPlanet.has(b) ? 0 : 1;
          return ap - bp;
        });

        const placed = preserved.slice();
        for (const pid of remaining) {
          const preferred = preferredAngleByPlanet.get(pid);
          const ang = pickNextAngle(placed.map(p => p.angle), ringMasks, preferred);
          placed.push({ id: pid, angle: ang });
          placed.sort((a, b) => a.angle - b.angle);
        }

        for (const { id, angle } of placed) {
          positions.set(id, {
            x: starPos.x + Math.cos(angle) * ring.radius,
            y: starPos.y + Math.sin(angle) * ring.radius,
          });
          newAngles.set(id, angle);
        }
      }
    }
  }
  return newAngles;
}

// ──────────────────────────────────────────────────────────────────────
// NODE-SAT POST-PASS (anti-recouvrement bulle-à-bulle)
// ──────────────────────────────────────────────────────────────────────

/** Padding (px) ajouté aux rayons de collision pendant la passe node-SAT.
 *  Garantit un petit halo entre deux bulles, même quand elles se touchent
 *  juste — sinon les contours noirs des MECs se confondent. */
const NODE_SAT_PADDING = 10;
/** Itérations max de la passe node-SAT. La séparation est itérative car
 *  bouger un nœud peut créer un nouveau chevauchement avec un 3ème. */
const NODE_SAT_MAX_ITER = 60;

export interface NodeSatOptions {
  /** Index de galaxie par node id. Requis pour appliquer le buffer
   *  foreignDossierBuffer. */
  galaxyIdxByNodeId?: Map<string, number>;
  /** Pour chaque MEC, les ids de dossier qui sont ses parents (typique :
   *  1 parent pour une planète, ≥2 pour une comète). */
  parentDossiersByMecId?: Map<string, Set<string>>;
  /** Prédicat : true si l'id désigne un dossier. */
  isDossier?: (id: string) => boolean;
  /** Padding additionnel pour les paires MEC ↔ dossier *non-parent* de la
   *  même galaxie. Quand on a une planète qui dérive vers un autre dossier
   *  de sa galaxie, ce buffer la fait reculer franchement pour qu'il soit
   *  visuellement évident qu'elle n'appartient pas à ce dossier-là.
   *  0 = comportement par défaut (juste le NODE_SAT_PADDING). */
  foreignDossierBuffer?: number;
}

/**
 * Relaxation finale au niveau du nœud individuel : garantit qu'aucune
 * paire de bulles (MEC ou dossier) ne se chevauche, peu importe ce que
 * l'orbital pass ou le hull-SAT inter-galactique ont laissé derrière.
 *
 * Mutation directe de `positions` (in-place). Pondération par taille
 * (inertie) : un gros dossier bouge peu, un petit MEC bouge beaucoup —
 * les comètes et les planètes glissent autour des étoiles plutôt que
 * l'inverse.
 *
 * Si `foreignDossierBuffer > 0` est fourni avec les maps associées, on
 * applique en plus un padding renforcé entre chaque MEC et les dossiers
 * de SA galaxie qui ne sont PAS ses parents → empêche une planète de se
 * coller à un dossier voisin.
 *
 * Complexité O(N² × iter). Pour N ≤ ~600 nœuds (typique de la
 * cartographie), reste sous 10 ms.
 */
export function nodeSatRelax(
  positions: Map<string, { x: number; y: number }>,
  nodeRadiusById: Map<string, number>,
  options: NodeSatOptions = {},
): void {
  const ids: string[] = [];
  for (const id of positions.keys()) {
    if (nodeRadiusById.has(id)) ids.push(id);
  }
  if (ids.length < 2) return;

  const foreignBuffer = options.foreignDossierBuffer ?? 0;
  const canCheckForeign = foreignBuffer > 0
    && !!options.galaxyIdxByNodeId
    && !!options.parentDossiersByMecId
    && !!options.isDossier;

  // Padding effectif pour la paire (idA, idB).
  const padFor = (idA: string, idB: string): number => {
    if (!canCheckForeign) return NODE_SAT_PADDING;
    const aIsD = options.isDossier!(idA);
    const bIsD = options.isDossier!(idB);
    if (aIsD === bIsD) return NODE_SAT_PADDING; // dossier↔dossier ou mec↔mec
    const mecId = aIsD ? idB : idA;
    const dossierId = aIsD ? idA : idB;
    const gA = options.galaxyIdxByNodeId!.get(idA);
    const gB = options.galaxyIdxByNodeId!.get(idB);
    if (gA === undefined || gA !== gB) return NODE_SAT_PADDING; // pas même galaxie
    const parents = options.parentDossiersByMecId!.get(mecId);
    if (parents && parents.has(dossierId)) return NODE_SAT_PADDING; // c'est son parent
    return NODE_SAT_PADDING + foreignBuffer;
  };

  for (let iter = 0; iter < NODE_SAT_MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i];
      const pa = positions.get(idA)!;
      const ra = nodeRadiusById.get(idA)!;
      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j];
        const pb = positions.get(idB)!;
        const rb = nodeRadiusById.get(idB)!;
        let vx = pb.x - pa.x;
        let vy = pb.y - pa.y;
        let d2 = vx * vx + vy * vy;
        const minDist = ra + rb + padFor(idA, idB);
        if (d2 >= minDist * minDist) continue;
        if (d2 < 0.0001) {
          // Centres confondus : direction déterministe pour décoller.
          vx = Math.cos(i * 31 + j);
          vy = Math.sin(i * 31 + j);
          d2 = vx * vx + vy * vy;
        }
        const d = Math.sqrt(d2);
        const penetration = minDist - d;
        // Inertie : la grosse bulle bouge moins. Avec ra²/rb², un MEC de
        // r=40 face à un dossier r=180 absorbe 95 % du déplacement —
        // exactement ce qu'on veut visuellement.
        const totalSize = ra * ra + rb * rb;
        const shareA = (rb * rb) / totalSize;
        const shareB = (ra * ra) / totalSize;
        const ux = vx / d;
        const uy = vy / d;
        pa.x -= ux * penetration * shareA;
        pa.y -= uy * penetration * shareA;
        pb.x += ux * penetration * shareB;
        pb.y += uy * penetration * shareB;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** Distance angulaire absolue entre deux angles (rad), wrap-around. */
function angleDistance(a: number, b: number): number {
  const na = normalizeAngle(a);
  const nb = normalizeAngle(b);
  const d = Math.abs(na - nb);
  return Math.min(d, 2 * Math.PI - d);
}

/** Normalise un angle dans [0, 2π[. */
function normalizeAngle(a: number): number {
  const TWO_PI = 2 * Math.PI;
  let x = a % TWO_PI;
  if (x < 0) x += TWO_PI;
  return x;
}

/** Vrai si l'angle (rad) tombe dans l'un des secteurs masqués. */
function isAngleMasked(angle: number, masks: Array<[number, number]>): boolean {
  const a = normalizeAngle(angle);
  const TWO_PI = 2 * Math.PI;
  for (const [lo, hi] of masks) {
    // Le secteur peut chevaucher 2π → on teste sur la version normalisée.
    const nlo = normalizeAngle(lo);
    const nhi = normalizeAngle(hi);
    if (nlo <= nhi) {
      if (a >= nlo && a <= nhi) return true;
    } else {
      // Secteur qui enjambe l'origine (ex. 350° → 10°)
      if (a >= nlo || a <= nhi) return true;
    }
    // Cas non-normalisé original : intervalle simple si large
    if (hi - lo < TWO_PI && angle >= lo && angle <= hi) return true;
  }
  return false;
}

/** Calcule la fraction du cercle [0, 2π] non couverte par les secteurs. */
function computeUnmaskedFraction(masks: Array<[number, number]>): number {
  if (masks.length === 0) return 1;
  // On échantillonne le cercle pour une mesure robuste face aux
  // chevauchements de secteurs (résolution 1° → 360 points).
  const samples = 360;
  let free = 0;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    if (!isAngleMasked(a, masks)) free++;
  }
  return free / samples;
}

/** Choisit le prochain angle pour une planète. Combine deux objectifs :
 *   - maximiser la distance au voisin le plus proche (étalement)
 *   - rester proche d'une direction préférée si fournie (lien
 *     renseignement vers un partenaire externe au système). Quand la
 *     préférence est exprimée, on cherche d'abord un angle libre dans la
 *     fenêtre ±RENSEIGNEMENT_PREFERRED_HALF_WIDTH ; à défaut on tombe
 *     sur le pur étalement.
 *  Toujours en évitant les secteurs masqués (direction d'un voisin
 *  proche). */
function pickNextAngle(
  existing: number[],
  masks: Array<[number, number]>,
  preferredAngle?: number,
): number {
  const samples = 360;
  // 1. Si une direction préférée est donnée : on cherche dans la fenêtre
  //    préférée l'angle qui maximise l'écart aux voisins. Si la fenêtre
  //    est entièrement masquée ou collée à un voisin (<MIN_PLANET_ARC_GAP),
  //    on retombe sur le pur étalement.
  if (preferredAngle !== undefined) {
    let bestPref = -1;
    let bestPrefAngle = preferredAngle;
    for (let i = 0; i < samples; i++) {
      const a = (i / samples) * 2 * Math.PI;
      if (isAngleMasked(a, masks)) continue;
      if (angleDistance(a, preferredAngle) > RENSEIGNEMENT_PREFERRED_HALF_WIDTH) continue;
      let minDist = Math.PI;
      for (const e of existing) {
        const d = angleDistance(a, e);
        if (d < minDist) minDist = d;
      }
      if (minDist < MIN_PLANET_ARC_GAP) continue;
      if (minDist > bestPref) { bestPref = minDist; bestPrefAngle = a; }
    }
    if (bestPref > 0) return bestPrefAngle;
  }

  // 2. Étalement classique : angle qui maximise la distance au plus proche.
  let bestAngle = 0;
  let bestScore = -1;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    if (isAngleMasked(a, masks)) continue;
    let minDist = Math.PI;
    for (const e of existing) {
      const d = angleDistance(a, e);
      if (d < minDist) minDist = d;
    }
    if (existing.length === 0) return a;
    if (minDist > bestScore) {
      bestScore = minDist;
      bestAngle = a;
    }
  }
  return bestAngle;
}

