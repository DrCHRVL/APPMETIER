import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { MecAutocompleteInput } from '../ui/MecAutocompleteInput';
import { Edit, X, Plus } from 'lucide-react';
import { Enquete } from '@/types/interfaces';

interface MisEnCauseSectionProps {
  enquete: Enquete;
  onUpdate?: (id: number, updates: Partial<Enquete>) => void;
  isEditing: boolean;
  /** Noms de tous les MEC connus (cross-dossiers) pour suggestions */
  allKnownMec?: string[];
}

export const MisEnCauseSection = ({ enquete, onUpdate, isEditing, allKnownMec = [] }: MisEnCauseSectionProps) => {
  const [editingMecId, setEditingMecId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState({ nom: '', role: '' });

  // Formulaire d'ajout rapide (visible même sans mode édition)
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMecData, setNewMecData] = useState({ nom: '', role: '' });

  const handleAddMec = () => {
    if (!onUpdate || !newMecData.nom.trim()) return;

    onUpdate(enquete.id, {
      misEnCause: [...enquete.misEnCause, {
        id: Date.now(),
        nom: newMecData.nom.trim(),
        role: newMecData.role.trim(),
        statut: 'actif'
      }]
    });

    setNewMecData({ nom: '', role: '' });
    setShowAddForm(false);
  };

  const handleUpdateMec = (id: number) => {
    if (!onUpdate || !editingData.nom.trim()) return;

    const updatedMecs = enquete.misEnCause.map(mec =>
      mec.id === id
        ? { ...mec, nom: editingData.nom.trim(), role: editingData.role.trim() }
        : mec
    );

    onUpdate(enquete.id, { misEnCause: updatedMecs });
    setEditingMecId(null);
    setEditingData({ nom: '', role: '' });
  };

  const handleDeleteMec = (id: number) => {
    if (!onUpdate) return;
    onUpdate(enquete.id, {
      misEnCause: enquete.misEnCause.filter(mec => mec.id !== id)
    });
  };

  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      {/* En-tête avec bouton + toujours visible */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Mis en cause</h3>
        {!showAddForm && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="Ajouter un mis en cause"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Formulaire d'ajout rapide */}
      {showAddForm && (
        <div className="space-y-2 mb-3 p-2 bg-white rounded border">
          <MecAutocompleteInput
            placeholder="Nom du mis en cause"
            value={newMecData.nom}
            onChange={(val) => setNewMecData(prev => ({ ...prev, nom: val }))}
            suggestions={allKnownMec}
            className="text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddMec();
              if (e.key === 'Escape') { setShowAddForm(false); setNewMecData({ nom: '', role: '' }); }
            }}
          />
          <Input
            placeholder="Rôle dans l'affaire (optionnel)"
            value={newMecData.role}
            onChange={(e) => setNewMecData(prev => ({ ...prev, role: e.target.value }))}
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddMec();
              if (e.key === 'Escape') { setShowAddForm(false); setNewMecData({ nom: '', role: '' }); }
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={handleAddMec} disabled={!newMecData.nom.trim()}>
              Ajouter
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowAddForm(false); setNewMecData({ nom: '', role: '' }); }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Liste des mis en cause */}
      <div className="grid gap-2">
        {enquete.misEnCause.map((mec) => (
          <div key={mec.id} className="bg-white p-2 rounded shadow-sm">
            {editingMecId === mec.id ? (
              <div className="space-y-2">
                <MecAutocompleteInput
                  value={editingData.nom}
                  onChange={(val) => setEditingData(prev => ({ ...prev, nom: val }))}
                  suggestions={allKnownMec}
                  className="text-sm"
                  placeholder="Nom"
                  autoFocus
                />
                <Input
                  value={editingData.role}
                  onChange={(e) => setEditingData(prev => ({ ...prev, role: e.target.value }))}
                  className="text-sm"
                  placeholder="Rôle"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => handleUpdateMec(mec.id)}>
                    Valider
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setEditingMecId(null); setEditingData({ nom: '', role: '' }); }}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-sm">{mec.nom}</div>
                  {mec.role && <div className="text-xs text-gray-500">{mec.role}</div>}
                </div>
                {isEditing && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingMecId(mec.id);
                        setEditingData({ nom: mec.nom, role: mec.role || '' });
                      }}
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteMec(mec.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
