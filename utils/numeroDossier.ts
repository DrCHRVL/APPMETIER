/**
 * SIRAL — rapprochement TOLÉRANT des numéros de dossier (côté web).
 *
 * Un même dossier circule sous plusieurs écritures : « 85103/843/2026 »,
 * « 85103/843/2026 - GRIVESNES 2 », avec ou sans espaces… Les cartes de
 * l'attaché (journal « pendant votre absence », brief) peuvent porter
 * l'écriture courte : l'ouverture du dossier ET le raccrochage d'un acte
 * validé à son enquête doivent tous deux retrouver la même enquête.
 * Miroir service : scripts/attache/numero.mjs — garder les deux alignés.
 */

/** Forme canonique de comparaison : minuscules, sans accents, alphanumérique pur. */
export function normNumero(s?: string | null): string {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Longueur minimale de la partie commune pour un rapprochement par INCLUSION
 * (l'égalité normalisée, elle, vaut à toute longueur) : en dessous, trop de
 * faux positifs — « 2026 » matcherait tous les dossiers de l'année.
 */
export const NUMERO_INCLUSION_MIN = 8;

/**
 * Les deux numéros désignent-ils vraisemblablement le même dossier ?
 * Égalité normalisée, ou inclusion de l'un dans l'autre (écriture courte
 * « 85103/843/2026 » ⊂ écriture longue « 85103/843/2026 - GRIVESNES 2 »)
 * si la partie commune est assez longue.
 */
export function numerosProches(a?: string | null, b?: string | null): boolean {
  const na = normNumero(a);
  const nb = normNumero(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [court, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return court.length >= NUMERO_INCLUSION_MIN && long.includes(court);
}

/**
 * Retrouve une enquête par son numéro, écritures variantes comprises.
 * Correspondance exacte d'abord ; à défaut, rapprochement tolérant — et si
 * plusieurs candidates (« …GRIVESNES » et « …GRIVESNES 2 ») : la plus
 * vraisemblable (égalité normalisée d'abord, non archivée ensuite, puis
 * activité la plus récente).
 */
export function findEnqueteParNumero<T extends { numero: string; statut?: string; dateMiseAJour?: string }>(
  list: T[],
  numero: string,
): T | undefined {
  const wanted = String(numero || '').trim();
  if (!wanted) return undefined;
  const exact = list.find((e) => String(e.numero).trim() === wanted)
    || list.find((e) => String(e.numero).replace(/\s+/g, '') === wanted.replace(/\s+/g, ''));
  if (exact) return exact;
  const candidates = list.filter((e) => numerosProches(e.numero, wanted));
  if (candidates.length === 0) return undefined;
  const nt = normNumero(wanted);
  return [...candidates].sort((a, b) =>
    (Number(normNumero(b.numero) === nt) - Number(normNumero(a.numero) === nt))
    || (Number(a.statut === 'archive') - Number(b.statut === 'archive'))
    || String(b.dateMiseAJour || '').localeCompare(String(a.dateMiseAJour || '')))[0];
}
