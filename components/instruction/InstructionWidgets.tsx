import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select } from '../ui/select';
import { 
  Plus, 
  Minus, 
  FileText, 
  Gavel, 
  Users, 
  Settings,
  TrendingUp,
  Clock
} from 'lucide-react';
import { EnqueteInstruction } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';

interface InstructionWidgetsProps {
  instruction: EnqueteInstruction;
  onUpdate: (id: number, updates: Partial<EnqueteInstruction>) => void;
  compact?: boolean;
}

export const InstructionWidgets = ({
  instruction,
  onUpdate,
  compact = false
}: InstructionWidgetsProps) => {
  const { showToast } = useToast();

  // Curseur état règlement
  const handleEtatChange = (newEtat: EnqueteInstruction['etatReglement']) => {
    onUpdate(instruction.id, { etatReglement: newEtat });
    
    const labels = {
      'instruction': 'En cours d\'instruction',
      '175_rendu': '175 rendu',
      'rd_fait': 'RD fait',
      'ordonnance_rendue': 'Ordonnance rendue'
    };
    
    showToast(`État: ${labels[newEtat]}`, 'success');
  };

  // Gestion compteur côtes
  const handleCotesChange = (increment: boolean) => {
    const newValue = Math.max(0, instruction.cotesTomes + (increment ? 1 : -1));
    onUpdate(instruction.id, { cotesTomes: newValue });
    showToast(`Côtes/tomes: ${newValue}`, 'success');
  };

  // Gestion orientation
  const handleOrientationChange = (orientation: EnqueteInstruction['orientation']) => {
    onUpdate(instruction.id, { orientation });
    showToast(`Orientation: ${orientation}`, 'success');
  };

  // Calcul pages totales avec règle spéciale - CORRIGÉ
  const calculateTotalPages = () => {
    const rdPages = instruction.rdData?.nbPages || 0;
    const rapportPages = instruction.rapportAppel?.nbPages || 0;
    
    // Si les deux sont rendus dans le même dossier, ne compter que le RD final
    if (instruction.rdData?.rendu && instruction.rapportAppel?.rendu) {
      // Pour simplifier, on considère qu'ils sont dans le même dossier si rendus
      // On pourrait ajouter un champ "memeDossier" plus tard
      return rdPages;
    }
    
    return rdPages + rapportPages;
  };

  // Calcul compteurs automatiques - CORRIGÉ
  const nbMisEnExamen = instruction.misEnExamen?.length || 0;
  const nbDebatsParquet = (instruction.debatsParquet?.length || 0) + 
                         ((instruction.ops || []).reduce((sum, op) => sum + (op.nbDebats || 0), 0));
  const nbPagesTotal = calculateTotalPages();

  // Version compacte (pour header)
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {/* Compteur côtes */}
        <div className="flex items-center gap-1 bg-gray-100 rounded px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-gray-600"
            onClick={() => handleCotesChange(false)}
            disabled={instruction.cotesTomes <= 0}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="text-xs font-medium min-w-8 text-center">
            {instruction.cotesTomes}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-gray-600"
            onClick={() => handleCotesChange(true)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* État règlement */}
        <Badge 
          variant="outline"
          className={`text-xs cursor-pointer ${
            instruction.etatReglement === 'instruction' ? 'bg-gray-100 text-gray-700' :
            instruction.etatReglement === '175_rendu' ? 'bg-yellow-100 text-yellow-700' :
            instruction.etatReglement === 'rd_fait' ? 'bg-blue-100 text-blue-700' :
            'bg-green-100 text-green-700'
          }`}
        >
          {instruction.etatReglement === 'instruction' ? 'En cours' :
           instruction.etatReglement === '175_rendu' ? '175 rendu' :
           instruction.etatReglement === 'rd_fait' ? 'RD fait' :
           'Ordonnance'}
        </Badge>
      </div>
    );
  }

  // Version complète
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Curseur état de l'instruction */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            État de l'instruction
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Barre de progression visuelle */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Instruction</span>
              <span className="text-gray-500">Ordonnance</span>
            </div>
            
            <div className="relative">
              <div className="h-2 bg-gray-200 rounded-full">
                <div 
                  className={`h-2 rounded-full transition-all duration-300 ${
                    instruction.etatReglement === 'instruction' ? 'w-1/4 bg-gray-400' :
                    instruction.etatReglement === '175_rendu' ? 'w-1/2 bg-yellow-400' :
                    instruction.etatReglement === 'rd_fait' ? 'w-3/4 bg-blue-400' :
                    'w-full bg-green-400'
                  }`}
                />
              </div>
            </div>

            {/* Sélecteur état */}
            <Select
              value={instruction.etatReglement}
              onChange={(e) => handleEtatChange(e.target.value as EnqueteInstruction['etatReglement'])}
            >
              <option value="instruction">En cours d'instruction</option>
              <option value="175_rendu">175 rendu</option>
              <option value="rd_fait">RD fait</option>
              <option value="ordonnance_rendue">Ordonnance rendue</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Compteurs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Compteurs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Côtes/tomes */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Côtes/tomes</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => handleCotesChange(false)}
                disabled={instruction.cotesTomes <= 0}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="text-sm font-semibold min-w-8 text-center">
                {instruction.cotesTomes}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => handleCotesChange(true)}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Compteurs automatiques (lecture seule) */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <Users className="h-3 w-3" />
                Mis en examen
              </span>
              <Badge variant="outline" className="text-xs">
                {nbMisEnExamen}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <Gavel className="h-3 w-3" />
                Débats parquet
              </span>
              <Badge variant="outline" className="text-xs">
                {nbDebatsParquet}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Pages totales
              </span>
              <Badge variant="outline" className="text-xs">
                {nbPagesTotal}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orientation finale */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Orientation finale
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={instruction.orientation || ''}
            onChange={(e) => handleOrientationChange(e.target.value as EnqueteInstruction['orientation'])}
          >
            <option value="">Non définie</option>
            <option value="TC">Tribunal correctionnel</option>
            <option value="CCD">Cour criminelle départementale</option>
            <option value="Assises">Cour d'assises</option>
            <option value="TPE">Tribunal de police</option>
            <option value="CAM">Composition pénale</option>
            <option value="non_lieu">Non-lieu</option>
          </Select>
          
          {instruction.orientation && (
            <div className="mt-2">
              <Badge 
                variant="outline"
                className={`text-xs ${
                  instruction.orientation === 'non_lieu' ? 'bg-gray-100 text-gray-700' :
                  instruction.orientation === 'CAM' ? 'bg-green-100 text-green-700' :
                  instruction.orientation === 'TPE' ? 'bg-blue-100 text-blue-700' :
                  'bg-purple-100 text-purple-700'
                }`}
              >
                {instruction.orientation}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline rapide */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Chronologie
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600">Ouverture:</span>
              <span className="font-medium">
                {new Date(instruction.dateDebut).toLocaleDateString()}
              </span>
            </div>
            
            {instruction.rdData?.dateRendu && (
              <div className="flex justify-between">
                <span className="text-gray-600">RD rendu:</span>
                <span className="font-medium">
                  {new Date(instruction.rdData.dateRendu).toLocaleDateString()}
                </span>
              </div>
            )}
            
            {instruction.rapportAppel?.dateRendu && (
              <div className="flex justify-between">
                <span className="text-gray-600">Rapport appel:</span>
                <span className="font-medium">
                  {new Date(instruction.rapportAppel.dateRendu).toLocaleDateString()}
                </span>
              </div>
            )}
            
            <div className="flex justify-between pt-1 border-t">
              <span className="text-gray-600">Durée:</span>
              <span className="font-medium">
                {Math.ceil(
                  (new Date().getTime() - new Date(instruction.dateDebut).getTime()) 
                  / (1000 * 60 * 60 * 24)
                )} jours
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};