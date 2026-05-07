'use client';

import React from 'react';
import { RotateCcw, Info } from 'lucide-react';
import { useCartographieConfig } from '@/hooks/useCartographieConfig';
import { useTags } from '@/hooks/useTags';
import { useToast } from '@/contexts/ToastContext';
import type { CartographieScoreWeights } from '@/types/cartographieTypes';

// ──────────────────────────────────────────────
// PANEL : pondérations du score MEC + tags d'infraction
// ──────────────────────────────────────────────
//
// Tous les paramètres affectent UNIQUEMENT le module Cartographie (score
// "Top mis en cause"). Les stats globales et les pages d'enquête ne
// dépendent pas de ces réglages.

interface WeightFieldDef {
  key: keyof CartographieScoreWeights;
  label: string;
  helper: string;
  step?: number;
  min?: number;
}

const WEIGHT_FIELDS: WeightFieldDef[] = [
  {
    key: 'dossier',
    label: 'Par dossier',
    helper: 'Points ajoutés à un MEC par dossier dans lequel il apparaît.',
    step: 0.5,
  },
  {
    key: 'contentieux',
    label: 'Par contentieux distinct',
    helper: 'Récompense la transversalité (un MEC qui touche plusieurs contentieux).',
    step: 0.5,
  },
  {
    key: 'miseEnExamen',
    label: 'Par mise en examen',
    helper: 'Bonus quand le MEC a été formellement mis en examen dans un dossier d\'instruction.',
    step: 0.5,
  },
  {
    key: 'chefDefault',
    label: 'Par chef d\'inculpation',
    helper: 'Pondération générique appliquée à chaque chef. Une qualification spécifique listée plus bas s\'ajoute par-dessus.',
    step: 0.1,
  },
  {
    key: 'lienRenseignement',
    label: 'Par lien renseignement',
    helper: 'Compte chaque lien manuel attaché au MEC. Mettre 0 pour ignorer.',
    step: 0.5,
    min: 0,
  },
  {
    key: 'recentMultiplier',
    label: 'Multiplicateur "récent"',
    helper: '×1.0 = neutre. Appliqué si au moins un dossier a été touché dans les 12 derniers mois.',
    step: 0.1,
    min: 0,
  },
];

export const AdminCartographyPanel: React.FC = () => {
  const { config, isLoading, updateWeights, setTagInfractionWeight, reset } = useCartographieConfig();
  const { getTagsByCategory, isLoading: tagsLoading } = useTags();
  const { showToast } = useToast();

  const infractionTags = React.useMemo(
    () => getTagsByCategory('infractions'),
    [getTagsByCategory],
  );

  const handleWeightChange = async (key: keyof CartographieScoreWeights, value: string) => {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return;
    await updateWeights({ [key]: n } as Partial<CartographieScoreWeights>);
  };

  const handleTagWeightChange = async (tagId: string, value: string) => {
    const n = parseFloat(value);
    await setTagInfractionWeight(tagId, Number.isFinite(n) ? n : 0);
  };

  const handleReset = async () => {
    if (!window.confirm('Réinitialiser toutes les pondérations aux valeurs par défaut ?')) return;
    const ok = await reset();
    if (ok) showToast('Pondérations réinitialisées', 'success');
  };

  if (isLoading || tagsLoading) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Paramètres du module Cartographie</h2>
        <p className="text-sm text-gray-500 mt-1">
          Ces pondérations contrôlent uniquement le score «&nbsp;Top mis en cause&nbsp;» de la
          cartographie. Elles n&apos;ont pas d&apos;impact sur les stats ni sur les autres modules.
        </p>
      </div>

      {/* Pondérations principales */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Formule du score</h3>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
            title="Restaurer les valeurs par défaut"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>
        </div>

        <div className="space-y-3">
          {WEIGHT_FIELDS.map(f => (
            <div key={f.key} className="grid grid-cols-[1fr_120px] items-start gap-3">
              <div>
                <label className="text-sm font-medium text-gray-800">{f.label}</label>
                <p className="text-xs text-gray-500 mt-0.5">{f.helper}</p>
              </div>
              <input
                type="number"
                step={f.step ?? 1}
                min={f.min}
                defaultValue={config.weights[f.key]}
                onBlur={(e) => handleWeightChange(f.key, e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-right tabular-nums"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-gray-500 bg-slate-50 border border-slate-200 rounded-md p-3">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            Score = (dossiers × poids) + (contentieux × poids) + (ME × poids) + (chefs ×
            poids) + (liens × poids) + bonus infraction. Multiplié par le coefficient
            «&nbsp;récent&nbsp;» si au moins un dossier date des 12 derniers mois.
          </p>
        </div>
      </section>

      {/* Pondérations par tag d'infraction */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Pondération par type d&apos;infraction</h3>
        <p className="text-xs text-gray-500 mb-3">
          Pour chaque type d&apos;infraction, ajoute un bonus au score d&apos;un MEC à chaque dossier
          (ex nihilo ou instruction) le concernant. Liste alimentée par les tags de catégorie
          «&nbsp;Type d&apos;infractions&nbsp;» (Paramètres &gt; Tags). Laisser à 0 pour
          ignorer un tag.
        </p>

        {infractionTags.length === 0 ? (
          <div className="text-xs text-gray-500 italic py-4 text-center border border-dashed border-slate-200 rounded-md">
            Aucun tag d&apos;infraction défini. Ajoute-les depuis l&apos;onglet «&nbsp;Tags&nbsp;».
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            {infractionTags.map(tag => {
              const current = config.tagInfractionWeights[tag.id] ?? 0;
              return (
                <div key={tag.id} className="grid grid-cols-[1fr_100px] items-center gap-3 px-3 py-2">
                  <span className="text-sm text-gray-800">{tag.value}</span>
                  <input
                    type="number"
                    step={0.5}
                    defaultValue={current}
                    onBlur={(e) => handleTagWeightChange(tag.id, e.target.value)}
                    className="border border-slate-300 rounded-md px-2 py-1 text-sm text-right tabular-nums"
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
