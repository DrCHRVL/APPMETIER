/**
 * SIRAL — identité des personnes : normalisation et rapprochement des noms.
 *
 * SOURCE UNIQUE des règles qui décident que « VANHOVE Kévin », « Kévin
 * VANHOVE » et « VANHOVE Kevin » désignent la même personne. Partagée par :
 *  - la cartographie de l'application (utils/mindmapGraph.ts, qui ne fait plus
 *    que les ré-exporter avec leur typage) ;
 *  - le moteur de recoupements (lib/recoupements/moteurCore.mjs) ;
 *  - le service attaché, qui exécute ce moteur côté serveur.
 *
 * Que la carte et les recoupements fusionnent EXACTEMENT les mêmes identités
 * n'est pas un détail : c'est ce qui permet à la veille de dire « ce pont-là
 * est inédit » sans annoncer un lien que la carte trace déjà.
 *
 * Module PUR : aucune dépendance, aucun accès au navigateur.
 */

/**
 * Nom réduit à sa forme comparable : minuscules, sans accents, ponctuation
 * ramenée à l'espace.
 */
export function normalizeMecName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clé d'identité insensible à l'ordre des mots : « VANHOVE Kévin » et
 * « Kévin VANHOVE » partagent la même clé. Sert à fusionner les nœuds MEC
 * saisis avec des conventions Nom/Prénom différentes selon les dossiers.
 */
export function mecSortedKey(name) {
  const canonical = normalizeMecName(name)
  if (!canonical) return ''
  return canonical.split(' ').sort().join(' ')
}

/**
 * Code phonétique SIMPLIFIÉ d'un mot (français, translittérations usuelles) :
 * « yacine »/« yassine », « belkacem »/« belkassem », « mohamed »/« mouhamed »
 * partagent le même code. Volontairement grossier — il ne sert JAMAIS seul :
 * l'égalité phonétique n'autorise un rapprochement que sous les garde-fous de
 * `tokensAlmostEqual` (longueur, distance d'édition, même début de mot).
 * `null` pour les mots courts (< 5) ou porteurs de chiffres (pseudos).
 */
export function phonetiqueFr(token) {
  if (token.length < 5 || /\d/.test(token)) return null
  const s = token
    .replace(/ph/g, 'f')
    .replace(/(?:sch|ch|sh)/g, '5') // son « ch », quelle qu'en soit la graphie
    .replace(/qu?/g, 'k')
    .replace(/gu(?=[eiy])/g, 'g')
    .replace(/dj/g, 'j')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1')
  if (!s) return null
  // Façon Soundex : première lettre conservée, voyelles suivantes retirées.
  const code = (s[0] + s.slice(1).replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1')
  return code
}

/** Distance de Levenshtein, plafonnée (les mots comparés sont courts). */
function editDistance(a, b) {
  const la = a.length
  const lb = b.length
  let prev = Array.from({ length: lb + 1 }, (_, j) => j)
  for (let i = 1; i <= la; i++) {
    const cur = [i]
    for (let j = 1; j <= lb; j++) {
      cur.push(Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      ))
    }
    prev = cur
  }
  return prev[lb]
}

/**
 * Deux mots désignent-ils très probablement le même nom ?
 *  - distance d'édition ≤ 1 (« miky »/« micky », « carol »/« carole ») —
 *    réservée aux mots d'au moins 4 caractères pour ne pas confondre des
 *    particules ou des initiales courtes (« de »/« le », « j »/« p ») ;
 *  - OU même code phonétique (« yacine »/« yassine ») — sous trois garde-fous
 *    cumulés, parce qu'une fusion d'identités à tort coûte cher : mots d'au
 *    moins 5 caractères, deux premières lettres identiques, distance
 *    d'édition ≤ 2. « MARTIN »/« MORTAIN » ne fusionnent pas (débuts
 *    différents), « KEVIN »/« KELVIN » non plus (codes différents).
 */
