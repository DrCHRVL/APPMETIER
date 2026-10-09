/**
 * SIRAL — Attaché de justice · FICHIER GLOBAL d'un dossier.
 *
 * La philosophie du « convertisseur PDF → TXT » du cabinet : toutes les
 * pièces d'un dossier, en TEXTE, dans UN SEUL fichier — un sommaire, puis
 * un bloc par pièce, séparé par une ligne de « = ». Un fichier que Claude web
 * exploite directement (réquisitoire définitif, synthèse, recherche
 * transversale), sans chantier, sans lots, sans nuit.
 *
 * Trois propriétés, décidées avec le magistrat :
 *
 *  1. INCRÉMENTAL ET MIS EN CACHE. Le corps du fichier (le texte des pièces)
 *     est conservé chiffré dans attache/global/<docKey>.json, sous la
 *     SIGNATURE de l'index des pièces. Tant que rien n'a bougé, servir le
 *     fichier ne lit rien ; quand une pièce arrive, seule elle est lue —
 *     les autres textes sont repris du cache. Le flux tendu (une pièce
 *     versée, un CR, un acte) recompile le dossier dès qu'il l'a traité, et
 *     une passe de fond bornée rattrape le reste à chaque tick du service.
 *
 *  2. NUMÉROTATION STABLE. Chaque pièce reçoit un numéro « P-0001 », « P-0002 »…
 *     dans l'ordre de son DÉPÔT, conservé dans le cache : une pièce ajoutée
 *     prend le numéro suivant, les anciennes ne bougent jamais. Le sommaire
 *     est donc un INDEX STABLE que Claude web peut citer d'une conversation à
 *     l'autre (« P-0042 »), en plus du chemin (la cote).
 *
 *  3. ENRICHI ET THÉMATIQUE. L'en-tête porte la FICHE du dossier (description,
 *     mis en cause, NATINF, échéancier), la CHRONOLOGIE et le REGISTRE des
 *     pièces (type, date, personnes, résumé) : tout le contexte en un seul
 *     document, sans appel d'outil préalable. Les pièces sont CLASSÉES par
 *     THÈME (auditions, synthèses, téléphonie, expertises, surveillances,
 *     décisions, autres) à partir du type de leur mini-fiche et de leur zone —
 *     déterministe, zéro jeton — et le fichier se livre par thème.
 *
 * Deux consommateurs, un seul texte : le connecteur Claude web (dossier_global,
 * paginé par caractères) et la page Assistant de justice (GET /dossier-global,
 * téléchargement .txt).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import { attacheTj, attacheDir, tjDataDir, listDocsMeta, docServerKey, readJson, atomicWrite, ensureDir, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { numeroCanonique, texteDocumentIntegral, dossierMarkdown } from './dossier.mjs'
import { instructionDossierMarkdown } from './instru.mjs'
import { buildChronologie } from './cotes.mjs'
import { readRegistre, numeroDepuisDocKey } from './registre.mjs'

/** Extractions fraîches par compilation : un scan OCR coûte des minutes de CPU. */
export const GLOBAL_EXTRACTIONS_MAX = 20
/** Page servie au connecteur (caractères) — sous le plafond de sortie du connecteur. */
const GLOBAL_PAGE_MAX = 350_000
/** Garde-fou absolu sur le corps assemblé (un dossier de 1 000 pièces reste servi). */
const GLOBAL_TEXTE_MAX = 60_000_000
/** Dossiers recompilés par passe de fond (le reste au tick suivant). */
const ENTRETIEN_DOSSIERS_MAX = 3
const CACHE_V = 1

const SEP = '='.repeat(80)

