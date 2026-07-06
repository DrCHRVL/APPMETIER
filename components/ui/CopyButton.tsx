'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { copyPlainToClipboard } from '@/utils/richTextExport';

interface CopyButtonProps {
  /** Valeur à copier (numéro de dossier, de parquet, ligne d'écoute…). */
  value: string;
  /** Libellé de l'infobulle (par défaut « Copier »). */
  title?: string;
  className?: string;
}

/**
 * Petit bouton « copier » à poser à côté d'un identifiant que l'utilisateur
 * retape souvent ailleurs (NPP, bureautique). Utilise `copyPlainToClipboard`,
 * qui fonctionne aussi hors contexte sécurisé (web interne en http).
 */
export const CopyButton: React.FC<CopyButtonProps> = ({ value, title = 'Copier', className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyPlainToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copié !' : title}
      aria-label={title}
      className={`inline-flex items-center justify-center text-gray-400 hover:text-gray-700 transition-colors ${className}`}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
};
