import { create } from '@/lib/zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastState {
  toast: { message: string; type: ToastType } | null;
  showToast: (message: string, type: ToastType) => void;
  clearToast: () => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toast: null,

  showToast: (message: string, type: ToastType) => {
    // Déduplication : ne pas re-setter si le même toast est déjà affiché
    const current = get().toast;
    if (current?.message === message && current?.type === type) return;
    set({ toast: { message, type } });
  },

  clearToast: () => set({ toast: null }),
}));
