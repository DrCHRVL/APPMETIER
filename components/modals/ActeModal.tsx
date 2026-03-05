import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { AutreActe, DateManagerData, ActeStatus } from '@/types/interfaces';

interface ActeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (acte: Partial<AutreActe>, dates: DateManagerData) => void;
  acte?: AutreActe; // Fourni en cas de modification
  title: string; // "Ajouter un acte" ou "Modifier un acte"
  initialData?: any; // Données pré-remplies depuis l'analyse automatique
}

export const ActeModal = ({
  isOpen,
  onClose,
  onSave,
  acte,
  title,
  initialData
}: ActeModalProps) => {
  // État du formulaire
  const [formData, setFormData] = useState<Partial<AutreActe>>({
    type: '',
    description: ''
  });
  
  // Dates
  const [dateDebut, setDateDebut] = useState('');
  const [duree, setDuree] = useState('');
  const [datePose, setDatePose] = useState('');
  const [hadPoseDate, setHadPoseDate] = useState(false);
  
  // Options
  const [needsJLDAuth, setNeedsJLDAuth] = useState(false);
  const [needsPose, setNeedsPose] = useState(true); // Nouvelle option pour la pose
  
  // Erreurs
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const { showToast } = useToast();

  // Réinitialiser le formulaire quand le modal s'ouvre
  useEffect(() => {
    if (isOpen) {
      if (acte) {
        // Mode modification
        setFormData({
          type: acte.type || '',
          description: acte.description || ''
        });
        setDateDebut(acte.dateDebut || '');
        setDuree(acte.duree || '');
        setDatePose(acte.datePose || '');
        setHadPoseDate(!!acte.datePose);
        setNeedsJLDAuth(false);
        setNeedsPose(true); // En modification, on ne change pas cette logique
      } else if (initialData) {
        // Mode ajout avec données pré-remplies
        setFormData({
          type: initialData.type || '',
          description: initialData.description || ''
        });
        setDateDebut(initialData.dateDebut || '');
        setDuree(initialData.duree || '');
        setDatePose(initialData.datePose || '');
        setHadPoseDate(false);
        setNeedsJLDAuth(initialData.needsJLDAuth !== undefined ? initialData.needsJLDAuth : false);
        setNeedsPose(initialData.needsPose !== undefined ? initialData.needsPose : true);
      } else {
        // Mode ajout vide
        setFormData({
          type: '',
          description: ''
        });
        setDateDebut('');
        setDuree('');
        setDatePose('');
        setHadPoseDate(false);
        setNeedsJLDAuth(false);
        setNeedsPose(true); // Par défaut, on considère qu'un acte nécessite une pose
      }
      setErrors({});
    }
  }, [isOpen, acte, initialData]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.type) {
      newErrors.type = "Le type d'acte est requis";
    }
    
    if (!needsJLDAuth && !dateDebut) {
      newErrors.dateDebut = "La date de début est requise";
    }
    
    if (!needsJLDAuth && !duree) {
      newErrors.duree = "La durée est requise";
    }
    
    if (dateDebut && datePose) {
      const debutDate = new Date(dateDebut);
      const poseDate = new Date(datePose);
      
      if (poseDate < debutDate) {
        newErrors.datePose = "La date de pose doit être postérieure ou égale à la date de début";
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    let updatedStatut: ActeStatus | undefined = undefined;
    
    if (acte && hadPoseDate && !datePose) {
      updatedStatut = 'pose_pending';
    } else if (needsJLDAuth) {
      updatedStatut = 'autorisation_pending';
    } else if (!needsPose) {
      // Si l'acte ne nécessite pas de pose, il est directement en cours
      updatedStatut = 'en_cours';
    }
    
    const dates: DateManagerData = {
      dateDebut: needsJLDAuth ? '' : dateDebut,
      duree,
      datePose: needsPose ? datePose : undefined, // Pas de date de pose si pas nécessaire
      updatedStatut
    };

    // Si l'acte ne nécessite pas de pose, calculer directement la date de fin
    if (!needsPose && !needsJLDAuth && dateDebut && duree) {
      dates.dateFin = DateUtils.calculateActeEndDate(dateDebut, duree);
    }
    
    try {
      onSave(formData, dates);
      showToast(`Acte ${acte ? 'modifié' : 'ajouté'} avec succès`, 'success');
      onClose();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de l\'acte:', error);
      showToast(`Erreur lors de la ${acte ? 'modification' : 'création'} de l'acte`, 'error');
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {title}
            {initialData && (
              <span className="ml-2 text-sm font-normal text-green-600">
                (Pré-rempli automatiquement)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="type">Type d'acte *</Label>
            <Input
              id="type"
              value={formData.type}
              onChange={(e) => setFormData({...formData, type: e.target.value})}
              className={`${errors.type ? 'border-red-500' : ''} ${initialData?.type ? 'bg-green-50' : ''}`}
            />
            {errors.type && <p className="text-xs text-red-500 mt-1">{errors.type}</p>}
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description || ''}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              rows={3}
              className={initialData?.description ? 'bg-green-50' : ''}
            />
          </div>

          {!acte && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Switch
                  id="needsJLDAuth"
                  checked={needsJLDAuth}
                  onCheckedChange={setNeedsJLDAuth}
                />
                <Label htmlFor="needsJLDAuth">Nécessite autorisation JLD</Label>
              </div>

              {!needsJLDAuth && (
                <div className="flex items-center space-x-2">
                  <Switch
                    id="needsPose"
                    checked={needsPose}
                    onCheckedChange={setNeedsPose}
                  />
                  <Label htmlFor="needsPose">Nécessite une pose</Label>
                </div>
              )}
            </div>
          )}

          {!needsJLDAuth && (
            <>
              <div>
                <Label htmlFor="dateDebut">Date de début *</Label>
                <Input
                  id="dateDebut"
                  type="date"
                  value={dateDebut}
                  onChange={(e) => setDateDebut(e.target.value)}
                  className={`${errors.dateDebut ? 'border-red-500' : ''} ${initialData?.dateDebut ? 'bg-green-50' : ''}`}
                />
                {errors.dateDebut && <p className="text-xs text-red-500 mt-1">{errors.dateDebut}</p>}
              </div>

              <div>
                <Label htmlFor="duree">Durée (jours) *</Label>
                <Input
                  id="duree"
                  type="number"
                  min="1"
                  value={duree}
                  onChange={(e) => setDuree(e.target.value)}
                  className={`${errors.duree ? 'border-red-500' : ''} ${initialData?.duree ? 'bg-green-50' : ''}`}
                />
                {errors.duree && <p className="text-xs text-red-500 mt-1">{errors.duree}</p>}
              </div>

              {needsPose && (
                <div>
                  <Label htmlFor="datePose">Date de pose (optionnelle)</Label>
                  <Input
                    id="datePose"
                    type="date"
                    value={datePose}
                    onChange={(e) => setDatePose(e.target.value)}
                    min={dateDebut}
                    className={errors.datePose ? 'border-red-500' : ''}
                  />
                  {errors.datePose && <p className="text-xs text-red-500 mt-1">{errors.datePose}</p>}
                </div>
              )}
              
              {dateDebut && duree && !errors.dateDebut && !errors.duree && (
                <p className="text-xs text-gray-500 mt-1">
                  Date de fin: {needsPose && datePose ? 
                    DateUtils.calculateActeEndDate(datePose, duree) : 
                    DateUtils.calculateActeEndDate(dateDebut, duree)}
                </p>
              )}
            </>
          )}

          {needsJLDAuth && (
            <div className="bg-purple-50 p-3 rounded-md text-sm text-purple-800 border border-purple-200">
              L'acte sera créé en attente d'autorisation JLD. 
              Vous pourrez valider l'autorisation ultérieurement à partir de la fiche d'enquête.
            </div>
          )}

          {!needsPose && !needsJLDAuth && (
            <div className="bg-blue-50 p-3 rounded-md text-sm text-blue-800 border border-blue-200">
              L'acte sera directement en cours sans nécessiter de pose. 
              La date de fin sera calculée automatiquement.
            </div>
          )}

          {acte && hadPoseDate && (
            <div className="text-sm text-gray-600">
              {datePose ? (
                <p>L'acte a été posé le {datePose}.</p>
              ) : (
                <p className="text-amber-600">Attention : En supprimant la date de pose, l'acte sera remis en statut "en attente de pose".</p>
              )}
            </div>
          )}

          {initialData && (
            <div className="bg-green-50 p-3 rounded-md text-sm text-green-800 border border-green-200">
              ℹ️ Ce formulaire a été pré-rempli automatiquement à partir de l'analyse du document PDF.
              Vérifiez les informations avant de valider.
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">
              {acte ? 'Modifier' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};