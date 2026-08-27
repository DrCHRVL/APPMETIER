// utils/recoupements/corpus.ts
//
// La construction du corpus a suivi le moteur sur le serveur : elle vit dans
// le module PARTAGÉ lib/recoupements/corpusCore.mjs, exécuté par le service
// attaché — seul composant qui détienne les clés et puisse donc lire TOUTES
// les pièces, sans budget mémoire ni troncature.
//
// L'application n'en garde que les IDENTIFIANTS DE DOSSIER : ils lui servent à
// rattacher un signal reçu du serveur à la fiche qu'il faut ouvrir.

import {
  docTextKey as docTextKeyCore,
  enqueteKey as enqueteKeyCore,
  instructionKey as instructionKeyCore,
} from '@/lib/recoupements/corpusCore.mjs';

/** Clé d'un texte de pièce dans la table fournie au constructeur de corpus. */
export function docTextKey(enqueteNumero: string, cheminRelatif: string): string {
  return docTextKeyCore(enqueteNumero, cheminRelatif);
}

/** Identifiant stable d'une enquête (les id repartent de 1 par contentieux). */
export function enqueteKey(contentieuxId: string, enqueteId: number): string {
  return enqueteKeyCore(contentieuxId, enqueteId);
}

/** Identifiant stable d'un dossier d'instruction. */
export function instructionKey(dossierId: number): string {
  return instructionKeyCore(dossierId);
}
