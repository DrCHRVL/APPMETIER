// hooks/useKnownPersons.ts
//
// Registre applicatif des personnes connues : une seule liste dédupliquée
// alimentée par TOUTES les sources de noms de l'application —
//   - mis en cause (et victimes) des enquêtes, tous contentieux accessibles ;
//   - mis en examen, suspects et victimes des dossiers d'instruction ;
//   - fiches « ex nihilo » créées à la main dans la cartographie.
//
// C'est ce registre qui alimente les propositions de noms à la saisie (éviter
// un second nœud pour une personne déjà au fichier) et le rapprochement à
// l'import Cassiopée.

import { useEffect, useMemo } from 'react';
import type { Enquete } from '@/types/interfaces';
import type { DossierInstruction } from '@/types/instructionTypes';
import {
  buildKnownPersons,
  indexKnownPersons,
  type KnownPersonsIndex,
  type PersonEntry,
} from '@/utils/knownPersons';
import { useCartographieOverlayStore } from '@/stores/useCartographieOverlayStore';

export interface KnownPersonsSources {
  /** Enquêtes par contentieux (toutes celles chargées : en cours + terminées). */
  enquetesByContentieux: Map<string, Enquete[]>;
  instructions: DossierInstruction[];
  /** Occurrences supplémentaires (condamnés d'un résultat d'audience…). */
  extra?: PersonEntry[];
}

export const useKnownPersons = ({
  enquetesByContentieux,
  instructions,
  extra,
}: KnownPersonsSources): KnownPersonsIndex => {
  // Les fiches manuelles de la cartographie font partie du fichier des
  // personnes : on charge l'overlay même hors du module (lecture seule,
  // idempotent — `load()` sort tout de suite s'il a déjà tourné).
  const mecsExNihilo = useCartographieOverlayStore(s => s.mecsExNihilo);
  const overlayLoaded = useCartographieOverlayStore(s => s.isLoaded);
  const loadOverlay = useCartographieOverlayStore(s => s.load);

  useEffect(() => {
    if (!overlayLoaded) void loadOverlay();
  }, [overlayLoaded, loadOverlay]);

  return useMemo(() => {
    const entries: PersonEntry[] = [];

    enquetesByContentieux.forEach(list => {
      for (const enquete of list || []) {
        for (const mec of enquete.misEnCause || []) {
          if (!mec?.nom) continue;
          entries.push({
            nom: mec.nom,
            role: mec.isVictime ? 'victime' : 'mec',
            dossier: enquete.numero,
            carto: true,
          });
        }
      }
    });

    for (const dossier of instructions) {
      const ref = dossier.numeroInstruction || dossier.numeroParquet;
      for (const mex of dossier.misEnExamen || []) {
        if (mex?.nom) entries.push({ nom: mex.nom, role: 'mex', dossier: ref, carto: true });
      }
      for (const suspect of dossier.suspects || []) {
        if (suspect?.nom) entries.push({ nom: suspect.nom, role: 'suspect', dossier: ref, carto: true });
      }
      for (const victime of dossier.victimes || []) {
        // Une victime n'a de nœud sur la carte que si la case « sur la
        // cartographie » est cochée — mais elle reste une personne connue.
        if (victime?.nom) {
          entries.push({ nom: victime.nom, role: 'victime', dossier: ref, carto: !!victime.surCarto });
        }
      }
    }

    for (const mec of mecsExNihilo) {
      if (mec?.displayName) entries.push({ nom: mec.displayName, role: 'carto', carto: true });
    }

    if (extra) entries.push(...extra);

    return indexKnownPersons(buildKnownPersons(entries));
  }, [enquetesByContentieux, instructions, mecsExNihilo, extra]);
};
