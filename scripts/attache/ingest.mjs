/**
 * SIRAL — Attaché de justice · INGESTION des pièces (extraction + empreinte).
 *
 * Pipeline « à l'ingestion » (le patron eDiscovery) : toute pièce versée finit
 * avec
 *  1. son EMPREINTE sha256 du clair dans l'index (dédoublonnage strict) ;
 *  2. son TEXTE disponible sans nouvelle extraction — copie MD/ du
 *     téléversement, ou cache d'extraction serveur (OCR compris pour les
 *     scans entièrement muets, dans les bornes d'ocr.mjs — les pages images
 *     d'une pièce mixte restent, elles, à la demande : doctrine actée).
 *
 * Le navigateur fait déjà (1) et (2) au téléversement quand il le peut ; ce
 * module rattrape TOUT LE RESTE en tâche de fond : scans, pièces rangées par
 * le majordome, pièces reçues par mail, stock ancien. CPU local uniquement —
 * ZÉRO jeton — avec un budget borné par passage : le service appelle à chaque
 * tick, le module avance, s'arrête, reprend. Résultat : pieces_chercher
 * couvre tout le dossier dès la première recherche, lire_document est
 * instantané, et le devis d'un chantier n'a plus d'empreintes à calculer.
 *
 * État par dossier (attache/ingest/<docKey>.json, EN CLAIR — il ne contient
 * que des chemins et des dates déjà en clair dans docs/<docKey>/.index.json) :
 *   { sig, echecs: { rel: savedAt } }
 * `sig` (« nb pièces | dernier dépôt ») correspond à l'index ⇒ dossier à
 * jour, passage no-op immédiat. Un échec d'extraction (scan illisible, format
 * exotique) est mémorisé avec la date de dépôt de la pièce : jamais re-tenté
 * tant que la pièce n'est pas re-versée — pas de moulinette sans fin.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { attacheTj, tjDataDir, attacheDir, ensureDir, listDocsMeta, readJson, atomicWrite } from './store.mjs'
import { ensureDocShas, texteDocumentIntegral } from './dossier.mjs'
import { extraireEntites, majEntitesRegistre } from './registre.mjs'

// v2 : l'ingestion alimente aussi le REGISTRE (entités déterministes par
// pièce — téléphones, plaques, IBAN, adresses). Un état v1 est repris une
// fois, même à signature identique, pour doter le stock déjà ingéré.
const INGEST_V = 2

// Extractions fraîches par passage, tous dossiers confondus : un scan OCR
// peut coûter des minutes de CPU — on avance par petits pas, le tick suivant
// continue.
const INGEST_EXTRACTIONS_MAX = 15
const INGEST_DOSSIERS_MAX = 2
// Empreintes sha256 par passage : chacune lit ET déchiffre la pièce entière.
// Sans borne, le premier passage sur un dossier de 1 000+ pièces gelait
// l'event loop du service (et le volume partagé avec l'app) pendant toute la
// durée — le tick suivant continue là où on s'est arrêté.
const INGEST_SHAS_MAX = 120
// Probes par passage : un probe PDF sans cache lit et hache le blob entier —
// « gratuit » en jetons, pas en E/S. Même règle : bornés, repris au tick
// suivant.
const INGEST_PROBES_MAX = 300

function statePath(docKey) {
  return attacheDir('ingest', String(docKey).replace(/[^a-zA-Z0-9._@-]/g, '_') + '.json')
}

function readIngestState(docKey) {
  return readJson(statePath(docKey), { v: 0, sig: null, echecs: {} })
}

function writeIngestState(docKey, state) {
  ensureDir(attacheDir('ingest'))
  atomicWrite(statePath(docKey), JSON.stringify(state, null, 2))
}

/**
 * Signature bon marché de l'index d'un dossier : bouge à chaque dépôt,
 * retrait ET déplacement/renommage — moveDoc préserve la date de dépôt
 * (l'original n'est pas réécrit), seule l'empreinte des CHEMINS trahit un
 * déplacement ; sans elle, le registre ne suivrait pas la pièce déplacée.
 */
function docSig(metas) {
  let max = ''
  const rels = []
  for (const d of metas) {
    if (String(d.savedAt || '') > max) max = String(d.savedAt || '')
    rels.push(String(d.rel))
  }
  const relsHash = crypto.createHash('sha256').update(rels.sort().join('\n')).digest('hex').slice(0, 12)
  return `${metas.length}|${max}|${relsHash}`
}

