// utils/renameMec.ts
// Renommage d'une PERSONNE partout où elle est enregistrée.
//
// Sur la carte, une personne n'est pas une fiche : c'est un nom, lu dans les
// dossiers. Corriger ce nom (coquille, convention Nom/Prénom, patronyme
// incomplet) n'a donc de sens que si la correction retombe sur toutes les
// écritures qui la citent — sinon l'ancienne graphie ressuscite un second
// nœud au prochain calcul du graphe.
//
// Périmètre réécrit :
//   — enquêtes de TOUS les contentieux chargés (mis en cause) ;
//   — dossiers d'instruction du magistrat (mis en examen, suspects, victimes) ;
//   — résultats d'audience, côté enquêtes comme côté instruction (condamnés) ;
//   — données manuelles de la cartographie (fiche, camp, bonus, épingle,
//     liens, dossiers ex nihilo, annotations d'aire).
//
// HORS PORTÉE, par construction : les dossiers projetés par les COLLÈGUES.
// La carte est commune à tous, mais ces dossiers ne sont ici qu'une
// projection en lecture seule — leur propriétaire seul peut les corriger.
// Idem pour un contentieux ouvert en lecture seule.
//
// Les règles de correspondance et de réécriture, elles, vivent dans
// utils/renameMecTransforms.ts (pures, testées à part).

import type { DossierInstruction } from '@/types/instructionTypes';
import { mecSortedKey } from '@/utils/mindmapGraph';
import {
  makeMatcher,
  renameInDossierInstruction,
  renameInEnquete,
  renameInResultat,
} from '@/utils/renameMecTransforms';
import { updateEnquetesAcrossContentieux } from '@/utils/enquetesBulkUpdate';
import { useAudienceStore } from '@/stores/useAudienceStore';
import { useInstructionResultatsStore } from '@/stores/useInstructionResultatsStore';
import { useCartographieOverlayStore } from '@/stores/useCartographieOverlayStore';

export interface RenameMecReport {
  /** Occurrences réécrites parmi les mis en cause des enquêtes. */
  misEnCause: number;
  /** Enquêtes impactées. */
  enquetes: number;
  /** Personnes réécrites dans les dossiers d'instruction (MEX, suspects, victimes). */
  personnesInstruction: number;
  /** Dossiers d'instruction impactés. */
  instructions: number;
  /** Lignes de condamnation réécrites (audiences enquêtes + instruction). */
  condamnations: number;
  /** Références de la cartographie remappées (camp, bonus, liens, fiche…). */
  overlayRefs: number;
}

export interface RenameMecParams {
  /** Nom actuellement porté par la personne sur la carte. */
  ancienNom: string;
  /** Nouveau nom, tel qu'il sera écrit partout. */
  nouveauNom: string;
  /** Dossiers d'instruction du magistrat (l'appelant détient le hook). */
  instructions: DossierInstruction[];
  /** Mutateur du hook `useInstructions` — jamais réinstancié ici : deux
   *  instances du hook écriraient concurremment le même fichier. */
  updateInstruction: (id: number, updates: Partial<DossierInstruction>) => void;
}

/**
 * Applique le renommage partout. Les écritures sont séquentielles : chaque
 * store des résultats relit son fichier avant d'écrire, un lot parallèle
 * perdrait des modifications.
 */
export async function renameMecEverywhere({
  ancienNom,
  nouveauNom,
  instructions,
  updateInstruction,
}: RenameMecParams): Promise<RenameMecReport> {
  const cible = nouveauNom.trim();
  const matches = makeMatcher(ancienNom);
  const report: RenameMecReport = {
    misEnCause: 0,
    enquetes: 0,
    personnesInstruction: 0,
    instructions: 0,
    condamnations: 0,
    overlayRefs: 0,
  };
  if (!cible || !mecSortedKey(ancienNom)) return report;

  // 1. Enquêtes de tous les contentieux chargés (hors lecture seule).
  report.enquetes = await updateEnquetesAcrossContentieux(enquete => {
    const res = renameInEnquete(enquete, matches, cible);
    if (!res) return null;
    report.misEnCause += res.hits;
    return res.enquete;
  });

  // 2. Dossiers d'instruction du magistrat.
  for (const dossier of instructions) {
    const res = renameInDossierInstruction(dossier, matches, cible);
    if (!res) continue;
    updateInstruction(dossier.id, res.updates);
    report.instructions += 1;
    report.personnesInstruction += res.hits;
  }

  // 3. Résultats d'audience (enquêtes puis instruction).
  const audience = useAudienceStore.getState();
  for (const resultat of Object.values(audience.resultats)) {
    const res = renameInResultat(resultat, matches, cible);
    if (!res) continue;
    await audience.saveResultat(res.resultat);
    report.condamnations += res.hits;
  }
  const instructionResultats = useInstructionResultatsStore.getState();
  for (const resultat of Object.values(instructionResultats.resultats)) {
    const res = renameInResultat(resultat, matches, cible);
    if (!res) continue;
    await instructionResultats.saveResultat(res.resultat);
    report.condamnations += res.hits;
  }

  // 4. Données manuelles de la carte : l'id d'un MEC dérivant de son nom, il
  //    faut remapper les références sous peine de camps/bonus orphelins.
  const overlay = useCartographieOverlayStore.getState();
  report.overlayRefs = overlay.renameMecReferences(ancienNom, cible);
  if (report.overlayRefs > 0) await overlay.flush();

  return report;
}
