import React, { useState, useCallback } from 'react';
import { Enquete, ToDoItem, GlobalToDoItem } from '@/types/interfaces';
import { Check, Plus, X } from 'lucide-react';

interface ToDoDashboardProps {
  enquetes: Enquete[];
  globalTodos: GlobalToDoItem[];
  onAddGlobalTodo: (text: string) => void;
  onDeleteGlobalTodo: (id: number) => void;
  onUpdateEnquete: (id: number, updates: Partial<Enquete>) => void;
}

// Ids qui viennent d'être cochés — pour l'animation de barrage avant disparition
type CompletingSet = Set<string>; // "global-{id}" | "enquete-{enqueteId}-{todoId}"

export const ToDoDashboard = ({
  enquetes,
  globalTodos,
  onAddGlobalTodo,
  onDeleteGlobalTodo,
  onUpdateEnquete,
}: ToDoDashboardProps) => {
  const [newText, setNewText] = useState('');
  const [completing, setCompleting] = useState<CompletingSet>(new Set());

  // Todos actifs de toutes les enquêtes (non archivées)
  const enqueteTodos: Array<{ enquete: Enquete; todo: ToDoItem }> = enquetes
    .filter(e => e.statut !== 'archive')
    .flatMap(e =>
      (e.toDos || [])
        .filter(t => t.status === 'active')
        .map(todo => ({ enquete: e, todo }))
    )
    .sort(
      (a, b) =>
        new Date(a.todo.dateCreation).getTime() -
        new Date(b.todo.dateCreation).getTime()
    );

  const totalActive = globalTodos.length + enqueteTodos.length;

  const handleAddGlobal = () => {
    if (!newText.trim()) return;
    onAddGlobalTodo(newText.trim());
    setNewText('');
  };

  const animateThenComplete = useCallback(
    (key: string, action: () => void) => {
      setCompleting(prev => new Set(prev).add(key));
      setTimeout(() => {
        action();
        setCompleting(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 550);
    },
    []
  );

  const handleCompleteGlobal = (id: number) => {
    const key = `global-${id}`;
    if (completing.has(key)) return;
    animateThenComplete(key, () => onDeleteGlobalTodo(id));
  };

  const handleCompleteEnquete = (enqueteId: number, todoId: number) => {
    const key = `enquete-${enqueteId}-${todoId}`;
    if (completing.has(key)) return;
    animateThenComplete(key, () => {
      const enquete = enquetes.find(e => e.id === enqueteId);
      if (!enquete) return;
      const updatedTodos = (enquete.toDos || []).map(t =>
        t.id === todoId
          ? { ...t, status: 'completed' as const, dateCompletion: new Date().toISOString() }
          : t
      );
      onUpdateEnquete(enqueteId, { toDos: updatedTodos });
    });
  };

  if (totalActive === 0 && globalTodos.length === 0) {
    // Afficher quand même le panel pour permettre l'ajout
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 shadow-sm">
      {/* En-tête */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          À faire
        </span>
        {totalActive > 0 && (
          <span className="bg-violet-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
            {totalActive}
          </span>
        )}
      </div>

      {/* Layout horizontal : deux colonnes */}
      <div className="flex gap-6 flex-wrap">

        {/* ── Section Général ── */}
        <div className="flex-1 min-w-[200px]">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Général
          </p>

          {/* Liste des todos généraux */}
          <div className="space-y-1 mb-1.5">
            {globalTodos.map(todo => {
              const key = `global-${todo.id}`;
              const isCompleting = completing.has(key);
              return (
                <div
                  key={todo.id}
                  className="flex items-center gap-1.5 group"
                >
                  {/* Faux checkbox */}
                  <button
                    onClick={() => handleCompleteGlobal(todo.id)}
                    className={`h-3.5 w-3.5 flex-shrink-0 rounded border flex items-center justify-center transition-colors
                      ${isCompleting
                        ? 'bg-violet-500 border-violet-500'
                        : 'border-gray-300 hover:border-violet-400 hover:bg-violet-50'
                      }`}
                    title="Marquer comme fait"
                  >
                    {isCompleting && <Check className="h-2 w-2 text-white" />}
                  </button>

                  <span
                    className={`text-xs flex-1 transition-all duration-300 ${
                      isCompleting ? 'line-through text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    {todo.text}
                  </span>

                  {/* Bouton supprimer */}
                  <button
                    onClick={() => onDeleteGlobalTodo(todo.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Supprimer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Champ d'ajout inline */}
          <div className="flex items-center gap-1 border border-dashed border-gray-300 rounded px-2 py-0.5">
            <Plus className="h-3 w-3 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Nouvelle tâche générale..."
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddGlobal();
              }}
              className="flex-1 text-xs outline-none bg-transparent placeholder-gray-400 py-0.5"
            />
            {newText.trim() && (
              <button
                onClick={handleAddGlobal}
                className="text-green-600 hover:text-green-700 flex-shrink-0"
                title="Ajouter"
              >
                <Check className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Séparateur vertical */}
        {enqueteTodos.length > 0 && (
          <div className="w-px bg-gray-100 self-stretch" />
        )}

        {/* ── Section Enquêtes ── */}
        {enqueteTodos.length > 0 && (
          <div className="flex-[2] min-w-[240px]">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
              Par enquête
            </p>

            {/* Grille de todos enquête : affichage compact multi-colonnes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
              {enqueteTodos.map(({ enquete, todo }) => {
                const key = `enquete-${enquete.id}-${todo.id}`;
                const isCompleting = completing.has(key);
                return (
                  <div
                    key={key}
                    className="flex items-center gap-1.5 group"
                  >
                    {/* Faux checkbox */}
                    <button
                      onClick={() => handleCompleteEnquete(enquete.id, todo.id)}
                      className={`h-3.5 w-3.5 flex-shrink-0 rounded border flex items-center justify-center transition-colors
                        ${isCompleting
                          ? 'bg-violet-500 border-violet-500'
                          : 'border-gray-300 hover:border-violet-400 hover:bg-violet-50'
                        }`}
                      title="Marquer comme fait"
                    >
                      {isCompleting && <Check className="h-2 w-2 text-white" />}
                    </button>

                    <span
                      className={`text-xs flex-1 min-w-0 truncate transition-all duration-300 ${
                        isCompleting ? 'line-through text-gray-400' : 'text-gray-700'
                      }`}
                      title={todo.text}
                    >
                      {todo.text}
                    </span>

                    {/* Numéro d'enquête */}
                    <span className="text-[9px] text-gray-400 font-medium whitespace-nowrap flex-shrink-0 bg-gray-100 px-1 rounded">
                      {enquete.numero}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Message vide */}
        {totalActive === 0 && (
          <p className="text-xs text-gray-400 italic self-center">
            Aucune tâche en cours
          </p>
        )}
      </div>
    </div>
  );
};
