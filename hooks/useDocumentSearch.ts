// hooks/useDocumentSearch.ts
import { useState, useEffect, useRef } from 'react';
import { Enquete } from '@/types/interfaces';

// Types de documents dont on peut extraire le texte
const SEARCHABLE_TYPES = new Set<string>(['pdf', 'txt', 'html']);

// Cache global de session : clé = "enqueteNumero||cheminRelatif"
// null = déjà tenté mais échec ; string = texte extrait (lowercase)
const docTextCache = new Map<string, string | null>();

function cacheKey(enqueteNumero: string, cheminRelatif: string) {
  return `${enqueteNumero}||${cheminRelatif}`;
}

async function fetchDocumentText(
  enqueteNumero: string,
  cheminRelatif: string,
  type: string
): Promise<string | null> {
  const key = cacheKey(enqueteNumero, cheminRelatif);

  if (docTextCache.has(key)) {
    return docTextCache.get(key)!;
  }

  try {
    let text: string | null = null;
    const api = (window as any).electronAPI;

    if (!api) {
      docTextCache.set(key, null);
      return null;
    }

    if (type === 'pdf') {
      // API electron utilisée dans DocumentAnalyzer.ts
      text = await api.extractPdfText?.(cheminRelatif) ?? null;
    } else if (type === 'txt' || type === 'html') {
      // readFile(folder, filename) – le dossier = numéro d'enquête
      text = await api.readFile?.(enqueteNumero, cheminRelatif) ?? null;
    }

    const result = text ? text.toLowerCase() : null;
    docTextCache.set(key, result);
    return result;
  } catch {
    docTextCache.set(key, null);
    return null;
  }
}

/**
 * Recherche asynchrone dans le contenu des documents.
 * - Résultat immédiat : set vide (les filtres métadonnées répondent déjà)
 * - Résultat complété progressivement en arrière-plan
 * - Cache session pour éviter de ré-extraire les mêmes fichiers
 */
export function useDocumentSearch(
  enquetes: Enquete[],
  searchTerm: string
) {
  const [documentMatchIds, setDocumentMatchIds] = useState<Set<number>>(new Set());
  const [isSearchingDocs, setIsSearchingDocs] = useState(false);
  const searchIdRef = useRef(0);

  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();

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

        const searchableDocs = enquete.documents?.filter(d =>
          SEARCHABLE_TYPES.has(d.type)
        ) ?? [];

        for (const doc of searchableDocs) {
          if (currentId !== searchIdRef.current) break;

          const text = await fetchDocumentText(
            enquete.numero,
            doc.cheminRelatif,
            doc.type
          );

          if (text && text.includes(term)) {
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
