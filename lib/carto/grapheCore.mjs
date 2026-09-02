/**
 * SIRAL — cartographie : ALGORITHMES DE GRAPHE.
 *
 * Trois calculs, choisis parce qu'ils répondent chacun à une question
 * d'enquête précise — et rien d'autre :
 *
 *  - CENTRALITÉ D'INTERMÉDIARITÉ (Brandes) : « par qui passent les chemins ? »
 *    Repère les courtiers — logisticiens, nourrices, intermédiaires — dont la
 *    neutralisation fragmente le réseau. Un chef prudent a peu de liens
 *    directs et une intermédiarité forte : le degré seul le manque.
 *
 *  - COMMUNAUTÉS (Louvain) : « où sont les cellules ? » Partitionne le graphe
 *    en sous-groupes densément liés, objectivement — là où les « camps » de la
 *    carte sont cochés à la main.
 *
 *  - PLUS COURTS CHEMINS : « qu'est-ce qui relie X à Y ? » Rend le ou les
 *    chemins les plus courts, arête par arête, pour que chaque saut puisse
 *    être cité (dossier partagé, lien de renseignement).
 *
 * Module PUR : aucune dépendance. Entrées :
 *  - `ids` : identifiants de nœuds (ordre d'entrée = ordre déterministe) ;
 *  - `aretes` : [{ a, b, poids? }] non orientées (poids par défaut 1).
 * Les calculs sont O(V·E) (Brandes) et quasi linéaires (Louvain) : très
 * au-dessus des besoins d'un fonds de quelques milliers de personnes.
 */

/** Adjacence Map id → Map(voisin → poids), en fusionnant les doublons. */
export function adjacence(ids, aretes) {
  const adj = new Map()
  for (const id of ids) adj.set(id, new Map())
  for (const { a, b, poids = 1 } of aretes) {
    if (a === b) continue
    if (!adj.has(a) || !adj.has(b)) continue
    adj.get(a).set(b, (adj.get(a).get(b) || 0) + poids)
    adj.get(b).set(a, (adj.get(b).get(a) || 0) + poids)
  }
  return adj
}

/**
 * Centralité d'intermédiarité (Brandes, non pondérée, graphe non orienté).
 * Renvoie Map id → valeur brute (non normalisée — seul l'ordre compte ici).
 */
export function centraliteIntermediaire(ids, aretes) {
  const adj = adjacence(ids, aretes)
  const cb = new Map(ids.map((id) => [id, 0]))
  for (const s of ids) {
    const pile = []
    const pred = new Map(ids.map((id) => [id, []]))
    const sigma = new Map(ids.map((id) => [id, 0]))
    const dist = new Map(ids.map((id) => [id, -1]))
    sigma.set(s, 1)
    dist.set(s, 0)
    const file = [s]
    while (file.length > 0) {
      const v = file.shift()
      pile.push(v)
      for (const w of adj.get(v).keys()) {
        if (dist.get(w) < 0) {
          dist.set(w, dist.get(v) + 1)
          file.push(w)
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v))
          pred.get(w).push(v)
        }
      }
    }
    const delta = new Map(ids.map((id) => [id, 0]))
    while (pile.length > 0) {
      const w = pile.pop()
      for (const v of pred.get(w)) {
        delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)))
      }
      if (w !== s) cb.set(w, cb.get(w) + delta.get(w))
    }
  }
  // Graphe non orienté : chaque paire (s,t) est comptée deux fois.
  for (const [id, v] of cb) cb.set(id, v / 2)
  return cb
}

/**
 * Détection de communautés — méthode de Louvain (modularité, pondérée),
 * déterministe (parcours dans l'ordre des ids). Renvoie Map id → numéro de
 * communauté (0..n-1, numérotées par taille décroissante).
 */
