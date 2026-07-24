/**
 * SIRAL — rendu des marqueurs [DIAGRAMME : …] d'un document, côté navigateur.
 *
 * Les données sont DANS le marqueur (fournies par l'attaché) : le rendu se
 * fait entièrement ici, avec Chart.js (déjà dans l'app — page Statistiques),
 * sur un canvas hors écran → PNG. Aucun aller-retour serveur : les exports
 * (PDF, Word, PowerPoint) fonctionnent même service attaché coupé.
 *
 * Résolution BEST-EFFORT, comme les [GRAPHIQUE : …] : un marqueur illisible
 * est simplement absent de la table — l'export rend une ligne de repli au
 * lieu d'échouer. Un texte sans marqueur ne charge jamais Chart.js.
 */
import { trouverDiagrammes, formatDiagramme } from '@/lib/stats/diagrammeMarqueur.mjs'
import { CHART_COLORS } from '@/lib/stats/chartCouleurs.mjs'

export interface DiagrammeResolu {
  dataUri: string
  titre: string
  /** Largeur d'affichage recommandée (px CSS) — cohérente avec graphiquesActe. */
  largeurPx: number
}

// Propriétés toujours PRÉSENTES (undefined plutôt qu'absentes) : c'est la
// forme exacte que rend parseDiagramme, et celle qu'attend formatDiagramme.
interface Diagramme {
  type: 'colonnes' | 'barres' | 'courbe' | 'secteurs'
  titre: string | undefined
  unite: string | undefined
  donnees: Array<{ label: string; valeur: number }>
}

/** Palette de l'app (source unique chartCouleurs), recyclée si plus de points. */
function couleurs(n: number): string[] {
  return Array.from({ length: n }, (_, i) => CHART_COLORS[i % CHART_COLORS.length])
}

/** Valeur formatée à la française, avec unité éventuelle (info-bulles/axes). */
function fmtValeur(v: number, unite?: string): string {
  const s = v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  return unite ? `${s} ${unite}` : s
}

/**
 * Rend UN diagramme en PNG (canvas hors écran, ×2 pour la netteté à
 * l'impression). Chart.js est chargé à la demande.
 */
async function rendreDiagramme(d: Diagramme): Promise<DiagrammeResolu | null> {
  if (typeof document === 'undefined') return null
  const { Chart } = await import('chart.js/auto')
  const secteurs = d.type === 'secteurs'
  const width = secteurs ? 760 : 960
  const height = secteurs ? 520 : 540
  const canvas = document.createElement('canvas')
  canvas.width = width * 2
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const labels = d.donnees.map((p) => p.label)
  const valeurs = d.donnees.map((p) => p.valeur)
  const palette = couleurs(d.donnees.length)
  const accent = '#2B5746' // vert de l'app : série unique des colonnes/barres/courbe
  const titre = d.titre || ''

  const type = d.type === 'courbe' ? 'line' : secteurs ? 'doughnut' : 'bar'
  const chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label: d.unite || '',
        data: valeurs,
        backgroundColor: secteurs ? palette : (d.type === 'courbe' ? 'rgba(43,87,70,0.12)' : accent),
        borderColor: secteurs ? '#ffffff' : accent,
        borderWidth: secteurs ? 2 : (d.type === 'courbe' ? 2.5 : 0),
        fill: d.type === 'courbe',
        tension: 0.3,
        pointRadius: d.type === 'courbe' ? 3.5 : 0,
        pointBackgroundColor: accent,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 2,
      indexAxis: d.type === 'barres' ? 'y' : 'x',
      layout: { padding: 14 },
      plugins: {
        title: titre ? {
          display: true,
          text: titre,
          color: '#1f2937',
          font: { size: 15, weight: 'bold', family: 'Arial, sans-serif' },
          padding: { bottom: 12 },
        } : undefined,
        legend: secteurs
          ? { position: 'right', labels: { color: '#374151', font: { size: 12 }, boxWidth: 14 } }
          : { display: false },
        tooltip: { enabled: false },
      },
      scales: secteurs ? undefined : {
        x: { ticks: { color: '#4b5563', font: { size: 11.5 } }, grid: { display: d.type === 'barres', color: '#e5e7eb' } },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#4b5563',
            font: { size: 11.5 },
            callback: (v: unknown) => fmtValeur(Number(v), d.unite),
          },
          grid: { display: d.type !== 'barres', color: '#e5e7eb' },
        },
      },
    },
    plugins: [{
      // Fond BLANC : un PNG transparent devient noir dans certains lecteurs PDF.
      id: 'fond-blanc',
      beforeDraw: (c) => {
        const g = c.ctx
        g.save()
        g.globalCompositeOperation = 'destination-over'
        g.fillStyle = '#ffffff'
        g.fillRect(0, 0, c.width, c.height)
        g.restore()
      },
    }],
  })
  try {
    const dataUri = canvas.toDataURL('image/png')
    return {
      dataUri,
      titre: titre || 'Diagramme',
      largeurPx: secteurs ? 460 : 640,
    }
  } finally {
    chart.destroy()
  }
}

/** Vrai si le texte contient au moins un marqueur [DIAGRAMME : …] valide. */
export function contientDiagrammes(contenu: string): boolean {
  return trouverDiagrammes(contenu).length > 0
}

/**
 * Résout tous les marqueurs du texte : Map<marqueur canonique, image>.
 * Les échecs individuels sont silencieux (marqueur absent de la Map).
 */
export async function chargerDiagrammesActe(contenu: string): Promise<Map<string, DiagrammeResolu>> {
  const out = new Map<string, DiagrammeResolu>()
  for (const d of trouverDiagrammes(contenu) as Diagramme[]) {
    try {
      const resolu = await rendreDiagramme(d)
      if (resolu) out.set(formatDiagramme(d), resolu)
    } catch {
      // best-effort : l'export rendra la ligne de repli
    }
  }
  return out
}
