"use client"

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { GripVertical, ChevronUp, ChevronDown, Eye, EyeOff } from 'lucide-react';

interface SectionOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: string[];
  activeSections: string[];
  onReorder: (name: string, direction: 'up' | 'down') => Promise<boolean>;
  onAddSection: (name: string) => Promise<boolean>;
}

export const SectionOrderModal = ({
  isOpen,
  onClose,
  sections,
  activeSections,
  onReorder,
  onAddSection
}: SectionOrderModalProps) => {
  // Fusionner : sections sauvegardées + sections actives non encore enregistrées
  const [orderedSections, setOrderedSections] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    // Construire la liste complète : sections sauvegardées en premier,
    // puis les sections actives qui ne sont pas encore dans l'ordre sauvegardé
    const known = new Set(sections);
    const missing = activeSections.filter(s => !known.has(s) && s !== 'AUTRES SERVICES');
    setOrderedSections([...sections, ...missing]);
  }, [sections, activeSections, isOpen]);

  const handleMoveUp = async (index: number) => {
    if (index === 0) return;
    const name = orderedSections[index];
    // Si la section n'est pas encore dans les sections sauvegardées, l'ajouter d'abord
    if (!sections.includes(name)) {
      await onAddSection(name);
    }
    await onReorder(name, 'up');
  };

  const handleMoveDown = async (index: number) => {
    if (index === orderedSections.length - 1) return;
    const name = orderedSections[index];
    if (!sections.includes(name)) {
      await onAddSection(name);
    }
    await onReorder(name, 'down');
  };

  // Drag and drop
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = useCallback(async (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const name = orderedSections[draggedIndex];

    // S'assurer que la section est enregistrée
    if (!sections.includes(name)) {
      await onAddSection(name);
    }

    // Calculer les déplacements nécessaires
    const direction = targetIndex < draggedIndex ? 'up' : 'down';
    const steps = Math.abs(targetIndex - draggedIndex);

    for (let i = 0; i < steps; i++) {
      await onReorder(name, direction);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [draggedIndex, orderedSections, sections, onAddSection, onReorder]);

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Compter les enquêtes par section (on affiche le statut "active" ou non)
  const isActive = (section: string) => activeSections.includes(section);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Ordre des colonnes</DialogTitle>
          <DialogDescription className="text-xs text-gray-500">
            Glissez-déposez ou utilisez les flèches pour réordonner les colonnes de la grille d'enquêtes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 max-h-[60vh] overflow-y-auto py-2">
          {orderedSections.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">
              Aucune section configurée.<br />
              Les sections sont créées automatiquement lorsque vous organisez vos services.
            </div>
          ) : (
            orderedSections.map((section, index) => {
              const active = isActive(section);
              const isDragged = draggedIndex === index;
              const isDragOver = dragOverIndex === index && draggedIndex !== index;

              return (
                <div
                  key={section}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={handleDragEnd}
                  className={`
                    flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all
                    ${isDragged ? 'opacity-40 scale-95' : ''}
                    ${isDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'}
                    ${!active ? 'opacity-60' : ''}
                    hover:border-gray-300 cursor-grab active:cursor-grabbing
                  `}
                >
                  {/* Poignée de drag */}
                  <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />

                  {/* Numéro de position */}
                  <span className="text-xs font-bold text-gray-400 w-5 text-center flex-shrink-0">
                    {index + 1}
                  </span>

                  {/* Nom de la section */}
                  <span className={`flex-1 text-sm font-medium ${active ? 'text-gray-800' : 'text-gray-400'}`}>
                    {section}
                  </span>

                  {/* Indicateur actif/inactif */}
                  {active ? (
                    <Eye className="h-3.5 w-3.5 text-green-500 flex-shrink-0" title="Section visible (contient des enquêtes)" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" title="Section vide (aucune enquête)" />
                  )}

                  {/* Boutons de déplacement */}
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      disabled={index === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveUp(index);
                      }}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      disabled={index === orderedSections.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveDown(index);
                      }}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="text-[10px] text-gray-400 leading-tight pt-1 border-t border-gray-100">
          Les colonnes avec l'icône <Eye className="h-3 w-3 inline text-green-500" /> contiennent des enquêtes actives.
          Les autres sont vides mais conservent leur position.
        </div>
      </DialogContent>
    </Dialog>
  );
};
