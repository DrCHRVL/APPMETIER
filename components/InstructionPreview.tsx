import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { 
  Edit, 
  Trash, 
  Users, 
  Building2, 
  FileText, 
  Calendar, 
  Flag,
  Gavel,
  AlertTriangle,
  Clock,
  FileCheck
} from 'lucide-react';
import { EnqueteInstruction, CABINET_COLORS } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import { getLastCR } from '@/utils/compteRenduUtils';

interface InstructionPreviewProps {
  instruction: EnqueteInstruction;
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleSuivi?: (type: 'JIRS' | 'PG') => void;
}

export const InstructionPreview = React.memo(({
  instruction,
  onView,
  onEdit,
  onDelete,
  onToggleSuivi
}: InstructionPreviewProps) => {
  const { showToast } = useToast();

  // Variables dérivées
  const lastCR = getLastCR(instruction.comptesRendus ?? []);
  const isSuiviJIRS = instruction.tags?.some(tag =>
    tag.category === 'suivi' && tag.value === 'JIRS'
  );
  const isSuiviPG = instruction.tags?.some(tag =>
    tag.category === 'suivi' && tag.value === 'PG'
  ) || false;

  // COMPTEURS DYNAMIQUES BASÉS SUR LES DONNÉES RÉELLES
  const compteursDynamiques = useMemo(() => {
    return {
      dml: instruction.dmls?.length || 0,
      cotes: instruction.cotesTomes || 0,
      misEnExamen: instruction.misEnExamen?.length || 0,
      debatsParquet: instruction.debatsParquet?.length || 0,
      pagesTotal: (instruction.rdData?.nbPages || 0) + (instruction.rapportAppel?.nbPages || 0)
    };
  }, [
    instruction.dmls?.length,
    instruction.cotesTomes,
    instruction.misEnExamen?.length,
    instruction.debatsParquet?.length,
    instruction.rdData?.nbPages,
    instruction.rapportAppel?.nbPages
  ]);

  // Alertes DP pour les mis en examen détenus
  const dpAlerts = useMemo(() => {
    const alerts = instruction.misEnExamen
      ?.filter(mex => mex.statut === 'detenu' && mex.dateFinDP)
      .map(mex => {
        const finDP = new Date(mex.dateFinDP!);
        const maintenant = new Date();
        const joursRestants = Math.ceil((finDP.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24));
        
        return {
          nom: mex.nom,
          joursRestants,
          alerteActive: joursRestants <= 30 && joursRestants >= 0,
          expire: joursRestants < 0
        };
      })
      .filter(alert => alert.alerteActive || alert.expire) || [];
    
    return alerts;
  }, [instruction.misEnExamen]);

  const descriptionPreview = instruction.description 
    ? instruction.description.length > 300
      ? `${instruction.description.substring(0, 300)}...` 
      : instruction.description
    : null;

  // Couleur selon le cabinet - avec vérification de sécurité
  const cabinetColorClass = instruction?.cabinet && CABINET_COLORS 
    ? (CABINET_COLORS[instruction.cabinet] || 'bg-white border-gray-200')
    : 'bg-white border-gray-200';

  return (
    <Card 
      className={`w-full hover:shadow-lg transition-shadow cursor-pointer border-2 ${cabinetColorClass}`}
      onClick={onView}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-2 px-3">
        <div className="flex-1 min-w-0 mr-3 max-w-[70%]">
          <div className="flex flex-col mb-1.5">
            <CardTitle className="text-base font-bold flex flex-wrap items-center gap-1.5">
              <div className="break-words min-w-[60%] max-w-full">
                {instruction.numeroInstruction || 'Numéro manquant'}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Badge Cabinet */}
                <Badge 
                  variant="outline" 
                  className={`text-xs py-0.5 px-2 font-bold border-2 ${
                    instruction.cabinet === '1' ? 'border-rose-400 text-rose-700 bg-rose-100' :
                    instruction.cabinet === '2' ? 'border-amber-400 text-amber-700 bg-amber-100' :
                    instruction.cabinet === '3' ? 'border-green-400 text-green-700 bg-green-100' :
                    instruction.cabinet === '4' ? 'border-blue-400 text-blue-700 bg-blue-100' :
                    'border-gray-400 text-gray-700 bg-gray-100'
                  }`}
                >
                  Cab. {instruction.cabinet || '?'}
                </Badge>

                {/* Alertes DP - Affichage multiple si plusieurs détenus */}
                {dpAlerts.map((alert, index) => (
                  <Badge 
                    key={index}
                    variant="outline" 
                    className={`text-xs py-0.5 px-2 border-red-300 ${
                      alert.expire 
                        ? 'bg-red-200 text-red-900' 
                        : 'bg-red-100 text-red-800'
                    }`}
                    title={`${alert.nom}: DP ${alert.expire ? 'échue' : `expire dans ${alert.joursRestants} jours`}`}
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {alert.expire ? 'ÉCHUE!' : `${alert.joursRestants}j`}
                  </Badge>
                ))}

                {/* Suivi JIRS / PG */}
                {onToggleSuivi && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 w-6 p-0 transition-colors ${
                        isSuiviJIRS ? 'text-blue-500 hover:text-blue-600' : 'text-gray-300 hover:text-gray-400'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSuivi('JIRS');
                      }}
                      title="Suivi JIRS"
                    >
                      <Flag className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-6 w-6 p-0 transition-colors ${
                        isSuiviPG ? 'text-purple-500 hover:text-purple-600' : 'text-gray-300 hover:text-gray-400'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSuivi('PG');
                      }}
                      title="Suivi Parquet Général"
                    >
                      <Flag className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </CardTitle>

            {/* Numéro parquet en plus petit */}
            <div className="text-xs text-gray-600 font-medium">
              Parquet: {instruction.numeroParquet || 'Non défini'}
            </div>
          </div>

          {/* Tags d'infraction */}
          <div className="flex flex-wrap gap-1 mb-1.5">
            {instruction.tags
              ?.filter(tag => tag.category === 'infractions')
              .map(tag => (
                <Badge 
                  key={tag.value} 
                  variant="outline" 
                  className="text-xs py-0.5 px-2 bg-gray-50"
                >
                  {tag.value}
                </Badge>
              )) || []}
          </div>

          {descriptionPreview && (
            <p className="text-xs text-gray-600 mb-1.5 italic line-clamp-4">
              {descriptionPreview}
            </p>
          )}

          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-xs text-gray-600 line-clamp-1">
              <Building2 className="h-3 w-3 flex-shrink-0" />
              {instruction.serviceEnqueteur || 'Service non défini'} • {instruction.origineEnquete || 'Origine non définie'}
            </div>

            {/* MIS EN EXAMEN au lieu de mis en cause */}
            <div className="flex items-start gap-1 text-xs">
              <Users className="h-3 w-3 text-gray-600 mt-0.5 flex-shrink-0" />
              <div className="flex flex-col">
                {instruction.misEnExamen && instruction.misEnExamen.length > 0 ? (
                  <>
                    {instruction.misEnExamen.map((mex, index) => (
                      <span key={mex.id} className="font-medium">
                        {mex.nom}
                        {mex.statut === 'detenu' && (
                          <Badge variant="outline" className="ml-1 text-xs h-4 px-1.5 bg-orange-100 text-orange-700">
                            DP
                          </Badge>
                        )}
                        {index < instruction.misEnExamen.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-gray-400 italic">Aucun mis en examen</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end flex-shrink-0 max-w-[30%]">
          {/* Boutons d'action */}
          <div className="flex justify-end gap-1 mb-1.5" onClick={e => e.stopPropagation()}>
            {onEdit && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit}>
                <Edit className="h-3 w-3" />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onDelete}>
                <Trash className="h-3 w-3" />
              </Button>
            )}
          </div>

          {/* Infos temporelles */}
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Calendar className="h-3 w-3" />
              <span>Ouvert: {instruction.dateDebut ? new Date(instruction.dateDebut).toLocaleDateString() : 'Date manquante'}</span>
            </div>

            {/* État règlement */}
            <div className="flex items-center gap-1 text-xs">
              <FileCheck className="h-3 w-3" />
              <Badge 
                variant="outline" 
                className={`text-xs py-0.5 px-2 ${
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

            {lastCR && (
              <div className="text-xs text-gray-500">
                Dernier CR: {new Date(lastCR.date).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Dernier CR preview */}
          {lastCR?.description && (
            <div 
              className="mt-1.5 bg-gray-50 p-1.5 rounded text-xs text-gray-600 w-full line-clamp-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-1">
                <FileText className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>{lastCR.description.substring(0, 100)}...</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      {/* COMPTEURS DYNAMIQUES */}
      <CardContent className="px-3 pb-2 pt-0">
        <div className="border-t-2 border-gray-200 pt-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap gap-1">
            {/* Compteur DML - DYNAMIQUE */}
            {compteursDynamiques.dml > 0 && (
              <Badge 
                variant="secondary"
                className="text-xs py-0.5 px-2 bg-purple-100 text-purple-800"
              >
                {compteursDynamiques.dml} DML
              </Badge>
            )}

            {/* Compteur côtes - DYNAMIQUE */}
            {compteursDynamiques.cotes > 0 && (
              <Badge 
                variant="secondary"
                className="text-xs py-0.5 px-2 bg-gray-100 text-gray-800"
              >
                {compteursDynamiques.cotes} côtes
              </Badge>
            )}

            {/* Compteur mis en examen - DYNAMIQUE */}
            {compteursDynamiques.misEnExamen > 0 && (
              <Badge 
                variant="secondary"
                className="text-xs py-0.5 px-2 bg-orange-100 text-orange-800"
              >
                {compteursDynamiques.misEnExamen} MEX
              </Badge>
            )}

            {/* Compteur débats parquet - DYNAMIQUE */}
            {compteursDynamiques.debatsParquet > 0 && (
              <Badge 
                variant="secondary"
                className="text-xs py-0.5 px-2 bg-blue-100 text-blue-800"
              >
                <Gavel className="h-3 w-3 mr-1" />
                {compteursDynamiques.debatsParquet} débats
              </Badge>
            )}

            {/* Pages RD/Rapport - DYNAMIQUE */}
            {compteursDynamiques.pagesTotal > 0 && (
              <Badge 
                variant="secondary"
                className="text-xs py-0.5 px-2 bg-green-100 text-green-800"
              >
                {compteursDynamiques.pagesTotal} pages
              </Badge>
            )}

            {/* Badge orientation finale si définie */}
            {instruction.orientation && (
              <Badge 
                variant="secondary"
                className="text-xs py-0.5 px-2 bg-indigo-100 text-indigo-800"
              >
                → {instruction.orientation}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});