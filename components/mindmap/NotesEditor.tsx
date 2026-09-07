// components/mindmap/NotesEditor.tsx
//
// Éditeur WYSIWYG léger pour les notes de renseignement d'une fiche
// « mis en cause » de la cartographie : mêmes gestes que la barre de mise en
// forme des comptes rendus d'enquête (gras, italique, souligné, surlignage,
// puces), mais dans un bloc compact et redimensionnable.
//
// Format stocké : le HTML produit par le contentEditable. Il reste lisible par
// tout ce qui affiche déjà les CR (`renderFormattedText` accepte aussi bien du
// HTML que l'ancien texte simple), donc les fiches saisies avant cette barre
// d'outils s'ouvrent telles quelles, et un bloc de texte brut ajouté ensuite
// (enrichissement de l'attaché) garde ses retours à la ligne.

'use client';

import React, { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Highlighter, List } from 'lucide-react';
import { renderFormattedText } from '@/lib/formatCR';

interface NotesEditorProps {
  /** Contenu enregistré : HTML de l'éditeur, ou texte simple d'une ancienne fiche. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Classes du bloc éditable (hauteur, défilement…). */
  className?: string;
}

/** Prépare un contenu enregistré pour l'affichage dans le contentEditable. */
function toEditorHtml(value: string): string {
  if (!value) return '';
  // Les retours à la ligne survivants (texte brut concaténé à une note déjà
  // mise en forme) seraient invisibles une fois dans le DOM.
  return renderFormattedText(value).replace(/\n/g, '<br>');
}

/**
 * Un contentEditable « vide » ne l'est jamais tout à fait (`<br>`,
 * `<div><br></div>`…). On renvoie la chaîne vide dans ce cas, pour que la
 * fiche n'enregistre pas une note faite de balises sans texte.
 */
export function normalizeNotesHtml(html: string): string {
  const texte = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return texte ? html.trim() : '';
}

export const NotesEditor: React.FC<NotesEditorProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // Dernier HTML émis par l'éditeur : permet de distinguer une valeur qui nous
  // revient (ne rien réécrire — le curseur sauterait à chaque frappe) d'une
  // valeur posée de l'extérieur (changement de personne, remise à zéro).
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || value === lastEmitted.current) return;
    el.innerHTML = toEditorHtml(value);
    lastEmitted.current = value;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? '';
    lastEmitted.current = html;
    onChange(html);
  };

  /** Applique une commande d'édition sans perdre la sélection en cours. */
  const exec = (command: string, arg?: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  return (
    <div className="border border-slate-300 rounded bg-white focus-within:ring-2 focus-within:ring-slate-300">
      <div className="flex items-center gap-0.5 px-1 py-1 border-b border-slate-200 bg-slate-50 rounded-t">
        <ToolbarButton title="Gras — Ctrl+B" onMouseDown={exec('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Italique — Ctrl+I" onMouseDown={exec('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Souligné — Ctrl+U" onMouseDown={exec('underline')}>
          <Underline className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Surligner" onMouseDown={exec('hiliteColor', '#fef08a')}>
          <Highlighter className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Liste à puces" onMouseDown={exec('insertUnorderedList')}>
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-placeholder={placeholder}
        // `overscroll-contain` : la molette fait défiler la note, pas le
        // panneau derrière, tant qu'on n'est pas arrivé au bout du texte.
        className={`w-full px-2 py-1.5 text-xs overflow-y-auto overscroll-contain resize-y focus:outline-none ${className}`}
        style={{ wordBreak: 'break-word' }}
        onInput={emit}
        // Collage en texte brut : les notes restent légères et lisibles, sans
        // traîner les styles Word/Outlook du presse-papier.
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          emit();
        }}
      />
    </div>
  );
};

const ToolbarButton: React.FC<{
  title: string;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}> = ({ title, onMouseDown, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onMouseDown={onMouseDown}
    className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200"
  >
    {children}
  </button>
);