/**
 * UN passage d'ingestion : les premiers dossiers dont l'index a bougé depuis
 * la dernière complétion, budget d'extractions partagé. Rend un bilan
 * { dossiers, empreintes, extraites, echecs, enAttente } — `enAttente` > 0 :
 * il reste du travail, le prochain tick continuera.
 */
export async function ingestPass(keys, {
  maxDossiers = INGEST_DOSSIERS_MAX,
  maxExtractions = INGEST_EXTRACTIONS_MAX,
  maxShas = INGEST_SHAS_MAX,
  maxProbes = INGEST_PROBES_MAX,
} = {}) {
  const tj = attacheTj()
  const docsDir = tjDataDir(tj, 'docs')
  const bilan = { dossiers: 0, empreintes: 0, extraites: 0, entites: 0, echecs: 0, enAttente: 0 }
  if (!fs.existsSync(docsDir)) return bilan

  // Pseudo-dossiers (_depot, _casiers…) exclus : transitoires ou hors dossier.
  const dirs = fs.readdirSync(docsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()

  let budget = maxExtractions
  let budgetShas = maxShas
  let budgetProbes = maxProbes
  for (const docKey of dirs) {
    if (bilan.dossiers >= maxDossiers || budget <= 0 || budgetShas <= 0 || budgetProbes <= 0) {
      // du travail restait possible ailleurs : le signaler sans le mesurer
      break
    }
    let metas = listDocsMeta(tj, docKey)
    if (!metas.length) continue
    const sig = docSig(metas)
    const state = readIngestState(docKey)
    if (state.sig === sig && state.v === INGEST_V) continue // à jour — no-op

    bilan.dossiers++
    // 1) Empreintes du clair (dédoublonnage strict) — local mais coûteux en
    //    E/S + déchiffrement : borné par passage, le tick suivant continue.
    let empreintesRestantes = 0
    try {
      const e = ensureDocShas(keys, docKey, { max: budgetShas })
      bilan.empreintes += e.calculees
      budgetShas -= e.calculees
      empreintesRestantes = e.restantes
      if (e.calculees) metas = listDocsMeta(tj, docKey) // relire les sha posés
    } catch { /* jamais bloquant */ }

    // 2) Texte de chaque pièce : probe (MD/, cache, format brut) puis
    //    extraction bornée pour ce qui manque. 3) au passage, les ENTITÉS
    //    (téléphones, plaques, IBAN, adresses) partent au REGISTRE — c'est là
    //    que se cachent les liens entre dossiers ; on n'accumule jamais les
    //    textes en mémoire, seulement leurs entités.
    const echecs = { ...(state.echecs || {}) }
    const entiteItems = []
    let enAttente = 0
    for (const d of metas) {
      const rel = String(d.rel)
      if (rel.startsWith('MD/')) continue
      if (echecs[rel] === String(d.savedAt)) continue // échec connu, pièce inchangée
      if (budgetProbes <= 0) { enAttente++; continue } // repris au prochain tick
      budgetProbes--
      let res
      try {
        res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false })
      } catch { res = { ok: false } }
      if (!res.ok && res.nonExtrait) {
        if (budget <= 0) { enAttente++; continue }
        budget--
        try {
          res = await texteDocumentIntegral(keys, docKey, rel)
        } catch { res = { ok: false } }
        if (res.ok) bilan.extraites++
      }
      if (res.ok) {
        delete echecs[rel]
        entiteItems.push({ rel, sha: d.sha, entites: extraireEntites(res.texte) })
      } else {
        echecs[rel] = String(d.savedAt)
        bilan.echecs++
      }
    }
    try { bilan.entites += majEntitesRegistre(keys, docKey, entiteItems) } catch { /* registre jamais bloquant */ }
    bilan.enAttente += enAttente
    // Échecs orphelins (pièce retirée ou déplacée) : purgés, sinon la carte
    // des échecs grossirait à chaque réorganisation du dossier.
    const relsActuels = new Set(metas.map((d) => String(d.rel)))
    for (const rel of Object.keys(echecs)) {
      if (!relsActuels.has(rel)) delete echecs[rel]
    }
    // Complet (tout est servi, en cache, ou en échec mémorisé — empreintes
    // comprises) : la signature est actée — les passages suivants sont des
    // no-ops jusqu'au prochain dépôt.
    bilan.enAttente += empreintesRestantes
    writeIngestState(docKey, { v: INGEST_V, sig: (enAttente || empreintesRestantes) ? null : sig, echecs })
  }
  return bilan
}
