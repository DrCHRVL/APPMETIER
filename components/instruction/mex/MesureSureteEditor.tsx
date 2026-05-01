'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, AlertTriangle, Lock, Scale, MapPin, ShieldOff } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import {
  CAS_DP_CRIMINELS,
  CAS_DP_DELICTUELS,
  getCasDPById,
  SEUIL_MOTIVATION_RENFORCEE_MOIS,
} from '@/config/dpRegimes';
import {
  buildPeriodeDP,
  getDureeCumuleeDPMois,
  motivationRenforceeRequise,
  peutEtreProlonge,
  peutDemanderProlongationExceptionnelle,
} from '@/utils/instructionUtils';
import type {
  MesureSurete,
  MisEnExamen,
  PeriodeDetentionProvisoire,
  RegimeDetentionProvisoire,
} from '@/types/instructionTypes';

interface Props {
  mex: MisEnExamen;
  onChange: (next: MesureSurete) => void;
  readOnly?: boolean;
}

type TypeMesure = MesureSurete['type'];

const TYPE_META: Record<TypeMesure, { label: string; color: string; icon: React.ElementType }> = {
  libre:  { label: 'Libre', color: 'bg-gray-100 text-gray-700 border-gray-300', icon: ShieldOff },
  cj:     { label: 'CJ',    color: 'bg-amber-100 text-amber-700 border-amber-300', icon: Scale },
  arse:   { label: 'ARSE',  color: 'bg-purple-100 text-purple-700 border-purple-300', icon: MapPin },
  detenu: { label: 'DP',    color: 'bg-red-100 text-red-700 border-red-300', icon: Lock },
};

