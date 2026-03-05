import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { EnqueteInstruction, Tag, MisEnExamen, DebatParquet } from '@/types/interfaces';
import { Plus, X, Edit, AlertTriangle, Copy } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useTags } from '@/hooks/useTags';

interface NewInstructionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (instruction: Omit<EnqueteInstruction, 'id' | 'dateCreation' | 'dateMiseAJour'>) => void;
}

interface MisEnExamenFormData {
  id: number;
  nom: string;
  dateExamen: string;
  infractions: string; // Chaîne séparée par virgules
  statut: 'libre' | 'cj' | 'detenu' | 'arse';
  description: string;
  datePlacementDP: string;
  dureeDP: number;
}

export const NewInstructionModal = ({
  isOpen,
  onClose,
  onSubmit
}: NewInstructionModalProps) => {
  const { showToast } = useToast();
  const { getTagsByCategory } = useTags();

  // États du formulaire principal
  const [formData, setFormData] = useState({
    numeroParquet: '',
    numeroInstruction: '',
    cabinet: '1' as '1' | '2' | '3' | '4',
    origineEnquete: 'preliminaire' as 'preliminaire' | 'flagrance',
    serviceEnqueteur: '',
    dateDebut: new Date().toISOString().split('T')[0],
    description: ''
  });

  const [selectedInfractions, setSelectedInfractions] = useState<Tag[]>([]);
  
  // États pour les mis en examen
  const [misEnExamen, setMisEnExamen] = useState<MisEnExamenFormData[]>([{
    id: Date.now(),
    nom: '',
    dateExamen: new Date().toISOString().split('T')[0],
    infractions: '',
    statut: 'libre',
    description: '',
    datePlacementDP: '',
    dureeDP: 1
  }]);

  const [editingMexId, setEditingMexId] = useState<number | null>(null);

  // Préremplissage intelligent pour les infractions
  const [lastUsedInfractions, setLastUsedInfractions] = useState<string>('');
  
  // Mettre à jour les infractions les plus utilisées à partir des mis en examen existants
  useEffect(() => {
    if (misEnExamen.length > 0) {
      const allInfractions = misEnExamen
        .map(mex => mex.infractions)
        .filter(inf => inf.trim() !== '')
        .join(', ');
      
      if (allInfractions) {
        setLastUsedInfractions(allInfractions);
      }
    }
  }, [misEnExamen]);

  // Validation du formulaire
  const isFormValid = () => {
    return (
      formData.numeroParquet.trim() !== '' &&
      formData.numeroInstruction.trim() !== '' &&
      formData.serviceEnqueteur.trim() !== '' &&
      misEnExamen.some(mec => mec.nom.trim() !== '' && mec.infractions.trim() !== '')
    );
  };

  // Gestion des infractions générales
  const handleAddInfraction = (value: string) => {
    if (value) {
      const newTag: Tag = {
        id: `infractions-${value}`,
        value,
        category: 'infractions'
      };
      if (!selectedInfractions.some(tag => tag.id === newTag.id)) {
        setSelectedInfractions(prev => [...prev, newTag]);
      }
    }
  };

  const handleRemoveInfraction = (tagId: string) => {
    setSelectedInfractions(prev => prev.filter(tag => tag.id !== tagId));
  };

  // Gestion des mis en examen AMÉLIORÉE
  const handleMisEnExamenChange = (index: number, field: keyof MisEnExamenFormData, value: string | number) => {
    const newMisEnExamen = [...misEnExamen];
    newMisEnExamen[index] = { ...newMisEnExamen[index], [field]: value };
    
    // 🆕 PRÉREMPLISSAGE AUTOMATIQUE DATE DP = DATE MISE EN EXAMEN
    if (field === 'dateExamen' && typeof value === 'string') {
      // Si le statut est détenu ou va être défini comme détenu, préremplir la date DP
      if (newMisEnExamen[index].statut === 'detenu' || !newMisEnExamen[index].datePlacementDP) {
        newMisEnExamen[index].datePlacementDP = value;
      }
    }
    
    // 🆕 PRÉREMPLISSAGE AUTOMATIQUE DATE DP QUAND ON PASSE EN DÉTENU
    if (field === 'statut' && value === 'detenu') {
      // Préremplir la date DP avec la date de mise en examen si elle n'est pas déjà remplie
      if (!newMisEnExamen[index].datePlacementDP && newMisEnExamen[index].dateExamen) {
        newMisEnExamen[index].datePlacementDP = newMisEnExamen[index].dateExamen;
      }
      // Durée par défaut à 4 mois si pas encore définie
      if (!newMisEnExamen[index].dureeDP || newMisEnExamen[index].dureeDP === 1) {
        newMisEnExamen[index].dureeDP = 4;
      }
    }
    
    // Calcul automatique de la date de fin DP si détenu
    if (field === 'datePlacementDP' || field === 'dureeDP' || field === 'statut') {
      const mex = newMisEnExamen[index];
      if (mex.statut === 'detenu' && mex.datePlacementDP && mex.dureeDP > 0) {
        // La date de fin sera calculée lors de la soumission
      } else if (mex.statut !== 'detenu') {
        // Nettoyer les champs DP si pas détenu
        mex.datePlacementDP = '';
        mex.dureeDP = 1;
      }
    }
    
    setMisEnExamen(newMisEnExamen);
  };

  const addMisEnExamen = () => {
    // 🆕 PRÉREMPLIR LES INFRACTIONS DU DERNIER MIS EN EXAMEN
    const lastMex = misEnExamen[misEnExamen.length - 1];
    const defaultInfractions = lastMex?.infractions.trim() !== '' ? lastMex.infractions : lastUsedInfractions;
    
    setMisEnExamen([...misEnExamen, {
      id: Date.now(),
      nom: '',
      dateExamen: new Date().toISOString().split('T')[0],
      infractions: defaultInfractions, // 🆕 Préremplissage intelligent
      statut: 'libre',
      description: '',
      datePlacementDP: '',
      dureeDP: 4 // 🆕 Durée par défaut plus réaliste
    }]);
  };

  const removeMisEnExamen = (index: number) => {
    if (misEnExamen.length > 1) {
      setMisEnExamen(misEnExamen.filter((_, i) => i !== index));
    }
  };

  // 🆕 FONCTION POUR COPIER LES INFRACTIONS DU PRÉCÉDENT
  const copyInfractionsToPrevious = (currentIndex: number) => {
    if (currentIndex > 0) {
      const newMisEnExamen = [...misEnExamen];
      newMisEnExamen[currentIndex].infractions = misEnExamen[currentIndex - 1].infractions;
      setMisEnExamen(newMisEnExamen);
      showToast('Infractions copiées', 'success');
    }
  };

  // Validation spécifique d'un mis en examen
  const validateMisEnExamen = (mex: MisEnExamenFormData): string | null => {
    if (!mex.nom.trim()) return 'Nom requis';
    if (!mex.infractions.trim()) return 'Infractions requises';
    if (mex.statut === 'detenu') {
      if (!mex.datePlacementDP) return 'Date de placement DP requise';
      if (!mex.dureeDP || mex.dureeDP <= 0) return 'Durée DP requise';
    }
    return null;
  };

  // Calculer la date de fin DP
  const calculateDateFinDP = (datePlacement: string, duree: number): string => {
    const date = new Date(datePlacement);
    date.setMonth(date.getMonth() + duree);
    return date.toISOString().split('T')[0];
  };

  // Soumission du formulaire
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isFormValid()) {
      showToast('Veuillez remplir tous les champs obligatoires', 'error');
      return;
    }

    // Validation des mis en examen
    for (const mex of misEnExamen) {
      if (mex.nom.trim() === '') continue; // Ignorer les lignes vides
      
      const error = validateMisEnExamen(mex);
      if (error) {
        showToast(`Erreur pour ${mex.nom || 'un mis en examen'}: ${error}`, 'error');
        return;
      }
    }

    // Conversion des mis en examen au format attendu
    const validMisEnExamen = misEnExamen
      .filter(mex => mex.nom.trim() !== '')
      .map(mex => {
        const misEnExamenData: MisEnExamen = {
          id: mex.id,
          nom: mex.nom.trim(),
          dateExamen: mex.dateExamen,
          chefs: mex.infractions.split(',').map(inf => inf.trim()).filter(Boolean),
          role: mex.statut === 'detenu' ? 'detenu' : 'libre',
          statut: mex.statut,
          description: mex.description.trim() || undefined,
          datePlacementDP: mex.statut === 'detenu' ? mex.datePlacementDP : undefined,
          dureeInitialeDP: mex.statut === 'detenu' ? mex.dureeDP : undefined,
          dateFinDP: mex.statut === 'detenu' && mex.datePlacementDP 
            ? calculateDateFinDP(mex.datePlacementDP, mex.dureeDP) 
            : undefined
        };
        return misEnExamenData;
      });

    // Création des débats parquet automatiques pour les détenus
    const debatsParquet: DebatParquet[] = [];
    validMisEnExamen.forEach(mex => {
      if (mex.statut === 'detenu' && mex.datePlacementDP) {
        const debat: DebatParquet = {
          id: Date.now() + Math.random(), // ID unique
          date: mex.datePlacementDP,
          type: 'placement_dp',
          issue: 'Accordé',
          notes: `Placement DP automatique - ${mex.nom}`,
          concernedDetenu: mex.id,
          sourceType: 'manual'
        };
        debatsParquet.push(debat);
        
        // Ajouter l'historique au mis en examen
        if (!mex.debatsHistory) mex.debatsHistory = [];
        mex.debatsHistory.push({
          debatId: debat.id,
          type: 'placement_dp',
          date: mex.datePlacementDP!,
          decision: 'Accordé'
        });
      }
    });

    const newInstruction = {
      // Champs spécifiques instruction
      numeroParquet: formData.numeroParquet.trim(),
      numeroInstruction: formData.numeroInstruction.trim(),
      cabinet: formData.cabinet,
      origineEnquete: formData.origineEnquete,
      serviceEnqueteur: formData.serviceEnqueteur.trim(),
      
      // Champs enquête de base
      numero: `${formData.numeroParquet.trim()}_${formData.numeroInstruction.trim()}`,
      dateDebut: formData.dateDebut,
      services: [formData.serviceEnqueteur.trim()],
      description: formData.description.trim(),
      misEnCause: [], // Vide pour les instructions
      tags: selectedInfractions,
      
      // État initial
      statut: 'instruction' as const,
      etatReglement: 'instruction' as const,
      
      // Compteurs initiaux
      cotesTomes: 0,
      
      // Listes vides
      comptesRendus: [],
      actes: [],
      ecoutes: [],
      geolocalisations: [],
      dmls: [],
      ops: [],
      
      // Mis en examen et débats
      misEnExamen: validMisEnExamen,
      debatsParquet: debatsParquet,
      
      // Notes vides
      notes: '',
      
      // Propriétés calculées
      nbDML: 0,
      nbCotes: 0,
      nbDebatsParquet: debatsParquet.length,
      nbMisEnExamen: validMisEnExamen.length,
      nbPagesTotal: 0
    };

    onSubmit(newInstruction);
    
    // Reset du formulaire
    setFormData({
      numeroParquet: '',
      numeroInstruction: '',
      cabinet: '1',
      origineEnquete: 'preliminaire',
      serviceEnqueteur: '',
      dateDebut: new Date().toISOString().split('T')[0],
      description: ''
    });
    setSelectedInfractions([]);
    setMisEnExamen([{
      id: Date.now(),
      nom: '',
      dateExamen: new Date().toISOString().split('T')[0],
      infractions: '',
      statut: 'libre',
      description: '',
      datePlacementDP: '',
      dureeDP: 1
    }]);
    setEditingMexId(null);
    setLastUsedInfractions('');
    
    const detenus = validMisEnExamen.filter(mex => mex.statut === 'detenu').length;
    if (detenus > 0) {
      showToast(`Dossier créé avec ${detenus} débat(s) parquet automatique(s)`, 'success');
    } else {
      showToast('Dossier d\'instruction créé avec succès', 'success');
    }
    
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Nouveau dossier d'instruction</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Informations obligatoires */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="numeroParquet">Numéro parquet *</Label>
              <Input
                id="numeroParquet"
                placeholder="Ex: 24.139.217"
                value={formData.numeroParquet}
                onChange={(e) => setFormData({...formData, numeroParquet: e.target.value})}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="numeroInstruction">Numéro instruction *</Label>
              <Input
                id="numeroInstruction"
                placeholder="Ex: JIRS AC 23/05"
                value={formData.numeroInstruction}
                onChange={(e) => setFormData({...formData, numeroInstruction: e.target.value})}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateDebut">Date ouverture information *</Label>
              <Input
                id="dateDebut"
                type="date"
                value={formData.dateDebut}
                onChange={(e) => setFormData({...formData, dateDebut: e.target.value})}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cabinet">Cabinet *</Label>
              <Select
                value={formData.cabinet}
                onChange={(e) => setFormData({...formData, cabinet: e.target.value as '1'|'2'|'3'|'4'})}
                required
              >
                <option value="1">Cabinet 1</option>
                <option value="2">Cabinet 2</option>
                <option value="3">Cabinet 3</option>
                <option value="4">Cabinet 4</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="origineEnquete">Origine enquête *</Label>
              <Select
                value={formData.origineEnquete}
                onChange={(e) => setFormData({...formData, origineEnquete: e.target.value as 'preliminaire'|'flagrance'})}
                required
              >
                <option value="preliminaire">Préliminaire</option>
                <option value="flagrance">Flagrance</option>
              </Select>
            </div>
          </div>

          {/* Service enquêteur */}
          <div className="space-y-2">
            <Label htmlFor="serviceEnqueteur">Service enquêteur *</Label>
            <Select
              value={formData.serviceEnqueteur}
              onChange={(e) => setFormData({...formData, serviceEnqueteur: e.target.value})}
              required
            >
              <option value="">Sélectionner un service</option>
              {getTagsByCategory('services').map((service) => (
  <option key={service.id} value={service.value}>
    {service.value}
  </option>
))}
            </Select>
          </div>

          {/* Type d'infractions */}
          <div className="space-y-2">
            <Label>Type d'infractions générales</Label>
            <Select
              value=""
              onChange={(e) => handleAddInfraction(e.target.value)}
            >
              <option value="">Sélectionner un type d'infraction</option>
              {getTagsByCategory('infractions').map((infraction) => (
  <option key={infraction.id} value={infraction.value}>
    {infraction.value}
  </option>
))}
            </Select>

            <div className="flex flex-wrap gap-2 mt-2">
              {selectedInfractions.map(tag => (
                <Badge key={tag.id} variant="secondary" className="flex items-center">
                  {tag.value}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 ml-2"
                    onClick={() => handleRemoveInfraction(tag.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          </div>

          {/* Mis en examen - Section complète AMÉLIORÉE */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-lg font-semibold">Mis en examen *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addMisEnExamen}
                className="flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>

            <div className="space-y-4">
              {misEnExamen.map((mex, index) => {
                const isEditing = editingMexId === mex.id;
                const isExpiredDP = mex.statut === 'detenu' && mex.datePlacementDP && mex.dureeDP && (() => {
                  const dateFin = calculateDateFinDP(mex.datePlacementDP, mex.dureeDP);
                  return new Date(dateFin) < new Date();
                })();

                const statutColors = {
                  libre: 'bg-green-100 text-green-700 border-green-300',
                  cj: 'bg-blue-100 text-blue-700 border-blue-300',
                  detenu: 'bg-orange-100 text-orange-700 border-orange-300',
                  arse: 'bg-purple-100 text-purple-700 border-purple-300'
                };

                const statutLabels = {
                  libre: 'Libre',
                  cj: 'Contrôle judiciaire',
                  detenu: 'Détenu',
                  arse: 'ARSE'
                };

                return (
                  <div key={mex.id} className="border rounded-lg p-4 bg-gray-50">
                    {isEditing || !mex.nom ? (
                      /* MODE ÉDITION COMPLET AMÉLIORÉ */
                      <div className="space-y-3">
                        {/* Ligne 1: Nom et date avec préremplissage automatique */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Nom et prénom *</Label>
                            <Input
                              value={mex.nom}
                              onChange={(e) => handleMisEnExamenChange(index, 'nom', e.target.value)}
                              placeholder="Nom complet"
                              className="mt-1"
                              required
                            />
                          </div>
                          <div>
                            <Label>Date mise en examen *</Label>
                            <Input
                              type="date"
                              value={mex.dateExamen}
                              onChange={(e) => handleMisEnExamenChange(index, 'dateExamen', e.target.value)}
                              className="mt-1"
                              required
                            />
                            {mex.statut === 'detenu' && (
                              <p className="text-xs text-blue-600 mt-1">
                                💡 Cette date préremplira automatiquement la date de placement DP
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Ligne 2: Infractions et statut AMÉLIORÉE */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="flex items-center justify-between">
                              <Label>Infractions visées *</Label>
                              {index > 0 && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyInfractionsToPrevious(index)}
                                  className="h-6 text-xs text-blue-600 hover:text-blue-700"
                                  title="Copier les infractions du mis en examen précédent"
                                >
                                  <Copy className="h-3 w-3 mr-1" />
                                  Copier
                                </Button>
                              )}
                            </div>
                            <Input
                              value={mex.infractions}
                              onChange={(e) => handleMisEnExamenChange(index, 'infractions', e.target.value)}
                              placeholder="Ex: Trafic de stupéfiants, Vol..."
                              className="mt-1"
                              required
                            />
                            <p className="text-xs text-gray-500 mt-1">
                              {index > 0 && lastUsedInfractions 
                                ? "Prérempli automatiquement • Séparez par des virgules" 
                                : "Séparez par des virgules"}
                            </p>
                          </div>
                          <div>
                            <Label>Statut *</Label>
                            <Select
                              value={mex.statut}
                              onChange={(e) => handleMisEnExamenChange(index, 'statut', e.target.value)}
                              className="mt-1"
                              required
                            >
                              <option value="libre">Libre</option>
                              <option value="cj">Contrôle judiciaire</option>
                              <option value="detenu">Détenu</option>
                              <option value="arse">ARSE</option>
                            </Select>
                            {mex.statut === 'detenu' && (
                              <p className="text-xs text-orange-600 mt-1">
                                🔒 Mode détenu activé - sections DP disponibles
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Section DP si détenu AMÉLIORÉE */}
                        {mex.statut === 'detenu' && (
                          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <h4 className="text-sm font-medium text-orange-900 mb-3">
                              Détention provisoire * 
                              <span className="font-normal text-orange-700 ml-2">
                                (Date DP = Date mise en examen par défaut)
                              </span>
                            </h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Date de placement DP *</Label>
                                <Input
                                  type="date"
                                  value={mex.datePlacementDP}
                                  onChange={(e) => handleMisEnExamenChange(index, 'datePlacementDP', e.target.value)}
                                  className="mt-1"
                                  required
                                />
                                <p className="text-xs text-orange-600 mt-1">
                                  💡 Préremplie avec la date de mise en examen
                                </p>
                              </div>
                              <div>
                                <Label>Durée DP (mois) *</Label>
                                <Select
                                  value={mex.dureeDP.toString()}
                                  onChange={(e) => handleMisEnExamenChange(index, 'dureeDP', parseInt(e.target.value) || 4)}
                                  className="mt-1"
                                  required
                                >
                                  <option value="1">1 mois</option>
                                  <option value="2">2 mois</option>
                                  <option value="3">3 mois</option>
                                  <option value="4">4 mois (standard)</option>
                                  <option value="6">6 mois</option>
                                  <option value="12">12 mois</option>
                                  <option value="24">24 mois</option>
                                </Select>
                              </div>
                            </div>
                            
                            {mex.datePlacementDP && mex.dureeDP && (
                              <div className="mt-2 text-sm text-orange-700">
                                Échéance DP: {calculateDateFinDP(mex.datePlacementDP, mex.dureeDP) && 
                                  new Date(calculateDateFinDP(mex.datePlacementDP, mex.dureeDP)).toLocaleDateString()}
                              </div>
                            )}
                            
                            <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
                              ⚖️ Ce placement générera automatiquement un débat parquet
                            </div>
                          </div>
                        )}

                        {/* Description */}
                        <div>
                          <Label>Observations (optionnel)</Label>
                          <Input
                            value={mex.description}
                            onChange={(e) => handleMisEnExamenChange(index, 'description', e.target.value)}
                            placeholder="Observations particulières..."
                            className="mt-1"
                          />
                        </div>

                        {/* Boutons */}
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => setEditingMexId(null)}
                            disabled={!mex.nom.trim() || !mex.infractions.trim()}
                          >
                            Valider
                          </Button>
                          {misEnExamen.length > 1 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeMisEnExamen(index)}
                            >
                              Supprimer
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* MODE AFFICHAGE */
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium text-base">{mex.nom}</span>
                            <Badge variant="outline" className={`text-xs ${statutColors[mex.statut]}`}>
                              {statutLabels[mex.statut]}
                            </Badge>
                            {isExpiredDP && (
                              <Badge variant="outline" className="text-xs bg-red-100 text-red-700 border-red-300">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                DP échue
                              </Badge>
                            )}
                          </div>
                          
                          <div className="space-y-1 text-sm">
                            <div>
                              <span className="text-gray-600">MEX:</span> {new Date(mex.dateExamen).toLocaleDateString()}
                            </div>
                            
                            {mex.infractions && (
                              <div>
                                <span className="text-gray-600">Infractions:</span> {mex.infractions}
                              </div>
                            )}
                            
                            {mex.statut === 'detenu' && mex.datePlacementDP && (
                              <div className="text-orange-700 bg-orange-50 p-2 rounded border border-orange-200">
                                <div><span className="font-medium">Placement DP:</span> {new Date(mex.datePlacementDP).toLocaleDateString()}</div>
                                <div><span className="font-medium">Durée:</span> {mex.dureeDP} mois</div>
                                {mex.datePlacementDP && mex.dureeDP && (
                                  <div>
                                    <span className="font-medium">Échéance:</span> {new Date(calculateDateFinDP(mex.datePlacementDP, mex.dureeDP)).toLocaleDateString()}
                                    {isExpiredDP && <span className="text-red-600 font-bold ml-2">⚠️ ÉCHUE</span>}
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {mex.description && (
                              <div className="italic text-gray-600">{mex.description}</div>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingMexId(mex.id)}
                            className="h-7 w-7 p-0"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          {misEnExamen.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMisEnExamen(index)}
                              className="h-7 w-7 p-0 text-red-600"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description du dossier</Label>
            <Textarea
              id="description"
              placeholder="Description succincte des faits..."
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              rows={3}
            />
          </div>

          {/* Boutons */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={!isFormValid()}
              className="bg-[#2B5746] hover:bg-[#1f3d2f]"
            >
              Créer le dossier d'instruction
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};