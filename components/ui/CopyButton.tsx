'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyPlainToClipboard } from '@/utils/richTextExport';
import { useToast } from '@/contexts/ToastContext';

interface CopyButtonProps {
  /** Valeur statique à copier (n° de dossier, de parquet…). Ignorée si `getText` est fourni. */
  value?: string;
  /** Texte évalué au clic — permet de construire une liste à la volée. Prioritaire sur `value`. */
  getText?: () => string;
  /** Libellé optionnel affiché à côté de l'icône. */
  label?: string;
  /** Libellé de l'infobulle (par défaut « Copier »). */
  title?: string;
  className?: string;
  iconClassName?: string;
  /** Si fourni, un toast est affiché après la copie (succès / échec / rien à copier). */
  successMessage?: string;
}

/**
 * Petit bouton « copier » réutilisable : icône presse-papiers → coche pendant
 * un court instant après la copie. La copie passe par `copyPlainToClipboard`,
 * qui fonctionne aussi hors contexte sécurisé (web interne en http).
 *
 * Deux usages : `value` pour une valeur statique, ou `getText` pour un texte
 * construit au clic. Fournir `successMessage` pour activer un toast de retour.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  value,
  getText,
  label,
  title = 'Copier',
  className = '',
  iconClassName = 'h-3.5 w-3.5',
  successMessage,
}) => {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = getText ? getText() : (value ?? '');
    if (!text) {
      if (successMessage) showToast('Rien à copier', 'info');
      return;
    }
    const ok = await copyPlainToClipboard(text);
    if (ok) {
      setCopied(true);
      if (successMessage) showToast(successMessage, 'success');
      window.setTimeout(() => setCopied(false), 1500);
    } else if (successMessage) {
      showToast('Copie impossible', 'error');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center gap-1 transition-colors ${className}`}
    >
      {copied ? (
        <Check className={`${iconClassName} text-emerald-600`} />
      ) : (
        <Copy className={iconClassName} />
      )}
      {label && <span>{label}</span>}
    </button>
  );
};
