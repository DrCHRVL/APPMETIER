import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, AlertTriangle } from 'lucide-react';

interface SimpleJLDConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  fileName: string;
}

export const SimpleJLDConfirmationModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  fileName 
}: SimpleJLDConfirmationModalProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Document PDF détecté
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <AlertTriangle className="h-5 w-5 text-blue-600" />
            <div className="flex-1">
              <p className="font-medium text-blue-800">
                Fichier : {fileName}
              </p>
              <p className="text-sm text-blue-700">
                Ce PDF pourrait être une ordonnance JLD
              </p>
            </div>
          </div>
          
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              S'agit-il d'une ordonnance JLD ?
            </h3>
            <p className="text-sm text-gray-600">
              Si oui, nous analyserons automatiquement le document pour extraire les numéros de téléphone et créer les écoutes.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1"
          >
            Non, document normal
          </Button>
          <Button 
            onClick={onConfirm}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            Oui, ordonnance JLD
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
