/**
 * Génère un rapport PDF des statistiques en construisant un document HTML
 * dédié à l'impression, indépendant du DOM de l'application.
 *
 * Avantages vs window.print() sur la page principale :
 * - Contrôle total sur la pagination et le formatage
 * - Tableaux propres, pas de troncature
 *
 * Les camemberts sont redessinés sur un canvas hors-écran avec les mêmes
 * couleurs et étiquettes que les Pie Chart.js de la page Statistiques
 * (source unique : utils/chartColors), puis incorporés en <img> — ce que
 * html2canvas capture de façon fiable.
 */

import { AudienceStats } from '@/types/audienceTypes';
import { Enquete } from '@/types/interfaces';
import { getServiceColor, ORIENTATION_DATASETS, CHART_COLORS } from '@/utils/chartColors';
import {
  CSS_STYLES,
  formatCurrency,
  formatMoisEnAnnees,
  renderLegend,
  renderPieSubstitute,
  renderPieChartImg,
  renderColumnChartImg,
  renderStackedColumnChartImg,
  renderBarChart,
  renderLineChartImg,
  renderMonthTable,
  exportHtmlToPdf,
} from '@/utils/pdf/pdfRender';

interface PdfExportData {
  selectedYear: number;
  /** Libellé du contentieux affiché en titre (ex. « Criminalité Organisée / Stup »). */
  contentieuxLabel?: string;
  /** Nom de l'utilisateur qui génère le rapport (mention « Rédigé par … »). */
  redacteur?: string;
  // Stats générales
  enquetesTerminees: number;
  enquetesEnCours: number;
  dureeMoyenneTerminees: number;
  dureeMoyenneEnCours: number;
  proceduremoisData: { mois: string; count: number }[];
  // Actes
  acteStats: {
    ecoutes: number;
    geolocalisations: number;
    autresActes: number;
    prolongationsEcoutes: number;
    prolongationsGeo: number;
    prolongationsAutres: number;
  };
  // Services
  serviceStats: { service: string; count: number }[];
  serviceStatsTerminees: { service: string; count: number }[];
  // Audience stats
  audienceStats: AudienceStats | null;
  // Stats mensuelles
  monthlyData: {
    mois: string;
    condamnations: number;
    moisPrison: number;
    amendes: number;
    crpc: number;
    ci: number;
    copj: number;
    oi: number;
    cdd: number;
    classement: number;
  }[];
  // Répartition par catégorie d'infraction — enquêtes en cours
  infractionsEnCours: { infraction: string; count: number }[];
  // Répartition par catégorie d'infraction — enquêtes terminées
  infractionsTerminees: { infraction: string; count: number }[];
  // Déférements par mois
  deferementsParMois: { mois: string; count: number }[];
  // Âge moyen (jours) des dossiers avant ouverture d'information / classement
  ouvertureInfoAgeMoyen: number;
  classementAgeMoyen: number;
  // Enquêtes en cours
  enquetesEnCoursTotal: number;
  enquetesOuvertesAnnee: number;
  ouverturesParMois: { mois: string; count: number }[];
  // Comparatif N-1 (reflète la carte « Comparatif {N-1}/{N} » de la page).
  comparatif?: {
    prevYear: number;
    prevTotalTerminees: number;
    currentTotalTerminees: number;
    prevCondamnations: number;
    currentCondamnations: number;
    prevPrison: number;
    currentPrison: number;
    prevAmendes: number;
    currentAmendes: number;
    prevDeferements: number;
    currentDeferements: number;
  };
  // Suivi parquet extérieur (reflète la carte « Suivi parquet extérieur »).
  suivi?: {
    total: number;
    jirs: number;
    pg: number;
    both: number;
  };
  // Statistiques du module instruction (facultatif : présent seulement si des
  // dossiers d'instruction existent pour le périmètre courant). Reflète la
  // section « Statistiques instruction » de la page.
  instructionStats?: {
    nbDossiers: number;
    nbDossiersActifs: number;
    nbDossiersArchives: number;
    nbDossiersAuReglement: number;
    nbMisEnExamen: number;
    nbDetenus: number;
    nbARSE: number;
    nbCJ: number;
    nbLibres: number;
    ageMoyenDossiersActifsJours: number;
    ageMaxDossierActifJours: number;
    dossiersAReglerTotal: number;
    dossiersAReglerAvecDetenu: number;
  };
}

