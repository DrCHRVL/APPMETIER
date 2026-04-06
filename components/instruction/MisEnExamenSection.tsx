import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { 
  Plus, 
  Edit, 
  X, 
  Users,
  Calendar,
  Gavel,
  Copy,
  Lightbulb
} from 'lucide-react';
import { EnqueteInstruction, MisEnExamen, DebatParquet } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface MisEnExamenSectionProps {
  instruction: EnqueteInstruction;
  onUpdate?: (id: number, updates: Partial<EnqueteInstruction>) => void;
  isEditing: boolean;
}

export const MisEnExamenSection = ({ 
  instruction, 
  onUpdate, 
  isEditing 
}: MisEnExamenSectionProps) => {
  const { showToast } = useToast();
  const [editingMexId, setEditingMexId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // 🆕 État pour le préremplissage intelligent
  const [smartDefaults, setSmartDefaults] = useState({
    lastUsedInfractions: '',
    commonDureeDP: 12 // Durée DP la plus utilisée
  });
  
  // Formulaires AMÉLIORÉS avec préremplissage
  const [newMexData, setNewMexData] = useState({ 
    nom: '', 
    dateExamen: new Date().toISOString().split('T')[0],
    chefs: [] as string[],
    role: 'libre' as 'libre' | 'detenu',
    statut: 'libre' as 'libre' | 'cj' | 'detenu' | 'arse',
    datePlacementDP: '',
    dureeDP: 4, // 🆕 Durée par défaut plus réaliste
    dateFinDP: '',
    dateRenouvellementDP: '',
    dureeRenouvellementDP: 0,
    description: '',
    infractionsText: '' // 🆕 Pour faciliter la saisie
  });
  
  const [editingData, setEditingData] = useState({ 
    nom: '', 
    dateExamen: '',
    chefs: [] as string[],
    infractionsText: '' // 🆕 Pour l'édition aussi
  });

  const misEnExamen = instruction.misEnExamen || [];

  // 🆕 Calcul automatique des valeurs par défaut intelligentes
  useEffect(() => {
    if (misEnExamen.length > 0) {
      // Analyser les infractions les plus courantes
      const allInfractions = misEnExamen
        .flatMap(mex => mex.chefs || [])
        .filter(Boolean);
      
      // Trouver les infractions les plus fréquentes
      const infractionsFreq = allInfractions.reduce((acc, inf) => {
        acc[inf] = (acc[inf] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      const mostCommonInfractions = Object.entries(infractionsFreq)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3) // Top 3
        .map(([inf]) => inf)
        .join(', ');
      
      // Analyser la durée DP la plus courante
      const dureesDPs = misEnExamen
        .filter(mex => mex.dureeInitialeDP)
        .map(mex => mex.dureeInitialeDP!)
        .filter(Boolean);
      
      const dureeFreq = dureesDPs.reduce((acc, duree) => {
        acc[duree] = (acc[duree] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      
      const mostCommonDuree = Object.entries(dureeFreq)
        .sort(([,a], [,b]) => b - a)
        .map(([duree]) => parseInt(duree))[0] || 4;

      setSmartDefaults({
        lastUsedInfractions: mostCommonInfractions,
        commonDureeDP: mostCommonDuree
      });
    }
  }, [misEnExamen]);

  // 🆕 Fonction pour préremplir intelligemment un nouveau mis en examen
  const initializeNewMex = () => {
    setNewMexData({
      nom: '', 
      dateExamen: new Date().toISOString().split('T')[0],
      chefs: [],
      role: 'libre',
      statut: 'libre',
      datePlacementDP: '',
      dureeDP: smartDefaults.commonDureeDP,
      dateFinDP: '',
      dateRenouvellementDP: '',
      dureeRenouvellementDP: 0,
      description: '',
      infractionsText: smartDefaults.lastUsedInfractions // 🆕 Préremplir avec les infractions courantes
    });
  };

  // 🆕 Fonction pour gérer le changement de date de mise en examen
  const handleDateExamenChange = (value: string) => {
    setNewMexData(prev => ({
      ...prev,
      dateExamen: value,
      // 🆕 Si détenu, préremplir automatiquement la date DP
      datePlacementDP: prev.statut === 'detenu' ? value : prev.datePlacementDP
    }));
  };

  // 🆕 Fonction pour gérer le changement de statut
  const handleStatutChange = (value: 'libre' | 'cj' | 'detenu' | 'arse') => {
    setNewMexData(prev => ({
      ...prev,
      statut: value,
      role: value === 'detenu' ? 'detenu' : 'libre',
      // 🆕 Si on passe en détenu, préremplir la date DP avec la date de mise en examen
      datePlacementDP: value === 'detenu' && prev.dateExamen ? prev.dateExamen : 
                       value !== 'detenu' ? '' : prev.datePlacementDP,
      // Réinitialiser la durée si ce n'est plus un détenu
      dureeDP: value === 'detenu' ? smartDefaults.commonDureeDP : 0
    }));
  };

  // 🆕 Calcul automatique de la date de fin DP
  const calculateDateFinDP = (datePlacement: string, duree: number): string => {
    if (!datePlacement || !duree) return '';
    const date = new Date(datePlacement);
    date.setMonth(date.getMonth() + duree);
    return date.toISOString().split('T')[0];
  };

  // 🆕 Mise à jour automatique de la date de fin DP
  useEffect(() => {
    if (newMexData.statut === 'detenu' && newMexData.datePlacementDP && newMexData.dureeDP) {
      const dateFinDP = calculateDateFinDP(newMexData.datePlacementDP, newMexData.dureeDP);
      setNewMexData(prev => ({ ...prev, dateFinDP }));
    }
  }, [newMexData.datePlacementDP, newMexData.dureeDP, newMexData.statut]);

  // Ouverture du formulaire avec préremplissage intelligent
  const handleOpenAddForm = () => {
    initializeNewMex();
    setShowAddForm(true);
  };

  // 🆕 Copier les infractions du dernier mis en examen
  const copyInfractionsFromLast = () => {
    if (misEnExamen.length > 0) {
      const lastMex = misEnExamen[misEnExamen.length - 1];
      const infractions = lastMex.chefs?.join(', ') || '';
      setNewMexData(prev => ({ ...prev, infractionsText: infractions }));
      showToast('Infractions copiées du dernier mis en examen', 'success');
    }
  };

  // Ajout mis en examen AMÉLIORÉ
  const handleAddMex = () => {
    if (!onUpdate || !newMexData.nom.trim()) {
      showToast('Nom requis', 'error');
      return;
    }

    if (!newMexData.infractionsText.trim()) {
      showToast('Infractions requises', 'error');
      return;
    }

    // Vérifications pour les détenus
    if (newMexData.statut === 'detenu') {
      if (!newMexData.datePlacementDP || !newMexData.dureeDP || newMexData.dureeDP <= 0) {
        showToast('Date de placement et durée DP requises pour un détenu', 'error');
        return;
      }
    }

    const newMex: MisEnExamen = {
      id: Date.now(),
      nom: newMexData.nom.trim(),
      dateExamen: newMexData.dateExamen,
      chefs: newMexData.infractionsText.split(',').map(inf => inf.trim()).filter(Boolean),
      role: newMexData.role,
      statut: newMexData.statut,
      description: newMexData.description.trim() || undefined,
      datePlacementDP: newMexData.statut === 'detenu' ? newMexData.datePlacementDP : undefined,
      dureeInitialeDP: newMexData.statut === 'detenu' ? newMexData.dureeDP : undefined,
      dateFinDP: newMexData.statut === 'detenu' && newMexData.dateFinDP ? newMexData.dateFinDP : undefined
    };

    const updatedMex = [...misEnExamen, newMex];
    
    // Créer automatiquement un débat parquet si c'est un détenu
    let updatedDebats = instruction.debatsParquet || [];
    if (newMexData.statut === 'detenu' && newMexData.datePlacementDP) {
      const newDebat: DebatParquet = {
        id: Date.now() + 1,
        date: newMexData.datePlacementDP,
        type: 'placement_dp',
        issue: 'Accordé',
        notes: `Placement DP automatique - ${newMexData.nom}`,
        concernedDetenu: newMex.id,
        sourceType: 'manual'
      };
      updatedDebats = [...updatedDebats, newDebat];
      
      // Ajouter l'historique au mis en examen
      newMex.debatsHistory = [{
        debatId: newDebat.id,
        type: 'placement_dp',
        date: newMexData.datePlacementDP,
        decision: 'Accordé'
      }];
      
      onUpdate(instruction.id, { 
        misEnExamen: updatedMex,
        debatsParquet: updatedDebats
      });
      
      showToast(`Mis en examen détenu ajouté avec débat parquet automatique`, 'success');
    } else {
      onUpdate(instruction.id, { misEnExamen: updatedMex });
      showToast('Mis en examen ajouté', 'success');
    }

    // Reset form mais garder les bonnes pratiques pour le suivant
    initializeNewMex();
    setShowAddForm(false);
  };

  // Modification mis en examen
  const handleUpdateMex = (id: number) => {
    if (!onUpdate || !editingData.nom.trim()) {
      showToast('Nom requis', 'error');
      return;
    }

    const updatedMex = misEnExamen.map(mex => 
      mex.id === id ? { 
        ...mex, 
        nom: editingData.nom.trim(),
        dateExamen: editingData.dateExamen,
        chefs: editingData.infractionsText.split(',').map(inf => inf.trim()).filter(Boolean)
      } : mex
    );

    onUpdate(instruction.id, { misEnExamen: updatedMex });
    setEditingMexId(null);
    setEditingData({ nom: '', dateExamen: '', chefs: [], infractionsText: '' });
    showToast('Mis en examen mis à jour', 'success');
  };

  // Suppression mis en examen
  const handleDeleteMex = (id: number) => {
    if (!onUpdate) return;
    
    if (confirm('Supprimer ce mis en examen ?')) {
      const updatedMex = misEnExamen.filter(mex => mex.id !== id);
      onUpdate(instruction.id, { misEnExamen: updatedMex });
      showToast('Mis en examen supprimé', 'success');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Mis en examen ({misEnExamen.length})
          </div>
          
          {isEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenAddForm}
              className="h-7 px-2 text-green-600"
            >
              <Plus className="h-3 w-3 mr-1" />
              Ajouter
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Formulaire d'ajout AMÉLIORÉ */}
        {showAddForm && (
          <div className="border rounded-lg p-3 bg-green-50">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Nouveau mis en examen</h4>
              {smartDefaults.lastUsedInfractions && (
                <div className="flex items-center gap-2 text-xs text-blue-600">
                  <Lightbulb className="h-3 w-3" />
                  Préremplissage intelligent activé
                </div>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-gray-600">Nom et prénom *</label>
                <Input
                  value={newMexData.nom}
                  onChange={(e) => setNewMexData({...newMexData, nom: e.target.value})}
                  placeholder="Nom complet"
                  className="h-8 text-xs"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Date mise en examen *</label>
                <Input
                  type="date"
                  value={newMexData.dateExamen}
                  onChange={(e) => handleDateExamenChange(e.target.value)}
                  className="h-8 text-xs"
                />
                {newMexData.statut === 'detenu' && (
                  <p className="text-xs text-blue-600 mt-1">
                    💡 Préremplira automatiquement la date DP
                  </p>
                )}
              </div>
            </div>

            {/* Infractions AMÉLIORÉES */}
            <div className="mb-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-600">Infractions visées *</label>
                <div className="flex gap-1">
                  {misEnExamen.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={copyInfractionsFromLast}
                      className="h-6 px-2 text-blue-600 hover:text-blue-700"
                      title="Copier les infractions du dernier mis en examen"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copier
                    </Button>
                  )}
                </div>
              </div>
              <Input
                value={newMexData.infractionsText}
                onChange={(e) => setNewMexData({...newMexData, infractionsText: e.target.value})}
                placeholder="Ex: Trafic de stupéfiants, Vol en bande organisée..."
                className="h-8 text-xs"
              />
              <p className="text-xs text-gray-500 mt-1">
                {smartDefaults.lastUsedInfractions ? 
                  "Prérempli avec les infractions les plus courantes • Séparez par des virgules" : 
                  "Séparez par des virgules"}
              </p>
            </div>

            {/* Statut AMÉLIORÉ */}
            <div className="mb-2">
              <label className="text-xs text-gray-600">Statut *</label>
              <Select
                value={newMexData.statut}
                onChange={(e) => handleStatutChange(e.target.value as any)}
                className="h-8 text-xs"
              >
                <option value="libre">Libre</option>
                <option value="cj">Contrôle judiciaire</option>
                <option value="detenu">Détenu</option>
                <option value="arse">ARSE</option>
              </Select>
              {newMexData.statut === 'detenu' && (
                <p className="text-xs text-orange-600 mt-1">
                  🔒 Mode détenu - sections DP activées automatiquement
                </p>
              )}
            </div>
              
            {/* Section DP AMÉLIORÉE avec préremplissage automatique */}
            {newMexData.statut === 'detenu' && (
              <div className="mt-2 space-y-2 bg-orange-50 p-2 rounded border border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <h5 className="text-xs font-medium text-orange-900">Détention provisoire *</h5>
                  <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">
                    Préremplissage auto
                  </Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-600">Date placement DP *</label>
                    <Input
                      type="date"
                      value={newMexData.datePlacementDP}
                      onChange={(e) => setNewMexData({...newMexData, datePlacementDP: e.target.value})}
                      className="h-7 text-xs"
                    />
                    <p className="text-xs text-orange-600 mt-1">
                      💡 Auto-remplie avec la date de mise en examen
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">Durée DP (mois) *</label>
                    <Select
                      value={newMexData.dureeDP?.toString() || ''}
                      onChange={(e) => setNewMexData({...newMexData, dureeDP: parseInt(e.target.value) || 4})}
                      className="h-7 text-xs"
                    >
                      <option value="1">1 mois</option>
                      <option value="2">2 mois</option>
                      <option value="3">3 mois</option>
                      <option value="4">4 mois (standard)</option>
                      <option value="6">6 mois</option>
                      <option value="12">12 mois</option>
                      <option value="24">24 mois</option>
                    </Select>
                    <p className="text-xs text-orange-600 mt-1">
                      💡 Durée par défaut: {smartDefaults.commonDureeDP} mois (la plus utilisée)
                    </p>
                  </div>
                </div>
                
                {newMexData.dateFinDP && (
                  <div className="text-xs text-orange-700 bg-orange-100 p-2 rounded">
                    <strong>Échéance DP calculée:</strong> {new Date(newMexData.dateFinDP).toLocaleDateString()}
                  </div>
                )}
                
                <div className="text-xs text-orange-600 bg-orange-100 p-2 rounded">
                  ⚖️ Ce placement générera automatiquement un débat parquet
                </div>
              </div>
            )}

            {/* Description */}
            <div className="mb-2">
              <label className="text-xs text-gray-600">Observations (optionnel)</label>
              <Input
                value={newMexData.description}
                onChange={(e) => setNewMexData({...newMexData, description: e.target.value})}
                placeholder="Observations particulières..."
                className="h-7 text-xs"
              />
            </div>
            
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={handleAddMex} 
                className="text-xs"
                disabled={!newMexData.nom.trim() || !newMexData.infractionsText.trim()}
              >
                Ajouter
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => setShowAddForm(false)} 
                className="text-xs"
              >
                Annuler
              </Button>
            </div>
          </div>
        )}

        {/* Liste des mis en examen */}
        <div className="space-y-2">
          {misEnExamen.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-xs">Aucun mis en examen</p>
            </div>
          ) : (
            misEnExamen.map((mex) => (
              <div key={mex.id} className="bg-white border rounded p-3">
                {editingMexId === mex.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-600">Nom et prénom</label>
                        <Input
                          value={editingData.nom}
                          onChange={(e) => setEditingData({...editingData, nom: e.target.value})}
                          className="h-8 text-xs"
                          placeholder="Nom complet"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Date mise en examen</label>
                        <Input
                          type="date"
                          value={editingData.dateExamen}
                          onChange={(e) => setEditingData({...editingData, dateExamen: e.target.value})}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    {/* Infractions en édition */}
                    <div>
                      <label className="text-xs text-gray-600">Infractions visées</label>
                      <Input
                        value={editingData.infractionsText}
                        onChange={(e) => setEditingData({...editingData, infractionsText: e.target.value})}
                        placeholder="Séparez par des virgules"
                        className="h-8 text-xs"
                      />
                    </div>
                    
                    <div className="flex gap-2">
                      <Button 
                        size="sm"
                        onClick={() => handleUpdateMex(mex.id)}
                        className="text-xs"
                      >
                        Valider
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingMexId(null);
                          setEditingData({ nom: '', dateExamen: '', chefs: [], infractionsText: '' });
                        }}
                        className="text-xs"
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{mex.nom}</span>
                        <Badge variant="outline" className="text-xs">
                          <Calendar className="h-3 w-3 mr-1" />
                          {new Date(mex.dateExamen).toLocaleDateString()}
                        </Badge>
                        {mex.statut === 'detenu' && (
                          <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700 border-orange-300">
                            🔒 Détenu
                          </Badge>
                        )}
                      </div>
                      
                      {/* Informations DP pour les détenus */}
                      {mex.statut === 'detenu' && (
                        <div className="bg-orange-50 border border-orange-200 rounded p-2 mb-2">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-gray-600">Échéance DP:</span>
                              <div className={`font-medium ${
                                mex.dateFinDP && new Date(mex.dateFinDP) < new Date() 
                                  ? 'text-red-600' 
                                  : 'text-orange-700'
                              }`}>
                                {mex.dateFinDP ? new Date(mex.dateFinDP).toLocaleDateString() : 'Non calculée'}
                              </div>
                            </div>
                          </div>
                          
                          {mex.dateFinDP && (
                            <div className="mt-1 text-xs">
                              <span className="text-gray-600">Durée:</span>
                              <span className="ml-1 font-medium">{mex.dureeInitialeDP} mois</span>
                              {new Date(mex.dateFinDP) < new Date() && (
                                <span className="ml-2 text-red-600 font-medium">⚠️ Échue</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {mex.chefs && mex.chefs.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs text-gray-600 flex items-center gap-1">
                            <Gavel className="h-3 w-3" />
                            Chefs d'inculpation:
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {mex.chefs.map((chef, index) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {chef}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {mex.description && (
                        <div className="mt-2 text-xs text-gray-500 italic bg-gray-50 p-1 rounded">
                          <span className="font-medium">Obs:</span> {mex.description}
                        </div>
                      )}
                    </div>
                    
                    {isEditing && (
                      <div className="flex gap-1">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setEditingMexId(mex.id);
                            setEditingData({ 
                              nom: mex.nom,
                              dateExamen: mex.dateExamen,
                              chefs: [...(mex.chefs || [])],
                              infractionsText: mex.chefs?.join(', ') || ''
                            });
                          }}
                          className="h-7 w-7 p-0"
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDeleteMex(mex.id)}
                          className="h-7 w-7 p-0 text-red-600"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 🆕 Indicateur de préremplissage intelligent */}
        {isEditing && smartDefaults.lastUsedInfractions && (
          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
            <div className="flex items-center gap-2 text-blue-700">
              <Lightbulb className="h-4 w-4" />
              <span className="font-medium">Préremplissage intelligent activé</span>
            </div>
            <div className="mt-1 text-blue-600">
              <div><strong>Infractions courantes:</strong> {smartDefaults.lastUsedInfractions}</div>
              <div><strong>Durée DP habituelle:</strong> {smartDefaults.commonDureeDP} mois</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};