import React, { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { Edit, AlertTriangle } from 'lucide-react';
import { MisEnExamen } from '@/types/interfaces';

interface MisEnExamenCardProps {
  mex: MisEnExamen;
  isGlobalEditing: boolean;
  onUpdate: (mexId: number, updates: Partial<MisEnExamen>) => boolean;
  onDelete?: (mexId: number) => boolean;
  getUrgencyLevel: (dateFinDP: string) => 'expired' | 'critical' | 'warning' | 'normal';
}

export const MisEnExamenCard = ({ 
  mex, 
  isGlobalEditing, 
  onUpdate, 
  onDelete,
  getUrgencyLevel 
}: MisEnExamenCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    nom: mex.nom,
    dateExamen: mex.dateExamen,
    infractions: mex.chefs?.join(', ') || '',
    statut: mex.statut || 'libre' as 'libre' | 'cj' | 'detenu' | 'arse',
    description: mex.description || '',
    datePlacementDP: mex.datePlacementDP || '',
    dureeDP: mex.dureeInitialeDP || 1
  });

  // Configuration des couleurs et labels par statut
  const statutConfig = {
    libre: { color: 'bg-green-100 text-green-700', label: 'Libre' },
    cj: { color: 'bg-blue-100 text-blue-700', label: 'CJ' },
    detenu: { color: 'bg-orange-100 text-orange-700', label: 'Détenu' },
    arse: { color: 'bg-purple-100 text-purple-700', label: 'ARSE' }
  };

  // Calcul de l'urgence de l'échéance DP
  const urgencyInfo = useMemo(() => {
    if (!mex.dateFinDP) return null;
    
    const level = getUrgencyLevel(mex.dateFinDP);
    const config = {
      expired: { color: 'text-red-800 font-bold', icon: true, suffix: ' (ÉCHUE)' },
      critical: { color: 'text-orange-600 font-semibold', icon: true, suffix: ' (URGENT)' },
      warning: { color: 'text-yellow-600', icon: false, suffix: '' },
      normal: { color: 'text-gray-600', icon: false, suffix: '' }
    };
    
    return {
      level,
      ...config[level],
      date: new Date(mex.dateFinDP).toLocaleDateString()
    };
  }, [mex.dateFinDP, getUrgencyLevel]);

  const handleSave = () => {
    // Validation locale
    if (!editData.nom.trim()) {
      return;
    }

    const updates: Partial<MisEnExamen> = {
      nom: editData.nom.trim(),
      dateExamen: editData.dateExamen,
      chefs: editData.infractions.split(',').map(inf => inf.trim()).filter(Boolean),
      statut: editData.statut,
      role: editData.statut === 'detenu' ? 'detenu' : 'libre',
      description: editData.description.trim() || undefined,
      datePlacementDP: editData.statut === 'detenu' ? editData.datePlacementDP : undefined,
      dureeInitialeDP: editData.statut === 'detenu' ? editData.dureeDP : undefined,
      dateFinDP: editData.statut === 'detenu' && editData.datePlacementDP ? (() => {
        const date = new Date(editData.datePlacementDP);
        date.setMonth(date.getMonth() + editData.dureeDP);
        return date.toISOString().split('T')[0];
      })() : undefined
    };

    const success = onUpdate(mex.id, updates);
    if (success) {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditData({
      nom: mex.nom,
      dateExamen: mex.dateExamen,
      infractions: mex.chefs?.join(', ') || '',
      statut: mex.statut || 'libre',
      description: mex.description || '',
      datePlacementDP: mex.datePlacementDP || '',
      dureeDP: mex.dureeInitialeDP || 1
    });
    setIsEditing(false);
  };

  const statutInfo = statutConfig[mex.statut || 'libre'];

  if (isEditing) {
    return (
      <div className="bg-white border-2 border-blue-200 rounded p-3 text-xs">
        <div className="space-y-3">
          {/* Nom et date */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-700">Nom *</label>
              <Input
                value={editData.nom}
                onChange={(e) => setEditData({...editData, nom: e.target.value})}
                className="h-7 text-xs mt-1"
                placeholder="Nom complet"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Date mise en examen *</label>
              <Input
                type="date"
                value={editData.dateExamen}
                onChange={(e) => setEditData({...editData, dateExamen: e.target.value})}
                className="h-7 text-xs mt-1"
              />
            </div>
          </div>
          
          {/* Infractions et statut */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-700">Infractions *</label>
              <Input
                value={editData.infractions}
                onChange={(e) => setEditData({...editData, infractions: e.target.value})}
                className="h-7 text-xs mt-1"
                placeholder="Séparer par des virgules"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Statut *</label>
              <Select
                value={editData.statut}
                onChange={(e) => setEditData({...editData, statut: e.target.value as any})}
                className="h-7 text-xs mt-1"
              >
                <option value="libre">Libre</option>
                <option value="cj">Contrôle judiciaire</option>
                <option value="detenu">Détenu</option>
                <option value="arse">ARSE</option>
              </Select>
            </div>
          </div>
          
          {/* Description */}
          <div>
            <label className="text-xs font-medium text-gray-700">Observations</label>
            <Input
              value={editData.description}
              onChange={(e) => setEditData({...editData, description: e.target.value})}
              className="h-7 text-xs mt-1"
              placeholder="Observations particulières..."
            />
          </div>
          
          {/* Section DP si détenu */}
          {editData.statut === 'detenu' && (
            <div className="bg-orange-50 border border-orange-200 rounded p-2">
              <h5 className="text-xs font-medium text-orange-900 mb-2">Détention provisoire</h5>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-orange-800">Date placement DP *</label>
                  <Input
                    type="date"
                    value={editData.datePlacementDP}
                    onChange={(e) => setEditData({...editData, datePlacementDP: e.target.value})}
                    className="h-6 text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-orange-800">Durée DP (mois) *</label>
                  <Select
                    value={editData.dureeDP.toString()}
                    onChange={(e) => setEditData({...editData, dureeDP: parseInt(e.target.value) || 1})}
                    className="h-6 text-xs mt-1"
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="6">6</option>
                    <option value="12">12</option>
                    <option value="24">24</option>
                  </Select>
                </div>
              </div>
              
              {editData.datePlacementDP && editData.dureeDP && (
                <div className="mt-2 text-xs text-orange-700">
                  Échéance DP: {(() => {
                    const date = new Date(editData.datePlacementDP);
                    date.setMonth(date.getMonth() + editData.dureeDP);
                    return date.toLocaleDateString();
                  })()}
                </div>
              )}
            </div>
          )}
          
          {/* Boutons */}
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleSave}
              className="h-6 text-xs flex-1"
              disabled={!editData.nom.trim() || !editData.infractions.trim()}
            >
              Valider
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              className="h-6 text-xs"
            >
              Annuler
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Mode affichage
  return (
    <div className="bg-white border rounded p-2 text-xs hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-sm truncate flex-1">{mex.nom}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Badge 
            variant="outline" 
            className={`text-xs ${statutInfo.color}`}
          >
            {statutInfo.label}
          </Badge>
          {isGlobalEditing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-4 w-4 p-0 text-blue-600 hover:text-blue-700"
              title="Modifier"
            >
              <Edit className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      
      <div className="space-y-2">
        {/* Dates importantes */}
        <div className="space-y-1">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-600">
              Mis en examen: {new Date(mex.dateExamen).toLocaleDateString()}
            </span>
            {mex.datePlacementDP && (
              <span className="text-orange-600">
                DP: {new Date(mex.datePlacementDP).toLocaleDateString()}
              </span>
            )}
          </div>
          
          {/* Échéance DP avec indicateur d'urgence */}
          {urgencyInfo && (
            <div className="flex items-center gap-2">
              {urgencyInfo.icon && (
                <AlertTriangle className="h-3 w-3 text-red-500" />
              )}
              <span className={`text-xs ${urgencyInfo.color}`}>
                Échéance DP: {urgencyInfo.date}{urgencyInfo.suffix}
              </span>
              {mex.dateRenouvellementDP && (
                <span className="text-blue-600 text-xs">
                  Renouv: {new Date(mex.dateRenouvellementDP).toLocaleDateString()}
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Infractions */}
        {mex.chefs && mex.chefs.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-gray-600 text-xs">Infractions:</span>
            {mex.chefs.slice(0, 2).map((chef, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs px-1 py-0">
                {chef.length > 15 ? `${chef.substring(0, 15)}...` : chef}
              </Badge>
            ))}
            {mex.chefs.length > 2 && (
              <Badge variant="secondary" className="text-xs px-1 py-0">
                +{mex.chefs.length - 2} autres
              </Badge>
            )}
          </div>
        )}
        
        {/* Observations */}
        {mex.description && (
          <div className="text-gray-500 italic text-xs bg-gray-50 p-1 rounded">
            <span className="font-medium">Obs:</span> {
              mex.description.length > 60 
                ? `${mex.description.substring(0, 60)}...` 
                : mex.description
            }
          </div>
        )}
      </div>
    </div>
  );
};