export function communautesLouvain(ids, aretes) {
  // État courant : chaque nœud du graphe AGRÉGÉ représente un ensemble d'ids.
  let noeuds = ids.map((id) => [id])
  let liens = []
  {
    const index = new Map(ids.map((id, i) => [id, i]))
    const cumul = new Map()
    for (const { a, b, poids = 1 } of aretes) {
      const ia = index.get(a)
      const ib = index.get(b)
      if (ia === undefined || ib === undefined || ia === ib) continue
      const cle = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`
      cumul.set(cle, (cumul.get(cle) || 0) + poids)
    }
    liens = [...cumul.entries()].map(([cle, poids]) => {
      const [ia, ib] = cle.split('|').map(Number)
      return { a: ia, b: ib, poids }
    })
  }

  for (let niveau = 0; niveau < 10; niveau++) {
    const n = noeuds.length
    const voisins = Array.from({ length: n }, () => new Map())
    let m2 = 0 // somme des poids × 2
    const degre = new Array(n).fill(0)
    for (const { a, b, poids } of liens) {
      if (a === b) {
        // Boucle (poids interne d'une communauté agrégée) : compte double dans
        // le degré, ne crée pas de voisinage — elle suit le nœud où qu'il
        // aille, donc s'annule dans la comparaison des communautés candidates.
        degre[a] += 2 * poids
        m2 += 2 * poids
        continue
      }
      voisins[a].set(b, (voisins[a].get(b) || 0) + poids)
      voisins[b].set(a, (voisins[b].get(a) || 0) + poids)
      degre[a] += poids
      degre[b] += poids
      m2 += 2 * poids
    }
    if (m2 === 0) break

    const commu = Array.from({ length: n }, (_, i) => i)
    const degreCommu = degre.slice() // somme des degrés de chaque communauté

    // Phase 1 : déplacements locaux jusqu'à stabilité. Gain de modularité de
    // placer v (retiré de sa communauté) dans c, à facteur constant près :
    //   ΔQ(c) ∝ k_{v→c} − k_v · Σtot_c / 2m
    let bouge = true
    let ameliore = false
    let gardeFou = 0
    while (bouge && gardeFou++ < 100) {
      bouge = false
      for (let v = 0; v < n; v++) {
        const cOrig = commu[v]
        // Poids de v vers chaque communauté voisine.
        const versCommu = new Map()
        for (const [w, poids] of voisins[v]) {
          versCommu.set(commu[w], (versCommu.get(commu[w]) || 0) + poids)
        }
        degreCommu[cOrig] -= degre[v] // v retiré avant de comparer
        const gainDe = (c) => (versCommu.get(c) || 0) - (degre[v] * degreCommu[c]) / m2
        let meilleure = cOrig
        let meilleurGain = gainDe(cOrig)
        for (const c of versCommu.keys()) {
          if (c === cOrig) continue
          const gain = gainDe(c)
          if (gain > meilleurGain + 1e-12) {
            meilleurGain = gain
            meilleure = c
          }
        }
        commu[v] = meilleure
        degreCommu[meilleure] += degre[v]
        if (meilleure !== cOrig) { bouge = true; ameliore = true }
      }
    }
    if (!ameliore) break

    // Phase 2 : agrégation — chaque communauté devient un nœud.
    const renum = new Map()
    for (let v = 0; v < n; v++) {
      if (!renum.has(commu[v])) renum.set(commu[v], renum.size)
    }
    const prochains = Array.from({ length: renum.size }, () => [])
    for (let v = 0; v < n; v++) {
      prochains[renum.get(commu[v])].push(...noeuds[v])
    }
    const cumul = new Map()
    for (const { a, b, poids } of liens) {
      const ca = renum.get(commu[a])
      const cb = renum.get(commu[b])
      // Les arêtes internes deviennent des BOUCLES du super-nœud : les jeter
      // fausserait son degré et ferait tout fusionner au niveau suivant.
      const cle = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`
      cumul.set(cle, (cumul.get(cle) || 0) + poids)
    }
    noeuds = prochains
    liens = [...cumul.entries()].map(([cle, poids]) => {
      const [a, b] = cle.split('|').map(Number)
      return { a, b, poids }
    })
    if (noeuds.length === n) break
  }

  // Numérotation par taille décroissante (stable pour l'affichage).
  const parTaille = noeuds
    .map((membres, i) => ({ membres, i }))
    .sort((x, y) => y.membres.length - x.membres.length || x.i - y.i)
  const resultat = new Map()
  parTaille.forEach(({ membres }, rang) => {
    for (const id of membres) resultat.set(id, rang)
  })
  return resultat
}

/**
 * Plus courts chemins entre deux nœuds (BFS, non pondéré). Renvoie jusqu'à
 * `max` chemins de longueur minimale, chacun sous forme de liste d'ids —
 * l'appelant habille chaque saut avec sa provenance (dossier partagé, lien).
 * Renvoie [] si les deux nœuds ne sont pas reliés.
 */
export function plusCourtsChemins(ids, aretes, de, vers, { max = 3 } = {}) {
  if (de === vers) return [[de]]
  const adj = adjacence(ids, aretes)
  if (!adj.has(de) || !adj.has(vers)) return []

  // BFS depuis `de` : distance + prédécesseurs sur les plus courts chemins.
  const dist = new Map([[de, 0]])
  const pred = new Map()
  const file = [de]
  while (file.length > 0) {
    const v = file.shift()
    if (dist.get(v) >= (dist.get(vers) ?? Infinity)) continue
    for (const w of adj.get(v).keys()) {
      if (!dist.has(w)) {
        dist.set(w, dist.get(v) + 1)
        pred.set(w, [v])
        file.push(w)
      } else if (dist.get(w) === dist.get(v) + 1) {
        pred.get(w).push(v)
      }
    }
  }
  if (!dist.has(vers)) return []

  // Remontée des prédécesseurs — au plus `max` chemins, ordre déterministe.
  const chemins = []
  const remonte = (noeud, suffixe) => {
    if (chemins.length >= max) return
    if (noeud === de) {
      chemins.push([de, ...suffixe])
      return
    }
    for (const p of pred.get(noeud) || []) {
      remonte(p, [noeud, ...suffixe])
      if (chemins.length >= max) return
    }
  }
  remonte(vers, [])
  return chemins
}
