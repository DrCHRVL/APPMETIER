import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { EcouteData, DateManagerData, ActeStatus } from '@/types/interfaces';

interface EcouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (ecoute: Partial<EcouteData>, dates: DateManagerData) => void;
  ecoute?: EcouteData; // Fourni en cas de modification
  title: string; // "Ajouter une écoute" ou "Modifier une écoute"
  initialData?: any; // Données pré-remplies depuis l'analyse automatique
}

export const EcouteModal = ({
  isOpen,
  onClose,
  onSave,
  ecoute,
  title,
  initialData
}: EcouteModalProps) => {
  // État du formulaire
  const [formData, setFormData] = useState<Partial<EcouteData>>({
    numero: '',
    cible: '',
    description: ''
  });
  
  // Dates — écoute = 1 mois calendaire (non modifiable)
  const [dateDebut, setDateDebut] = useState('');
  const duree = '1';
  const dureeUnit: 'mois' = 'mois';
  const [datePose, setDatePose] = useState('');
  const [hadPoseDate, setHadPoseDate] = useState(false);
  
  // Autorisation JLD
  const [needsJLDAuth, setNeedsJLDAuth] = useState(true);
  
  // Erreurs
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  const { showToast } = useToast();

  // Réinitialiser le formulaire quand le modal s'ouvre
  useEffect(() => {
    if (isOpen) {
      if (ecoute) {
        // Mode modification
        setFormData({
          numero: ecoute.numero || '',
          cible: ecoute.cible || '',
          description: ecoute.description || ''
        });
        setDateDebut(ecoute.dateDebut || '');
        setDatePose(ecoute.datePose || '');
        setHadPoseDate(!!ecoute.datePose);
        setNeedsJLDAuth(false);
      } else if (initialData) {
        // Mode ajout avec données pré-remplies
        setFormData({
          numero: initialData.numero || '',
          cible: initialData.cible || '',
          description: initialData.description || ''
        });
        setDateDebut(initialData.dateDebut || '');
        // duree est fixé à '1 mois' — on ignore initialData.duree
        setDatePose(initialData.datePose || '');
        setHadPoseDate(false);
        setNeedsJLDAuth(initialData.needsJLDAuth !== undefined ? initialData.needsJLDAuth : true);
      } else {
        // Mode ajout vide
        setFormData({
          numero: '',
          cible: '',
          description: ''
        });
        setDateDebut('');
        setDatePose('');
        setHadPoseDate(false);
        setNeedsJLDAuth(true);
      }
      setErrors({});
    }
  }, [isOpen, ecoute, initialData]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.numero) {
      newErrors.numero = "Le numéro de l'écoute est requis";
    }
    
    if (!needsJLDAuth && !dateDebut) {
      newErrors.dateDebut = "La date de début est requise";
    }
    
    // duree est toujours '1 mois' (constante), pas de validation nécessaire

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
    
    if (ecoute && hadPoseDate && !datePose) {
      updatedStatut = 'pose_pending';
    } else if (needsJLDAuth) {
      updatedStatut = 'autorisation_pending';
    }
    
    const dates: DateManagerData = {
      dateDebut: needsJLDAuth ? '' : dateDebut,
      duree,          // '1' (mois)
      dureeUnit,      // 'mois'
      maxProlongations: 1,
      datePose,
      updatedStatut
    };
    
    try {
      onSave(formData, dates);
      showToast(`Écoute ${ecoute ? 'modifiée' : 'ajoutée'} avec succès`, 'success');
      onClose();
    } catch (error) {
      console.error('Erreur lors de la sauvegarde de l\'écoute:', error);
      showToast(`Erreur lors de la ${ecoute ? 'modification' : 'création'} de l'écoute`, 'error');
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
            <Label htmlFor="numero">Numéro d'écoute *</Label>
            <Input
              id="numero"
              value={formData.numero}
              onChange={(e) => setFormData({...formData, numero: e.target.value})}
              className={`${errors.numero ? 'border-red-500' : ''} ${initialData?.numero ? 'bg-green-50' : ''}`}
            />
            {errors.numero && <p className="text-xs text-red-500 mt-1">{errors.numero}</p>}
          </div>

          <div>
            <Label htmlFor="cible">Cible</Label>
            <Input
              id="cible"
              value={formData.cible || ''}
              onChange={(e) => setFormData({...formData, cible: e.target.value})}
              className={initialData?.cible ? 'bg-green-50' : ''}
            />
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

          {!ecoute && (
            <div className="flex items-center space-x-2">
              <Switch
                id="needsJLDAuth"
                checked={needsJLDAuth}
                onCheckedChange={setNeedsJLDAuth}
              />
              <Label htmlFor="needsJLDAuth">Nécessite autorisation JLD</Label>
            </div>
          )}

          {/* Durée légale fixe — non modifiable */}
          <div className="bg-blue-50 p-3 rounded-md text-sm text-blue-900 border border-blue-200">
            <span className="font-semibold">Durée légale : 1 mois calendaire</span>
            <span className="text-blue-700"> — Limite légale : 1 mois + 1 prolongation maximum</span>
          </div>

          {!needsJLDAuth && (
            <>
              <div>
                <Label htmlFor="dateDebut">Date de début (autorisation JLD) *</Label>
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

                {(datePose || dateDebut) && !errors.dateDebut && (
                  <p className="text-xs text-gray-500 mt-1">
                    Date de fin (1 mois) :{' '}
                    {DateUtils.calculateEndDateWithUnit(datePose || dateDebut, '1', 'mois')}
                  </p>
                )}
              </div>
            </>
          )}

          {needsJLDAuth && (
            <div className="bg-purple-50 p-3 rounded-md text-sm text-purple-800 border border-purple-200">
              L'écoute sera créée en attente d'autorisation JLD.
              Vous pourrez valider l'autorisation ultérieurement à partir de la fiche d'enquête.
            </div>
          )}

          {ecoute && hadPoseDate && (
            <div className="text-sm text-gray-600">
              {datePose ? (
                <p>L'écoute a été posée le {datePose}.</p>
              ) : (
                <p className="text-amber-600">Attention : En supprimant la date de pose, l'écoute sera remise en statut "en attente de pose".</p>
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
              {ecoute ? 'Modifier' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};