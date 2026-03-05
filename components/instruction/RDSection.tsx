import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { 
  FileText, 
  Calendar, 
  Edit3, 
  CheckCircle, 
  XCircle,
  Calculator,
  AlertCircle
} from 'lucide-react';
import { EnqueteInstruction, RDData, RapportAppel } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface RDSectionProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  isEditing: boolean;
}

export const RDSection = ({
  instruction,
  onUpdate,
  isEditing
}: RDSectionProps) => {
  const { showToast } = useToast();
  const [editingRD, setEditingRD] = useState(false);
  const [editingRapport, setEditingRapport] = useState(false);

  // Formulaires
  const [rdForm, setRdForm] = useState({
    rendu: instruction.rdData?.rendu || false,
    nbPages: instruction.rdData?.nbPages || 0,
    dateRendu: instruction.rdData?.dateRendu || ''
  });

  const [rapportForm, setRapportForm] = useState({
    rendu: instruction.rapportAppel?.rendu || false,
    nbPages: instruction.rapportAppel?.nbPages || 0,
    dateRendu: instruction.rapportAppel?.dateRendu || ''
  });

  const rdData = instruction.rdData;
  const rapportData = instruction.rapportAppel;

  // Calcul pages totales avec règle spéciale
  const calculateTotalPages = () => {
    const rdPages = rdData?.nbPages || 0;
    const rapportPages = rapportData?.nbPages || 0;
    
    // Si les deux sont rendus dans le même dossier, ne compter que le RD final
    if (rdData?.rendu && rapportData?.rendu) {
      // Pour simplifier, on considère qu'ils sont dans le même dossier si rendus
      // On pourrait ajouter un champ "memeDossier" plus tard
      return rdPages;
    }
    
    return rdPages + rapportPages;
  };

  // Sauvegarde RD
  const handleSaveRD = () => {
    if (rdForm.rendu && (!rdForm.dateRendu || rdForm.nbPages <= 0)) {
      showToast('Date et nombre de pages requis pour un RD rendu', 'error');
      return;
    }

    const newRDData: RDData = {
      rendu: rdForm.rendu,
      nbPages: rdForm.rendu ? rdForm.nbPages : undefined,
      dateRendu: rdForm.rendu ? rdForm.dateRendu : undefined
    };

    onUpdate(instruction.id, { rdData: newRDData });
    setEditingRD(false);
    showToast('RD mis à jour', 'success');
  };

  // Sauvegarde rapport
  const handleSaveRapport = () => {
    if (rapportForm.rendu && (!rapportForm.dateRendu || rapportForm.nbPages <= 0)) {
      showToast('Date et nombre de pages requis pour un rapport rendu', 'error');
      return;
    }

    const newRapportData: RapportAppel = {
      rendu: rapportForm.rendu,
      nbPages: rapportForm.rendu ? rapportForm.nbPages : undefined,
      dateRendu: rapportForm.rendu ? rapportForm.dateRendu : undefined
    };

    onUpdate(instruction.id, { rapportAppel: newRapportData });
    setEditingRapport(false);
    showToast('Rapport d\'appel mis à jour', 'success');
  };

  // Toggle rapide RD
  const handleQuickToggleRD = () => {
    const newStatus = !rdData?.rendu;
    const today = new Date().toISOString().split('T')[0];
    
    const newRDData: RDData = {
      rendu: newStatus,
      nbPages: newStatus ? 1 : undefined, // Valeur par défaut
      dateRendu: newStatus ? today : undefined
    };

    onUpdate(instruction.id, { rdData: newRDData });
    showToast(`RD ${newStatus ? 'marqué rendu' : 'marqué non rendu'}`, 'success');
  };

  // Toggle rapide rapport
  const handleQuickToggleRapport = () => {
    const newStatus = !rapportData?.rendu;
    const today = new Date().toISOString().split('T')[0];
    
    const newRapportData: RapportAppel = {
      rendu: newStatus,
      nbPages: newStatus ? 1 : undefined,
      dateRendu: newStatus ? today : undefined
    };

    onUpdate(instruction.id, { rapportAppel: newRapportData });
    showToast(`Rapport ${newStatus ? 'marqué rendu' : 'marqué non rendu'}`, 'success');
  };

  const totalPages = calculateTotalPages();

  return (
    <div className="space-y-4">
      {/* Résumé pages totales */}
      <Card className="border-2 border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-blue-600" />
              <span className="font-medium text-blue-900">Pages totales rédigées</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">
              {totalPages}
            </div>
          </div>
          
          {rdData?.rendu && rapportData?.rendu && (
            <div className="mt-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-xs text-yellow-800">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              Même dossier détecté : seules les pages du RD final sont comptées
            </div>
          )}
        </CardContent>
      </Card>

      {/* RD (Réquisitoire Définitif) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              Réquisitoire Définitif (RD)
              {rdData?.rendu && (
                <Badge variant="outline" className="text-xs bg-green-100 text-green-700">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Rendu
                </Badge>
              )}
            </div>
            
            <div className="flex gap-1">
              {isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRdForm({
                      rendu: rdData?.rendu || false,
                      nbPages: rdData?.nbPages || 0,
                      dateRendu: rdData?.dateRendu || ''
                    });
                    setEditingRD(!editingRD);
                  }}
                  className="h-7 px-2 text-blue-600"
                >
                  <Edit3 className="h-3 w-3" />
                </Button>
              )}
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleQuickToggleRD}
                className={`h-7 px-2 ${rdData?.rendu ? 'text-red-600' : 'text-green-600'}`}
                title={rdData?.rendu ? 'Marquer non rendu' : 'Marquer rendu'}
              >
                {rdData?.rendu ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <CheckCircle className="h-3 w-3" />
                )}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        
        <CardContent>
          {editingRD ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={rdForm.rendu}
                  onCheckedChange={(checked) => setRdForm({...rdForm, rendu: checked})}
                />
                <Label className="text-sm">RD rendu</Label>
              </div>
              
              {rdForm.rendu && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Date rendu</Label>
                    <Input
                      type="date"
                      value={rdForm.dateRendu}
                      onChange={(e) => setRdForm({...rdForm, dateRendu: e.target.value})}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Nombre de pages</Label>
                    <Input
                      type="number"
                      min="1"
                      value={rdForm.nbPages}
                      onChange={(e) => setRdForm({...rdForm, nbPages: parseInt(e.target.value) || 0})}
                      className="h-8"
                    />
                  </div>
                </div>
              )}
              
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveRD}>
                  Sauvegarder
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingRD(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : rdData?.rendu ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Rendu le:</span>
                <span className="font-medium">
                  {rdData.dateRendu ? new Date(rdData.dateRendu).toLocaleDateString() : 'Date non renseignée'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Nombre de pages:</span>
                <Badge variant="outline" className="text-xs">
                  {rdData.nbPages || 0} pages
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">RD non encore rendu</p>
          )}
        </CardContent>
      </Card>

      {/* Rapport d'appel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-purple-500" />
              Rapport d'appel
              {rapportData?.rendu && (
                <Badge variant="outline" className="text-xs bg-green-100 text-green-700">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Rendu
                </Badge>
              )}
            </div>
            
            <div className="flex gap-1">
              {isEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRapportForm({
                      rendu: rapportData?.rendu || false,
                      nbPages: rapportData?.nbPages || 0,
                      dateRendu: rapportData?.dateRendu || ''
                    });
                    setEditingRapport(!editingRapport);
                  }}
                  className="h-7 px-2 text-blue-600"
                >
                  <Edit3 className="h-3 w-3" />
                </Button>
              )}
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleQuickToggleRapport}
                className={`h-7 px-2 ${rapportData?.rendu ? 'text-red-600' : 'text-green-600'}`}
                title={rapportData?.rendu ? 'Marquer non rendu' : 'Marquer rendu'}
              >
                {rapportData?.rendu ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <CheckCircle className="h-3 w-3" />
                )}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        
        <CardContent>
          {editingRapport ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={rapportForm.rendu}
                  onCheckedChange={(checked) => setRapportForm({...rapportForm, rendu: checked})}
                />
                <Label className="text-sm">Rapport rendu</Label>
              </div>
              
              {rapportForm.rendu && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Date rendu</Label>
                    <Input
                      type="date"
                      value={rapportForm.dateRendu}
                      onChange={(e) => setRapportForm({...rapportForm, dateRendu: e.target.value})}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Nombre de pages</Label>
                    <Input
                      type="number"
                      min="1"
                      value={rapportForm.nbPages}
                      onChange={(e) => setRapportForm({...rapportForm, nbPages: parseInt(e.target.value) || 0})}
                      className="h-8"
                    />
                  </div>
                </div>
              )}
              
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveRapport}>
                  Sauvegarder
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingRapport(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : rapportData?.rendu ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Rendu le:</span>
                <span className="font-medium">
                  {rapportData.dateRendu ? new Date(rapportData.dateRendu).toLocaleDateString() : 'Date non renseignée'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Nombre de pages:</span>
                <Badge variant="outline" className="text-xs">
                  {rapportData.nbPages || 0} pages
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">Rapport non encore rendu</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};