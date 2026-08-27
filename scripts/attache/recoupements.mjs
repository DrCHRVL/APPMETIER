/**
 * SIRAL — Attaché de justice · CHANTIER DE RECOUPEMENTS.
 *
 * Rapprocher deux cents dossiers les uns des autres, pièces comprises, est le
 * calcul le plus lourd de l'application. Il se faisait dans l'onglet du
 * magistrat : il fallait donc le brider pour que le navigateur survive — texte
 * des pièces plafonné, pièces abandonnées au-delà d'un budget mémoire, huit
 * extractions par session, calcul rendu à l'état haché par des respirations
 * incessantes. Le résultat était bridé ET l'application ramait.
 *
 * Le calcul vit désormais ICI, dans le service attaché : le seul composant qui
 * détienne les clés (chiffrement de bout en bout — le serveur web, lui, ne voit
 * que des enveloppes opaques). Il tourne une fois par semaine, la nuit, et à la
 * demande. Plus aucune bride : le fonds ENTIER, toutes les pièces, tous les
 * contentieux confiés.
 *
 * AUCUNE IA. C'est du calcul pur : ce chantier ne consomme pas un jeton, ne
 * dépend pas de l'authentification Claude (qui expire) et ne peut pas être mis
 * en attente par le gouverneur du forfait. Il tourne, point.
 *
 * Le résultat part dans le coffre `recoupements`, chiffré avec la clé GLOBALE :
 * tout utilisateur de SIRAL le lit, personne d'autre — pas même le serveur web
 * qui l'héberge.
 */
import {
  attacheTj, attacheContentieuxListe, readVault, writeVault, listDocsMeta, docServerKey,
} from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { texteDocumentIntegral } from './dossier.mjs'
import { allInstructionDossiers } from './instru.mjs'
import { buildCorpus, docTextKey } from '../../lib/recoupements/corpusCore.mjs'
import { detecterRecoupements } from '../../lib/recoupements/moteurCore.mjs'

/** Coffre de sortie — clé globale, lisible de tous les utilisateurs. */
const COFFRE = 'recoupements'

/**
 * Temps maximal consacré à EXTRAIRE le texte des pièces jamais lues, par
 * passage (minutes). Ce n'est pas une bride sur la détection : les pièces déjà
 * en cache entrent toutes dans le corpus, quelles qu'elles soient. C'est une
 * borne sur l'océrisation d'un fonds qu'on découvre — un premier passage sur
 * dix mille pièces jamais ouvertes prendrait des jours. Ce qui n'a pas pu être
 * lu cette nuit le sera la suivante, le cache étant persistant.
 */
const EXTRACTION_MINUTES = Number(process.env.SIRAL_ATTACHE_RECOUP_EXTRACTION_MIN || 120)

function author(keys) { return keys?.grantedBy || 'admin' }

/** Enquêtes de chaque contentieux CONFIÉ (clé remise pour ce périmètre). */
function chargerEnquetes(keys) {
  const parContentieux = new Map()
  const lus = []
  const absents = []
  for (const ctx of attacheContentieuxListe()) {
    const scope = `ctx-${ctx}`
    const cle = keys.byScope.get(scope)
    if (!cle) { absents.push(ctx); continue }
    const envelope = readVault(attacheTj(), scope)
    if (!envelope) { parContentieux.set(ctx, []); lus.push(ctx); continue }
    try {
      const { data } = decryptJson(cle, envelope)
      parContentieux.set(ctx, data?.enquetes || [])
      lus.push(ctx)
    } catch {
      absents.push(ctx) // clé remise mais coffre illisible : on le dit, on ne devine pas
    }
  }
  return { parContentieux, lus, absents }
}

/**
 * Texte de TOUTES les pièces des enquêtes du corpus.
 *
 * Deux temps, comme l'ingestion : on sert d'abord ce que le cache serveur tient
 * déjà (gratuit), et on n'extrait — océrisation comprise — que ce qui manque,
 * dans la limite du temps imparti. Rien n'est tronqué : ce que l'on retient,
 * on le retient en entier.
 */