// ── Thèmes ──────────────────────────────────────────────────────────────────
// Classement DÉTERMINISTE d'une pièce par sa nature : le type de sa mini-fiche
// (registre, IA au fil de l'eau) et son nom de fichier d'abord, sa zone de
// dépôt en repli. L'ordre de la liste est l'ordre de LECTURE d'un
// réquisitoire : ce qui a été dit, puis ce qui a été vu, mesuré, décidé.
export const THEMES = [
  { cle: 'auditions', libelle: 'Auditions et déclarations', re: /audition|interrogatoire|confrontation|garde\s*[àa]\s*vue|\bgav\b|d[ée]claration|plainte|t[ée]moin|comparution/i },
  { cle: 'synthese', libelle: 'Synthèses et rapports d\'enquête', re: /synth[èe]se|rapport d['’]enqu[êe]te|r[ée]capitulatif|compte[- ]rendu d['’]enqu[êe]te|pv de synth/i },
  { cle: 'telephonie', libelle: 'Téléphonie, géolocalisation et données', re: /interception|[ée]coute|retranscription|fadette|t[ée]l[ée]phon|g[ée]olocalisation|balise|op[ée]rateur|imsi|donn[ée]es de connexion|facturation d[ée]taill[ée]e|exploitation (du|de la|des) (t[ée]l[ée]phone|ligne|donn[ée]es)/i },
  { cle: 'expertises', libelle: 'Expertises et rapports techniques', re: /expertise|expert\b|laboratoire|toxicolog|balistique|\badn\b|empreinte|m[ée]dico|autopsie|analyse (technique|scientifique|de produit)|rapport (technique|d['’]analyse)/i },
  { cle: 'surveillances', libelle: 'Surveillances, constatations et saisies', re: /surveillance|filature|constatation|observation|perquisition|saisie|fouille|interpellation|transport|visite domiciliaire|scell[ée]/i },
  { cle: 'decisions', libelle: 'Décisions, requêtes et actes de procédure', re: /ordonnance|requ[êe]te|r[ée]quisitoire|r[ée]quisitions|jugement|arr[êe]t|autorisation|soit[- ]transmis|saisine|commission rogatoire|mise en examen|\bdml\b|mise en libert[ée]|d[ée]tention|prolongation|mandat/i },
  { cle: 'autres', libelle: 'Autres pièces', re: null },
]
const THEME_ORDRE = new Map(THEMES.map((t, i) => [t.cle, i]))
const THEME_LIBELLE = new Map(THEMES.map((t) => [t.cle, t.libelle]))
const ZONE_THEME = { ecoutes: 'telephonie', geoloc: 'telephonie', actes: 'decisions', dml: 'decisions' }

/** Thème d'une pièce : mini-fiche + nom de fichier, puis zone de dépôt. */
export function themeDe(rel, fiche) {
  const base = String(rel).split('/').pop() || ''
  const texte = `${fiche?.type || ''} ${base}`
  for (const t of THEMES) if (t.re && t.re.test(texte)) return t.cle
  const zone = String(rel).split('/')[0].toLowerCase()
  return ZONE_THEME[zone] || 'autres'
}

// ── Cache par dossier ───────────────────────────────────────────────────────

function cachePath(docKey) {
  return attacheDir('global', String(docKey).replace(/[^a-zA-Z0-9._@-]/g, '_') + '.json')
}

function readCache(keys, docKey) {
  const env = readJson(cachePath(docKey), null)
  if (!env) return null
  try {
    const c = decryptJson(keys.global, env)
    return c && c.v === CACHE_V && Array.isArray(c.entrees) ? c : null
  } catch { return null }
}

async function writeCache(keys, docKey, cache) {
  ensureDir(attacheDir('global'))
  await withFileLock('global:' + docKey, async () => {
    atomicWrite(cachePath(docKey), JSON.stringify(encryptJson(keys.global, cache, { savedAt: cache.compileLe })))
  })
}

/** Signature de l'index : bouge à chaque dépôt, retrait, déplacement. */
function signatureDocs(metas) {
  const h = crypto.createHash('sha1')
  let max = ''
  for (const d of metas) {
    h.update(String(d.rel)).update('\n').update(String(d.sha || '')).update('\n').update(String(d.savedAt || '')).update('\n')
    if (String(d.savedAt || '') > max) max = String(d.savedAt || '')
  }
  return `${metas.length}|${max}|${h.digest('hex').slice(0, 16)}`
}

const numeroPiece = (n) => `P-${String(n).padStart(4, '0')}`

/**
 * (Re)compile le CORPS du fichier global d'un dossier — entrées numérotées,
 * thématisées, textes repris du cache quand la pièce n'a pas changé. Rend le
 * cache à jour (et l'écrit s'il a changé). `extraire` borne les extractions
 * fraîches ; `forcer` recompile même à signature identique (pour rattraper
 * des pièces « pas encore extraites » ou des mini-fiches arrivées depuis).
 */
export async function compilerCorps(keys, numero, { extraire = GLOBAL_EXTRACTIONS_MAX, forcer = false } = {}) {
  const canon = numeroCanonique(keys, numero)
  const docKey = docServerKey(canon)
  const metas = listDocsMeta(attacheTj(), docKey).filter((d) => !String(d.rel).startsWith('MD/'))
  const sig = signatureDocs(metas)
  const ancien = readCache(keys, docKey)
  const reg = readRegistre(keys, docKey)

  // Rien n'a bougé, rien à rattraper : le cache fait foi.
  if (ancien && ancien.sig === sig && !forcer && !ancien.nonExtraites) return { cache: ancien, docKey, canon, recompile: false }

  // Numéros STABLES : repris du cache, attribués aux nouvelles pièces dans
  // l'ordre de leur dépôt (puis du chemin, pour un même instant).
  const numeros = { ...(ancien?.numeros || {}) }
  let prochain = Number(ancien?.prochain) || 1
  const nouvelles = metas.filter((d) => !numeros[d.rel]).sort((a, b) => String(a.savedAt || '').localeCompare(String(b.savedAt || '')) || String(a.rel).localeCompare(String(b.rel)))
  for (const d of nouvelles) numeros[d.rel] = prochain++

  const anciennes = new Map((ancien?.entrees || []).map((e) => [e.rel, e]))
  const porteurParSha = new Map()
  const entrees = []
  let extractions = 0
  let caracteres = 0
  for (const d of [...metas].sort((a, b) => String(a.rel).localeCompare(String(b.rel)))) {
    const rel = String(d.rel)
    const fiche = reg.pieces?.[rel]?.fiche || null
    const base = {
      rel, n: numeros[rel], sha: d.sha || null, savedAt: d.savedAt || null,
      theme: themeDe(rel, fiche),
      ...(fiche ? { type: fiche.type, datePiece: fiche.datePiece } : {}),
    }
    const sha = String(d.sha || '')
    if (/^[a-f0-9]{64}$/.test(sha)) {
      const porteur = porteurParSha.get(sha)
      if (porteur) { entrees.push({ ...base, copieDe: porteur }); continue }
      porteurParSha.set(sha, rel)
    }
    // Texte repris du cache si la pièce n'a pas changé (même sha, même dépôt)
    // et qu'elle avait bien été lue.
    const prec = anciennes.get(rel)
    if (prec && prec.texte != null && (prec.sha || null) === (d.sha || null) && (prec.savedAt || null) === (d.savedAt || null)) {
      entrees.push({ ...base, texte: prec.texte, pagesImagesNonLues: prec.pagesImagesNonLues || 0 })
      caracteres += prec.texte.length
      continue
    }
    let res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false }).catch(() => ({ ok: false }))
    if (!res.ok && res.nonExtrait) {
      if (extractions < extraire) {
        extractions++
        res = await texteDocumentIntegral(keys, docKey, rel).catch(() => ({ ok: false }))
      } else {
        entrees.push({ ...base, nonExtraite: true })
        continue
      }
    }
    if (!res.ok) { entrees.push({ ...base, erreur: String(res.error || 'texte indisponible'), scanned: Boolean(res.scanned) }); continue }
    const texte = String(res.texte || '').trim()
    caracteres += texte.length
    entrees.push({ ...base, texte, pagesImagesNonLues: res.extra?.pagesImagesNonLues || 0 })
    if (caracteres > GLOBAL_TEXTE_MAX) break
  }

  const cache = {
    v: CACHE_V, docKey, dossier: canon, sig, numeros, prochain,
    compileLe: new Date().toISOString(),
    nonExtraites: entrees.filter((e) => e.nonExtraite).length,
    extractionsDerniere: extractions,
    entrees,
  }
  await writeCache(keys, docKey, cache)
  return { cache, docKey, canon, recompile: true }
}

// ── En-tête enrichi ─────────────────────────────────────────────────────────

/** Fiche du dossier (enquête OU instruction) telle que lire_dossier la rend, sans son pied d'aide. */
function ficheDossier(keys, canon) {
  let md = null
  try { md = dossierMarkdown(keys, canon, { section: 'apercu' }) } catch { md = null }
  if (md == null) { try { md = instructionDossierMarkdown(keys, canon) } catch { md = null } }
  if (!md) return ''
  const coupe = md.indexOf('\n---\nAperçu compact.')
  return (coupe > 0 ? md.slice(0, coupe) : md).trim()
}

function chronologieTexte(keys, canon) {
  let ch = null
  try { ch = buildChronologie(keys, canon) } catch { ch = null }
  if (!ch || !ch.entries?.length) return ''
  const lignes = ch.entries.slice(0, 600).map((e) => `- ${e.date} — ${e.titre}${e.detail ? ` (${e.detail})` : ''}${e.source === 'npp' ? ' [NPP]' : ''}`)
  const reste = ch.entries.length - lignes.length
  return ['CHRONOLOGIE', '-'.repeat(40), ...lignes, ...(reste > 0 ? [`… ${reste} entrée(s) suivantes non reproduites (chronologie_lire)`] : [])].join('\n')
}

function registreTexte(entrees, reg) {
  const lignes = []
  for (const e of entrees) {
    const r = reg.pieces?.[e.rel]
    const f = r?.fiche
    const personnes = (f?.personnes || []).slice(0, 8).map((p) => `${p.nom}${p.role ? ` (${p.role})` : ''}`).join(', ')
    const entites = r?.entites ? Object.entries(r.entites).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k} : ${v.slice(0, 6).join(', ')}`).join(' · ') : ''
    lignes.push(`${numeroPiece(e.n)} ${e.rel}${f?.type ? ` — ${f.type}` : ''}${f?.datePiece ? ` · ${f.datePiece}` : ''}${personnes ? ` · ${personnes}` : ''}${f?.resume ? `\n       ${String(f.resume).replace(/\s+/g, ' ').slice(0, 400)}` : ''}${entites ? `\n       ${entites.slice(0, 300)}` : ''}`)
  }
  if (!lignes.length) return ''
  return ['REGISTRE DES PIÈCES (type, date, personnes, résumé — mini-fiches constituées au fil de l\'eau)', '-'.repeat(40), ...lignes].join('\n')
}

// ── Assemblage ──────────────────────────────────────────────────────────────

const ligneSommaire = (e, largeur) => {
  const n = numeroPiece(e.n).padEnd(largeur)
  if (e.copieDe) return `${n} ${e.rel}  [copie exacte de : ${e.copieDe}]`
  if (e.nonExtraite) return `${n} ${e.rel}  [texte pas encore extrait — relancer]`
  if (e.erreur) return `${n} ${e.rel}  [illisible : ${e.erreur}]`
  return `${n} ${e.rel}  (${e.texte.length} car.${e.pagesImagesNonLues ? `, ${e.pagesImagesNonLues} page(s) image non lue(s)` : ''})`
}

/**
 * Compile le fichier global d'un dossier (enquête ou instruction).
 * `pochette` limite à une pochette de l'arborescence, `theme` à un thème ;
 * `extraire` borne les extractions fraîches ; `forcer` recompile le corps.
 * Rend { texte, sommaire, themes, stats } — `texte` est le fichier complet.
 */
export async function compilerFichierGlobal(keys, numero, { pochette, theme, extraire = GLOBAL_EXTRACTIONS_MAX, forcer = false } = {}) {
  const { cache, docKey, canon } = await compilerCorps(keys, numero, { extraire, forcer })
  const reg = readRegistre(keys, docKey)
  const filtre = String(pochette || '').replace(/\/+$/, '')
  const themeCle = THEME_LIBELLE.has(String(theme || '')) ? String(theme) : ''
  let entrees = cache.entrees
  if (filtre) entrees = entrees.filter((e) => e.rel === filtre || String(e.rel).startsWith(filtre + '/'))
  if (themeCle) entrees = entrees.filter((e) => e.theme === themeCle)
  // Ordre de lecture : par thème, puis par chemin.
  entrees = [...entrees].sort((a, b) => (THEME_ORDRE.get(a.theme) - THEME_ORDRE.get(b.theme)) || String(a.rel).localeCompare(String(b.rel)))

  const lisibles = entrees.filter((e) => e.texte != null)
  const copies = entrees.filter((e) => e.copieDe)
  const nonExtraites = entrees.filter((e) => e.nonExtraite)
  const illisibles = entrees.filter((e) => e.erreur)
  const parTheme = new Map()
  for (const e of cache.entrees) parTheme.set(e.theme, (parTheme.get(e.theme) || 0) + 1)
  const themes = THEMES.filter((t) => parTheme.has(t.cle)).map((t) => ({ cle: t.cle, libelle: t.libelle, pieces: parTheme.get(t.cle) }))

  const largeur = numeroPiece(cache.prochain).length
  const sommaire = []
  let themeCourant = null
  for (const e of entrees) {
    if (e.theme !== themeCourant) {
      themeCourant = e.theme
      sommaire.push(`▸ ${THEME_LIBELLE.get(e.theme)} (${entrees.filter((x) => x.theme === e.theme).length})`)
    }
    sommaire.push(ligneSommaire(e, largeur))
  }

  const fiche = ficheDossier(keys, canon)
  const chrono = chronologieTexte(keys, canon)
  const registre = registreTexte(entrees, reg)

  const entete = [
    `FICHIER GLOBAL — DOSSIER ${canon}${filtre ? ` — POCHETTE ${filtre}` : ''}${themeCle ? ` — THÈME ${THEME_LIBELLE.get(themeCle).toUpperCase()}` : ''}`,
    SEP,
    '',
    `Compilé par SIRAL le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (corps des pièces à jour au ${String(cache.compileLe).slice(0, 16).replace('T', ' ')}).`,
    `Pièces : ${entrees.length} (${lisibles.length} en texte, ${copies.length} copie(s) exacte(s) non répétée(s), ${nonExtraites.length} non extraite(s), ${illisibles.length} illisible(s))${filtre || themeCle ? ` — sur ${cache.entrees.length} au dossier` : ''}.`,
    'Chaque pièce porte un NUMÉRO STABLE « P-0001 » (ordre de dépôt, jamais renuméroté) et son CHEMIN (la cote) : citer l\'un ou l\'autre. Les pièces sont classées par THÈME, puis par chemin.',
    'Chaque pièce commence par une ligne « ===== » puis « 📄 P-xxxx — <chemin> ».',
    '',
    ...(fiche ? ['FICHE DU DOSSIER', '-'.repeat(40), fiche, ''] : []),
    ...(chrono ? [chrono, ''] : []),
    ...(registre ? [registre, ''] : []),
    'SOMMAIRE',
    '-'.repeat(40),
    ...sommaire,
    '',
    SEP,
    '',
  ].join('\n')

  const blocs = entrees.map((e) => {
    const tete = `${SEP}\n📄 ${numeroPiece(e.n)} — ${e.rel}   [${THEME_LIBELLE.get(e.theme)}${e.type ? ` · ${e.type}` : ''}${e.datePiece ? ` · ${e.datePiece}` : ''}]\n${SEP}\n\n`
    if (e.copieDe) return tete + `[Copie exacte de « ${e.copieDe} » — texte non répété.]`
    if (e.nonExtraite) return tete + '[Texte pas encore extrait — relancer la compilation : chaque passage étend le cache.]'
    if (e.erreur) return tete + `[Pièce illisible : ${e.erreur}${e.scanned ? ' — scan sans couche texte' : ''}.]`
    return tete + e.texte
  })

  const texte = entete + blocs.join('\n\n') + `\n\n${SEP}\n🏁 FIN DU FICHIER GLOBAL — ${canon}\n`
  return {
    dossier: canon,
    ...(filtre ? { pochette: filtre } : {}),
    ...(themeCle ? { theme: themeCle } : {}),
    texte,
    sommaire,
    themes,
    stats: {
      pieces: entrees.length,
      piecesDossier: cache.entrees.length,
      enTexte: lisibles.length,
      copiesExactes: copies.length,
      nonExtraites: nonExtraites.length,
      illisibles: illisibles.length,
      extractionsCetAppel: cache.extractionsDerniere || 0,
      caracteres: texte.length,
      corpsAJour: cache.compileLe,
    },
  }
}

/**
 * Page du fichier global pour le connecteur : `offset`/`limite` en caractères.
 * Le corps vient du cache (rien n'est relu tant que le dossier n'a pas bougé) ;
 * l'en-tête (fiche, chronologie, registre) est rafraîchi à chaque page.
 */
export async function pageFichierGlobal(keys, numero, { pochette, theme, offset, limite } = {}) {
  const g = await compilerFichierGlobal(keys, numero, { pochette, theme })
  const s = g.texte
  const start = Math.min(Math.max(0, Number(offset) || 0), s.length)
  const lim = Math.max(10_000, Math.min(GLOBAL_PAGE_MAX, Number(limite) || GLOBAL_PAGE_MAX))
  const page = s.slice(start, start + lim)
  const reste = s.length - start - page.length
  const notes = []
  if (g.stats.nonExtraites) {
    notes.push(`${g.stats.nonExtraites} pièce(s) pas encore extraites (extraction bornée à ${GLOBAL_EXTRACTIONS_MAX} par compilation) — rappelle le même outil : chaque appel étend la couverture, définitivement.`)
  }
  if (reste > 0) notes.push(`Fichier long : ${reste} caractère(s) restants — rappelle avec offset:${start + page.length} pour la suite.`)
  if (!theme && !pochette && g.themes.length > 1 && s.length > GLOBAL_PAGE_MAX) {
    notes.push(`Thèmes disponibles (paramètre theme) : ${g.themes.map((t) => `${t.cle} (${t.pieces})`).join(', ')} — pour lire dans l'ordre naturel d'un réquisitoire, thème par thème.`)
  }
  return {
    dossier: g.dossier,
    ...(g.pochette ? { pochette: g.pochette } : {}),
    ...(g.theme ? { theme: g.theme } : {}),
    themes: g.themes,
    stats: g.stats,
    longueurTotale: s.length,
    ...(start ? { offset: start } : {}),
    ...(reste > 0 ? { offsetSuivant: start + page.length } : {}),
    ...(notes.length ? { note: notes.join(' ') } : {}),
    texte: page,
  }
}

// ── Entretien de fond ───────────────────────────────────────────────────────

/**
 * Recompile le corps d'UN dossier (après le flux tendu : la pièce vient d'être
 * ingérée et fichée). Jamais bloquant : une erreur est rendue, pas levée.
 */
export async function rafraichirFichierGlobal(keys, numero) {
  try {
    const r = await compilerCorps(keys, numero, { forcer: true })
    return { ok: true, dossier: r.canon, pieces: r.cache.entrees.length, nonExtraites: r.cache.nonExtraites }
  } catch (e) {
    return { ok: false, erreur: String(e?.message || e) }
  }
}

/**
 * Passe de fond : parcourt les dossiers qui ont des pièces, recompile ceux
 * dont l'index a bougé depuis le cache (ou qui gardent des pièces « pas
 * encore extraites »), bornée à quelques dossiers par appel — le tick suivant
 * continue. CPU local, zéro jeton.
 */
export async function entretenirFichiersGlobaux(keys, { maxDossiers = ENTRETIEN_DOSSIERS_MAX } = {}) {
  const docsRoot = tjDataDir(attacheTj(), 'docs')
  const bilan = { examines: 0, recompiles: 0, restants: 0, erreurs: 0 }
  if (!fs.existsSync(docsRoot)) return bilan
  let budget = maxDossiers
  for (const docKey of fs.readdirSync(docsRoot).sort()) {
    if (docKey.startsWith('.')) continue
    let metas
    try { metas = listDocsMeta(attacheTj(), docKey).filter((d) => !String(d.rel).startsWith('MD/')) } catch { continue }
    if (!metas.length) continue
    bilan.examines++
    const cache = readCache(keys, docKey)
    const aJour = cache && cache.sig === signatureDocs(metas) && !cache.nonExtraites
    if (aJour) continue
    if (budget <= 0) { bilan.restants++; continue }
    budget--
    // Instruction (hors coffre des enquêtes) : la clé serveur vaut numéro —
    // docServerKey est idempotente sur une clé déjà propre.
    const numero = numeroDepuisDocKey(keys, docKey) || cache?.dossier || docKey
    try {
      await compilerCorps(keys, numero, { forcer: true })
      bilan.recompiles++
    } catch { bilan.erreurs++ }
  }
  return bilan
}
