'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Star } from 'lucide-react';
import { Input } from '../ui/input';
import { useNatinf } from '@/hooks/useNatinf';
import type { NatinfEntry } from '@/types/natinf';
import { NatinfBadge } from './NatinfBadge';

interface NatinfPickerProps {
  /** Appelé à la sélection d'un code NATINF */
  onSelect: (entry: NatinfEntry) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Restreindre à un thème donné */
  theme?: string;
  /** Restreindre aux infractions fréquentes (mémento) */
  frequentOnly?: boolean;
  className?: string;
}

/**
 * Recherche rapide dans le référentiel NATINF : taper un n° NATINF ou un libellé.
 * Navigation clavier (↑/↓/Entrée/Échap). Sélection -> onSelect(entry).
 */
export const NatinfPicker = ({
  onSelect,
  placeholder = 'N° NATINF ou libellé (ex. « 1115 » ou « viol »)…',
  autoFocus,
  theme,
  frequentOnly,
  className,
}: NatinfPickerProps) => {
  const { search, isLoading, error } = useNatinf();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const numeric = /^\d+$/.test(query.trim());
  const minLen = numeric ? 1 : 2;

  const results = useMemo(() => {
    if (query.trim().length < minLen) return [];
    return search(query, { theme, frequentOnly, limit: 30 });
  }, [query, minLen, search, theme, frequentOnly]);

  useEffect(() => {
    setOpen(results.length > 0);
    setActiveIndex(-1);
  }, [results]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const choose = (entry: NatinfEntry) => {
    onSelect(entry);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      choose(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className={`h-8 pl-7 text-sm ${error ? 'border-red-300' : ''}`}
          autoFocus={autoFocus}
        />
        {isLoading && (
          <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-gray-400" />
        )}
      </div>

      {error && (
        <div className="mt-1 text-[11px] text-red-600">Référentiel NATINF indisponible.</div>
      )}

      {open && (
        <ul className="absolute z-50 mt-1 max-h-72 w-full min-w-[22rem] overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
          {results.map((entry, i) => (
            <li
              key={entry.code}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm ${i === activeIndex ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(entry);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="w-12 shrink-0 font-mono text-xs text-gray-500">{entry.code}</span>
              <span className="min-w-0 flex-1 truncate text-gray-800" title={entry.libelle}>
                {entry.libelle}
              </span>
              {entry.frequent && (
                <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Infraction fréquente" />
              )}
              <NatinfBadge nature={entry.nature} quantumLabel={entry.quantumLabel} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
