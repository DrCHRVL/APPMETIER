import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Enquete } from '@/types/interfaces';
import { Copy, Check, Pencil, RotateCcw, FileDown } from 'lucide-react';
import { ElectronBridge } from '@/utils/electronBridge';
import { copyPlainToClipboard, downloadAsDocx } from '@/utils/richTextExport';
import { APP_CONFIG } from '@/config/constants';
import {
  ClotureTemplate,
  DEFAULT_CLOTURE_TEMPLATE,
  mergeClotureTemplate,
  buildClotureText,
  buildClotureHtml,
  clotureFileName,
  formatDateLong,
} from '@/utils/clotureDocument';

interface ClotureSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
}

/** Définition d'un champ éditable de la trame. */
type TemplateField = {
  key: keyof ClotureTemplate;
  label: string;
  multiline?: boolean;
};

const FIELD_GROUPS: { title: string; fields: TemplateField[] }[] = [
  {
    title: 'En-tête',
    fields: [
      { key: 'enteteJuridiction', label: 'Juridiction' },
      { key: 'enteteParquet', label: 'Parquet' },
      { key: 'enteteService', label: 'Service / section' },
    ],
  },
  {
    title: 'Objet',
    fields: [
      { key: 'titre', label: 'Titre' },
      { key: 'sousTitre', label: 'Sous-titre' },
      { key: 'reference', label: 'Référence (article)' },
    ],
  },
  {
    title: 'Corps',
    fields: [
      { key: 'qualiteMagistrat', label: 'Qualité du magistrat', multiline: true },
      { key: 'visa', label: 'Visa des textes', multiline: true },
      { key: 'beforeEcoutes', label: 'Texte avant la liste des interceptions', multiline: true },
      { key: 'beforeGeolocs', label: 'Texte avant la liste des géolocalisations', multiline: true },
      { key: 'footer', label: 'Formule de retour', multiline: true },
    ],
  },
  {
    title: 'Signature',
    fields: [
      { key: 'lieu', label: 'Lieu' },
      { key: 'signataire', label: 'Signataire' },
    ],
  },
];

