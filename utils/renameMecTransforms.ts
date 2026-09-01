// utils/renameMecTransforms.ts
// Règles PURES du renommage d'une personne : qui est concerné, et à quoi
// ressemble chaque enregistrement une fois corrigé. Séparées de
// l'orchestration (utils/renameMec.ts) parce qu'elles décident d'une
// réécriture en base : elles doivent pouvoir être lues et testées seules,
// sans store ni navigateur (cf. scripts/carto-renommage.test.mjs).
//
// Identité : deux graphies désignent la même personne quand leur clé
// insensible à l'ordre des mots coïncide (`mecSortedKey`) — exactement la
// règle qui fusionne les nœuds du graphe. On n'utilise PAS ici le
// rapprochement tolérant aux coquilles : il sert à SUGGÉRER un rapprochement,
// jamais à décider seul d'une réécriture en base.

import type { Enquete, MisEnCause } from '@/types/interfaces';
import type { DossierInstruction } from '@/types/instructionTypes';
import type { ResultatAudience } from '@/types/audienceTypes';
import { mecSortedKey } from '@/utils/mindmapGraph';

/** Prédicat d'appartenance à la personne visée. */
export type MecMatcher = (nom: string | undefined) => boolean;

/** Vrai si `nom` désigne la personne visée (clé insensible à l'ordre des mots). */
export function makeMatcher(ancienNom: string): MecMatcher {
  const target = mecSortedKey(ancienNom);
  if (!target) return () => false;
  return (nom) => !!nom && mecSortedKey(nom) === target;
}

/** Réécrit les mis en cause d'une enquête. `null` si elle n'est pas concernée. */
export function renameInEnquete(
  enquete: Enquete,
  matches: MecMatcher,
  nouveauNom: string,
): { enquete: Enquete; hits: number } | null {
  const liste = enquete.misEnCause;
  if (!Array.isArray(liste) || liste.length === 0) return null;
  let hits = 0;
  const next: MisEnCause[] = liste.map(mec => {
    if (!matches(mec.nom)) return mec;
    hits++;
    return { ...mec, nom: nouveauNom };
  });
  if (hits === 0) return null;
  return {
    enquete: { ...enquete, misEnCause: next, dateMiseAJour: new Date().toISOString() },
    hits,
  };
}

/** Réécrit les personnes d'un dossier d'instruction. `null` si rien à faire. */
export function renameInDossierInstruction(
  dossier: DossierInstruction,
  matches: MecMatcher,
  nouveauNom: string,
): { updates: Partial<DossierInstruction>; hits: number } | null {
  let hits = 0;
  const updates: Partial<DossierInstruction> = {};

  const misEnExamen = (dossier.misEnExamen || []).map(m => {
    if (!matches(m.nom)) return m;
    hits++;
    return { ...m, nom: nouveauNom };
  });
  if (hits > 0) updates.misEnExamen = misEnExamen;

  const avantSuspects = hits;
  const suspects = (dossier.suspects || []).map(s => {
    if (!matches(s.nom)) return s;
    hits++;
    return { ...s, nom: nouveauNom };
  });
  if (hits > avantSuspects) updates.suspects = suspects;

  const avantVictimes = hits;
  const victimes = (dossier.victimes || []).map(v => {
    if (!matches(v.nom)) return v;
    hits++;
    return { ...v, nom: nouveauNom };
  });
  if (hits > avantVictimes) updates.victimes = victimes;

  return hits > 0 ? { updates, hits } : null;
}

/** Réécrit les condamnés d'un résultat d'audience. `null` si rien à faire. */
export function renameInResultat(
  resultat: ResultatAudience,
  matches: MecMatcher,
  nouveauNom: string,
): { resultat: ResultatAudience; hits: number } | null {
  const liste = resultat.condamnations;
  if (!Array.isArray(liste) || liste.length === 0) return null;
  let hits = 0;
  const next = liste.map(c => {
    if (!matches(c.nom)) return c;
    hits++;
    return { ...c, nom: nouveauNom };
  });
  if (hits === 0) return null;
  return { resultat: { ...resultat, condamnations: next }, hits };
}

