/**
 * Génère le « Rapport AEM » : un PDF complet et professionnel qui reproduit le
 * Dashboard Statistiques AIR (composant AIRDashboardIntegrated).
 *
 * Le document est construit en HTML dédié à l'impression puis rasterisé en PDF
 * A4 (utils/pdf/pdfRender → exportHtmlToPdf). Les graphiques de l'écran (Recharts)
 * sont redessinés sur canvas hors-écran avec les mêmes couleurs, ce que
 * html2canvas capture de façon fiable, contrairement aux SVG.
 *
 * Les données ne sont PAS recalculées ici : elles sont assemblées par le
 * composant à partir de ses propres mémos (mêmes chiffres qu'à l'écran) et
 * passées telles quelles, garantissant une parité stricte dashboard ↔ PDF.
 */

import {
  renderPieChartImg,
  renderLineChartImg,
  renderBarChart,
  renderGroupedBarsWithLineImg,
  renderLegend,
  renderMonthTable,
  escapeHtml,
  exportHtmlToPdf,
} from '@/utils/pdf/pdfRender';

// Palette du module AIR — reprend les couleurs de l'écran (colors du dashboard)
// harmonisées avec la charte « Prestige » du rapport.
const AIR = {
  navy: '#16307A',
  blue: '#3498db',
  reussite: '#067647',
  echec: '#C01427',
  warn: '#F79009',
  info: '#8b5cf6',
  gray: '#667085',
};

// Couleurs cycliques du camembert d'infractions (identiques à l'écran :
// primary, info, warning, success, error, gray).
const INFRACTION_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6b7280'];

export interface AIRPdfConvItem {
  nom: string;
  ref: string;
  ageEnMois: number;
  nbRDV: number;
  referent: string;
}

export interface AIRPdfData {
  redacteur?: string;
  destinataire?: string;
  /** Seuil « mesures anciennes » (mois), configurable dans les Paramètres AIR. */
  ancienneteMois: number;
  /** Seuil « mesures très anciennes » (mois). */
  tresAncienneteMois: number;

  // Chiffres clés globaux
  total: number;
  enCours: number;
  cloturees: number;
  reussites: number;
  echecs: number;
  tauxReussite: number;
  anciennes: number;
  tresAnciennes: number;
  moyenneEntretiensPR: number;

  // Ventilation annuelle et tendances (à date équivalente)
  anneeCourante: number;
  anneePrec: number;
  deltaTaux: number | null;
  deltaEchecs: number | null;
  annees: {
    annee: number;
    recues: number;
    cloturees: number;
    reussites: number;
    echecs: number;
    taux: number | null;
  }[];
  evolutionAnnuelle: { annee: string; reussites: number; echecs: number; cloturees: number; taux: number }[];

  // Évolution mensuelle (12 derniers mois)
  evolutionMensuelle: { mois: string; nouvelles: number; clotures: number }[];

  // Suivi glissant du stock (36 mois) + statistiques et alertes prédictives
  suivi36: {
    data: { mois: string; enCours: number; total: number }[];
    evolutionEnCours: number;
    evolutionCapacite: number;
    stockActuel: number;
    mesuresTraitees: number;
    alertes: { type: string; titre: string; message: string }[];
  };

  // Répartition par type d'infraction
  infractions: { name: string; value: number; count: number }[];

  // Charge et performance par référent
  referents: {
    referent: string;
    total: number;
    enCours: number;
    reussites: number;
    echecs: number;
    tauxReussite: number;
    surcharge: boolean;
  }[];

  // Alertes système (surcharge, mesures anciennes…)
  alertesSysteme: { type: string; message: string; action: string }[];

  // Alertes convocations Procureur
  convocations: {
    urgent: AIRPdfConvItem[];
    retard: AIRPdfConvItem[];
    insuffisant: AIRPdfConvItem[];
  };

  // Projections jusqu'à la fin de l'année
  predictions: {
    projectionNouvelles: number;
    projectionClotures: number;
    joursRestants: number;
    tendanceNouvelles: string;
    tendanceClotures: string;
  };
}

