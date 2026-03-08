/**
 * Génère un rapport PDF des statistiques en construisant un document HTML
 * dédié à l'impression, indépendant du DOM de l'application.
 *
 * Avantages vs window.print() sur la page principale :
 * - Pas de dépendance aux canvas Chart.js (qui ne se rendent pas en print)
 * - Contrôle total sur la pagination et le formatage
 * - Tableaux propres, pas de troncature
 */

import { AudienceStats } from '@/types/audienceTypes';
import { Enquete } from '@/types/interfaces';

interface PdfExportData {
  selectedYear: number;
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
}

const CSS_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 11px;
    color: #1a1a1a;
    line-height: 1.4;
    padding: 0;
    max-width: 100%;
    overflow-x: hidden;
  }

  .page-header {
    text-align: center;
    padding: 15px 0 10px;
    border-bottom: 3px solid #2c3e50;
    margin-bottom: 20px;
  }
  .page-header h1 {
    font-size: 22px;
    color: #2c3e50;
    margin-bottom: 4px;
  }
  .page-header .subtitle {
    font-size: 12px;
    color: #7f8c8d;
  }

  .section {
    margin-bottom: 18px;
  }
  .section-nobreak {
    margin-bottom: 18px;
    page-break-inside: avoid;
  }
  .section-title {
    font-size: 14px;
    font-weight: bold;
    color: #2c3e50;
    border-bottom: 2px solid #3498db;
    padding-bottom: 4px;
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
    background: #f8f9fa;
    border: 1px solid #dee2e6;
    border-radius: 6px;
    padding: 10px 12px;
  }
  .card-label {
    font-size: 9px;
    color: #6c757d;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .card-value {
    font-size: 20px;
    font-weight: bold;
    color: #2c3e50;
  }
  .card-detail {
    font-size: 9px;
    color: #6c757d;
    margin-top: 2px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-bottom: 8px;
    table-layout: fixed;
    word-wrap: break-word;
  }
  th {
    background: #2c3e50;
    color: white;
    padding: 6px 8px;
    text-align: left;
    font-weight: 600;
    font-size: 9px;
  }
  td {
    padding: 5px 8px;
    border-bottom: 1px solid #e9ecef;
  }
  tr:nth-child(even) { background: #f8f9fa; }
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
    background: #e9ecef;
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
    color: #adb5bd;
    padding: 15px 5px 5px;
    margin-top: 30px;
    border-top: 1px solid #e9ecef;
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
    background: #f8f9fa;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #e9ecef;
  }
  .pie-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .pie-label { font-size: 10px; }
  .pie-value { font-weight: bold; font-size: 11px; margin-left: auto; }
  .pie-pct { font-size: 9px; color: #6c757d; margin-left: 4px; }
`;

const ORIENTATION_COLORS: Record<string, string> = {
  'CRPC': '#34495e',
  'CI': '#3498db',
  'COPJ': '#2ecc71',
  'OI': '#95a5a6',
  'CDD': '#E8D0A9',
  'Classement': '#e74c3c',
};

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
  if (total === 0) return '<p style="color:#6c757d;">Aucune donnée</p>';
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

function renderBarChart(items: { label: string; value: number; color?: string }[]): string {
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(item => {
    const width = Math.max(2, (item.value / max) * 100);
    const color = item.color || '#3498db';
    return `<div class="bar-container">
      <div class="bar-label">${item.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${width}%;background:${color}">${item.value > 0 ? item.value : ''}</div>
      </div>
      <div class="bar-value">${item.value}</div>
    </div>`;
  }).join('');
}

export function generateStatsPdfHtml(data: PdfExportData): string {
  const { selectedYear, audienceStats: stats } = data;
  const totalActes = data.acteStats.ecoutes + data.acteStats.geolocalisations + data.acteStats.autresActes;
  const totalProlongations = data.acteStats.prolongationsEcoutes + data.acteStats.prolongationsGeo + data.acteStats.prolongationsAutres;
  const totalAvecProlongations = totalActes + totalProlongations;

  // Estimation temps
  const tempsMinutes = totalAvecProlongations * 35;
  const tempsHeures = Math.floor(tempsMinutes / 60);
  const tempsMin = tempsMinutes % 60;

  // Taux de réponse pénale (stat bonus)
  const totalOrientations = stats
    ? (stats.nombreCRPC + stats.nombreCI + stats.nombreCOPJ + stats.nombreOI + stats.nombreCDD + (stats.nombreClassements || 0))
    : 0;
  const tauxReponsePenale = totalOrientations > 0 && stats
    ? (((totalOrientations - (stats.nombreClassements || 0)) / totalOrientations) * 100).toFixed(1)
    : '0';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport Statistiques ${selectedYear}</title>
  <style>${CSS_STYLES}</style>
</head>
<body>

<!-- PAGE 1 : EN-TETE + SYNTHESE GENERALE -->
<div class="page-header">
  <h1>Rapport d'activite - Crime organise</h1>
  <div class="subtitle">Annee ${selectedYear} - Genere le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
</div>

<div class="section-nobreak">
  <div class="section-title">Synthese generale</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Procedures terminees</div>
      <div class="card-value">${data.enquetesTerminees}</div>
    </div>
    <div class="card">
      <div class="card-label">Enquetes en cours</div>
      <div class="card-value">${data.enquetesEnCours}</div>
    </div>
    <div class="card">
      <div class="card-label">Duree moy. terminees</div>
      <div class="card-value">${Math.round(data.dureeMoyenneTerminees)}j</div>
    </div>
    <div class="card">
      <div class="card-label">Duree moy. en cours</div>
      <div class="card-value">${Math.round(data.dureeMoyenneEnCours)}j</div>
    </div>
    <div class="card">
      <div class="card-label">Taux reponse penale</div>
      <div class="card-value">${tauxReponsePenale}%</div>
    </div>
  </div>
</div>

<!-- Procédures terminées par mois -->
<div class="section">
  <div class="section-title">Procedures terminees par mois</div>
  <table>
    <tr><th>Mois</th><th class="text-right">Nombre</th></tr>
    ${data.proceduremoisData.map(d => `<tr><td>${d.mois}</td><td class="text-right font-bold">${d.count}</td></tr>`).join('')}
    <tr style="background:#e8f4f8;font-weight:bold"><td>TOTAL</td><td class="text-right">${data.enquetesTerminees}</td></tr>
  </table>
</div>

<!-- Actes d'enquête -->
<div class="section-nobreak">
  <div class="section-title">Actes d'enquete en preliminaire</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Total actes + prolongations</div>
      <div class="card-value">${totalAvecProlongations}</div>
      <div class="card-detail">Temps estime : ${tempsHeures}h${tempsMin > 0 ? tempsMin : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Ecoutes</div>
      <div class="card-value">${data.acteStats.ecoutes}</div>
      <div class="card-detail">Prolong. : ${data.acteStats.prolongationsEcoutes}</div>
    </div>
    <div class="card">
      <div class="card-label">Geolocalisations</div>
      <div class="card-value">${data.acteStats.geolocalisations}</div>
      <div class="card-detail">Prolong. : ${data.acteStats.prolongationsGeo}</div>
    </div>
    <div class="card">
      <div class="card-label">Autres actes</div>
      <div class="card-value">${data.acteStats.autresActes}</div>
      <div class="card-detail">Prolong. : ${data.acteStats.prolongationsAutres}</div>
    </div>
  </div>
</div>

<!-- Répartition par service -->
<div class="section">
  <div class="section-title">Repartition par service</div>
  <div class="two-cols">
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#555">Toutes enquetes</h4>
      <table>
        <tr><th>Service</th><th class="text-right">Nombre</th><th class="text-right">%</th></tr>
        ${(() => {
          const total = data.serviceStats.reduce((s, i) => s + i.count, 0);
          return data.serviceStats.map(s =>
            `<tr><td>${s.service}</td><td class="text-right font-bold">${s.count}</td><td class="text-right">${((s.count/total)*100).toFixed(1)}%</td></tr>`
          ).join('');
        })()}
      </table>
    </div>
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#555">Enquetes terminees</h4>
      <table>
        <tr><th>Service</th><th class="text-right">Nombre</th><th class="text-right">%</th></tr>
        ${(() => {
          const total = data.serviceStatsTerminees.reduce((s, i) => s + i.count, 0);
          return data.serviceStatsTerminees.map(s =>
            `<tr><td>${s.service}</td><td class="text-right font-bold">${s.count}</td><td class="text-right">${total > 0 ? ((s.count/total)*100).toFixed(1) : 0}%</td></tr>`
          ).join('');
        })()}
      </table>
    </div>
  </div>
</div>

<!-- PAGE 2 : ORIENTATION ET RESULTATS D'AUDIENCE -->
<div class="page-break"></div>
<div class="section-nobreak">
  <div class="section-title">Orientation des procedures</div>
  ${stats ? renderPieSubstitute([
    { label: 'CRPC', value: stats.nombreCRPC, color: ORIENTATION_COLORS['CRPC'] },
    { label: 'CI', value: stats.nombreCI, color: ORIENTATION_COLORS['CI'] },
    { label: 'COPJ', value: stats.nombreCOPJ, color: ORIENTATION_COLORS['COPJ'] },
    { label: 'OI', value: stats.nombreOI, color: ORIENTATION_COLORS['OI'] },
    { label: 'CDD', value: stats.nombreCDD, color: ORIENTATION_COLORS['CDD'] },
    { label: 'Classement', value: stats.nombreClassements || 0, color: ORIENTATION_COLORS['Classement'] },
  ]) : '<p>Aucune donnee</p>'}

  ${stats ? `<div style="margin-top:6px;font-size:10px;color:#555">Dont ${stats.nombreDeferements} deferement${stats.nombreDeferements > 1 ? 's' : ''}</div>` : ''}
</div>

<!-- Orientation par mois -->
<div class="section">
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
      return `<tr style="background:#e8f4f8;font-weight:bold">
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

<!-- Condamnations par mois -->
<div class="section">
  <div class="section-title">Condamnations et peines par mois</div>
  <table>
    <tr>
      <th>Mois</th>
      <th class="text-right">Condamnations</th>
      <th class="text-right">Prison (mois)</th>
      <th class="text-right">Amendes</th>
    </tr>
    ${data.monthlyData.map(m => `<tr>
      <td>${m.mois}</td>
      <td class="text-right">${m.condamnations}</td>
      <td class="text-right">${m.moisPrison}</td>
      <td class="text-right">${formatCurrency(m.amendes)}</td>
    </tr>`).join('')}
    ${(() => {
      const totC = data.monthlyData.reduce((s, m) => s + m.condamnations, 0);
      const totP = data.monthlyData.reduce((s, m) => s + m.moisPrison, 0);
      const totA = data.monthlyData.reduce((s, m) => s + m.amendes, 0);
      return `<tr style="background:#e8f4f8;font-weight:bold">
        <td>TOTAL</td>
        <td class="text-right">${totC}</td>
        <td class="text-right">${totP} (${formatMoisEnAnnees(totP)})</td>
        <td class="text-right">${formatCurrency(totA)}</td>
      </tr>`;
    })()}
  </table>
</div>

<!-- PAGE 3 : PEINES DETAILLEES -->
<div class="page-break"></div>
<div class="section-nobreak">
  <div class="section-title">Peines de prison</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Total prison ferme</div>
      <div class="card-value">${stats?.totalPeinePrison || 0} mois</div>
      <div class="card-detail">${formatMoisEnAnnees(stats?.totalPeinePrison || 0)}</div>
    </div>
    <div class="card">
      <div class="card-label">Nombre condamnations</div>
      <div class="card-value">${stats?.nombreCondamnations || 0}</div>
    </div>
    <div class="card">
      <div class="card-label">Amendes totales</div>
      <div class="card-value">${formatCurrency(stats?.montantTotalAmendes || 0)}</div>
      <div class="card-detail">Moy: ${formatCurrency(stats?.moyenneAmende || 0)}/condamnation</div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">Peines moyennes par type</div>
  <table>
    <tr>
      <th>Type de peine</th>
      <th class="text-right">Moyenne (mois)</th>
      <th class="text-right">% condamnations</th>
    </tr>
    <tr>
      <td>Prison ferme uniquement</td>
      <td class="text-right font-bold">${stats?.moyennePrison || 0}</td>
      <td class="text-right">${stats?.tauxPeinesFermes || 0}%</td>
    </tr>
    <tr>
      <td>Sursis probatoire uniquement</td>
      <td class="text-right font-bold">${stats?.moyenneProbation || 0}</td>
      <td class="text-right">${stats?.tauxPeinesProbation || 0}%</td>
    </tr>
    <tr>
      <td>Sursis simple uniquement</td>
      <td class="text-right font-bold">${stats?.moyenneSimple || 0}</td>
      <td class="text-right">${stats?.tauxPeinesSimple || 0}%</td>
    </tr>
    <tr>
      <td>Mixte avec sursis probatoire</td>
      <td class="text-right font-bold">${stats?.moyenneMixtesProbation || '-'}</td>
      <td class="text-right">${stats?.tauxPeinesMixtesProbation || 0}%</td>
    </tr>
    <tr>
      <td>Mixte avec sursis simple</td>
      <td class="text-right font-bold">${stats?.moyenneMixtesSimple || '-'}</td>
      <td class="text-right">${stats?.tauxPeinesMixtesSimple || 0}%</td>
    </tr>
  </table>
</div>

<!-- Confiscations et interdictions -->
<div class="section-nobreak">
  <div class="section-title">Confiscations et interdictions</div>
  <div class="cards-row">
    <div class="card">
      <div class="card-label">Vehicules saisis</div>
      <div class="card-value">${stats?.totalVehicules || 0}</div>
    </div>
    <div class="card">
      <div class="card-label">Immeubles saisis</div>
      <div class="card-value">${stats?.totalImmeubles || 0}</div>
    </div>
    <div class="card">
      <div class="card-label">Confiscations argent</div>
      <div class="card-value">${formatCurrency(stats?.totalArgent || 0)}</div>
    </div>
    <div class="card">
      <div class="card-label">Interdictions de paraitre</div>
      <div class="card-value">${stats?.totalInterdictionsParaitre || 0}</div>
      <div class="card-detail">${stats && stats.nombreCondamnations > 0 ? ((stats.totalInterdictionsParaitre / stats.nombreCondamnations) * 100).toFixed(1) : 0}% des condamnations</div>
    </div>
  </div>
</div>

<!-- Peines par type d'infraction -->
${stats?.peinesParInfraction && Object.keys(stats.peinesParInfraction).length > 0 ? `
<div class="section">
  <div class="section-title">Peines moyennes par type d'infraction</div>
  <table>
    <tr>
      <th>Infraction</th>
      <th class="text-right">Ferme (mois)</th>
      <th class="text-right">Probatoire (mois)</th>
      <th class="text-right">Simple (mois)</th>
      <th class="text-right">Mixte prob.</th>
      <th class="text-right">Mixte simple</th>
    </tr>
    ${Object.entries(stats.peinesParInfraction).map(([infraction, s]) => `<tr>
      <td>${infraction}</td>
      <td class="text-right">${s.moyenneFerme > 0 ? s.moyenneFerme + ' (' + s.countFerme + ')' : '-'}</td>
      <td class="text-right">${s.moyenneProbation > 0 ? s.moyenneProbation + ' (' + s.countProbation + ')' : '-'}</td>
      <td class="text-right">${s.moyenneSimple > 0 ? s.moyenneSimple + ' (' + s.countSimple + ')' : '-'}</td>
      <td class="text-right">${s.moyenneMixtesProbation || '-'}</td>
      <td class="text-right">${s.moyenneMixtesSimple || '-'}</td>
    </tr>`).join('')}
  </table>
</div>
` : ''}

<!-- PAGE 4 : INFRACTIONS -->
<div class="page-break"></div>
<div class="section">
  <div class="section-title">Repartition par type d'infraction</div>
  <div class="two-cols">
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#555">Enquetes en cours</h4>
      ${data.infractionsEnCours.length > 0
        ? renderBarChart(data.infractionsEnCours.map(i => ({ label: i.infraction, value: i.count, color: '#3498db' })))
        : '<p style="color:#6c757d;font-size:10px;">Aucune donnee</p>'}
    </div>
    <div>
      <h4 style="font-size:11px;margin-bottom:6px;color:#555">Enquetes terminees</h4>
      ${data.infractionsTerminees.length > 0
        ? renderBarChart(data.infractionsTerminees.map(i => ({ label: i.infraction, value: i.count, color: '#2ecc71' })))
        : '<p style="color:#6c757d;font-size:10px;">Aucune donnee</p>'}
    </div>
  </div>
</div>

<!-- Déférements par mois -->
${data.deferementsParMois.length > 0 ? `
<div class="section">
  <div class="section-title">Deferements par mois</div>
  ${renderBarChart(data.deferementsParMois.map(d => ({ label: d.mois, value: d.count, color: '#e74c3c' })))}
</div>
` : ''}

<div class="footer">
  Rapport genere automatiquement - Donnees au ${new Date().toLocaleDateString('fr-FR')}
</div>

</body>
</html>`;
}

export async function exportStatsPdf(data: PdfExportData): Promise<void> {
  const html = generateStatsPdfHtml(data);

  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    alert('Veuillez autoriser les popups pour exporter le PDF.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  // Attendre le chargement complet puis déclencher l'impression
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}

export type { PdfExportData };
