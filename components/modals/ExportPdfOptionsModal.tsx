'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { FileText, Loader2, CheckSquare, Square, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { PDF_SECTIONS, resolveSectionOrder, type PdfExportOptions } from '@/utils/generateStatsPdf';

interface ExportPdfOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: PdfExportOptions) => void;
  isExporting: boolean;
  defaultRedacteur?: string;
}

const PREFS_KEY = 'pdf_export_prefs_v1';
const ORDER_KEY = 'pdf_export_order_v1';

/** Charge la dernière sélection (sections décochées) depuis localStorage. */
function loadPersistedSections(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Charge le dernier ordre des sections. resolveSectionOrder() complète les
 *  sections absentes (ajoutées depuis) et écarte les clés inconnues. */
function loadPersistedOrder(): string[] {
  if (typeof window === 'undefined') return resolveSectionOrder();
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return resolveSectionOrder(Array.isArray(parsed) ? parsed : undefined);
  } catch {
    return resolveSectionOrder();
  }
}

export const ExportPdfOptionsModal: React.FC<ExportPdfOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isExporting,
  defaultRedacteur = '',
}) => {
  // true = section incluse. Par défaut tout est inclus, sauf ce qui a été
  // décoché lors du dernier export (mémorisé localement).
  const [sections, setSections] = useState<Record<string, boolean>>(() => {
    const persisted = loadPersistedSections();
    const init: Record<string, boolean> = {};
    for (const s of PDF_SECTIONS) init[s.key] = persisted[s.key] !== false;
    return init;
  });
  // Ordre d'apparition des sections dans le PDF (modifiable, mémorisé).
  const [order, setOrder] = useState<string[]>(loadPersistedOrder);
  const [redacteur, setRedacteur] = useState(defaultRedacteur);
  const [destinataire, setDestinataire] = useState('Procureur de la République');

  const labelByKey = useMemo(
    () => Object.fromEntries(PDF_SECTIONS.map(s => [s.key, s.label])) as Record<string, string>,
    [],
  );

  const selectedCount = useMemo(
    () => PDF_SECTIONS.filter(s => sections[s.key]).length,
    [sections],
  );
  const allSelected = selectedCount === PDF_SECTIONS.length;
  const isDefaultOrder = useMemo(
    () => order.every((k, i) => k === PDF_SECTIONS[i]?.key),
    [order],
  );

  const toggle = (key: string) =>
    setSections(prev => ({ ...prev, [key]: !prev[key] }));

  const setAll = (value: boolean) =>
    setSections(() => {
      const next: Record<string, boolean> = {};
      for (const s of PDF_SECTIONS) next[s.key] = value;
      return next;
    });

  /** Déplace une section d'un cran (delta = -1 monter, +1 descendre). */
  const move = (index: number, delta: number) =>
    setOrder(prev => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const handleConfirm = () => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(sections));
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    } catch {
      /* persistance best-effort */
    }
    onConfirm({
      sections,
      order,
      redacteur: redacteur.trim() || undefined,
      destinataire: destinataire.trim() || undefined,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isExporting && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-[#16307A]" />
            Options d'export PDF
          </DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Choisissez les sections à inclure, leur ordre d'apparition et les mentions d'en-tête, puis générez le rapport.
          </DialogDescription>
        </DialogHeader>

        {/* En-tête du rapport */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs text-gray-600">Rédigé par</Label>
            <Input
              value={redacteur}
              onChange={(e) => setRedacteur(e.target.value)}
              placeholder="Nom du rédacteur"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-600">À destination du</Label>
            <Input
              value={destinataire}
              onChange={(e) => setDestinataire(e.target.value)}
              placeholder="Destinataire"
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Sélection et ordre des sections */}
        <div className="flex items-center justify-between border-t pt-2 mt-1">
          <span className="text-xs font-medium text-gray-700">
            Sections ({selectedCount}/{PDF_SECTIONS.length})
          </span>
          <div className="flex items-center gap-3">
            {!isDefaultOrder && (
              <button
                type="button"
                onClick={() => setOrder(resolveSectionOrder())}
                className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline"
                title="Rétablir l'ordre par défaut"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Ordre par défaut
              </button>
            )}
            <button
              type="button"
              onClick={() => setAll(!allSelected)}
              className="inline-flex items-center gap-1 text-xs text-[#16307A] hover:underline"
            >
              {allSelected ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
              {allSelected ? 'Tout décocher' : 'Tout cocher'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 -mt-1">
          Les flèches déterminent l'ordre des sections dans le PDF.
        </p>

        <div className="grid grid-cols-1 gap-1.5 max-h-[38vh] overflow-y-auto pr-1">
          {order.map((key, index) => (
            <div
              key={key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50"
            >
              <span className="w-5 shrink-0 text-[11px] tabular-nums text-gray-400 text-right">
                {index + 1}
              </span>
              <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
                <Checkbox checked={!!sections[key]} onCheckedChange={() => toggle(key)} />
                <span className={`text-sm truncate ${sections[key] ? 'text-gray-700' : 'text-gray-400'}`}>
                  {labelByKey[key]}
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Monter « ${labelByKey[key]} »`}
                  className="p-1 rounded text-gray-400 hover:text-[#16307A] hover:bg-gray-100 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === order.length - 1}
                  aria-label={`Descendre « ${labelByKey[key]} »`}
                  className="p-1 rounded text-gray-400 hover:text-[#16307A] hover:bg-gray-100 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            Annuler
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isExporting || selectedCount === 0}
            className="bg-[#16307A] hover:bg-[#0C1740] text-white"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Génération…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />
                Générer le PDF
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
