import React, { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { ChevronDown, ChevronUp, Plus, Check, X, Pencil, RotateCcw } from 'lucide-react';
import { Enquete, ToDoItem } from '@/types/interfaces';

interface ToDoSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
}

export const ToDoSection = React.memo(({ enquete, onUpdate, isEditing }: ToDoSectionProps) => {
  const [newTodoText, setNewTodoText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  const toDos = enquete.toDos || [];
  const activeTodos = useMemo(() =>
    toDos.filter(todo => todo.status === 'active'),
    [toDos]
  );
  const completedTodos = useMemo(() =>
    toDos.filter(todo => todo.status === 'completed')
      .sort((a, b) => new Date(b.dateCompletion!).getTime() - new Date(a.dateCompletion!).getTime()),
    [toDos]
  );

  const handleAddTodo = () => {
    if (!onUpdate || !newTodoText.trim()) return;

    const newTodo: ToDoItem = {
      id: Date.now(),
      text: newTodoText.trim(),
      status: 'active',
      dateCreation: new Date().toISOString()
    };

    const updatedTodos = [...toDos, newTodo];
    onUpdate(enquete.id, { toDos: updatedTodos });
    setNewTodoText('');
  };

  const handleToggleTodo = (id: number) => {
    if (!onUpdate) return;

    const updatedTodos = toDos.map(todo => {
      if (todo.id === id) {
        if (todo.status === 'active') {
          return {
            ...todo,
            status: 'completed' as const,
            dateCompletion: new Date().toISOString()
          };
        } else {
          return {
            ...todo,
            status: 'active' as const,
            dateCompletion: undefined
          };
        }
      }
      return todo;
    });

    onUpdate(enquete.id, { toDos: updatedTodos });
  };

  const handleEditTodo = (id: number, newText: string) => {
    if (!onUpdate || !newText.trim()) return;

    const updatedTodos = toDos.map(todo =>
      todo.id === id ? { ...todo, text: newText.trim() } : todo
    );

    onUpdate(enquete.id, { toDos: updatedTodos });
    setEditingTodoId(null);
    setEditingText('');
  };

  const handleDeleteTodo = (id: number) => {
    if (!onUpdate) return;

    const updatedTodos = toDos.filter(todo => todo.id !== id);
    onUpdate(enquete.id, { toDos: updatedTodos });
  };

  const startEditing = (todo: ToDoItem) => {
    setEditingTodoId(todo.id);
    setEditingText(todo.text);
  };

  const cancelEditing = () => {
    setEditingTodoId(null);
    setEditingText('');
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          À faire
          {activeTodos.length > 0 && (
            <span className="bg-violet-500 text-white text-xs px-2 py-1 rounded-full font-bold">
              {activeTodos.length}
            </span>
          )}
        </h3>
      </div>

      {/* Liste des tâches actives */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {activeTodos.map(todo => (
          <div key={todo.id} className="flex items-start gap-2 p-2 bg-gray-50 rounded group">
            <Checkbox
              checked={false}
              onCheckedChange={() => handleToggleTodo(todo.id)}
              className="flex-shrink-0"
            />
            
            {editingTodoId === todo.id ? (
              <div className="flex-1 flex items-center gap-1">
                <Input
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  className="flex-1 h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditTodo(todo.id, editingText);
                    } else if (e.key === 'Escape') {
                      cancelEditing();
                    }
                  }}
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-green-600"
                  onClick={() => handleEditTodo(todo.id, editingText)}
                >
                  <Check className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-gray-600"
                  onClick={cancelEditing}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <>
                <span 
                  className="flex-1 text-sm cursor-pointer hover:bg-gray-100 p-1 rounded"
                  onClick={() => isEditing && startEditing(todo)}
                  title={isEditing ? "Cliquer pour modifier" : ""}
                >
                  {todo.text}
                </span>
                
                {isEditing && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-gray-600"
                      onClick={() => startEditing(todo)}
                      title="Modifier"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-600"
                      onClick={() => handleDeleteTodo(todo.id)}
                      title="Supprimer"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {/* Ajout d'une nouvelle tâche - TOUJOURS VISIBLE */}
        {onUpdate && (
          <div className="col-span-5 flex items-center gap-2 p-2 border-2 border-dashed border-gray-300 rounded">
            <Plus className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <Input
              placeholder="Nouvelle tâche..."
              value={newTodoText}
              onChange={(e) => setNewTodoText(e.target.value)}
              className="flex-1 h-8 text-sm border-none shadow-none focus:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddTodo();
                }
              }}
            />
            {newTodoText.trim() && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-green-600"
                onClick={handleAddTodo}
              >
                <Check className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {activeTodos.length === 0 && !isEditing && (
          <div className="col-span-5 text-center py-4 text-gray-500 text-sm">
            Aucune tâche en cours
          </div>
        )}
      </div>

      {/* Historique des tâches terminées */}
      {completedTodos.length > 0 && (
        <div className="border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800"
            onClick={() => setShowHistory(!showHistory)}
          >
            {showHistory ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            Historique ({completedTodos.length} terminée{completedTodos.length > 1 ? 's' : ''})
          </Button>

          {showHistory && (
            <div className="mt-2 space-y-1">
              {completedTodos.map(todo => (
                <div key={todo.id} className="flex items-center gap-2 p-1 text-xs text-gray-600 bg-gray-50 rounded">
                  <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                  <span className="flex-1 line-through">{todo.text}</span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(todo.dateCompletion!).toLocaleDateString()}
                  </span>
                  {isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-4 w-4 p-0 text-gray-400 hover:text-blue-600"
                      onClick={() => handleToggleTodo(todo.id)}
                      title="Remettre en tâche active"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});