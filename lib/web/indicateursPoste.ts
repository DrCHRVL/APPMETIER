/**
 * Publication périodique des indicateurs depuis ce poste (voir indicateurs.ts) :
 * peu après l'ouverture, puis après chaque synchronisation. Best-effort.
 */
import { ContentieuxManager } from '@/utils/contentieuxManager'
import { SiralBridge } from '@/utils/siralBridge'
import { APP_CONFIG } from '@/config/constants'
import { identiteSession } from './identite'
import { calculerIndicateursContentieux, calculerIndicateursUtilisateur, publierIndicateurs, type Indicateurs } from './indicateurs'

const http = {
  getJson: async (p: string) => {
    const res = await fetch(p, { credentials: 'same-origin' })
    return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> }
  },
  putJson: async (p: string, body: unknown) => (await fetch(p, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), credentials: 'same-origin',
  })).status,
}

async function publier(): Promise<void> {
  const me = identiteSession()
  if (!me) return
  const manager = ContentieuxManager.getInstance()
  const entrees: Array<{ coffre: string, valeur: Indicateurs }> = []
  for (const id of manager.getLoadedContentieuxIds()) {
    entrees.push({ coffre: `indicateurs-ctx-${id}`, valeur: calculerIndicateursContentieux(id, manager.getEnquetes(id)) })
  }
  const instructions = await SiralBridge.getData<Array<{ archived?: boolean, misEnExamen?: unknown[] }>>(
    `${APP_CONFIG.STORAGE_KEYS.INSTRUCTIONS}__${me.username}`, [])
  const air = await SiralBridge.getData<Array<{ dateCloture?: string, dateFinPriseEnCharge?: string }>>(
    `air_mesures__${me.username}`, [])
  entrees.push({
    coffre: `indicateurs-user-${me.username}`,
    valeur: calculerIndicateursUtilisateur(Array.isArray(instructions) ? instructions : [], Array.isArray(air) ? air : []),
  })
  await publierIndicateurs(entrees, me.username, http)
}

let demarre = false
let minuteur: ReturnType<typeof setTimeout> | null = null
const planifier = (ms: number) => {
  if (minuteur) clearTimeout(minuteur)
  minuteur = setTimeout(() => { publier().catch(() => {}) }, ms)
}

export function demarrerIndicateurs(): void {
  if (demarre || typeof window === 'undefined') return
  demarre = true
  planifier(20_000)
  for (const ev of ['siral-pull-applied', 'instructions-sync-completed', 'air-sync-completed']) {
    window.addEventListener(ev, () => planifier(10_000))
  }
}
