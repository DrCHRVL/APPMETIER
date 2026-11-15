/**
 * SIRAL — Attaché de justice · PIÈCES INTROUVABLES.
 *
 * La fiche d'un dossier LISTE ses pièces (e.documents, dans le coffre) ; les
 * fichiers, eux, sont rangés sur le serveur sous une clé dérivée du NUMÉRO
 * (docs/<docServerKey(numero)>/…). Les deux peuvent diverger :
 *   - le dossier a été RENOMMÉ après le versement : les pièces dorment
 *     intactes sous l'ancienne clé, la nouvelle est vide ;
 *   - la pièce vient de l'application bureau (avant l'édition web du
 *     12/06/2026) : la fiche a été migrée, le fichier seulement si la
 *     synchronisation avec le dossier commun (P:\) a tourné pour ce dossier ;
 *   - le chemin de la fiche et celui du serveur ne s'écrivent pas pareil
 *     (accents, espaces, parenthèses) — même pièce, pas une perte.
 *
 * Ce module CONSTATE (lecture du disque, zéro jeton) et sait RATTACHER un
 * rangement orphelin à son dossier — jamais d'écrasement, jamais de
 * suppression.
 */
import fs from 'node:fs'
import path from 'node:path'
import { attacheTj, tjDataDir, listDocsMeta, docServerKey, readJson, atomicWrite } from './store.mjs'
import { loadContentieux, numeroCanonique, canonRel } from './dossier.mjs'
import { allInstructionDossiers } from './instru.mjs'
import { numerosProches } from './numero.mjs'

const PSEUDO_DOSSIERS = ['_casiers', '_hors-dossier']

const blobExiste = (tj, cle, rel) => fs.existsSync(tjDataDir(tj, 'docs', cle, rel + '.enc'))

/** Pièces RÉELLEMENT présentes sous une clé (entrée d'index ET fichier), hors jumeaux MD/. */
function piecesServeur(tj, cle) {
  return listDocsMeta(tj, cle)
    .filter((m) => !String(m.rel).startsWith('MD/') && blobExiste(tj, cle, m.rel))
}

/** Clés de rangement de tous les dossiers connus (enquêtes, instructions, pseudo-dossiers). */
function clesConnues(keys, enquetes) {
  const out = new Set(PSEUDO_DOSSIERS.map(docServerKey))
  for (const e of enquetes) if (e?.numero) out.add(docServerKey(e.numero))
  let instr = []
  try { instr = allInstructionDossiers(keys) } catch { /* module instruction absent */ }
  for (const d of instr) {
    for (const n of [d.numeroInstruction, d.numeroParquet, d.enquetePreliminaireNumero]) if (n) out.add(docServerKey(n))
  }
  return out
}

/** Rangements dont la clé ne correspond plus à AUCUN dossier — pièces non vues de l'app. */
function rangementsOrphelins(tj, connues) {
  const racine = tjDataDir(tj, 'docs')
  if (!fs.existsSync(racine)) return []
  return fs.readdirSync(racine, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !connues.has(d.name))
    .map((d) => {
      const pieces = piecesServeur(tj, d.name)
      return { cle: d.name, pieces, canon: new Set(pieces.map((p) => canonRel(p.rel))) }
    })
    .filter((o) => o.pieces.length)
}

/**
 * Contrôle de concordance fiche ↔ serveur. Sans `numero` : tout le fonds
 * (archives comprises), dossiers en écart seulement. Avec `numero` : le
 * dossier, liste intégrale des pièces manquantes.
 */
