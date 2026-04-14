import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from './input';

// Distance de Levenshtein
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) dp[i] = [i];
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const al = a.toLowerCase(), bl = b.toLowerCase();
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(al, bl) / maxLen;
}

interface MecAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Liste des noms connus à proposer */
  suggestions: string[];
  /** Nombre de caractères minimum avant déclenchement (défaut: 4) */
  minTriggerLength?: number;
  /** Seuil de similarité fuzzy 0-1 (défaut: 0.75) */
  similarityThreshold?: number;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const MecAutocompleteInput = ({
  value,
  onChange,
  suggestions,
  minTriggerLength = 4,
  similarityThreshold = 0.75,
  placeholder,
  className,
  autoFocus,
  onKeyDown
}: MecAutocompleteInputProps) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    if (value.length < minTriggerLength || !suggestions.length) return [];
    const query = value.toLowerCase();

    // Phase 1 : pré-filtre rapide par includes() — O(n), pas de Levenshtein
    const exactMatches: string[] = [];
    const candidates: string[] = [];
    for (const s of suggestions) {
      const sl = s.toLowerCase();
      if (sl === query) continue; // Exclure ce qui est déjà saisi
      if (sl.includes(query) || query.includes(sl)) {
        exactMatches.push(s);
      } else {
        candidates.push(s);
      }
    }

    // Si on a assez de résultats exacts, pas besoin de fuzzy
    if (exactMatches.length >= 6) {
      return exactMatches.slice(0, 6);
    }

    // Phase 2 : fuzzy uniquement sur les candidats restants (limité à 50 pour la perf)
    const fuzzyResults = candidates
      .slice(0, 50)
      .map(s => ({ nom: s, score: similarity(s, value) }))
      .filter(({ score }) => score >= similarityThreshold)
      .sort((a, b) => b.score - a.score);

    // Fusionner : exacts d'abord, puis fuzzy
    const combined = [...exactMatches, ...fuzzyResults.map(x => x.nom)];
    return combined.slice(0, 6);
  }, [value, suggestions, minTriggerLength, similarityThreshold]);

  // Ouvrir/fermer le menu selon les résultats
  useEffect(() => {
    setOpen(matches.length > 0);
    setActiveIndex(-1);
  }, [matches]);

  // Fermer au clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, matches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        onChange(matches[activeIndex]);
        setOpen(false);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        onKeyDown?.(e);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
      />
      {open && (
        <ul className="absolute z-50 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
          {matches.map((nom, i) => (
            <li
              key={nom}
              className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${i === activeIndex ? 'bg-blue-100 font-medium' : ''}`}
              onMouseDown={e => {
                e.preventDefault(); // Évite le blur de l'input
                onChange(nom);
                setOpen(false);
              }}
            >
              {nom}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
