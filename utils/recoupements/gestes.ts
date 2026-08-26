// utils/recoupements/gestes.ts
//
// CE QUE L'UTILISATEUR A DÉJÀ DIT D'UN SIGNAL — et ce qu'on en fait.
//
// Un geste (« vu », « écarté ») est une décision : elle vaut jusqu'à ce que la
// situation change VRAIMENT. La règle, une seule, tenue partout :
//
//   un signal ne ressort que si un dossier de PLUS rejoint la coïncidence.
//
// Elle n'est pas symétrique, et c'est voulu. L'empreinte du geste était
// comparée caractère à caractère à celle du signal : dès lors, un dossier qui
// QUITTAIT la coïncidence — une pièce pas encore relue au démarrage, une
// enquête archivée, un dossier versé dans son instruction — suffisait à faire
// « changer » l'empreinte, et le signal écarté revenait « à regarder ». Il ne
// s'était pourtant rien passé de neuf. On raisonne donc par INCLUSION : tant
// que les dossiers du jour étaient déjà connus au moment du geste, silence.
//
// Ce module ne connaît ni React ni les préférences : il ne fait que trier.

import type { Recoupement, RecoupementAck, RecoupementAcks } from '@/types/recoupementTypes';

/**
 * Dossiers mémorisés au moment du geste. Les gestes enregistrés avant que
 * l'ack ne porte la liste explicitement n'ont que leur empreinte : elle EST
 * cette liste, jointe par « | » (cf. engine.ts, `stateKey`).
 */
export function dossiersDuGeste(ack: RecoupementAck): string[] {
  if (ack.dossierKeys && ack.dossierKeys.length > 0) return ack.dossierKeys;
  return (ack.stateKey || '').split('|').filter(Boolean);
}

/**
 * Un dossier de plus a-t-il rejoint la coïncidence depuis le geste ?
 * C'est la SEULE raison de reparler d'un signal déjà traité : la question
 * n'est alors plus la même. Un dossier qui s'en va, lui, n'ajoute rien.
 */
export function aGagneUnDossier(ack: RecoupementAck | undefined, signal: Recoupement): boolean {
  if (!ack) return true; // jamais traité
  const connus = new Set(dossiersDuGeste(ack));
  if (connus.size === 0) return true; // geste sans empreinte : on ne garantit rien
  return signal.dossierKeys.some(key => !connus.has(key));
}

/** Le signal est neuf : jamais traité, ou un dossier de plus depuis le geste. */
export function estNouveau(acks: RecoupementAcks, signal: Recoupement): boolean {
  return aGagneUnDossier(acks[signal.id], signal);
}

/**
 * Le signal avait été écarté et ressort parce qu'un dossier de plus l'a
 * rejoint. À dire à l'écran : sans cela, il a tout l'air d'un écartement qui
 * n'a pas tenu.
 */
export function estRevenuApresEcart(acks: RecoupementAcks, signal: Recoupement): boolean {
  const ack = acks[signal.id];
  return ack?.action === 'ecarte' && aGagneUnDossier(ack, signal);
}

/** Empreinte d'un geste porté maintenant sur ce signal. */
export function ackPour(signal: Recoupement, action: 'vu' | 'ecarte', at: string): RecoupementAck {
  return { stateKey: signal.stateKey, dossierKeys: [...signal.dossierKeys], action, at };
}

/** Répartition d'un lot de signaux selon les gestes déjà portés. */
export function trierSelonGestes(signaux: Recoupement[], acks: RecoupementAcks): {
  /** Ce qui reste à regarder (les écartés en sont sortis). */
  retenus: Recoupement[];
  /** Parmi les retenus, ceux qui portent quelque chose de neuf. */
  nouveaux: Recoupement[];
  /** Écartés, et toujours muets. */
  ecartes: Recoupement[];
} {
  const retenus: Recoupement[] = [];
  const nouveaux: Recoupement[] = [];
  const ecartes: Recoupement[] = [];
  for (const signal of signaux) {
    const ack = acks[signal.id];
    const neuf = aGagneUnDossier(ack, signal);
    if (ack?.action === 'ecarte' && !neuf) { ecartes.push(signal); continue; }
    retenus.push(signal);
    if (neuf) nouveaux.push(signal);
  }
  return { retenus, nouveaux, ecartes };
}

/**
 * Gestes à écrire quand un lot de signaux passe sous les yeux (dépliage d'un
 * bandeau, fermeture de la vue d'ensemble). Rien d'autre : c'est un « j'ai
 * vu » passif, il ne décide de rien.
 *
 * Deux signaux n'y entrent pas :
 *   - celui que l'utilisateur a ÉCARTÉ. Un écartement est une décision, seul
 *     un autre geste la défait — surtout pas un regard. C'était le défaut :
 *     un signal écarté remonté à l'affichage était réenregistré « vu », et
 *     l'écartement disparaissait définitivement (l'onglet « Écartés » se
 *     vidait tout seul) ;
 *   - celui qui n'a rien de neuf : son geste est déjà à jour, le réécrire ne
 *     ferait que pousser des préférences pour rien.
 */
export function patchVus(
  signaux: Recoupement[],
  acks: RecoupementAcks,
  at: string,
): RecoupementAcks {
  const patch: RecoupementAcks = {};
  for (const signal of signaux) {
    const ack = acks[signal.id];
    if (ack?.action === 'ecarte') continue;
    if (!aGagneUnDossier(ack, signal)) continue;
    patch[signal.id] = ackPour(signal, 'vu', at);
  }
  return patch;
}

/**
 * Fusion de deux jeux de gestes, le plus récent l'emportant signal par signal.
 *
 * Les préférences arrivent parfois APRÈS le premier rendu (l'utilisateur n'est
 * pas encore résolu au montage) ou repassent par une synchronisation : on ne
 * peut ni jeter ce qui vient d'arriver, ni jeter ce qui vient d'être fait ici.
 */
export function fusionnerAcks(a: RecoupementAcks, b: RecoupementAcks): RecoupementAcks {
  const suite: RecoupementAcks = { ...a };
  for (const [id, ack] of Object.entries(b)) {
    const actuel = suite[id];
    if (!actuel || Date.parse(ack.at || '') >= Date.parse(actuel.at || '')) suite[id] = ack;
  }
  return suite;
}