export function piecesIntrouvables(keys, { numero } = {}) {
  const tj = attacheTj()
  const enquetes = loadContentieux(keys).data?.enquetes || []
  const orphelins = rangementsOrphelins(tj, clesConnues(keys, enquetes))
  const cible = numero ? numeroCanonique(keys, numero) : null
  const dossiers = []
  let totalManquantes = 0
  for (const e of enquetes) {
    if (!e?.numero || (cible && String(e.numero) !== cible)) continue
    const fiche = (e.documents || []).filter((d) => d?.cheminRelatif && !String(d.cheminRelatif).startsWith('MD/'))
    if (!fiche.length) continue
    const cle = docServerKey(e.numero)
    const serveur = piecesServeur(tj, cle)
    const exacts = new Set(serveur.map((p) => p.rel))
    const canons = new Set(serveur.map((p) => canonRel(p.rel)))
    const manquantes = fiche.filter((d) => !exacts.has(d.cheminRelatif) && !canons.has(canonRel(d.cheminRelatif)))
    if (!manquantes.length) continue
    totalManquantes += manquantes.length
    // Où dorment-elles ? même chemin (canonique) sous une clé orpheline.
    const retrouvees = {}
    for (const d of manquantes) {
      const o = orphelins.find((x) => x.canon.has(canonRel(d.cheminRelatif)))
      if (o) retrouvees[o.cle] = (retrouvees[o.cle] || 0) + 1
    }
    const dates = manquantes.map((d) => String(d.dateAjout || '').slice(0, 10)).filter(Boolean).sort()
    dossiers.push({
      numero: e.numero,
      statut: e.statut,
      cle,
      fiche: fiche.length,
      serveur: serveur.length,
      manquantes: manquantes.length,
      ajouteesEntre: dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : null,
      ...(Object.keys(retrouvees).length ? { retrouveesSous: retrouvees } : {}),
      pieces: (cible ? manquantes : manquantes.slice(0, 5)).map((d) => d.cheminRelatif),
    })
  }
  return {
    dossiersEnEcart: dossiers.length,
    piecesManquantes: totalManquantes,
    dossiers,
    // Rangements sans dossier : avec le ou les dossiers dont le numéro s'en rapproche.
    rangementsOrphelins: orphelins
      .map((o) => ({
        cle: o.cle,
        pieces: o.pieces.length,
        deposeesEntre: (() => {
          const d = o.pieces.map((p) => String(p.savedAt || '').slice(0, 10)).filter(Boolean).sort()
          return d.length ? `${d[0]} → ${d[d.length - 1]}` : null
        })(),
        dossiersProbables: enquetes.filter((e) => numerosProches(e.numero, o.cle)).map((e) => e.numero).slice(0, 3),
      }))
      .filter((o) => !cible || o.dossiersProbables.includes(cible)),
    lecture: 'manquantes = pièces listées par la fiche sans fichier sous la clé du dossier. retrouveesSous = même pièce trouvée sous un ANCIEN rangement (dossier renommé) : pieces_rattacher la récupère. Pièces non retrouvées et ajoutées avant le 12/06/2026 : versées dans l\'application bureau, le fichier n\'a jamais été recopié sur le serveur — il est sur le dossier commun (P:\\) ; la synchronisation du dossier depuis l\'app le reverse.',
  }
}

/**
 * Rattache au dossier `numero` les pièces d'un rangement ORPHELIN (`cle`) :
 * chaque fichier est déplacé tel quel (jamais réécrit), l'entrée d'index
 * suit ; une pièce homonyme déjà présente dans le dossier reste en place
 * sous l'ancienne clé (rendue dans `conflits`). Refuse une clé qui appartient
 * à un dossier connu.
 */
export function rattacherPieces(keys, { cle, numero }) {
  const tj = attacheTj()
  const enquetes = loadContentieux(keys).data?.enquetes || []
  const canon = numeroCanonique(keys, numero)
  if (!enquetes.some((e) => String(e.numero) === canon)) return { erreur: `Dossier ${numero} introuvable` }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,120}$/.test(String(cle || '')) || String(cle).includes('..')) return { erreur: 'Clé invalide' }
  if (clesConnues(keys, enquetes).has(cle)) return { erreur: `La clé ${cle} est le rangement d'un dossier existant — elle n'est pas orpheline` }
  const vers = docServerKey(canon)
  const srcDir = tjDataDir(tj, 'docs', cle)
  const dstDir = tjDataDir(tj, 'docs', vers)
  if (!fs.existsSync(srcDir)) return { erreur: `Aucun rangement sous ${cle}` }
  const indexSrc = readJson(path.join(srcDir, '.index.json'), [])
  const indexDst = readJson(path.join(dstDir, '.index.json'), [])
  const restants = []
  const conflits = []
  let deplacees = 0
  for (const d of indexSrc) {
    const src = path.join(srcDir, d.rel + '.enc')
    const dst = path.join(dstDir, d.rel + '.enc')
    if (!fs.existsSync(src)) continue
    if (fs.existsSync(dst)) { restants.push(d); conflits.push(d.rel); continue }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.renameSync(src, dst)
    indexDst.push(d)
    deplacees++
  }
  atomicWrite(path.join(dstDir, '.index.json'), JSON.stringify(indexDst, null, 2))
  atomicWrite(path.join(srcDir, '.index.json'), JSON.stringify(restants, null, 2))
  return { numero: canon, de: cle, vers, deplacees, conflits }
}
