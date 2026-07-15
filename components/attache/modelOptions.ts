/**
 * SIRAL — Attaché de justice · choix du cerveau.
 *
 * Mêmes possibilités que Claude web : choix du modèle et du niveau d'effort
 * (raisonnement). Les valeurs sont passées telles quelles au CLI `claude`
 * (--model / --effort) par le service attaché, qui les re-valide.
 * Valeur vide = défaut de l'abonnement / du CLI.
 */

export interface AttacheConfig {
  model?: string
  effort?: string
  webAccess?: boolean
  /** Modèle des sous-agents (lots parallèles) — vide = celui de l'attaché. */
  subModel?: string
}

export const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Modèle : abonnement' },
  { value: 'claude-fable-5', label: 'Fable 5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

/** Modèle des lots parallèles : un modèle rapide (Sonnet/Haiku) suffit souvent. */
export const SUBMODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Sous-agents : même modèle' },
  ...MODEL_OPTIONS.slice(1).map((m) => ({ value: m.value, label: `Sous-agents : ${m.label}` })),
]

export const EFFORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Effort : auto' },
  { value: 'low', label: 'Effort : faible' },
  { value: 'medium', label: 'Effort : moyen' },
  { value: 'high', label: 'Effort : élevé' },
  { value: 'xhigh', label: 'Effort : très élevé' },
  { value: 'max', label: 'Effort : maximal' },
]

/** Libellé court d'un modèle (pour les infobulles / états). */
export function modelLabel(value: string | undefined): string {
  const found = MODEL_OPTIONS.find((m) => m.value === (value || ''))
  return found ? found.label : String(value)
}

/** Enregistre la configuration côté service (persistée pour tous les runs). */
export async function saveAttacheConfig(patch: AttacheConfig): Promise<boolean> {
  try {
    const res = await fetch('/api/attache/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Lit la configuration courante (modèle, effort, accès web). */
export async function loadAttacheConfig(): Promise<AttacheConfig> {
  try {
    const res = await fetch('/api/attache/config')
    if (!res.ok) return {}
    const { config } = await res.json()
    return config || {}
  } catch {
    return {}
  }
}
