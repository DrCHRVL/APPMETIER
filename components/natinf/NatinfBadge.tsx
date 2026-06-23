'use client';

import React from 'react';
import type { NatinfNature } from '@/types/natinf';

const NATURE_STYLE: Record<NatinfNature, string> = {
  crime: 'bg-red-100 text-red-800 border-red-300',
  delit: 'bg-amber-100 text-amber-800 border-amber-300',
  contravention: 'bg-sky-100 text-sky-800 border-sky-300',
  civile: 'bg-slate-100 text-slate-700 border-slate-300',
  inconnu: 'bg-gray-100 text-gray-600 border-gray-300',
};

interface NatinfBadgeProps {
  nature: NatinfNature;
  /** Texte de la peine encourue (ex. « Crime — 20 ans »). Si absent, nature seule. */
  quantumLabel?: string;
  /** Affiche le n° NATINF en préfixe */
  code?: string;
  /** Mode compact : n° NATINF seul, coloré par nature, quantum en infobulle. */
  compact?: boolean;
  className?: string;
  title?: string;
}

/** Pastille colorée selon la nature (crime / délit / contravention). */
export const NatinfBadge = ({ nature, quantumLabel, code, compact, className, title }: NatinfBadgeProps) => {
  const style = NATURE_STYLE[nature] || NATURE_STYLE.inconnu;
  if (compact) {
    return (
      <span
        title={title || [code && `NATINF ${code}`, quantumLabel].filter(Boolean).join(' — ')}
        className={`inline-flex items-center rounded border px-1 py-0 text-[10px] font-mono leading-none ${style} ${className || ''}`}
      >
        {code || natureLabel(nature)}
      </span>
    );
  }
  return (
    <span
      title={title || quantumLabel}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none ${style} ${className || ''}`}
    >
      {code && <span className="font-mono opacity-70">{code}</span>}
      <span>{quantumLabel || natureLabel(nature)}</span>
    </span>
  );
};

function natureLabel(n: NatinfNature): string {
  switch (n) {
    case 'crime':
      return 'Crime';
    case 'delit':
      return 'Délit';
    case 'contravention':
      return 'Contravention';
    case 'civile':
      return 'Infraction civile';
    default:
      return 'Nature ?';
  }
}