function tokensAlmostEqual(a, b) {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 4) return false
  if (Math.abs(a.length - b.length) <= 1) {
    let i = 0
    while (i < a.length && i < b.length && a[i] === b[i]) i++
    if (a.length === b.length) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true // substitution
    } else {
      const [long, short] = a.length > b.length ? [a, b] : [b, a]
      if (long.slice(i + 1) === short.slice(i)) return true // insertion / suppression
    }
  }
  // Voie phonétique, étroitement bornée.
  if (Math.min(a.length, b.length) < 5) return false
  if (Math.abs(a.length - b.length) > 2) return false
  if (a[0] !== b[0] || a[1] !== b[1]) return false
  const pa = phonetiqueFr(a)
  if (!pa || pa !== phonetiqueFr(b)) return false
  return editDistance(a, b) <= 2
}

/**
 * Apparie chaque mot de `a` à un mot (ou deux mots adjacents recollés) de `b`,
 * sans réutilisation. `mustCoverB` exige que tous les mots de `b` soient
 * consommés (comparaison complète) ; sinon `a` peut être un sous-ensemble.
 * Backtracking — les noms font au plus cinq ou six mots, coût négligeable.
 */
function coverTokens(a, b, mustCoverB) {
  const used = new Array(b.length).fill(false)
  const step = (i) => {
    if (i >= a.length) return !mustCoverB || used.every(Boolean)
    for (let j = 0; j < b.length; j++) {
      if (used[j]) continue
      // mot ↔ mot (tolérance d'une coquille)
      if (tokensAlmostEqual(a[i], b[j])) {
        used[j] = true
        if (step(i + 1)) return true
        used[j] = false
      }
      // composé recollé côté a : « rosemarie » ↔ « rose » + « marie »
      if (j + 1 < b.length && !used[j + 1] && a[i] === b[j] + b[j + 1]) {
        used[j] = used[j + 1] = true
        if (step(i + 1)) return true
        used[j] = used[j + 1] = false
      }
    }
    // composé recollé côté b : « rose » + « marie » ↔ « rosemarie »
    if (i + 1 < a.length) {
      const merged = a[i] + a[i + 1]
      for (let j = 0; j < b.length; j++) {
        if (used[j]) continue
        if (merged === b[j]) {
          used[j] = true
          if (step(i + 2)) return true
          used[j] = false
        }
      }
    }
    return false
  }
  return step(0)
}

/**
 * Vrai si deux noms désignent très probablement la même personne :
 *   - mêmes mots dans un ordre différent (« VANHOVE Kévin » / « Kévin VANHOVE ») ;
 *   - une coquille par mot tolérée (« Micky »/« Miky », « Carole »/« Carol ») ;
 *   - graphies phonétiquement équivalentes d'un même nom, étroitement
 *     bornées (« Yacine »/« Yassine », « Belkacem »/« Belkassem ») ;
 *   - mots composés recollés (« Rose-Marie » / « Rosemarie ») ;
 *   - avec `allowSubset` : nom partiel inclus dans le nom complet
 *     (« Shannon » ⊂ « MELLAH MAGREZ Shannon ») — à réserver aux contextes où
 *     l'appelant lève l'ambiguïté (un seul candidat possible).
 */
export function sameMecPerson(a, b, opts) {
  const na = normalizeMecName(a)
  const nb = normalizeMecName(b)
  if (!na || !nb) return false
  return sameMecPersonTokens(na.split(' '), nb.split(' '), opts)
}

/**
 * Même règle que `sameMecPerson`, pour des noms DÉJÀ normalisés et découpés
 * (`normalizeMecName(nom).split(' ')`).
 *
 * Le moteur de recoupements compare des dizaines de milliers de paires de
 * noms : renormaliser les deux côtés à chaque comparaison coûte plus cher que
 * la comparaison elle-même. L'appelant normalise une fois par nom, puis compare.
 */
export function sameMecPersonTokens(ta, tb, opts) {
  if (ta.length === 0 || tb.length === 0 || !ta[0] || !tb[0]) return false
  if (ta.length === tb.length && ta.every((t, i) => t === tb[i])) return true
  const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return coverTokens(shortT, longT, !opts?.allowSubset)
}
