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
  /** Mode économe : bride les sous-agents (modèle rapide + moins de tours). */
  econome?: boolean
  /** Brief quotidien automatique (balaye les dossiers chaque matin). Défaut : désactivé. */
  briefAuto?: boolean
  /** Forfait de référence (pour traduire la consommation en %). */
  plan?: string
  /** Plafond de jetons estimé sur la fenêtre glissante de 5 h (0 = non défini). */
  cap5h?: number
  /** Plafond de jetons estimé sur 7 jours (0 = non défini). */
  capHebdo?: number
  /** Signature apposée sur les comptes-rendus rédigés par l'attaché (ex. « AUDRAN C »). Vide = nom de l'administrateur. */
  signatureCR?: string
}

/**
 * Repères indicatifs de plafonds de jetons par forfait Claude. L'abonnement ne
 * publie PAS ses seuils en jetons (fenêtre glissante de 5 h + plafond
 * hebdomadaire, exprimés en messages/heures) : ces valeurs sont des ordres de
 * grandeur ajustables, pour donner un dénominateur au pourcentage. Le magistrat
 * les affine à son ressenti. Max 5× ≈ 5× l'usage Pro ; Max 20× ≈ 20×.
 */
export const PLAN_PRESETS: Array<{ value: string; label: string; cap5h: number; capHebdo: number }> = [
  { value: '', label: 'Forfait : non précisé', cap5h: 0, capHebdo: 0 },
  { value: 'pro', label: 'Claude Pro', cap5h: 3_000_000, capHebdo: 30_000_000 },
  { value: 'max5', label: 'Claude Max 5×', cap5h: 15_000_000, capHebdo: 150_000_000 },
  { value: 'max20', label: 'Claude Max 20×', cap5h: 60_000_000, capHebdo: 600_000_000 },
  { value: 'custom', label: 'Forfait : plafonds sur mesure', cap5h: 0, capHebdo: 0 },
]

/** Abrège un nombre de jetons : 1 234 567 → « 1,2 M ». */
export function formatTokens(n: number): string {
  const v = Number(n) || 0
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(v >= 10_000_000_000 ? 0 : 1).replace('.', ',') + ' Md'
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',') + ' M'
  if (v >= 1_000) return (v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace('.', ',') + ' k'
  return String(Math.round(v))
}

/** Équivalent crédits API en euros (à titre indicatif ; l'abonnement est forfaitaire). */
export function formatCostEur(usd: number): string {
  const eur = (Number(usd) || 0) * 0.92 // parité USD→EUR approximative
  if (eur < 0.01) return '< 0,01 €'
  if (eur < 10) return eur.toFixed(2).replace('.', ',') + ' €'
  return Math.round(eur).toLocaleString('fr-FR') + ' €'
}

export const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Modèle : abonnement' },
  { value: 'claude-fable-5', label: 'Fable 5' },
  { value: 'claude-opus-5', label: 'Opus 5' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

/** Modèle des lots parallèles : un modèle rapide (Sonnet/Haiku) suffit souvent. */
export const SUBMODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Sous-agents : Sonnet (défaut)' },
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
