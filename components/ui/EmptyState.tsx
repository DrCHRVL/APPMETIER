'use client';

/**
 * État vide illustré : un cercle doux avec icône, un titre, une phrase
 * d'orientation et (si l'utilisateur peut créer) l'action directe.
 */
import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Teinte du cercle (classes Tailwind bg/text), défaut indigo doux */
  tone?: { circle: string; icon: string };
}

export const EmptyState = ({ icon, title, hint, actionLabel, onAction, tone }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center text-center py-16 px-6">
    <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${tone?.circle || 'bg-indigo-50'}`}>
      <span className={`[&>svg]:h-7 [&>svg]:w-7 ${tone?.icon || 'text-indigo-400'}`}>{icon}</span>
    </div>
    <p className="text-[15px] font-semibold text-gray-700">{title}</p>
    {hint && <p className="text-[13px] text-gray-400 mt-1 max-w-sm leading-relaxed">{hint}</p>}
    {actionLabel && onAction && (
      <Button size="sm" className="mt-4 gap-1.5" onClick={onAction}>
        <Plus className="h-3.5 w-3.5" />{actionLabel}
      </Button>
    )}
  </div>
);
