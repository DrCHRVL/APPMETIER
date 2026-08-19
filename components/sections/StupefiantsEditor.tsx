'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, X } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import {
  StupefiantSaisi,
  ProduitStupefiantSaisi,
  UniteStupefiant,
  normaliserStupefiants,
} from '@/types/audienceTypes';
import {
  UNITES_STUPEFIANT,
  chercherProduitStupefiant,
  creerProduitStupefiant,
  libelleProduit,
  PREFIXE_PRODUIT_LIBRE,
} from '@/lib/stupefiants/catalogue.mjs';

interface CatalogueEntry {
  code: string;
  libelle: string;
  famille: string;
  unite: UniteStupefiant;
}

interface StupefiantsEditorProps {
  value?: StupefiantSaisi;
  /** Reçoit le bloc normalisé, ou undefined quand plus aucun produit n'est retenu. */
  onChange: (next: StupefiantSaisi | undefined) => void;
  /** Densité réduite (formulaire de saisie dans le détail d'enquête). */
  compact?: boolean;
}

/**
 * Sélection des produits stupéfiants saisis, sur le modèle du sélecteur NATINF :
 * on cherche un produit, on le valide, il s'ajoute à la liste — autant de fois
 * que nécessaire. Chaque produit porte SA quantité et SON unité, toutes deux
 * facultatives (une saisie peut parfaitement ne pas être pesée).
 *
 * Partagé par le formulaire de saisies (phase enquête) et le formulaire de
 * confiscations (résultat d'audience) : même donnée, même ergonomie.
 */
