import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { DateUtils } from '@/utils/dateUtils';
import { useToast } from '@/contexts/ToastContext';
import { AutreActe, DateManagerData, ActeStatus } from '@/types/interfaces';
import {
  AUTRE_ACTE_TYPE_OPTIONS,
  AUTRE_ACTE_TYPES,
  AutreActeTypeKey,
  AutreActeTypeConfig,
} from '@/config/acteTypes';

interface ActeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (acte: Partial<AutreActe>, dates: DateManagerData) => void;
  acte?: AutreActe;
  title: string;
  initialData?: any;
}

export const ActeModal = ({
  isOpen,
  onClose,
  onSave,
  acte,
  title,
  initialData
}: ActeModalProps) => {
  const [selectedTypeKey, setSelectedTypeKey] = useState<AutreActeTypeKey | ''>('');
  const [description, setDescription] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [customDuree, setCustomDuree] = useState(''); // pour types à durée libre (captation public, infiltration)
  const [datePose, setDatePose] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { showToast } = useToast();

  const typeConfig: AutreActeTypeConfig | null =
    selectedTypeKey ? AUTRE_ACTE_TYPES[selectedTypeKey] : null;

  // Durée effective pour calcul de la date de fin
  const effectiveDuree = typeConfig?.duree !== undefined
    ? String(typeConfig.duree)
    : customDuree;
  const effectiveDureeUnit = typeConfig?.dureeUnit ?? 'jours';

  useEffect(() => {
    if (isOpen) {
      if (acte) {
        // Mode modification — on identifie le type si c'est une clé connue
        const matchedKey = Object.keys(AUTRE_ACTE_TYPES).find(
          (k) => k === acte.type
        ) as AutreActeTypeKey | undefined;
        setSelectedTypeKey(matchedKey || '');
        setDescription(acte.description || '');
        setDateDebut(acte.dateDebut || '');
        setCustomDuree(acte.duree || '');
        setDatePose(acte.datePose || '');
      } else if (initialData) {
        setSelectedTypeKey(initialData.type || '');
        setDescription(initialData.description || '');
        setDateDebut(initialData.dateDebut || '');
        setCustomDuree(initialData.duree || '');
        setDatePose(initialData.datePose || '');
      } else {
        setSelectedTypeKey('');
        setDescription('');
        setDateDebut('');
        setCustomDuree('');
        setDatePose('');
      }
      setErrors({});
    }
  }, [isOpen, acte, initialData]);

  // Quand on change de type, remettre les champs dépendants à zéro
  const handleTypeChange = (key: string) => {
    setSelectedTypeKey(key as AutreActeTypeKey | '');
    setDateDebut('');
    setCustomDuree('');
    setDatePose('');
    setErrors({});
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!selectedTypeKey) newErrors.type = "Sélectionnez un type d'acte";
    if (typeConfig?.hasDuree && typeConfig.duree === undefined && !customDuree) {
      newErrors.duree = 'La durée est requise';
    }
    if (typeConfig?.hasDuree && !dateDebut) {
      newErrors.dateDebut = 'La date de début est requise';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || !typeConfig) return;

    const needsPose = typeConfig.hasDuree; // les actes sans durée n'ont pas de pose
    const dureeVal = effectiveDuree;

    let updatedStatut: ActeStatus | undefined;
    if (!typeConfig.hasDuree) {
      // Art. 76, pas de durée → directement en cours
      updatedStatut = 'en_cours';
    } else if (!datePose) {
      updatedStatut = 'pose_pending';
    }

    const dateFin = (typeConfig.hasDuree && !needsPose && dateDebut && dureeVal)
      ? DateUtils.calculateEndDateWithUnit(dateDebut, dureeVal, effectiveDureeUnit as 'jours' | 'mois')
      : undefined;

    const dates: DateManagerData = {
      dateDebut: typeConfig.hasDuree ? dateDebut : '',
      duree: dureeVal,
      dureeUnit: effectiveDureeUnit as 'jours' | 'mois',
      maxProlongations: typeConfig.maxProlongations,
      datePose: needsPose ? datePose : undefined,
      updatedStatut,
      dateFin,
    };

    try {
      onSave({ type: selectedTypeKey, description }, dates);
      showToast(`Acte ${acte ? 'modifié' : 'ajouté'} avec succès`, 'success');
      if (typeConfig.toastOnCreate && !acte) {
        setTimeout(() => showToast(typeConfig.toastOnCreate!, 'warning'), 600);
      }
      onClose();
    } catch (error) {
      showToast(`Erreur lors de la ${acte ? 'modification' : 'création'} de l'acte`, 'error');
    }
  };

  // Preview de la date de fin
  const previewDateFin = (() => {
    if (!typeConfig?.hasDuree || !effectiveDuree || !dateDebut) return null;
    const ref = datePose || dateDebut;
    return DateUtils.calculateEndDateWithUnit(ref, effectiveDuree, effectiveDureeUnit as 'jours' | 'mois');
  })();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
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

          {/* ── Sélecteur de type ── */}
          <div>
            <Label htmlFor="type">Type d'acte *</Label>
            <Select
              id="type"
              value={selectedTypeKey}
              onChange={(e) => handleTypeChange(e.target.value)}
              className={errors.type ? 'border-red-500' : ''}
            >
              <option value="">— Sélectionner un type —</option>
              {AUTRE_ACTE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </Select>
            {errors.type && <p className="text-xs text-red-500 mt-1">{errors.type}</p>}
          </div>

          {/* ── Bandeau légal du type sélectionné ── */}
          {typeConfig?.warningBanner && (
            <div className="bg-amber-50 border border-amber-300 rounded-md p-3 text-sm text-amber-900">
              <span className="font-semibold">⚠ Conditions légales : </span>
              {typeConfig.warningBanner}
            </div>
          )}

          {/* ── Autorisation ── */}
          {typeConfig && (
            <div className="text-sm text-gray-600 flex items-center gap-2">
              <span className="font-medium">Autorisation requise :</span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                typeConfig.autorisation === 'JLD'
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-green-100 text-green-800'
              }`}>
                {typeConfig.autorisation === 'JLD' ? 'JLD (sur requête procureur)' : 'Procureur de la République'}
              </span>
            </div>
          )}

          {/* ── Limite légale ── */}
          {typeConfig?.limiteLegaleTexte && (
            <div className="text-xs text-red-700 font-medium bg-red-50 border border-red-200 rounded px-3 py-2">
              {typeConfig.limiteLegaleTexte}
            </div>
          )}

          {/* ── Description / notes ── */}
          <div>
            <Label htmlFor="description">Description / notes</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Cible, objet, numéro de réquisition..."
            />
          </div>

          {/* ── Champs dates/durée (seulement si le type a une durée) ── */}
          {typeConfig?.hasDuree && (
            <>
              {/* Durée : affichage fixe ou champ libre selon le type */}
              {typeConfig.duree !== undefined ? (
                <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm text-blue-900">
                  <span className="font-semibold">Durée légale : </span>
                  {typeConfig.dureeUnit === 'mois'
                    ? `${typeConfig.duree} mois calendaire${typeConfig.duree > 1 ? 's' : ''}`
                    : typeConfig.dureeUnit === 'heures'
                    ? `${typeConfig.duree}h`
                    : `${typeConfig.duree} jours`}
                </div>
              ) : (
                <div>
                  <Label htmlFor="duree">
                    Durée (
                    {typeConfig.dureeUnit === 'mois' ? 'mois' :
                     typeConfig.dureeUnit === 'heures' ? 'heures' : 'jours'}
                    ) *
                  </Label>
                  <Input
                    id="duree"
                    type="number"
                    min="1"
                    value={customDuree}
                    onChange={(e) => setCustomDuree(e.target.value)}
                    className={errors.duree ? 'border-red-500' : ''}
                    placeholder="Durée fixée par le procureur"
                  />
                  {errors.duree && <p className="text-xs text-red-500 mt-1">{errors.duree}</p>}
                </div>
              )}

              <div>
                <Label htmlFor="dateDebut">Date de début (autorisation) *</Label>
                <Input
                  id="dateDebut"
                  type="date"
                  value={dateDebut}
                  onChange={(e) => setDateDebut(e.target.value)}
                  className={errors.dateDebut ? 'border-red-500' : ''}
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
                />
              </div>

              {previewDateFin && (
                <p className="text-xs text-gray-500">
                  Date de fin estimée :{' '}
                  <span className="font-medium">{previewDateFin}</span>
                </p>
              )}
            </>
          )}

          {/* ── Message art. 76 — pas de durée ── */}
          {typeConfig && !typeConfig.hasDuree && (
            <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2 text-sm text-gray-700">
              Cet acte n'a pas de durée propre — il sera enregistré directement en cours.
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={!selectedTypeKey}>
              {acte ? 'Modifier' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
