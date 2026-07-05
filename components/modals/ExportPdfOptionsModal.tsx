'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { FileText, Loader2, CheckSquare, Square } from 'lucide-react';
import { PDF_SECTIONS, type PdfExportOptions } from '@/utils/generateStatsPdf';

interface ExportPdfOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: PdfExportOptions) => void;
  isExporting: boolean;
  defaultRedacteur?: string;
}

const PREFS_KEY = 'pdf_export_prefs_v1';

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
  const [redacteur, setRedacteur] = useState(defaultRedacteur);
  const [destinataire, setDestinataire] = useState('Procureur de la République');

  const selectedCount = useMemo(
    () => PDF_SECTIONS.filter(s => sections[s.key]).length,
    [sections],
  );
  const allSelected = selectedCount === PDF_SECTIONS.length;

  const toggle = (key: string) =>
    setSections(prev => ({ ...prev, [key]: !prev[key] }));

  const setAll = (value: boolean) =>
    setSections(() => {
      const next: Record<string, boolean> = {};
      for (const s of PDF_SECTIONS) next[s.key] = value;
      return next;
    });

  const handleConfirm = () => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(sections));
    } catch {
      /* persistance best-effort */
    }
    onConfirm({
      sections,
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
            Choisissez les sections à inclure et les mentions d'en-tête, puis générez le rapport.
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

        {/* Sélection des sections */}
        <div className="flex items-center justify-between border-t pt-2 mt-1">
          <span className="text-xs font-medium text-gray-700">
            Sections ({selectedCount}/{PDF_SECTIONS.length})
          </span>
          <button
            type="button"
            onClick={() => setAll(!allSelected)}
            className="inline-flex items-center gap-1 text-xs text-[#16307A] hover:underline"
          >
            {allSelected ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
            {allSelected ? 'Tout décocher' : 'Tout cocher'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-1.5 max-h-[38vh] overflow-y-auto pr-1">
          {PDF_SECTIONS.map(s => (
            <label
              key={s.key}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer"
            >
              <Checkbox checked={!!sections[s.key]} onCheckedChange={() => toggle(s.key)} />
              <span className="text-sm text-gray-700">{s.label}</span>
            </label>
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
