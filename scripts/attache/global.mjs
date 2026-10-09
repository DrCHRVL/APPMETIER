/**
 * SIRAL — Attaché de justice · FICHIER GLOBAL d'un dossier.
 *
 * La philosophie du « convertisseur PDF → TXT » du cabinet : toutes les
 * pièces d'un dossier, en TEXTE, dans UN SEUL fichier — un sommaire, puis
 * un bloc par pièce, séparé par une ligne de « = ». Un fichier que Claude web
 * exploite directement (réquisitoire définitif, synthèse, recherche
 * transversale), sans chantier, sans lots, sans nuit.
 *
 * Rien n'est ré-extrait pour lui : la compilation lit ce que l'ingestion de
 * fond a déjà produit (copies markdown du téléversement, caches d'extraction,
 * OCR des scans muets) et n'extrait à la volée qu'un nombre borné de pièces
 * par appel — les suivantes sont listées « non disponibles » et le seront au
 * passage suivant (chaque appel étend le cache, définitivement).
 *
 * Deux consommateurs, un seul texte :
 *  - le connecteur Claude web (outil dossier_global), PAGINÉ par caractères :
 *    une page à la fois, offsetSuivant pour la suite ;
 *  - la page Assistant de justice (GET /dossier-global), qui télécharge le
 *    fichier entier (.txt) pour le verser dans un projet Claude web.
 */
import { attacheTj, listDocsMeta, docServerKey } from './store.mjs'
import { numeroCanonique, texteDocumentIntegral } from './dossier.mjs'

/** Extractions fraîches par appel : un scan OCR coûte des minutes de CPU. */
export const GLOBAL_EXTRACTIONS_MAX = 20
/** Page servie au connecteur (caractères) — sous le plafond de sortie du connecteur. */
const GLOBAL_PAGE_MAX = 350_000
/** Garde-fou absolu sur le fichier assemblé (un dossier de 1 000 pièces reste servi). */
const GLOBAL_TEXTE_MAX = 60_000_000

const SEP = '='.repeat(80)

/**
 * Compile le fichier global d'un dossier (enquête ou instruction).
 * `pochette` limite à une pochette de l'arborescence ; `extraire` borne les
 * extractions fraîches (0 = ne servir que ce qui est déjà disponible).
 * Rend { texte, sommaire, stats } — `texte` est le fichier complet.
 */
