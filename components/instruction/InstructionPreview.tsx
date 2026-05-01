'use client';

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Edit,
  Trash,
  Users,
  Calendar,
  Flag,
  AlertTriangle,
  FileCheck,
  Clock,
  User as UserIcon,
} from 'lucide-react';
import type { DossierInstruction, MisEnExamen } from '@/types/instructionTypes';
import {
  countMexByStatut,
  countTotalDMLs,
  countDMLsEnAttente,
  getDMLsEnRetard,
  getJoursRestantsAvantFinDP,
  getDossierAgeJours,
  formatDossierAge,
} from '@/utils/instructionUtils';
import {
  ETAT_REGLEMENT_LABELS,
  ETAT_REGLEMENT_BADGE_COLORS,
  ORIENTATION_LABELS,
  FALLBACK_CABINET_COLOR,
} from '@/config/instructionConfig';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';

interface InstructionPreviewProps {
  dossier: DossierInstruction;
  onView: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onToggleSuivi?: (type: 'JIRS' | 'PG') => void;
}

/** Convertit une couleur hex en rgba avec opacité */
const hexToRgba = (hex: string, alpha: number): string => {
  const m = hex.replace('#', '');
  const bigint = parseInt(m, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Mini-info DP pour un MEX détenu */
const dpInfoForMex = (mex: MisEnExamen) => {
  if (mex.mesureSurete.type !== 'detenu') return null;
  const jours = getJoursRestantsAvantFinDP(mex);
  if (jours === null) return null;
  return { nom: mex.nom, jours, expire: jours < 0, proche: jours <= 30 };
};

export const InstructionPreview = React.memo(({
  dossier,
  onView,
  onEdit,
  onDelete,
  onToggleSuivi,
}: InstructionPreviewProps) => {
  const { getCabinetById } = useInstructionCabinets();
  const cabinet = getCabinetById(dossier.cabinetId);
  const cabinetColor = cabinet?.color || FALLBACK_CABINET_COLOR;

  const stats = useMemo(() => {
    const byStatut = countMexByStatut(dossier);
    return {
      nbMex: dossier.misEnExamen.length,
      nbDetenu: byStatut.detenu,
      nbCJ: byStatut.cj,
      nbARSE: byStatut.arse,
      nbLibre: byStatut.libre,
      nbDML: countTotalDMLs(dossier),
      nbDMLenAttente: countDMLsEnAttente(dossier),
      nbDMLenRetard: getDMLsEnRetard(dossier).length,
      ageJours: getDossierAgeJours(dossier),
      nbCotes: dossier.cotesTomes || 0,
      nbOps: dossier.ops?.length || 0,
      nbDebatsJLD: dossier.debatsJLD?.length || 0,
    };
  }, [dossier]);

  const dpAlerts = useMemo(
    () =>
      dossier.misEnExamen
        .map(dpInfoForMex)
        .filter((x): x is NonNullable<ReturnType<typeof dpInfoForMex>> => x !== null && (x.expire || x.proche)),
    [dossier.misEnExamen],
  );

  const ageWarning = useMemo(() => {
    if (stats.ageJours >= 730) return { color: 'bg-red-100 text-red-800', label: 'Ancien' };
    if (stats.ageJours >= 365) return { color: 'bg-amber-100 text-amber-800', label: '> 1 an' };
    return null;
  }, [stats.ageJours]);

  const descriptionPreview = dossier.description
    ? dossier.description.length > 240
      ? `${dossier.description.substring(0, 240)}…`
      : dossier.description
    : null;

  return (
    <Card
      className="w-full hover:shadow-lg transition-shadow cursor-pointer border-l-[6px] bg-white"
      style={{
        borderLeftColor: cabinetColor,
        backgroundColor: hexToRgba(cabinetColor, 0.04),
      }}
      onClick={onView}
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-3 px-3">
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <CardTitle className="text-base font-bold break-words">
              {dossier.numeroInstruction || 'N° instruction manquant'}
            </CardTitle>

            {/* Badge cabinet */}
            <Badge
              variant="outline"
              className="text-xs py-0.5 px-2 font-bold border-2"
              style={{
                borderColor: cabinetColor,
                color: cabinetColor,
                backgroundColor: hexToRgba(cabinetColor, 0.12),
              }}
              title={cabinet?.magistratParDefaut || cabinet?.label}
            >
              {cabinet?.label || 'Cabinet ?'}
            </Badge>

            {/* Magistrat instructeur */}
            {(dossier.magistratInstructeur || cabinet?.magistratParDefaut) && (
              <span className="text-xs text-gray-600 inline-flex items-center gap-1">
                <UserIcon className="h-3 w-3" />
                {dossier.magistratInstructeur || cabinet?.magistratParDefaut}
              </span>
            )}

            {/* Suivi JIRS / PG */}
            {onToggleSuivi && (
              <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${
                    dossier.suiviJIRS ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'
                  }`}
                  onClick={() => onToggleSuivi('JIRS')}
                  title="Suivi JIRS"
                >
                  <Flag className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`h-6 w-6 p-0 ${
                    dossier.suiviPG ? 'text-purple-500' : 'text-gray-300 hover:text-gray-400'
                  }`}
                  onClick={() => onToggleSuivi('PG')}
                  title="Suivi Parquet Général"
                >
                  <Flag className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* N° parquet */}
          <div className="text-xs text-gray-600 font-medium mb-1">
            Parquet : {dossier.numeroParquet || 'Non défini'}
          </div>

          {/* Tags d'infraction */}
          {dossier.tags && dossier.tags.filter(t => t.category === 'infractions').length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1.5">
              {dossier.tags
                .filter(t => t.category === 'infractions')
                .slice(0, 4)
                .map(t => (
                  <Badge key={t.id} variant="outline" className="text-xs py-0.5 px-2 bg-gray-50">
                    {t.value}
                  </Badge>
                ))}
            </div>
          )}

          {descriptionPreview && (
            <p className="text-xs text-gray-600 mb-1.5 italic line-clamp-3">
              {descriptionPreview}
            </p>
          )}

          {/* Mis en examen */}
          <div className="flex items-start gap-1 text-xs">
            <Users className="h-3 w-3 text-gray-600 mt-0.5 flex-shrink-0" />
            <div className="flex flex-wrap gap-x-1 gap-y-0.5">
              {dossier.misEnExamen.length > 0 ? (
                dossier.misEnExamen.map((mex, i) => (
                  <span key={mex.id} className="font-medium">
                    {mex.nom}
                    {mex.mesureSurete.type === 'detenu' && (
                      <span className="ml-1 px-1 rounded bg-red-100 text-red-700 text-[10px] uppercase tracking-wide">
                        DP
                      </span>
                    )}
                    {mex.mesureSurete.type === 'cj' && (
                      <span className="ml-1 px-1 rounded bg-amber-100 text-amber-700 text-[10px] uppercase tracking-wide">
                        CJ
                      </span>
                    )}
                    {mex.mesureSurete.type === 'arse' && (
                      <span className="ml-1 px-1 rounded bg-purple-100 text-purple-700 text-[10px] uppercase tracking-wide">
                        ARSE
                      </span>
                    )}
                    {i < dossier.misEnExamen.length - 1 && ','}
                  </span>
                ))
              ) : (
                <span className="text-gray-400 italic">Aucun mis en examen</span>
              )}
            </div>
          </div>
        </div>

        {/* Colonne droite : actions + dates */}
        <div className="flex flex-col items-end shrink-0 max-w-[35%]">
          <div className="flex justify-end gap-1 mb-1.5" onClick={(e) => e.stopPropagation()}>
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

          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Calendar className="h-3 w-3" />
              <span>
                Ouvert : {dossier.dateOuverture ? new Date(dossier.dateOuverture).toLocaleDateString() : '—'}
              </span>
            </div>
            {ageWarning && (
              <Badge variant="outline" className={`text-xs py-0.5 px-2 ${ageWarning.color}`}>
                <Clock className="h-3 w-3 mr-1" />
                {formatDossierAge(stats.ageJours)} · {ageWarning.label}
              </Badge>
            )}
            {!ageWarning && stats.ageJours >= 90 && (
              <span className="text-xs text-gray-500">{formatDossierAge(stats.ageJours)}</span>
            )}

            <div className="flex items-center gap-1 text-xs">
              <FileCheck className="h-3 w-3" />
              <Badge
                variant="outline"
                className={`text-xs py-0.5 px-2 ${ETAT_REGLEMENT_BADGE_COLORS[dossier.etatReglement]}`}
              >
                {ETAT_REGLEMENT_LABELS[dossier.etatReglement]}
              </Badge>
            </div>

            {dossier.orientationPrevisible && (
              <Badge variant="outline" className="text-xs py-0.5 px-2 bg-indigo-50 text-indigo-700 border-indigo-200">
                → {ORIENTATION_LABELS[dossier.orientationPrevisible]}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Compteurs + alertes */}
      <CardContent className="px-3 pb-3 pt-0">
        <div className="border-t border-gray-200 pt-1.5 flex flex-wrap gap-1">
          {stats.nbMex > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-orange-100 text-orange-800">
              {stats.nbMex} MEX
            </Badge>
          )}
          {stats.nbDetenu > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-red-100 text-red-800">
              {stats.nbDetenu} en DP
            </Badge>
          )}
          {stats.nbCJ > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-amber-100 text-amber-800">
              {stats.nbCJ} CJ
            </Badge>
          )}
          {stats.nbARSE > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-purple-100 text-purple-800">
              {stats.nbARSE} ARSE
            </Badge>
          )}
          {stats.nbDML > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-purple-100 text-purple-800">
              {stats.nbDML} DML
              {stats.nbDMLenAttente > 0 && (
                <span className="ml-1 text-[10px]">({stats.nbDMLenAttente} en cours)</span>
              )}
            </Badge>
          )}
          {stats.nbDMLenRetard > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-red-200 text-red-900">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {stats.nbDMLenRetard} DML en retard
            </Badge>
          )}
          {stats.nbOps > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-blue-100 text-blue-800">
              {stats.nbOps} OP JI
            </Badge>
          )}
          {stats.nbDebatsJLD > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-indigo-100 text-indigo-800">
              {stats.nbDebatsJLD} débats JLD
            </Badge>
          )}
          {stats.nbCotes > 0 && (
            <Badge variant="secondary" className="text-xs py-0.5 px-2 bg-gray-100 text-gray-700">
              {stats.nbCotes} cotes
            </Badge>
          )}

          {/* Alertes DP */}
          {dpAlerts.map((a, idx) => (
            <Badge
              key={idx}
              variant="outline"
              className={`text-xs py-0.5 px-2 border-red-300 ${
                a.expire ? 'bg-red-200 text-red-900' : 'bg-red-100 text-red-800'
              }`}
              title={`${a.nom} : DP ${a.expire ? 'échue' : `expire dans ${a.jours} j`}`}
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              {a.nom.split(' ')[0]} {a.expire ? 'ÉCHUE' : `${a.jours}j`}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

InstructionPreview.displayName = 'InstructionPreview';
