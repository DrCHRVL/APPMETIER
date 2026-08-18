// hooks/useDocumentSearch.ts
//
// Recherche dans le CONTENU des documents des enquêtes affichées (la liste de
// la page courante) : les enquêtes dont un document DÉJÀ ANALYSÉ contient le
// terme sont ajoutées aux résultats. L'analyse d'un document (téléchargement +
// déchiffrement + conversion dans le navigateur) ne part jamais en silence :
// elle se lance depuis le bouton « Analyser » de la recherche globale, et son
// résultat est mémorisé (utils/documents/documentTextSearch) — chaque document
// n'est extrait qu'une seule fois.

import { useState, useEffect, useRef } from 'react';
import { Enquete } from '@/types/interfaces';
import { normalizeText } from '@/utils/globalSearch';
import {
  getCachedDocumentSearchText,
  isExtractableDocument,
} from '@/utils/documents/documentTextSearch';

/**
 * Recherche asynchrone dans le contenu des documents analysés.
 * - Résultat immédiat : set vide (les filtres métadonnées répondent déjà)
 * - Résultat complété progressivement en arrière-plan
 * - Cache persistant (IndexedDB) + session pour éviter de ré-extraire
 */
export function useDocumentSearch(
  enquetes: Enquete[],
  searchTerm: string
) {
  const [documentMatchIds, setDocumentMatchIds] = useState<Set<number>>(new Set());
  const [isSearchingDocs, setIsSearchingDocs] = useState(false);
  const searchIdRef = useRef(0);

  useEffect(() => {
    const term = normalizeText(searchTerm.trim());

    // Pas de recherche si terme trop court
    if (term.length < 3) {
      setDocumentMatchIds(new Set());
      setIsSearchingDocs(false);
      return;
    }

    // Debounce : on attend que l'utilisateur arrête de taper
    const debounceTimer = setTimeout(async () => {
      const currentId = ++searchIdRef.current;
      setIsSearchingDocs(true);

      const matchIds = new Set<number>();

      for (const enquete of enquetes) {
        if (currentId !== searchIdRef.current) break;

        const searchableDocs = enquete.documents?.filter(isExtractableDocument) ?? [];

        for (const doc of searchableDocs) {
          if (currentId !== searchIdRef.current) break;

          const text = await getCachedDocumentSearchText(enquete.numero, doc);

          if (text && text.norm.includes(term)) {
            matchIds.add(enquete.id);
            break; // On passe à l'enquête suivante
          }
        }

        // Yield entre enquêtes pour ne pas bloquer l'UI
        await new Promise(r => setTimeout(r, 0));
      }

      if (currentId === searchIdRef.current) {
        setDocumentMatchIds(matchIds);
        setIsSearchingDocs(false);
      }
    }, 500);

    return () => {
      clearTimeout(debounceTimer);
      // Invalide la recherche en cours si le terme change
      searchIdRef.current++;
      setIsSearchingDocs(false);
    };
  }, [enquetes, searchTerm]);

  return { documentMatchIds, isSearchingDocs };
}
