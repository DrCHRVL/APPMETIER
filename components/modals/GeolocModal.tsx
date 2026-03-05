import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { GeolocData, DateManagerData, ActeStatus } from '@/types/interfaces';

interface GeolocModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (geoloc: Partial<GeolocData>, dates: DateManagerData) => void;
  geoloc?: GeolocData; // Fourni en cas de modification
  title: string; // "Ajouter une géolocalisation" ou "Modifier une géolocalisation"
  initialData?: any; // Données pré-remplies depuis l'analyse automatique
}

export const GeolocModal = ({
  isOpen,
  onClose,
  onSave,
  geoloc,
  title,
  initialData
}: GeolocModalProps) => {
  // État du formulaire
  const [formData, setFormData] = useState<Partial<GeolocData>>({
    objet: '',
    description: ''
  });
  
  // Dates
  const [dateDebut, setDateDebut] = useState('');
  const [duree, setDuree] = useState('15');
  const [datePose, setDatePose] = useState('');
  const [hadPoseDate, setHadPoseDate] = useState(false);
  
  // Autorisation JLD
  const [needsJLDAuth, setNeedsJLDAuth] = useState(false);
  
  // Erreurs
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const { showToast } = useToast();

  // Réinitialiser le formulaire quand le modal s'ouvre
  useEffect(() => {
    if (isOpen) {
      if (geoloc) {
        // Mode modification
        setFormData({
          objet: geoloc.objet || '',
          description: geoloc.description || ''
        });
        setDateDebut(geoloc.dateDebut || '');
        setDuree(geoloc.duree || '15');
        setDatePose(geoloc.datePose || '');
        setHadPoseDate(!!geoloc.datePose);
        setNeedsJLDAuth(false);
      } else if (initialData) {
        // Mode ajout avec données pré-remplies
        setFormData({
          objet: initialData.objet || '',
          description: initialData.description || ''
        });
        setDateDebut(initialData.dateDebut || '');
        setDuree(initialData.duree || '15');
        setDatePose(initialData.datePose || '');
        setHadPoseDate(false);
        setNeedsJLDAuth(initialData.needsJLDAuth !== undefined ? initialData.needsJLDAuth : false);
      } else {
        // Mode ajout vide
        setFormData({
          objet: '',
          description: ''
        });
        setDateDebut('');
        setDuree('15');
        setDatePose('');
        setHadPoseDate(false);
        setNeedsJLDAuth(false);
      }
      setErrors({});
    }
  }, [isOpen, geoloc, initialData]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.objet) {
      newErrors.objet = "La cible de la géolocalisation est requise";
    }
    
    if (!needsJLDAuth && !dateDebut) {
      newErrors.dateDebut = "La date de début est requise";
    }
    
    if (!duree) {
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
    
    if (geoloc && hadPoseDate && !datePose) {
      updatedStatut = 'pose_pending';
    } else if (needsJLDAuth) {
      updatedStatut = 'autorisation_pending';
    }
    
    const dates: DateManagerData = {
      dateDebut: needsJLDAuth ? '' : dateDebut,
      duree,
      datePose,
      updatedStatut
    };
    
    try {
      onSave(formData, dates);
      showToast(`Géolocalisation ${geoloc ? 'modifiée' : 'ajoutée'} avec succès`, 'success');
      onClose();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la géolocalisation:', error);
      showToast(`Erreur lors de la ${geoloc ? 'modification' : 'création'} de la géolocalisation`, 'error');
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
            <Label htmlFor="objet">Cible *</Label>
            <Input
              id="objet"
              value={formData.objet}
              onChange={(e) => setFormData({...formData, objet: e.target.value})}
              className={`${errors.objet ? 'border-red-500' : ''} ${initialData?.objet ? 'bg-green-50' : ''}`}
            />
            {errors.objet && <p className="text-xs text-red-500 mt-1">{errors.objet}</p>}
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

          {!geoloc && (
            <div className="flex items-center space-x-2">
              <Switch
                id="needsJLDAuth"
                checked={needsJLDAuth}
                onCheckedChange={setNeedsJLDAuth}
              />
              <Label htmlFor="needsJLDAuth">Nécessite autorisation JLD</Label>
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
                
                {dateDebut && duree && !errors.dateDebut && !errors.duree && (
                  <p className="text-xs text-gray-500 mt-1">
                    Date de fin: {datePose ? 
                      DateUtils.calculateActeEndDate(datePose, duree) : 
                      DateUtils.calculateActeEndDate(dateDebut, duree)}
                  </p>
                )}
              </div>
            </>
          )}

          {needsJLDAuth && (
            <>
              <div>
                <Label htmlFor="duree">Durée prévue (jours) *</Label>
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
              
              <div className="bg-purple-50 p-3 rounded-md text-sm text-purple-800 border border-purple-200">
                La géolocalisation sera créée en attente d'autorisation JLD.
                Vous pourrez valider l'autorisation ultérieurement à partir de la fiche d'enquête.
              </div>
            </>
          )}

          {geoloc && hadPoseDate && (
            <div className="text-sm text-gray-600">
              {datePose ? (
                <p>La géolocalisation a été posée le {datePose}.</p>
              ) : (
                <p className="text-amber-600">Attention : En supprimant la date de pose, la géolocalisation sera remise en statut "en attente de pose".</p>
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
              {geoloc ? 'Modifier' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};