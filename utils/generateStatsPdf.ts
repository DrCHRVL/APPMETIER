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
import type { InstructionStats } from '@/hooks/useInstructionStats';

interface PdfExportData {
  selectedYear: number;
  /** Libellé du contentieux affiché en titre (ex. « Criminalité Organisée / Stup »). */
  contentieuxLabel?: string;
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
  // Infractions en cours
  infractionsEnCours: { infraction: string; count: number }[];
  // Infractions terminées
  infractionsTerminees: { infraction: string; count: number }[];
  // Déférements par mois
  deferementsParMois: { mois: string; count: number }[];
  // Module instruction (optionnel : présent uniquement si des dossiers existent
  // pour le contentieux exporté). Les stats sont calculées en amont via
  // computeInstructionStats — même source que l'écran Statistiques.
  instruction?: {
    stats: InstructionStats;
    /** Cabinets connus (pour les libellés et couleurs du tableau par cabinet). */
    cabinets: { id: string; label: string; color: string }[];
  };
}

/** Couleurs des mesures de sûreté — identiques à InstructionStats (écran). */
const SURETE_COLORS = {
  detenu: '#dc2626',
  arse: '#f97316',
  cj: '#f59e0b',
  libre: '#16a34a',
};

/** Mise en forme d'un nombre de jours en « j » ou « mois » (cf. InstructionStats). */
function formatInstructionDays(j: number): string {
  if (!isFinite(j)) return '—';
  const r = Math.round(j);
  if (r < 60) return `${r} j`;
  return `${Math.round(r / 30)} mois`;
}