async function chargerTextes(keys, parContentieux, { minutes = EXTRACTION_MINUTES, journal } = {}) {
  const tj = attacheTj()
  const textes = new Map()
  const bilan = { pieces: 0, enCache: 0, extraites: 0, illisibles: 0, nonLues: 0, caracteres: 0 }
  const finExtraction = Date.now() + minutes * 60 * 1000

  for (const [, enquetes] of parContentieux) {
    for (const enquete of enquetes || []) {
      if (!enquete?.numero) continue
      const docKey = docServerKey(enquete.numero)
      let metas = null // listDocsMeta n'est lu que si le dossier porte des pièces
      for (const doc of enquete.documents || []) {
        const rel = String(doc?.cheminRelatif || '')
        if (!rel || rel.startsWith('MD/')) continue
        if (metas === null) metas = new Set(listDocsMeta(tj, docKey).map((d) => String(d.rel)))
        if (!metas.has(rel)) continue // pièce référencée mais absente du serveur
        bilan.pieces++

        let res
        try {
          res = await texteDocumentIntegral(keys, docKey, rel, { extraire: false })
        } catch { res = { ok: false } }

        if (res.ok) bilan.enCache++
        else if (res.nonExtrait) {
          if (Date.now() >= finExtraction) { bilan.nonLues++; continue } // repris la prochaine fois
          try {
            res = await texteDocumentIntegral(keys, docKey, rel)
          } catch { res = { ok: false } }
          if (res.ok) bilan.extraites++
        }

        if (!res.ok) { bilan.illisibles++; continue }
        const texte = String(res.texte || '')
        if (!texte) continue
        textes.set(docTextKey(enquete.numero, rel), texte)
        bilan.caracteres += texte.length
      }
    }
    if (journal) journal(bilan)
  }
  return { textes, bilan }
}

/**
 * Un tour complet de recoupements.
 *
 * `progression` est appelé aux étapes qui durent, pour que le panneau de
 * l'administrateur ne montre jamais un service muet.
 */
export async function passeRecoupements(keys, { progression = () => {}, extractionMinutes } = {}) {
  const debut = Date.now()

  progression({ etape: 'dossiers' })
  const { parContentieux, lus, absents } = chargerEnquetes(keys)
  const instructions = allInstructionDossiers(keys)

  progression({ etape: 'pieces' })
  const { textes, bilan } = await chargerTextes(keys, parContentieux, {
    minutes: extractionMinutes,
    journal: (b) => progression({ etape: 'pieces', pieces: b.pieces, extraites: b.extraites }),
  })

  progression({ etape: 'corpus' })
  // Rendre la main entre deux dossiers : le service répond aussi à l'API du
  // panneau et à la relève des mails pendant qu'il calcule.
  const respirer = () => new Promise((r) => setImmediate(r))
  const corpus = await buildCorpus(parContentieux, instructions, { documentTexts: textes }, { respirer })
  if (!corpus) throw new Error('Construction du corpus interrompue')

  progression({ etape: 'detection', dossiers: corpus.length })
  const signaux = await detecterRecoupements(corpus, {
    respirer,
    avancement: (lusDossiers, total) => progression({ etape: 'detection', dossiers: total, lus: lusDossiers }),
  })
  if (!signaux) throw new Error('Détection interrompue')

  const resultat = {
    v: 1,
    calculeAt: new Date().toISOString(),
    dureeMs: Date.now() - debut,
    perimetre: {
      contentieux: lus,
      contentieuxSansCle: absents,
      dossiers: corpus.length,
      instructions: instructions.length,
      pieces: bilan.pieces,
      piecesLues: bilan.enCache + bilan.extraites,
      piecesExtraitesCeTour: bilan.extraites,
      piecesIllisibles: bilan.illisibles,
      piecesNonLues: bilan.nonLues,
      caracteresLus: bilan.caracteres,
    },
    signaux,
  }

  const savedAt = resultat.calculeAt
  const envelope = encryptJson(keys.global, resultat, { savedAt, savedBy: author(keys) })
  await writeVault(attacheTj(), COFFRE, envelope, author(keys))
  return resultat
}

/** Dernier résultat connu, sans recalculer (pour le panneau d'administration). */
export function dernierResultat(keys) {
  const envelope = readVault(attacheTj(), COFFRE)
  if (!envelope) return null
  try {
    const r = decryptJson(keys.global, envelope)
    return { calculeAt: r.calculeAt, dureeMs: r.dureeMs, perimetre: r.perimetre, signaux: (r.signaux || []).length }
  } catch {
    return null
  }
}