export const ClotureSummaryModal = ({ isOpen, onClose, enquete }: ClotureSummaryModalProps) => {
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState<ClotureTemplate>(DEFAULT_CLOTURE_TEMPLATE);
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ClotureTemplate | null>(null);
  // Snapshot du template au début de l'édition pour détecter si l'utilisateur a modifié
  const [editingSnapshot, setEditingSnapshot] = useState<ClotureTemplate | null>(null);
  const [showConfirmEdit, setShowConfirmEdit] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  // Charger la trame sauvegardée à l'ouverture du modal (fusion rétro-compatible)
  useEffect(() => {
    if (isOpen) {
      ElectronBridge.getData<Partial<ClotureTemplate>>(
        APP_CONFIG.STORAGE_KEYS.CLOTURE_TEMPLATE,
        DEFAULT_CLOTURE_TEMPLATE,
      ).then((saved) => {
        setTemplate(mergeClotureTemplate(saved));
        setTemplateLoaded(true);
      });
    } else {
      // Reset des états d'édition à la fermeture
      setEditingTemplate(null);
      setEditingSnapshot(null);
      setShowConfirmEdit(false);
      setShowConfirmReset(false);
      setShowConfirmDiscard(false);
      setCopied(false);
    }
  }, [isOpen]);

  // Détecte si la trame en cours d'édition a été modifiée par rapport au snapshot de départ
  const isEditingDirty = useMemo(() => {
    if (!editingTemplate || !editingSnapshot) return false;
    return (Object.keys(editingTemplate) as (keyof ClotureTemplate)[]).some(
      (k) => editingTemplate[k] !== editingSnapshot[k],
    );
  }, [editingTemplate, editingSnapshot]);

  // Intercepte la fermeture si des modifs non sauvées existent
  const handleDialogClose = useCallback(() => {
    if (editingTemplate && isEditingDirty) {
      setShowConfirmDiscard(true);
      return;
    }
    onClose();
  }, [editingTemplate, isEditingDirty, onClose]);

  const generatedText = useMemo(() => {
    if (!templateLoaded) return '';
    return buildClotureText(template, enquete);
  }, [template, enquete, templateLoaded]);

  const handleCopy = async () => {
    const ok = await copyPlainToClipboard(generatedText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadDocx = async () => {
    const html = buildClotureHtml(template, enquete, formatDateLong());
    await downloadAsDocx(
      html,
      clotureFileName(enquete),
      `Soit-transmis JLD — Enquête ${enquete.numero}`,
    );
  };

  const handleSaveTemplate = useCallback(async () => {
    if (!editingTemplate) return;
    await ElectronBridge.setData(APP_CONFIG.STORAGE_KEYS.CLOTURE_TEMPLATE, editingTemplate);
    setTemplate(editingTemplate);
    setEditingTemplate(null);
    setEditingSnapshot(null);
  }, [editingTemplate]);

  const handleCancelEdit = useCallback(() => {
    if (isEditingDirty) {
      setShowConfirmDiscard(true);
      return;
    }
    setEditingTemplate(null);
    setEditingSnapshot(null);
  }, [isEditingDirty]);

  const setField = (key: keyof ClotureTemplate, value: string) =>
    setEditingTemplate((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <Dialog open={isOpen} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-2xl bg-white max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Récapitulatif de clôture — Enquête N° {enquete.numero}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {editingTemplate ? (
            // ── VUE ÉDITEUR ──
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Modifiez les libellés fixes de la trame. Les listes (écoutes, géolocalisations),
                le numéro d'enquête et la date sont insérés automatiquement.
              </p>

              {FIELD_GROUPS.map((group) => (
                <div key={group.title} className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {group.title}
                  </h4>
                  {group.fields.map((field) => (
                    <div key={field.key}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {field.label}
                      </label>
                      {field.multiline ? (
                        <textarea
                          value={editingTemplate[field.key]}
                          onChange={(e) => setField(field.key, e.target.value)}
                          className="w-full h-16 p-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <input
                          type="text"
                          value={editingTemplate[field.key]}
                          onChange={(e) => setField(field.key, e.target.value)}
                          className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}

              <div className="flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-500 gap-1"
                  onClick={() => setShowConfirmReset(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Réinitialiser
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelEdit}>
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
                  Aperçu du soit-transmis. Téléchargez-le en Word ou copiez le texte.
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
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
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
                <Button size="sm" onClick={handleDownloadDocx} className="gap-2">
                  <FileDown className="h-4 w-4" />
                  Télécharger Word
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Overlay de confirmation — ouverture éditeur */}
        {showConfirmEdit && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 rounded-lg">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-5 max-w-xs text-center space-y-3">
              <p className="text-sm font-medium text-gray-800">
                Voulez-vous changer la trame de rédaction ?
              </p>
              <p className="text-xs text-gray-500">
                Vous pourrez modifier les libellés fixes autour des listes dynamiques.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowConfirmEdit(false)}>
                  Annuler
                </Button>
                <Button size="sm" onClick={() => {
                  setShowConfirmEdit(false);
                  setEditingTemplate({ ...template });
                  setEditingSnapshot({ ...template });
                }}>
                  Confirmer
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Overlay de confirmation — réinitialisation de la trame */}
        {showConfirmReset && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 rounded-lg">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-5 max-w-xs text-center space-y-3">
              <p className="text-sm font-medium text-gray-800">
                Réinitialiser la trame ?
              </p>
              <p className="text-xs text-gray-500">
                Vos modifications en cours seront perdues et la trame reviendra aux textes d'origine.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowConfirmReset(false)}>
                  Annuler
                </Button>
                <Button variant="destructive" size="sm" onClick={() => {
                  setEditingTemplate({ ...DEFAULT_CLOTURE_TEMPLATE });
                  setShowConfirmReset(false);
                }}>
                  Réinitialiser
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Overlay de confirmation — abandon des modifications */}
        {showConfirmDiscard && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 rounded-lg">
            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-5 max-w-xs text-center space-y-3">
              <p className="text-sm font-medium text-gray-800">
                Abandonner vos modifications ?
              </p>
              <p className="text-xs text-gray-500">
                Les changements apportés à la trame ne seront pas enregistrés.
              </p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setShowConfirmDiscard(false)}>
                  Continuer l'édition
                </Button>
                <Button variant="destructive" size="sm" onClick={() => {
                  setEditingTemplate(null);
                  setEditingSnapshot(null);
                  setShowConfirmDiscard(false);
                  onClose();
                }}>
                  Abandonner
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