/** Camembert + tableau d'une répartition par service (même couleur par service que l'app). */
function renderServiceBlock(list: { service: string; count: number }[]): string {
  const total = list.reduce((s, i) => s + i.count, 0);
  const pie = renderPieChartImg(
    list.map(s => ({ label: s.service, value: s.count, color: getServiceColor(s.service) })),
    150,
    'valuePct'
  );
  return `${pie ? `<div style="text-align:center;margin-bottom:8px">${pie}</div>` : ''}
      <table>
        <tr><th>Service</th><th class="text-right">Nombre</th><th class="text-right">%</th></tr>
        ${list.map(s =>
          `<tr><td><span class="svc-dot" style="background:${getServiceColor(s.service)}"></span>${s.service}</td><td class="text-right font-bold">${s.count}</td><td class="text-right">${total > 0 ? ((s.count / total) * 100).toFixed(1) : 0}%</td></tr>`
        ).join('')}
      </table>`;
}

/** Camembert (donut) + légende détaillée d'une répartition par catégorie d'infraction. */
function renderInfractionBlock(list: { infraction: string; count: number }[]): string {
  if (list.length === 0) return '<p style="color:#667085;font-size:10px;">Aucune donnée</p>';
  const items = list.map((i, idx) => ({
    label: i.infraction,
    value: i.count,
    color: CHART_COLORS[idx % CHART_COLORS.length],
  }));
  const pie = renderPieChartImg(items, 160, 'pct');
  return `${pie ? `<div style="text-align:center;margin-bottom:8px">${pie}</div>` : renderBarChart(items)}
    ${pie ? renderPieSubstitute(items) : ''}`;
}

/** Sections proposées à la sélection dans le modal d'export. L'ordre est celui
 *  d'apparition dans le PDF. Les sections dont la donnée est absente ne sont de
 *  toute façon pas rendues (le toggle est ANDé avec la présence de données). */
export interface PdfSectionDef { key: string; label: string; }
export const PDF_SECTIONS: PdfSectionDef[] = [
  { key: 'synthese', label: 'Synthèse générale (chiffres clés)' },
  { key: 'suivi', label: 'Suivi parquet extérieur (JIRS / PG)' },
  { key: 'comparatif', label: 'Comparatif année précédente' },
  { key: 'procedures_mois', label: 'Procédures terminées par mois' },
  { key: 'deferements_mois', label: 'Déférements par mois' },
  { key: 'enquetes_encours', label: 'Enquêtes en cours' },
  { key: 'actes', label: "Actes d'enquête (techniques spéciales)" },
  { key: 'services', label: 'Répartition par service' },
  { key: 'orientation', label: 'Orientation des procédures' },
  { key: 'orientation_mois', label: 'Orientation par mois' },
  { key: 'oi_css', label: "Ouvertures d'information & classements" },
  { key: 'condamnations_mois', label: 'Condamnations par mois' },
  { key: 'peines', label: 'Peines & mesures prononcées' },
  { key: 'saisies', label: 'Saisies & confiscations' },
  { key: 'infractions', label: "Répartition par catégorie d'infraction" },
  { key: 'instruction', label: 'Statistiques du module instruction' },
];

export interface PdfExportOptions {
  /** Sections activées (clé → booléen). Absent = tout activé. */
  sections?: Record<string, boolean>;
  /** Remplace le nom du rédacteur en en-tête. */
  redacteur?: string;
  /** Remplace le destinataire (« à destination de … »). */
  destinataire?: string;
}