export const StupefiantsEditor = ({ value, onChange, compact = false }: StupefiantsEditorProps) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const produits: ProduitStupefiantSaisi[] = value?.produits || [];
  const codesRetenus = useMemo(() => produits.map((p) => p.code), [produits]);

  // Résultats regroupés par famille : le tri de pertinence est conservé à
  // l'intérieur d'une famille, mais les familles ne s'entrelacent pas (sinon
  // l'intitulé de section se répéterait au fil de la liste).
  const results: CatalogueEntry[] = useMemo(() => {
    const bruts = chercherProduitStupefiant(query, {
      exclure: codesRetenus,
      limit: 12,
    }) as CatalogueEntry[];
    const ordreFamilles: string[] = [];
    for (const r of bruts) if (!ordreFamilles.includes(r.famille)) ordreFamilles.push(r.famille);
    return bruts
      .map((r, i) => ({ r, i }))
      .sort((a, b) =>
        ordreFamilles.indexOf(a.r.famille) - ordreFamilles.indexOf(b.r.famille) || a.i - b.i
      )
      .map((x) => x.r);
  }, [query, codesRetenus]);

  // Produit hors référentiel : proposé seulement si la recherche ne colle à rien
  // d'exact, pour ne pas pousser à créer des doublons du catalogue.
  const trimmed = query.trim();
  const proposeLibre =
    trimmed.length >= 2 &&
    !results.some((r) => r.libelle.toLowerCase() === trimmed.toLowerCase());

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const emit = (nextProduits: ProduitStupefiantSaisi[]) => {
    onChange(normaliserStupefiants({ ...(value || { types: [] }), produits: nextProduits }));
  };

  const ajouter = (code: string, libelle?: string) => {
    if (produits.some((p) => p.code === code)) return;
    emit([...produits, creerProduitStupefiant(code, libelle) as ProduitStupefiantSaisi]);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const ajouterLibre = () => {
    if (!trimmed) return;
    ajouter(`${PREFIXE_PRODUIT_LIBRE}${trimmed}`, trimmed);
  };

  const modifier = (index: number, patch: Partial<ProduitStupefiantSaisi>) => {
    emit(produits.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const supprimer = (index: number) => {
    emit(produits.filter((_, i) => i !== index));
  };

  // Options de la liste : produits du référentiel, puis l'entrée « libre ».
  const options = proposeLibre ? [...results, null] : results;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < options.length) {
        const choix = options[activeIndex];
        if (choix) ajouter(choix.code);
        else ajouterLibre();
      } else if (results.length > 0) {
        ajouter(results[0].code);
      } else if (proposeLibre) {
        ajouterLibre();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const inputSize = compact ? 'h-8 text-sm' : 'h-9 text-sm';

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Ajouter un produit (cocaïne, résine, MDMA, plants…)"
          className={`pl-7 ${inputSize}`}
        />

        {open && options.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-72 w-full min-w-[20rem] overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
            {results.map((entry, i) => {
              const nouvelleFamille = i === 0 || results[i - 1].famille !== entry.famille;
              return (
                <React.Fragment key={entry.code}>
                  {nouvelleFamille && (
                    <li className="bg-gray-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {entry.famille}
                    </li>
                  )}
                  <li
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm ${
                      i === activeIndex ? 'bg-emerald-50' : 'hover:bg-gray-50'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      ajouter(entry.code);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 text-gray-800">{entry.libelle}</span>
                  </li>
                </React.Fragment>
              );
            })}

            {proposeLibre && (
              <li
                className={`flex cursor-pointer items-center gap-2 border-t px-2.5 py-1.5 text-sm ${
                  activeIndex === options.length - 1 ? 'bg-emerald-50' : 'hover:bg-gray-50'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  ajouterLibre();
                }}
                onMouseEnter={() => setActiveIndex(options.length - 1)}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                <span className="text-gray-700">
                  Ajouter « <span className="font-medium">{trimmed}</span> » (produit hors liste)
                </span>
              </li>
            )}
          </ul>
        )}
      </div>

      {produits.length === 0 ? (
        <p className="text-xs text-gray-400 italic">
          Aucun produit. La quantité reste facultative : un produit peut être retenu sans pesée.
        </p>
      ) : (
        <div className="space-y-1.5">
          {produits.map((p, i) => (
            <div
              key={`${p.code}-${i}`}
              className="grid grid-cols-12 items-center gap-1.5 rounded bg-gray-50 p-1.5"
            >
              <span className="col-span-12 truncate text-sm font-medium text-gray-800 sm:col-span-4">
                {libelleProduit(p)}
              </span>
              <Input
                type="number"
                min="0"
                step="any"
                className="col-span-4 h-8 text-sm sm:col-span-2"
                placeholder="Quantité"
                value={p.quantite ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  modifier(i, { quantite: v === '' ? undefined : parseFloat(v) });
                }}
              />
              <Select
                className="col-span-4 h-8 text-sm sm:col-span-2"
                value={p.unite || 'g'}
                onChange={(e) => modifier(i, { unite: e.target.value as UniteStupefiant })}
              >
                {UNITES_STUPEFIANT.map((u: { code: string; label: string }) => (
                  <option key={u.code} value={u.code}>
                    {u.label}
                  </option>
                ))}
              </Select>
              <Input
                className="col-span-3 h-8 text-sm sm:col-span-3"
                placeholder="Précision (facultatif)"
                value={p.precision || ''}
                onChange={(e) => modifier(i, { precision: e.target.value || undefined })}
              />
              <button
                type="button"
                className="col-span-1 flex h-8 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => supprimer(i)}
                title="Retirer ce produit"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {produits.length > 0 && (
        <div>
          <Label className="text-xs">Observations (facultatif)</Label>
          <Input
            className={inputSize}
            placeholder="Ex : conditionnement, lieu de découverte, destinataire…"
            value={value?.description || ''}
            onChange={(e) =>
              onChange(
                normaliserStupefiants({
                  ...(value || { types: [] }),
                  produits,
                  description: e.target.value || undefined,
                })
              )
            }
          />
        </div>
      )}

      {value?.quantite && (
        <p className="text-[11px] text-amber-700">
          Ancienne saisie globale conservée : « {value.quantite} ». Reportez-la sur les produits
          ci-dessus si vous le souhaitez.
        </p>
      )}
    </div>
  );
};
