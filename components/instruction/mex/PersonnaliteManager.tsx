'use client';

import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button';
import type { ElementPersonnalite, CategoriePersonnalite } from '@/types/instructionTypes';

const CATEGORIES: { value: CategoriePersonnalite; label: string; color: string }[] = [
  { value: 'situation_familiale', label: 'Situation familiale', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  { value: 'situation_professionnelle', label: 'Profession', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'antecedents', label: 'Antécédents', color: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'addictions', label: 'Addictions', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { value: 'sante', label: 'Santé', color: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'logement', label: 'Logement', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'autre', label: 'Autre', color: 'bg-gray-50 text-gray-700 border-gray-200' },
];

const labelOf = (cat: CategoriePersonnalite) =>
  CATEGORIES.find(c => c.value === cat)?.label || cat;
const colorOf = (cat: CategoriePersonnalite) =>
  CATEGORIES.find(c => c.value === cat)?.color || 'bg-gray-50 text-gray-700 border-gray-200';

interface Props {
  value: ElementPersonnalite[];
  onChange: (next: ElementPersonnalite[]) => void;
  readOnly?: boolean;
}

export const PersonnaliteManager = ({ value, onChange, readOnly }: Props) => {
  const [showForm, setShowForm] = useState(false);
  const [draftCat, setDraftCat] = useState<CategoriePersonnalite>('situation_familiale');
  const [draftContent, setDraftContent] = useState('');

  const handleAdd = () => {
    if (!draftContent.trim()) return;
    onChange([
      ...value,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        categorie: draftCat,
        contenu: draftContent.trim(),
        date: new Date().toISOString().split('T')[0],
      },
    ]);
    setDraftContent('');
    setShowForm(false);
  };

  const handleRemove = (id: number) => onChange(value.filter(e => e.id !== id));

  return (
    <div className="space-y-2">
      {value.length === 0 && !showForm && (
        <div className="text-xs text-gray-400 italic">
          Aucun élément de personnalité enregistré.
        </div>
      )}

      {value.map(el => (
        <div key={el.id} className="flex items-start gap-2 text-sm">
          <span
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 mt-0.5 ${colorOf(el.categorie)}`}
          >
            {labelOf(el.categorie)}
          </span>
          <div className="flex-1 text-gray-700 whitespace-pre-wrap">{el.contenu}</div>
          {!readOnly && (
            <button
              onClick={() => handleRemove(el.id)}
              className="text-gray-400 hover:text-red-600 shrink-0"
              title="Supprimer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-gray-300 rounded p-2 space-y-1.5 bg-gray-50">
            <select
              value={draftCat}
              onChange={(e) => setDraftCat(e.target.value as CategoriePersonnalite)}
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={2}
              autoFocus
              placeholder="Élément de personnalité…"
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded resize-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setDraftContent(''); }} className="h-6 text-xs">
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!draftContent.trim()}
                className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                Ajouter
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-xs text-emerald-600 hover:bg-emerald-50 py-1.5 rounded border border-dashed border-emerald-300 inline-flex items-center justify-center gap-1"
          >
            <Plus className="h-3 w-3" />
            Ajouter un élément
          </button>
        )
      )}
    </div>
  );
};