export const MesureSureteEditor = ({ mex, onChange, readOnly }: Props) => {
  const m = mex.mesureSurete;
  const cas = m.type === 'detenu' ? getCasDPById(m.casDPId) : undefined;
  const cumuleeMois = getDureeCumuleeDPMois(mex);

  // ──────────────────────────────────────────────
  // Changement de type de mesure
  // ──────────────────────────────────────────────
  const handleChangeType = (next: TypeMesure) => {
    if (next === m.type) return;
    const today = new Date().toISOString().split('T')[0];
    switch (next) {
      case 'libre':
        onChange({ type: 'libre', depuis: today });
        break;
      case 'cj':
        onChange({ type: 'cj', depuis: today, obligations: [] });
        break;
      case 'arse':
        onChange({ type: 'arse', depuis: today });
        break;
      case 'detenu':
        onChange({
          type: 'detenu',
          depuis: today,
          regime: 'correctionnel',
          casDPId: undefined,
          periodes: [],
        });
        break;
    }
  };

  // ──────────────────────────────────────────────
  // CJ
  // ──────────────────────────────────────────────
  const [newObligation, setNewObligation] = useState('');
  const addObligation = () => {
    if (m.type !== 'cj' || !newObligation.trim()) return;
    onChange({ ...m, obligations: [...(m.obligations || []), newObligation.trim()] });
    setNewObligation('');
  };
  const removeObligation = (i: number) => {
    if (m.type !== 'cj') return;
    onChange({ ...m, obligations: (m.obligations || []).filter((_, idx) => idx !== i) });
  };

  // ──────────────────────────────────────────────
  // DP — ajout/suppression de période
  // ──────────────────────────────────────────────
  const [newPlacementDate, setNewPlacementDate] = useState('');
  const [newPlacementDuree, setNewPlacementDuree] = useState<number | ''>('');
  const [newProlongationDate, setNewProlongationDate] = useState('');

  const addPlacementInitial = () => {
    if (m.type !== 'detenu' || !newPlacementDate || !newPlacementDuree) return;
    const periode = buildPeriodeDP(newPlacementDate, Number(newPlacementDuree), m.regime, 'placement');
    onChange({
      ...m,
      depuis: m.depuis || newPlacementDate,
      periodes: [...m.periodes, periode],
    });
    setNewPlacementDate('');
    setNewPlacementDuree('');
  };

  const addProlongation = () => {
    if (m.type !== 'detenu' || !cas || !newProlongationDate) return;
    const periode = buildPeriodeDP(
      newProlongationDate,
      cas.trancheProlongationMois,
      m.regime,
      'prolongation',
    );
    onChange({ ...m, periodes: [...m.periodes, periode] });
    setNewProlongationDate('');
  };

  const addProlongationExceptionnelle = () => {
    if (m.type !== 'detenu' || !cas?.prolongationExceptionnelle || !newProlongationDate) return;
    const periode = buildPeriodeDP(
      newProlongationDate,
      cas.prolongationExceptionnelle.dureeMois,
      m.regime,
      'prolongation',
    );
    onChange({
      ...m,
      periodes: [...m.periodes, { ...periode, motifProlongation: 'Prolongation exceptionnelle CHINS' }],
      nbProlongationsExceptionnelles: (m.nbProlongationsExceptionnelles || 0) + 1,
    });
    setNewProlongationDate('');
  };

  const removePeriode = (id: number) => {
    if (m.type !== 'detenu') return;
    const removed = m.periodes.find(p => p.id === id);
    onChange({
      ...m,
      periodes: m.periodes.filter(p => p.id !== id),
      // Si on supprime une prolongation exceptionnelle, on décrémente le compteur
      nbProlongationsExceptionnelles:
        removed?.motifProlongation === 'Prolongation exceptionnelle CHINS' && (m.nbProlongationsExceptionnelles || 0) > 0
          ? (m.nbProlongationsExceptionnelles || 0) - 1
          : m.nbProlongationsExceptionnelles,
    });
  };

  const handleChangeRegime = (regime: RegimeDetentionProvisoire) => {
    if (m.type !== 'detenu') return;
    onChange({ ...m, regime, casDPId: undefined });
  };

  const handleChangeCasDP = (casDPId: string) => {
    if (m.type !== 'detenu') return;
    onChange({ ...m, casDPId: casDPId || undefined });
  };

  // ──────────────────────────────────────────────
  // Indicateurs
  // ──────────────────────────────────────────────
  const sortedPeriodes = useMemo(() => {
    if (m.type !== 'detenu') return [];
    return [...m.periodes].sort(
      (a, b) => new Date(a.dateDebut).getTime() - new Date(b.dateDebut).getTime(),
    );
  }, [m]);

  return (
    <div className="space-y-3">
      {/* Sélecteur de type de mesure */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TYPE_META) as TypeMesure[]).map(t => {
          const Icon = TYPE_META[t].icon;
          const active = m.type === t;
          return (
            <button
              key={t}
              type="button"
              disabled={readOnly}
              onClick={() => handleChangeType(t)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border-2 transition-colors ${
                active ? TYPE_META[t].color : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <Icon className="h-3 w-3" />
              {TYPE_META[t].label}
            </button>
          );
        })}
      </div>

      {/* Détails par type */}
      {m.type === 'libre' && (
        <div className="text-xs text-gray-500">
          Mis en examen libre depuis {m.depuis ? new Date(m.depuis).toLocaleDateString() : '—'}.
        </div>
      )}

      {m.type === 'cj' && (
        <div className="space-y-2 bg-amber-50/50 border border-amber-200 rounded p-2">
          <div className="flex items-center gap-2 text-xs">
            <Label htmlFor="cj-depuis" className="text-xs whitespace-nowrap">Depuis le</Label>
            <Input
              id="cj-depuis"
              type="date"
              value={m.depuis}
              onChange={(e) => onChange({ ...m, depuis: e.target.value })}
              className="h-6 text-xs w-36"
              disabled={readOnly}
            />
          </div>
          <div>
            <Label className="text-xs">Obligations</Label>
            {(m.obligations && m.obligations.length > 0) ? (
              <div className="space-y-1 mb-1">
                {m.obligations.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-white border border-amber-200 rounded px-2 py-1">
                    <span className="flex-1">{o}</span>
                    {!readOnly && (
                      <button onClick={() => removeObligation(i)} className="text-gray-400 hover:text-red-600">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-400 italic mb-1">Aucune obligation enregistrée.</div>
            )}
            {!readOnly && (
              <div className="flex items-center gap-1.5">
                <Input
                  value={newObligation}
                  onChange={(e) => setNewObligation(e.target.value)}
                  placeholder="Nouvelle obligation"
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && addObligation()}
                />
                <Button size="sm" onClick={addObligation} disabled={!newObligation.trim()} className="h-7 bg-amber-600 hover:bg-amber-700">
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {m.type === 'arse' && (
        <div className="space-y-2 bg-purple-50/50 border border-purple-200 rounded p-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Depuis le</Label>
              <Input
                type="date"
                value={m.depuis}
                onChange={(e) => onChange({ ...m, depuis: e.target.value })}
                className="h-7 text-xs"
                disabled={readOnly}
              />
            </div>
            <div>
              <Label className="text-xs">Lieu d'assignation</Label>
              <Input
                value={m.lieu || ''}
                onChange={(e) => onChange({ ...m, lieu: e.target.value || undefined })}
                placeholder="Adresse"
                className="h-7 text-xs"
                disabled={readOnly}
              />
            </div>
          </div>
        </div>
      )}

      {m.type === 'detenu' && (
        <div className="space-y-3 bg-red-50/40 border border-red-200 rounded p-2">
          {/* Régime + cas légal */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Régime</Label>
              <select
                value={m.regime}
                onChange={(e) => handleChangeRegime(e.target.value as RegimeDetentionProvisoire)}
                disabled={readOnly}
                className="w-full h-7 text-xs border border-gray-300 rounded px-2"
              >
                <option value="correctionnel">Correctionnel</option>
                <option value="criminel">Criminel</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Cas légal applicable</Label>
              <select
                value={m.casDPId || ''}
                onChange={(e) => handleChangeCasDP(e.target.value)}
                disabled={readOnly}
                className="w-full h-7 text-xs border border-gray-300 rounded px-2"
              >
                <option value="">— À sélectionner —</option>
                {(m.regime === 'criminel' ? CAS_DP_CRIMINELS : CAS_DP_DELICTUELS).map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Indicateurs légaux */}
          {cas && (
            <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded p-2 space-y-1">
              <div>
                <span className="text-gray-500">Référence :</span>{' '}
                <span className="font-mono">{cas.article}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-gray-50">
                  Initiale : {cas.dureeInitialeMois} mois
                </Badge>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-gray-50">
                  Max légal : {cas.dureeMaxMois} mois
                </Badge>
                {cas.trancheProlongationMois > 0 ? (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-gray-50">
                    Tranches : {cas.trancheProlongationMois} mois
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-red-50 text-red-700 border-red-200">
                    Aucune prolongation possible
                  </Badge>
                )}
                <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${cumuleeMois >= cas.dureeMaxMois ? 'bg-red-100 text-red-700 border-red-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                  Cumulé : {cumuleeMois} / {cas.dureeMaxMois} mois
                </Badge>
                {motivationRenforceeRequise(mex) && (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-amber-100 text-amber-800 border-amber-300">
                    <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                    Motivation renforcée requise (&gt;{SEUIL_MOTIVATION_RENFORCEE_MOIS} mois — art 137-3)
                  </Badge>
                )}
                {cas.prolongationExceptionnelleCHINS && cas.prolongationExceptionnelle && (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-purple-50 text-purple-700 border-purple-200">
                    Prolongation CHINS possible : {cas.prolongationExceptionnelle.dureeMois} mois × {cas.prolongationExceptionnelle.nbMax}
                    {(m.nbProlongationsExceptionnelles || 0) > 0 && (
                      <> · {m.nbProlongationsExceptionnelles} déjà accordée(s)</>
                    )}
                  </Badge>
                )}
              </div>
              {cas.description && (
                <div className="text-[11px] text-gray-500 italic mt-1">{cas.description}</div>
              )}
            </div>
          )}

          {/* Liste des périodes */}
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1">Périodes de détention</div>
            {sortedPeriodes.length === 0 ? (
              <div className="text-xs text-gray-400 italic">Aucune période enregistrée.</div>
            ) : (
              <div className="space-y-1">
                {sortedPeriodes.map(p => (
                  <PeriodeRow key={p.id} periode={p} onRemove={() => removePeriode(p.id)} readOnly={readOnly} />
                ))}
              </div>
            )}
          </div>

          {/* Ajout d'une période */}
          {!readOnly && (
            <div className="space-y-2">
              {sortedPeriodes.length === 0 ? (
                <div className="border-2 border-dashed border-red-300 rounded p-2 bg-white">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Placement initial en DP</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-[10px]">Date placement</Label>
                      <Input
                        type="date"
                        value={newPlacementDate}
                        onChange={(e) => setNewPlacementDate(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Durée (mois)</Label>
                      <Input
                        type="number"
                        min={1}
                        value={newPlacementDuree}
                        onChange={(e) => setNewPlacementDuree(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder={cas ? String(cas.dureeInitialeMois) : '4'}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        onClick={addPlacementInitial}
                        disabled={!newPlacementDate || !newPlacementDuree}
                        className="h-7 text-xs bg-red-600 hover:bg-red-700"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Enregistrer placement
                      </Button>
                    </div>
                  </div>
                  {cas && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      Durée légale initiale pour ce cas : {cas.dureeInitialeMois} mois.
                    </div>
                  )}
                </div>
              ) : peutEtreProlonge(mex) ? (
                <div className="border-2 border-dashed border-amber-300 rounded p-2 bg-white">
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    Prolongation (+{cas?.trancheProlongationMois} mois)
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <Label className="text-[10px]">Date de début de la prolongation</Label>
                      <Input
                        type="date"
                        value={newProlongationDate}
                        onChange={(e) => setNewProlongationDate(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        onClick={addProlongation}
                        disabled={!newProlongationDate}
                        className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Prolonger
                      </Button>
                    </div>
                  </div>
                </div>
              ) : peutDemanderProlongationExceptionnelle(mex) ? (
                <div className="border-2 border-dashed border-purple-300 rounded p-2 bg-white">
                  <div className="text-xs font-semibold text-purple-700 mb-1">
                    Durée légale max atteinte — prolongation exceptionnelle CHINS
                  </div>
                  <div className="text-[10px] text-gray-600 mb-1">
                    +{cas?.prolongationExceptionnelle?.dureeMois} mois exceptionnels
                    ({(cas?.prolongationExceptionnelle?.nbMax || 0) - (m.nbProlongationsExceptionnelles || 0)} restante(s))
                    sous condition de risque grave (art 145-2 al 3 / 145-1 al 3 / 706-24-3 al 3).
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <Label className="text-[10px]">Date de début</Label>
                      <Input
                        type="date"
                        value={newProlongationDate}
                        onChange={(e) => setNewProlongationDate(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        onClick={addProlongationExceptionnelle}
                        disabled={!newProlongationDate}
                        className="h-7 text-xs bg-purple-600 hover:bg-purple-700"
                      >
                        Prolong. CHINS
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  <AlertTriangle className="h-3 w-3 inline mr-1" />
                  Durée légale épuisée (et prolongation exceptionnelle non disponible ou épuisée).
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const PeriodeRow = ({
  periode,
  onRemove,
  readOnly,
}: {
  periode: PeriodeDetentionProvisoire;
  onRemove: () => void;
  readOnly?: boolean;
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fin = new Date(periode.dateFin);
  fin.setHours(0, 0, 0, 0);
  const joursRestants = Math.ceil((fin.getTime() - today.getTime()) / 86400000);
  const dejaPasse = joursRestants < 0;
  const proche = !dejaPasse && joursRestants <= 30;
  const isCHINS = periode.motifProlongation === 'Prolongation exceptionnelle CHINS';
  return (
    <div
      className={`flex items-center gap-2 text-xs border rounded px-2 py-1 ${
        dejaPasse
          ? 'border-gray-300 bg-gray-50 text-gray-600'
          : proche
          ? 'border-red-300 bg-red-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <span
        className={`text-[10px] uppercase tracking-wide px-1 rounded ${
          periode.type === 'placement'
            ? 'bg-red-200 text-red-800'
            : isCHINS
            ? 'bg-purple-200 text-purple-800'
            : 'bg-amber-200 text-amber-800'
        }`}
      >
        {periode.type === 'placement' ? 'Placement' : isCHINS ? 'CHINS' : 'Prolong.'}
      </span>
      <span className="font-medium">
        {new Date(periode.dateDebut).toLocaleDateString()} → {fin.toLocaleDateString()}
      </span>
      <span className="text-gray-500">({periode.dureeMois} mois)</span>
      <span className="ml-auto text-gray-500">
        {dejaPasse
          ? `terminée il y a ${Math.abs(joursRestants)} j`
          : `fin dans ${joursRestants} j`}
      </span>
      {!readOnly && (
        <button onClick={onRemove} className="text-gray-400 hover:text-red-600 shrink-0" title="Supprimer">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
};
