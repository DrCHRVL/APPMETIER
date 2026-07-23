/**
 * SIRAL — Attaché de justice · rapprochement TOLÉRANT des numéros de dossier.
 *
 * Un même dossier circule sous plusieurs écritures : « 85103/843/2026 »,
 * « 85103/843/2026 - GRIVESNES 2 », avec ou sans espaces… L'ouverture d'un
 * dossier depuis le journal (app/page.tsx) rapproche déjà ces variantes,
 * mais le service, lui, comparait les numéros à la lettre : un acte rangé
 * sous l'écriture courte devenait INVISIBLE dans « Actes rédigés » de
 * l'enquête à l'écriture longue (répertoires de stockage distincts), et
 * lire_dossier répondait « introuvable ».
 *
 * Ici : la règle de rapprochement UNIQUE du service, partagée par
 * dossier.mjs (findEnquete) et productions.mjs (répertoires variants).
 * Miroir web : utils/numeroDossier.ts — garder les deux alignés.
 */

/** Forme canonique de comparaison : minuscules, sans accents, alphanumérique pur. */
export function normNumero(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Longueur minimale de la partie commune pour un rapprochement par INCLUSION
 * (l'égalité normalisée, elle, vaut à toute longueur) : en dessous, trop de
 * faux positifs — « 2026 » matcherait tous les dossiers de l'année.
 */
export const NUMERO_INCLUSION_MIN = 8

/**
 * Les deux numéros désignent-ils vraisemblablement le même dossier ?
 * Égalité normalisée, ou inclusion de l'un dans l'autre (écriture courte
 * « 85103/843/2026 » ⊂ écriture longue « 85103/843/2026 - GRIVESNES 2 »)
 * si la partie commune est assez longue.
 */
export function numerosProches(a, b) {
  const na = normNumero(a)
  const nb = normNumero(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const [court, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  return court.length >= NUMERO_INCLUSION_MIN && long.includes(court)
}
