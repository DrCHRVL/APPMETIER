import React, { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Enquete, ToDoItem } from '@/types/interfaces';

interface TodoReminderBarProps {
  enquetes: Enquete[];
  globalTodos: ToDoItem[];
  onUpdateEnquete: (id: number, updates: Partial<Enquete>) => void;
  onGlobalTodosChange: (todos: ToDoItem[]) => void;
  onOpenEnquete?: (enquete: Enquete) => void;
}

export const TodoReminderBar = React.memo(({
  enquetes,
  globalTodos,
  onUpdateEnquete,
  onGlobalTodosChange,
  onOpenEnquete,
}: TodoReminderBarProps) => {
  const [newText, setNewText] = useState('');
  const [showInput, setShowInput] = useState(false);

  // Todos actifs des enquêtes, avec numéro source (mémorisé pour éviter les recalculs)
  const allActive = useMemo(() => {
    const enqueteTodos = enquetes.flatMap(e =>
      (e.toDos || [])
        .filter(t => t.status === 'active')
        .map(t => ({ ...t, enqueteId: e.id as number | null, enqueteNumero: e.numero as string | null }))
    );
    const activeGlobals = globalTodos
      .filter(t => t.status === 'active')
      .map(t => ({ ...t, enqueteId: null as number | null, enqueteNumero: null as string | null }));
    return [...activeGlobals, ...enqueteTodos];
  }, [enquetes, globalTodos]);

  const totalCount = allActive.length;

  const handleCheckGlobal = (id: number) => {
    // Suppression immédiate, pas d'historique
    onGlobalTodosChange(globalTodos.filter(t => t.id !== id));
  };

  const handleCheckEnquete = (enqueteId: number, todoId: number) => {
    const enquete = enquetes.find(e => e.id === enqueteId);
    if (!enquete) return;
    const updatedTodos = (enquete.toDos || []).map(t =>
      t.id === todoId
        ? { ...t, status: 'completed' as const, dateCompletion: new Date().toISOString() }
        : t
    );
    onUpdateEnquete(enqueteId, { toDos: updatedTodos });
  };

  const handleAddGlobal = () => {
    if (!newText.trim()) return;
    const newTodo: ToDoItem = {
      id: Date.now(),
      text: newText.trim(),
      status: 'active',
      dateCreation: new Date().toISOString(),
    };
    onGlobalTodosChange([...globalTodos, newTodo]);
    setNewText('');
    setShowInput(false);
  };

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 shadow-sm">
      {/* En-tête */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          À faire
        </span>
        {totalCount > 0 && (
          <span className="text-[10px] bg-violet-500 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
            {totalCount}
          </span>
        )}
      </div>

      {/* Liste verticale des tâches */}
      <ul className="flex flex-col divide-y divide-amber-200/70">
        {allActive.map(todo => {
          const linkedEnquete = todo.enqueteId !== null
            ? enquetes.find(e => e.id === todo.enqueteId)
            : undefined;
          return (
            <li
              key={`${todo.enqueteId ?? 'g'}-${todo.id}`}
              className="flex items-start gap-2 py-1 group"
            >
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  todo.enqueteId !== null
                    ? handleCheckEnquete(todo.enqueteId, todo.id)
                    : handleCheckGlobal(todo.id);
                }}
                className="w-3.5 h-3.5 mt-0.5 rounded-sm border border-gray-400 flex-shrink-0 hover:border-violet-500 hover:bg-violet-100 transition-colors"
                title="Marquer comme fait"
              />
              <span
                className={`text-xs text-gray-700 leading-snug select-none ${linkedEnquete && onOpenEnquete ? 'cursor-pointer hover:text-violet-700 hover:underline' : ''}`}
                onClick={linkedEnquete && onOpenEnquete ? () => onOpenEnquete(linkedEnquete) : undefined}
                title={linkedEnquete && onOpenEnquete ? `Ouvrir l'enquête ${todo.enqueteNumero}` : undefined}
              >
                {todo.text}
                {todo.enqueteNumero && (
                  <span className="text-gray-400 ml-1 text-[10px]">
                    ({todo.enqueteNumero})
                  </span>
                )}
              </span>
            </li>
          );
        })}

        {totalCount === 0 && (
          <li className="text-[11px] text-gray-400 italic py-1">Aucune tâche en cours</li>
        )}
      </ul>

      {/* Ajout d'une tâche générale */}
      <div className="mt-2 pt-2 border-t border-amber-200/70">
        {showInput ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              className="text-xs border border-violet-300 rounded-full px-2 py-0.5 flex-1 focus:outline-none focus:ring-1 focus:ring-violet-400"
              placeholder="Nouvelle tâche..."
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddGlobal();
                if (e.key === 'Escape') {
                  setShowInput(false);
                  setNewText('');
                }
              }}
            />
            <button
              onClick={handleAddGlobal}
              className="text-[10px] text-violet-600 hover:text-violet-800 font-semibold"
            >
              ✓
            </button>
            <button
              onClick={() => { setShowInput(false); setNewText(''); }}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              ✗
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-violet-600 border border-dashed border-gray-300 rounded-full px-2 py-0.5 hover:border-violet-400 transition-colors"
            title="Ajouter une tâche générale"
          >
            <Plus className="h-2.5 w-2.5" />
            Ajouter
          </button>
        )}
      </div>
    </div>
  );
});

TodoReminderBar.displayName = 'TodoReminderBar';
