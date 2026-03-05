import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Select } from '../ui/select';
import { 
  Plus, 
  Minus,
  Gavel, 
  Calendar, 
  Edit3,
  Trash2,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { EnqueteInstruction, DebatParquet } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface ReqlibManagerProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  compact?: boolean;
}

export const ReqlibManager = ({
  instruction,
  onUpdate,
  compact = false
}: ReqlibManagerProps) => {
  const { showToast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDebat, setEditingDebat] = useState<DebatParquet | null>(null);
  
  // Formulaire débat
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    type: 'prolongation_dp' as DebatParquet['type'],
    issue: '',
    notes: ''
  });

  const debats = instruction.debatsParquet || [];

  // Ajout rapide débat
  const handleQuickAdd = () => {
    const today = new Date().toISOString().split('T')[0];
    
    const newDebat: DebatParquet = {
      id: Date.now(),
      date: today,
      type: 'prolongation_dp',
      issue: '',
      notes: ''
    };

    const updatedDebats = [...debats, newDebat];
    onUpdate(instruction.id, { debatsParquet: updatedDebats });
    showToast('Débat parquet ajouté', 'success');
  };

  // Ajout avec formulaire
  const handleFormAdd = () => {
    if (!formData.date) {
      showToast('Date requise', 'error');
      return;
    }

    const newDebat: DebatParquet = {
      id: Date.now(),
      date: formData.date,
      type: formData.type,
      issue: formData.issue.trim(),
      notes: formData.notes.trim()
    };

    const updatedDebats = [...debats, newDebat];
    onUpdate(instruction.id, { debatsParquet: updatedDebats });
    
    // Reset form
    setFormData({
      date: new Date().toISOString().split('T')[0],
      type: 'prolongation_dp',
      issue: '',
      notes: ''
    });
    setShowAddForm(false);
    
    showToast('Débat parquet ajouté', 'success');
  };

  // Suppression débat
  const handleDelete = (debatId: number) => {
    if (confirm('Supprimer ce débat ?')) {
      const updatedDebats = debats.filter(debat => debat.id !== debatId);
      onUpdate(instruction.id, { debatsParquet: updatedDebats });
      showToast('Débat supprimé', 'success');
    }
  };

  // Mise à jour débat
  const handleUpdate = (debatId: number, updates: Partial<DebatParquet>) => {
    const updatedDebats = debats.map(debat =>
      debat.id === debatId ? { ...debat, ...updates } : debat
    );
    onUpdate(instruction.id, { debatsParquet: updatedDebats });
    setEditingDebat(null);
    showToast('Débat mis à jour', 'success');
  };

  // Calcul des stats
  const stats = {
    total: debats.length,
    placement: debats.filter(d => d.type === 'placement_dp').length,
    prolongation: debats.filter(d => d.type === 'prolongation_dp').length,
    dml: debats.filter(d => d.type === 'dml').length,
    autre: debats.filter(d => d.type === 'autre').length
  };

  // Version compacte (pour header)
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className="text-xs bg-orange-100 text-orange-700">
          {stats.total} Reqlib
        </Badge>
        
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-green-600 hover:bg-green-50"
          onClick={handleQuickAdd}
          title="Ajouter débat (date du jour)"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  // Version complète
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gavel className="h-4 w-4" />
            Débats parquet - Reqlib ({stats.total})
          </div>
          
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-green-600 hover:bg-green-50"
              onClick={handleQuickAdd}
              title="Ajout rapide (date du jour)"
            >
              <Plus className="h-3 w-3 mr-1" />
              Rapide
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-blue-600 hover:bg-blue-50"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              <Edit3 className="h-3 w-3 mr-1" />
              Détaillé
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Stats rapides */}
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div className="bg-blue-50 p-2 rounded text-center">
            <div className="font-semibold text-blue-700">{stats.placement}</div>
            <div className="text-blue-600">Placement</div>
          </div>
          <div className="bg-orange-50 p-2 rounded text-center">
            <div className="font-semibold text-orange-700">{stats.prolongation}</div>
            <div className="text-orange-600">Prolong.</div>
          </div>
          <div className="bg-purple-50 p-2 rounded text-center">
            <div className="font-semibold text-purple-700">{stats.dml}</div>
            <div className="text-purple-600">DML</div>
          </div>
          <div className="bg-gray-50 p-2 rounded text-center">
            <div className="font-semibold text-gray-700">{stats.autre}</div>
            <div className="text-gray-600">Autre</div>
          </div>
        </div>

        {/* Formulaire d'ajout détaillé */}
        {showAddForm && (
          <div className="border rounded-lg p-3 bg-orange-50">
            <h4 className="text-sm font-medium mb-2">Nouveau débat parquet</h4>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-gray-600">Date</label>
                <Input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({...formData, date: e.target.value})}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Type</label>
                <Select
                  value={formData.type}
                  onChange={(e) => setFormData({...formData, type: e.target.value as DebatParquet['type']})}
                  className="h-8 text-xs"
                >
                  <option value="placement_dp">Placement DP</option>
                  <option value="prolongation_dp">Prolongation DP</option>
                  <option value="dml">DML</option>
                  <option value="autre">Autre</option>
                </Select>
              </div>
            </div>
            
            <div className="mb-2">
              <label className="text-xs text-gray-600">Issue/Décision</label>
              <Input
                value={formData.issue}
                onChange={(e) => setFormData({...formData, issue: e.target.value})}
                placeholder="Accordé, rejeté, reporté..."
                className="h-8 text-xs"
              />
            </div>
            
            <div className="mb-2">
              <label className="text-xs text-gray-600">Notes (optionnel)</label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                placeholder="Notes sur ce débat..."
                className="h-16 text-xs"
              />
            </div>
            
            <div className="flex gap-2">
              <Button size="sm" onClick={handleFormAdd} className="text-xs">
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

        {/* Liste des débats */}
        <div className="space-y-2 max-h-48 overflow-auto">
          {debats.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <Gavel className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-xs">Aucun débat parquet</p>
            </div>
          ) : (
            debats.map(debat => {
              const typeColors = {
                placement_dp: 'border-blue-200 bg-blue-50',
                prolongation_dp: 'border-orange-200 bg-orange-50',
                dml: 'border-purple-200 bg-purple-50',
                autre: 'border-gray-200 bg-gray-50'
              };

              const typeLabels = {
                placement_dp: 'Placement DP',
                prolongation_dp: 'Prolongation DP',
                dml: 'DML',
                autre: 'Autre'
              };

              return (
                <div
                  key={debat.id}
                  className={`p-2 rounded border text-xs ${typeColors[debat.type]}`}
                >
                  {editingDebat?.id === debat.id ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          type="date"
                          value={editingDebat.date}
                          onChange={(e) => setEditingDebat({...editingDebat, date: e.target.value})}
                          className="h-7 text-xs"
                        />
                        <Select
                          value={editingDebat.type}
                          onChange={(e) => setEditingDebat({...editingDebat, type: e.target.value as DebatParquet['type']})}
                          className="h-7 text-xs"
                        >
                          <option value="placement_dp">Placement DP</option>
                          <option value="prolongation_dp">Prolongation DP</option>
                          <option value="dml">DML</option>
                          <option value="autre">Autre</option>
                        </Select>
                      </div>
                      <Input
                        value={editingDebat.issue || ''}
                        onChange={(e) => setEditingDebat({...editingDebat, issue: e.target.value})}
                        placeholder="Issue/Décision"
                        className="h-7 text-xs"
                      />
                      <Textarea
                        value={editingDebat.notes || ''}
                        onChange={(e) => setEditingDebat({...editingDebat, notes: e.target.value})}
                        placeholder="Notes..."
                        className="h-12 text-xs"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleUpdate(debat.id, editingDebat)}
                          className="h-6 text-xs"
                        >
                          Valider
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingDebat(null)}
                          className="h-6 text-xs"
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">
                            {new Date(debat.date).toLocaleDateString()}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {typeLabels[debat.type]}
                          </Badge>
                        </div>
                        
                        {debat.issue && (
                          <div className="text-xs text-gray-600 mb-1">
                            Issue: {debat.issue}
                          </div>
                        )}
                        
                        {debat.notes && (
                          <div className="text-xs text-gray-500 italic truncate">
                            {debat.notes}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-blue-600 hover:bg-blue-100"
                          onClick={() => setEditingDebat(debat)}
                          title="Modifier"
                        >
                          <Edit3 className="h-3 w-3" />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-red-600 hover:bg-red-100"
                          onClick={() => handleDelete(debat.id)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
};