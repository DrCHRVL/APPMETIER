import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { CondamnationData, Confiscations, ResultatAudience } from '@/types/audienceTypes';
import { useToast } from '@/contexts/ToastContext';
import { useTags } from '@/hooks/useTags';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '../ui/badge';
import { Clock } from 'lucide-react';

// Extension de CondamnationData pour inclure le statut pending
interface ExtendedCondamnationData extends CondamnationData {
  isPending?: boolean;
  dateAudiencePending?: string;
  dateDefere?: string;
}

// Types
interface AudienceResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (resultat: ResultatAudience) => void;
  enqueteId: number;
  defaultDate?: string;
  initialData?: ResultatAudience;
  isDirectResult?: boolean;
  misEnCause?: { id: number; nom: string }[];
}

export const AudienceResultModal = ({
  isOpen,
  onClose,
  onSave,
  enqueteId,
  defaultDate,
  initialData,
  isDirectResult,
  misEnCause = []
}: AudienceResultModalProps) => {
  // States
  const { getTagsByCategory } = useTags();
  const [dateAudience, setDateAudience] = useState(initialData?.dateAudience || defaultDate || '');
  const [selectedInfraction, setSelectedInfraction] = useState(initialData?.typeInfraction || '');

  // Re-hydrater les pendingCondamnations depuis initialData (résultats partiels)
  const buildInitialCondamnations = (): ExtendedCondamnationData[] => {
    const finalized = (initialData?.condamnations || []).map(c => ({
      ...c,
      isPending: false,
      dateAudiencePending: c.dateAudiencePending || '',
      dateDefere: c.dateDefere || ''
    }));
    const pending = (initialData?.pendingCondamnations || []).map(p => ({
      nom: p.nom,
      peinePrison: 0,
      sursisProbatoire: 0,
      sursisSimple: 0,
      peineAmende: 0,
      interdictionParaitre: false,
      typeAudience: 'CRPC-Def' as const,
      defere: true,
      dateDefere: '',
      isPending: true,
      dateAudiencePending: p.dateAudiencePending || ''
    }));
    return [...finalized, ...pending];
  };

  const initialCondamnations = buildInitialCondamnations();
  const [nbCondamnes, setNbCondamnes] = useState(initialCondamnations.length || 0);
  const [condamnations, setCondamnations] = useState<ExtendedCondamnationData[]>(initialCondamnations);
  const [confiscations, setConfiscations] = useState<Confiscations>({
    vehicules: initialData?.confiscations?.vehicules || 0,
    immeubles: initialData?.confiscations?.immeubles || 0,
    argentTotal: initialData?.confiscations?.argentTotal || 0
  });

  const { showToast } = useToast();
  const [service, setService] = useState(initialData?.service || '');

  // Récupération des tags via le hook
  const infractions = getTagsByCategory('infractions');
  const services = getTagsByCategory('services');

  // Handlers
  const handleNbCondamnesChange = (nb: number) => {
    setNbCondamnes(nb);
    const newCondamnations = Array(nb).fill(null).map((_, index) => {
      // Conserver les données existantes si elles existent
      if (condamnations[index]) {
        return condamnations[index];
      }
      return {
        nom: '',
        peinePrison: 0,
        sursisProbatoire: 0,
        sursisSimple: 0,
        peineAmende: 0,
        interdictionParaitre: false,
        typeAudience: 'CRPC-Def',
        defere: true,
        dateDefere: '',
        isPending: false,
        dateAudiencePending: ''
      };
    });
    setCondamnations(newCondamnations);
  };

  const updateCondamnation = (index: number, field: keyof ExtendedCondamnationData, value: string | number | boolean) => {
    const newCondamnations = [...condamnations];
    newCondamnations[index] = {
      ...newCondamnations[index],
      [field]: field === 'nom' || field === 'dateDefere' ? value : 
               field === 'interdictionParaitre' || field === 'defere' || field === 'isPending' ? Boolean(value) : 
               field === 'typeAudience' || field === 'dateAudiencePending' ? value :
               (parseInt(value as string) || 0)
    };
    setCondamnations(newCondamnations);
  };

  const handleSubmit = () => {
    try {
      if (!selectedInfraction) {
        showToast('Veuillez sélectionner un type d\'infraction', 'error');
        return;
      }

      // Vérifier que les condamnés en attente ont une date d'audience
      const pendingWithoutDate = condamnations.some(c => c.isPending && !c.dateAudiencePending);
      if (pendingWithoutDate) {
        showToast('Veuillez renseigner la date d\'audience pour tous les condamnés en attente', 'error');
        return;
      }

      // Séparer les condamnations finalisées des pending
      const finalizedCondamnations = condamnations.filter(c => !c.isPending);
      const pendingCondamnations = condamnations.filter(c => c.isPending);

      // Déterminer si l'enquête a des résultats partiels
      const hasPartialResults = finalizedCondamnations.length > 0 && pendingCondamnations.length > 0;

      // Vérifier si des défèrements étaient attendus (depuis audience en attente)
      const nbDeferesSaisis = finalizedCondamnations.filter(c => c.defere).length;
      const nbDeferesAttendus = initialData?.nombreDeferes;
      
      if (nbDeferesAttendus && nbDeferesSaisis !== nbDeferesAttendus) {
        showToast(
          `Attention : ${nbDeferesAttendus} déférés attendus, ${nbDeferesSaisis} saisis`,
          'warning'
        );
      }

      const resultat: ResultatAudience = {
        enqueteId,
        dateAudience,
        condamnations: finalizedCondamnations.filter(c => 
          c.peinePrison > 0 || c.sursisProbatoire > 0 || 
          c.sursisSimple > 0 || c.peineAmende > 0
        ),
        confiscations,
        typeInfraction: selectedInfraction,
        isDirectResult,
        service: isDirectResult ? service : undefined,
        // Nouvelles propriétés pour gérer les résultats partiels
        hasPartialResults,
        pendingCondamnations: pendingCondamnations.map(c => ({
          nom: c.nom,
          dateAudiencePending: c.dateAudiencePending
        })),
        isPartiallyPending: hasPartialResults,
        // Supprimer nombreDeferes et dateDefere car maintenant dans les condamnations
        nombreDeferes: undefined,
        dateDefere: undefined
      };
      
      console.log('Calling onSave with resultat:', resultat);
      onSave(resultat);
      showToast('Résultats d\'audience enregistrés', 'success');
      onClose();
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      showToast('Erreur lors de l\'enregistrement des résultats', 'error');
    }
  };

  // Compter les condamnations finalisées et en attente
  const finalizedCount = condamnations.filter(c => !c.isPending).length;
  const pendingCount = condamnations.filter(c => c.isPending).length;

  // Render
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDirectResult ? 'Procédure de permanence' : 'Résultats d\'audience'}
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                <Clock className="h-3 w-3 mr-1" />
                {pendingCount} en attente
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date d'audience */}
          <div>
            <Label>Date d'audience principale</Label>
            <Input
              type="date"
              value={dateAudience}
              onChange={(e) => setDateAudience(e.target.value)}
              required
            />
            <p className="text-sm text-gray-500 mt-1">
              Pour les condamnés finalisés. Les dates spécifiques sont renseignées individuellement.
            </p>
          </div>

          {/* Type d'infraction */}
          <div>
            <Label>Type d'infraction principal</Label>
            <select
              className="w-full p-2 border rounded"
              value={selectedInfraction}
              onChange={(e) => setSelectedInfraction(e.target.value)}
              required
            >
              <option value="">Sélectionner...</option>
              {infractions.map((infraction) => (
                <option key={infraction.id} value={infraction.value}>
                  {infraction.value}
                </option>
              ))}
            </select>
          </div>

          {/* Ajout du champ service uniquement pour les procédures de permanence */}
          {isDirectResult && (
            <div>
              <Label>Service</Label>
              <select
                className="w-full p-2 border rounded"
                value={service}
                onChange={(e) => setService(e.target.value)}
                required
              >
                <option value="">Sélectionner...</option>
                {services.map((service) => (
                  <option key={service.id} value={service.value}>
                    {service.value}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Nombre de condamnés */}
          <div>
            <Label>Nombre total de personnes concernées</Label>
            <Input
              type="number"
              min="0"
              value={nbCondamnes}
              onChange={(e) => handleNbCondamnesChange(parseInt(e.target.value) || 0)}
            />
            {finalizedCount > 0 && pendingCount > 0 && (
              <p className="text-sm text-blue-600 mt-1">
                {finalizedCount} finalisé(s) • {pendingCount} en attente
              </p>
            )}
          </div>

          {/* Liste des condamnés */}
          {condamnations.map((condamnation, index) => (
            <div 
              key={index} 
              className={`space-y-4 border-t pt-4 ${
                condamnation.isPending ? 'bg-blue-50 p-4 rounded-lg border-blue-200' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  Condamné {index + 1}
                  {condamnation.isPending && (
                    <Badge variant="outline" className="ml-2 bg-blue-100 text-blue-800">
                      En attente
                    </Badge>
                  )}
                </h3>
                
                {/* Toggle statut pending */}
                <div className="flex items-center space-x-2">
                  <Label className="text-sm">En attente d'audience</Label>
                  <Switch
                    checked={condamnation.isPending || false}
                    onCheckedChange={(checked) => updateCondamnation(index, 'isPending', checked)}
                  />
                </div>
              </div>
              
              {/* Informations de base */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Nom du condamné</Label>
                  {misEnCause.length > 0 && (
                    <datalist id={`mec-suggestions-${index}`}>
                      {misEnCause.map(mec => (
                        <option key={mec.id} value={mec.nom} />
                      ))}
                    </datalist>
                  )}
                  <Input
                    type="text"
                    value={condamnation.nom || ''}
                    onChange={(e) => updateCondamnation(index, 'nom', e.target.value)}
                    placeholder="Nom du condamné"
                    list={misEnCause.length > 0 ? `mec-suggestions-${index}` : undefined}
                  />
                </div>
                
                {condamnation.isPending && (
                  <div>
                    <Label>Date d'audience prévue</Label>
                    <Input
                      type="date"
                      value={condamnation.dateAudiencePending || ''}
                      onChange={(e) => updateCondamnation(index, 'dateAudiencePending', e.target.value)}
                      className="border-blue-300"
                    />
                  </div>
                )}
              </div>

              {/* Détails seulement si pas en attente */}
              {!condamnation.isPending && (
                <>
                  {/* Type d'audience et déférement */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <Label>Type d'audience</Label>
                      <select
                        className="w-full p-2 border rounded"
                        value={condamnation.typeAudience}
                        onChange={(e) => updateCondamnation(index, 'typeAudience', e.target.value)}
                      >
                        <option value="CRPC-Def">CRPC-Def</option>
                        <option value="CI">CI</option>
                        <option value="COPJ">COPJ</option>
                        <option value="OI">OI</option>
                        <option value="CDD">CDD</option>
                      </select>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Label>Déférement</Label>
                      <Switch
                        checked={condamnation.defere}
                        onCheckedChange={(checked) => updateCondamnation(index, 'defere', checked)}
                      />
                    </div>
                  </div>

                  {/* Date de déférement si déféré */}
                  {condamnation.defere && (
                    <div className="mb-4">
                      <Label>Date du déférement</Label>
                      <Input
                        type="date"
                        value={condamnation.dateDefere || ''}
                        onChange={(e) => updateCondamnation(index, 'dateDefere', e.target.value)}
                        className="border-blue-300"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Pour les stats, cette date sera utilisée plutôt que la date d'audience
                      </p>
                    </div>
                  )}

                  {/* Peines */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Peine de prison ferme (mois)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.peinePrison}
                        onChange={(e) => updateCondamnation(index, 'peinePrison', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Sursis probatoire (mois)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.sursisProbatoire}
                        onChange={(e) => updateCondamnation(index, 'sursisProbatoire', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Sursis simple (mois)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.sursisSimple}
                        onChange={(e) => updateCondamnation(index, 'sursisSimple', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Amende (€)</Label>
                      <Input
                        type="number"
                        min="0"
                        value={condamnation.peineAmende}
                        onChange={(e) => updateCondamnation(index, 'peineAmende', e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id={`interdiction-${index}`}
                        checked={!!condamnation.interdictionParaitre}
                        onChange={(e) => updateCondamnation(index, 'interdictionParaitre', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor={`interdiction-${index}`}>Interdiction de paraître</Label>
                    </div>
                  </div>
                </>
              )}

              {condamnation.isPending && (
                <div className="bg-blue-100 p-3 rounded border-l-4 border-blue-400">
                  <p className="text-sm text-blue-800">
                    Cette personne sera jugée ultérieurement. L'enquête apparaîtra dans les "Audiences en attente" 
                    jusqu'à la finalisation de ce dossier.
                  </p>
                </div>
              )}
            </div>
          ))}

          {/* Confiscations */}
          <div className="border-t pt-4">
            <h3 className="font-medium mb-4">Confiscations</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nombre de véhicules</Label>
                <Input
                  type="number"
                  min="0"
                  value={confiscations.vehicules}
                  onChange={(e) => setConfiscations(prev => ({
                    ...prev,
                    vehicules: parseInt(e.target.value) || 0
                  }))}
                />
              </div>
              <div>
                <Label>Nombre d'immeubles</Label>
                <Input
                  type="number"
                  min="0"
                  value={confiscations.immeubles}
                  onChange={(e) => setConfiscations(prev => ({
                    ...prev,
                    immeubles: parseInt(e.target.value) || 0
                  }))}
                />
              </div>
              <div className="col-span-2">
                <Label>Montant total des confiscations (€)</Label>
                <Input
                  type="number"
                  min="0"
                  value={confiscations.argentTotal}
                  onChange={(e) => setConfiscations(prev => ({
                    ...prev,
                    argentTotal: parseInt(e.target.value) || 0
                  }))}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button 
            onClick={handleSubmit}
            disabled={!dateAudience || nbCondamnes === 0 || !selectedInfraction}
          >
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};