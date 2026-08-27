/**
 * SIRAL — texte déjà extrait d'une pièce.
 *
 * Une pièce versée est un PDF chiffré. Pour la chercher, il faut son texte —
 * et l'extraire coûte cher : téléchargement, déchiffrement, analyse du PDF,
 * océrisation quand la pièce est un scan. Ce travail est fait UNE fois, par le
 * service attaché, qui range le résultat dans un cache CHIFFRÉ avec la clé
 * « global » — celle-là même que détient le navigateur de chaque utilisateur.
 *
 * Ce module ne fait qu'une chose : retrouver cette enveloppe et la rendre. Il
 * ne la déchiffre pas, il n'en a pas les moyens — le serveur web reste aveugle
 * de bout en bout, comme pour tout le reste. Le navigateur, lui, l'ouvrira.
 *
 * Sans ce chemin, chaque navigateur refaisait l'extraction pour son propre
 * compte, sans océrisation (il n'en a pas les outils) : les procès-verbaux
 * scannés restaient introuvables à la recherche, et le poste du magistrat
 * payait en temps de calcul un travail déjà fait ailleurs.
 */
import fs from 'fs'
import crypto from 'crypto'
import { tjDataDir, docPath, isSafeName, isSafeRelPath } from './store'
import { docCacheBasename } from '@/lib/documents/docCacheCore.mjs'

/** Enveloppe telle que l'attaché l'écrit (cf. scripts/attache/crypto.mjs). */
export interface DocTexteEnvelope {
  v: number
  encrypted: true
  iv: string
  ct: string
}

/** TJ dont l'attaché tient le cache (le même que pour ses journaux). */
function attacheTjId(): string {
  return process.env.SIRAL_ATTACHE_TJ || 'default'
}

/**
 * Emplacement du cache d'une pièce. La formule est PARTAGÉE avec le service
 * attaché qui écrit ce cache (lib/documents/docCacheCore.mjs) : il n'en existe
 * qu'une, et elle ne peut donc pas diverger en silence.
 */
function cheminCache(enqueteKey: string, cheminRelatif: string, variante = ''): string {
  return tjDataDir(attacheTjId(), 'attache', 'doccache', docCacheBasename(enqueteKey, cheminRelatif, variante) + '.json')
}

/**
 * Le texte en cache correspond-il TOUJOURS à la pièce en place ?
 *
 * Le cache retient l'empreinte du blob chiffré dont il est issu. Une pièce
 * re-téléversée produit un autre blob : servir l'ancien texte reviendrait à
 * chercher dans une version périmée d'un procès-verbal — silencieusement.
 * L'empreinte se vérifie sans rien déchiffrer, ce qui laisse le serveur web
 * exactement aussi aveugle qu'avant.
 */
function empreinteDuBlob(tj: string, enquete: string, rel: string): string | null {
  try {
    const p = docPath(tj, enquete, rel)
    if (!fs.existsSync(p)) return null
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  } catch {
    return null
  }
}

/**
 * Enveloppe du texte d'une pièce, ou `null` si le serveur n'en a pas (ou plus)
 * — auquel cas le navigateur extraira lui-même, comme avant.
 *
 * Le champ `blobHash` de l'enveloppe n'étant lisible qu'une fois déchiffré,
 * la vérification de fraîcheur est faite PAR LE NAVIGATEUR après ouverture :
 * on lui joint donc l'empreinte attendue, calculée ici.
 */
export function lireTexteEnCache(
  tj: string,
  enquete: string,
  rel: string,
): { envelope: DocTexteEnvelope; blobHash: string } | null {
  if (!isSafeName(enquete) || !isSafeRelPath(rel)) return null
  const attendu = empreinteDuBlob(tj, enquete, rel)
  if (!attendu) return null // la pièce n'est plus là : rien à servir

  for (const variante of ['integrale', '']) {
    // 'integrale' d'abord : c'est la lecture la plus complète (pages images
    // océrisées). À défaut, la lecture ordinaire.
    const p = cheminCache(enquete, rel, variante)
    if (!fs.existsSync(p)) continue
    try {
      const envelope = JSON.parse(fs.readFileSync(p, 'utf8')) as DocTexteEnvelope
      if (!envelope?.encrypted || !envelope.iv || !envelope.ct) continue
      return { envelope, blobHash: attendu }
    } catch {
      /* enveloppe illisible : on passe à la variante suivante */
    }
  }
  return null
}
