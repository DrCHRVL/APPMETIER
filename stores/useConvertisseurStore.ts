/**
 * useConvertisseurStore — le convertisseur PDF → texte doit-il rester monté
 * hors de son module ?
 *
 * Changer de module démonte la page : un OCR en cours s'arrêtait et ses
 * résultats étaient perdus. Tant qu'un OCR tourne — et ensuite jusqu'à ce que
 * le magistrat revienne voir le résultat — la page reste montée, cachée. Hors
 * de ce cas, rien ne tourne en arrière-plan.
 */
import { create } from '@/lib/zustand';

interface ConvertisseurState {
  retenu: boolean;
  setRetenu: (retenu: boolean) => void;
}

export const useConvertisseurStore = create<ConvertisseurState>((set) => ({
  retenu: false,
  setRetenu: (retenu) => set({ retenu }),
}));
