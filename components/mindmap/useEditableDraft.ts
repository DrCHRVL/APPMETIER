// components/mindmap/useEditableDraft.ts
//
// Brouillon de saisie résistant aux rafraîchissements de la carte.
//
// Le graphe de cartographie est reconstruit à chaque sync (dossiers de
// l'équipe, contributions distantes, overlays — au moins une fois par
// minute) : les nœuds sont alors de NOUVEAUX objets, et leurs champs tableau
// de nouvelles références. Un `useEffect` qui réaligne un champ de saisie sur
// la valeur du nœud dès que celle-ci « change » efface donc la saisie en
// cours — l'utilisateur voit disparaître ce qu'il est en train d'écrire.
//
// Ce hook ne réaligne le brouillon sur la valeur enregistrée que :
//   — au changement d'entité (on passe à une autre personne) ;
//   — quand la valeur ENREGISTRÉE change réellement (son CONTENU, pas sa
//     référence) ET que l'utilisateur n'a rien tapé depuis. Sinon on
//     écraserait sa saisie : la modification d'un collègue arrivée par la
//     sync ne doit pas lui voler son texte.

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const defaultSerialize = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * @param entityId  identité de l'objet édité (changer = repartir de sa valeur)
 * @param committed valeur actuellement enregistrée
 * @returns [brouillon, setter, dirty] — `dirty` = brouillon ≠ valeur enregistrée
 */
export function useEditableDraft<T>(
  entityId: string,
  committed: T,
  serialize: (value: T) => string = defaultSerialize,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [draft, setDraft] = useState<T>(committed);
  const entityRef = useRef(entityId);
  // Valeur enregistrée au dernier alignement : sert à détecter à la fois un
  // vrai changement côté données et une saisie en cours côté utilisateur.
  const baselineRef = useRef(serialize(committed));
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Volontairement sans tableau de dépendances : les comparaisons portent sur
  // le CONTENU sérialisé, jamais sur l'identité des objets (qui change à
  // chaque reconstruction du graphe). Pas de boucle possible : la référence
  // `baselineRef` est mise à jour avant l'éventuel `setDraft`, le passage
  // suivant sort donc immédiatement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const nextBaseline = serialize(committed);
    if (entityRef.current !== entityId) {
      entityRef.current = entityId;
      baselineRef.current = nextBaseline;
      setDraft(committed);
      return;
    }
    if (nextBaseline === baselineRef.current) return;
    const untouched = serialize(draftRef.current) === baselineRef.current;
    baselineRef.current = nextBaseline;
    if (untouched) setDraft(committed);
  });

  return [draft, setDraft, serialize(draft) !== serialize(committed)];
}

/**
 * Initialise le formulaire d'une modale À SON OUVERTURE seulement (et si
 * l'entité éditée change sans fermeture), jamais parce qu'une prop a une
 * nouvelle référence.
 *
 * Même cause que ci-dessus : la page cartographie se re-rend en continu
 * (indicateur « modifications en attente », syncs, reconstruction du graphe).
 * Une modale qui se ré-initialisait sur l'identité de ses props (`initial`,
 * `cluster` — souvent des objets littéraux recréés à chaque rendu du parent)
 * vidait ses champs pendant la frappe.
 *
 * @param entityKey identifiant de l'entité éditée (undefined = création)
 * @param init      pose les valeurs initiales des champs
 */
export function useModalFormInit(
  isOpen: boolean,
  entityKey: string | undefined,
  init: () => void,
): void {
  const initRef = useRef(init);
  initRef.current = init;
  const openedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      openedForRef.current = null;
      return;
    }
    const key = entityKey ?? '__nouveau__';
    if (openedForRef.current === key) return;
    openedForRef.current = key;
    initRef.current();
  }, [isOpen, entityKey]);
}
