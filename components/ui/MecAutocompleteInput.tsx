import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input } from './input';
import { normalizeMecName, sameMecPerson } from '@/utils/mindmapGraph';

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
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Chaque mot tapé préfixe-t-il un mot distinct du candidat ? Insensible à
 *  l'ordre : « jean dup » propose « DUPONT Jean ». */
function tokensPrefixMatch(queryTokens: string[], candidateTokens: string[]): boolean {
  const used = new Array<boolean>(candidateTokens.length).fill(false);
  return queryTokens.every(qt => {
    const idx = candidateTokens.findIndex((ct, i) => !used[i] && ct.startsWith(qt));
    if (idx === -1) return false;
    used[idx] = true;
    return true;
  });
}

interface MecAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Liste des noms connus à proposer */
  suggestions: string[];
  /** Précision affichée sous chaque nom proposé (« mis en examen · 2 dossiers ») */
  hints?: Record<string, string>;
  /** Nombre de caractères minimum avant déclenchement (défaut: 2) */
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
  hints,
  minTriggerLength = 2,
  similarityThreshold = 0.75,
  placeholder,
  className,
  autoFocus,
  onKeyDown
}: MecAutocompleteInputProps) => {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Index prénormalisé (sans accents, minuscules, mots isolés) : recalculé
  // seulement quand la liste change, pas à chaque frappe.
  const index = useMemo(
    () => suggestions.map(nom => {
      const norm = normalizeMecName(nom);
      return { nom, norm, tokens: norm.split(' ').filter(Boolean) };
    }),
    [suggestions],
  );

  // Mot → noms le contenant : borne la recherche de doublon aux seuls
  // candidats plausibles (deux orthographes d'une personne partagent toujours
  // au moins un mot), au lieu de balayer tout le fichier à chaque frappe.
  const byToken = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of index) {
      for (const token of entry.tokens) {
        if (token.length < 3) continue;
        const arr = map.get(token);
        if (arr) arr.push(entry.nom);
        else map.set(token, [entry.nom]);
      }
    }
    return map;
  }, [index]);

  const query = useMemo(() => normalizeMecName(value), [value]);

  const matches = useMemo(() => {
    if (value.trim().length < minTriggerLength || index.length === 0 || !query) return [];
    const queryTokens = query.split(' ').filter(Boolean);

    // Phase 1 : correspondances franches (sous-chaîne ou mots préfixés), sans
    // aucun calcul de distance — O(n) sur des chaînes déjà normalisées.
    const strong: string[] = [];
    const candidates: Array<{ nom: string; norm: string }> = [];
    for (const entry of index) {
      if (entry.norm === query) continue; // déjà saisi à l'identique
      if (
        entry.norm.includes(query) ||
        query.includes(entry.norm) ||
        tokensPrefixMatch(queryTokens, entry.tokens)
      ) {
        strong.push(entry.nom);
      } else {
        candidates.push(entry);
      }
    }

    if (strong.length >= 6) return strong.slice(0, 6);

    // Phase 2 : fuzzy sur le reste (borné, la frappe doit rester instantanée).
    const fuzzy = candidates
      .slice(0, 200)
      .map(entry => ({ nom: entry.nom, score: similarity(entry.norm, query) }))
      .filter(({ score }) => score >= similarityThreshold)
      .sort((a, b) => b.score - a.score);

    return [...strong, ...fuzzy.map(x => x.nom)].slice(0, 6);
  }, [value, query, index, minTriggerLength, similarityThreshold]);

  // Alerte doublon : la saisie désigne une personne DÉJÀ au fichier sous une
  // autre orthographe (ordre Nom/Prénom inversé, coquille, composé recollé).
  // C'est le cas que les propositions seules laisseraient passer, puisque le
  // nom tapé « a l'air » nouveau.
  const nearDuplicate = useMemo(() => {
    if (value.trim().length < 4 || !query) return null;
    const exact = index.find(e => e.norm === query);
    if (exact) return { nom: exact.nom, sameSpelling: true };
    const seen = new Set<string>();
    for (const token of query.split(' ')) {
      if (token.length < 3) continue;
      for (const nom of byToken.get(token) || []) {
        if (seen.has(nom)) continue;
        seen.add(nom);
        if (sameMecPerson(nom, value)) return { nom, sameSpelling: false };
      }
    }
    return null;
  }, [value, query, index, byToken]);

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
              <div className="truncate">{nom}</div>
              {hints?.[nom] && (
                <div className="text-[11px] text-gray-500 truncate">{hints[nom]}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {nearDuplicate && !nearDuplicate.sameSpelling && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(nearDuplicate.nom); setOpen(false); }}
          className="mt-1 flex w-full items-start gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-left text-[11px] text-amber-800 hover:bg-amber-100"
          title="Reprendre l'orthographe déjà enregistrée"
        >
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            Déjà au fichier sous « <b>{nearDuplicate.nom}</b> »
            {hints?.[nearDuplicate.nom] ? ` (${hints[nearDuplicate.nom]})` : ''} — cliquez pour
            reprendre cette orthographe et éviter un doublon.
          </span>
        </button>
      )}
      {nearDuplicate?.sameSpelling && hints?.[nearDuplicate.nom] && (
        <div className="mt-1 text-[11px] text-gray-500 truncate">
          Déjà au fichier : {hints[nearDuplicate.nom]}
        </div>
      )}
    </div>
  );
};
