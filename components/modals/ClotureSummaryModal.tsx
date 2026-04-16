import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Enquete } from '@/types/interfaces';
import { Copy, Check, Pencil, RotateCcw } from 'lucide-react';
import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';

interface ClotureTemplate {
  beforeEcoutes: string;
  beforeGeolocs: string;
  footer: string;
}

const DEFAULT_TEMPLATE: ClotureTemplate = {
  beforeEcoutes: 'METTONS A DISPOSITION les pièces correspondant aux interceptions de correspondance des lignes suivantes :',
  beforeGeolocs: 'METTONS A DISPOSITION les pièces correspondant aux géolocalisations des objets suivants :',
  footer: 'Auprès de Monsieur le juge des libertés et de la détention et le prions de bien vouloir nous en faire retour revêtu de son visa.',
};

interface ClotureSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
}

export const ClotureSummaryModal = ({ isOpen, onClose, enquete }: ClotureSummaryModalProps) => {
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState<ClotureTemplate>(DEFAULT_TEMPLATE);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ClotureTemplate | null>(null);
  const [showConfirmEdit, setShowConfirmEdit] = useState(false);

  // Charger la trame sauvegardée à l'ouverture du modal
  useEffect(() => {
    if (isOpen) {
      ElectronBridge.getData<ClotureTemplate>(APP_CONFIG.STORAGE_KEYS.CLOTURE_TEMPLATE, DEFAULT_TEMPLATE)
        .then((saved) => {
          setTemplate(saved);
          setTemplateLoaded(true);
        });
    } else {
      // Reset des états d'édition à la fermeture
      setEditingTemplate(null);
      setShowConfirmEdit(false);
      setCopied(false);
    }
  }, [isOpen]);

  const generatedText = useMemo(() => {
    if (!templateLoaded) return '';
    const ecoutes = enquete.ecoutes || [];
    const geolocalisations = enquete.geolocalisations || [];

    const ecoutesLines = ecoutes.length > 0
      ? ecoutes.map(e => `* ${e.numero}${e.cible ? ` (${e.cible})` : ''}`).join('\n')
      : '* (aucune interception renseignée)';

    const geolocsLines = geolocalisations.length > 0
      ? geolocalisations.map(g => `* ${g.objet}`).join('\n')
      : '* (aucune géolocalisation renseignée)';

    return `${template.beforeEcoutes}\n${ecoutesLines}\n\n${template.beforeGeolocs}\n${geolocsLines}\n\n${template.footer}`;
  }, [enquete.ecoutes, enquete.geolocalisations, template, templateLoaded]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSaveTemplate = useCallback(async () => {
    if (!editingTemplate) return;
    await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.CLOTURE_TEMPLATE, editingTemplate);
    setTemplate(editingTemplate);
    setEditingTemplate(null);
  }, [editingTemplate]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-white relative">
        <DialogHeader>
          <DialogTitle className="text-base">
            Récapitulatif de clôture — Enquête N° {enquete.numero}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {editingTemplate ? (
            // ── VUE ÉDITEUR ──
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Modifiez le texte de la trame. Les listes (écoutes, géolocalisations) sont insérées automatiquement.
              </p>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Texte avant la liste des interceptions :
                </label>
                <textarea
                  value={editingTemplate.beforeEcoutes}
                  onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, beforeEcoutes: e.target.value } : prev)}
                  className="w-full h-20 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-xs text-gray-400 mt-1 italic">
                  ↓ Liste des écoutes (générée automatiquement)
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Texte avant la liste des géolocalisations :
                </label>
                <textarea
                  value={editingTemplate.beforeGeolocs}
                  onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, beforeGeolocs: e.target.value } : prev)}
                  className="w-full h-20 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="text-xs text-gray-400 mt-1 italic">
                  ↓ Liste des géolocalisations (générée automatiquement)
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Texte de clôture :
                </label>
                <textarea
                  value={editingTemplate.footer}
                  onChange={(e) => setEditingTemplate(prev => prev ? { ...prev, footer: e.target.value } : prev)}
                  className="w-full h-20 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 gap-1"
                  onClick={() => setEditingTemplate({ ...DEFAULT_TEMPLATE })}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Réinitialiser
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingTemplate(null)}>
                    Annuler
                  </Button>
                  <Button size="sm" onClick={handleSaveTemplate}>
                    Enregistrer la trame
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            // ── VUE NORMALE ──
            <>
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500">
                  Copiez ce texte et collez-le dans votre document de mise à disposition JLD.
                </p>
                <button
                  type="button"
                  title="Modifier la trame de rédaction"
                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                  onClick={() => setShowConfirmEdit(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

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
            </>
          )}
        </div>

        {/* Overlay de confirmation */}
        {showConfirmEdit && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 rounded-lg">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-5 max-w-xs text-center space-y-3">
              <p className="text-sm font-medium text-gray-800">
                Voulez-vous changer la trame de rédaction ?
              </p>
              <p className="text-xs text-gray-500">
                Vous pourrez modifier le texte autour des listes dynamiques.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowConfirmEdit(false)}>
                  Non
                </Button>
                <Button size="sm" onClick={() => {
                  setShowConfirmEdit(false);
                  setEditingTemplate({ ...template });
                }}>
                  Oui
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
