'use client';

/**
 * Éditeur de texte enrichi WYSIWYG réutilisable.
 *
 * Toolbar : Gras / Italique / Souligné / Surligner / Liste à puces / Tirets.
 * Stockage : HTML (compatible avec `renderFormattedText` côté lecture).
 *
 * Le contenu HTML est injecté en `innerHTML` une seule fois à la première
 * peinture (`useLayoutEffect`) et lorsque l'`id` change, pour éviter que React
 * écrase la frappe utilisateur. Les changements remontent via `onChange` au
 * niveau de `onInput` (debounce assuré par le parent si besoin).
 */

import React, { useLayoutEffect, useRef } from 'react';
import { renderFormattedText, stripClipboardNoise } from '@/lib/formatCR';

interface RichTextEditorProps {
  /** Identifiant unique pour distinguer plusieurs éditeurs simultanés */
  id?: string | number;
  /** Contenu HTML/markdown léger (texte brut accepté également) */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Hauteur minimale en px (par défaut 120) */
  minHeight?: number;
  /** Hauteur maximale en css (par défaut '40vh') */
  maxHeight?: string;
  readOnly?: boolean;
  className?: string;
  /** Cache la toolbar — utile pour les zones très condensées */
  hideToolbar?: boolean;
}

const exec = (cmd: string, arg?: string) => {
  document.execCommand(cmd, false, arg);
};

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  id,
  value,
  onChange,
  placeholder = 'Saisir du texte…',
  minHeight = 120,
  maxHeight = '40vh',
  readOnly = false,
  className = '',
  hideToolbar = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef<string>('');

  // Initialise le contenu (1 seule fois par id) ou si une valeur externe
  // arrive (ex: chargement asynchrone). On ne ré-injecte pas tant que la
  // dernière valeur émise correspond, sinon le curseur sauterait à chaque
  // frappe.
  useLayoutEffect(() => {
    if (!editorRef.current) return;
    if (value === lastValueRef.current) return;
    const html = value ? renderFormattedText(value) : '';
    editorRef.current.innerHTML = html;
    lastValueRef.current = value;
  }, [value, id]);

  const handleInput = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastValueRef.current = html;
    onChange(html);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const clip = e.clipboardData;
    const html = clip.getData('text/html');
    const text = clip.getData('text/plain');
    if (html) {
      const cleaned = stripClipboardNoise(html);
      document.execCommand('insertHTML', false, cleaned);
    } else if (text) {
      document.execCommand('insertText', false, text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); exec('bold'); }
    else if (key === 'u') { e.preventDefault(); exec('underline'); }
    else if (key === 'i') { e.preventDefault(); exec('italic'); }
    else if (key === 'h') { e.preventDefault(); exec('hiliteColor', '#fef08a'); }
  };

  const ToolbarButton: React.FC<{
    title: string;
    onClick: () => void;
    children: React.ReactNode;
    style?: React.CSSProperties;
    extraClass?: string;
  }> = ({ title, onClick, children, style, extraClass = '' }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        editorRef.current?.focus();
        onClick();
      }}
      className={`px-2 py-1 text-xs hover:bg-gray-200 rounded text-gray-700 ${extraClass}`}
      style={style}
    >
      {children}
    </button>
  );

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {!hideToolbar && !readOnly && (
        <div className="sticky top-0 z-10 flex flex-wrap gap-0.5 p-1 border border-b-0 rounded-t bg-gray-50 items-center">
          <ToolbarButton title="Gras — Ctrl+B" onClick={() => exec('bold')} extraClass="font-bold">
            G
          </ToolbarButton>
          <ToolbarButton title="Italique — Ctrl+I" onClick={() => exec('italic')} extraClass="italic">
            I
          </ToolbarButton>
          <ToolbarButton title="Souligné — Ctrl+U" onClick={() => exec('underline')} extraClass="underline">
            S
          </ToolbarButton>
          <ToolbarButton
            title="Surligner — Ctrl+H"
            onClick={() => exec('hiliteColor', '#fef08a')}
            style={{ background: '#fef08a' }}
          >
            HL
          </ToolbarButton>
          <ToolbarButton title="Liste à puces" onClick={() => exec('insertUnorderedList')} extraClass="font-mono">
            •
          </ToolbarButton>
          <ToolbarButton
            title="Insérer un tiret"
            onClick={() => exec('insertHTML', '— ')}
            extraClass="font-mono"
          >
            —
          </ToolbarButton>
          <ToolbarButton
            title="Effacer la mise en forme"
            onClick={() => exec('removeFormat')}
            extraClass="font-mono text-gray-500"
          >
            ⌫
          </ToolbarButton>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck={false}
        className={`w-full overflow-y-auto p-2 text-sm border focus:outline-none focus:ring-1 focus:ring-emerald-400 ${
          hideToolbar || readOnly ? 'rounded' : 'rounded-b border-t-0'
        } ${readOnly ? 'bg-gray-50 text-gray-700' : 'bg-white'}`}
        style={{
          minHeight: `${minHeight}px`,
          maxHeight,
          wordBreak: 'break-word',
        }}
        data-placeholder={placeholder}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
};
