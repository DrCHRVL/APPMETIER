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
import fs from 'node:fs'
import path from 'node:path'
import { attacheTj, tjDataDir, attacheDir, ensureDir, listDocsMeta, readJson, atomicWrite } from './store.mjs'
import { ensureDocShas, texteDocumentIntegral } from './dossier.mjs'

// Extractions fraîches par passage, tous dossiers confondus : un scan OCR
// peut coûter des minutes de CPU — on avance par petits pas, le tick suivant
// continue. Les probes (MD/ ou cache déjà là ?) ne comptent pas.
const INGEST_EXTRACTIONS_MAX = 15
const INGEST_DOSSIERS_MAX = 2

function statePath(docKey) {
  return attacheDir('ingest', String(docKey).replace(/[^a-zA-Z0-9._@-]/g, '_') + '.json')
}

function readIngestState(docKey) {
  return readJson(statePath(docKey), { sig: null, echecs: {} })
}

function writeIngestState(docKey, state) {
  ensureDir(attacheDir('ingest'))
  atomicWrite(statePath(docKey), JSON.stringify(state, null, 2))
}

/** Signature bon marché de l'index d'un dossier : bouge à chaque dépôt/retrait. */
function docSig(metas) {
  let max = ''
  for (const d of metas) if (String(d.savedAt || '') > max) max = String(d.savedAt || '')
  return `${metas.length}|${max}`
}

/**
 * UN passage d'ingestion : les premiers dossiers dont l'index a bougé depuis
 * la dernière complétion, budget d'extractions partagé. Rend un bilan
 * { dossiers, empreintes, extraites, echecs, enAttente } — `enAttente` > 0 :
 * il reste du travail, le prochain tick continuera.
 */
export async function ingestPass(keys, { maxDossiers = INGEST_DOSSIERS_MAX, maxExtractions = INGEST_EXTRACTIONS_MAX } = {}) {
  const tj = attacheTj()
  const docsDir = tjDataDir(tj, 'docs')
  const bilan = { dossiers: 0, empreintes: 0, extraites: 0, echecs: 0, enAttente: 0 }
  if (!fs.existsSync(docsDir)) return bilan

  // Pseudo-dossiers (_depot, _casiers…) exclus : transitoires ou hors dossier.
  const dirs = fs.readdirSync(docsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()

  let budget = maxExtractions
  for (const docKey of dirs) {
    if (bilan.dossiers >= maxDossiers || budget <= 0) {
      // du travail restait possible ailleurs : le signaler sans le mesurer
      break
    }
    const metas = listDocsMeta(tj, docKey)
    if (!metas.length) continue
    const sig = docSig(metas)
    const state = readIngestState(docKey)
    if (state.sig === sig) continue // à jour — no-op

    bilan.dossiers++
    // 1) Empreintes du clair (dédoublonnage strict) — local, rapide
    try { bilan.empreintes += ensureDocShas(keys, docKey).calculees } catch { /* jamais bloquant */ }

    // 2) Texte de chaque pièce : probe (MD/, cache, format brut) puis
    //    extraction bornée pour ce qui manque
    const echecs = { ...(state.echecs || {}) }
    let enAttente = 0
    for (const d of metas) {
      const rel = String(d.rel)
      if (rel.startsWith('MD/')) continue
      if (echecs[rel] === String(d.savedAt)) continue // échec connu, pièce inchangée
      let res
      try {
        res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false })
      } catch { res = { ok: false } }
      if (res.ok) { delete echecs[rel]; continue }
      if (!res.nonExtrait) { echecs[rel] = String(d.savedAt); bilan.echecs++; continue }
      if (budget <= 0) { enAttente++; continue }
      budget--
      try {
        res = await texteDocumentIntegral(keys, docKey, rel)
      } catch { res = { ok: false } }
      if (res.ok) { bilan.extraites++; delete echecs[rel] }
      else { echecs[rel] = String(d.savedAt); bilan.echecs++ }
    }
    bilan.enAttente += enAttente
    // Complet (tout est servi, en cache, ou en échec mémorisé) : la signature
    // est actée — les passages suivants sont des no-ops jusqu'au prochain dépôt.
    writeIngestState(docKey, { sig: enAttente ? state.sig || null : sig, echecs })
  }
  return bilan
}
