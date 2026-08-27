/**
 * SIRAL — où se range le texte déjà extrait d'une pièce.
 *
 * SOURCE UNIQUE de la formule, partagée par :
 *  - le service attaché, qui ÉCRIT le cache après extraction (et océrisation) ;
 *  - le serveur web, qui le RELIT pour le servir au navigateur.
 *
 * Elle a l'air anodine, et c'est précisément pourquoi elle vit ici : deux
 * copies qui divergent d'un caractère ne produisent aucune erreur. Le serveur
 * chercherait simplement un fichier qui n'existe pas, répondrait « rien en
 * cache », et chaque navigateur se remettrait à extraire tous les PDF pour son
 * compte — sans que rien, nulle part, ne signale la panne.
 *
 * Module Node (empreinte SHA-256) : jamais importé par du code navigateur.
 */
import crypto from 'node:crypto'

/**
 * Nom du fichier de cache d'une pièce, sans extension.
 *
 * @param {string} enqueteKey     clé serveur de l'enquête (cf. docServerKey)
 * @param {string} cheminRelatif  chemin de la pièce dans le dossier
 * @param {string} [variante]     '' = lecture ordinaire ; 'integrale' = pages
 *   images océrisées. Deux caches distincts : chaque mode n'est extrait qu'une
 *   fois, et la lecture ordinaire n'est jamais écrasée par l'intégrale.
 */
export function docCacheBasename(enqueteKey, cheminRelatif, variante = '') {
  return crypto.createHash('sha256')
    .update(enqueteKey + '\n' + cheminRelatif + (variante ? '\n' + variante : ''))
    .digest('hex').slice(0, 32)
}
