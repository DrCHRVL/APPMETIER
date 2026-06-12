/**
 * SIRAL — juridiction par défaut du moteur documentaire.
 *
 * Les analyseurs (JLD, scanner d'actes, intégration) doivent, à défaut de
 * pouvoir extraire le tribunal d'un document, retomber sur la juridiction de
 * l'UTILISATEUR CONNECTÉ — et non sur « Amiens » codé en dur. Ce module porte
 * cette valeur, fixée après authentification (`setDefaultTribunal`).
 *
 * Valeur de repli historique : Amiens (comportement antérieur préservé tant
 * que rien n'a été fixé, ex. application de bureau mono-utilisateur).
 */
import { canonicalTribunalLabel, slugifyTribunal } from '@/lib/tribunaux'

let currentLabel = "Tribunal judiciaire d'Amiens"
let currentCity = 'AMIENS'

/** Fixe la juridiction par défaut à partir d'une saisie libre ou d'un libellé. */
export function setDefaultTribunal(input?: string | null): void {
  if (!input || !String(input).trim()) return
  currentLabel = canonicalTribunalLabel(input)
  currentCity = (slugifyTribunal(input) || 'amiens').replace(/-/g, ' ').toUpperCase()
}

/** Libellé canonique (ex. « Tribunal judiciaire de Marseille »). */
export function defaultTribunalLabel(): string {
  return currentLabel
}

/** Nom de ville en majuscules (ex. « MARSEILLE ») — format des actes JLD. */
export function defaultTribunalCity(): string {
  return currentCity
}