export async function compilerFichierGlobal(keys, numero, { pochette, extraire = GLOBAL_EXTRACTIONS_MAX } = {}) {
  const canon = numeroCanonique(keys, numero)
  const key = docServerKey(canon)
  const metas = listDocsMeta(attacheTj(), key).filter((d) => !String(d.rel).startsWith('MD/'))
  const filtre = String(pochette || '').replace(/\/+$/, '')
  const ciblees = (filtre
    ? metas.filter((d) => d.rel === filtre || String(d.rel).startsWith(filtre + '/'))
    : metas
  ).sort((a, b) => String(a.rel).localeCompare(String(b.rel)))

  // Doublons EXACTS (même empreinte sha256) : le premier par ordre de chemin
  // porte le texte, les copies sont signalées d'une ligne — jamais répétées.
  const porteurParSha = new Map()
  const entrees = []
  let extractions = 0
  let caracteres = 0
  for (const d of ciblees) {
    const rel = String(d.rel)
    const sha = String(d.sha || '')
    if (/^[a-f0-9]{64}$/.test(sha)) {
      const porteur = porteurParSha.get(sha)
      if (porteur) { entrees.push({ rel, copieDe: porteur }); continue }
      porteurParSha.set(sha, rel)
    }
    // D'abord ce qui existe déjà ; sinon extraction fraîche, bornée.
    let res = await texteDocumentIntegral(keys, key, rel, { extraire: false }).catch(() => ({ ok: false }))
    if (!res.ok && res.nonExtrait) {
      if (extractions < extraire) {
        extractions++
        res = await texteDocumentIntegral(keys, key, rel).catch(() => ({ ok: false }))
      } else {
        entrees.push({ rel, nonExtraite: true })
        continue
      }
    }
    if (!res.ok) { entrees.push({ rel, erreur: String(res.error || 'texte indisponible'), scanned: Boolean(res.scanned) }); continue }
    const texte = String(res.texte || '').trim()
    caracteres += texte.length
    entrees.push({ rel, texte, pagesImagesNonLues: res.extra?.pagesImagesNonLues || 0 })
    if (caracteres > GLOBAL_TEXTE_MAX) break
  }

  const lisibles = entrees.filter((e) => e.texte != null)
  const copies = entrees.filter((e) => e.copieDe)
  const nonExtraites = entrees.filter((e) => e.nonExtraite)
  const illisibles = entrees.filter((e) => e.erreur)
  const sommaire = entrees.map((e, i) => {
    const n = String(i + 1).padStart(String(entrees.length).length, ' ')
    if (e.copieDe) return `${n}. ${e.rel}  [copie exacte de : ${e.copieDe}]`
    if (e.nonExtraite) return `${n}. ${e.rel}  [texte pas encore extrait — relancer]`
    if (e.erreur) return `${n}. ${e.rel}  [illisible : ${e.erreur}]`
    return `${n}. ${e.rel}  (${e.texte.length} car.${e.pagesImagesNonLues ? `, ${e.pagesImagesNonLues} page(s) image non lue(s)` : ''})`
  })

  const entete = [
    `FICHIER GLOBAL — DOSSIER ${canon}${filtre ? ` — POCHETTE ${filtre}` : ''}`,
    SEP,
    '',
    `Compilé le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} par SIRAL — toutes les pièces versées, en texte, dans l'ordre des chemins.`,
    `Pièces : ${entrees.length} (${lisibles.length} en texte, ${copies.length} copie(s) exacte(s) non répétée(s), ${nonExtraites.length} non extraite(s), ${illisibles.length} illisible(s)).`,
    'Chaque pièce commence par une ligne « ===== » puis « 📄 <chemin> » : citer ce chemin comme cote.',
    '',
    'SOMMAIRE',
    '-'.repeat(40),
    ...sommaire,
    '',
    SEP,
    '',
  ].join('\n')

  const blocs = entrees.map((e, i) => {
    const tete = `${SEP}\n📄 [${i + 1}/${entrees.length}] ${e.rel}\n${SEP}\n\n`
    if (e.copieDe) return tete + `[Copie exacte de « ${e.copieDe} » — texte non répété.]`
    if (e.nonExtraite) return tete + '[Texte pas encore extrait — relancer la compilation : chaque passage étend le cache.]'
    if (e.erreur) return tete + `[Pièce illisible : ${e.erreur}${e.scanned ? ' — scan sans couche texte' : ''}.]`
    return tete + e.texte
  })

  const texte = entete + blocs.join('\n\n') + `\n\n${SEP}\n🏁 FIN DU FICHIER GLOBAL — ${canon}\n`
  return {
    dossier: canon,
    ...(filtre ? { pochette: filtre } : {}),
    texte,
    sommaire,
    stats: {
      pieces: entrees.length,
      enTexte: lisibles.length,
      copiesExactes: copies.length,
      nonExtraites: nonExtraites.length,
      illisibles: illisibles.length,
      extractionsCetAppel: extractions,
      caracteres: texte.length,
    },
  }
}

/**
 * Page du fichier global pour le connecteur : `offset`/`limite` en caractères.
 * Le fichier est recompilé à chaque page (lecture de caches : rapide) — les
 * pièces non extraites au premier passage le sont aux suivants.
 */
export async function pageFichierGlobal(keys, numero, { pochette, offset, limite } = {}) {
  const g = await compilerFichierGlobal(keys, numero, { pochette })
  const s = g.texte
  const start = Math.min(Math.max(0, Number(offset) || 0), s.length)
  const lim = Math.max(10_000, Math.min(GLOBAL_PAGE_MAX, Number(limite) || GLOBAL_PAGE_MAX))
  const page = s.slice(start, start + lim)
  const reste = s.length - start - page.length
  const notes = []
  if (g.stats.nonExtraites) {
    notes.push(`${g.stats.nonExtraites} pièce(s) pas encore extraites (extraction bornée à ${GLOBAL_EXTRACTIONS_MAX} par appel) — rappelle le même outil : chaque appel étend la couverture, définitivement.`)
  }
  if (reste > 0) notes.push(`Fichier long : ${reste} caractère(s) restants — rappelle avec offset:${start + page.length} pour la suite.`)
  return {
    dossier: g.dossier,
    ...(g.pochette ? { pochette: g.pochette } : {}),
    stats: g.stats,
    longueurTotale: s.length,
    ...(start ? { offset: start } : {}),
    ...(reste > 0 ? { offsetSuivant: start + page.length } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
    texte: page,
  }
}
