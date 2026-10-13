import React, { useMemo } from 'react';
import { getMagistratsForContentieux, getInitials, getMagistratColor } from '@/utils/magistrats';
import { UserManager } from '@/utils/userManager';

interface MagistratBadgeProps {
  magistratReferent?: string;
  contentieuxId: string;
  /** Si fourni, la pastille devient cliquable pour choisir le magistrat. */
  onChange?: (windowsUsername: string | undefined) => void;
}

/** Pastille ronde aux initiales du magistrat référent, couleur propre à chacun. */
export const MagistratBadge = ({ magistratReferent, contentieuxId, onChange }: MagistratBadgeProps) => {
  const magistrats = useMemo(() => getMagistratsForContentieux(contentieuxId), [contentieuxId]);
  const referent = magistratReferent
    ? UserManager.getInstance().getAllUsers().find(u => u.windowsUsername === magistratReferent)
    : undefined;

  if (!magistratReferent && !onChange) return null;

  const label = referent?.displayName ?? magistratReferent;
  // Si le nom affiché n'a qu'un mot, l'identifiant ("prenom.nom") donne les deux lettres.
  const initialsSource = /[\s\-._]/.test((label || '').trim()) ? label : magistratReferent;
  const chip = magistratReferent ? (
    <span
      className="h-6 min-w-6 px-1 rounded-full text-[11px] font-bold leading-6 text-white inline-flex items-center justify-center"
      style={{ backgroundColor: getMagistratColor(magistratReferent) }}
    >
      {getInitials(initialsSource || '?')}
    </span>
  ) : (
    <span className="h-6 w-6 rounded-full border border-dashed border-gray-300 inline-block" />
  );

  const title = magistratReferent ? `Magistrat référent : ${label}` : 'Attribuer un magistrat référent';

  if (!onChange) return <span title={title} className="inline-flex">{chip}</span>;

  return (
    <span className="relative inline-flex items-center" title={title} onClick={e => e.stopPropagation()}>
      {chip}
      <select
        aria-label="Magistrat référent"
        className="absolute inset-0 opacity-0 cursor-pointer"
        value={magistratReferent ?? ''}
        onChange={e => onChange(e.target.value || undefined)}
      >
        <option value="">— Aucun —</option>
        {magistrats.map(m => (
          <option key={m.windowsUsername} value={m.windowsUsername}>{m.displayName}</option>
        ))}
        {magistratReferent && !magistrats.some(m => m.windowsUsername === magistratReferent) && (
          <option value={magistratReferent}>{label}</option>
        )}
      </select>
    </span>
  );
};
