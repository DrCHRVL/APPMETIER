/**
 * Primitives de rendu partagées pour les rapports PDF de l'application
 * (statistiques audiences et statistiques AIR/AEM).
 *
 * Ce module regroupe :
 *  - la charte graphique « Prestige » (CSS_STYLES) ;
 *  - les graphiques rasterisés sur canvas hors-écran (camemberts, courbes,
 *    histogrammes simples et empilés) — html2canvas capture les <img> produits
 *    de façon fiable, contrairement aux SVG Recharts de l'écran ;
 *  - la fonction générique exportHtmlToPdf() qui transforme un document HTML en
 *    fichier PDF paginé (A4 portrait), avec numérotation des pages.
 *
 * Extrait de utils/generateStatsPdf.ts pour être réutilisé sans duplication par
 * les différents générateurs de rapport.
 */

// Charte « Prestige ». Registre institutionnel sobre, inspiré des documents
// officiels du ministère : fond clair, filet tricolore, titres en romain
// (Georgia), texte en linéale, aplats de couleur réduits au minimum. Palette :
// bleu nuit #0C1740 (titres), Bleu France #16307A (accent), rouge #C01427 et
// vert #067647 pour les signaux, gris #667085 (texte secondaire), filets
// #E2E6F0. Les corps de texte sont calibrés pour l'impression A4 (le document
// est rendu sur 794 px de large, soit 210 mm à 96 ppp : 1 px ≈ 0,75 pt).
// Couleurs en dur et polices système uniquement : le rendu passe par
// html2canvas (rasterisation), donc pas de var() ni de police web.
export const CSS_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 12px;
    color: #1A1C2A;
    line-height: 1.5;
    padding: 0;
    max-width: 100%;
    overflow-x: hidden;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Masthead (en-tête institutionnel) ────────────────────── */
  .page-header {
    position: relative;
    overflow: hidden;
    background: #FFFFFF;
    border: 1px solid #E2E6F0;
    border-radius: 3px;
    color: #1A1C2A;
    text-align: center;
    padding: 26px 30px 22px;
    margin-bottom: 20px;
  }
  /* Filet tricolore en tête de bloc (bleu | blanc | rouge). */
  .page-header .tricolore {
    position: absolute; left: 0; right: 0; top: 0; height: 4px;
    background: linear-gradient(to right, #16307A 0 33.34%, #F4F6FC 33.34% 66.67%, #C01427 66.67% 100%);
  }
  .page-header .overline {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 2.2px;
    text-transform: uppercase;
    color: #5A6480;
    margin-bottom: 10px;
  }
  .page-header h1 {
    font-family: Georgia, 'Times New Roman', Cambria, serif;
    font-size: 27px;
    font-weight: 400;
    letter-spacing: -0.2px;
    color: #0C1740;
    margin-bottom: 10px;
  }
  /* Filet court sous le titre, en rappel de l'accent Bleu France. */
  .page-header .rule {
    width: 54px; height: 2px; background: #16307A;
    margin: 0 auto 10px;
  }
  .page-header .subtitle {
    font-size: 11.5px;
    color: #667085;
  }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; justify-content: center; }
  .chip {
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.7px;
    text-transform: uppercase;
    color: #16307A;
    background: #F4F6FC;
    border: 1px solid #DCE3F5;
    border-radius: 3px;
    padding: 4px 12px;
  }
  .chip.alert { color: #B42318; background: #FEF3F2; border-color: #FBD5D2; }

  .redige-par {
    font-size: 11px;
    color: #667085;
    text-align: center;
    margin: 0 0 20px;
  }
  .redige-par b { color: #16307A; font-weight: 600; }

  /* ── Bandeau KPI (chiffres clés) ──────────────────────────── */
  .kpi-band {
    display: flex;
    gap: 12px;
    margin-bottom: 18px;
  }
  .kpi {
    flex: 1;
    background: #fff;
    border: 1px solid #E2E6F0;
    border-top: 2px solid #16307A;
    border-radius: 3px;
    padding: 14px 15px 13px;
  }
  .kpi-value { font-size: 30px; font-weight: 600; color: #0C1740; line-height: 1.05; letter-spacing: -0.4px; }
  .kpi-value .unit { font-size: 15px; font-weight: 400; color: #667085; margin-left: 2px; }
  .kpi-label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #16307A; margin-top: 5px; }
  .kpi-sub { font-size: 9.5px; color: #667085; margin-top: 3px; line-height: 1.35; }
  .kpi.pos { border-top-color: #067647; }
  .kpi.pos .kpi-value, .kpi.pos .kpi-label { color: #067647; }
  .kpi.neg { border-top-color: #C01427; }
  .kpi.neg .kpi-value, .kpi.neg .kpi-label { color: #C01427; }

  /* ── Sections ─────────────────────────────────────────────── */
  .section, .section-nobreak {
    background: #fff;
    border: 1px solid #E2E6F0;
    border-radius: 3px;
    padding: 15px 17px 16px;
    margin-bottom: 14px;
  }
  .section-nobreak { page-break-inside: avoid; }
  .section-title {
    font-family: Georgia, 'Times New Roman', Cambria, serif;
    font-size: 15px;
    font-weight: 400;
    color: #0C1740;
    letter-spacing: 0.1px;
    padding: 0 0 8px 0;
    border-bottom: 1px solid #E2E6F0;
    box-shadow: inset 0 -1px 0 0 #ffffff;
    margin-bottom: 12px;
    line-height: 1.25;
  }
  .section-note { font-size: 10px; color: #7A8296; margin: -4px 0 10px; line-height: 1.45; }

  .cards-row { display: flex; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
  .card {
    flex: 1;
    min-width: 145px;
    background: #F8F9FC;
    border: 1px solid #E6E9F2;
    border-radius: 3px;
    padding: 12px 14px;
  }
  .card-label {
    font-size: 9px; color: #667085;
    text-transform: uppercase; letter-spacing: 0.7px;
    font-weight: 700; margin-bottom: 5px;
  }
  .card-value { font-size: 24px; font-weight: 600; color: #16307A; line-height: 1.1; letter-spacing: -0.3px; }
  .card-detail { font-size: 9.5px; color: #667085; margin-top: 4px; line-height: 1.4; }
  .card.warn { background: #FFF7ED; border-color: #FDDCAB; }
  .card.warn .card-value { color: #B54708; }
  .card.danger { background: #FEF3F2; border-color: #FDA29B; }
  .card.danger .card-value { color: #B42318; }
  .card.ok { background: #ECFDF3; border-color: #A6F4C5; }
  .card.ok .card-value { color: #067647; }

  .stat-inline {
    display: flex; align-items: center; gap: 18px;
    background: #F8F9FC;
    border: 1px solid #E6E9F2;
    border-left: 2px solid #16307A;
    border-radius: 3px;
    padding: 14px 17px;
  }
  .stat-inline-value { font-size: 34px; font-weight: 600; color: #16307A; line-height: 1; flex-shrink: 0; letter-spacing: -0.5px; }
  .stat-inline-note { font-size: 11px; color: #667085; line-height: 1.5; }
  .stat-inline-note b { color: #1A1C2A; font-weight: 600; }

  /* ── Tableaux ─────────────────────────────────────────────── */
  table {
    width: 100%; border-collapse: collapse;
    font-size: 11.5px; margin-bottom: 4px;
    table-layout: fixed; word-wrap: break-word;
  }
  th {
    background: #F4F6FC; color: #0C1740;
    padding: 7px 10px; text-align: left;
    font-weight: 700; font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.6px;
    border-bottom: 1.5px solid #16307A;
  }
  td { padding: 6.5px 10px; border-bottom: 1px solid #EEF0F6; }
  tr:nth-child(even) td { background: #FBFCFE; }
  tr:last-child td { border-bottom: none; }
  /* Précision de périmètre sous un intitulé de colonne (ex. « année complète »). */
  .th-note {
    display: block; margin-top: 2px;
    font-size: 8.5px; font-weight: 400; letter-spacing: 0;
    text-transform: none; color: #667085;
  }
  .row-total td { background: #EAF0FE !important; font-weight: 700; color: #0C1740; border-top: 1.5px solid #C9D6F5; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .font-bold { font-weight: 600; }
  .pos { color: #067647; font-weight: 600; }
  .neg { color: #C01427; font-weight: 600; }
  .flat { color: #667085; }

  .badge {
    display: inline-block; font-size: 8.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.4px;
    padding: 2px 7px; border-radius: 3px; margin-left: 4px;
    vertical-align: middle;
  }
  .badge.warn { background: #FEF0C7; color: #B54708; }
  .badge.ok { background: #DCFAE6; color: #067647; }

  .two-cols { display: flex; gap: 18px; }
  .two-cols > div { flex: 1; }

  /* ── Barres ───────────────────────────────────────────────── */
  .bar-container { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .bar-label { width: 140px; font-size: 10px; text-align: right; line-height: 1.2; word-break: break-word; color: #475069; }
  .bar-track { flex: 1; height: 16px; background: #EEF1F8; border-radius: 3px; overflow: hidden; }
  .bar-fill {
    height: 100%; border-radius: 3px;
    display: flex; align-items: center; padding-left: 7px;
    font-size: 9px; color: white; font-weight: 700; min-width: 3px;
  }
  .bar-value { width: 32px; font-size: 11px; font-weight: 700; color: #0C1740; }

  .page-break { page-break-before: always; }

  /* ── Encarts d'alerte (signaux) ───────────────────────────── */
  .alert-box {
    border: 1px solid #E2E6F0; border-left-width: 2px;
    border-radius: 3px; padding: 10px 13px; margin-bottom: 8px;
  }
  .alert-box .a-title { font-size: 11px; font-weight: 700; margin-bottom: 3px; }
  .alert-box .a-msg { font-size: 10px; color: #475069; line-height: 1.45; }
  .alert-box.danger { border-left-color: #C01427; background: #FEF3F2; }
  .alert-box.danger .a-title { color: #B42318; }
  .alert-box.warning { border-left-color: #F79009; background: #FFFAEB; }
  .alert-box.warning .a-title { color: #B54708; }
  .alert-box.success { border-left-color: #067647; background: #ECFDF3; }
  .alert-box.success .a-title { color: #067647; }
  .alert-box.info { border-left-color: #2980b9; background: #EFF8FF; }
  .alert-box.info .a-title { color: #175CD3; }

  .footer {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    text-align: center; font-size: 9px; color: #8B93A7;
    padding: 14px 5px 5px; margin-top: 24px;
    border-top: 1px solid #E2E6F0;
  }
  .footer .tri { display: inline-flex; gap: 2px; }
  .footer .tri i { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }

  @page { size: A4 portrait; margin: 10mm; }
  @media print {
    body { padding: 0; }
    .page-break { page-break-before: always; }
    .section-nobreak { page-break-inside: avoid; }
  }

  .legend { display: flex; gap: 13px; flex-wrap: wrap; margin: 6px 0; font-size: 10px; justify-content: center; }
  .legend-item { display: flex; align-items: center; gap: 5px; }
  .legend-dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

  .pie-substitute { display: flex; flex-wrap: wrap; gap: 6px; }
  .pie-item {
    display: flex; align-items: center; gap: 7px;
    background: #F8F9FC; padding: 5px 12px;
    border-radius: 3px; border: 1px solid #E6E9F2;
  }
  .pie-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pie-label { font-size: 11px; }
  .pie-value { font-weight: 700; font-size: 12px; margin-left: auto; }
  .pie-pct { font-size: 10px; color: #667085; margin-left: 4px; }

  /* Légende verticale à gauche d'un camembert (rendu identique à l'app) */
  .legend-col .pie-substitute { flex-direction: column; }
  .svc-dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
  }
`;

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

export function formatMoisEnAnnees(mois: number): string {
  const annees = Math.floor(mois / 12);
  const rest = mois % 12;
  if (annees > 0 && rest > 0) return `${annees} an${annees > 1 ? 's' : ''} et ${rest} mois`;
  if (annees > 0) return `${annees} an${annees > 1 ? 's' : ''}`;
  return `${mois} mois`;
}

/** Abréviation de mois non ambiguë (juin/juillet ne doivent pas se confondre). */
export function shortMonth(label: string): string {
  const map: Record<string, string> = {
    janvier: 'janv', 'février': 'févr', fevrier: 'févr', mars: 'mars', avril: 'avr',
    mai: 'mai', juin: 'juin', juillet: 'juil', 'août': 'août', aout: 'août',
    septembre: 'sept', octobre: 'oct', novembre: 'nov', 'décembre': 'déc', decembre: 'déc',
  };
  return map[label.toLowerCase()] || label.slice(0, 4);
}

/** Convertit une couleur hex (#RRGGBB) en rgba() avec l'alpha donné. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Légende horizontale (pastille + libellé) pour accompagner un graphe. */
export function renderLegend(items: { label: string; color: string }[]): string {
  return `<div class="legend">${items.map(i =>
    `<span class="legend-item"><span class="legend-dot" style="background:${i.color}"></span>${i.label}</span>`
  ).join('')}</div>`;
}

export function renderPieSubstitute(items: { label: string; value: number; color: string }[]): string {
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
 * étiquettes blanches en gras au centre des tranches (plugin datalabels).
 * Retourne '' hors navigateur (SSR/tests) — la légende reste affichée.
 */
export function renderPieChartImg(
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
  const rInner = r * 0.60; // trou central → donut

  // Parts
  let angle = -Math.PI / 2;
  for (const item of data) {
    const slice = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    angle += slice;
  }
  // Perce le centre (donut)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Séparateurs blancs entre les parts
  angle = -Math.PI / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * ratio;
  for (const item of data) {
    const slice = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    ctx.stroke();
    angle += slice;
  }

  // Étiquettes % sur l'anneau (parts assez grandes)
  angle = -Math.PI / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${11.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
  const rMid = (r + rInner) / 2;
  for (const item of data) {
    const slice = (item.value / total) * Math.PI * 2;
    const mid = angle + slice / 2;
    const pct = (item.value / total) * 100;
    if (pct >= 8) {
      ctx.fillText(`${pct.toFixed(0)}%`, cx + Math.cos(mid) * rMid, cy + Math.sin(mid) * rMid);
    }
    angle += slice;
  }

  // Total au centre (ou nombre de catégories selon labelMode)
  ctx.fillStyle = '#0C1740';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${22 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
  ctx.fillText(String(total), cx, cy - 6 * ratio);
  ctx.fillStyle = '#667085';
  ctx.font = `${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
  ctx.fillText(labelMode === 'valuePct' ? 'dossiers' : 'total', cx, cy + 13 * ratio);

  return `<img src="${canvas.toDataURL('image/png')}" width="${displaySize}" height="${displaySize}" style="width:${displaySize}px;height:${displaySize}px">`;
}

/** Petit utilitaire : rectangle à coins supérieurs arrondis (barres). */
function roundedTopRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number): void {
  const r = Math.min(rad, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

/**
 * Histogramme en colonnes (barres verticales) sur canvas → <img>. Utilisé pour
 * les répartitions mensuelles. Retourne '' hors navigateur.
 */
export function renderColumnChartImg(
  points: { label: string; value: number }[],
  displayWidth: number,
  displayHeight: number,
  color: string,
): string {
  if (points.length === 0 || typeof document === 'undefined') return '';
  const ratio = 2;
  const w = displayWidth * ratio, h = displayHeight * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const padL = 24 * ratio, padR = 10 * ratio, padT = 16 * ratio, padB = 20 * ratio;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const maxVal = Math.max(...points.map(p => p.value), 1);
  const niceMax = Math.max(5, Math.ceil(maxVal / 5) * 5);

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const ySteps = 5;
  ctx.strokeStyle = '#EEF0F6'; ctx.lineWidth = 1 * ratio; ctx.fillStyle = '#98A0B4';
  ctx.font = `${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ySteps; i++) {
    const y = padT + plotH - (plotH * i) / ySteps;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(String(Math.round((niceMax / ySteps) * i)), padL - 4 * ratio, y);
  }

  const n = points.length;
  const slot = plotW / n;
  const bw = Math.min(slot * 0.62, 30 * ratio);
  points.forEach((p, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const bh = (plotH * p.value) / niceMax;
    const y = padT + plotH - bh;
    ctx.fillStyle = color;
    if (bh > 0) roundedTopRect(ctx, x, y, bw, bh, 3 * ratio);
    if (p.value > 0) {
      ctx.fillStyle = '#0C1740';
      ctx.font = `bold ${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(p.value), x + bw / 2, y - 2 * ratio);
    }
    ctx.fillStyle = '#98A0B4';
    ctx.font = `${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(shortMonth(p.label), x + bw / 2, padT + plotH + 4 * ratio);
  });
  return `<img src="${canvas.toDataURL('image/png')}" width="${displayWidth}" height="${displayHeight}" style="width:${displayWidth}px;height:${displayHeight}px">`;
}

/**
 * Histogramme EMPILÉ par catégorie (une pile par libellé, segments = séries).
 * Retourne '' hors navigateur.
 */
export function renderStackedColumnChartImg(
  labels: string[],
  series: { label: string; color: string; values: number[] }[],
  displayWidth: number,
  displayHeight: number,
): string {
  if (labels.length === 0 || typeof document === 'undefined') return '';
  const ratio = 2;
  const w = displayWidth * ratio, h = displayHeight * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const padL = 24 * ratio, padR = 10 * ratio, padT = 14 * ratio, padB = 20 * ratio;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const colTotals = labels.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0));
  const maxVal = Math.max(...colTotals, 1);
  const niceMax = Math.max(5, Math.ceil(maxVal / 5) * 5);

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const ySteps = 5;
  ctx.strokeStyle = '#EEF0F6'; ctx.lineWidth = 1 * ratio; ctx.fillStyle = '#98A0B4';
  ctx.font = `${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ySteps; i++) {
    const y = padT + plotH - (plotH * i) / ySteps;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillText(String(Math.round((niceMax / ySteps) * i)), padL - 4 * ratio, y);
  }

  const n = labels.length;
  const slot = plotW / n;
  const bw = Math.min(slot * 0.64, 30 * ratio);
  labels.forEach((lab, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    let yBase = padT + plotH;
    for (const ser of series) {
      const v = ser.values[i] || 0;
      if (v <= 0) continue;
      const bh = (plotH * v) / niceMax;
      yBase -= bh;
      ctx.fillStyle = ser.color;
      ctx.fillRect(x, yBase, bw, bh);
    }
    if (colTotals[i] > 0) {
      ctx.fillStyle = '#0C1740';
      ctx.font = `bold ${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(colTotals[i]), x + bw / 2, yBase - 2 * ratio);
    }
    ctx.fillStyle = '#98A0B4';
    ctx.font = `${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(shortMonth(lab), x + bw / 2, padT + plotH + 4 * ratio);
  });
  return `<img src="${canvas.toDataURL('image/png')}" width="${displayWidth}" height="${displayHeight}" style="width:${displayWidth}px;height:${displayHeight}px">`;
}

/**
 * Histogramme GROUPÉ (barres côte à côte) avec, en option, une COURBE sur un
 * second axe (droite). Idéal pour reproduire le ComposedChart « réussites /
 * échecs + taux » de l'app. Retourne '' hors navigateur.
 */
export function renderGroupedBarsWithLineImg(
  labels: string[],
  bars: { label: string; color: string; values: number[] }[],
  line: { label: string; color: string; values: number[]; suffix?: string; max?: number } | null,
  displayWidth: number,
  displayHeight: number,
): string {
  if (labels.length === 0 || typeof document === 'undefined') return '';
  const ratio = 2;
  const w = displayWidth * ratio, h = displayHeight * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const padL = 26 * ratio, padR = (line ? 34 : 12) * ratio, padT = 16 * ratio, padB = 22 * ratio;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  const barMax = Math.max(...bars.flatMap(b => b.values), 1);
  const niceMax = Math.max(5, Math.ceil(barMax / 5) * 5);
  const lineMax = line ? (line.max ?? Math.max(...line.values, 1)) : 1;

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  const ySteps = 5;
  ctx.strokeStyle = '#EEF0F6'; ctx.lineWidth = 1 * ratio;
  ctx.font = `${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= ySteps; i++) {
    const y = padT + plotH - (plotH * i) / ySteps;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = '#98A0B4'; ctx.textAlign = 'right';
    ctx.fillText(String(Math.round((niceMax / ySteps) * i)), padL - 4 * ratio, y);
    if (line) {
      ctx.fillStyle = line.color; ctx.textAlign = 'left';
      ctx.fillText(`${Math.round((lineMax / ySteps) * i)}${line.suffix || ''}`, w - padR + 4 * ratio, y);
    }
  }

  const n = labels.length;
  const slot = plotW / n;
  const groupW = Math.min(slot * 0.7, 46 * ratio);
  const bw = groupW / bars.length;
  labels.forEach((lab, i) => {
    const gx = padL + slot * i + (slot - groupW) / 2;
    bars.forEach((ser, bi) => {
      const v = ser.values[i] || 0;
      const bh = (plotH * v) / niceMax;
      const x = gx + bw * bi;
      const y = padT + plotH - bh;
      ctx.fillStyle = ser.color;
      if (bh > 0) roundedTopRect(ctx, x + 1 * ratio, y, bw - 2 * ratio, bh, 2 * ratio);
      if (v > 0) {
        ctx.fillStyle = '#0C1740';
        ctx.font = `bold ${9 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(String(v), x + bw / 2, y - 2 * ratio);
      }
    });
    ctx.fillStyle = '#667085';
    ctx.font = `bold ${10 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(lab, padL + slot * i + slot / 2, padT + plotH + 4 * ratio);
  });

  // Courbe sur axe droit
  if (line) {
    const xFor = (i: number) => (n === 1 ? padL + plotW / 2 : padL + slot * i + slot / 2);
    const yFor = (v: number) => padT + plotH - (plotH * v) / (lineMax || 1);
    ctx.strokeStyle = line.color; ctx.lineWidth = 2.5 * ratio; ctx.lineJoin = 'round';
    ctx.beginPath();
    line.values.forEach((v, i) => { const x = xFor(i), y = yFor(v); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    line.values.forEach((v, i) => {
      ctx.fillStyle = line.color;
      ctx.beginPath(); ctx.arc(xFor(i), yFor(v), 3 * ratio, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = line.color;
      ctx.font = `bold ${9.5 * ratio}px -apple-system, 'Segoe UI', Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${v}${line.suffix || ''}`, xFor(i), yFor(v) - 5 * ratio);
    });
  }
  return `<img src="${canvas.toDataURL('image/png')}" width="${displayWidth}" height="${displayHeight}" style="width:${displayWidth}px;height:${displayHeight}px">`;
}

export function renderBarChart(items: { label: string; value: number; color?: string }[]): string {
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
 * Courbe(s) d'évolution sur canvas hors-écran → <img>. Accepte plusieurs séries
 * (multi-lignes), avec dégradé sous la première. `everyNth` allège l'axe des
 * abscisses quand il y a beaucoup de points (ex. 36 mois). Retourne '' hors
 * navigateur (SSR/tests) — un repli tabulaire est prévu côté générateur.
 */
export function renderLineChartImg(
  seriesOrPoints:
    | { label: string; value: number }[]
    | { labels: string[]; series: { label: string; color: string; values: number[] }[]; everyNth?: number; showValues?: boolean },
  displayWidth: number,
  displayHeight: number,
  color?: string
): string {
  if (typeof document === 'undefined') return '';

  // Normalisation : soit une série simple (rétro-compatible), soit multi-séries.
  let labels: string[];
  let series: { label: string; color: string; values: number[] }[];
  let everyNth = 1;
  let showValues = true;
  if (Array.isArray(seriesOrPoints)) {
    if (seriesOrPoints.length === 0) return '';
    labels = seriesOrPoints.map(p => p.label);
    series = [{ label: '', color: color || '#16307A', values: seriesOrPoints.map(p => p.value) }];
  } else {
    if (seriesOrPoints.labels.length === 0) return '';
    labels = seriesOrPoints.labels;
    series = seriesOrPoints.series;
    everyNth = seriesOrPoints.everyNth ?? 1;
    showValues = seriesOrPoints.showValues ?? true;
  }

  const ratio = 2;
  const w = displayWidth * ratio;
  const h = displayHeight * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const padL = 26 * ratio, padR = 12 * ratio, padT = 14 * ratio, padB = 26 * ratio;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxVal = Math.max(...series.flatMap(s => s.values), 1);
  const niceMax = Math.max(5, Math.ceil(maxVal / 5) * 5);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Lignes horizontales + graduations Y
  const ySteps = 5;
  ctx.strokeStyle = '#EEEEF0';
  ctx.lineWidth = 1 * ratio;
  ctx.fillStyle = '#92929C';
  ctx.font = `${9.5 * ratio}px 'Segoe UI', Arial, sans-serif`;
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

  const n = labels.length;
  const xFor = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1));
  const yFor = (v: number) => padT + plotH - (plotH * v) / niceMax;

  // Aire sous la première courbe (dégradé translucide)
  if (series.length === 1) {
    const s0 = series[0];
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexToRgba(s0.color, 0.22));
    grad.addColorStop(1, hexToRgba(s0.color, 0.02));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(xFor(0), padT + plotH);
    s0.values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
    ctx.lineTo(xFor(n - 1), padT + plotH);
    ctx.closePath();
    ctx.fill();
  }

  // Courbes
  series.forEach(s => {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2 * ratio;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    s.values.forEach((v, i) => {
      const x = xFor(i), y = yFor(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Points (uniquement si peu nombreux, sinon ça sature)
    if (n <= 14) {
      ctx.fillStyle = s.color;
      s.values.forEach((v, i) => {
        ctx.beginPath();
        ctx.arc(xFor(i), yFor(v), 3 * ratio, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  // Valeurs au-dessus des points (série unique, peu de points)
  if (showValues && series.length === 1 && n <= 14) {
    ctx.fillStyle = '#161616';
    ctx.font = `bold ${9.5 * ratio}px 'Segoe UI', Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    series[0].values.forEach((v, i) => {
      if (v > 0) ctx.fillText(String(v), xFor(i), yFor(v) - 4 * ratio);
    });
  }

  // Étiquettes d'abscisse (allégées)
  ctx.fillStyle = '#92929C';
  ctx.font = `${9.5 * ratio}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  labels.forEach((lab, i) => {
    if (i % everyNth !== 0 && i !== n - 1) return;
    ctx.fillText(shortMonth(lab), xFor(i), padT + plotH + 4 * ratio);
  });

  return `<img src="${canvas.toDataURL('image/png')}" width="${displayWidth}" height="${displayHeight}" style="width:${displayWidth}px;height:${displayHeight}px">`;
}

/** Petit tableau Mois/Valeur, utilisé en repli quand le canvas est indisponible. */
export function renderMonthTable(points: { mois: string; count: number }[], header: string): string {
  return `<table>
    <tr><th>Mois</th><th class="text-right">${header}</th></tr>
    ${points.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
  </table>`;
}

/** Échappe les caractères HTML sensibles (données saisies : noms, réfs…). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Transforme un document HTML complet en PDF paginé (A4 portrait) et déclenche
 * son téléchargement. Reproduit fidèlement le rendu écran via html2canvas.
 *
 * IMPORTANT : html2pdf clone l'élément fourni AVEC ses styles inline puis le rend
 * via html2canvas. On ne masque donc jamais cet élément par opacity/visibility/
 * position:fixed (le clone hériterait du masquage → PDF blanc) : on le pousse
 * hors-écran via un wrapper, et on lui donne toute la largeur A4 (794px ≈ 210mm
 * à 96dpi) pour éviter tout rognage latéral.
 */
export async function exportHtmlToPdf(
  html: string,
  opts: { filename: string; footerLabel: string },
): Promise<void> {
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

  const styleEl = document.createElement('style');
  styleEl.textContent = CSS_STYLES;
  container.prepend(styleEl);

  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  try {
    const html2pdf = (await import('html2pdf.js')).default;

    const opt = {
      margin: [10, 0, 10, 0],
      filename: opts.filename,
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
          `${opts.footerLabel} — page ${i}/${totalPages}`,
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
