'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Filter, Search, X, BarChart3 } from 'lucide-react';
import { Button } from '../ui/button';
import { InstructionPreview } from '../instruction/InstructionPreview';
import { InstructionsTimeline } from '../instruction/InstructionsTimeline';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { useToast } from '@/contexts/ToastContext';
import {
  ETAT_REGLEMENT_LABELS,
  FALLBACK_CABINET_COLOR,
} from '@/config/instructionConfig';
import type {
  DossierInstruction,
  EtatReglement,
} from '@/types/instructionTypes';

type SortKey = 'date-desc' | 'date-asc' | 'numero-asc' | 'cabinet';

interface InstructionsPageProps {
  dossiers: DossierInstruction[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onOpenDossier: (dossier: DossierInstruction) => void;
  onCreateDossier: () => void;
  onUpdateDossier: (id: number, updates: Partial<DossierInstruction>) => void;
  onDeleteDossier: (id: number) => void;
}

export const InstructionsPage = ({
  dossiers,
  searchTerm,
  onSearchChange,
  onOpenDossier,
  onCreateDossier,
  onUpdateDossier,
  onDeleteDossier,
}: InstructionsPageProps) => {
  const { showToast } = useToast();
  const { cabinets, getCabinetById } = useInstructionCabinets();

  const [showFilters, setShowFilters] = useState(false);
  const [filterCabinet, setFilterCabinet] = useState<string>('');
  const [filterEtat, setFilterEtat] = useState<EtatReglement | ''>('');
  const [sortOrder, setSortOrder] = useState<SortKey>('date-desc');
  // Affichage groupé par cabinet (par défaut) ou liste à plat
  const [groupByCabinet, setGroupByCabinet] = useState(true);

  const filtered = useMemo(() => {
    let list = dossiers;
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter(d =>
        d.numeroInstruction.toLowerCase().includes(term)
        || d.numeroParquet.toLowerCase().includes(term)
        || d.description?.toLowerCase().includes(term)
        || d.magistratInstructeur?.toLowerCase().includes(term)
        || d.misEnExamen.some(m => m.nom.toLowerCase().includes(term)),
      );
    }
    if (filterCabinet) list = list.filter(d => d.cabinetId === filterCabinet);
    if (filterEtat) list = list.filter(d => d.etatReglement === filterEtat);

    return [...list].sort((a, b) => {
      switch (sortOrder) {
        case 'date-desc':
          return new Date(b.dateOuverture).getTime() - new Date(a.dateOuverture).getTime();
        case 'date-asc':
          return new Date(a.dateOuverture).getTime() - new Date(b.dateOuverture).getTime();
        case 'numero-asc':
          return a.numeroInstruction.localeCompare(b.numeroInstruction);
        case 'cabinet': {
          const ca = getCabinetById(a.cabinetId)?.order ?? 999;
          const cb = getCabinetById(b.cabinetId)?.order ?? 999;
          return ca - cb;
        }
        default:
          return 0;
      }
    });
  }, [dossiers, searchTerm, filterCabinet, filterEtat, sortOrder, getCabinetById]);