export interface AIRPdfSectionDef { key: string; label: string; }
export const AIR_PDF_SECTIONS: AIRPdfSectionDef[] = [
  { key: 'synthese', label: 'Synthèse (chiffres clés)' },
  { key: 'annuelle', label: 'Bilan annuel détaillé' },
  { key: 'evolution_annuelle', label: 'Évolution annuelle du taux de réussite' },
  { key: 'evolution_mensuelle', label: 'Évolution mensuelle (12 mois)' },
  { key: 'infractions', label: "Types d'infractions" },
  { key: 'referents', label: 'Charge et performance par référent' },
  { key: 'stock36', label: 'Évolution du stock (36 mois)' },
  { key: 'alertes', label: 'Alertes système' },
  { key: 'convocations', label: 'Alertes convocations Procureur' },
  { key: 'projections', label: 'Projections & recommandations' },
];

export interface AIRPdfOptions {
  sections?: Record<string, boolean>;
  redacteur?: string;
  destinataire?: string;
}

/** Classe d'encart d'alerte selon le type (aligne les types écran sur la charte). */
function alertClass(type: string): string {
  if (type === 'danger' || type === 'error') return 'danger';
  if (type === 'warning') return 'warning';
  if (type === 'success') return 'success';
  return 'info';
}

/** Bloc d'une colonne de convocations (Urgent / Retard / Insuffisant). */
function renderConvocationColumn(
  titre: string,
  items: AIRPdfConvItem[],
  boxClass: 'danger' | 'warning' | 'info',
): string {
  const MAX = 12;
  const shown = items.slice(0, MAX);
  const reste = items.length - shown.length;
  const lignes = shown.length === 0
    ? '<div style="font-size:9px;color:#98A0B4;padding:4px 0">Aucune mesure.</div>'
    : shown.map(m => `
      <div style="background:#fff;border:1px solid #EEF0F6;border-radius:6px;padding:5px 7px;margin-bottom:4px">
        <div style="font-weight:700;font-size:9px;color:#1A1C2A">${escapeHtml(m.nom)}</div>
        <div style="font-size:8px;color:#667085">Réf : ${escapeHtml(m.ref)}</div>
        <div style="font-size:8px;color:#475069">${m.ageEnMois} mois • ${m.nbRDV} RDV • ${escapeHtml(m.referent)}</div>
      </div>`).join('');
  return `
    <div class="alert-box ${boxClass}" style="flex:1;margin-bottom:0">
      <div class="a-title">${titre} (${items.length})</div>
      <div style="margin-top:6px">${lignes}${reste > 0 ? `<div style="font-size:8px;color:#98A0B4;margin-top:2px">+ ${reste} autre${reste > 1 ? 's' : ''}…</div>` : ''}</div>
    </div>`;
}