function formatStatNumber(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
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
    width: 120px;
    font-size: 10px;
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
 * Section « Instruction » du rapport : reprend les chiffres de l'écran
 * Statistiques (cartes, mesures de sûreté, principaux faits, échéances 175,
 * délai de clôture par cabinet). Démarre sur une nouvelle page.
 */
function renderInstructionSection(
  instruction: NonNullable<PdfExportData['instruction']>,
): string {
  const { stats, cabinets } = instruction;
  const cabinetLabel = (id: string) =>
    cabinets.find(c => c.id === id)?.label || (id === 'inconnu' ? 'Cabinet inconnu' : id);
  const cabinetColor = (id: string) =>
    cabinets.find(c => c.id === id)?.color || '#94a3b8';

  // Camembert mesures de sûreté (même couleurs que l'écran)
  const sureteItems = [
    { label: 'Détenu', value: stats.nbDetenus, color: SURETE_COLORS.detenu },
    { label: 'ARSE', value: stats.nbARSE, color: SURETE_COLORS.arse },
    { label: 'Contrôle judiciaire', value: stats.nbCJ, color: SURETE_COLORS.cj },
    { label: 'Libre', value: stats.nbLibres, color: SURETE_COLORS.libre },
  ];
  const suretePie = renderPieChartImg(sureteItems, 170, 'valuePct');

  // Top 8 des faits (qualifications des MEX)
  const topFaits = Object.entries(stats.repartitionFaits)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([q, v]) => ({ label: q.length > 32 ? q.slice(0, 32) + '…' : q, value: v, color: '#000091' }));

  // Cabinets triés par délai pondéré croissant
  const cabinetEntries = Object.entries(stats.ageMoyenClotureParCabinet)
    .sort(([, a], [, b]) => a.agePondereParMexJours - b.agePondereParMexJours);

  const urgents = stats.dossiersARegler.urgents;

  return `
<div class="page-break"></div>
<div class="page-header">
  <div class="tricolore"></div>
  <div class="overline">Module instruction</div>
  <h1>Information judiciaire</h1>
  <div class="subtitle">Dossiers d'instruction du contentieux — état du stock et échéances</div>
</div>

<div class="section-nobreak">
  <div class="section-title">Synthèse du stock</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Dossiers actifs</div>
      <div class="card-value">${stats.nbDossiersActifs}</div>
      <div class="card-detail">${stats.nbDossiersArchives} archivés · ${stats.nbDossiers} au total</div>
    </div>
    <div class="card">
      <div class="card-label">Mis en examen</div>
      <div class="card-value">${stats.nbMisEnExamen}</div>
      <div class="card-detail">${stats.nbDetenus} détenu${stats.nbDetenus > 1 ? 's' : ''} · ${stats.nbARSE} ARSE · ${stats.nbCJ} CJ</div>
    </div>
    <div class="card">
      <div class="card-label">Âge moyen (actifs)</div>
      <div class="card-value">${formatInstructionDays(stats.ageMoyenDossiersActifs)}</div>
      <div class="card-detail">le plus ancien : ${formatInstructionDays(stats.ageMaxDossierActif)}</div>
    </div>
    <div class="card">
      <div class="card-label">Volume procédural</div>
      <div class="card-value">${formatStatNumber(stats.cotesMoyennes)}</div>
      <div class="card-detail">cotes/tomes moy. · ${stats.cotesTotal} au total</div>
    </div>
  </div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Au règlement</div>
      <div class="card-value">${stats.nbDossiersAuReglement}</div>
      <div class="card-detail">${stats.nbDossiers175Recu} avec 175 reçu · ${stats.nbDossiersReqDef} réq. déf. rédigées</div>
    </div>
    <div class="card">
      <div class="card-label">DML en attente</div>
      <div class="card-value">${stats.nbDmlEnAttente}</div>
      <div class="card-detail">${stats.nbDmlTotal} au total · ${formatStatNumber(stats.dmlMoyenParDossier, 2)} par dossier</div>
    </div>
    <div class="card">
      <div class="card-label">À régler (art. 175 CPP)</div>
      <div class="card-value">${stats.dossiersARegler.total}</div>
      <div class="card-detail">dont ${stats.dossiersARegler.avecDetenu} avec détenu</div>
    </div>
  </div>
</div>

<div class="section-nobreak">
  <div class="section-title">Répartition des mesures de sûreté</div>
  ${stats.nbMisEnExamen > 0
    ? `<div class="two-cols" style="align-items:center">
        <div class="legend-col">${renderPieSubstitute(sureteItems)}</div>
        ${suretePie ? `<div style="text-align:center">${suretePie}</div>` : ''}
      </div>`
    : '<p style="color:#56565E;font-size:10px;">Aucun mis en examen.</p>'}
</div>

<div class="section-nobreak">
  <div class="section-title">Principaux types de faits</div>
  <p style="font-size:10px;color:#56565E;margin-bottom:6px">Top 8 — qualifications des mis en examen (dossiers actifs)</p>
  ${topFaits.length > 0
    ? renderBarChart(topFaits)
    : '<p style="color:#56565E;font-size:10px;">Aucune qualification renseignée.</p>'}
</div>

${urgents.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Échéances de règlement (détenu, 1 mois après 175 rendu)</div>
  <table>
    <tr><th>N° instruction</th><th class="text-center">175 rendu</th><th class="text-center">Échéance</th><th class="text-right">Statut</th></tr>
    ${urgents.map(u => {
      const enRetard = u.joursRestants < 0;
      const statut = enRetard
        ? `<span style="color:#E1000F;font-weight:bold">Retard ${-u.joursRestants} j</span>`
        : `${u.joursRestants} j restants`;
      return `<tr>
        <td>${u.numeroInstruction}</td>
        <td class="text-center">${new Date(u.date175).toLocaleDateString('fr-FR')}</td>
        <td class="text-center">${new Date(u.dateEcheance).toLocaleDateString('fr-FR')}</td>
        <td class="text-right">${statut}</td>
      </tr>`;
    }).join('')}
  </table>
</div>
` : ''}

