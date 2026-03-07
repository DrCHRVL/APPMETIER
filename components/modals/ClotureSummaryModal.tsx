import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Enquete } from '@/types/interfaces';
import { Copy, Check } from 'lucide-react';

interface ClotureSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
}

export const ClotureSummaryModal = ({ isOpen, onClose, enquete }: ClotureSummaryModalProps) => {
  const [copied, setCopied] = useState(false);

  const generatedText = useMemo(() => {
    const ecoutes = enquete.ecoutes || [];
    const geolocalisations = enquete.geolocalisations || [];

    const ecoutesLines = ecoutes.length > 0
      ? ecoutes.map(e => `* ${e.numero}${e.cible ? ` (${e.cible})` : ''}`).join('\n')
      : '* (aucune interception renseignée)';

    const geolocsLines = geolocalisations.length > 0
      ? geolocalisations.map(g => `* ${g.objet}`).join('\n')
      : '* (aucune géolocalisation renseignée)';

    return `METTONS A DISPOSITION les pièces correspondant aux interceptions de correspondance des lignes suivantes :
${ecoutesLines}

METTONS A DISPOSITION les pièces correspondant aux géolocalisations des objets suivants :
${geolocsLines}

Auprès de Monsieur le juge des libertés et de la détention et le prions de bien vouloir nous en faire retour revêtu de son visa.`;
  }, [enquete.ecoutes, enquete.geolocalisations]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-white">
        <DialogHeader>
          <DialogTitle className="text-base">
            Récapitulatif de clôture — Enquête N° {enquete.numero}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Copiez ce texte et collez-le dans votre document de mise à disposition JLD.
          </p>

          <textarea
            readOnly
            value={generatedText}
            className="w-full h-64 p-3 text-sm font-mono border border-gray-200 rounded-lg bg-gray-50 resize-none focus:outline-none"
          />

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Fermer
            </Button>
            <Button size="sm" onClick={handleCopy} className="gap-2">
              {copied ? (
                <>
                  <Check className="h-4 w-4" />
                  Copié !
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copier
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
