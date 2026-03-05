import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { AlertTriangle } from 'lucide-react';

interface DeleteInstructionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  instructionNumero: string;
}

export const DeleteInstructionModal = ({
  isOpen,
  onClose,
  onConfirm,
  instructionNumero
}: DeleteInstructionModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            Supprimer le dossier d'instruction
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-medium text-red-800 mb-1">
                  Action irréversible
                </h3>
                <p className="text-sm text-red-700">
                  Cette action supprimera définitivement le dossier d'instruction et toutes ses données associées.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Vous êtes sur le point de supprimer le dossier d'instruction :
            </p>
            
            <div className="bg-gray-50 border rounded-lg p-3">
              <div className="font-medium text-gray-900">{instructionNumero}</div>
            </div>

            <div className="text-sm text-gray-600">
              <p className="font-medium mb-2">Les données suivantes seront perdues :</p>
              <ul className="list-disc list-inside space-y-1 text-xs text-gray-500">
                <li>Tous les comptes-rendus</li>
                <li>Les DML et leur suivi</li>
                <li>Les mesures de sûreté (DP, CJ, ARSE)</li>
                <li>Les débats parquet</li>
                <li>Les données RD et rapport d'appel</li>
                <li>Tous les documents associés</li>
                <li>L'historique complet du dossier</li>
              </ul>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                <strong>Recommandation :</strong> Avant de supprimer, assurez-vous d'avoir exporté 
                ou sauvegardé toutes les données importantes de ce dossier.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="px-4"
          >
            Annuler
          </Button>
          <Button 
            variant="destructive" 
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 bg-red-600 hover:bg-red-700"
          >
            Supprimer définitivement
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};