${cabinetEntries.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Délai moyen de clôture par cabinet</div>
  <p style="font-size:10px;color:#56565E;margin-bottom:6px">Dossiers archivés — pondération par nombre de mis en examen</p>
  <table>
    <tr><th>Cabinet</th><th class="text-center">Dossiers</th><th class="text-center">MEX</th><th class="text-right">Âge moyen brut</th><th class="text-right">Pondéré / MEX</th></tr>
    ${cabinetEntries.map(([cab, v]) =>
      `<tr>
        <td><span class="svc-dot" style="background:${cabinetColor(cab)}"></span>${cabinetLabel(cab)}</td>
        <td class="text-center">${v.nbDossiers}</td>
        <td class="text-center">${v.nbMexTotal}</td>
        <td class="text-right">${formatInstructionDays(v.ageMoyenJours)}</td>
        <td class="text-right font-bold">${formatInstructionDays(v.agePondereParMexJours)}</td>
      </tr>`
    ).join('')}
  </table>
</div>
` : ''}
`;
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
  <div class="overline">Rapport d'activit&eacute; du service</div>
  <h1>${data.contentieuxLabel || 'Criminalité organisée'}</h1>
  <div class="subtitle">Année ${selectedYear} — généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · Document interne, ne pas diffuser</div>
</div>

<div class="section-nobreak">
  <div class="section-title">Synthèse générale</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Total des procédures terminées</div>
      <div class="card-value">${data.enquetesTerminees}</div>
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

<!-- Procédures terminées par mois -->
<div class="section-nobreak">
  <div class="section-title">Procédures terminées par mois</div>
  <div class="two-cols" style="align-items:flex-start">
    <div>
      <table>
        <tr><th>Mois</th><th class="text-right">Nombre</th></tr>
        ${data.proceduremoisData.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
        <tr style="background:#E3E3FD;font-weight:bold"><td>TOTAL</td><td class="text-right">${data.enquetesTerminees}</td></tr>
      </table>
    </div>
    <div style="padding-top:4px">
      ${renderBarChart(data.proceduremoisData.map(d => ({ label: d.mois, value: d.count, color: '#000091' })))}
    </div>
  </div>
</div>

<!-- Actes d'enquête : un seul chiffre, estimation minorée -->
<div class="section-nobreak">
  <div class="section-title">Actes d'enquête en préliminaire</div>
  <div class="stat-inline">
    <span class="stat-inline-value">${totalAvecProlongations}</span>
    <span class="stat-inline-note">actes et prolongations recensés <b>(estimation minorée)</b> — écoutes, géolocalisations et autres actes techniques. Le décompte réel est au moins égal à ce plancher.</span>
  </div>
</div>

<!-- Répartition par service : camemberts identiques à l'app + tableaux -->
<div class="section-nobreak">
  <div class="section-title">Répartition par service</div>
  <div class="two-cols">
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#56565E">Toutes enquêtes</h4>
      ${renderServiceBlock(data.serviceStats)}
    </div>
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#56565E">Enquêtes terminées</h4>
      ${renderServiceBlock(data.serviceStatsTerminees)}
    </div>
  </div>
</div>

<div class="section-nobreak">
  <div class="section-title">Orientation des procédures</div>
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
      <div class="card-label">Amendes prononcées</div>
      <div class="card-value">${formatCurrency(stats?.montantTotalAmendes || 0)}</div>
    </div>
    <div class="card">
      <div class="card-label">Interdictions de paraître</div>
      <div class="card-value">${stats?.totalInterdictionsParaitre || 0}</div>
    </div>
  </div>
</div>

<!-- Saisies vs confiscations : le delta, sans détail superflu -->
${(stats?.totalSaisiesArgent || 0) > 0 || (stats?.totalArgent || 0) > 0 || (stats?.totalSaisiesVehicules || 0) > 0 || (stats?.totalVehicules || 0) > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Saisies &amp; confiscations</div>
  <table>
    <tr><th>Catégorie</th><th class="text-right">Saisi (enquête)</th><th class="text-right">Confisqué (audience)</th><th class="text-right">Delta</th></tr>
    ${(stats?.totalSaisiesVehicules || 0) > 0 || (stats?.totalVehicules || 0) > 0 ? `<tr><td>Véhicules</td><td class="text-right">${stats?.totalSaisiesVehicules || 0}</td><td class="text-right">${stats?.totalVehicules || 0}</td><td class="text-right">${(stats?.totalSaisiesVehicules || 0) - (stats?.totalVehicules || 0)}</td></tr>` : ''}
    ${(stats?.totalSaisiesImmeubles || 0) > 0 || (stats?.totalImmeubles || 0) > 0 ? `<tr><td>Immeubles</td><td class="text-right">${stats?.totalSaisiesImmeubles || 0}</td><td class="text-right">${stats?.totalImmeubles || 0}</td><td class="text-right">${(stats?.totalSaisiesImmeubles || 0) - (stats?.totalImmeubles || 0)}</td></tr>` : ''}
    <tr style="background:#E3E3FD;font-weight:bold"><td>Total avoirs</td><td class="text-right">${formatCurrency(stats?.totalSaisiesArgent || 0)}</td><td class="text-right">${formatCurrency(stats?.totalArgent || 0)}</td><td class="text-right">${formatCurrency((stats?.totalSaisiesArgent || 0) - (stats?.totalArgent || 0))}</td></tr>
  </table>
</div>
` : ''}

<div class="section">
  <div class="section-title">Répartition par type d'infraction</div>
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

<!-- Déférements par mois -->
${data.deferementsParMois.length > 0 ? `
<div class="section-nobreak">
  <div class="section-title">Déférements par mois</div>
  ${renderBarChart(data.deferementsParMois.map(d => ({ label: d.mois, value: d.count, color: '#E1000F' })))}
</div>
` : ''}

${data.instruction ? renderInstructionSection(data.instruction) : ''}

<div class="footer">
  Rapport généré automatiquement · Données au ${new Date().toLocaleDateString('fr-FR')} · Usage interne, ne pas diffuser
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
