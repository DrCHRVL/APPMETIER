/**
 * SIRAL — Attaché de justice · diff textuel ligne à ligne (sans dépendance).
 *
 * Sert à faire COMPRENDRE à l'attaché ce que le magistrat a changé de sa main
 * dans un acte (avant = le jet de l'attaché, après = la correction du
 * magistrat). Sortie compacte façon « unified diff » : « - » retiré, « + »
 * ajouté, contexte réduit, bornée en caractères pour rester économe dans le
 * prompt de consolidation d'apprentissage.
 */

// Au-delà, on renonce au DP quadratique (acte hors gabarit) et on résume.
const MAX_LIGNES = 1500

function enLignes(s) {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n').split('\n')
}

/** Table LCS (longueurs de plus longue sous-séquence commune) entre lignes. */
function lcs(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    const next = dp[i + 1]
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1])
    }
  }
  return dp
}

/**
 * Diff unifié compact entre `avant` et `apres`.
 * Rend { diff, ajouts, retraits, tronque, identique } — `diff` prêt à lire.
 * `contexte` : nombre de lignes inchangées gardées autour de chaque bloc modifié.
 */
export function diffTexte(avant, apres, { budget = 3000, contexte = 2 } = {}) {
  const a = enLignes(avant)
  const b = enLignes(apres)
  if ((avant ?? '') === (apres ?? '')) {
    return { diff: '', ajouts: 0, retraits: 0, tronque: false, identique: true }
  }
  if (a.length > MAX_LIGNES || b.length > MAX_LIGNES) {
    // Acte trop long pour un diff ligne à ligne raisonnable : résumé grossier.
    const da = String(apres || '').length - String(avant || '').length
    return {
      diff: `Acte volumineux (${a.length} → ${b.length} lignes, ${da >= 0 ? '+' : ''}${da} caractères) : `
        + 'diff détaillé non produit — relis la version courante (production_lire) pour situer la correction.',
      ajouts: 0,
      retraits: 0,
      tronque: true,
      identique: false,
    }
  }

  const dp = lcs(a, b)
  const ops = [] // { t: ' '|'-'|'+', line }
  let i = 0
  let j = 0
  let ajouts = 0
  let retraits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ t: ' ', line: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: '-', line: a[i] }); i++; retraits++ }
    else { ops.push({ t: '+', line: b[j] }); j++; ajouts++ }
  }
  while (i < a.length) { ops.push({ t: '-', line: a[i++] }); retraits++ }
  while (j < b.length) { ops.push({ t: '+', line: b[j++] }); ajouts++ }

  if (ajouts + retraits === 0) {
    return { diff: '', ajouts: 0, retraits: 0, tronque: false, identique: true }
  }

  // Ne garder que les blocs modifiés + `contexte` lignes inchangées autour.
  const keep = new Array(ops.length).fill(false)
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t !== ' ') {
      for (let d = -contexte; d <= contexte; d++) {
        const idx = k + d
        if (idx >= 0 && idx < ops.length) keep[idx] = true
      }
    }
  }
  const out = []
  let elided = 0
  const flushElided = () => {
    if (elided > 0) { out.push(`  … (${elided} ligne${elided > 1 ? 's' : ''} inchangée${elided > 1 ? 's' : ''})`); elided = 0 }
  }
  for (let k = 0; k < ops.length; k++) {
    if (keep[k]) {
      flushElided()
      out.push((ops[k].t === ' ' ? '  ' : ops[k].t + ' ') + ops[k].line)
    } else {
      elided++
    }
  }
  flushElided()

  let diff = out.join('\n')
  let tronque = false
  if (diff.length > budget) { diff = diff.slice(0, budget) + '\n… (diff tronqué — l\'essentiel de la correction est ci-dessus)'; tronque = true }
  return { diff, ajouts, retraits, tronque, identique: false }
}
