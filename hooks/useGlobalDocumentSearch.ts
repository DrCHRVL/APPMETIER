// hooks/useGlobalDocumentSearch.ts
//
// Volet ASYNCHRONE de la recherche globale : le contenu des documents (PDF,
// DOCX, ODT, tableurs, TXT…) de toutes les enquêtes accessibles, tous
// contentieux confondus.
//
// Deux régimes, pour ne JAMAIS mobiliser le réseau en silence :
//  - automatique : seuls les documents DÉJÀ analysés (cache persistant) sont
//    interrogés — coût nul, résultats immédiats ;
//  - à la demande : un bouton « Analyser N documents » lance l'extraction des
//    documents jamais lus (téléchargement + déchiffrement + conversion dans le
//    navigateur), avec avancement visible. Chaque document analysé nourrit le
//    cache : les recherches suivantes le couvrent automatiquement.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Enquete } from '@/types/interfaces';
import { parseQuery } from '@/utils/globalSearch';
import {
  getDocumentSearchText,
  getCachedDocumentSearchText,
  isExtractableDocument,
} from '@/utils/documents/documentTextSearch';

export interface DocumentContentHit {
  key: string;
  ctxId: string;
  enqueteId: number;
  numero: string;
  archived: boolean;
  /** Nom du document où le terme apparaît. */
  docNom: string;
  cheminRelatif: string;
  /** Passage du document autour de la première correspondance. */
  excerpt: string;
}

export interface DocumentScanState {
  /** Analyse en cours (extraction de documents jamais lus). */
  scanning: boolean;
  done: number;
  total: number;
  /** Documents jamais analysés restants — propose le bouton « Analyser ». */
  pending: number;
}

const MIN_QUERY = 3;
const DEBOUNCE_MS = 450;
const MAX_HITS = 30;

// Opérateurs dont la valeur vise le contenu documentaire. Les termes SANS
// opérateur participent aussi. Si la requête ne contient QUE des opérateurs
// structurés (mec:, service:…), le scan documentaire n'a pas lieu — ces
// opérateurs ciblent les fiches, pas les documents.
const CONTENT_OPS = new Set(['contenu', 'doc', 'document', 'fichier', 'cr']);

/** Extrait lisible autour de la première occurrence (index alignés raw/norm). */
function excerptAround(raw: string, start: number, end: number, radius = 46): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(raw.length, end + radius);
  let s = raw.slice(from, to).replace(/\s+/g, ' ').trim();
  if (from > 0) s = '…' + s;
  if (to < raw.length) s = s + '…';
  return s;
}

export function useGlobalDocumentSearch(
  enabled: boolean,
  query: string,
  sources: Map<string, Enquete[]> | undefined
): { docHits: DocumentContentHit[]; docScan: DocumentScanState; startFullScan: () => void } {
  const [docHits, setDocHits] = useState<DocumentContentHit[]>([]);
  const [docScan, setDocScan] = useState<DocumentScanState>({ scanning: false, done: 0, total: 0, pending: 0 });
  const [fullScan, setFullScan] = useState(false);
  const scanIdRef = useRef(0);

  // L'analyse complète est un choix par requête : nouveau terme → on repart
  // du régime « cache seulement » (le cache, lui, est déjà plus riche).
  useEffect(() => {
    setFullScan(false);
  }, [query, enabled]);

  const startFullScan = useCallback(() => setFullScan(true), []);

  useEffect(() => {
    // Termes retenus pour le contenu : sans opérateur, ou opérateur « contenu ».
    const tokens = parseQuery(query).filter(t => !t.op || CONTENT_OPS.has(t.op));
    const terms = tokens.map(t => t.t).filter(t => t.length >= 2);
    const longEnough = terms.join('').length >= MIN_QUERY;

    if (!enabled || !sources || terms.length === 0 || !longEnough) {
      scanIdRef.current++;
      setDocHits([]);
      setDocScan({ scanning: false, done: 0, total: 0, pending: 0 });
      return;
    }

    const timer = setTimeout(async () => {
      const scanId = ++scanIdRef.current;

      // File de travail : enquêtes en cours d'abord (résultats les plus utiles
      // au plus tôt), archivées ensuite.
      const jobs: Array<{ ctxId: string; enquete: Enquete }> = [];
      const later: typeof jobs = [];
      sources.forEach((list, ctxId) => {
        for (const e of list) {
          if (!e.documents?.some(isExtractableDocument)) continue;
          (e.statut === 'en_cours' ? jobs : later).push({ ctxId, enquete: e });
        }
      });
      jobs.push(...later);

      const total = jobs.reduce(
        (n, j) => n + (j.enquete.documents?.filter(isExtractableDocument).length || 0),
        0
      );
      const hits: DocumentContentHit[] = [];
      let done = 0;
      let pending = 0;
      setDocHits([]);
      setDocScan({ scanning: total > 0 && fullScan, done: 0, total, pending: 0 });
      if (total === 0) return;

      for (const { ctxId, enquete } of jobs) {
        if (scanId !== scanIdRef.current || hits.length >= MAX_HITS) break;

        for (const doc of enquete.documents!.filter(isExtractableDocument)) {
          if (scanId !== scanIdRef.current || hits.length >= MAX_HITS) break;

          // Régime automatique : cache uniquement (coût nul). Régime complet :
          // extraction des documents jamais lus, un par un.
          const text = fullScan
            ? await getDocumentSearchText(enquete.numero, doc)
            : await getCachedDocumentSearchText(enquete.numero, doc);
          done++;
          if (text === undefined) { pending++; continue; }

          if (text) {
            // Sémantique ET : tous les termes doivent être dans le document.
            let firstStart = -1;
            let firstEnd = -1;
            let all = true;
            for (const term of terms) {
              const idx = text.norm.indexOf(term);
              if (idx < 0) { all = false; break; }
              if (firstStart < 0 || idx < firstStart) { firstStart = idx; firstEnd = idx + term.length; }
            }
            if (all && firstStart >= 0) {
              hits.push({
                key: `doc_${ctxId}_${enquete.id}_${doc.cheminRelatif}`,
                ctxId,
                enqueteId: enquete.id,
                numero: enquete.numero,
                archived: enquete.statut !== 'en_cours',
                docNom: doc.nomOriginal || doc.nom || doc.cheminRelatif.split('/').pop() || 'document',
                cheminRelatif: doc.cheminRelatif,
                excerpt: excerptAround(text.raw, firstStart, firstEnd),
              });
              setDocHits([...hits]);
            }
          }

          // Avancement affiché par petits paliers (pas un setState par document).
          if (fullScan && (done % 5 === 0 || done === total)) {
            setDocScan({ scanning: done < total, done, total, pending });
          }
        }
        // Respiration entre deux enquêtes : la frappe reste fluide.
        if (fullScan) await new Promise(r => setTimeout(r, 0));
      }

      if (scanId === scanIdRef.current) {
        setDocScan({ scanning: false, done, total, pending });
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      scanIdRef.current++;
    };
  }, [enabled, query, sources, fullScan]);

  return { docHits, docScan, startFullScan };
}