export function generateStatsPdfHtml(data: PdfExportData, options: PdfExportOptions = {}): string {
  const { selectedYear, audienceStats: stats } = data;
  const totalActes = data.acteStats.ecoutes + data.acteStats.geolocalisations + data.acteStats.autresActes;
  const totalProlongations = data.acteStats.prolongationsEcoutes + data.acteStats.prolongationsGeo + data.acteStats.prolongationsAutres;
  const totalAvecProlongations = totalActes + totalProlongations;
  // Une section est rendue si elle n'a pas été explicitement décochée.
  const on = (k: string): boolean => (options.sections ? options.sections[k] !== false : true);
  const redacteur = options.redacteur || data.redacteur || 'Audran CHEVALIER';
  const destinataire = options.destinataire || 'Procureur de la République';
  const endDate = (selectedYear === new Date().getFullYear() ? new Date() : new Date(selectedYear, 11, 31))
    .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport Statistiques ${selectedYear}</title>
  <style>${CSS_STYLES}</style>
</head>
<body>

<!-- Masthead identitaire -->
<div class="page-header">
  <div class="tricolore"></div>
  <div class="monogram"></div>
  <div class="overline">Tribunal judiciaire d'Amiens &mdash; Parquet d'Amiens</div>
  <h1>Rapport d'activité — ${data.contentieuxLabel || 'Criminalité organisée'}</h1>
  <div class="subtitle">Du 1er janvier ${selectedYear} au ${endDate}</div>
  <div class="chips">
    <span class="chip">Année ${selectedYear}</span>
    <span class="chip">${data.contentieuxLabel || 'Criminalité organisée'}</span>
    <span class="chip alert">Confidentiel — ne pas diffuser</span>
  </div>
</div>

<div class="redige-par">Rédigé par <b>${redacteur}</b>, à destination du ${destinataire}.</div>

${on('synthese') ? `
<div class="kpi-band">
  <div class="kpi">
    <div class="kpi-value">${data.enquetesTerminees}</div>
    <div class="kpi-label">Procédures terminées</div>
    <div class="kpi-sub">Hors classements &amp; OI</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${data.enquetesEnCours}</div>
    <div class="kpi-label">Enquêtes ouvertes</div>
    <div class="kpi-sub">en ${selectedYear}, tous statuts</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${Math.round(data.dureeMoyenneTerminees)}<span class="unit">j</span></div>
    <div class="kpi-label">Durée moy. terminées</div>
    <div class="kpi-sub">De l'ouverture à l'audience</div>
  </div>
  <div class="kpi">
    <div class="kpi-value">${Math.round(data.dureeMoyenneEnCours)}<span class="unit">j</span></div>
    <div class="kpi-label">Durée moy. en cours</div>
    <div class="kpi-sub">Ancienneté moyenne</div>
  </div>
</div>` : ''}

${on('suivi') && data.suivi ? `
<div class="section-nobreak">
  <div class="section-title">Suivi parquet extérieur</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Dossiers suivis</div>
      <div class="card-value">${data.suivi.total}</div>
      <div class="card-detail">${data.suivi.both > 0 ? `dont ${data.suivi.both} par les deux` : 'JIRS et/ou Parquet Général'}</div>
    </div>
    <div class="card">
      <div class="card-label">JIRS</div>
      <div class="card-value">${data.suivi.jirs}</div>
    </div>
    <div class="card">
      <div class="card-label">Parquet Général</div>
      <div class="card-value">${data.suivi.pg}</div>
    </div>
  </div>
</div>
` : ''}

${on('comparatif') && data.comparatif ? `
<div class="section-nobreak">
  <div class="section-title">Comparatif ${data.comparatif.prevYear} / ${selectedYear}</div>
  <table>
    <tr><th>Indicateur</th><th class="text-right">${data.comparatif.prevYear}</th><th class="text-right">${selectedYear}</th><th class="text-right">Évolution</th></tr>
    ${[
      { label: 'Procédures terminées', prev: data.comparatif.prevTotalTerminees, cur: data.comparatif.currentTotalTerminees, money: false },
      { label: 'Condamnations', prev: data.comparatif.prevCondamnations, cur: data.comparatif.currentCondamnations, money: false },
      { label: 'Prison ferme (mois)', prev: data.comparatif.prevPrison, cur: data.comparatif.currentPrison, money: false },
      { label: 'Amendes totales', prev: data.comparatif.prevAmendes, cur: data.comparatif.currentAmendes, money: true },
      { label: 'Déférements', prev: data.comparatif.prevDeferements, cur: data.comparatif.currentDeferements, money: false },
    ].map(r => {
      const diff = r.cur - r.prev;
      const fmt = (v: number) => r.money ? formatCurrency(v) : String(v);
      const diffStr = diff === 0 ? '=' : `${diff > 0 ? '▲ +' : '▼ '}${r.money ? formatCurrency(diff) : diff}`;
      const cls = diff === 0 ? 'flat' : diff > 0 ? 'pos' : 'neg';
      return `<tr><td>${r.label}</td><td class="text-right">${fmt(r.prev)}</td><td class="text-right font-bold">${fmt(r.cur)}</td><td class="text-right ${cls}">${diffStr}</td></tr>`;
    }).join('')}
  </table>
</div>
` : ''}

${on('procedures_mois') ? `
<!-- Procédures terminées par mois : tableau + courbe d'évolution -->
<div class="section-nobreak">
  <div class="section-title">Procédures terminées par mois</div>
  <p class="section-note">Hors classements sans suite et ouvertures d'information</p>
  <div class="two-cols" style="align-items:flex-start">
    <div>
      <table>
        <tr><th>Mois</th><th class="text-right">Nombre</th></tr>
        ${data.proceduremoisData.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
        <tr class="row-total"><td>TOTAL</td><td class="text-right">${data.enquetesTerminees}</td></tr>
      </table>
    </div>
    <div style="padding-top:4px">
      ${renderLineChartImg(data.proceduremoisData.map(d => ({ label: d.mois, value: d.count })), 340, 200, '#16307A')
        || renderMonthTable(data.proceduremoisData, 'Nombre')}
    </div>
  </div>
</div>` : ''}

<!-- Déférements par mois : placé juste sous les procédures terminées -->
${on('deferements_mois') && data.deferementsParMois.some(d => d.count > 0) ? `
<div class="section-nobreak">
  <div class="section-title">Déférements par mois</div>
  <p class="section-note">Déférements rattachés à leur date réelle (date de déférement), toutes enquêtes confondues. Peut différer du « Dont … déférements » de l'orientation, calculé à la date d'audience sur les seuls dossiers jugés dans l'année.</p>
  <div style="text-align:center">
    ${renderLineChartImg(data.deferementsParMois.map(d => ({ label: d.mois, value: d.count })), 680, 220, '#C01427')
      || renderMonthTable(data.deferementsParMois, 'Déférements')}
  </div>
</div>
` : ''}

${on('enquetes_encours') ? `
<!-- Enquêtes en cours -->
<div class="section-nobreak">
  <div class="section-title">Enquêtes en cours</div>
  <div class="two-cols" style="align-items:flex-start">
    <div>
      <div class="card" style="margin-bottom:10px">
        <div class="card-label">Nombre d'enquêtes en cours</div>
        <div class="card-value">${data.enquetesEnCoursTotal}</div>
        <div class="card-detail">enquêtes en cours au total</div>
      </div>
      <div class="card">
        <div class="card-label">Ouvertes depuis le début de l'année ${selectedYear}</div>
        <div class="card-value">${data.enquetesOuvertesAnnee}</div>
        <div class="card-detail">Ouvertures par mois (${selectedYear})</div>
      </div>
    </div>
    <div style="padding-top:4px">
      ${renderColumnChartImg(data.ouverturesParMois.map(d => ({ label: d.mois, value: d.count })), 360, 210, '#2980b9')
        || `<table>
        <tr><th>Mois</th><th class="text-right">Ouvertures</th></tr>
        ${data.ouverturesParMois.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
      </table>`}
    </div>
  </div>
</div>` : ''}

${on('actes') ? `
<!-- Actes d'enquête : techniques spéciales d'enquête -->
<div class="section-nobreak">
  <div class="section-title">Actes d'enquête en préliminaire</div>
  <div class="stat-inline">
    <span class="stat-inline-value">${totalAvecProlongations}</span>
    <span class="stat-inline-note">Nombre total d'actes relatifs aux <b>techniques spéciales d'enquête</b> (écoutes, géolocalisation, sonorisation et autres) autorisés par le procureur ou sollicités auprès du juge des libertés et de la détention.</span>
  </div>
</div>` : ''}

${on('services') ? `
<!-- Répartition par service : enquêtes terminées uniquement -->
<div class="section-nobreak">
  <div class="section-title">Répartition par service</div>
  <p class="section-note">Enquêtes terminées</p>
  ${renderServiceBlock(data.serviceStatsTerminees)}
</div>` : ''}

${on('orientation') ? `
<div class="section-nobreak">
  <div class="section-title">Orientation des procédures</div>
  <p class="section-note">(Soit 1 fois par dossier pour une CI, une OI, une CDD ou un classement. Soit pour chaque prévenu pour une CRPC)</p>
  ${stats ? (() => {
    // Mêmes données et couleurs que le Pie « Orientation » de l'app
    const items = ORIENTATION_DATASETS.map(d => ({
      label: d.label,
      value: (stats[d.key] as number) || 0,
      color: d.color,
    }));
    const pie = renderPieChartImg(items, 185, 'pct');
    return `<div class="two-cols" style="align-items:center">
      <div class="legend-col">
        ${renderPieSubstitute(items)}
        <div style="margin-top:8px;font-size:10px;color:#56565E">Dont ${stats.nombreDeferements} déférement${stats.nombreDeferements > 1 ? 's' : ''}</div>
        <div style="margin-top:4px;font-size:8px;color:#9A9AAF;line-height:1.3">Déférés dans les dossiers jugés en ${selectedYear} (rattachés à la date d'audience). Peut différer de « Déférements par mois », qui les compte à leur date réelle de déférement, toutes enquêtes confondues.</div>
      </div>
      ${pie ? `<div style="text-align:center">${pie}</div>` : ''}
    </div>`;
  })() : '<p>Aucune donnée</p>'}
</div>` : ''}

${on('orientation_mois') ? `
<!-- Orientation par mois : histogramme empilé + tableau détaillé -->
<div class="section-nobreak">
  <div class="section-title">Orientation par mois</div>
  ${(() => {
    const series = [
      { label: 'CRPC', color: '#34495e', values: data.monthlyData.map(m => m.crpc) },
      { label: 'CI', color: '#3498db', values: data.monthlyData.map(m => m.ci) },
      { label: 'COPJ', color: '#2ecc71', values: data.monthlyData.map(m => m.copj) },
      { label: 'OI', color: '#95a5a6', values: data.monthlyData.map(m => m.oi) },
      { label: 'CDD', color: '#E8D0A9', values: data.monthlyData.map(m => m.cdd) },
      { label: 'Classement', color: '#e74c3c', values: data.monthlyData.map(m => m.classement) },
    ];
    const chart = renderStackedColumnChartImg(data.monthlyData.map(m => m.mois), series, 680, 250);
    return chart
      ? `<div style="text-align:center">${chart}</div>${renderLegend(series)}`
      : '';
  })()}
  <table style="margin-top:10px">
    <tr>
      <th>Mois</th>
      <th class="text-center">CRPC</th>
      <th class="text-center">CI</th>
      <th class="text-center">COPJ</th>
      <th class="text-center">OI</th>
      <th class="text-center">CDD</th>
      <th class="text-center">Class.</th>
      <th class="text-center font-bold">Total</th>
    </tr>
    ${data.monthlyData.map(m => {
      const total = m.crpc + m.ci + m.copj + m.oi + m.cdd + m.classement;
      return `<tr>
        <td>${m.mois}</td>
        <td class="text-center">${m.crpc || '-'}</td>
        <td class="text-center">${m.ci || '-'}</td>
        <td class="text-center">${m.copj || '-'}</td>
        <td class="text-center">${m.oi || '-'}</td>
        <td class="text-center">${m.cdd || '-'}</td>
        <td class="text-center">${m.classement || '-'}</td>
        <td class="text-center font-bold">${total || '-'}</td>
      </tr>`;
    }).join('')}
    ${(() => {
      const totals = data.monthlyData.reduce((acc, m) => ({
        crpc: acc.crpc + m.crpc, ci: acc.ci + m.ci, copj: acc.copj + m.copj,
        oi: acc.oi + m.oi, cdd: acc.cdd + m.cdd, classement: acc.classement + m.classement
      }), { crpc: 0, ci: 0, copj: 0, oi: 0, cdd: 0, classement: 0 });
      const grand = totals.crpc + totals.ci + totals.copj + totals.oi + totals.cdd + totals.classement;
      return `<tr class="row-total">
        <td>TOTAL</td>
        <td class="text-center">${totals.crpc}</td>
        <td class="text-center">${totals.ci}</td>
        <td class="text-center">${totals.copj}</td>
        <td class="text-center">${totals.oi}</td>
        <td class="text-center">${totals.cdd}</td>
        <td class="text-center">${totals.classement}</td>
        <td class="text-center">${grand}</td>
      </tr>`;
    })()}
  </table>
</div>` : ''}

<!-- Ouvertures d'information & classements sans suite -->
${on('oi_css') && stats ? (() => {
  const totalOrientations = (stats.nombreCRPC || 0) + (stats.nombreCI || 0) + (stats.nombreCOPJ || 0)
    + (stats.nombreOI || 0) + (stats.nombreCDD || 0) + (stats.nombreClassements || 0);
  const oiPct = totalOrientations > 0 ? ((stats.nombreOI / totalOrientations) * 100).toFixed(1) : '0';
  const clPct = totalOrientations > 0 ? ((stats.nombreClassements / totalOrientations) * 100).toFixed(1) : '0';
  return `<div class="section-nobreak">
  <div class="section-title">Ouvertures d'information &amp; classements sans suite</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Ouvertures d'information</div>
      <div class="card-value">${stats.nombreOI || 0}</div>
      <div class="card-detail">${oiPct}% des orientations${data.ouvertureInfoAgeMoyen > 0 ? ` · âge moyen avant ouverture : ${data.ouvertureInfoAgeMoyen} jours` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Classements sans suite</div>
      <div class="card-value">${stats.nombreClassements || 0}</div>
      <div class="card-detail">${clPct}% des orientations${data.classementAgeMoyen > 0 ? ` · âge moyen avant classement : ${data.classementAgeMoyen} jours` : ''}</div>
    </div>
  </div>
</div>`;
})() : ''}

${on('condamnations_mois') ? `
<!-- Condamnations par mois : histogramme en colonnes -->
<div class="section-nobreak">
  <div class="section-title">Condamnations par mois</div>
  <div style="text-align:center">
    ${renderColumnChartImg(data.monthlyData.map(m => ({ label: m.mois, value: m.condamnations })), 680, 240, '#16307A')
      || renderBarChart(data.monthlyData.map(m => ({ label: m.mois, value: m.condamnations, color: '#16307A' })))}
  </div>
  <div style="margin-top:8px;font-size:10px;color:#667085;text-align:center">
    Total : <b style="color:#16307A">${data.monthlyData.reduce((s, m) => s + m.condamnations, 0)}</b> condamnations sur l'année
  </div>
</div>` : ''}

${on('peines') ? `
<!-- Peines & mesures : chiffres clés uniquement, pas de détail par type de peine -->
<div class="section-nobreak">
  <div class="section-title">Peines &amp; mesures prononcées</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Prison ferme (total)</div>
      <div class="card-value">${stats?.totalPeinePrison || 0} mois</div>
      <div class="card-detail">${formatMoisEnAnnees(stats?.totalPeinePrison || 0)}</div>
    </div>
    <div class="card">
      <div class="card-label">Interdictions de paraître</div>
      <div class="card-value">${(stats && stats.nombreCondamnations > 0) ? ((stats.totalInterdictionsParaitre / stats.nombreCondamnations) * 100).toFixed(1) : '0'}%</div>
      <div class="card-detail">${stats?.totalInterdictionsParaitre || 0} interdiction${(stats?.totalInterdictionsParaitre || 0) > 1 ? 's' : ''} sur ${stats?.nombreCondamnations || 0} condamnation${(stats?.nombreCondamnations || 0) > 1 ? 's' : ''}</div>
    </div>
  </div>
</div>` : ''}

<!-- Saisies vs confiscations : le delta, sans détail superflu -->
${on('saisies') && ((stats?.totalSaisiesArgent || 0) > 0 || (stats?.totalArgent || 0) > 0 || (stats?.totalSaisiesVehicules || 0) > 0 || (stats?.totalVehicules || 0) > 0 || (stats?.totalSaisiesImmeubles || 0) > 0 || (stats?.totalImmeubles || 0) > 0) ? `
<div class="section-nobreak">
  <div class="section-title">Saisies &amp; confiscations</div>
  <table>
    <tr><th>Catégorie</th><th class="text-right">Saisi (enquête)</th><th class="text-right">Confisqué (audience)</th><th class="text-right">Delta</th></tr>
    ${(stats?.totalSaisiesVehicules || 0) > 0 || (stats?.totalVehicules || 0) > 0 ? `<tr><td>Véhicules</td><td class="text-right">${stats?.totalSaisiesVehicules || 0}</td><td class="text-right">${stats?.totalVehicules || 0}</td><td class="text-right">${(stats?.totalSaisiesVehicules || 0) - (stats?.totalVehicules || 0)}</td></tr>` : ''}
    ${(stats?.totalSaisiesImmeubles || 0) > 0 || (stats?.totalImmeubles || 0) > 0 ? `<tr><td>Immeubles</td><td class="text-right">${stats?.totalSaisiesImmeubles || 0}</td><td class="text-right">${stats?.totalImmeubles || 0}</td><td class="text-right">${(stats?.totalSaisiesImmeubles || 0) - (stats?.totalImmeubles || 0)}</td></tr>` : ''}
    <tr class="row-total"><td>Total avoirs</td><td class="text-right">${formatCurrency(stats?.totalSaisiesArgent || 0)}</td><td class="text-right">${formatCurrency(stats?.totalArgent || 0)}</td><td class="text-right">${formatCurrency((stats?.totalSaisiesArgent || 0) - (stats?.totalArgent || 0))}</td></tr>
  </table>
  <p class="section-note" style="font-style:italic;margin-top:8px">Ces données sont en cours de consolidation. Les saisies n'étaient initialement pas renseignées, d'où le delta négatif constaté.</p>
</div>
` : ''}

${on('infractions') ? `
<div class="section">
  <div class="section-title">Répartition par catégorie d'infraction</div>
  <div class="two-cols">
    <div>
      <p class="section-note" style="font-weight:700;color:#16307A">Enquêtes en cours</p>
      ${renderInfractionBlock(data.infractionsEnCours)}
    </div>
    <div>
      <p class="section-note" style="font-weight:700;color:#067647">Enquêtes terminées</p>
      ${renderInfractionBlock(data.infractionsTerminees)}
    </div>
  </div>
</div>` : ''}

${on('instruction') ? (() => {
  const s = data.instructionStats;
  if (!s || s.nbDossiers <= 0) return '';
  const fmtDays = (j: number) => {
    const r = Math.round(j);
    if (r < 60) return `${r} j`;
    return `${Math.round(r / 30)} mois`;
  };
  return `
<div class="section">
  <div class="section-title">Statistiques du module instruction</div>
  <p class="section-note">Photographie du stock actuel des dossiers d'instruction — indépendante de l'année sélectionnée.</p>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Dossiers d'instruction</div>
      <div class="card-value">${s.nbDossiersActifs}</div>
      <div class="card-detail">actifs · ${s.nbDossiersArchives} archivés · ${s.nbDossiers} au total</div>
    </div>
    <div class="card">
      <div class="card-label">Mis en examen</div>
      <div class="card-value">${s.nbMisEnExamen}</div>
      <div class="card-detail">${s.nbDetenus} détenu${s.nbDetenus > 1 ? 's' : ''} · ${s.nbARSE} ARSE · ${s.nbCJ} CJ · ${s.nbLibres} libre${s.nbLibres > 1 ? 's' : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Âge moyen (actifs)</div>
      <div class="card-value">${fmtDays(s.ageMoyenDossiersActifsJours)}</div>
      <div class="card-detail">plus ancien : ${fmtDays(s.ageMaxDossierActifJours)}</div>
    </div>
    <div class="card">
      <div class="card-label">Dossiers à régler (art. 175)</div>
      <div class="card-value">${s.dossiersAReglerTotal}</div>
      <div class="card-detail">dont ${s.dossiersAReglerAvecDetenu} avec détenu</div>
    </div>
  </div>
</div>`;
})() : ''}

<div class="footer">
  <span class="tri"><i style="background:#16307A"></i><i style="background:#ffffff;border:1px solid #D5DAE6"></i><i style="background:#C01427"></i></span>
  <span>Tribunal judiciaire d'Amiens — Parquet d'Amiens · Édité le ${new Date().toLocaleDateString('fr-FR')} · Usage interne, ne pas diffuser</span>
</div>

</body>
</html>`;
}

export async function exportStatsPdf(data: PdfExportData, options: PdfExportOptions = {}): Promise<void> {
  const html = generateStatsPdfHtml(data, options);
  await exportHtmlToPdf(html, {
    filename: `Rapport_activite_${data.selectedYear}.pdf`,
    footerLabel: `Rapport d'activité ${data.selectedYear}`,
  });
}

export type { PdfExportData };
