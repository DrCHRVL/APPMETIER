// components/modals/DataSyncConflictModal.tsx

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { SyncConflict, ConflictAction } from '@/types/dataSyncTypes';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Calendar,
  Users,
  RefreshCw,
  Check,
  X
} from 'lucide-react';
import { Select } from '../ui/select';

interface ConflictSelection {
  enabled: boolean;
  action: ConflictAction;
}

interface DataSyncConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: SyncConflict[];
  onResolve: (selections: Map<number, ConflictAction>) => void;
}

export const DataSyncConflictModal = ({
  isOpen,
  onClose,
  conflicts,
  onResolve
}: DataSyncConflictModalProps) => {
  
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  
  // État de sélection : par défaut tout coché avec "merge"
  const [selections, setSelections] = useState<Map<number, ConflictSelection>>(() => {
    const initial = new Map();
    conflicts.forEach((conflict, index) => {
      initial.set(index, { enabled: true, action: 'merge' });
    });
    return initial;
  });

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleEnabled = (index: number) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = next.get(index) || { enabled: true, action: 'merge' };
      next.set(index, {
        ...current,
        enabled: !current.enabled,
        // Si on décoche, garder la version locale par défaut
        action: current.enabled ? 'keep_local' : 'merge'
      });
      return next;
    });
  };

  const setAction = (index: number, action: ConflictAction) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = next.get(index) || { enabled: false, action: 'skip' };
      next.set(index, { ...current, action });
      return next;
    });
  };

  const toggleAll = (enabled: boolean) => {
    setSelections(prev => {
      const next = new Map(prev);
      conflicts.forEach((_, index) => {
        next.set(index, { enabled, action: enabled ? 'merge' : 'keep_local' });
      });
      return next;
    });
  };

  const handleApply = () => {
    const result = new Map<number, ConflictAction>();
    selections.forEach((selection, index) => {
      if (selection.enabled) {
        result.set(index, 'merge');
      } else {
        result.set(index, selection.action);
      }
    });
    onResolve(result);
  };

  const getConflictTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      'enquete_deleted': 'Enquête supprimée sur le serveur',
    };
    return labels[type] || 'Conflit';
  };

  const allChecked = Array.from(selections.values()).every(s => s.enabled);
  const someChecked = Array.from(selections.values()).some(s => s.enabled);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0 border-b pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            Conflits de synchronisation
          </DialogTitle>
          <p className="text-sm text-gray-600 mt-2">
            {conflicts.length} conflit(s) détecté(s) - Sélectionnez ce que vous souhaitez faire
          </p>
        </DialogHeader>

        {/* Actions rapides */}
        <div className="flex-shrink-0 flex items-center justify-between py-3 border-b bg-gray-50 -mx-6 px-6">
          <div className="flex items-center gap-3">
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => toggleAll(true)}
              className="text-xs"
            >
              <Check className="h-3 w-3 mr-1" />
              Tout cocher
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => toggleAll(false)}
              className="text-xs"
            >
              <X className="h-3 w-3 mr-1" />
              Tout décocher
            </Button>
          </div>
          <div className="text-xs text-gray-600">
            {Array.from(selections.values()).filter(s => s.enabled).length} / {conflicts.length} sélectionné(s)
          </div>
        </div>

        {/* Liste des conflits */}
        <div className="flex-1 overflow-auto space-y-2 py-4">
          {conflicts.map((conflict, index) => {
            const conflictId = `conflict-${index}`;
            const isExpanded = expandedItems.has(conflictId);
            const selection = selections.get(index) || { enabled: true, action: 'merge' };
            
            return (
              <div 
                key={conflictId}
                className="border rounded-lg bg-white hover:shadow-sm transition-shadow"
              >
                {/* En-tête avec checkbox */}
                <div className="p-3">
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <div className="flex items-center pt-1">
                      <input
                        type="checkbox"
                        checked={selection.enabled}
                        onChange={() => toggleEnabled(index)}
                        className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                      />
                    </div>

                    {/* Contenu */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => toggleExpand(conflictId)}
                          className="hover:bg-gray-100 rounded p-0.5 flex-shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        
                        <span className="font-semibold text-sm">
                          {conflict.enqueteNumero || 'Configuration'}
                        </span>
                        
                        <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800">
                          {getConflictTypeLabel(conflict.type)}
                        </span>
                      </div>
                      
                      {/* Résumé des conflits */}
                      {!isExpanded && conflict.details.length > 0 && (
                        <div className="text-xs text-gray-600 ml-6">
                          {conflict.details[0]}
                          {conflict.details.length > 1 && ` (+${conflict.details.length - 1} autre(s))`}
                        </div>
                      )}

                      {/* Timestamps */}
                      {(conflict.localTimestamp || conflict.serverTimestamp) && (
                        <div className="flex gap-4 text-xs text-gray-500 mt-1 ml-6">
                          {conflict.localTimestamp && (
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              Local: {new Date(conflict.localTimestamp).toLocaleString('fr-FR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          )}
                          {conflict.serverTimestamp && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Serveur: {new Date(conflict.serverTimestamp).toLocaleString('fr-FR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Mode de résolution si décoché */}
                      {!selection.enabled && (
                        <div className="mt-2 ml-6 flex items-center gap-2">
                          <span className="text-xs text-gray-600">Action :</span>
                          <Select
                            value={selection.action}
                            onChange={(e) => setAction(index, e.target.value as ConflictAction)}
                            className="text-xs h-7 w-56"
                          >
                            <option value="keep_local">💾 Garder ma version locale</option>
                            <option value="keep_server">☁️ Prendre la version serveur</option>
                          </Select>
                        </div>
                      )}

                      {/* Si coché, afficher "Fusionner" */}
                      {selection.enabled && (
                        <div className="mt-2 ml-6 flex items-center gap-2 text-xs text-green-700">
                          <RefreshCw className="h-3 w-3" />
                          <span className="font-medium">Fusion intelligente</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Détails expandus */}
                {isExpanded && (
                  <div className="border-t bg-gray-50 p-3">
                    <div className="space-y-1 ml-9">
                      {conflict.details.map((detail, detailIndex) => (
                        <div key={detailIndex} className="flex items-start text-sm">
                          <span className="text-orange-500 mr-2">•</span>
                          <span className="text-gray-700">{detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Info fusion */}
        <div className="flex-shrink-0 bg-green-50 border border-green-200 rounded-lg p-3 -mx-6 mx-6 mb-4">
          <div className="flex items-start gap-2">
            <RefreshCw className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-green-800">
              <strong>Fusion intelligente (par défaut)</strong>
              <p className="mt-1">
                Conserve les nouveautés des deux côtés et fusionne automatiquement 
                les modifications compatibles. Décochez pour choisir une autre action.
              </p>
            </div>
          </div>
        </div>

        {/* Actions finales */}
        <div className="flex-shrink-0 flex justify-between items-center pt-4 border-t">
          <div className="text-sm text-gray-600">
            {Array.from(selections.values()).filter(s => s.enabled).length} enquête(s) seront fusionnées
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button 
              onClick={handleApply}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="h-4 w-4 mr-2" />
              Appliquer ma sélection
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};