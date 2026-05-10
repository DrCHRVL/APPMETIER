'use client';

/**
 * Page « Archives » du module Instruction.
 *
 * Liste les dossiers d'instruction archivés (archived === true) en deux colonnes :
 *   - Audiences en attente : un résultat existe mais isAudiencePending=true
 *   - Résultats : résultat finalisé (condamnations, classement, OI…)
 *
 * Stockage des résultats : JSON séparé `instruction_resultats` via
 * useInstructionResultats. Réutilise AudienceResultModal pour la saisie.
 */

import React, { useMemo, useState } from 'react';
import {
  RotateCcw, Trash2, Gavel, Search, Plus, AlertCircle, Clock, FileText,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { useToast } from '@/contexts/ToastContext';
import { useInstructionResultats } from '@/contexts/InstructionResultatsContext';
import { AudienceResultModal } from '../modals/AudienceResultModal';
import { useInstructionCabinets } from '@/hooks/useInstructionCabinets';
import { FALLBACK_CABINET_COLOR } from '@/config/instructionConfig';
import type { DossierInstruction } from '@/types/instructionTypes';
import type { ResultatAudience } from '@/types/audienceTypes';

interface Props {
  dossiers: DossierInstruction[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  onUpdateDossier: (id: number, updates: Partial<DossierInstruction>) => void;
  onDeleteDossier: (id: number) => void;
}

const FALLBACK_CONTENTIEUX = 'instructions';

export const InstructionArchivesPage = ({
  dossiers,
  searchTerm,
  onSearchChange,
  onUpdateDossier,
  onDeleteDossier,
}: Props) => {
  const { showToast } = useToast();
  const { getCabinetById } = useInstructionCabinets();
  const {
    saveResultat,
    deleteResultat,
    getResultat,
    instructionResultatsState,
  } = useInstructionResultats();

  // dossierId du résultat en cours de saisie/édition
  const [activeResultatDossierId, setActiveResultatDossierId] = useState<number | null>(null);

  const ctxOf = (d: DossierInstruction) => d.contentieuxId || FALLBACK_CONTENTIEUX;

  // Filtre archivés + recherche
  const archived = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    let list = dossiers.filter(d => d.archived === true);
    if (term) {
      list = list.filter(d =>
        d.numeroInstruction.toLowerCase().includes(term)
        || d.numeroParquet.toLowerCase().includes(term)
        || d.magistratInstructeur?.toLowerCase().includes(term)
        || d.misEnExamen.some(m => m.nom.toLowerCase().includes(term)),
      );
    }
    return list;
  }, [dossiers, searchTerm]);

  // Sépare en pending / completed via le résultat associé
  const { pending, completed } = useMemo(() => {
    const p: DossierInstruction[] = [];
    const c: DossierInstruction[] = [];
    for (const d of archived) {
      const r = getResultat(ctxOf(d), d.id);
      if (r?.isAudiencePending || r?.isPartiallyPending) p.push(d);
      else c.push(d);
    }
    return { pending: p, completed: c };
  }, [archived, instructionResultatsState.resultats, getResultat]);

  // Groupe les complétées par mois/année (date d'audience > date archivage > miseAJour)
  const completedByMonth = useMemo(() => {
    const map = new Map<string, { date: Date; items: DossierInstruction[] }>();
    for (const d of completed) {
      const r = getResultat(ctxOf(d), d.id);
      const refDate = r?.dateAudience
        ? new Date(r.dateAudience)
        : d.dateArchivage
        ? new Date(d.dateArchivage)
        : new Date(d.dateMiseAJour);
      const key = `${refDate.toLocaleDateString('fr-FR', { month: 'long' })} ${refDate.getFullYear()}`;
      const entry = map.get(key);
      if (entry) entry.items.push(d);
      else map.set(key, { date: new Date(refDate.getFullYear(), refDate.getMonth(), 1), items: [d] });
    }
    // Tri antichronologique
    return [...map.entries()]
      .sort(([, a], [, b]) => b.date.getTime() - a.date.getTime())
      .map(([key, value]) => ({ key, items: value.items }));
  }, [completed, instructionResultatsState.resultats, getResultat]);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleSaveResultat = async (dossier: DossierInstruction, partial: ResultatAudience) => {
    try {
      await saveResultat({
        ...partial,
        enqueteId: dossier.id,
        contentieuxId: ctxOf(dossier),
      });
      setActiveResultatDossierId(null);
      showToast('Résultat enregistré', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erreur lors de l\'enregistrement', 'error');
    }
  };

  const handleResetResultat = async (dossier: DossierInstruction) => {
    if (!confirm('Supprimer le résultat associé à ce dossier (le dossier reste archivé) ?')) return;
    try {
      await deleteResultat(ctxOf(dossier), dossier.id);
      showToast('Résultat supprimé', 'success');
    } catch (e) {
      console.error(e);
      showToast('Erreur lors de la suppression', 'error');
    }
  };

  const handleUnarchive = async (dossier: DossierInstruction) => {
    if (!confirm(`Restaurer "${dossier.numeroInstruction}" dans les informations en cours ?`)) return;
    onUpdateDossier(dossier.id, { archived: false, dateArchivage: undefined });
    // On garde le résultat associé : si l'utilisateur ré-archive, il sera toujours là.
    showToast('Dossier restauré', 'success');
  };

  const handleDelete = async (dossier: DossierInstruction) => {
    if (!confirm(`Supprimer définitivement "${dossier.numeroInstruction}" et son résultat ?`)) return;
    try {
      await deleteResultat(ctxOf(dossier), dossier.id).catch(() => undefined);
    } finally {
      onDeleteDossier(dossier.id);
      showToast('Dossier supprimé', 'success');
    }
  };

  const activeDossier = activeResultatDossierId
    ? dossiers.find(d => d.id === activeResultatDossierId) || null
    : null;

  return (
    <div className="flex gap-4 px-6">
      {/* Colonne gauche : Audiences en attente */}
      <div className="w-80 flex-shrink-0">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-gray-700 inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                Audiences en attente
              </CardTitle>
              {pending.length > 0 && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  {pending.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto">
            {pending.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-6 italic">
                Aucune audience en attente.
              </p>
            ) : (
              pending.map(d => (
                <PendingCard
                  key={d.id}
                  dossier={d}
                  resultat={getResultat(ctxOf(d), d.id)}
                  cabinetColor={getCabinetById(d.cabinetId)?.color || FALLBACK_CABINET_COLOR}
                  onClick={() => setActiveResultatDossierId(d.id)}
                  onUnarchive={() => handleUnarchive(d)}
                  onDelete={() => handleDelete(d)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Colonne droite : Résultats */}
      <div className="flex-1 min-w-0">
        {/* Recherche */}
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Rechercher par n°, MEX, magistrat…"
              className="pl-8"
            />
          </div>
          <div className="ml-auto text-xs text-gray-500">
            {completed.length} résultat{completed.length > 1 ? 's' : ''}
          </div>
        </div>

        {completed.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="p-8 text-center text-sm text-gray-400 italic">
              Aucun résultat enregistré.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {completedByMonth.map(group => (
              <div key={group.key}>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 ml-1">
                  {group.key} ({group.items.length})
                </div>
                <div className="space-y-2">
                  {group.items.map(d => (
                    <CompletedCard
                      key={d.id}
                      dossier={d}
                      resultat={getResultat(ctxOf(d), d.id)}
                      cabinetColor={getCabinetById(d.cabinetId)?.color || FALLBACK_CABINET_COLOR}
                      onEdit={() => setActiveResultatDossierId(d.id)}
                      onResetResult={() => handleResetResultat(d)}
                      onUnarchive={() => handleUnarchive(d)}
                      onDelete={() => handleDelete(d)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de saisie / édition de résultat */}
      {activeDossier && (
        <AudienceResultModal
          isOpen={!!activeDossier}
          onClose={() => setActiveResultatDossierId(null)}
          enqueteId={activeDossier.id}
          contentieuxId={ctxOf(activeDossier)}
          onSave={(r) => handleSaveResultat(activeDossier, r)}
          defaultDate={getResultat(ctxOf(activeDossier), activeDossier.id)?.dateAudience || ''}
          initialData={getResultat(ctxOf(activeDossier), activeDossier.id) || undefined}
          enqueteNumero={activeDossier.numeroInstruction}
          enqueteTags={activeDossier.tags || []}
          misEnCause={activeDossier.misEnExamen.map(m => ({ id: m.id, nom: m.nom }))}
        />
      )}

    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Carte « Audience en attente »
// ─────────────────────────────────────────────────────────────────

const PendingCard: React.FC<{
  dossier: DossierInstruction;
  resultat: ResultatAudience | null;
  cabinetColor: string;
  onClick: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}> = ({ dossier, resultat, cabinetColor, onClick, onUnarchive, onDelete }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const audienceDate = resultat?.dateAudience ? new Date(resultat.dateAudience) : null;
  if (audienceDate) audienceDate.setHours(0, 0, 0, 0);
  const isPassed = audienceDate ? audienceDate < today : false;

  return (
    <div
      className={`p-2 border rounded transition-all ${
        isPassed
          ? 'bg-red-50 border-red-200'
          : 'bg-blue-50 border-blue-200'
      }`}
      style={{ borderLeft: `4px solid ${cabinetColor}` }}
    >
      <div className="cursor-pointer" onClick={onClick}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-xs truncate">{dossier.numeroInstruction}</div>
            {dossier.misEnExamen.length > 0 && (
              <div className="text-xs text-gray-500 truncate">
                {dossier.misEnExamen.map(m => m.nom).join(', ')}
              </div>
            )}
            {audienceDate && (
              <div className={`text-xs mt-0.5 inline-flex items-center gap-1 ${
                isPassed ? 'text-red-700 font-medium' : 'text-blue-700'
              }`}>
                {isPassed && <AlertCircle className="h-3 w-3" />}
                Audience : {audienceDate.toLocaleDateString('fr-FR')}
                {isPassed && ' (à finaliser)'}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-gray-200/60">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-1.5"
          onClick={onUnarchive}
          title="Restaurer dans les en cours"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] px-1.5 text-red-600 hover:text-red-700 ml-auto"
          onClick={onDelete}
          title="Supprimer le dossier"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────
// Carte « Résultat finalisé »
// ─────────────────────────────────────────────────────────────────

const CompletedCard: React.FC<{
  dossier: DossierInstruction;
  resultat: ResultatAudience | null;
  cabinetColor: string;
  onEdit: () => void;
  onResetResult: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}> = ({ dossier, resultat, cabinetColor, onEdit, onResetResult, onUnarchive, onDelete }) => {
  const audienceDate = resultat?.dateAudience ? new Date(resultat.dateAudience) : null;

  const audienceTypes = (resultat?.condamnations || [])
    .map(c => c.typeAudience)
    .filter(Boolean) as string[];
  const typeCounts = audienceTypes.reduce((acc, t) => {
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Card className="shadow-sm" style={{ borderLeft: `4px solid ${cabinetColor}` }}>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-1">
              <span className="font-semibold text-sm truncate">{dossier.numeroInstruction}</span>
              {resultat?.isClassement && (
                <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 text-[10px] py-0 px-1.5">
                  Non-lieu / Classement
                </Badge>
              )}
              {resultat?.isOI && (
                <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200 text-[10px] py-0 px-1.5">
                  OI
                </Badge>
              )}
              {Object.entries(typeCounts).map(([t, n]) => (
                <Badge key={t} variant="outline" className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] py-0 px-1.5">
                  {t}{n > 1 ? ` (${n})` : ''}
                </Badge>
              ))}
            </div>
            <div className="text-xs text-gray-600">
              Parquet : {dossier.numeroParquet}
              {dossier.magistratInstructeur && <> · {dossier.magistratInstructeur}</>}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {audienceDate && (
                <span className="inline-flex items-center gap-1">
                  <Gavel className="h-3 w-3" />
                  Audience : {audienceDate.toLocaleDateString('fr-FR')}
                </span>
              )}
              {resultat?.numeroAudience && <span>N° {resultat.numeroAudience}</span>}
              {resultat?.condamnations && resultat.condamnations.length > 0 && (
                <span>
                  {resultat.condamnations.length} condamnation{resultat.condamnations.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {dossier.misEnExamen.length > 0 && (
              <div className="text-[11px] text-gray-500 mt-0.5 truncate">
                MEX : {dossier.misEnExamen.map(m => m.nom).join(', ')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onEdit}
              title="Modifier le résultat"
            >
              <FileText className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onResetResult}
              title="Effacer le résultat (le dossier reste archivé)"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onUnarchive}
              title="Restaurer dans les en cours"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onDelete}
              title="Supprimer le dossier"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-600" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