export function generateAIRPdfHtml(data: AIRPdfData, options: AIRPdfOptions = {}): string {
  const on = (k: string): boolean => (options.sections ? options.sections[k] !== false : true);
  const redacteur = options.redacteur || data.redacteur || 'Audran CHEVALIER';
  const destinataire = options.destinataire || 'Procureur de la République';
  const dateEdition = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const deltaTauxHtml = data.deltaTaux === null ? ''
    : `<span class="${data.deltaTaux >= 0 ? 'pos' : 'neg'}">${data.deltaTaux >= 0 ? '▲ +' : '▼ '}${data.deltaTaux} pts</span> vs ${data.anneePrec} à date`;
  const deltaEchecsHtml = data.deltaEchecs === null ? ''
    : `<span class="${data.deltaEchecs <= 0 ? 'pos' : 'neg'}">${data.deltaEchecs > 0 ? '▲ +' : data.deltaEchecs < 0 ? '▼ ' : ''}${data.deltaEchecs}</span> vs ${data.anneePrec} à date`;

  // ── Graphiques (canvas → <img>) ──────────────────────────────
  const comboAnnuel = renderGroupedBarsWithLineImg(
    data.evolutionAnnuelle.map(e => e.annee),
    [
      { label: 'Réussites', color: AIR.reussite, values: data.evolutionAnnuelle.map(e => e.reussites) },
      { label: 'Échecs', color: AIR.echec, values: data.evolutionAnnuelle.map(e => e.echecs) },
    ],
    { label: 'Taux de réussite', color: AIR.info, values: data.evolutionAnnuelle.map(e => e.taux), suffix: '%', max: 100 },
    680, 260,
  );

  const evolMensuelChart = renderLineChartImg(
    {
      labels: data.evolutionMensuelle.map(d => d.mois),
      series: [
        { label: 'Nouvelles', color: AIR.blue, values: data.evolutionMensuelle.map(d => d.nouvelles) },
        { label: 'Clôtures', color: AIR.reussite, values: data.evolutionMensuelle.map(d => d.clotures) },
      ],
    },
    680, 240,
  );

  const infractionItems = data.infractions.map((inf, i) => ({
    label: inf.name,
    value: inf.count,
    color: INFRACTION_COLORS[i % INFRACTION_COLORS.length],
  }));
  const infractionPie = renderPieChartImg(infractionItems, 200, 'valuePct');

  const stockChart = renderLineChartImg(
    {
      labels: data.suivi36.data.map(d => d.mois),
      series: [
        { label: 'En cours', color: AIR.warn, values: data.suivi36.data.map(d => d.enCours) },
        { label: 'Total cumulé', color: AIR.blue, values: data.suivi36.data.map(d => d.total) },
      ],
      everyNth: 3,
      showValues: false,
    },
    680, 240,
  );

  const referentsChart = renderBarChart(
    data.referents.slice(0, 8).map(r => ({
      label: r.referent,
      value: r.enCours,
      color: r.surcharge ? AIR.warn : AIR.navy,
    })),
  );

  const totalConvoc = data.convocations.urgent.length + data.convocations.retard.length + data.convocations.insuffisant.length;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport AEM — Mesures AIR</title>
</head>
<body>

<!-- Masthead identitaire -->
<div class="page-header">
  <div class="tricolore"></div>
  <div class="monogram"></div>
  <div class="overline">Tribunal judiciaire d'Amiens &mdash; Parquet d'Amiens</div>
  <h1>Rapport d'activité — Mesures AIR / AEM</h1>
  <div class="subtitle">Suivi intégré des mesures — situation arrêtée au ${dateEdition}</div>
  <div class="chips">
    <span class="chip">${data.total} mesures</span>
    <span class="chip">${data.enCours} en cours</span>
    <span class="chip">Taux de réussite ${data.tauxReussite}%</span>
    <span class="chip alert">Confidentiel — ne pas diffuser</span>
  </div>
</div>

<div class="redige-par">Rédigé par <b>${escapeHtml(redacteur)}</b>, à destination du ${escapeHtml(destinataire)}.</div>

${on('synthese') ? `
<div class="kpi-band">
  <div class="kpi">
    <div class="kpi-value">${data.total}</div>
    <div class="kpi-label">Mesures suivies</div>
    <div class="kpi-sub">${data.cloturees} clôturées</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${data.enCours}</div>
    <div class="kpi-label">En cours</div>
    <div class="kpi-sub">Stock actuel</div>
  </div>
  <div class="kpi pos">
    <div class="kpi-value">${data.reussites}</div>
    <div class="kpi-label">Réussites</div>
    <div class="kpi-sub">${data.echecs} échec${data.echecs > 1 ? 's' : ''}</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${data.tauxReussite}<span class="unit">%</span></div>
    <div class="kpi-label">Taux de réussite</div>
    <div class="kpi-sub">${deltaTauxHtml || 'sur mesures décidées'}</div>
  </div>
</div>

<div class="cards-row" style="margin-bottom:14px">
  <div class="card">
    <div class="card-label">Échecs</div>
    <div class="card-value" style="color:${AIR.echec}">${data.echecs}</div>
    <div class="card-detail">${deltaEchecsHtml || 'mesures en échec'}</div>
  </div>
  <div class="card ${data.anciennes > 15 ? 'warn' : ''}">
    <div class="card-label">+ ${data.ancienneteMois} mois</div>
    <div class="card-value">${data.anciennes}</div>
    <div class="card-detail">mesures en cours anciennes</div>
  </div>
  <div class="card ${data.tresAnciennes > 0 ? 'danger' : ''}">
    <div class="card-label">+ ${data.tresAncienneteMois} mois</div>
    <div class="card-value">${data.tresAnciennes}</div>
    <div class="card-detail">mesures très anciennes</div>
  </div>
  <div class="card">
    <div class="card-label">Entretiens PR / mesure</div>
    <div class="card-value">${data.moyenneEntretiensPR}</div>
    <div class="card-detail">moyenne de rencontres devant le Procureur</div>
  </div>
</div>` : ''}

${on('annuelle') && data.annees.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Bilan annuel détaillé</div>
  <p class="section-note">Total par année de réception • réussites / échecs / taux par année de clôture.</p>
  <table>
    <tr>
      <th>Année</th>
      <th class="text-right">Reçues</th>
      <th class="text-right">Clôturées</th>
      <th class="text-right">Réussites</th>
      <th class="text-right">Échecs</th>
      <th class="text-right">Taux</th>
    </tr>
    ${data.annees.map(a => `<tr>
      <td class="font-bold">${a.annee}</td>
      <td class="text-right">${a.recues}</td>
      <td class="text-right">${a.cloturees}</td>
      <td class="text-right pos">${a.reussites}</td>
      <td class="text-right neg">${a.echecs}</td>
      <td class="text-right font-bold">${a.taux === null ? '—' : a.taux + '%'}</td>
    </tr>`).join('')}
    <tr class="row-total">
      <td>TOTAL</td>
      <td class="text-right">${data.annees.reduce((s, a) => s + a.recues, 0)}</td>
      <td class="text-right">${data.cloturees}</td>
      <td class="text-right">${data.reussites}</td>
      <td class="text-right">${data.echecs}</td>
      <td class="text-right">${data.tauxReussite}%</td>
    </tr>
  </table>
</div>` : ''}

${on('evolution_annuelle') && data.evolutionAnnuelle.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Évolution annuelle du taux de réussite</div>
  <p class="section-note">Barres : réussites / échecs par année de clôture • Ligne : taux de réussite (mesures décidées).</p>
  ${comboAnnuel
    ? `<div style="text-align:center">${comboAnnuel}</div>${renderLegend([
        { label: 'Réussites', color: AIR.reussite },
        { label: 'Échecs', color: AIR.echec },
        { label: 'Taux de réussite', color: AIR.info },
      ])}`
    : `<table>
        <tr><th>Année</th><th class="text-right">Réussites</th><th class="text-right">Échecs</th><th class="text-right">Taux</th></tr>
        ${data.evolutionAnnuelle.map(e => `<tr><td>${e.annee}</td><td class="text-right pos">${e.reussites}</td><td class="text-right neg">${e.echecs}</td><td class="text-right font-bold">${e.taux}%</td></tr>`).join('')}
      </table>`}
</div>` : ''}

${on('evolution_mensuelle') && data.evolutionMensuelle.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Évolution mensuelle (12 derniers mois)</div>
  <p class="section-note">Nouvelles mesures reçues et clôtures, par mois.</p>
  ${evolMensuelChart
    ? `<div style="text-align:center">${evolMensuelChart}</div>${renderLegend([
        { label: 'Nouvelles mesures', color: AIR.blue },
        { label: 'Clôtures', color: AIR.reussite },
      ])}`
    : ''}
  <table style="margin-top:10px">
    <tr><th>Mois</th><th class="text-right">Nouvelles</th><th class="text-right">Clôtures</th></tr>
    ${data.evolutionMensuelle.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.nouvelles}</td><td class="text-right font-bold">${d.clotures}</td></tr>`).join('')}
  </table>
</div>` : ''}

${on('infractions') && data.infractions.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Types d'infractions</div>
  <p class="section-note">Répartition des ${data.total} mesures par nature de faits.</p>
  <div class="two-cols" style="align-items:center">
    ${infractionPie ? `<div style="text-align:center;flex:0 0 220px">${infractionPie}</div>` : ''}
    <div>
      <table>
        <tr><th>Infraction</th><th class="text-right">Nb</th><th class="text-right">%</th></tr>
        ${data.infractions.map((inf, i) => `<tr>
          <td><span class="svc-dot" style="background:${INFRACTION_COLORS[i % INFRACTION_COLORS.length]}"></span>${escapeHtml(inf.name)}</td>
          <td class="text-right font-bold">${inf.count}</td>
          <td class="text-right">${inf.value}%</td>
        </tr>`).join('')}
      </table>
    </div>
  </div>
</div>` : ''}

${on('referents') && data.referents.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Charge et performance par référent</div>
  <p class="section-note">Stock en cours, mesures traitées et taux de réussite par référent. Surcharge signalée au-delà de 30 mesures en cours.</p>
  <div style="margin-bottom:12px">${referentsChart}</div>
  <table>
    <tr>
      <th>Référent</th>
      <th class="text-right">En cours</th>
      <th class="text-right">Total</th>
      <th class="text-right">Réussites</th>
      <th class="text-right">Échecs</th>
      <th class="text-right">Taux</th>
    </tr>
    ${data.referents.map(r => `<tr>
      <td class="font-bold">${escapeHtml(r.referent)}${r.surcharge ? '<span class="badge warn">Surcharge</span>' : ''}</td>
      <td class="text-right font-bold" style="color:${r.surcharge ? AIR.warn : AIR.navy}">${r.enCours}</td>
      <td class="text-right">${r.total}</td>
      <td class="text-right pos">${r.reussites}</td>
      <td class="text-right neg">${r.echecs}</td>
      <td class="text-right">${r.tauxReussite}%</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

${on('stock36') ? `
<div class="section-nobreak">
  <div class="section-title">Évolution du stock de mesures (36 mois)</div>
  <p class="section-note">Stock de mesures en cours et total cumulé, mois par mois.</p>
  ${stockChart
    ? `<div style="text-align:center">${stockChart}</div>${renderLegend([
        { label: 'En cours', color: AIR.warn },
        { label: 'Total cumulé', color: AIR.blue },
      ])}`
    : ''}
  <div class="cards-row" style="margin-top:12px">
    <div class="card ${data.suivi36.evolutionEnCours > 0 ? 'danger' : data.suivi36.evolutionEnCours < 0 ? 'ok' : ''}">
      <div class="card-label">Évolution stock (12 mois)</div>
      <div class="card-value">${data.suivi36.evolutionEnCours > 0 ? '+' : ''}${data.suivi36.evolutionEnCours}%</div>
      <div class="card-detail">${data.suivi36.stockActuel} mesures en cours</div>
    </div>
    <div class="card ${data.suivi36.evolutionCapacite > 0 ? 'ok' : data.suivi36.evolutionCapacite < 0 ? 'danger' : ''}">
      <div class="card-label">Capacité de traitement (12 mois)</div>
      <div class="card-value">${data.suivi36.evolutionCapacite > 0 ? '+' : ''}${data.suivi36.evolutionCapacite}%</div>
      <div class="card-detail">${data.suivi36.mesuresTraitees} mesures traitées</div>
    </div>
  </div>
  ${data.suivi36.alertes.length > 0 ? `<div style="margin-top:12px">
    ${data.suivi36.alertes.map(a => `<div class="alert-box ${alertClass(a.type)}">
      <div class="a-title">${escapeHtml(a.titre)}</div>
      <div class="a-msg">${escapeHtml(a.message)}</div>
    </div>`).join('')}
  </div>` : ''}
</div>` : ''}

${on('alertes') && data.alertesSysteme.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Alertes système (${data.alertesSysteme.length})</div>
  ${data.alertesSysteme.map(a => `<div class="alert-box ${alertClass(a.type)}">
    <div class="a-title">${escapeHtml(a.message)}</div>
    <div class="a-msg">Action : ${escapeHtml(a.action)}</div>
  </div>`).join('')}
</div>` : ''}

${on('convocations') ? `
<div class="section-nobreak">
  <div class="section-title">Alertes convocations Procureur (${totalConvoc})</div>
  <p class="section-note">Mesures en cours à prioriser pour une convocation devant le Procureur, selon leur ancienneté et le nombre de rencontres déjà tenues.</p>
  <div style="display:flex;gap:10px;align-items:stretch">
    ${renderConvocationColumn('🔴 Urgent à convoquer', data.convocations.urgent, 'danger')}
    ${renderConvocationColumn('🟠 Retard probable', data.convocations.retard, 'warning')}
    ${renderConvocationColumn('🟡 Suivi insuffisant', data.convocations.insuffisant, 'info')}
  </div>
</div>` : ''}

${on('projections') ? `
<div class="section-nobreak">
  <div class="section-title">Projections &amp; recommandations</div>
  <div class="two-cols" style="align-items:flex-start">
    <div>
      <p class="section-note" style="font-weight:700;color:${AIR.navy}">Projections au 31 décembre ${data.anneeCourante} (${data.predictions.joursRestants} jours restants)</p>
      <div class="cards-row">
        <div class="card">
          <div class="card-label">Nouvelles mesures ${data.predictions.tendanceNouvelles === 'hausse' ? '↗' : '↘'}</div>
          <div class="card-value">~${data.predictions.projectionNouvelles}</div>
          <div class="card-detail">projection (moyenne 12 mois)</div>
        </div>
        <div class="card">
          <div class="card-label">Clôtures prévues ${data.predictions.tendanceClotures === 'hausse' ? '↗' : '↘'}</div>
          <div class="card-value">~${data.predictions.projectionClotures}</div>
          <div class="card-detail">au rythme actuel</div>
        </div>
      </div>
    </div>
    <div>
      <p class="section-note" style="font-weight:700;color:${AIR.navy}">Recommandations</p>
      ${data.referents.filter(r => r.surcharge).length > 0 ? `<div class="alert-box warning">
        <div class="a-title">Répartition de charge</div>
        <div class="a-msg">${data.referents.filter(r => r.surcharge).length} référent(s) surchargé(s). Redistribuer les nouveaux dossiers.</div>
      </div>` : ''}
      ${data.anciennes > 15 ? `<div class="alert-box warning">
        <div class="a-title">Mesures anciennes</div>
        <div class="a-msg">Planifier la clôture de ${data.anciennes} mesures de plus de ${data.ancienneteMois} mois.</div>
      </div>` : ''}
      <div class="alert-box info">
        <div class="a-title">Performance globale</div>
        <div class="a-msg">Taux de réussite : ${data.tauxReussite}% • Moyenne entretiens PR : ${data.moyenneEntretiensPR}/mesure.</div>
      </div>
    </div>
  </div>
</div>` : ''}

<div class="footer">
  <span class="tri"><i style="background:#16307A"></i><i style="background:#ffffff;border:1px solid #D5DAE6"></i><i style="background:#C01427"></i></span>
  <span>Tribunal judiciaire d'Amiens — Parquet d'Amiens · Rapport AEM édité le ${new Date().toLocaleDateString('fr-FR')} · Usage interne, ne pas diffuser</span>
</div>

</body>
</html>`;
}

export async function exportAIRPdf(data: AIRPdfData, options: AIRPdfOptions = {}): Promise<void> {
  const html = generateAIRPdfHtml(data, options);
  await exportHtmlToPdf(html, {
    filename: `Rapport_AEM_${data.anneeCourante}.pdf`,
    footerLabel: `Rapport AEM ${data.anneeCourante}`,
  });
}
