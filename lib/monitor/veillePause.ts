// lib/monitor/veillePause.ts
//
// SUSPENSION DE LA VEILLE DE RECOUPEMENTS.
//
// La veille lit tout le fonds — fiches, comptes rendus, actes, texte des pièces
// analysées — pour proposer des rapprochements entre dossiers. C'est, de loin,
// le travail de fond le plus lourd de l'onglet.
//
// Quand le poste peine (machine modeste, fonds très analysé, rédaction en
// cours), le magistrat doit pouvoir la mettre en pause d'un geste depuis le
// moniteur d'activité, et retrouver une interface franche dans la seconde —
// sans attendre un correctif et sans redémarrer. Rien n'est perdu : les gestes
// enregistrés (signaux vus, signaux écartés) sont des préférences, et la veille
// recalcule ses signaux à la reprise. Le temps de la pause, l'onglet n'affiche
// simplement plus de rapprochement.
//
// Le choix vaut pour ce navigateur (localStorage) et survit au rechargement.

const CLE = 'siral.veilleRecoupements.suspendue';

const abonnes = new Set<() => void>();
let suspendue: boolean | null = null;

/** Vrai si l'utilisateur a mis la veille en pause sur ce poste. */
export function veilleSuspendue(): boolean {
  if (suspendue === null) {
    try {
      suspendue = typeof window !== 'undefined' && window.localStorage.getItem(CLE) === '1';
    } catch {
      suspendue = false; // navigation privée, stockage refusé : la veille tourne
    }
  }
  return suspendue;
}

export function setVeilleSuspendue(valeur: boolean): void {
  if (veilleSuspendue() === valeur) return;
  suspendue = valeur;
  try {
    window.localStorage.setItem(CLE, valeur ? '1' : '0');
  } catch {
    /* le choix vaudra pour cette session seulement */
  }
  for (const cb of abonnes) {
    try { cb(); } catch { /* un abonné cassé ne bloque pas les autres */ }
  }
}

/** S'abonner au changement d'état. Rend le désabonnement. */
export function surChangementVeille(cb: () => void): () => void {
  abonnes.add(cb);
  return () => { abonnes.delete(cb); };
}
