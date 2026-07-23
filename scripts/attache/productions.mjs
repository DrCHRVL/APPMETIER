/**
 * SIRAL — Attaché de justice · productions rédactionnelles.
 *
 * Les actes que l'attaché rédige à partir des trames (réquisition, demande
 * de prolongation au JLD, saisine, projet de réponse…). Chaque production est
 * conservée par dossier, chiffrée (clé globale), versionnée. Le magistrat les
 * visionne dans « Actes rédigés », les fait retoucher par l'IA (chat), les
 * édite légèrement à la main, les exporte en PDF/Word officiel, puis les
 * VALIDE (traite) — l'acte quitte alors la liste courante.
 *
 * Chaque production = un fichier-enveloppe. L'attaché l'écrit chiffré côté
 * serveur ; le navigateur de l'administrateur la déchiffre pour l'afficher,
 * et renvoie une enveloppe qu'il a lui-même chiffrée lors d'une édition
 * manuelle — l'app ne voit jamais le texte en clair.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { attacheDir, ensureDir, atomicWrite, readJson, docServerKey, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { normNumero, numerosProches } from './numero.mjs'
import { resolveEnquete } from './dossier.mjs'
import { diffTexte } from './diff.mjs'

export const PRODUCTION_TYPES = ['requisition', 'reponse_dml', 'prolongation_jld', 'saisine_jld', 'projet_reponse', 'soit_transmis', 'note', 'livrable', 'autre']

/**
 * Nettoie/valide les métadonnées d'acte fournies par l'agent. Renvoie un objet
 * borné (champs connus uniquement) ou null si rien d'exploitable. Ces
 * métadonnées servent, à la validation par le magistrat, à créer un acte
 * identique à une saisie manuelle (rubrique + catégorie + dates + statut).
 */
function sanitizeActeMeta(m) {
  if (!m || typeof m !== 'object') return null
  const kind = ['ecoute', 'geolocalisation', 'autre'].includes(m.kind) ? m.kind : undefined
  const dureeUnit = m.dureeUnit === 'mois' ? 'mois' : (m.dureeUnit === 'jours' ? 'jours' : undefined)
  const str = (v, n) => (v == null ? undefined : String(v).slice(0, n))
  const dureeNum = Number(m.duree)
  const out = {
    kind,
    categorie: str(m.categorie, 120),
    dateDebut: /^\d{4}-\d{2}-\d{2}$/.test(String(m.dateDebut || '')) ? String(m.dateDebut) : undefined,
    duree: Number.isFinite(dureeNum) && dureeNum > 0 ? dureeNum : undefined,
    dureeUnit,
    cible: str(m.cible, 200),
    objet: str(m.objet, 200),
    pendingJld: m.pendingJld === true ? true : undefined,
  }
  // Retire les champs vides ; null si l'objet ne porte plus rien d'utile.
  const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
  return Object.keys(clean).length ? clean : null
}

function productionsRoot() { return attacheDir('productions') }
function assertId(id) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) throw new Error('Identifiant de production invalide')
}
function fileIn(dirKey, id) { return path.join(productionsRoot(), dirKey, id + '.json') }
function versionsDirIn(dirKey, id) { return path.join(productionsRoot(), dirKey, '.versions', id) }

/** Pseudo-dossiers (« _hors-dossier ») : jamais de rapprochement de variantes. */
function isSpecial(numero) { return String(numero || '').startsWith('_') }

/**
 * Répertoires de productions EXISTANTS dont la clé désigne vraisemblablement le
 * même dossier que `numero` — les VARIANTES d'écriture (« 85103/843/2026 »
 * quand l'enquête s'appelle « 85103/843/2026 - GRIVESNES 2 »), répertoire
 * exact exclu. Sans ce rapprochement, un acte rangé sous l'écriture courte
 * restait invisible dans « Actes rédigés » de l'enquête.
 */
