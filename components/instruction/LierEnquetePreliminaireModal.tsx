'use client';

// components/instruction/LierEnquetePreliminaireModal.tsx
// Picker de rattachement d'un dossier d'instruction à son enquête préliminaire
// d'origine. La liste est volontairement restreinte aux enquêtes dont le
// résultat d'audience est une OI (ouverture d'information) : c'est le seul cas
// où un dossier d'instruction est le prolongement direct d'une préliminaire, et
// donc où le doublon de cartographie doit être levé.

import React, { useMemo, useState } from 'react';
import { Link2, Search, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

/** Enquête préliminaire éligible au rattachement (résultat = OI). */
export interface EnquetePreliminaireOption {
  id: number;
  numero: string;
  contentieuxId: string;
  contentieuxLabel: string;
  /** Date d'archivage (ISO) si connue — sert au tri et à l'affichage. */
  dateArchivage?: string;
}

interface LierEnquetePreliminaireModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Enquêtes éligibles (uniquement celles dont le résultat est OI). */
  options: EnquetePreliminaireOption[];
  /** Id de l'enquête actuellement liée (pour la mettre en évidence). */
  currentLinkId?: number;
  currentLinkContentieuxId?: string;
  /** Sélection d'une enquête à lier. */
  onSelect: (option: EnquetePreliminaireOption) => void;
}

const formatDate = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR');
};

export const LierEnquetePreliminaireModal = ({
  isOpen,
  onClose,
  options,
  currentLinkId,
  currentLinkContentieuxId,
  onSelect,
}: LierEnquetePreliminaireModalProps) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...options].sort((a, b) =>
      (b.dateArchivage || '').localeCompare(a.dateArchivage || '') ||
      a.numero.localeCompare(b.numero, 'fr', { sensitivity: 'base' }),
    );
    if (!q) return sorted;
    return sorted.filter(
      o =>
        o.numero.toLowerCase().includes(q) ||
        o.contentieuxLabel.toLowerCase().includes(q),
    );
  }, [options, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-[560px] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[#2B5746]" />
            <h2 className="text-base font-semibold text-gray-800">
              Lier l'enquête préliminaire d'origine
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-[12px] text-gray-500 mb-2">
            Seules les enquêtes dont le résultat est une{' '}
            <span className="font-semibold text-gray-700">OI (ouverture d'information)</span>{' '}
            sont proposées. Le rattachement supprime le doublon sur la cartographie
            sans toucher aux notes, CR et actes de la préliminaire.
          </p>
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un numéro d'enquête…"
              className="pl-8"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8 px-4">
              {options.length === 0
                ? 'Aucune enquête préliminaire avec résultat OI disponible. Le résultat « ouverture d\'information » doit être saisi sur l\'enquête (au moment de l\'archivage) pour qu\'elle apparaisse ici.'
                : 'Aucune enquête ne correspond à la recherche.'}
            </div>
          ) : (
            filtered.map((o) => {
              const isCurrent =
                o.id === currentLinkId && o.contentieuxId === currentLinkContentieuxId;
              return (
                <button
                  key={`${o.contentieuxId}__${o.id}`}
                  onClick={() => onSelect(o)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border mb-1.5 transition-colors flex items-center justify-between gap-3 ${
                    isCurrent
                      ? 'border-[#2B5746] bg-[#2B5746]/5'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {o.numero}
                    </div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-2">
                      <span>{o.contentieuxLabel}</span>
                      {o.dateArchivage && (
                        <span>· archivée le {formatDate(o.dateArchivage)}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] uppercase font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0">
                    OI
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  );
};
