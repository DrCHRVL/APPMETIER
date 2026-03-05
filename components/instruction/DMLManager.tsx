import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { Select } from '../ui/select';
import { 
  Plus, 
  Calendar, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Trash2,
  Edit3
} from 'lucide-react';
import { EnqueteInstruction, DML, calculateDMLEcheance } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface DMLManagerProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  compact?: boolean;
}

export const DMLManager = ({
  instruction,
  onUpdate,
  compact = false
}: DMLManagerProps) => {
  const { showToast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDML, setEditingDML] = useState<DML | null>(null);
  
  // Formulaire DML
  const [formData, setFormData] = useState({
    dateDepot: new Date().toISOString().split('T')[0],
    notes: ''
  });

  const dmls = instruction.dmls || [];

  // Ajout rapide DML
  const handleQuickAdd = () => {
    const today = new Date().toISOString().split('T')[0];
    const echeance = calculateDMLEcheance(today);
    
    const newDML: DML = {
      id: Date.now(),
      dateDepot: today,
      dateEcheance: echeance,
      statut: 'en_attente',
      notes: ''
    };

    const updatedDMLs = [...dmls, newDML];
    onUpdate(instruction.id, { dmls: updatedDMLs });
    showToast(`DML ajoutée - Échéance: ${new Date(echeance).toLocaleDateString()}`, 'success');
  };

  // Ajout avec formulaire
  const handleFormAdd = () => {
    if (!formData.dateDepot) {
      showToast('Date de dépôt requise', 'error');
      return;
    }

    const echeance = calculateDMLEcheance(formData.dateDepot);
    const newDML: DML = {
      id: Date.now(),
      dateDepot: formData.dateDepot,
      dateEcheance: echeance,
      statut: 'en_attente',
      notes: formData.notes.trim()
    };

    const updatedDMLs = [...dmls, newDML];
    onUpdate(instruction.id, { dmls: updatedDMLs });
    
    // Reset form
    setFormData({
      dateDepot: new Date().toISOString().split('T')[0],
      notes: ''
    });
    setShowAddForm(false);
    
    showToast(`DML ajoutée - Échéance: ${new Date(echeance).toLocaleDateString()}`, 'success');
  };

  // Modification statut DML
  const handleStatusChange = (dmlId: number, newStatus: DML['statut']) => {
    const updatedDMLs = dmls.map(dml =>
      dml.id === dmlId ? { ...dml, statut: newStatus } : dml
    );
    onUpdate(instruction.id, { dmls: updatedDMLs });
    
    const statusLabels = {
      'en_attente': 'en attente',
      'accordee': 'accordée',
      'rejetee': 'rejetée'
    };
    showToast(`DML ${statusLabels[newStatus]}`, 'success');
  };

  // Suppression DML
  const handleDelete = (dmlId: number) => {
    if (confirm('Supprimer cette DML ?')) {
      const updatedDMLs = dmls.filter(dml => dml.id !== dmlId);
      onUpdate(instruction.id, { dmls: updatedDMLs });
      showToast('DML supprimée', 'success');
    }
  };

  // Mise à jour DML
  const handleUpdate = (dmlId: number, updates: Partial<DML>) => {
    const updatedDMLs = dmls.map(dml =>
      dml.id === dmlId ? { ...dml, ...updates } : dml
    );
    onUpdate(instruction.id, { dmls: updatedDMLs });
    setEditingDML(null);
    showToast('DML mise à jour', 'success');
  };

  // Calcul des stats
  const stats = {
    total: dmls.length,
    enAttente: dmls.filter(d => d.statut === 'en_attente').length,
    accordees: dmls.filter(d => d.statut === 'accordee').length,
    rejetees: dmls.filter(d => d.statut === 'rejetee').length,
    enRetard: dmls.filter(d => 
      d.statut === 'en_attente' && 
      new Date(d.dateEcheance) < new Date()
    ).length
  };

  // Version compacte (pour header)
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Badge 
          variant="outline" 
          className={`text-xs ${stats.enRetard > 0 ? 'bg-red-100 text-red-700 border-red-300' : 'bg-purple-100 text-purple-700'}`}
        >
          {stats.total} DML
          {stats.enRetard > 0 && (
            <AlertTriangle className="h-3 w-3 ml-1" />
          )}
        </Badge>
        
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-green-600 hover:bg-green-50"
          onClick={handleQuickAdd}
          title="Ajouter DML (date du jour)"
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
            <Calendar className="h-4 w-4" />
            DML ({stats.total})
            {stats.enRetard > 0 && (
              <Badge variant="destructive" className="text-xs">
                {stats.enRetard} en retard
              </Badge>
            )}
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
          <div className="bg-gray-50 p-2 rounded text-center">
            <div className="font-semibold text-gray-700">{stats.enAttente}</div>
            <div className="text-gray-500">En attente</div>
          </div>
          <div className="bg-green-50 p-2 rounded text-center">
            <div className="font-semibold text-green-700">{stats.accordees}</div>
            <div className="text-green-600">Accordées</div>
          </div>
          <div className="bg-red-50 p-2 rounded text-center">
            <div className="font-semibold text-red-700">{stats.rejetees}</div>
            <div className="text-red-600">Rejetées</div>
          </div>
          <div className="bg-orange-50 p-2 rounded text-center">
            <div className="font-semibold text-orange-700">{stats.enRetard}</div>
            <div className="text-orange-600">En retard</div>
          </div>
        </div>

        {/* Formulaire d'ajout détaillé */}
        {showAddForm && (
          <div className="border rounded-lg p-3 bg-blue-50">
            <h4 className="text-sm font-medium mb-2">Nouvelle DML</h4>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="text-xs text-gray-600">Date dépôt</label>
                <Input
                  type="date"
                  value={formData.dateDepot}
                  onChange={(e) => setFormData({...formData, dateDepot: e.target.value})}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Échéance calculée</label>
                <Input
                  value={formData.dateDepot ? new Date(calculateDMLEcheance(formData.dateDepot)).toLocaleDateString() : ''}
                  disabled
                  className="h-8 text-xs bg-gray-100"
                />
              </div>
            </div>
            <div className="mb-2">
              <label className="text-xs text-gray-600">Notes (optionnel)</label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                placeholder="Notes sur cette DML..."
                className="h-16 text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleFormAdd} className="text-xs">
                Ajouter
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddForm(false)} className="text-xs">
                Annuler
              </Button>
            </div>
          </div>
        )}

        {/* Liste des DML */}
        <div className="space-y-2 max-h-48 overflow-auto">
          {dmls.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <Calendar className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-xs">Aucune DML</p>
            </div>
          ) : (
            dmls.map(dml => {
              const isEnRetard = new Date(dml.dateEcheance) < new Date() && dml.statut === 'en_attente';
              const joursRestants = Math.ceil(
                (new Date(dml.dateEcheance).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
              );

              return (
                <div
                  key={dml.id}
                  className={`p-2 rounded border text-xs ${
                    isEnRetard ? 'bg-red-50 border-red-200' :
                    dml.statut === 'accordee' ? 'bg-green-50 border-green-200' :
                    dml.statut === 'rejetee' ? 'bg-gray-50 border-gray-200' :
                    'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {new Date(dml.dateDepot).toLocaleDateString()}
                      </span>
                      <Clock className="h-3 w-3 text-gray-400" />
                      <span className={`text-xs ${isEnRetard ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                        {new Date(dml.dateEcheance).toLocaleDateString()}
                        {dml.statut === 'en_attente' && (
                          <span className="ml-1">
                            ({isEnRetard ? `+${Math.abs(joursRestants)}j` : `${joursRestants}j`})
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Boutons statut */}
                      {dml.statut === 'en_attente' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-green-600 hover:bg-green-100"
                            onClick={() => handleStatusChange(dml.id, 'accordee')}
                            title="Marquer accordée"
                          >
                            <CheckCircle className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-red-600 hover:bg-red-100"
                            onClick={() => handleStatusChange(dml.id, 'rejetee')}
                            title="Marquer rejetée"
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-gray-600 hover:bg-gray-100"
                        onClick={() => handleDelete(dml.id)}
                        title="Supprimer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Statut et notes */}
                  <div className="flex items-center justify-between">
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${
                        dml.statut === 'accordee' ? 'text-green-700 border-green-300' :
                        dml.statut === 'rejetee' ? 'text-red-700 border-red-300' :
                        isEnRetard ? 'text-red-700 border-red-300 bg-red-100' :
                        'text-gray-700 border-gray-300'
                      }`}
                    >
                      {dml.statut === 'en_attente' ? (isEnRetard ? 'En retard' : 'En attente') :
                       dml.statut === 'accordee' ? 'Accordée' : 'Rejetée'}
                    </Badge>
                    
                    {dml.notes && (
                      <span className="text-xs text-gray-500 italic truncate max-w-32">
                        {dml.notes}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
};