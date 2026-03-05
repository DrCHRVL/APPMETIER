import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { EnqueteInstruction, CompteRendu, CABINET_COLORS, MisEnExamen, DebatParquet } from '@/types/interfaces';
import { CompteRenduSection } from '../sections/CompteRenduSection';
import { MisEnExamenSection } from '../instruction/MisEnExamenSection';
import { DocumentsSection } from '../sections/DocumentsSection';
import { InstructionHeader } from '../sections/InstructionHeader';
import { InstructionWidgets } from '../instruction/InstructionWidgets';
import { InstructionTimeline } from '../instruction/InstructionTimeline';
import { DMLManager } from '../instruction/DMLManager';
import { ReqlibManager } from '../instruction/ReqlibManager';
import { OPManager } from '../instruction/OPManager';
import { MesuresSureteSection } from '../instruction/MesuresSureteSection';
import { RDSection } from '../instruction/RDSection';
import { DMLModal } from '../instruction/DMLModal';
import { DebatModal } from '../instruction/DebatModal';
import { DeleteInstructionModal } from './DeleteInstructionModal';
import { Trash2, Gavel, Clock, FileText, Users, Settings, Plus, Minus, Edit, AlertTriangle, UserX, Copy, Lightbulb, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';

interface InstructionDetailModalProps {
  instruction: EnqueteInstruction;
  isEditing: boolean;
  onClose: () => void;
  onEdit: () => void;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  onDelete?: (id: number) => void;
}

export const InstructionDetailModal = ({
  instruction,
  isEditing,
  onClose,
  onEdit,
  onUpdate,
  onDelete
}: InstructionDetailModalProps) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'mesures' | 'documents'>('general');
  const [editingCR, setEditingCR] = useState<CompteRendu | null>(null);
  const [showDMLModal, setShowDMLModal] = useState(false);
  const [showDebatModal, setShowDebatModal] = useState(false);
  const [debatType, setDebatType] = useState<'placement_dp' | 'prolongation_dp'>('placement_dp');
  const [showAddMexModal, setShowAddMexModal] = useState(false);
  
  // États pour l'édition des côtes
  const [cotesInputValue, setCotesInputValue] = useState('');
  const [isEditingCotes, setIsEditingCotes] = useState(false);
  
  // États pour la gestion des victimes
  const [newVictimeName, setNewVictimeName] = useState('');
  const [showAddVictim, setShowAddVictim] = useState(false);
  
  // États manquants pour l'édition des mis en examen
  const [editingMexId, setEditingMexId] = useState<number | null>(null);
  const [editingMexData, setEditingMexData] = useState({
    nom: '',
    dateExamen: '',
    infractions: '',
    statut: 'libre' as 'libre' | 'cj' | 'detenu' | 'arse',
    description: '',
    datePlacementDP: '',
    dureeDP: 1
  });
  
  // 🆕 AMÉLIORATION : États pour le préremplissage intelligent
  const [smartDefaults, setSmartDefaults] = useState({
    lastUsedInfractions: '',
    commonDureeDP: 4
  });
  
  const [mexFormData, setMexFormData] = useState({
    nom: '',
    dateExamen: new Date().toISOString().split('T')[0],
    infractions: '',
    statut: 'libre' as 'libre' | 'cj' | 'detenu' | 'arse',
    description: '',
    datePlacementDP: '',
    dureeDP: 4 // 🆕 Durée par défaut plus réaliste
  });
  
  // État local pour forcer le re-render et synchroniser les données
  const [localInstruction, setLocalInstruction] = useState<EnqueteInstruction>(instruction);
  const [refreshKey, setRefreshKey] = useState(0);
  
  const { showToast } = useToast();

  // 🆕 AMÉLIORATION : Calcul automatique des valeurs par défaut intelligentes
  useEffect(() => {
    const misEnExamen = localInstruction.misEnExamen || [];
    
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
  }, [localInstruction.misEnExamen]);

  // 🆕 AMÉLIORATION : Préremplir intelligemment le formulaire mis en examen
  const initializeMexForm = () => {
    setMexFormData({
      nom: '',
      dateExamen: new Date().toISOString().split('T')[0],
      infractions: smartDefaults.lastUsedInfractions, // 🆕 Préremplir avec les infractions courantes
      statut: 'libre',
      description: '',
      datePlacementDP: '',
      dureeDP: smartDefaults.commonDureeDP // 🆕 Préremplir avec la durée la plus utilisée
    });
  };

  // 🆕 AMÉLIORATION : Gestion intelligente du changement de date de mise en examen
  const handleMexDateExamenChange = (value: string) => {
    setMexFormData(prev => ({
      ...prev,
      dateExamen: value,
      // 🆕 Si détenu, préremplir automatiquement la date DP
      datePlacementDP: prev.statut === 'detenu' ? value : prev.datePlacementDP
    }));
  };

  // 🆕 AMÉLIORATION : Gestion intelligente du changement de statut
  const handleMexStatutChange = (value: 'libre' | 'cj' | 'detenu' | 'arse') => {
    setMexFormData(prev => ({
      ...prev,
      statut: value,
      // 🆕 Si on passe en détenu, préremplir la date DP avec la date de mise en examen
      datePlacementDP: value === 'detenu' && prev.dateExamen ? prev.dateExamen : 
                       value !== 'detenu' ? '' : prev.datePlacementDP,
      // Ajuster la durée si nécessaire
      dureeDP: value === 'detenu' ? smartDefaults.commonDureeDP : prev.dureeDP
    }));
  };

  // 🆕 AMÉLIORATION : Copier les infractions du dernier mis en examen
  const copyInfractionsFromLast = () => {
    const misEnExamen = localInstruction.misEnExamen || [];
    if (misEnExamen.length > 0) {
      const lastMex = misEnExamen[misEnExamen.length - 1];
      const infractions = lastMex.chefs?.join(', ') || '';
      setMexFormData(prev => ({ ...prev, infractions }));
      showToast('Infractions copiées du dernier mis en examen', 'success');
    }
  };
// Synchroniser l'état local avec les props quand l'instruction change
  useEffect(() => {
    setLocalInstruction(instruction);
    setRefreshKey(prev => prev + 1);
    setCotesInputValue((instruction.cotesTomes || 0).toString());
  }, [instruction]);

  // Fonction de mise à jour optimisée
  const handleUpdateWithToast = useCallback((id: number, updates: Partial<EnqueteInstruction>) => {
    // Mise à jour locale immédiate pour l'UI
    setLocalInstruction(prev => ({
      ...prev,
      ...updates,
      dateMiseAJour: new Date().toISOString()
    }));
    
    // Forcer le re-render de tous les composants
    setRefreshKey(prev => prev + 1);
    
    // Mise à jour dans le store parent
    onUpdate(id, {
      ...updates,
      dateMiseAJour: new Date().toISOString()
    });
    
    showToast('Modifications enregistrées', 'success');
  }, [onUpdate, showToast]);

  const handleAddCR = useCallback((cr: Omit<CompteRendu, 'id'>) => {
    const newCR = { ...cr, id: Date.now() };
    const updatedCRs = [newCR, ...(localInstruction.comptesRendus || [])];
    
    handleUpdateWithToast(localInstruction.id, { 
      comptesRendus: updatedCRs
    });
  }, [localInstruction.id, localInstruction.comptesRendus, handleUpdateWithToast]);

  const handleUpdateCR = useCallback((id: number, updates: Partial<CompteRendu>) => {
    const updatedCRs = (localInstruction.comptesRendus || []).map(cr =>
      cr.id === id ? { ...cr, ...updates } : cr
    );
    handleUpdateWithToast(localInstruction.id, { comptesRendus: updatedCRs });
  }, [localInstruction.id, localInstruction.comptesRendus, handleUpdateWithToast]);

  const handleDeleteCR = useCallback((id: number) => {
    const updatedCRs = (localInstruction.comptesRendus || []).filter(cr => cr.id !== id);
    handleUpdateWithToast(localInstruction.id, { comptesRendus: updatedCRs });
  }, [localInstruction.id, localInstruction.comptesRendus, handleUpdateWithToast]);

  const handleDelete = () => {
    if (onDelete) {
      onDelete(localInstruction.id);
      showToast('Dossier d\'instruction supprimé avec succès', 'success');
      onClose();
    }
  };

  // Gestion compteur côtes avec actualisation immédiate
  const handleCotesChange = useCallback((increment: boolean) => {
    const newValue = Math.max(0, localInstruction.cotesTomes + (increment ? 1 : -1));
    setCotesInputValue(newValue.toString());
    handleUpdateWithToast(localInstruction.id, { cotesTomes: newValue });
  }, [localInstruction.cotesTomes, localInstruction.id, handleUpdateWithToast]);

  // Gestion saisie manuelle des côtes
  const handleCotesInputChange = (value: string) => {
    if (value === '' || /^\d+$/.test(value)) {
      setCotesInputValue(value);
    }
  };

  const handleCotesInputSubmit = () => {
    const numValue = parseInt(cotesInputValue) || 0;
    const clampedValue = Math.max(0, Math.min(9999, numValue));
    setCotesInputValue(clampedValue.toString());
    handleUpdateWithToast(localInstruction.id, { cotesTomes: clampedValue });
    setIsEditingCotes(false);
  };

  const handleCotesInputKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCotesInputSubmit();
    } else if (e.key === 'Escape') {
      setCotesInputValue((localInstruction.cotesTomes || 0).toString());
      setIsEditingCotes(false);
    }
  };

  // Gestion des victimes
  const handleAddVictim = () => {
    if (!newVictimeName.trim()) return;
    
    const currentVictims = localInstruction.victimes || [];
    const newVictim = {
      id: Date.now(),
      nom: newVictimeName.trim(),
      dateAjout: new Date().toISOString().split('T')[0]
    };
    
    handleUpdateWithToast(localInstruction.id, { 
      victimes: [...currentVictims, newVictim]
    });
    
    setNewVictimeName('');
    setShowAddVictim(false);
    showToast('Victime ajoutée', 'success');
  };

  const handleRemoveVictim = (victimId: number) => {
    const updatedVictims = (localInstruction.victimes || []).filter(v => v.id !== victimId);
    handleUpdateWithToast(localInstruction.id, { victimes: updatedVictims });
    showToast('Victime supprimée', 'success');
  };

  // Couleur du cabinet pour l'header
  const cabinetColorClass = localInstruction?.cabinet && CABINET_COLORS 
    ? (CABINET_COLORS[localInstruction.cabinet] || 'bg-white')
    : 'bg-white';

  const tabs = [
    { id: 'general', label: 'Général', icon: FileText },
    { id: 'documents', label: 'Documents', icon: Users }
  ];

  if (!localInstruction) {
    return null;
  }

  return (
    <>
      <Dialog open={!!localInstruction} onOpenChange={onClose}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] bg-white overflow-auto flex flex-col">
          {/* HEADER AMÉLIORÉ - UNE SEULE LIGNE AVEC MEILLEURE VISIBILITÉ */}
          <div className={`flex-shrink-0 ${cabinetColorClass} border-b-2 p-2`}>
            <div className="flex items-center justify-between gap-3 text-sm">
              {/* INFORMATIONS PRINCIPALES */}
              <div className="flex items-center gap-3 flex-1">
                {/* Numéro instruction */}
                {isEditing ? (
                  <Input
                    value={localInstruction.numeroInstruction || ''}
                    onChange={(e) => handleUpdateWithToast(localInstruction.id, { numeroInstruction: e.target.value })}
                    className="text-sm font-bold w-28 bg-white h-7 border-2"
                    placeholder="N° instruction"
                  />
                ) : (
                  <div className="bg-white border-2 border-gray-300 rounded px-2 py-1 min-w-fit">
                    <span className="text-sm font-bold text-gray-900">
                      {localInstruction.numeroInstruction || 'N° manquant'}
                    </span>
                  </div>
                )}

                {/* Séparateur visuel */}
                <div className="h-6 w-px bg-gray-400"></div>

                {/* Numéro Parquet */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600 font-medium">Parquet:</span>
                  {isEditing ? (
                    <Input
                      value={localInstruction.numeroParquet || ''}
                      onChange={(e) => handleUpdateWithToast(localInstruction.id, { numeroParquet: e.target.value })}
                      className="text-xs w-24 bg-white h-6"
                      placeholder="N° parquet"
                    />
                  ) : (
                    <span className="text-xs text-gray-800 font-medium bg-white px-2 py-1 rounded border">
                      {localInstruction.numeroParquet || 'Non renseigné'}
                    </span>
                  )}
                </div>

                {/* Cabinet */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600 font-medium">Cabinet:</span>
                  {isEditing ? (
                    <select
                      value={localInstruction.cabinet || '1'}
                      onChange={(e) => handleUpdateWithToast(localInstruction.id, { cabinet: e.target.value as any })}
                      className="text-xs border rounded px-2 py-1 bg-white h-6 w-12 font-medium"
                    >
                      <option value="1">C1</option>
                      <option value="2">C2</option>
                      <option value="3">C3</option>
                      <option value="4">C4</option>
                    </select>
                  ) : (
                    <Badge variant="outline" className="text-xs h-6 px-2 font-medium bg-white">
                      C{localInstruction.cabinet || '?'}
                    </Badge>
                  )}
                </div>

                

                {/* Service */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600 font-medium">Service:</span>
                  {isEditing ? (
                    <Input
                      value={localInstruction.serviceEnqueteur || ''}
                      onChange={(e) => handleUpdateWithToast(localInstruction.id, { serviceEnqueteur: e.target.value })}
                      className="text-xs w-16 bg-white h-6"
                      placeholder="Service"
                    />
                  ) : (
                    <span className="text-xs text-gray-800 font-medium bg-white px-2 py-1 rounded border">
                      {localInstruction.serviceEnqueteur || 'SIPJ'}
                    </span>
                  )}
                </div>

                {/* Date de début */}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-600 font-medium">Début:</span>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={localInstruction.dateDebut || ''}
                      onChange={(e) => handleUpdateWithToast(localInstruction.id, { dateDebut: e.target.value })}
                      className="text-xs w-28 bg-white h-6"
                    />
                  ) : (
                    <span className="text-xs text-gray-800 font-medium bg-white px-2 py-1 rounded border">
                      {new Date(localInstruction.dateDebut).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit', year: '2-digit'})}
                    </span>
                  )}
                </div>

                {/* Séparateur visuel */}
                <div className="h-6 w-px bg-gray-400"></div>

                {/* INDICATEURS VISUELS AMÉLIORÉS */}
                
                {/* DML avec badge distinctif */}
                <div className="flex items-center gap-1 bg-green-50 border border-green-200 rounded px-2 py-1">
                  <span className="text-xs text-green-700 font-medium">DML:</span>
                  <Badge variant="outline" className="text-xs h-5 px-2 font-bold bg-green-100 text-green-800 border-green-300">
                    {localInstruction.dmls?.length || 0}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDMLModal(true)}
                    className="h-5 w-5 p-0 text-green-600 hover:bg-green-100"
                    title="Ajouter DML"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                {/* Débats avec badges distinctifs */}
                <div className="flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                  <span className="text-xs text-blue-700 font-medium">Débats:</span>
                  <Badge variant="outline" className="text-xs h-5 px-2 font-bold bg-blue-100 text-blue-800 border-blue-300">
                    {localInstruction.debatsParquet?.length || 0}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDebatType('placement_dp');
                      setShowDebatModal(true);
                    }}
                    className="h-5 px-1 text-xs text-blue-600 hover:bg-blue-100 font-medium"
                    title="Placement DP"
                  >
                    P
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDebatType('prolongation_dp');
                      setShowDebatModal(true);
                    }}
                    className="h-5 px-1 text-xs text-orange-600 hover:bg-orange-100 font-medium"
                    title="Prolongation DP"
                  >
                    Pr
                  </Button>
                </div>

                {/* Côtes avec saisie manuelle améliorée */}
                <div className="flex items-center gap-1 bg-gray-50 border border-gray-300 rounded px-2 py-1">
                  <span className="text-xs text-gray-700 font-medium">Côtes:</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-4 p-0 text-gray-600 hover:bg-gray-200"
                    onClick={() => handleCotesChange(false)}
                    disabled={localInstruction.cotesTomes <= 0}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  
                  {isEditingCotes ? (
                    <Input
                      value={cotesInputValue}
                      onChange={(e) => handleCotesInputChange(e.target.value)}
                      onKeyDown={handleCotesInputKeyPress}
                      onBlur={handleCotesInputSubmit}
                      className="w-12 h-5 text-xs text-center px-1 border border-blue-400 bg-blue-50"
                      placeholder="0"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                    />
                  ) : (
                    <div 
                      className="bg-white border border-gray-300 rounded px-2 py-0.5 min-w-[2rem] text-center cursor-pointer hover:bg-gray-50"
                      onClick={() => setIsEditingCotes(true)}
                      title="Cliquer pour modifier directement"
                    >
                      <span className="text-sm font-bold text-gray-900">
                        {localInstruction.cotesTomes || 0}
                      </span>
                    </div>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-4 p-0 text-gray-600 hover:bg-gray-200"
                    onClick={() => handleCotesChange(true)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>


                {/* Types d'infractions - NOUVEAU : éditable */}
                {isEditing && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 font-medium">Infractions:</span>
                    <div className="flex flex-wrap gap-1">
                      {localInstruction.tags?.filter(tag => tag.category === 'infractions').map(tag => (
                        <Badge key={tag.id} variant="secondary" className="text-xs h-5 px-1 flex items-center gap-1">
                          {tag.value}
                          <button
                            className="hover:text-red-600 rounded-full"
                            onClick={() => {
                              const newTags = localInstruction.tags.filter(t => t.id !== tag.id);
                              handleUpdateWithToast(localInstruction.id, { tags: newTags });
                            }}
                          >
                            <X className="h-2 w-2" />
                          </button>
                        </Badge>
                      ))}
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            const newTag = {
                              id: `infractions-${e.target.value}`,
                              value: e.target.value,
                              category: 'infractions' as const
                            };
                            if (!localInstruction.tags.some(tag => tag.id === newTag.id)) {
                              handleUpdateWithToast(localInstruction.id, { 
                                tags: [...localInstruction.tags, newTag] 
                              });
                            }
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border rounded px-1 py-0.5 bg-white h-5 w-16"
                      >
                        <option value="">+ Ajouter</option>
                        <option value="Stupéfiants">Stupéfiants</option>
                        <option value="Vol">Vol</option>
                        <option value="Escroquerie">Escroquerie</option>
                        <option value="Violence">Violence</option>
                        <option value="Trafic d'armes">Trafic d'armes</option>
                        <option value="Blanchiment">Blanchiment</option>
                        <option value="Cybercriminalité">Cybercriminalité</option>
                        <option value="Terrorisme">Terrorisme</option>
                        <option value="Criminalité organisée">Crim. org.</option>
                      </select>
                    </div>
                  </div>
                )}
                {!isEditing && localInstruction.tags?.filter(tag => tag.category === 'infractions').length > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 font-medium">Infractions:</span>
                    <div className="flex flex-wrap gap-1">
                      {localInstruction.tags.filter(tag => tag.category === 'infractions').map(tag => (
                        <Badge key={tag.id} variant="secondary" className="text-xs h-5 px-1">
                          {tag.value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Orientation finale */}
                {localInstruction.orientation && (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-600 font-medium">Orient.:</span>
                    {isEditing ? (
                      <Select
                        value={localInstruction.orientation || ''}
                        onChange={(e) => handleUpdateWithToast(localInstruction.id, { orientation: e.target.value as any })}
                        className="text-xs h-6 w-16"
                      >
                        <option value="">?</option>
                        <option value="TC">TC</option>
                        <option value="CCD">CCD</option>
                        <option value="Assises">Assises</option>
                        <option value="non_lieu">Non-lieu</option>
                      </Select>
                    ) : (
                      <Badge variant="outline" className="text-xs h-6 px-2 font-medium bg-white">
                        {localInstruction.orientation}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {/* Actions à droite */}
              <div className="flex items-center gap-2">
                {isEditing && onDelete && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 w-7 p-0"
                    onClick={() => setShowDeleteModal(true)}
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button onClick={onEdit} size="sm" className="h-7 text-xs px-3 font-medium">
                  {isEditing ? 'Terminer' : 'Modifier'}
                </Button>
              </div>
            </div>

            {/* Onglets */}
            <div className="flex border-t bg-white/50 mt-2 -mx-2">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-b-2 border-blue-500 text-blue-600 bg-white'
                      : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* SECTION VICTIMES ET MIS EN EXAMEN */}
          <div className="p-3 border-b bg-gray-50" key={`misEnExamen-${refreshKey}`}>
            <div className="flex gap-3">
              {/* VICTIMES - COLONNE RÉDUITE 8% */}
              <div className="flex-[0.08] bg-white border-2 border-red-200 rounded-lg p-2">
                <div className="flex items-center gap-1 mb-2">
                  <UserX className="h-3 w-3 text-red-600" />
                  <span className="text-xs text-red-700 font-semibold">
                    Victimes ({localInstruction.victimes?.length || 0})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddVictim(true)}
                    className="h-4 w-4 p-0 text-red-600 hover:bg-red-100"
                    title="Ajouter"
                  >
                    <Plus className="h-2 w-2" />
                  </Button>
                </div>

                {/* Formulaire d'ajout compact */}
                {showAddVictim && (
                  <div className="bg-red-50 border border-red-200 rounded p-1 mb-2">
                    <Input
                      value={newVictimeName}
                      onChange={(e) => setNewVictimeName(e.target.value)}
                      placeholder="Nom"
                      className="h-5 text-xs mb-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddVictim();
                        if (e.key === 'Escape') {
                          setShowAddVictim(false);
                          setNewVictimeName('');
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-0.5">
                      <Button
                        size="sm"
                        onClick={handleAddVictim}
                        disabled={!newVictimeName.trim()}
                        className="h-4 text-xs flex-1 px-1"
                      >
                        ✓
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowAddVictim(false);
                          setNewVictimeName('');
                        }}
                        className="h-4 text-xs px-1"
                      >
                        ✗
                      </Button>
                    </div>
                  </div>
                )}

                {/* Liste des victimes ultra-compacte */}
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {(!localInstruction.victimes || localInstruction.victimes.length === 0) ? (
                    <div className="text-center py-2 text-gray-400 italic text-xs">
                      Aucune
                    </div>
                  ) : (
                    localInstruction.victimes.map(victime => (
                      <div key={victime.id} className="bg-red-50 border border-red-200 rounded p-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-red-800 truncate">
                          {victime.nom.length > 12 ? `${victime.nom.substring(0, 12)}...` : victime.nom}
                        </span>
                        {isEditing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveVictim(victime.id)}
                            className="h-3 w-3 p-0 text-red-600 hover:bg-red-200"
                            title="Supprimer"
                          >
                            <Minus className="h-2 w-2" />
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* VIGNETTES MIS EN EXAMEN - ÉLARGI À 55% AVEC OPTIMISATION ESPACE */}
              <div className="flex-[0.55]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-gray-700 font-semibold">
                    Mis en examen ({localInstruction.misEnExamen?.length || 0})
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      initializeMexForm(); // 🆕 Préremplir intelligemment
                      setShowAddMexModal(true);
                    }}
                    className="h-5 w-5 p-0 text-green-600 hover:bg-green-100"
                    title="Ajouter mis en examen"
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  {/* 🆕 Indicateur de préremplissage intelligent */}
                  {smartDefaults.lastUsedInfractions && (
                    <div className="flex items-center gap-1 text-xs text-blue-600">
                      <Lightbulb className="h-3 w-3" />
                      <span>Préremplissage activé</span>
                    </div>
                  )}
                </div>
                
                {(!localInstruction.misEnExamen || localInstruction.misEnExamen.length === 0) ? (
                  <div className="text-center py-6 text-gray-400 italic text-sm">
                    Aucun mis en examen
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {localInstruction.misEnExamen.map(mex => {
                      const statutColors = {
                        libre: 'bg-green-100 text-green-700 border-green-300',
                        cj: 'bg-blue-100 text-blue-700 border-blue-300',
                        detenu: 'bg-orange-100 text-orange-700 border-orange-300',
                        arse: 'bg-purple-100 text-purple-700 border-purple-300'
                      };
                      
                      const statutLabels = {
                        libre: 'Libre',
                        cj: 'CJ',
                        detenu: 'Détenu',
                        arse: 'ARSE'
                      };

                      const isExpiredDP = mex.dateFinDP && new Date(mex.dateFinDP) < new Date();
                      const isEditingThisMex = editingMexId === mex.id;
                      
                      return (
                        <div key={`${mex.id}-${refreshKey}`} className="bg-white border border-gray-200 rounded p-2 hover:shadow-sm transition-shadow">
                          {isEditingThisMex ? (
                            /* MODE ÉDITION OPTIMISÉ */
                            <div className="space-y-2">
                              {/* Nom et statut */}
                              <div className="grid grid-cols-2 gap-1">
                                <Input
                                  value={editingMexData.nom}
                                  onChange={(e) => setEditingMexData({...editingMexData, nom: e.target.value})}
                                  className="h-6 text-xs font-medium"
                                  placeholder="Nom"
                                />
                                <Select
                                  value={editingMexData.statut}
                                  onChange={(e) => setEditingMexData({...editingMexData, statut: e.target.value as any})}
                                  className="h-6 text-xs"
                                >
                                  <option value="libre">Libre</option>
                                  <option value="cj">CJ</option>
                                  <option value="detenu">Détenu</option>
                                  <option value="arse">ARSE</option>
                                </Select>
                              </div>

                              <Input
                                type="date"
                                value={editingMexData.dateExamen}
                                onChange={(e) => setEditingMexData({...editingMexData, dateExamen: e.target.value})}
                                className="h-6 text-xs"
                              />

                              {/* Infractions - Zone de texte pour plusieurs */}
                              <textarea
                                value={editingMexData.infractions}
                                onChange={(e) => setEditingMexData({...editingMexData, infractions: e.target.value})}
                                className="w-full h-16 text-xs border border-gray-300 rounded px-2 py-1 resize-none"
                                placeholder="Infractions (une par ligne ou séparées par des virgules)"
                              />

                              {editingMexData.statut === 'detenu' && (
                                <div className="bg-orange-50 p-1 rounded border border-orange-200">
                                  <div className="grid grid-cols-2 gap-1">
                                    <Input
                                      type="date"
                                      value={editingMexData.datePlacementDP}
                                      onChange={(e) => setEditingMexData({...editingMexData, datePlacementDP: e.target.value})}
                                      className="h-6 text-xs"
                                      placeholder="Date DP"
                                    />
                                    <Select
                                      value={editingMexData.dureeDP.toString()}
                                      onChange={(e) => setEditingMexData({...editingMexData, dureeDP: parseInt(e.target.value) || 1})}
                                      className="h-6 text-xs"
                                    >
                                      <option value="1">1m</option>
                                      <option value="2">2m</option>
                                      <option value="3">3m</option>
                                      <option value="4">4m</option>
                                      <option value="6">6m</option>
                                      <option value="12">12m</option>
                                      <option value="24">24m</option>
                                    </Select>
                                  </div>
                                </div>
                              )}

                              <Input
                                value={editingMexData.description}
                                onChange={(e) => setEditingMexData({...editingMexData, description: e.target.value})}
                                className="h-6 text-xs"
                                placeholder="Observations"
                              />
                              
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    // Traitement des infractions multiples
                                    const infractions = editingMexData.infractions
                                      .split(/[,\n]/)
                                      .map(inf => inf.trim())
                                      .filter(Boolean);

                                    const updatedMex = localInstruction.misEnExamen?.map(m =>
                                      m.id === mex.id ? {
                                        ...m,
                                        nom: editingMexData.nom,
                                        dateExamen: editingMexData.dateExamen,
                                        chefs: infractions,
                                        statut: editingMexData.statut,
                                        role: editingMexData.statut === 'detenu' ? 'detenu' : 'libre',
                                        description: editingMexData.description || undefined,
                                        datePlacementDP: editingMexData.statut === 'detenu' ? editingMexData.datePlacementDP : undefined,
                                        dureeInitialeDP: editingMexData.statut === 'detenu' ? editingMexData.dureeDP : undefined,
                                        dateFinDP: editingMexData.statut === 'detenu' && editingMexData.datePlacementDP ? (() => {
                                          const date = new Date(editingMexData.datePlacementDP);
                                          date.setMonth(date.getMonth() + editingMexData.dureeDP);
                                          return date.toISOString().split('T')[0];
                                        })() : undefined
                                      } : m
                                    );
                                    
                                    handleUpdateWithToast(localInstruction.id, { misEnExamen: updatedMex });
                                    setEditingMexId(null);
                                  }}
                                  className="h-6 text-xs flex-1"
                                >
                                  ✓
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingMexId(null)}
                                  className="h-6 text-xs flex-1"
                                >
                                  ✗
                                </Button>
                              </div>
                            </div>
                          ) : (
                            /* MODE AFFICHAGE OPTIMISÉ */
                            <div className="space-y-1">
                              {/* En-tête compact : nom + statut + bouton */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                  <span className="font-medium text-xs text-gray-900 truncate">
                                    {mex.nom}
                                  </span>
                                  <Badge 
                                    variant="outline" 
                                    className={`text-xs h-4 px-1 flex-shrink-0 ${statutColors[mex.statut || 'libre']}`}
                                  >
                                    {statutLabels[mex.statut || 'libre']}
                                  </Badge>
                                </div>
                                {isEditing && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingMexId(mex.id);
                                      setEditingMexData({
                                        nom: mex.nom,
                                        dateExamen: mex.dateExamen,
                                        infractions: mex.chefs?.join('\n') || '',
                                        statut: mex.statut || 'libre',
                                        description: mex.description || '',
                                        datePlacementDP: mex.datePlacementDP || '',
                                        dureeDP: mex.dureeInitialeDP || 1
                                      });
                                    }}
                                    className="h-4 w-4 p-0 text-blue-600 hover:bg-blue-100 flex-shrink-0"
                                  >
                                    <Edit className="h-2 w-2" />
                                  </Button>
                                )}
                              </div>

                              {/* Dates compactes - TOUT SUR UNE LIGNE */}
                              <div className="flex items-center gap-3 text-xs bg-gray-50 p-1 rounded">
                                <span className="text-gray-600">
                                  MEX: {new Date(mex.dateExamen).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'})}
                                </span>
                                {mex.statut === 'detenu' && mex.datePlacementDP && (
                                  <span className="text-orange-600">
                                    DP: {new Date(mex.datePlacementDP).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'})}
                                  </span>
                                )}
                                {/* Échéance DP sur la même ligne */}
                                {mex.dateFinDP && (
                                  <span className={`flex items-center gap-1 ${isExpiredDP ? 'text-red-600 font-bold' : 'text-orange-600'}`}>
                                    {isExpiredDP && <AlertTriangle className="h-2 w-2" />}
                                    Éch: {new Date(mex.dateFinDP).toLocaleDateString('fr-FR', {day: '2-digit', month: '2-digit'})}
                                    {isExpiredDP && ' !'}
                                  </span>
                                )}
                              </div>

                              {/* Infractions organisées - OPTIMISÉES POUR L'ESPACE */}
                              {mex.chefs && mex.chefs.length > 0 && (
                                <div className="bg-gray-50 border border-gray-200 rounded p-1">
                                  <div className="text-xs text-gray-600 font-medium mb-0.5">
                                    Infractions ({mex.chefs.length}):
                                  </div>
                                  <div className="space-y-0.5">
                                    {mex.chefs.slice(0, 4).map((chef, idx) => (
                                      <div key={idx} className="text-xs text-gray-700 bg-white rounded px-1 py-0.5 border leading-tight">
                                        • {chef.length > 40 ? `${chef.substring(0, 40)}...` : chef}
                                      </div>
                                    ))}
                                    {mex.chefs.length > 4 && (
                                      <div className="text-xs text-blue-600 font-medium">
                                        ... +{mex.chefs.length - 4} autres infractions
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Observations si présentes */}
                              {mex.description && (
                                <div className="text-xs text-gray-500 italic bg-blue-50 p-1 rounded border border-blue-200">
                                  {mex.description.length > 50 ? `${mex.description.substring(0, 50)}...` : mex.description}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* DESCRIPTION DU DOSSIER À DROITE - 37% avec police augmentée */}
              <div className="flex-[0.37] bg-white border-2 border-gray-200 rounded-lg p-2">
                <label className="text-xs font-semibold text-gray-700 mb-1 block">
                  Description du dossier ({(localInstruction.description || '').length}/2000):
                </label>
                {isEditing ? (
                  <textarea
                    value={localInstruction.description || ''}
                    onChange={(e) => {
                      const text = e.target.value;
                      if (text.length <= 3000) {
                        setLocalInstruction(prev => ({ ...prev, description: text }));
  }
}}
onBlur={(e) => {
  handleUpdateWithToast(localInstruction.id, { description: e.target.value });
}}
                    placeholder="Description détaillée du dossier d'instruction..."
                    maxLength={2000}
                    className="w-full h-56 text-sm border border-gray-300 rounded px-2 py-1 bg-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    style={{ 
                      columns: '2',
                      columnGap: '0.75rem',
                      columnRule: 'none',
                      columnFill: 'auto',
                      maxWidth: '100%',
                      overflow: 'hidden'
                    }}
                  />
                ) : (
                  <div 
                    className="text-sm text-gray-600 h-56 overflow-y-auto bg-gray-50 rounded px-2 py-1 border"
                    style={{ 
                      columns: '2',
                      columnGap: '0.75rem',
                      columnRule: 'none',
                      columnFill: 'auto',
                      maxWidth: '100%',
                      overflowX: 'hidden'
                    }}
                  >
                    {localInstruction.description || (
                      <span className="italic text-gray-400">Aucune description</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CONTENU PRINCIPAL - 3 COLONNES */}
          <div className="flex-1 p-2" key={`content-${refreshKey}`}>
            {/* Onglet Général */}
            {activeTab === 'general' && (
              <div className="grid grid-cols-12 gap-2 min-h-full">
                {/* Colonne 1 - 30% */}
                <div className="col-span-4 space-y-2">
                  <CompteRenduSection
                    enquete={localInstruction}
                    editingCR={editingCR}
                    onAddCR={handleAddCR}
                    onUpdateCR={handleUpdateCR}
                    onDeleteCR={handleDeleteCR}
                    setEditingCR={setEditingCR}
                    isEditing={isEditing}
                  />
                  
                  {/* Espace vide réservé */}
                  <div className="min-h-[200px]">
                    {/* Espace libre pour futures sections */}
                  </div>
                </div>

                {/* Colonne 2 - 35% */}
                <div className="col-span-4 space-y-2">
                  <OPManager
                    instruction={localInstruction}
                    onUpdate={handleUpdateWithToast}
                    isEditing={isEditing}
                  />

                  <RDSection
                    instruction={localInstruction}
                    onUpdate={handleUpdateWithToast}
                    isEditing={isEditing}
                  />
                </div>

                {/* Colonne 3 - 35% - TIMELINE */}
                <div className="col-span-4">
                  <InstructionTimeline
                    instruction={localInstruction}
                    onUpdate={handleUpdateWithToast}
                    isEditing={isEditing}
                  />
                </div>
              </div>
            )}

            {/* Onglet Documents */}
            {activeTab === 'documents' && (
              <DocumentsSection
                enquete={localInstruction}
                onUpdate={handleUpdateWithToast}
                isEditing={isEditing}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

         
      <DMLModal
        isOpen={showDMLModal}
        onClose={() => setShowDMLModal(false)}
        onConfirm={(detenus) => {
          const today = new Date().toISOString().split('T')[0];
          const echeance = new Date();
          echeance.setDate(echeance.getDate() + 10);
          
          const newDML = {
            id: Date.now(),
            dateDepot: today,
            dateEcheance: echeance.toISOString().split('T')[0],
            statut: 'en_attente' as const,
            notes: `DML pour ${detenus.length} détenu(s)`,
            concernedDetenus: detenus
          };

          const updatedDMLs = [...(localInstruction.dmls || []), newDML];
          handleUpdateWithToast(localInstruction.id, { dmls: updatedDMLs });
        }}
        instruction={localInstruction}
      />

      <DebatModal
        isOpen={showDebatModal}
        onClose={() => setShowDebatModal(false)}
        onConfirm={(detenuId, type, issue) => {
          const newDebat = {
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            type,
            issue: issue || '',
            notes: '',
            concernedDetenu: detenuId,
            sourceType: 'manual' as const
          };

          const updatedDebats = [...(localInstruction.debatsParquet || []), newDebat];
          handleUpdateWithToast(localInstruction.id, { debatsParquet: updatedDebats });
        }}
        instruction={localInstruction}
        type={debatType}
      />

      <DeleteInstructionModal 
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        instructionNumero={localInstruction.numeroInstruction || 'Dossier'}
      />

      {/* Modal pour ajouter mis en examen complet AVEC PRÉREMPLISSAGE AUTOMATIQUE */}
      <Dialog open={showAddMexModal} onOpenChange={setShowAddMexModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Ajouter un mis en examen
              {smartDefaults.lastUsedInfractions && (
                <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">
                  <Lightbulb className="h-3 w-3 mr-1" />
                  Préremplissage intelligent
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-4">
            {/* Nom et date AVEC PRÉREMPLISSAGE AUTOMATIQUE */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Nom et prénom *</label>
                <Input
                  value={mexFormData.nom}
                  onChange={(e) => setMexFormData({...mexFormData, nom: e.target.value})}
                  placeholder="Nom complet"
                  className="mt-1"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-sm font-medium">Date de mise en examen *</label>
                <Input
                  type="date"
                  value={mexFormData.dateExamen}
                  onChange={(e) => handleMexDateExamenChange(e.target.value)}
                  className="mt-1"
                />
                {mexFormData.statut === 'detenu' && (
                  <p className="text-xs text-blue-600 mt-1">
                    💡 Cette date préremplira automatiquement la date de placement DP
                  </p>
                )}
              </div>
            </div>

            {/* Infractions et statut AVEC PRÉREMPLISSAGE */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Infractions ciblées *</label>
                  {localInstruction.misEnExamen && localInstruction.misEnExamen.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={copyInfractionsFromLast}
                      className="h-6 text-xs text-blue-600 hover:text-blue-700"
                      title="Copier les infractions du dernier mis en examen"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copier du dernier
                    </Button>
                  )}
                </div>
                <textarea
                  value={mexFormData.infractions}
                  onChange={(e) => setMexFormData({...mexFormData, infractions: e.target.value})}
                  placeholder="Ex: Trafic de stupéfiants&#10;Vol en bande organisée&#10;Recel..."
                  className="mt-1 h-20 resize-none w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {smartDefaults.lastUsedInfractions ? 
                    "Prérempli avec les infractions les plus courantes • Une par ligne ou séparez par des virgules" : 
                    "Une par ligne ou séparez par des virgules"}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Statut *</label>
                <Select
                  value={mexFormData.statut}
                  onChange={(e) => handleMexStatutChange(e.target.value as any)}
                  className="mt-1"
                >
                  <option value="libre">Libre</option>
                  <option value="cj">Contrôle judiciaire</option>
                  <option value="detenu">Détenu</option>
                  <option value="arse">ARSE</option>
                </Select>
                {mexFormData.statut === 'detenu' && (
                  <p className="text-xs text-orange-600 mt-1">
                    🔒 Mode détenu activé - sections DP disponibles
                  </p>
                )}
              </div>
            </div>

            {/* Description optionnelle */}
            <div>
              <label className="text-sm font-medium">Observations (optionnel)</label>
              <Input
                value={mexFormData.description}
                onChange={(e) => setMexFormData({...mexFormData, description: e.target.value})}
                placeholder="Observations particulières..."
                className="mt-1"
              />
            </div>

            {/* Section DP si détenu AVEC PRÉREMPLISSAGE AUTOMATIQUE */}
            {mexFormData.statut === 'detenu' && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-orange-900 mb-3 flex items-center gap-2">
                  Détention provisoire * 
                  <Badge variant="outline" className="text-xs bg-blue-100 text-blue-700">
                    Auto-remplie
                  </Badge>
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-orange-800">Date de placement DP *</label>
                    <Input
                      type="date"
                      value={mexFormData.datePlacementDP}
                      onChange={(e) => setMexFormData({...mexFormData, datePlacementDP: e.target.value})}
                      className="mt-1"
                    />
                    <p className="text-xs text-orange-600 mt-1">
                      💡 Préremplie automatiquement avec la date de mise en examen
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-orange-800">Durée DP (mois) *</label>
                    <Select
                      value={mexFormData.dureeDP.toString()}
                      onChange={(e) => setMexFormData({...mexFormData, dureeDP: parseInt(e.target.value) || 4})}
                      className="mt-1"
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
                      💡 Durée par défaut: {smartDefaults.commonDureeDP} mois (la plus utilisée dans ce dossier)
                    </p>
                  </div>
                </div>
                
                {mexFormData.datePlacementDP && mexFormData.dureeDP && (
                  <div className="mt-2 text-sm text-orange-700 bg-orange-100 p-2 rounded">
                    <strong>Échéance DP calculée:</strong> {(() => {
                      const date = new Date(mexFormData.datePlacementDP);
                      date.setMonth(date.getMonth() + mexFormData.dureeDP);
                      return date.toLocaleDateString();
                    })()}
                  </div>
                )}
                
                <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-xs text-orange-800">
                  ⚖️ Ce placement générera automatiquement un débat parquet
                </div>
              </div>
            )}

            {/* Affichage des defaults intelligents */}
            {smartDefaults.lastUsedInfractions && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs">
                <div className="flex items-center gap-2 text-blue-700 mb-2">
                  <Lightbulb className="h-4 w-4" />
                  <span className="font-medium">Préremplissage intelligent activé</span>
                </div>
                <div className="text-blue-600 space-y-1">
                  <div><strong>Infractions courantes:</strong> {smartDefaults.lastUsedInfractions}</div>
                  <div><strong>Durée DP habituelle:</strong> {smartDefaults.commonDureeDP} mois</div>
                  <div><strong>Date DP:</strong> Auto-remplie avec la date de mise en examen</div>
                </div>
              </div>
            )}

            {/* Boutons */}
            <div className="flex gap-2 pt-4">
              <Button 
                onClick={() => {
                  // Validation
                  if (!mexFormData.nom.trim()) {
                    showToast('Nom requis', 'error');
                    return;
                  }
                  if (!mexFormData.infractions.trim()) {
                    showToast('Infractions requises', 'error');
                    return;
                  }
                  if (mexFormData.statut === 'detenu' && (!mexFormData.datePlacementDP || !mexFormData.dureeDP)) {
                    showToast('Date et durée DP requises pour un détenu', 'error');
                    return;
                  }

                  // Créer le mis en examen
                  const infractions = mexFormData.infractions
                    .split(/[,\n]/)
                    .map(inf => inf.trim())
                    .filter(Boolean);

                  const newMex: MisEnExamen = {
                    id: Date.now(),
                    nom: mexFormData.nom.trim(),
                    dateExamen: mexFormData.dateExamen,
                    chefs: infractions,
                    role: mexFormData.statut === 'detenu' ? 'detenu' : 'libre',
                    statut: mexFormData.statut,
                    description: mexFormData.description.trim() || undefined,
                    datePlacementDP: mexFormData.statut === 'detenu' ? mexFormData.datePlacementDP : undefined,
                    dureeInitialeDP: mexFormData.statut === 'detenu' ? mexFormData.dureeDP : undefined,
                    dateFinDP: mexFormData.statut === 'detenu' ? (() => {
                      const date = new Date(mexFormData.datePlacementDP);
                      date.setMonth(date.getMonth() + mexFormData.dureeDP);
                      return date.toISOString().split('T')[0];
                    })() : undefined
                  };

                  const updatedMex = [...(localInstruction.misEnExamen || []), newMex];
                  
                  // Si détenu, créer automatiquement un débat parquet
                  let updates: Partial<EnqueteInstruction> = { misEnExamen: updatedMex };
                  
                  if (mexFormData.statut === 'detenu' && mexFormData.datePlacementDP) {
                    const newDebat: DebatParquet = {
                      id: Date.now() + 1,
                      date: mexFormData.datePlacementDP,
                      type: 'placement_dp',
                      issue: 'Accordé',
                      notes: `Placement DP automatique - ${mexFormData.nom}`,
                      concernedDetenu: newMex.id,
                      sourceType: 'manual'
                    };
                    
                    updates.debatsParquet = [...(localInstruction.debatsParquet || []), newDebat];
                    
                    // Ajouter l'historique au mis en examen
                    newMex.debatsHistory = [{
                      debatId: newDebat.id,
                      type: 'placement_dp',
                      date: mexFormData.datePlacementDP!,
                      decision: 'Accordé'
                    }];
                  }

                  handleUpdateWithToast(localInstruction.id, updates);
                  
                  // Reset form avec préremplissage pour le suivant
                  initializeMexForm();
                  setShowAddMexModal(false);
                  
                  showToast(
                    mexFormData.statut === 'detenu' 
                      ? 'Mis en examen ajouté avec débat parquet automatique' 
                      : 'Mis en examen ajouté',
                    'success'
                  );
                }}
                className="flex-1"
                disabled={!mexFormData.nom.trim() || !mexFormData.infractions.trim()}
              >
                Ajouter le mis en examen
              </Button>
              <Button 
                variant="outline" 
                onClick={() => {
                  initializeMexForm();
                  setShowAddMexModal(false);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};