function variantDirKeys(numero) {
  if (isSpecial(numero)) return []
  const root = productionsRoot()
  if (!fs.existsSync(root)) return []
  const own = docServerKey(numero)
  return fs.readdirSync(root).filter((d) => {
    // e_… = numéros commençant par un caractère spécial (pseudo-dossiers) : exclus.
    if (d === own || d.startsWith('.') || d.startsWith('e_')) return false
    try { if (!fs.statSync(path.join(root, d)).isDirectory()) return false } catch { return false }
    return numerosProches(d, numero)
  })
}

/**
 * Répertoire où VIT réellement une production : celui du numéro demandé,
 * sinon un répertoire variant qui contient ce fichier (acte rangé sous une
 * autre écriture du même numéro). null si introuvable.
 */
function locateDirKey(numero, id) {
  assertId(id)
  const own = docServerKey(numero)
  if (fs.existsSync(fileIn(own, id))) return own
  for (const d of variantDirKeys(numero)) {
    if (fs.existsSync(fileIn(d, id))) return d
  }
  return null
}
/** Jeton d'archive (nom de fichier) ↔ horodatage ISO (`:` remplacé par `_`). */
function tokenToIso(token) { return String(token).replace(/T(\d\d)_(\d\d)_(\d\d)/, 'T$1:$2:$3') }

/**
 * Écrit une enveloppe déjà chiffrée (archive la version précédente).
 * Rend { archivedAt } : le jeton de l'archive créée (l'état AVANT cette
 * écriture), ou null si l'acte n'existait pas encore — sert de pointeur
 * durable pour comparer plus tard le jet de l'attaché à la correction du
 * magistrat (production_diff).
 */
export async function writeEnvelope(numero, id, envelope) {
  assertId(id)
  // Mise à jour d'un acte rangé sous une VARIANTE du numéro : on écrit là où
  // il vit déjà — jamais de seconde copie dans le répertoire du numéro demandé.
  const dirKey = locateDirKey(numero, id) || docServerKey(numero)
  const p = fileIn(dirKey, id)
  let archivedAt = null
  await withFileLock('prod:' + id, async () => {
    ensureDir(path.join(productionsRoot(), dirKey))
    if (fs.existsSync(p)) {
      const vdir = versionsDirIn(dirKey, id)
      ensureDir(vdir)
      const token = new Date().toISOString().replace(/:/g, '_')
      fs.copyFileSync(p, path.join(vdir, token + '.json'))
      archivedAt = token
    }
    atomicWrite(p, JSON.stringify(envelope, null, 2))
  })
  return { archivedAt }
}

/**
 * Versions archivées d'un acte, plus ANCIENNE d'abord. Chaque entrée =
 * l'état de l'acte AVANT l'écriture nommée par ce jeton. Les jetons ISO à
 * largeur fixe se trient chronologiquement par ordre lexicographique.
 */
