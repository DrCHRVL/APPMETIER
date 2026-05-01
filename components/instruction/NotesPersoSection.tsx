'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X, Tag as TagIcon, Calendar as CalendarIcon, User as UserIcon, Edit, Save } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useUser } from '@/contexts/UserContext';
import type { NotePersoInstruction } from '@/types/instructionTypes';

interface Props {
  notes: NotePersoInstruction[];
  onChange: (next: NotePersoInstruction[]) => void;
  readOnly?: boolean;
}

export const NotesPersoSection = ({ notes, onChange, readOnly }: Props) => {
  const { user } = useUser();
  const [showForm, setShowForm] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');

  const sorted = useMemo(
    () => [...notes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [notes],
  );

  const handleAdd = () => {
    if (!draftContent.trim()) return;
    const tags = draftTags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    onChange([
      ...notes,
      {
        id: Date.now() + Math.floor(Math.random() * 1000),
        date: new Date().toISOString(),
        contenu: draftContent.trim(),
        tags: tags.length > 0 ? tags : undefined,
        auteur: user?.windowsUsername,
      },
    ]);
    setDraftContent('');
    setDraftTags('');
    setShowForm(false);
  };

  const handleStartEdit = (n: NotePersoInstruction) => {
    setEditingId(n.id);
    setEditContent(n.contenu);
    setEditTags((n.tags || []).join(', '));
  };

  const handleSaveEdit = () => {
    if (editingId === null) return;
    const tags = editTags
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    onChange(
      notes.map(n =>
        n.id === editingId
          ? { ...n, contenu: editContent.trim(), tags: tags.length > 0 ? tags : undefined }
          : n,
      ),
    );
    setEditingId(null);
  };

  const handleRemove = (id: number) => {
    if (confirm('Supprimer cette note ?')) onChange(notes.filter(n => n.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">
        Notes personnelles sur ce dossier (≠ comptes rendus enquêteur). Visibles uniquement par les utilisateurs de l'app.
      </div>

      {sorted.length === 0 && !showForm && (
        <div className="text-center py-4 text-sm text-gray-400 italic bg-gray-50 border border-dashed border-gray-200 rounded">
          Aucune note pour ce dossier.
        </div>
      )}

      <div className="space-y-2">
        {sorted.map(note => {
          const isEditing = editingId === note.id;
          return (
            <div key={note.id} className="border border-gray-200 rounded p-2 bg-white text-sm">
              <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                <CalendarIcon className="h-3 w-3" />
                {new Date(note.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                {note.auteur && (
                  <>
                    <span>·</span>
                    <UserIcon className="h-3 w-3" />
                    {note.auteur}
                  </>
                )}
                <div className="ml-auto flex items-center gap-1">
                  {!readOnly && !isEditing && (
                    <>
                      <button onClick={() => handleStartEdit(note)} className="text-gray-400 hover:text-emerald-600" title="Modifier">
                        <Edit className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleRemove(note.id)} className="text-gray-400 hover:text-red-600" title="Supprimer">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="space-y-1.5">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded resize-y"
                  />
                  <Input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="Tags séparés par des virgules"
                    className="h-7 text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-6 text-xs">
                      Annuler
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} disabled={!editContent.trim()} className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700">
                      <Save className="h-3 w-3 mr-1" />
                      Enregistrer
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-gray-700 whitespace-pre-wrap">{note.contenu}</div>
                  {note.tags && note.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {note.tags.map(t => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200"
                        >
                          <TagIcon className="h-2.5 w-2.5" />
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        showForm ? (
          <div className="border-2 border-dashed border-emerald-300 rounded p-3 bg-emerald-50/30 space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Nouvelle note</h4>
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={3}
              autoFocus
              placeholder="Votre note…"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-y"
            />
            <Input
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
              placeholder="Tags optionnels (ex: expertise, JLD, audition)"
              className="h-8 text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="h-7 text-xs">
                <X className="h-3 w-3 mr-1" />
                Annuler
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!draftContent.trim()}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-3 w-3 mr-1" />
                Ajouter la note
              </Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-sm text-emerald-700 hover:bg-emerald-50 py-2 rounded border-2 border-dashed border-emerald-300 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Ajouter une note
          </button>
        )
      )}
    </div>
  );
};
