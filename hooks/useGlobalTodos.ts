import { useState, useEffect, useCallback } from 'react';
import { GlobalToDoItem } from '@/types/interfaces';
import { ElectronBridge } from '@/utils/electronBridge';

const STORAGE_KEY = 'global_todos';

export const useGlobalTodos = () => {
  const [todos, setTodos] = useState<GlobalToDoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await ElectronBridge.getData<GlobalToDoItem[]>(STORAGE_KEY, []);
        setTodos(Array.isArray(data) ? data : []);
      } catch {
        setTodos([]);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const save = useCallback(async (updated: GlobalToDoItem[]) => {
    setTodos(updated);
    await ElectronBridge.setData(STORAGE_KEY, updated);
  }, []);

  const addTodo = useCallback(async (text: string) => {
    const newItem: GlobalToDoItem = {
      id: Date.now(),
      text: text.trim(),
      dateCreation: new Date().toISOString(),
    };
    await save([...todos, newItem]);
  }, [todos, save]);

  const deleteTodo = useCallback(async (id: number) => {
    await save(todos.filter(t => t.id !== id));
  }, [todos, save]);

  return { todos, isLoading, addTodo, deleteTodo };
};
