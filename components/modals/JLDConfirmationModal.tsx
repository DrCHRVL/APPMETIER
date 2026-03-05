// components/modals/JLDConfirmationModal.tsx

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { FileText, Phone, Calendar, Users } from 'lucide-react';

interface JLDConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  fileName: string;
  phoneCount: number;
  tribunal: string;
  signatureDate: string;
}

export const JLDConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  fileName,
  phoneCount,
  tribunal,
  signatureDate
}: JLDConfirmationModalProps) => {
  
  const formatDate = (dateStr: string): string => {
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR');
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-blue-600" />
            Ordonnance JLD détectée
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Informations du document */}
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-blue-900 mb-2">Document analysé</h3>
                <div className="space-y-1 text-sm text-blue-800">
                  <p><strong>Fichier :</strong> {fileName}</p>
                  <p><strong>Tribunal :</strong> {tribunal}</p>
                  <p><strong>Date :</strong> {formatDate(signatureDate)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Résultats de l'analyse */}
          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="flex items-start gap-3">
              <Users className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-green-900 mb-2">Écoutes détectées</h3>
                <div className="space-y-1 text-sm text-green-800">
                  <p><strong>{phoneCount}</strong> numéros de téléphone trouvés</p>
                  <p>Autorisation d'interception téléphonique</p>
                </div>
              </div>
            </div>
          </div>

          {/* Question principale */}
          <div className="text-center py-2">
            <p className="text-lg font-medium text-gray-900 mb-2">
              Créer automatiquement les écoutes ?
            </p>
            <p className="text-sm text-gray-600">
              Chaque numéro sera créé comme une nouvelle écoute avec les données pré-remplies.
              Vous pourrez les modifier individuellement ensuite.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Non, continuer normalement
          </Button>
          <Button onClick={onConfirm} className="bg-blue-600 hover:bg-blue-700">
            Oui, créer les écoutes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
