/**
 * SIRAL — Attaché de justice · gouverneur de consommation (« juguler »).
 *
 * Le cerveau tourne sur l'ABONNEMENT Claude (Max) : pas de facture, mais un
 * FORFAIT à plafonds (fenêtre glissante de 5 h + plafond hebdomadaire). Le
 * poste qui fait exploser ces plafonds, ce sont les SOUS-AGENTS lancés en
 * parallèle par les runs AUTONOMES (brief quotidien, étude du corpus,
 * consolidation, routines) et par les mails traités. « Mode économe » réduit
 * le COÛT D'UN run (Haiku, moins de tours) mais RIEN ne réduisait le VOLUME ni
 * la FRÉQUENCE : les runs de fond continuaient de partir même fenêtre déjà à
 * 169 % du forfait.
 *
 * Ce module comble ce manque : un GOUVERNEUR qui, à coût nul (usage.jsonl est
 * en clair — que des nombres et des horodatages), compare la consommation
 * récente aux plafonds du forfait et rend un NIVEAU :
 *   - 'ok'     : rien à brider ;
 *   - 'serrer' : on approche du plafond → on force le régime économe sur les
 *                lots de sous-agents (Haiku, effort faible, moins de tours,
 *                moins de parallélisme) même si le magistrat n'a pas coché le
 *                mode économe ;
 *   - 'stop'   : plafond atteint → on DIFFÈRE les runs autonomes (ils
 *                repartiront au prochain tick, une fois la fenêtre redescendue)
 *                et on bride au maximum les lots de sous-agents encore lancés
 *                (chat du magistrat : jamais bloqué, seulement dégradé).
 *
 * Seuils réglables par variables d'environnement. Sans plafond configuré
 * (cap5h = cap capHebdo = 0), le gouverneur est INERTE : on n'invente jamais
 * une limite que le magistrat n'a pas posée.
 */
import { usageSummary } from './usage.mjs'

const bounded01 = (v, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : dflt
}

// Fractions du plafond où l'on commence à serrer / où l'on stoppe les runs de
// fond. La fenêtre de 5 h est la plus contraignante (celle qui bride le plus
// vite) : c'est elle qui pilote surtout le gouverneur.
const SERRER_5H = bounded01(process.env.SIRAL_ATTACHE_BUDGET_SERRER_5H, 0.75)
const STOP_5H = bounded01(process.env.SIRAL_ATTACHE_BUDGET_STOP_5H, 1.0)
const SERRER_7J = bounded01(process.env.SIRAL_ATTACHE_BUDGET_SERRER_7J, 0.85)
const STOP_7J = bounded01(process.env.SIRAL_ATTACHE_BUDGET_STOP_7J, 1.0)

const pct = (used, cap) => (cap > 0 ? used / cap : 0)

/**
 * État du gouverneur au regard des plafonds du forfait (config.cap5h /
 * config.capHebdo). Lecture seule, sans trousseau, sans appel modèle.
 * @param {{cap5h?:number, capHebdo?:number}} cfg
 * @param {number} [now]
 * @returns {{level:'ok'|'serrer'|'stop', pct5h:number, pct7d:number, used5h:number, used7d:number, cap5h:number, capHebdo:number, raison:string|null}}
 */
export function consumptionGovernor(cfg = {}, now = Date.now()) {
  const cap5h = Number(cfg.cap5h) > 0 ? Number(cfg.cap5h) : 0
  const capHebdo = Number(cfg.capHebdo) > 0 ? Number(cfg.capHebdo) : 0
  // Aucun plafond posé : le gouverneur ne s'invente pas de limite.
  if (!cap5h && !capHebdo) {
    return { level: 'ok', pct5h: 0, pct7d: 0, used5h: 0, used7d: 0, cap5h: 0, capHebdo: 0, raison: null }
  }
  let s
  try { s = usageSummary(now) } catch { return { level: 'ok', pct5h: 0, pct7d: 0, used5h: 0, used7d: 0, cap5h, capHebdo, raison: null } }
  const used5h = s.w5h?.total || 0
  const used7d = s.w7d?.total || 0
  const p5 = pct(used5h, cap5h)
  const p7 = pct(used7d, capHebdo)

  let level = 'ok'
  let raison = null
  if ((cap5h && p5 >= STOP_5H) || (capHebdo && p7 >= STOP_7J)) {
    level = 'stop'
    raison = cap5h && p5 >= STOP_5H
      ? `fenêtre de 5 h à ${Math.round(p5 * 100)} % du forfait`
      : `plafond hebdomadaire à ${Math.round(p7 * 100)} %`
  } else if ((cap5h && p5 >= SERRER_5H) || (capHebdo && p7 >= SERRER_7J)) {
    level = 'serrer'
    raison = cap5h && p5 >= SERRER_5H
      ? `fenêtre de 5 h à ${Math.round(p5 * 100)} % du forfait`
      : `plafond hebdomadaire à ${Math.round(p7 * 100)} %`
  }
  return { level, pct5h: p5, pct7d: p7, used5h, used7d, cap5h, capHebdo, raison }
}

/** Le gouverneur autorise-t-il un run AUTONOME (brief, étude, consolidation, routine) ? */
export function autonomousAllowed(cfg, now = Date.now()) {
  return consumptionGovernor(cfg, now).level !== 'stop'
}
