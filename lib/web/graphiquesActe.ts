/**
 * SIRAL — résolution des marqueurs [GRAPHIQUE : …] d'un acte, côté navigateur.
 *
 * Un bilan rédigé par l'attaché place ses graphiques par des marqueurs texte
 * (syntaxe partagée : lib/stats/graphiqueMarqueur.mjs). Au moment d'un export
 * PDF/Word, ce module interroge le service attaché (relais
 * /api/attache/stats-graphique) pour régénérer chaque image — mêmes règles et
 * mêmes couleurs que la page Statistiques — et rend une table
 * marqueur canonique → { dataUri, titre }.
 *
 * Résolution BEST-EFFORT : service indisponible, non-admin (404) ou graphique
 * inconnu → le marqueur est simplement absent de la table, et l'export le
 * rend en ligne de repli lisible (« [Graphique non disponible : …] ») au lieu
 * d'échouer. L'export d'un acte sans marqueur ne coûte aucune requête.
 */
import { trouverMarqueurs, formatMarqueur } from '@/lib/stats/graphiqueMarqueur.mjs'

export interface GraphiqueResolu {
  dataUri: string
  titre: string
  /** Largeur d'affichage recommandée (px CSS) — les graphiques hauts
   *  (donuts + légende) s'insèrent moins larges que les courbes pleine page. */
  largeurPx: number
}

/** Dimensions naturelles d'une image data:, via le décodeur du navigateur. */
function mesurerImage(dataUri: string): Promise<{ width: number, height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null)
    const im = new Image()
    im.onload = () => resolve({ width: im.naturalWidth || 0, height: im.naturalHeight || 0 })
    im.onerror = () => resolve(null)
    im.src = dataUri
  })
}

/** Vrai si le texte contient au moins un marqueur de graphique. */
export function contientMarqueurs(contenu: string): boolean {
  return trouverMarqueurs(contenu).length > 0
}

/**
 * Résout tous les marqueurs du texte : Map<marqueur canonique, image>.
 * Les échecs individuels sont silencieux (marqueur absent de la Map).
 */
export async function chargerGraphiquesActe(contenu: string): Promise<Map<string, GraphiqueResolu>> {
  const marqueurs = trouverMarqueurs(contenu)
  const out = new Map<string, GraphiqueResolu>()
  await Promise.all(marqueurs.map(async (m) => {
    try {
      const params = new URLSearchParams({ graphique: m.graphique })
      if (m.du) params.set('du', m.du)
      if (m.au) params.set('au', m.au)
      const res = await fetch('/api/attache/stats-graphique?' + params.toString(), { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { titre?: string, png?: string }
      if (!data?.png) return
      const dataUri = 'data:image/png;base64,' + data.png
      const dims = await mesurerImage(dataUri)
      const ratio = dims && dims.width > 0 ? dims.height / dims.width : 0.4
      out.set(formatMarqueur(m), {
        dataUri,
        titre: String(data.titre || m.graphique),
        largeurPx: ratio > 0.8 ? 460 : 640,
      })
    } catch {
      // best-effort : l'export rendra la ligne de repli
    }
  }))
  return out
}
