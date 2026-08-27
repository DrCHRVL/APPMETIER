// utils/recoupements/engine.ts
//
// Le moteur de recoupements ne vit plus ici : il est passé dans le module
// PARTAGÉ lib/recoupements/moteurCore.mjs, que le SERVICE ATTACHÉ exécute côté
// serveur. C'est ce déménagement qui a permis de lui retirer ses brides — un
// navigateur ne pouvait pas lire un fonds entier sans tomber, un serveur si.
//
// Ce fichier n'en garde que ce dont l'AFFICHAGE a besoin, avec son typage.

import {
  LIBELLE_KIND as LIBELLE_KIND_CORE,
  LIBELLE_ORIGINE as LIBELLE_ORIGINE_CORE,
  clePaire as clePaireCore,
  patronymeDe as patronymeDeCore,
} from '@/lib/recoupements/moteurCore.mjs';
import type { RecoupementKind, RecoupementOrigine } from '@/types/recoupementTypes';

/** Libellé lisible d'une nature de recoupement (« Même ligne », « Même adresse »…). */
export const LIBELLE_KIND: Record<RecoupementKind, string> = LIBELLE_KIND_CORE;

/** Libellé lisible de la provenance d'une occurrence (« compte rendu », « pièce »…). */
export const LIBELLE_ORIGINE: Record<RecoupementOrigine, string> = LIBELLE_ORIGINE_CORE;

/** Clé d'une paire de dossiers, indépendante de l'ordre. */
export function clePaire(a: string, b: string): string {
  return clePaireCore(a, b);
}

/**
 * Patronyme d'un nom saisi. Convention des fiches et des PV : le nom de
 * famille est en capitales (« MOKRANI Mickael »). À défaut de capitales, on
 * retient le premier mot — c'est l'ordre de saisie majoritaire.
 */
export function patronymeDe(nom: string): string {
  return patronymeDeCore(nom);
}
