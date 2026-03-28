import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Copy, Check, Flag } from 'lucide-react';
import { Tag, ToDoItem } from '@/types/interfaces';

type SuiviType = 'JIRS' | 'PG';

interface SuiviAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  enqueteNumero: string;
  enqueteTags: Tag[];
  /** Contexte de déclenchement */
  triggerContext: 'dateOP' | 'archive' | 'audience';
  /** Callback pour créer un todo général */
  onCreateTodo?: (todo: ToDoItem) => void;
}

const TRIGGER_LABELS: Record<string, string> = {
  dateOP: 'Enregistrement d\'une date d\'OP',
  archive: 'Archivage de l\'enquête',
  audience: 'Enregistrement des résultats d\'audience',
};

const TRIGGER_ACTION: Record<string, string> = {
  dateOP: 'un mail d\'actualisation',
  archive: 'un mail de clôture',
  audience: 'un mail de résultats',
};

export const SuiviAlertModal = ({
  isOpen,
  onClose,
  enqueteNumero,
  enqueteTags,
  triggerContext,
  onCreateTodo,
}: SuiviAlertModalProps) => {
  const [copied, setCopied] = useState(false);
  const [todoCreated, setTodoCreated] = useState(false);

  const suiviTypes = useMemo(() => {
    const types: SuiviType[] = [];
    if (enqueteTags.some(t => t.category === 'suivi' && t.value === 'JIRS')) types.push('JIRS');
    if (enqueteTags.some(t => t.category === 'suivi' && t.value === 'PG')) types.push('PG');
    return types;
  }, [enqueteTags]);

  const destinataires = suiviTypes.join(' et ');

  const mailTemplate = useMemo(() => {
    const date = new Date().toLocaleDateString('fr-FR');
    const action = TRIGGER_ACTION[triggerContext] || 'un mail';

    if (triggerContext === 'dateOP') {
      return `Objet : Actualisation — Dossier ${enqueteNumero}

${destinataires},

Je me permets de vous informer de l'actualisation du dossier ${enqueteNumero}.

Une date d'opération a été fixée.

Je reste à votre disposition pour tout complément d'information.

Fait le ${date}`;
    }

    if (triggerContext === 'archive') {
      return `Objet : Clôture — Dossier ${enqueteNumero}

${destinataires},

Je me permets de vous informer de la clôture du dossier ${enqueteNumero}.

Le dossier a été archivé.

Je reste à votre disposition pour tout complément d'information.

Fait le ${date}`;
    }

    if (triggerContext === 'audience') {
      return `Objet : Résultats d'audience — Dossier ${enqueteNumero}

${destinataires},

Je me permets de vous informer des résultats d'audience du dossier ${enqueteNumero}.

Les résultats d'audience ont été enregistrés.

Je reste à votre disposition pour tout complément d'information.

Fait le ${date}`;
    }

    return '';
  }, [triggerContext, enqueteNumero, destinataires]);

  const handleCopy = () => {
    navigator.clipboard.writeText(mailTemplate).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCreateTodo = () => {
    if (!onCreateTodo) return;
    const todoText = `Aviser ${destinataires} sur ${enqueteNumero}`;
    const newTodo: ToDoItem = {
      id: Date.now(),
      text: todoText,
      status: 'active',
      dateCreation: new Date().toISOString(),
    };
    onCreateTodo(newTodo);
    setTodoCreated(true);
  };

  const handleClose = () => {
    setCopied(false);
    setTodoCreated(false);
    onClose();
  };

  if (suiviTypes.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Flag className="h-4 w-4 text-amber-500" />
            Dossier suivi — Rappel
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm font-medium text-amber-800">
              {TRIGGER_LABELS[triggerContext]}
            </p>
            <p className="text-sm text-amber-700 mt-1">
              Ce dossier est suivi par{' '}
              {suiviTypes.map((type, i) => (
                <span key={type}>
                  {i > 0 && ' et '}
                  <span className={`font-bold ${type === 'JIRS' ? 'text-blue-700' : 'text-purple-700'}`}>
                    {type === 'JIRS' ? 'la JIRS' : 'le Parquet Général'}
                  </span>
                </span>
              ))}
              . Pensez à envoyer {TRIGGER_ACTION[triggerContext]}.
            </p>
          </div>

          {/* Template mail */}
          <div>
            <p className="text-xs text-gray-500 mb-1">
              Modèle de mail (modifiable à terme) :
            </p>
            <textarea
              readOnly
              value={mailTemplate}
              className="w-full h-40 p-3 text-sm font-mono border border-gray-200 rounded-lg bg-gray-50 resize-none focus:outline-none"
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5">
              {copied ? (
                <><Check className="h-3.5 w-3.5" /> Copié !</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copier le mail</>
              )}
            </Button>
            {onCreateTodo && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateTodo}
                disabled={todoCreated}
                className={`gap-1.5 ${todoCreated ? 'text-green-600 border-green-200' : 'text-violet-600 border-violet-200 hover:bg-violet-50'}`}
              >
                {todoCreated ? (
                  <><Check className="h-3.5 w-3.5" /> Todo créé</>
                ) : (
                  <>Créer un rappel "À faire"</>
                )}
              </Button>
            )}
          </div>
          <Button size="sm" onClick={handleClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