export function listProductionVersions(numero, id) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) return []
  const vdir = versionsDirIn(locateDirKey(numero, id) || docServerKey(numero), id)
  if (!fs.existsSync(vdir)) return []
  return fs.readdirSync(vdir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('deleted-') && !f.startsWith('.'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
    .map((token) => ({ token, at: tokenToIso(token) }))
}

/** Déchiffre une version archivée précise (jeton = nom de fichier). */
export function readProductionVersion(keys, numero, id, token) {
  if (!/^[a-f0-9]{6,32}$/.test(id)) return null
  const safe = String(token || '').replace(/[^0-9A-Za-z._-]/g, '')
  if (!safe) return null
  const vdir = versionsDirIn(locateDirKey(numero, id) || docServerKey(numero), id)
  const env = readJson(path.join(vdir, safe + '.json'), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

/**
 * Diff « avant → après » d'un acte : ce que le magistrat a changé de sa main.
 * Sans `versionAt`, compare les deux dernières versions (dernier changement).
 * Avec `versionAt` (jeton ou ISO, tel que porté par le signal acte_edite_main),
 * cible précisément cette correction : « avant » = la version archivée à ce
 * jeton (le jet de l'attaché), « après » = la version installée juste ensuite
 * (l'archive suivante, ou l'état courant si aucune) — robuste aux retouches
 * ultérieures.
 */
export function diffProduction(keys, numero, id, versionAt) {
  const current = readProduction(keys, numero, id)
  if (!current) return { ok: false, erreur: 'Acte introuvable' }
  const versions = listProductionVersions(numero, id)
  if (versions.length === 0) {
    return { ok: false, erreur: 'Aucune version antérieure archivée : cet acte n\'a jamais été réécrit — rien à comparer.' }
  }
  let beforeIdx = versions.length - 1
  if (versionAt) {
    const wanted = String(versionAt)
    const key19 = tokenToIso(wanted).slice(0, 19)
    const found = versions.findIndex((v) => v.token === wanted || v.at === wanted || v.at.slice(0, 19) === key19)
    if (found >= 0) beforeIdx = found
  }
  const beforeToken = versions[beforeIdx].token
  const before = readProductionVersion(keys, numero, id, beforeToken)
  if (!before) return { ok: false, erreur: 'Version antérieure illisible (clé différente ?)' }
  const nextArchive = versions[beforeIdx + 1]
  const after = nextArchive ? readProductionVersion(keys, numero, id, nextArchive.token) : current
  const d = diffTexte(before?.contenu, after?.contenu)
  return {
    ok: true,
    numero,
    id,
    titre: current.titre,
    type: current.type,
    source: current.source || null,
    avantLe: versions[beforeIdx].at,
    apresLe: nextArchive ? nextArchive.at : current.updatedAt,
    identique: d.identique,
    ajouts: d.ajouts,
    retraits: d.retraits,
    tronque: d.tronque,
    diff: d.diff,
  }
}

function listEnvelopesIn(dirKey) {
  const dir = path.join(productionsRoot(), dirKey)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .map((f) => ({ id: f.replace(/\.json$/, ''), envelope: readJson(path.join(dir, f), null) }))
    .filter((e) => e.envelope)
}

export function listEnvelopes(numero) {
  return listEnvelopesIn(docServerKey(numero))
}

/**
 * Enveloppes d'un dossier, écritures VARIANTES du numéro comprises : celles du
 * répertoire exact, plus celles des répertoires rangés sous une autre écriture
 * du même numéro (« 85103/843/2026 » quand l'enquête s'appelle
 * « 85103/843/2026 - GRIVESNES 2 »). Un répertoire variant dont la clé ne se
 * réduit pas au même numéro n'est retenu que si son contenu se rapporte bien à
 * la MÊME enquête (numéro d'un échantillon déchiffré → résolution tolérante) :
 * deux dossiers voisins (« …GRIVESNES » / « …GRIVESNES 2 ») ne se mélangent
 * jamais. Sans trousseau, seule l'égalité normalisée des clés est admise.
 */
export function listEnvelopesDossier(keys, numero) {
  const out = listEnvelopes(numero)
  if (isSpecial(numero)) return out
  const variants = variantDirKeys(numero)
  if (!variants.length) return out
  const seen = new Set(out.map((e) => e.id))
  const nt = normNumero(numero)
  const target = keys ? resolveEnquete(keys, numero) : null
  for (const dirKey of variants) {
    const envs = listEnvelopesIn(dirKey)
    if (!envs.length) continue
    let memeDossier = normNumero(dirKey) === nt
    if (!memeDossier && keys && target) {
      try {
        const sample = decryptJson(keys.global, envs[0].envelope)
        const resolved = sample?.numero != null ? resolveEnquete(keys, sample.numero) : null
        memeDossier = Boolean(resolved && String(resolved.id) === String(target.id))
      } catch { memeDossier = false }
    }
    if (!memeDossier) continue
    for (const e of envs) {
      if (!seen.has(e.id)) { seen.add(e.id); out.push(e) }
    }
  }
  return out
}

export function readEnvelope(numero, id) {
  assertId(id)
  const dirKey = locateDirKey(numero, id)
  return dirKey ? readJson(fileIn(dirKey, id), null) : null
}

export async function deleteProduction(numero, id) {
  assertId(id)
  const dirKey = locateDirKey(numero, id)
  if (!dirKey) return false
  const p = fileIn(dirKey, id)
  await withFileLock('prod:' + id, async () => {
    const vdir = versionsDirIn(dirKey, id)
    ensureDir(vdir)
    fs.copyFileSync(p, path.join(vdir, 'deleted-' + new Date().toISOString().replace(/:/g, '_') + '.json'))
    fs.unlinkSync(p)
  })
  return true
}

// ── Côté attaché (chiffre lui-même avec la clé globale) ──

/** Crée ou met à jour une production. id absent = nouvelle. Signée du nom admin. */
export async function saveProduction(keys, { numero, id, type, titre, contenu, source, objet, acteMeta }) {
  if (!String(numero || '').trim()) throw new Error('Numéro de dossier requis')
  if (!String(contenu || '').trim()) throw new Error('Contenu requis')
  const author = keys?.grantedBy || 'admin'
  const existing = id ? readProduction(keys, numero, id) : null
  // Numéro CANONIQUE : un acte NEUF rangé sous une écriture abrégée
  // (« 85103/843/2026 ») est rattaché à l'enquête telle qu'elle existe dans
  // SIRAL (« 85103/843/2026 - GRIVESNES 2 ») — sinon il resterait invisible
  // dans « Actes rédigés » du dossier. Un acte EXISTANT garde son numéro
  // (cohérent avec son rangement, que writeEnvelope retrouve de toute façon).
  let numeroFinal = String(numero)
  if (existing?.numero) {
    numeroFinal = String(existing.numero)
  } else if (!isSpecial(numero)) {
    const enq = resolveEnquete(keys, numero)
    if (enq?.numero) numeroFinal = String(enq.numero)
  }
  const rec = {
    id: existing?.id || (id && /^[a-f0-9]{6,32}$/.test(id) ? id : crypto.randomBytes(6).toString('hex')),
    numero: numeroFinal,
    type: PRODUCTION_TYPES.includes(type) ? type : (existing?.type || 'autre'),
    titre: String(titre || existing?.titre || 'Acte').slice(0, 200),
    contenu: String(contenu).slice(0, 400_000),
    source: source ? String(source).slice(0, 120) : existing?.source,
    // Objet de l'acte (n° de ligne interceptée, objet géolocalisé…) : dernier
    // segment du nom de fichier à l'export. Conservé s'il n'est pas re-fourni.
    objet: objet != null ? String(objet).slice(0, 120) : existing?.objet,
    // Métadonnées structurées de l'acte (rubrique, catégorie, dates, durée,
    // cible/objet) : à la validation par le magistrat, l'app crée un acte
    // identique à une saisie manuelle. Conservées si non fournies à la mise à jour.
    acteMeta: sanitizeActeMeta(acteMeta) || existing?.acteMeta,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: author,
    // un acte VALIDÉ (traité) par le magistrat qui est retouché par l'IA
    // redevient « en attente » : le nouveau contenu appelle une relecture.
    traite: existing?.traite && existing?.contenu === String(contenu) ? existing.traite : false,
    traiteLe: existing?.traite && existing?.contenu === String(contenu) ? existing.traiteLe : undefined,
    // idem pour un acte REFUSÉ : dès que l'attaché le RECOMMENCE (nouveau
    // contenu), le refus est levé et l'acte repart « en attente » d'une
    // décision. Le contenu inchangé conserve l'état de refus et son motif.
    refuse: existing?.refuse && existing?.contenu === String(contenu) ? existing.refuse : false,
    refuseLe: existing?.refuse && existing?.contenu === String(contenu) ? existing.refuseLe : undefined,
    refuseMotif: existing?.refuse && existing?.contenu === String(contenu) ? existing.refuseMotif : undefined,
  }
  await writeEnvelope(numeroFinal, rec.id, encryptJson(keys.global, rec, { savedAt: rec.updatedAt, savedBy: author }))
  return { id: rec.id, titre: rec.titre, numero: rec.numero }
}

export function readProduction(keys, numero, id) {
  const env = readEnvelope(numero, id)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

export function listProductions(keys, numero) {
  return listEnvelopesDossier(keys, numero)
    .map(({ envelope }) => { try { return decryptJson(keys.global, envelope) } catch { return null } })
    .filter(Boolean)
    .map(({ contenu, ...meta }) => ({ ...meta, taille: (contenu || '').length }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}
