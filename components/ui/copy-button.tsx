'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

/** Copie un texte dans le presse-papiers, avec repli sur execCommand pour les
 *  contextes non sécurisés où navigator.clipboard est indisponible. */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // On tente le repli ci-dessous.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  /** Texte à copier — évalué au clic (permet de construire la liste à la volée). */
  getText: () => string;
  /** Libellé optionnel affiché à côté de l'icône. */
  label?: string;
  title?: string;
  className?: string;
  iconClassName?: string;
  /** Message de toast affiché après une copie réussie. */
  successMessage?: string;
}

/** Petit bouton « copier » réutilisable : icône presse-papiers → coche pendant
 *  1,5 s après la copie, toast de confirmation. `stopPropagation` pour rester
 *  cliquable dans une carte elle-même cliquable. */
export const CopyButton = ({
  getText,
  label,
  title = 'Copier',
  className = '',
  iconClassName = 'h-3.5 w-3.5',
  successMessage = 'Copié dans le presse-papiers',
}: CopyButtonProps) => {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = getText();
    if (!text) {
      showToast('Rien à copier', 'info');
      return;
    }
    const ok = await writeToClipboard(text);
    if (ok) {
      setCopied(true);
      showToast(successMessage, 'success');
      setTimeout(() => setCopied(false), 1500);
    } else {
      showToast('Copie impossible', 'error');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className={`inline-flex items-center gap-1 rounded-md transition-colors ${className}`}
    >
      {copied ? (
        <Check className={`${iconClassName} text-green-600`} />
      ) : (
        <Copy className={iconClassName} />
      )}
      {label && <span>{label}</span>}
    </button>
  );
};
