'use client';

import React from 'react';
import { RotateCcw, Info, ChevronRight } from 'lucide-react';
import { useCartographieConfig } from '@/hooks/useCartographieConfig';
import { useNatinf } from '@/hooks/useNatinf';
import { ContentieuxManager } from '@/utils/contentieuxManager';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { NatinfBadge } from '../natinf/NatinfBadge';
import type { NatinfEntry } from '@/types/natinf';
import { GRAND_TITRES, STAT_CATEGORIES, categoryForEntry } from '@/lib/natinf/nataff';
import { useToast } from '@/contexts/ToastContext';
import { DEFAULT_CARTO_LAYOUT, type CartographieLayoutConfig, type CartographieScoreWeights } from '@/types/cartographieTypes';

// ──────────────────────────────────────────────
// PANEL : pondérations du score MEC (catégories d'infraction + NATINF)
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

interface LayoutFieldDef {
  key: keyof CartographieLayoutConfig;
  label: string;
  helper: string;
  step: number;
  min: number;
  max?: number;
}

// Paramètres avancés d'espacement de la carte (purement visuels). L'ordre
// place en premier le levier le plus utile (air entre réseaux indépendants).
const LAYOUT_FIELDS: LayoutFieldDef[] = [
  {
    key: 'interGalaxyPadding',
    label: 'Espace entre réseaux sans lien',
    helper: 'Distance entre deux groupes de dossiers qui n\'ont aucun lien entre eux. Augmenter pour aérer la carte. Défaut : 300.',
    step: 20,
    min: 60,
    max: 1200,
  },
  {
    key: 'interGalaxyPaddingRens',
    label: 'Espace entre réseaux reliés',
    helper: 'Distance entre deux réseaux reliés par un lien de renseignement. Petit = ils restent proches (trait court). Défaut : 60.',
    step: 10,
    min: 0,
    max: 600,
  },
  {
    key: 'linkDistance',
    label: 'Distance des dossiers liés',
    helper: 'Longueur cible d\'un lien à l\'intérieur d\'un même réseau. Plus petit = dossiers liés plus collés. Défaut : 180.',
    step: 10,
    min: 60,
    max: 600,
  },
];

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
    key: 'lienRenseignementInfractionCoef',
    label: 'Coef. infraction via lien',
    helper: 'Quand un MEC est rattaché à un dossier (réel ou ex nihilo) par un simple lien de renseignement, il reçoit ce pourcentage du bonus d\'infraction du dossier. 0.8 = 80 %, 0 = ignore.',
    step: 0.1,
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
  const { config, isLoading, updateWeights, setCategoryWeight, setNatinfWeight, setGroupByService, updateLayout, reset } = useCartographieConfig();
  const { getByCode } = useNatinf();
  const { showToast } = useToast();
  const ownEnquetes = useEnquetesStore(state => state.ownEnquetes);

  // Catégories d'infraction (Mémento parquet) regroupées par grand titre, pour
  // la pondération de BASE. Chaque NATINF hérite du poids de sa catégorie.
  const categoriesByGrandTitre = React.useMemo(() => {
    return [...GRAND_TITRES]
      .sort((a, b) => a.order - b.order)
      .map(gt => ({
        grandTitre: gt,
        categories: STAT_CATEGORIES.filter(c => c.grandTitre === gt.code),
      }));
  }, []);

  // NATINF effectivement utilisés = ceux portés par les dossiers des
  // contentieux chargés (infractionNatinfCodes) + ceux ayant déjà un poids
  // (pour que les réglages existants restent visibles et modifiables).
  const usedNatinfs = React.useMemo(() => {
    const codes = new Set<string>(Object.keys(config.natinfWeights || {}));
    const manager = ContentieuxManager.getInstance();
    const activeId = useEnquetesStore.getState().contentieuxId;
    for (const contentieuxId of manager.getLoadedContentieuxIds()) {
      const enquetes = contentieuxId === activeId ? ownEnquetes : manager.getEnquetes(contentieuxId);
      for (const e of enquetes) {
        for (const c of (e.infractionNatinfCodes || [])) codes.add(c);
      }
    }
    return [...codes]
      .map(c => getByCode(c))
      .filter((e): e is NatinfEntry => Boolean(e))
      .sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));
  }, [config.natinfWeights, ownEnquetes, getByCode]);

  // Tampon d'édition local : permet la saisie libre tout en gardant les
  // champs synchronisés sur la config persistée. On le vide à chaque
  // changement de `config` (commit, reset…) pour que les inputs reflètent
  // toujours l'état réel.
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  React.useEffect(() => { setDraft({}); }, [config]);

  // Une sauvegarde peut être refusée si la config n'a pas pu être relue
  // (data.json momentanément illisible) : dans ce cas le manager lève une
  // erreur plutôt que d'écraser les vrais réglages par des valeurs par défaut.
  // On en informe l'utilisateur au lieu d'échouer en silence.
  const guardSave = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : 'Échec de l’enregistrement des réglages de cartographie.',
      );
    }
  };

  const handleWeightChange = async (key: keyof CartographieScoreWeights, value: string) => {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return;
    await guardSave(() => updateWeights({ [key]: n } as Partial<CartographieScoreWeights>));
  };

  const handleCategoryWeightChange = async (code: string, value: string) => {
    const n = parseFloat(value);
    await guardSave(() => setCategoryWeight(code, Number.isFinite(n) ? n : 0));
  };

  const handleNatinfWeightChange = async (code: string, value: string) => {
    const n = parseFloat(value);
    await guardSave(() => setNatinfWeight(code, Number.isFinite(n) ? n : 0));
  };

  const handleLayoutChange = async (key: keyof CartographieLayoutConfig, value: string) => {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return;
    // On borne pour éviter une carte injouable (chevauchement ou dispersion
    // extrême) même si l'utilisateur saisit une valeur aberrante.
    const clamped = Math.max(0, Math.min(4000, n));
    await guardSave(() => updateLayout({ [key]: clamped } as Partial<CartographieLayoutConfig>));
  };

  const handleLayoutReset = async () => {
    await guardSave(() => updateLayout({ ...DEFAULT_CARTO_LAYOUT }));
    showToast('Espacement réinitialisé', 'success');
  };

  const handleReset = async () => {
    if (!window.confirm('Réinitialiser toutes les pondérations aux valeurs par défaut ?')) return;
    const ok = await reset();
    if (ok) showToast('Pondérations réinitialisées', 'success');
  };

  if (isLoading) {
    return <div className="text-sm text-gray-500">Chargement…</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Scoring du module Cartographie</h2>
        <p className="text-sm text-gray-500 mt-1">
          Ces pondérations définissent le <strong>scoring</strong> «&nbsp;Top mis en cause&nbsp;» de la
          cartographie. Elles n&apos;ont pas d&apos;impact sur les stats ni sur les autres modules.
        </p>
      </div>

      {/* Pondérations principales */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Formule du scoring</h3>
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
                value={draft[`w:${f.key}`] ?? String(config.weights[f.key])}
                onChange={(e) => setDraft(d => ({ ...d, [`w:${f.key}`]: e.target.value }))}
                onBlur={(e) => handleWeightChange(f.key, e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-right tabular-nums"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-gray-500 bg-slate-50 border border-slate-200 rounded-md p-3">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            Scoring = (dossiers × poids) + (contentieux × poids) + (ME × poids) + (chefs ×
            poids) + (liens × poids) + bonus infraction. Un MEC relié à un dossier par
            un lien de renseignement reçoit en plus le bonus d&apos;infraction de ce
            dossier × le coef. ci-dessus. Le tout est multiplié par le coefficient
            «&nbsp;récent&nbsp;» si au moins un dossier date des 12 derniers mois.
          </p>
        </div>
      </section>

      {/* Ancrage zonal par service */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Disposition de la carte</h3>
        <label className="flex items-start gap-3 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.groupByService}
            onChange={(e) => guardSave(() => setGroupByService(e.target.checked))}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            <span className="text-sm font-medium text-gray-800">Regrouper par service</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Rapproche sur la carte les réseaux relevant d&apos;un même service d&apos;enquête,
              sans casser les liens existants. Effet doux et automatique (aucun emplacement
              figé). Prend effet au prochain «&nbsp;Recompacter la carte&nbsp;».
            </span>
          </span>
        </label>

        {/* Paramètres avancés d'espacement (repliés par défaut) */}
        <details className="group mt-4 border-t border-slate-100 pt-3">
          <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold text-slate-600 hover:text-slate-900">
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            Paramètres avancés — espacement
          </summary>

          <p className="text-xs text-gray-500 mt-2">
            Réglages purement visuels : ils modifient uniquement les distances à l&apos;écran,
            pas les scores ni les liens. Prennent effet au prochain «&nbsp;Recompacter la
            carte&nbsp;».
          </p>

          <div className="space-y-3 mt-3">
            {LAYOUT_FIELDS.map(f => (
              <div key={f.key} className="grid grid-cols-[1fr_120px] items-start gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-800">{f.label}</label>
                  <p className="text-xs text-gray-500 mt-0.5">{f.helper}</p>
                </div>
                <input
                  type="number"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  value={draft[`l:${f.key}`] ?? String(config.layout[f.key])}
                  onChange={(e) => setDraft(d => ({ ...d, [`l:${f.key}`]: e.target.value }))}
                  onBlur={(e) => handleLayoutChange(f.key, e.target.value)}
                  className="border border-slate-300 rounded-md px-3 py-1.5 text-sm text-right tabular-nums"
                />
              </div>
            ))}
          </div>

          <button
            onClick={handleLayoutReset}
            className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800"
            title="Restaurer les valeurs par défaut de l'espacement"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser l&apos;espacement
          </button>
        </details>
      </section>

      {/* Pondération de base par catégorie d'infraction (Mémento parquet) */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Pondération par catégorie d&apos;infraction</h3>
        <p className="text-xs text-gray-500 mb-3">
          Pondération de <strong>base</strong> : bonus ajouté au score d&apos;un MEC pour chaque
          dossier le concernant, selon la catégorie d&apos;infraction (taxonomie Mémento parquet).
          Chaque NATINF hérite automatiquement du poids de sa catégorie. Affinez ensuite
          NATINF par NATINF ci-dessous si besoin. Laisser à 0 pour ignorer.
        </p>

        <div className="space-y-4">
          {categoriesByGrandTitre.map(({ grandTitre, categories }) => (
            <div key={grandTitre.code}>
              <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
                {grandTitre.label}
              </div>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                {categories.map(cat => {
                  const current = config.categoryWeights[cat.code] ?? 0;
                  return (
                    <div key={cat.code} className="grid grid-cols-[1fr_100px] items-center gap-3 px-3 py-1.5">
                      <span className="text-sm text-gray-800 truncate" title={cat.label}>{cat.label}</span>
                      <input
                        type="number"
                        step={0.5}
                        value={draft[`c:${cat.code}`] ?? String(current)}
                        onChange={(e) => setDraft(d => ({ ...d, [`c:${cat.code}`]: e.target.value }))}
                        onBlur={(e) => handleCategoryWeightChange(cat.code, e.target.value)}
                        className="border border-slate-300 rounded-md px-2 py-1 text-sm text-right tabular-nums"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Affinage par NATINF (override la catégorie) */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Affinage par NATINF (optionnel)</h3>
        <p className="text-xs text-gray-500 mb-3">
          De <strong>luxe</strong> : un poids posé ici <strong>prime</strong> sur le poids de la
          catégorie pour ce NATINF précis, quand vous avez besoin de descendre dans le détail.
          Seuls les NATINF portés par vos dossiers sont listés. Laisser à 0 = utiliser le
          poids de la catégorie.
        </p>

        {usedNatinfs.length === 0 ? (
          <div className="text-xs text-gray-500 italic py-4 text-center border border-dashed border-slate-200 rounded-md">
            Aucun NATINF porté par les dossiers chargés.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            {usedNatinfs.map(n => {
              const current = config.natinfWeights[n.code] ?? 0;
              const cat = categoryForEntry(n);
              const inherited = cat ? (config.categoryWeights[cat.category.code] ?? 0) : 0;
              return (
                <div key={n.code} className="grid grid-cols-[1fr_100px] items-center gap-3 px-3 py-2">
                  <span className="text-sm text-gray-800 inline-flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs text-gray-500 shrink-0">{n.code}</span>
                    <span className="truncate" title={n.libelle}>{n.libelle}</span>
                    <NatinfBadge nature={n.nature} quantumLabel={n.quantumLabel} compact />
                    {cat && (
                      <span className="text-[10px] text-slate-400 shrink-0" title="Catégorie héritée et son poids de base">
                        {cat.category.label} ({inherited})
                      </span>
                    )}
                  </span>
                  <input
                    type="number"
                    step={0.5}
                    placeholder={String(inherited)}
                    value={draft[`n:${n.code}`] ?? (current ? String(current) : '')}
                    onChange={(e) => setDraft(d => ({ ...d, [`n:${n.code}`]: e.target.value }))}
                    onBlur={(e) => handleNatinfWeightChange(n.code, e.target.value)}
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
