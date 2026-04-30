import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { MecAutocompleteInput } from '../ui/MecAutocompleteInput';
import { CondamnationData, Confiscations, ResultatAudience, VehiculeSaisi, ImmeubleSaisi, SaisieBancaire, CryptoSaisie, ObjetMobilier, TypeVehicule, TypeImmeuble, CategorieObjet, TypeStupefiant, StupefiantSaisi, emptyConfiscations, migrateConfiscations } from '@/types/audienceTypes';
import { useToast } from '@/contexts/ToastContext';
import { useAudience } from '@/hooks/useAudience';
import { useTags } from '@/hooks/useTags';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '../ui/badge';
import { Clock } from 'lucide-react';
import { SuiviAlertModal } from './SuiviAlertModal';
import { OverboardPinnedAlertModal } from './OverboardPinnedAlertModal';
import { Tag, ToDoItem } from '@/types/interfaces';

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
  enqueteNumero?: string;
  enqueteTags?: Tag[];
  onCreateGlobalTodo?: (todo: ToDoItem) => void;
  isOverboardPinned?: boolean;
}

export const AudienceResultModal = ({
  isOpen,
  onClose,
  onSave,
  enqueteId,
  defaultDate,
  initialData,
  isDirectResult,
  misEnCause = [],
  enqueteNumero = '',
  enqueteTags = [],
  onCreateGlobalTodo,
  isOverboardPinned = false,
}: AudienceResultModalProps) => {
  // States
  const { getTagsByCategory } = useTags();
  const [dateAudience, setDateAudience] = useState(initialData?.dateAudience || defaultDate || '');
  const [selectedInfraction, setSelectedInfraction] = useState(initialData?.typeInfraction || '');

  // Date de défèrement issue de l'audience en attente (commune, à pré-remplir sur chaque condamné déféré)
  const pendingDateDefere = initialData?.dateDefere || '';

  // Re-hydrater les pendingCondamnations depuis initialData (résultats partiels)
  const buildInitialCondamnations = (): ExtendedCondamnationData[] => {
    const finalized = (initialData?.condamnations || []).map(c => ({
      ...c,
      isPending: false,
      dateAudiencePending: c.dateAudiencePending || '',
      dateDefere: c.dateDefere || (c.defere ? pendingDateDefere : '')
    }));
    const pending = (initialData?.pendingCondamnations || []).map(p => ({
      nom: p.nom,
      peinePrison: 0,
      sursisProbatoire: 0,
      sursisSimple: 0,
      peineAmende: 0,
      interdictionParaitre: false,
      interdictionGerer: false,
      typeAudience: 'CRPC-Def' as const,
      defere: true,
      dateDefere: pendingDateDefere,
      isPending: true,
      dateAudiencePending: p.dateAudiencePending || ''
    }));
    return [...finalized, ...pending];
  };

  const initialCondamnations = buildInitialCondamnations();
  const [nbCondamnes, setNbCondamnes] = useState(initialCondamnations.length || 0);
  const [condamnations, setCondamnations] = useState<ExtendedCondamnationData[]>(initialCondamnations);
  // Si des saisies existent et que les confiscations sont vides, pré-remplir les confiscations depuis les saisies
  const getInitialConfiscations = (): Confiscations => {
    if (initialData?.confiscations) {
      const migrated = migrateConfiscations(initialData.confiscations);
      const isEmpty = migrated.vehicules.length === 0 && migrated.immeubles.length === 0 &&
        migrated.numeraire === 0 && migrated.saisiesBancaires.length === 0 &&
        migrated.cryptomonnaies.length === 0 && migrated.objetsMobiliers.length === 0 &&
        !migrated.stupefiants?.types?.length;
      // Si confiscations déjà renseignées, les utiliser
      if (!isEmpty) return migrated;
    }
    // Sinon, pré-remplir depuis les saisies si disponibles
    if (initialData?.saisies) {
      return JSON.parse(JSON.stringify(initialData.saisies));
    }
    return emptyConfiscations();
  };
  const [confiscations, setConfiscations] = useState<Confiscations>(getInitialConfiscations());
  const [prefilledFromSaisies] = useState<boolean>(() => {
    if (!initialData?.saisies) return false;
    if (initialData?.confiscations) {
      const migrated = migrateConfiscations(initialData.confiscations);
      const isEmpty = migrated.vehicules.length === 0 && migrated.immeubles.length === 0 &&
        migrated.numeraire === 0 && migrated.saisiesBancaires.length === 0 &&
        migrated.cryptomonnaies.length === 0 && migrated.objetsMobiliers.length === 0 &&
        !migrated.stupefiants?.types?.length;
      return isEmpty;
    }
    return true;
  });

  const { showToast } = useToast();
  const { audienceState } = useAudience();
  const [service, setService] = useState(initialData?.service || '');
  const [showSuiviAlert, setShowSuiviAlert] = useState(false);
  const [showOverboardAlert, setShowOverboardAlert] = useState(false);
  const hasSuivi = enqueteTags.some(t => t.category === 'suivi');

  // Lieux d'interdiction de paraître déjà enregistrés (pour suggestions)
  const lieuxInterdictionExistants = React.useMemo(() => {
    const defaultLieux = ['Somme', 'Amiens', 'Abbeville', 'Péronne', 'Montdidier'];
    const allResultats = audienceState?.resultats ? Object.values(audienceState.resultats) : [];
    const lieuxFromData = allResultats
      .flatMap(r => r.condamnations || [])
      .map(c => c.lieuInterdictionParaitre)
      .filter((l): l is string => !!l && l.trim() !== '');
    return [...new Set([...defaultLieux, ...lieuxFromData])].sort();
  }, [audienceState?.resultats]);

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
        interdictionGerer: false,
        typeAudience: 'CRPC-Def' as const,
        defere: true,
        dateDefere: pendingDateDefere,
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
      [field]: field === 'nom' || field === 'dateDefere' || field === 'lieuInterdictionParaitre' ? value :
               field === 'interdictionParaitre' || field === 'interdictionGerer' || field === 'defere' || field === 'isPending' ? Boolean(value) :
               field === 'typeAudience' || field === 'dateAudiencePending' ? value :
               (parseInt(value as string) || 0)
    };
    setCondamnations(newCondamnations);
  };

  // Handler spécifique pour le nom : auto-remplit misEnCauseId si le nom correspond à un MEC connu
  const updateCondamnationNom = (index: number, nom: string) => {
    const matchedMec = misEnCause.find(m => m.nom.toLowerCase() === nom.toLowerCase());
    const newCondamnations = [...condamnations];
    newCondamnations[index] = {
      ...newCondamnations[index],
      nom,
      misEnCauseId: matchedMec ? matchedMec.id : undefined
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
          nom: c.nom || '',
          dateAudiencePending: c.dateAudiencePending || ''
        })),
        isPartiallyPending: hasPartialResults,
        // Supprimer nombreDeferes et dateDefere car maintenant dans les condamnations
        nombreDeferes: undefined,
        dateDefere: undefined
      };
      
      console.log('Calling onSave with resultat:', resultat);
      onSave(resultat);
      showToast('Résultats d\'audience enregistrés', 'success');
      if (isOverboardPinned) {
        setShowOverboardAlert(true);
      } else if (hasSuivi) {
        setShowSuiviAlert(true);
      } else {
        onClose();
      }
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
                  <Label>
                    Nom du condamné
                    {condamnation.misEnCauseId && (
                      <span className="ml-2 text-xs text-green-600 font-normal">lié au dossier</span>
                    )}
                  </Label>
                  <MecAutocompleteInput
                    value={condamnation.nom || ''}
                    onChange={(val) => updateCondamnationNom(index, val)}
                    suggestions={misEnCause.map(m => m.nom)}
                    minTriggerLength={2}
                    placeholder="Nom du condamné"
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
                    {condamnation.interdictionParaitre && (
                      <div className="col-span-2 grid grid-cols-2 gap-4 mt-1 pl-6 border-l-2 border-amber-300">
                        <div>
                          <Label>Lieu d'interdiction</Label>
                          <Input
                            list={`lieux-interdiction-${index}`}
                            placeholder="Ex: Amiens"
                            value={condamnation.lieuInterdictionParaitre || ''}
                            onChange={(e) => updateCondamnation(index, 'lieuInterdictionParaitre', e.target.value)}
                          />
                          <datalist id={`lieux-interdiction-${index}`}>
                            {lieuxInterdictionExistants.map(lieu => (
                              <option key={lieu} value={lieu} />
                            ))}
                          </datalist>
                        </div>
                        <div>
                          <Label>Durée (mois)</Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Ex: 12"
                            value={condamnation.dureeInterdictionParaitre || ''}
                            onChange={(e) => updateCondamnation(index, 'dureeInterdictionParaitre', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    <div className="col-span-2 flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id={`interdiction-gerer-${index}`}
                        checked={!!condamnation.interdictionGerer}
                        onChange={(e) => updateCondamnation(index, 'interdictionGerer', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <Label htmlFor={`interdiction-gerer-${index}`}>Interdiction de gérer</Label>
                    </div>
                    {condamnation.interdictionGerer && (
                      <div className="col-span-2 pl-6 border-l-2 border-purple-300 mt-1">
                        <div>
                          <Label>Durée (mois)</Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="Ex: 24"
                            value={condamnation.dureeInterdictionGerer || ''}
                            onChange={(e) => updateCondamnation(index, 'dureeInterdictionGerer', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
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
            <h3 className="font-medium mb-4">Confiscations et saisies</h3>
            {prefilledFromSaisies && (
              <div className="bg-green-50 border border-green-200 p-3 rounded-lg mb-4">
                <p className="text-sm text-green-800 font-medium">
                  Les confiscations ont été pré-remplies depuis les saisies effectuées en phase d'enquête.
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Vous pouvez valider tel quel ou modifier les valeurs si le juge a confisqué différemment.
                </p>
              </div>
            )}

            {/* --- Véhicules --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                <span>Véhicules ({confiscations.vehicules.length})</span>
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  setConfiscations(prev => ({
                    ...prev,
                    vehicules: [...prev.vehicules, { type: 'voiture' as TypeVehicule }]
                  }));
                }}>+ Ajouter</Button>
              </summary>
              <div className="p-3 space-y-3">
                {confiscations.vehicules.map((v, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 items-end bg-gray-50 p-2 rounded">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <select className="w-full p-1.5 border rounded text-sm" value={v.type} onChange={(e) => {
                        const arr = [...confiscations.vehicules];
                        arr[i] = { ...arr[i], type: e.target.value as TypeVehicule };
                        setConfiscations(prev => ({ ...prev, vehicules: arr }));
                      }}>
                        <option value="voiture">Voiture</option>
                        <option value="moto">Moto</option>
                        <option value="scooter">Scooter</option>
                        <option value="utilitaire">Utilitaire</option>
                        <option value="poids_lourd">Poids lourd</option>
                        <option value="bateau">Bateau</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Marque / Modèle</Label>
                      <Input className="text-sm" placeholder="Ex: BMW X3" value={v.marqueModele || ''} onChange={(e) => {
                        const arr = [...confiscations.vehicules];
                        arr[i] = { ...arr[i], marqueModele: e.target.value };
                        setConfiscations(prev => ({ ...prev, vehicules: arr }));
                      }} />
                    </div>
                    <div>
                      <Label className="text-xs">Immatriculation</Label>
                      <Input className="text-sm" placeholder="AA-123-BB" value={v.immatriculation || ''} onChange={(e) => {
                        const arr = [...confiscations.vehicules];
                        arr[i] = { ...arr[i], immatriculation: e.target.value };
                        setConfiscations(prev => ({ ...prev, vehicules: arr }));
                      }} />
                    </div>
                    <div className="flex gap-1 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Valeur (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={v.valeurEstimee || ''} onChange={(e) => {
                          const arr = [...confiscations.vehicules];
                          arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined };
                          setConfiscations(prev => ({ ...prev, vehicules: arr }));
                        }} />
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => {
                        setConfiscations(prev => ({ ...prev, vehicules: prev.vehicules.filter((_, j) => j !== i) }));
                      }}>×</Button>
                    </div>
                  </div>
                ))}
                {confiscations.vehicules.length === 0 && <p className="text-sm text-gray-400">Aucun véhicule saisi</p>}
              </div>
            </details>

            {/* --- Immeubles --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                <span>Immeubles ({confiscations.immeubles.length})</span>
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  setConfiscations(prev => ({
                    ...prev,
                    immeubles: [...prev.immeubles, { type: 'appartement' as TypeImmeuble }]
                  }));
                }}>+ Ajouter</Button>
              </summary>
              <div className="p-3 space-y-3">
                {confiscations.immeubles.map((im, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 items-end bg-gray-50 p-2 rounded">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <select className="w-full p-1.5 border rounded text-sm" value={im.type} onChange={(e) => {
                        const arr = [...confiscations.immeubles];
                        arr[i] = { ...arr[i], type: e.target.value as TypeImmeuble };
                        setConfiscations(prev => ({ ...prev, immeubles: arr }));
                      }}>
                        <option value="appartement">Appartement</option>
                        <option value="maison">Maison</option>
                        <option value="terrain">Terrain</option>
                        <option value="local_commercial">Local commercial</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Adresse</Label>
                      <Input className="text-sm" value={im.adresse || ''} onChange={(e) => {
                        const arr = [...confiscations.immeubles];
                        arr[i] = { ...arr[i], adresse: e.target.value };
                        setConfiscations(prev => ({ ...prev, immeubles: arr }));
                      }} />
                    </div>
                    <div className="flex gap-1 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Valeur (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={im.valeurEstimee || ''} onChange={(e) => {
                          const arr = [...confiscations.immeubles];
                          arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined };
                          setConfiscations(prev => ({ ...prev, immeubles: arr }));
                        }} />
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => {
                        setConfiscations(prev => ({ ...prev, immeubles: prev.immeubles.filter((_, j) => j !== i) }));
                      }}>×</Button>
                    </div>
                  </div>
                ))}
                {confiscations.immeubles.length === 0 && <p className="text-sm text-gray-400">Aucun immeuble saisi</p>}
              </div>
            </details>

            {/* --- Avoirs financiers --- */}
            <details className="mb-4 border rounded-lg" open>
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg">Avoirs financiers</summary>
              <div className="p-3 space-y-4">
                {/* Numéraire */}
                <div>
                  <Label>Numéraire (espèces saisies) (€)</Label>
                  <Input type="number" min="0" value={confiscations.numeraire || ''} onChange={(e) =>
                    setConfiscations(prev => ({ ...prev, numeraire: parseInt(e.target.value) || 0 }))
                  } />
                </div>

                {/* Saisies bancaires */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label>Saisies bancaires</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() =>
                      setConfiscations(prev => ({ ...prev, saisiesBancaires: [...prev.saisiesBancaires, { montant: 0 }] }))
                    }>+ Ajouter</Button>
                  </div>
                  {confiscations.saisiesBancaires.map((sb, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2 items-end mb-2 bg-gray-50 p-2 rounded">
                      <div>
                        <Label className="text-xs">Montant (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={sb.montant || ''} onChange={(e) => {
                          const arr = [...confiscations.saisiesBancaires];
                          arr[i] = { ...arr[i], montant: parseInt(e.target.value) || 0 };
                          setConfiscations(prev => ({ ...prev, saisiesBancaires: arr }));
                        }} />
                      </div>
                      <div>
                        <Label className="text-xs">Banque</Label>
                        <Input className="text-sm" placeholder="Ex: BNP" value={sb.banque || ''} onChange={(e) => {
                          const arr = [...confiscations.saisiesBancaires];
                          arr[i] = { ...arr[i], banque: e.target.value };
                          setConfiscations(prev => ({ ...prev, saisiesBancaires: arr }));
                        }} />
                      </div>
                      <div className="flex gap-1 items-end">
                        <div className="flex-1">
                          <Label className="text-xs">Réf. AGRASC</Label>
                          <Input className="text-sm" value={sb.referenceAgrasc || ''} onChange={(e) => {
                            const arr = [...confiscations.saisiesBancaires];
                            arr[i] = { ...arr[i], referenceAgrasc: e.target.value };
                            setConfiscations(prev => ({ ...prev, saisiesBancaires: arr }));
                          }} />
                        </div>
                        <Button type="button" variant="destructive" size="sm" onClick={() => {
                          setConfiscations(prev => ({ ...prev, saisiesBancaires: prev.saisiesBancaires.filter((_, j) => j !== i) }));
                        }}>×</Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Cryptomonnaies */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label>Cryptomonnaies</Label>
                    <Button type="button" variant="outline" size="sm" onClick={() =>
                      setConfiscations(prev => ({ ...prev, cryptomonnaies: [...prev.cryptomonnaies, { montantEur: 0 }] }))
                    }>+ Ajouter</Button>
                  </div>
                  {confiscations.cryptomonnaies.map((cr, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 items-end mb-2 bg-gray-50 p-2 rounded">
                      <div>
                        <Label className="text-xs">Valeur en € (au moment de la saisie)</Label>
                        <Input className="text-sm" type="number" min="0" value={cr.montantEur || ''} onChange={(e) => {
                          const arr = [...confiscations.cryptomonnaies];
                          arr[i] = { ...arr[i], montantEur: parseInt(e.target.value) || 0 };
                          setConfiscations(prev => ({ ...prev, cryptomonnaies: arr }));
                        }} />
                      </div>
                      <div className="flex gap-1 items-end">
                        <div className="flex-1">
                          <Label className="text-xs">Type (BTC, ETH...)</Label>
                          <Input className="text-sm" placeholder="Ex: Bitcoin" value={cr.typeCrypto || ''} onChange={(e) => {
                            const arr = [...confiscations.cryptomonnaies];
                            arr[i] = { ...arr[i], typeCrypto: e.target.value };
                            setConfiscations(prev => ({ ...prev, cryptomonnaies: arr }));
                          }} />
                        </div>
                        <Button type="button" variant="destructive" size="sm" onClick={() => {
                          setConfiscations(prev => ({ ...prev, cryptomonnaies: prev.cryptomonnaies.filter((_, j) => j !== i) }));
                        }}>×</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </details>

            {/* --- Objets mobiliers --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg flex justify-between items-center">
                <span>Objets mobiliers ({confiscations.objetsMobiliers.length})</span>
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  setConfiscations(prev => ({
                    ...prev,
                    objetsMobiliers: [...prev.objetsMobiliers, { categorie: 'electronique' as CategorieObjet, quantite: 1 }]
                  }));
                }}>+ Ajouter</Button>
              </summary>
              <div className="p-3 space-y-3">
                {confiscations.objetsMobiliers.map((obj, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 items-end bg-gray-50 p-2 rounded">
                    <div>
                      <Label className="text-xs">Catégorie</Label>
                      <select className="w-full p-1.5 border rounded text-sm" value={obj.categorie} onChange={(e) => {
                        const arr = [...confiscations.objetsMobiliers];
                        arr[i] = { ...arr[i], categorie: e.target.value as CategorieObjet };
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                      }}>
                        <option value="electronique">Électronique (TV, téléphone...)</option>
                        <option value="luxe">Luxe (vêtements, montres, bijoux...)</option>
                        <option value="transport_leger">Transport léger (trottinette, vélo...)</option>
                        <option value="informatique">Matériel informatique</option>
                        <option value="autre">Autre</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Input className="text-sm" placeholder="Ex: TV Samsung 65 pouces" value={obj.description || ''} onChange={(e) => {
                        const arr = [...confiscations.objetsMobiliers];
                        arr[i] = { ...arr[i], description: e.target.value };
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                      }} />
                    </div>
                    <div>
                      <Label className="text-xs">Quantité</Label>
                      <Input className="text-sm" type="number" min="1" value={obj.quantite} onChange={(e) => {
                        const arr = [...confiscations.objetsMobiliers];
                        arr[i] = { ...arr[i], quantite: parseInt(e.target.value) || 1 };
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                      }} />
                    </div>
                    <div className="flex gap-1 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Valeur (€)</Label>
                        <Input className="text-sm" type="number" min="0" value={obj.valeurEstimee || ''} onChange={(e) => {
                          const arr = [...confiscations.objetsMobiliers];
                          arr[i] = { ...arr[i], valeurEstimee: parseInt(e.target.value) || undefined };
                          setConfiscations(prev => ({ ...prev, objetsMobiliers: arr }));
                        }} />
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={() => {
                        setConfiscations(prev => ({ ...prev, objetsMobiliers: prev.objetsMobiliers.filter((_, j) => j !== i) }));
                      }}>×</Button>
                    </div>
                  </div>
                ))}
                {confiscations.objetsMobiliers.length === 0 && <p className="text-sm text-gray-400">Aucun objet mobilier saisi</p>}
              </div>
            </details>

            {/* --- Stupéfiants --- */}
            <details className="mb-4 border rounded-lg">
              <summary className="cursor-pointer p-3 font-medium bg-gray-50 rounded-t-lg">
                Stupéfiants {confiscations.stupefiants?.types?.length ? `(${confiscations.stupefiants.types.length} type(s))` : ''}
              </summary>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['cocaine', 'Cocaïne'],
                    ['heroine', 'Héroïne'],
                    ['cannabis', 'Cannabis'],
                    ['synthese', 'Drogues de synthèse'],
                    ['autre', 'Autre'],
                  ] as [TypeStupefiant, string][]).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                        checked={confiscations.stupefiants?.types?.includes(val) || false}
                        onChange={(e) => {
                          const current = confiscations.stupefiants?.types || [];
                          const newTypes = e.target.checked
                            ? [...current, val]
                            : current.filter(t => t !== val);
                          setConfiscations(prev => ({
                            ...prev,
                            stupefiants: newTypes.length > 0
                              ? { ...prev.stupefiants, types: newTypes, quantite: prev.stupefiants?.quantite, description: prev.stupefiants?.description }
                              : undefined
                          }));
                        }}
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
                {confiscations.stupefiants?.types?.length ? (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <Label className="text-xs">Quantité</Label>
                      <Input className="text-sm" placeholder="Ex: 5 kg" value={confiscations.stupefiants?.quantite || ''} onChange={(e) => {
                        setConfiscations(prev => ({
                          ...prev,
                          stupefiants: { ...prev.stupefiants!, quantite: e.target.value }
                        }));
                      }} />
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Input className="text-sm" placeholder="Détails..." value={confiscations.stupefiants?.description || ''} onChange={(e) => {
                        setConfiscations(prev => ({
                          ...prev,
                          stupefiants: { ...prev.stupefiants!, description: e.target.value }
                        }));
                      }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
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

      <OverboardPinnedAlertModal
        isOpen={showOverboardAlert}
        onClose={() => {
          setShowOverboardAlert(false);
          if (hasSuivi) {
            setShowSuiviAlert(true);
          } else {
            onClose();
          }
        }}
      />

      <SuiviAlertModal
        isOpen={showSuiviAlert}
        onClose={() => {
          setShowSuiviAlert(false);
          onClose();
        }}
        enqueteNumero={enqueteNumero}
        enqueteTags={enqueteTags}
        triggerContext="audience"
        onCreateTodo={onCreateGlobalTodo}
      />
    </Dialog>
  );
};