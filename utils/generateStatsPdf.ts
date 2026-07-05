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
import { getServiceColor, ORIENTATION_DATASETS } from '@/utils/chartColors';

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

// Charte « Lumière » — palette Justice (DSFR) : Bleu France #000091, bleu nuit
// #111139, bleu pâle #E3E3FD, rouge Marianne #E1000F réservé à l'alerte, vert
// succès #18753C. Mêmes codes que docs/presentation/maquettes-v2. Couleurs en
// dur (pas de var() ni de police web) pour un rendu html2canvas déterministe.
const CSS_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11px;
    color: #161616;
    line-height: 1.45;
    padding: 0;
    max-width: 100%;
    overflow-x: hidden;
  }

  .page-header {
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, #111139 0%, #1B1B6E 70%, #000091 100%);
    border-radius: 10px;
    color: #fff;
    padding: 16px 20px 14px 26px;
    margin-bottom: 16px;
  }
  .page-header .tricolore {
    position: absolute; left: 0; top: 0; bottom: 0; width: 6px;
    background: linear-gradient(to bottom, #000091 33%, #ffffff 33% 66%, #E1000F 66%);
  }
  .page-header .overline {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #A1A1F8;
    margin-bottom: 5px;
  }
  .page-header h1 {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 3px;
  }
  .page-header .subtitle {
    font-size: 10px;
    color: rgba(255,255,255,0.75);
  }

  .redige-par {
    font-size: 10.5px;
    font-style: italic;
    color: #56565E;
    margin: -6px 0 16px 2px;
  }

  .section {
    background: #fff;
    border: 1px solid #E5E5E5;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  .section-nobreak {
    background: #fff;
    border: 1px solid #E5E5E5;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 14px;
    page-break-inside: avoid;
  }
  .section-title {
    font-size: 12.5px;
    font-weight: 700;
    color: #111139;
    padding-bottom: 6px;
    border-bottom: 1px solid #E5E5E5;
    margin-bottom: 10px;
  }

  .cards-row {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .card {
    flex: 1;
    min-width: 140px;
    background: #FAFAFC;
    border: 1px solid #E5E5E5;
    border-radius: 8px;
    padding: 9px 12px;
  }
  .card-label {
    font-size: 8.5px;
    color: #56565E;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .card-value {
    font-size: 21px;
    font-weight: bold;
    color: #000091;
  }
  .card-detail {
    font-size: 9px;
    color: #56565E;
    margin-top: 2px;
  }

  /* Statistique mise en avant : un grand chiffre + une note sur la même ligne */
  .stat-inline {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #FAFAFC;
    border: 1px solid #E5E5E5;
    border-radius: 8px;
    padding: 10px 14px;
  }
  .stat-inline-value {
    font-size: 30px;
    font-weight: bold;
    color: #000091;
    line-height: 1;
    flex-shrink: 0;
  }
  .stat-inline-note {
    font-size: 10px;
    color: #56565E;
    line-height: 1.45;
  }
  .stat-inline-note b { color: #161616; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-bottom: 8px;
    table-layout: fixed;
    word-wrap: break-word;
  }
  th {
    background: #F5F5FE;
    color: #111139;
    padding: 5px 8px;
    text-align: left;
    font-weight: 700;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border-bottom: 2px solid #000091;
  }
  td {
    padding: 4.5px 8px;
    border-bottom: 1px solid #EEEEF0;
  }
  tr:nth-child(even) { background: #FAFAFC; }
  tr:last-child td { border-bottom: none; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .font-bold { font-weight: bold; }

  .two-cols {
    display: flex;
    gap: 16px;
  }
  .two-cols > div { flex: 1; }

  .bar-container {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
  }
  .bar-label {
    width: 135px;
    font-size: 9px;
    text-align: right;
    line-height: 1.15;
    word-break: break-word;
  }
  .bar-track {
    flex: 1;
    height: 16px;
    background: #EEEEF4;
    border-radius: 3px;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 3px;
    display: flex;
    align-items: center;
    padding-left: 4px;
    font-size: 8px;
    color: white;
    font-weight: bold;
    min-width: 2px;
  }
  .bar-value {
    width: 30px;
    font-size: 10px;
    font-weight: bold;
  }

  .page-break { page-break-before: always; }

  .footer {
    text-align: center;
    font-size: 8px;
    color: #92929C;
    padding: 15px 5px 5px;
    margin-top: 30px;
    border-top: 1px solid #E5E5E5;
  }

  @page {
    size: A4 portrait;
    margin: 10mm;
  }
  @media print {
    body { padding: 0; }
    .page-break { page-break-before: always; }
    .section-nobreak { page-break-inside: avoid; }
  }

  .legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin: 6px 0;
    font-size: 9px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }

  .pie-substitute {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pie-item {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #F5F5FE;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #E5E5E5;
  }
  .pie-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pie-label { font-size: 10px; }
  .pie-value { font-weight: bold; font-size: 11px; margin-left: auto; }
  .pie-pct { font-size: 9px; color: #56565E; margin-left: 4px; }

  /* Légende verticale à gauche d'un camembert (rendu identique à l'app) */
  .legend-col .pie-substitute { flex-direction: column; }
  .svc-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: middle;
  }
`;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatMoisEnAnnees(mois: number): string {
  const annees = Math.floor(mois / 12);
  const rest = mois % 12;
  if (annees > 0 && rest > 0) return `${annees} an${annees > 1 ? 's' : ''} et ${rest} mois`;
  if (annees > 0) return `${annees} an${annees > 1 ? 's' : ''}`;
  return `${mois} mois`;
}

function renderPieSubstitute(items: { label: string; value: number; color: string }[]): string {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return '<p style="color:#56565E;">Aucune donnée</p>';
  return `<div class="pie-substitute">${items.filter(i => i.value > 0).map(item => {
    const pct = ((item.value / total) * 100).toFixed(1);
    return `<div class="pie-item">
      <span class="pie-dot" style="background:${item.color}"></span>
      <span class="pie-label">${item.label}</span>
      <span class="pie-value">${item.value}</span>
      <span class="pie-pct">(${pct}%)</span>
    </div>`;
  }).join('')}</div>`;
}

/**
 * Dessine un camembert sur un canvas hors-écran et le retourne en <img>.
 * Reproduit le rendu des Pie Chart.js de l'app : tranches bordées de blanc,
 * étiquettes blanches en gras au centre des tranches (plugin datalabels) —
 * `pct` : pourcentage seul, masqué sous 5 % (carte Orientation) ;
 * `valuePct` : valeur + pourcentage, masqués sous 2 occurrences (services).
 * Retourne '' hors navigateur (SSR/tests) — la légende reste affichée.
 */
function renderPieChartImg(
  items: { label: string; value: number; color: string }[],
  displaySize: number,
  labelMode: 'pct' | 'valuePct'
): string {
  const data = items.filter(i => i.value > 0);
  const total = data.reduce((s, i) => s + i.value, 0);
  if (total === 0 || typeof document === 'undefined') return '';

  const ratio = 2; // sur-échantillonnage pour rester net après rasterisation
  const size = displaySize * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2 * ratio;

  let angle = -Math.PI / 2;
  for (const item of data) {
    const slice = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * ratio;
    ctx.stroke();
    angle += slice;
  }

  angle = -Math.PI / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${11 * ratio}px 'Segoe UI', Arial, sans-serif`;
  for (const item of data) {
    const slice = (item.value / total) * Math.PI * 2;
    const mid = angle + slice / 2;
    const pct = (item.value / total) * 100;
    const lx = cx + Math.cos(mid) * r * 0.62;
    const ly = cy + Math.sin(mid) * r * 0.62;
    if (labelMode === 'pct') {
      if (pct >= 5) ctx.fillText(`${pct.toFixed(0)}%`, lx, ly);
    } else if (item.value >= 2) {
      ctx.fillText(`${item.value}`, lx, ly - 7 * ratio);
      ctx.fillText(`${pct.toFixed(0)}%`, lx, ly + 7 * ratio);
    }
    angle += slice;
  }

  return `<img src="${canvas.toDataURL('image/png')}" width="${displaySize}" height="${displaySize}" style="width:${displaySize}px;height:${displaySize}px">`;
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

function renderBarChart(items: { label: string; value: number; color?: string }[]): string {
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(item => {
    const width = Math.max(2, (item.value / max) * 100);
    const color = item.color || '#000091';
    return `<div class="bar-container">
      <div class="bar-label">${item.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${width}%;background:${color}">${item.value > 0 ? item.value : ''}</div>
      </div>
      <div class="bar-value">${item.value}</div>
    </div>`;
  }).join('');
}

/**
 * Dessine une courbe d'évolution mensuelle sur un canvas hors-écran et la
 * retourne en <img> (reproduit l'esprit des graphes « Line » de l'app).
 * Retourne '' hors navigateur (SSR/tests) — un tableau de repli est affiché.
 */
function renderLineChartImg(
  points: { label: string; value: number }[],
  displayWidth: number,
  displayHeight: number,
  color: string
): string {
  if (points.length === 0 || typeof document === 'undefined') return '';

  const ratio = 2;
  const w = displayWidth * ratio;
  const h = displayHeight * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const padL = 26 * ratio, padR = 12 * ratio, padT = 14 * ratio, padB = 22 * ratio;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxVal = Math.max(...points.map(p => p.value), 1);
  const niceMax = Math.max(5, Math.ceil(maxVal / 5) * 5);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Lignes horizontales + graduations Y
  const ySteps = 5;
  ctx.strokeStyle = '#EEEEF0';
  ctx.lineWidth = 1 * ratio;
  ctx.fillStyle = '#92929C';
  ctx.font = `${8 * ratio}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= ySteps; i++) {
    const y = padT + plotH - (plotH * i) / ySteps;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round((niceMax / ySteps) * i)), padL - 4 * ratio, y);
  }

  const n = points.length;
  const xFor = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const yFor = (v: number) => padT + plotH - (plotH * v) / niceMax;

  // Courbe
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * ratio;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Points
  ctx.fillStyle = color;
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xFor(i), yFor(p.value), 3 * ratio, 0, Math.PI * 2);
    ctx.fill();
  });

  // Valeurs au-dessus des points
  ctx.fillStyle = '#161616';
  ctx.font = `bold ${8 * ratio}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  points.forEach((p, i) => {
    if (p.value > 0) ctx.fillText(String(p.value), xFor(i), yFor(p.value) - 4 * ratio);
  });

  // Étiquettes de mois
  ctx.fillStyle = '#92929C';
  ctx.font = `${8 * ratio}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  points.forEach((p, i) => {
    ctx.fillText(p.label.slice(0, 3), xFor(i), padT + plotH + 4 * ratio);
  });

  return `<img src="${canvas.toDataURL('image/png')}" width="${displayWidth}" height="${displayHeight}" style="width:${displayWidth}px;height:${displayHeight}px">`;
}

/** Petit tableau Mois/Valeur, utilisé en repli quand le canvas est indisponible. */
function renderMonthTable(points: { mois: string; count: number }[], header: string): string {
  return `<table>
    <tr><th>Mois</th><th class="text-right">${header}</th></tr>
    ${points.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
  </table>`;
}

export function generateStatsPdfHtml(data: PdfExportData): string {
  const { selectedYear, audienceStats: stats } = data;
  const totalActes = data.acteStats.ecoutes + data.acteStats.geolocalisations + data.acteStats.autresActes;
  const totalProlongations = data.acteStats.prolongationsEcoutes + data.acteStats.prolongationsGeo + data.acteStats.prolongationsAutres;
  const totalAvecProlongations = totalActes + totalProlongations;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport Statistiques ${selectedYear}</title>
  <style>${CSS_STYLES}</style>
</head>
<body>

<!-- En-tête identitaire -->
<div class="page-header">
  <div class="tricolore"></div>
  <div class="overline">Tribunal judiciaire d'Amiens &mdash; Parquet d'Amiens</div>
  <h1>${data.contentieuxLabel || 'Criminalité organisée'}</h1>
  <div class="subtitle">Année ${selectedYear} — du 1er janvier ${selectedYear} au ${(selectedYear === new Date().getFullYear() ? new Date() : new Date(selectedYear, 11, 31)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · Document interne, ne pas diffuser</div>
</div>

<div class="redige-par">Rédigé par ${data.redacteur || 'Audran CHEVALIER'}, à destination du Procureur de la République</div>

<div class="section-nobreak">
  <div class="section-title">Synthèse générale</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Total des procédures terminées</div>
      <div class="card-value">${data.enquetesTerminees}</div>
      <div class="card-detail">Hors classements sans suite et ouvertures d'information</div>
    </div>
    <div class="card">
      <div class="card-label">Enquêtes en cours</div>
      <div class="card-value">${data.enquetesEnCours}</div>
    </div>
    <div class="card">
      <div class="card-label">Durée moy. terminées</div>
      <div class="card-value">${Math.round(data.dureeMoyenneTerminees)}j</div>
    </div>
    <div class="card">
      <div class="card-label">Durée moy. en cours</div>
      <div class="card-value">${Math.round(data.dureeMoyenneEnCours)}j</div>
    </div>
  </div>
</div>

${data.suivi ? `
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

${data.comparatif ? `
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
      const diffStr = diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${r.money ? formatCurrency(diff) : diff}`;
      const color = diff === 0 ? '#56565E' : diff > 0 ? '#18753C' : '#E1000F';
      return `<tr><td>${r.label}</td><td class="text-right">${fmt(r.prev)}</td><td class="text-right font-bold">${fmt(r.cur)}</td><td class="text-right" style="color:${color};font-weight:bold">${diffStr}</td></tr>`;
    }).join('')}
  </table>
</div>
` : ''}

<!-- Procédures terminées par mois : tableau + courbe d'évolution -->
<div class="section-nobreak">
  <div class="section-title">Procédures terminées par mois</div>
  <p style="font-size:9px;color:#56565E;margin-bottom:8px">Hors classements sans suite et ouvertures d'information</p>
  <div class="two-cols" style="align-items:flex-start">
    <div>
      <table>
        <tr><th>Mois</th><th class="text-right">Nombre</th></tr>
        ${data.proceduremoisData.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
        <tr style="background:#E3E3FD;font-weight:bold"><td>TOTAL</td><td class="text-right">${data.enquetesTerminees}</td></tr>
      </table>
    </div>
    <div style="padding-top:4px">
      ${renderLineChartImg(data.proceduremoisData.map(d => ({ label: d.mois, value: d.count })), 340, 200, '#000091')
        || renderMonthTable(data.proceduremoisData, 'Nombre')}
    </div>
  </div>
</div>

<!-- Déférements par mois : placé juste sous les procédures terminées -->
${data.deferementsParMois.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Déférements par mois</div>
  <p style="font-size:9px;color:#56565E;margin-bottom:8px">Déférements rattachés à leur date réelle (date de déférement), toutes enquêtes confondues. Peut différer du « Dont … déférements » de l'orientation, calculé à la date d'audience sur les seuls dossiers jugés dans l'année.</p>
  <div style="text-align:center">
    ${renderLineChartImg(data.deferementsParMois.map(d => ({ label: d.mois, value: d.count })), 680, 220, '#E1000F')
      || renderMonthTable(data.deferementsParMois, 'Déférements')}
  </div>
</div>
` : ''}

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
    <div>
      <table>
        <tr><th>Mois</th><th class="text-right">Ouvertures</th></tr>
        ${data.ouverturesParMois.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
      </table>
    </div>
  </div>
</div>

<!-- Actes d'enquête : techniques spéciales d'enquête -->
<div class="section-nobreak">
  <div class="section-title">Actes d'enquête en préliminaire</div>
  <div class="stat-inline">
    <span class="stat-inline-value">${totalAvecProlongations}</span>
    <span class="stat-inline-note">Nombre total d'actes relatifs aux <b>techniques spéciales d'enquête</b> (écoutes, géolocalisation, sonorisation et autres) autorisés par le procureur ou sollicités auprès du juge des libertés et de la détention.</span>
  </div>
</div>

<!-- Répartition par service : enquêtes terminées uniquement -->
<div class="section-nobreak">
  <div class="section-title">Répartition par service</div>
  <h4 style="font-size:11px;margin-bottom:6px;color:#56565E">Enquêtes terminées</h4>
  ${renderServiceBlock(data.serviceStatsTerminees)}
</div>

<div class="section-nobreak">
  <div class="section-title">Orientation des procédures</div>
  <p style="font-size:9px;color:#56565E;margin-bottom:8px">(Soit 1 fois par dossier pour une CI, une OI, une CDD ou un classement. Soit pour chaque prévenu pour une CRPC)</p>
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
</div>

<!-- Orientation par mois -->
<div class="section-nobreak">
  <div class="section-title">Orientation par mois</div>
  <table>
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
      return `<tr style="background:#E3E3FD;font-weight:bold">
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
</div>

<!-- Ouvertures d'information & classements sans suite -->
${stats ? (() => {
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

<!-- Condamnations par mois : un seul graphe, le nombre de condamnations -->
<div class="section-nobreak">
  <div class="section-title">Condamnations par mois</div>
  ${renderBarChart(data.monthlyData.map(m => ({ label: m.mois, value: m.condamnations, color: '#000091' })))}
  <div style="margin-top:8px;font-size:10px;color:#56565E">
    Total : <b style="color:#000091">${data.monthlyData.reduce((s, m) => s + m.condamnations, 0)}</b> condamnations sur l'année
  </div>
</div>

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
</div>

<!-- Saisies vs confiscations : le delta, sans détail superflu -->
${(stats?.totalSaisiesArgent || 0) > 0 || (stats?.totalArgent || 0) > 0 || (stats?.totalSaisiesVehicules || 0) > 0 || (stats?.totalVehicules || 0) > 0 || (stats?.totalSaisiesImmeubles || 0) > 0 || (stats?.totalImmeubles || 0) > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Saisies &amp; confiscations</div>
  <table>
    <tr><th>Catégorie</th><th class="text-right">Saisi (enquête)</th><th class="text-right">Confisqué (audience)</th><th class="text-right">Delta</th></tr>
    ${(stats?.totalSaisiesVehicules || 0) > 0 || (stats?.totalVehicules || 0) > 0 ? `<tr><td>Véhicules</td><td class="text-right">${stats?.totalSaisiesVehicules || 0}</td><td class="text-right">${stats?.totalVehicules || 0}</td><td class="text-right">${(stats?.totalSaisiesVehicules || 0) - (stats?.totalVehicules || 0)}</td></tr>` : ''}
    ${(stats?.totalSaisiesImmeubles || 0) > 0 || (stats?.totalImmeubles || 0) > 0 ? `<tr><td>Immeubles</td><td class="text-right">${stats?.totalSaisiesImmeubles || 0}</td><td class="text-right">${stats?.totalImmeubles || 0}</td><td class="text-right">${(stats?.totalSaisiesImmeubles || 0) - (stats?.totalImmeubles || 0)}</td></tr>` : ''}
    <tr style="background:#E3E3FD;font-weight:bold"><td>Total avoirs</td><td class="text-right">${formatCurrency(stats?.totalSaisiesArgent || 0)}</td><td class="text-right">${formatCurrency(stats?.totalArgent || 0)}</td><td class="text-right">${formatCurrency((stats?.totalSaisiesArgent || 0) - (stats?.totalArgent || 0))}</td></tr>
  </table>
  <p style="font-size:9px;color:#56565E;margin-top:8px;font-style:italic">Ces données sont en cours de consolidation. Les saisies n'étaient initialement pas renseignées, d'où le delta négatif constaté.</p>
</div>
` : ''}

<div class="section">
  <div class="section-title">Répartition par catégorie d'infraction</div>
  <div class="two-cols">
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#56565E">Enquêtes en cours</h4>
      ${data.infractionsEnCours.length > 0
        ? renderBarChart(data.infractionsEnCours.map(i => ({ label: i.infraction, value: i.count, color: '#000091' })))
        : '<p style="color:#56565E;font-size:10px;">Aucune donnée</p>'}
    </div>
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#56565E">Enquêtes terminées</h4>
      ${data.infractionsTerminees.length > 0
        ? renderBarChart(data.infractionsTerminees.map(i => ({ label: i.infraction, value: i.count, color: '#18753C' })))
        : '<p style="color:#56565E;font-size:10px;">Aucune donnée</p>'}
    </div>
  </div>
</div>

${(() => {
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
})()}

<div class="footer">
  Tribunal judiciaire d'Amiens — Parquet d'Amiens · en date du ${new Date().toLocaleDateString('fr-FR')} · Usage interne, ne pas diffuser
</div>

</body>
</html>`;
}

export async function exportStatsPdf(data: PdfExportData): Promise<void> {
  const html = generateStatsPdfHtml(data);

  // IMPORTANT : html2pdf clone l'élément qu'on lui passe AVEC ses styles inline,
  // puis le rend via html2canvas. Il ne faut donc surtout pas de opacity:0,
  // visibility:hidden ou position:fixed sur cet élément : le clone les hériterait
  // et le PDF sortirait blanc. On masque via un wrapper hors-écran (la même
  // technique que l'overlay interne de html2pdf), et on passe à html2pdf un
  // élément interne "propre" sans style de masquage.
  // html2pdf déduit la largeur de l'image des pixels du canvas (96dpi), pas de la
  // largeur de page : avec des marges horizontales il décale et rogne un bord.
  // On neutralise ça en rendant le contenu sur TOUTE la largeur A4 (794px ≈ 210mm
  // à 96dpi) → image pleine page, marges html2pdf horizontales à 0 (voir opt).
  // Les marges latérales sont intégrées au contenu via le padding du conteneur.
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '0',
    left: '-10000px',
    width: '794px',
    pointerEvents: 'none',
  });

  const container = document.createElement('div');
  Object.assign(container.style, {
    width: '794px',
    padding: '0 24px', // marge latérale intégrée (box-sizing: border-box)
    background: '#ffffff',
  });

  container.innerHTML = html
    .replace(/<!DOCTYPE html>[\s\S]*?<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*$/, '');

  // Injecter les styles
  const styleEl = document.createElement('style');
  styleEl.textContent = CSS_STYLES;
  container.prepend(styleEl);

  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  try {
    const html2pdf = (await import('html2pdf.js')).default;

    const opt = {
      // Marges horizontales à 0 (intégrées au contenu) ; verticales à 10mm.
      margin: [10, 0, 10, 0],
      filename: `Rapport_activite_${data.selectedYear}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        scrollX: 0,
        scrollY: 0,
        windowWidth: 794,
        logging: false,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
      },
      pagebreak: {
        mode: ['css', 'legacy'],
        before: '.page-break',
        avoid: '.section-nobreak',
      },
    };

    // Numérotation des pages : on intercepte le jsPDF produit avant le .save()
    // (le contenu étant rasterisé par html2canvas, impossible de numéroter en CSS).
    await html2pdf().set(opt).from(container).toPdf().get('pdf').then((pdf: any) => {
      const totalPages = pdf.internal.getNumberOfPages();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setTextColor(146, 146, 156);
        pdf.text(
          `Rapport d'activité ${data.selectedYear} — page ${i}/${totalPages}`,
          pageWidth / 2,
          pageHeight - 4,
          { align: 'center' }
        );
      }
    }).save();
  } finally {
    document.body.removeChild(wrapper);
  }
}

export type { PdfExportData };