  // Stats par cabinet (sur tous les dossiers, pas seulement filtrés)
  const statsByCabinet = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dossiers) map.set(d.cabinetId, (map.get(d.cabinetId) || 0) + 1);
    return map;
  }, [dossiers]);

  const totalDP = useMemo(
    () =>
      dossiers.reduce(
        (sum, d) => sum + d.misEnExamen.filter(m => m.mesureSurete.type === 'detenu').length,
        0,
      ),
    [dossiers],
  );

  // Regroupement par cabinet
  const groupedByCabinet = useMemo(() => {
    if (!groupByCabinet) return null;
    const groups: { cabinetId: string; dossiers: DossierInstruction[] }[] = [];
    // Cabinets activés d'abord (dans l'ordre)
    for (const cab of cabinets) {
      const ds = filtered.filter(d => d.cabinetId === cab.id);
      if (ds.length > 0) groups.push({ cabinetId: cab.id, dossiers: ds });
    }
    // Cabinets orphelins / désactivés (dossiers attachés à un cabinet inconnu)
    const knownIds = new Set(cabinets.map(c => c.id));
    const orphanIds = new Set<string>(
      filtered.filter(d => !knownIds.has(d.cabinetId)).map(d => d.cabinetId),
    );
    for (const id of orphanIds) {
      groups.push({ cabinetId: id, dossiers: filtered.filter(d => d.cabinetId === id) });
    }
    return groups;
  }, [groupByCabinet, filtered, cabinets]);

  const handleDelete = (d: DossierInstruction) => {
    if (confirm(`Supprimer le dossier "${d.numeroInstruction}" ?`)) {
      onDeleteDossier(d.id);
      showToast('Dossier supprimé', 'success');
    }
  };

  const handleToggleSuivi = (d: DossierInstruction, type: 'JIRS' | 'PG') => {
    const key = type === 'JIRS' ? 'suiviJIRS' : 'suiviPG';
    onUpdateDossier(d.id, { [key]: !d[key] } as Partial<DossierInstruction>);
    showToast(`Suivi ${type} ${d[key] ? 'retiré' : 'ajouté'}`, 'success');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Instructions judiciaires</h1>
            <p className="text-sm text-gray-600">
              {dossiers.length} dossier{dossiers.length > 1 ? 's' : ''}
              {totalDP > 0 && (
                <span className="ml-2 text-red-600 font-medium">
                  · {totalDP} en DP
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2"
            >
              <Filter className="h-4 w-4" />
              Filtres
            </Button>
            <Button
              onClick={onCreateDossier}
              className="bg-[#2B5746] hover:bg-[#1f3d2f] flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Nouveau dossier
            </Button>
          </div>
        </div>

        {/* Stats par cabinet */}
        {cabinets.length > 0 && (
          <div className="grid gap-2 mb-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(cabinets.length, 6)}, minmax(0, 1fr))` }}>
            {cabinets.map(cab => {
              const count = statsByCabinet.get(cab.id) || 0;
              const isFiltered = filterCabinet === cab.id;
              return (
                <button
                  key={cab.id}
                  onClick={() => setFilterCabinet(isFiltered ? '' : cab.id)}
                  className={`p-2.5 rounded-lg border-2 text-left transition-all hover:shadow-sm ${
                    isFiltered ? 'shadow-md ring-2' : ''
                  }`}
                  style={{
                    backgroundColor: cab.color + '15',
                    borderColor: cab.color,
                    boxShadow: isFiltered ? `0 0 0 3px ${cab.color}40` : undefined,
                  }}
                  title={isFiltered ? 'Cliquer pour retirer le filtre' : `Filtrer sur ${cab.label}`}
                >
                  <div className="text-base font-bold" style={{ color: cab.color }}>{count}</div>
                  <div className="text-xs font-medium" style={{ color: cab.color }}>{cab.label}</div>
                  {cab.magistratParDefaut && (
                    <div className="text-[10px] text-gray-500 truncate">{cab.magistratParDefaut}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Filtres */}
        {showFilters && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 mb-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              {/* Recherche */}
              <div className="relative md:col-span-2">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Rechercher (n°, MEX, magistrat…)"
                  className="w-full pl-8 pr-8 py-2 text-sm border border-gray-300 rounded-lg"
                />
                {searchTerm && (
                  <button
                    onClick={() => onSearchChange('')}
                    className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {/* État */}
              <select
                value={filterEtat}
                onChange={(e) => setFilterEtat(e.target.value as EtatReglement | '')}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
              >
                <option value="">Tous les états</option>
                {(Object.keys(ETAT_REGLEMENT_LABELS) as EtatReglement[]).map(k => (
                  <option key={k} value={k}>{ETAT_REGLEMENT_LABELS[k]}</option>
                ))}
              </select>
              {/* Tri */}
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortKey)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
              >
                <option value="date-desc">Plus récents</option>
                <option value="date-asc">Plus anciens</option>
                <option value="numero-asc">Numéro instruction</option>
                <option value="cabinet">Par cabinet</option>
              </select>
            </div>
            <div className="flex justify-between items-center text-xs text-gray-600">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={groupByCabinet}
                  onChange={(e) => setGroupByCabinet(e.target.checked)}
                />
                Grouper par cabinet
              </label>
              {(filterCabinet || filterEtat || searchTerm) && (
                <button
                  onClick={() => {
                    setFilterCabinet('');
                    setFilterEtat('');
                    onSearchChange('');
                  }}
                  className="text-blue-600 hover:underline"
                >
                  Réinitialiser les filtres
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Corps */}
      <div className="flex-1 overflow-auto p-6">
        {/* Timeline globale */}
        {dossiers.length > 0 && (
          <InstructionsTimeline
            dossiers={dossiers}
            onDossierClick={(id) => {
              const d = dossiers.find(x => x.id === id);
              if (d) onOpenDossier(d);
            }}
          />
        )}

        {/* Liste */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <BarChart3 className="h-16 w-16 mb-4 text-gray-300" />
            <h3 className="text-lg font-medium mb-2">
              {dossiers.length === 0 ? 'Aucun dossier d\'instruction' : 'Aucun résultat'}
            </h3>
            <p className="text-sm text-center max-w-md">
              {dossiers.length === 0
                ? 'Commencez par créer votre premier dossier d\'instruction.'
                : 'Aucun dossier ne correspond à vos critères.'}
            </p>
            {dossiers.length === 0 && (
              <Button
                onClick={onCreateDossier}
                className="mt-4 bg-[#2B5746] hover:bg-[#1f3d2f]"
              >
                <Plus className="h-4 w-4 mr-2" />
                Créer un dossier
              </Button>
            )}
          </div>
        ) : groupedByCabinet ? (
          <div className="space-y-6">
            {groupedByCabinet.map(group => {
              const cab = getCabinetById(group.cabinetId);
              const color = cab?.color || FALLBACK_CABINET_COLOR;
              return (
                <div key={group.cabinetId}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                    <h2 className="text-sm font-semibold text-gray-700">
                      {cab?.label || `Cabinet inconnu (${group.cabinetId})`}
                    </h2>
                    <span className="text-xs text-gray-400">
                      {group.dossiers.length} dossier{group.dossiers.length > 1 ? 's' : ''}
                    </span>
                    {!cab && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        à réaffecter
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                    {group.dossiers.map(d => (
                      <InstructionPreview
                        key={d.id}
                        dossier={d}
                        onView={() => onOpenDossier(d)}
                        onDelete={() => handleDelete(d)}
                        onToggleSuivi={(t) => handleToggleSuivi(d, t)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {filtered.map(d => (
              <InstructionPreview
                key={d.id}
                dossier={d}
                onView={() => onOpenDossier(d)}
                onDelete={() => handleDelete(d)}
                onToggleSuivi={(t) => handleToggleSuivi(d, t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
