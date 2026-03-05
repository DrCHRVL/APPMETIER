import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { AIRImportData, AIRStatus } from '@/types/interfaces';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Badge } from '@/components/ui/badge';
import { Calendar, User, MapPin, FileText, Target, Clock } from 'lucide-react';

interface AIRDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  mesure: AIRImportData | null;
  onUpdate: (refAEM: string, updates: Partial<AIRImportData>) => void;
  onDelete: (refAEM: string) => void;
  onCreate?: (mesure: Omit<AIRImportData, 'refAEM'> & { refAEM: string }) => void;
}

export const AIRDetailModal = ({
  isOpen,
  onClose,
  mesure,
  onUpdate,
  onDelete,
  onCreate
}: AIRDetailModalProps) => {
  const [formData, setFormData] = useState<Partial<AIRImportData>>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Initialiser le formulaire
  useEffect(() => {
    if (mesure) {
      setFormData(mesure);
      setIsEditing(false);
    } else {
      // Valeurs par défaut pour une nouvelle mesure
      const today = new Date().toLocaleDateString('fr-FR');
      setFormData({
        refAEM: '',
        dateReception: today,
        faits: '',
        nomPrenom: '',
        adresse: '',
        dateNaissance: '',
        secteurGeographique: '',
        referent: '',
        origine: 'CP',
        nombreEntretiensAIR: 0,
        nombreRencontresPR: 0,
        dateFinPriseEnCharge: '',
        natureFinAIR: '',
        resultatMesure: '',
        orientationFinMesure: '',
        dateCloture: '',
        dureeEnMois: 0,
        statut: 'en_cours'
      });
      setIsEditing(true);
    }
  }, [mesure]);

  const handleChange = (field: keyof AIRImportData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = () => {
    if (!formData.refAEM || !formData.nomPrenom) {
      alert('Veuillez remplir au minimum la référence AEM et le nom/prénom');
      return;
    }

    if (mesure) {
      onUpdate(mesure.refAEM, formData);
    } else if (onCreate) {
      onCreate(formData as Omit<AIRImportData, 'refAEM'> & { refAEM: string });
    }
    
    setIsEditing(false);
    onClose();
  };

  const handleDelete = () => {
    if (mesure) {
      onDelete(mesure.refAEM);
      onClose();
    }
  };

  const getStatusColor = (status: AIRStatus) => {
    switch (status) {
      case 'en_cours': return 'bg-blue-100 text-blue-800';
      case 'reussite': return 'bg-green-100 text-green-800';
      case 'echec': return 'bg-red-100 text-red-800';
      case 'termine': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusLabel = (status: AIRStatus) => {
    switch (status) {
      case 'en_cours': return 'En cours';
      case 'reussite': return 'Réussite';
      case 'echec': return 'Échec';
      case 'termine': return 'Terminé';
      default: return 'Inconnu';
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex justify-between items-center">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {mesure ? `Mesure AIR - ${formData.nomPrenom}` : 'Nouvelle mesure AIR'}
              </DialogTitle>
              <div className="flex items-center gap-2">
                {mesure && !isEditing && (
                  <Badge className={getStatusColor(formData.statut || 'en_cours')}>
                    {getStatusLabel(formData.statut || 'en_cours')}
                  </Badge>
                )}
                {mesure && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(!isEditing)}
                    >
                      {isEditing ? 'Annuler' : 'Modifier'}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      Supprimer
                    </Button>
                  </>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6">
            {/* Informations principales */}
            <div className="grid grid-cols-2 gap-6">
              {/* Colonne gauche - Informations procédurales */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
                  <FileText className="h-4 w-4" />
                  Informations procédurales
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Référence AEM</Label>
                    <Input
                      value={formData.refAEM || ''}
                      onChange={(e) => handleChange('refAEM', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Date de réception</Label>
                    <Input
                      value={formData.dateReception || ''}
                      onChange={(e) => handleChange('dateReception', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Faits</Label>
                    <Textarea
                      value={formData.faits || ''}
                      onChange={(e) => handleChange('faits', e.target.value)}
                      disabled={!isEditing}
                      rows={3}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Origine</Label>
                    <Select
                      value={formData.origine || ''}
                      onChange={(e) => handleChange('origine', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    >
                      <option value="CP">CP - Composition pénale</option>
                      <option value="CSC">CSC - Classement sous condition</option>
                      <option value="CJ">CJ - Contrôle judiciaire</option>
                      <option value="Autre">Autre</option>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Colonne droite - Informations personnelles */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
                  <User className="h-4 w-4" />
                  Informations personnelles
                </div>
                
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Nom / Prénom</Label>
                    <Input
                      value={formData.nomPrenom || ''}
                      onChange={(e) => handleChange('nomPrenom', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Date de naissance</Label>
                    <Input
                      value={formData.dateNaissance || ''}
                      onChange={(e) => handleChange('dateNaissance', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Adresse</Label>
                    <Textarea
                      value={formData.adresse || ''}
                      onChange={(e) => handleChange('adresse', e.target.value)}
                      disabled={!isEditing}
                      rows={3}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Secteur géographique</Label>
                    <Input
                      value={formData.secteurGeographique || ''}
                      onChange={(e) => handleChange('secteurGeographique', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Suivi de la mesure */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
                <Target className="h-4 w-4" />
                Suivi de la mesure
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs font-medium">Référent</Label>
                  <Input
                    value={formData.referent || ''}
                    onChange={(e) => handleChange('referent', e.target.value)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-xs font-medium">Nb entretiens AIR</Label>
                  <Input
                    type="number"
                    value={formData.nombreEntretiensAIR || 0}
                    onChange={(e) => handleChange('nombreEntretiensAIR', parseInt(e.target.value) || 0)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label className="text-xs font-medium">Nb rencontres PR</Label>
                  <Input
                    type="number"
                    value={formData.nombreRencontresPR || 0}
                    onChange={(e) => handleChange('nombreRencontresPR', parseInt(e.target.value) || 0)}
                    disabled={!isEditing}
                    className="mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Fin de mesure */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 border-b pb-2">
                <Clock className="h-4 w-4" />
                Fin de mesure
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Date fin prise en charge</Label>
                    <Input
                      value={formData.dateFinPriseEnCharge || ''}
                      onChange={(e) => handleChange('dateFinPriseEnCharge', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Nature fin AIR</Label>
                    <Textarea
                      value={formData.natureFinAIR || ''}
                      onChange={(e) => handleChange('natureFinAIR', e.target.value)}
                      disabled={!isEditing}
                      rows={2}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Durée (mois)</Label>
                    <Input
                      type="number"
                      value={formData.dureeEnMois || 0}
                      onChange={(e) => handleChange('dureeEnMois', parseInt(e.target.value) || 0)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label className="text-xs font-medium">Résultat de mesure</Label>
                    <Select
                      value={formData.resultatMesure || ''}
                      onChange={(e) => handleChange('resultatMesure', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    >
                      <option value="">-- Sélectionner --</option>
                      <option value="Réussite">Réussite</option>
                      <option value="Échec">Échec</option>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Orientation fin de mesure</Label>
                    <Textarea
                      value={formData.orientationFinMesure || ''}
                      onChange={(e) => handleChange('orientationFinMesure', e.target.value)}
                      disabled={!isEditing}
                      rows={2}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label className="text-xs font-medium">Date clôture</Label>
                    <Input
                      value={formData.dateCloture || ''}
                      onChange={(e) => handleChange('dateCloture', e.target.value)}
                      disabled={!isEditing}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium">Statut</Label>
                <Select
                  value={formData.statut || 'en_cours'}
                  onChange={(e) => handleChange('statut', e.target.value)}
                  disabled={!isEditing}
                  className="mt-1 max-w-xs"
                >
                  <option value="en_cours">En cours</option>
                  <option value="reussite">Réussite</option>
                  <option value="echec">Échec</option>
                  <option value="termine">Terminé</option>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Fermer
            </Button>
            {isEditing && (
              <Button onClick={handleSave}>
                Enregistrer
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDelete}
        title="Supprimer cette mesure AIR ?"
        message="Cette action est irréversible. Voulez-vous vraiment supprimer cette mesure AIR ?"
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
      />
    </>
  );
};