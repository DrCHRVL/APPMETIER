/**
 * SIRAL — l'attaché est-il vivant, et que fournit-il en ce moment ?
 *
 * POURQUOI CE MODULE EXISTE.
 *
 * Certaines fonctions de SIRAL supposent de lire TOUT le fonds sans qu'un
 * magistrat soit devant son écran : rapprocher deux cents dossiers, lire et
 * océriser des milliers de pièces. Le serveur web ne le peut pas — il ne
 * manipule que des enveloppes chiffrées. Seul le service attaché le peut, avec
 * les clés que l'administrateur lui a remises.
 *
 * D'où un risque propre à cette architecture : ces fonctions ne tombent pas en
 * panne bruyamment, elles DISPARAISSENT. L'écran s'affiche normalement, la
 * liste est simplement vide — et une liste vide de recoupements ressemble trait
 * pour trait à « vos dossiers ne se touchent pas ». C'est la différence entre
 * un soit-transmis revenu « rien à signaler » et un soit-transmis jamais parti :
 * le dossier ne contient rien de plus dans les deux cas, mais on n'oriente pas
 * pareil.
 *
 * Sur cinq façons de tomber en panne, TROIS laissent le service parfaitement
 * vivant en apparence (clés jamais remises, clés révoquées, clés remises pour
 * une partie seulement des contentieux). Ce module les nomme, en une phrase.
 *
 * Il distingue par ailleurs deux capacités qu'on confond volontiers :
 *  - CE QU'IL CALCULE : recoupements, texte des pièces. Calcul local pur,
 *    aucune intelligence artificielle, aucun jeton, rien qui sorte de la
 *    machine. Ne dépend que des clés.
 *  - CE QU'IL RÉDIGE : les travaux confiés à Claude. Ceux-là dépendent en plus
 *    d'une authentification qui EXPIRE.
 * Une authentification Claude périmée ne doit donc jamais faire croire que les
 * recoupements sont morts : ils n'en ont aucun besoin.
 */

export type EtatAttache = 'absent' | 'injoignable' | 'aveugle' | 'partiel' | 'en-marche'

export interface FaitsAttache {
  /** SIRAL_ATTACHE_URL renseigné : la fonctionnalité existe pour cette instance. */
  configure: boolean
  /** Le service a répondu à l'interrogation. */
  joignable: boolean
  /** Clé-maître présente dans son environnement (sans elle, pas de trousseau). */
  cleMaitre: boolean
  /** Périmètres attendus (« global », « ctx-crimorg »…). */
  scopesAttendus: string[]
  /** Périmètres réellement remis. */
  scopesRemis: string[]
  /** Authentification Claude en règle (ne concerne QUE les travaux rédactionnels). */
  claudeOk: boolean
}

export interface SanteAttache {
  etat: EtatAttache
  /** Une phrase, lisible telle quelle par le magistrat. */
  resume: string
  /** Ce qu'il faut faire, quand il y a quelque chose à faire. */
  remede: string | null
  contentieuxVus: string[]
  contentieuxManquants: string[]
  /** L'IA est une capacité À PART : son absence n'empêche aucun calcul. */
  iaDisponible: boolean
}

const libelleCtx = (scope: string) => scope.replace(/^ctx-/, '')

/**
 * Le verdict. Fonction PURE : elle se lit, se raconte à l'écran et se teste —
 * c'est tout l'intérêt d'avoir un endroit unique plutôt qu'un diagnostic
 * reconstitué à la main dans trois panneaux différents.
 */
export function verdictAttache(faits: FaitsAttache): SanteAttache {
  const attendus = faits.scopesAttendus.filter((s) => s.startsWith('ctx-'))
  const remis = faits.scopesRemis.filter((s) => s.startsWith('ctx-'))
  const manquants = attendus.filter((s) => !remis.includes(s))
  const base = {
    contentieuxVus: remis.map(libelleCtx),
    contentieuxManquants: manquants.map(libelleCtx),
    iaDisponible: faits.claudeOk,
  }

  if (!faits.configure) {
    return {
      ...base,
      etat: 'absent',
      resume: 'L’attaché n’est pas installé sur ce serveur. Les recoupements entre dossiers ne sont donc pas calculés, et le texte des pièces est extrait par chaque navigateur (sans océrisation des pièces scannées).',
      remede: 'Renseigner SIRAL_ATTACHE_URL dans le fichier .env du serveur, puis relancer — voir docs/ATTACHE.md.',
    }
  }
  if (!faits.joignable) {
    return {
      ...base,
      etat: 'injoignable',
      resume: 'L’attaché est configuré mais ne répond pas. Tout ce qu’il fournit est figé à son dernier passage.',
      remede: 'Vérifier que le conteneur tourne : docker compose ps attache',
    }
  }
  if (!faits.cleMaitre) {
    return {
      ...base,
      etat: 'aveugle',
      resume: 'L’attaché tourne, mais sa clé-maître est absente : il ne peut conserver aucun trousseau, et ne voit donc rien.',
      remede: 'Renseigner SIRAL_ATTACHE_MASTER_KEY dans le .env du serveur (openssl rand -hex 32), puis relancer le conteneur.',
    }
  }
  if (remis.length === 0) {
    return {
      ...base,
      etat: 'aveugle',
      resume: 'L’attaché tourne, et ne voit rien : les clés ne lui ont pas été remises, ou elles ont été révoquées. Aucun recoupement ne sera calculé tant que ce sera le cas.',
      remede: 'Remettre les clés depuis ce panneau, navigateur déverrouillé.',
    }
  }
  if (manquants.length > 0) {
    const liste = manquants.map(libelleCtx).join(', ')
    return {
      ...base,
      etat: 'partiel',
      resume: `L’attaché ne voit que ${remis.length} des ${attendus.length} contentieux qui lui sont confiés. Ce qui manque — ${liste} — n’entre dans AUCUN recoupement : un pont entre l’un d’eux et un autre dossier passerait inaperçu.`,
      remede: 'Remettre les clés depuis ce panneau : les périmètres manquants seront joints.',
    }
  }
  return {
    ...base,
    etat: 'en-marche',
    resume: `L’attaché est en marche et voit les ${remis.length} contentieux confiés.`,
    remede: null,
  }
}
