/**
 * SIRAL — stockage des « trames de forme » (papeteries de l'utilisateur).
 *
 * Persistées via le même canal que les autres réglages éditables (la trame
 * JLD, les tags…) : `SiralBridge.getData/setData` sous une clé dédiée. Une
 * seule liste ; chaque trame déclare les TYPES d'actes qu'elle sert (un
 * courrier type peut valoir aussi pour les soit-transmis). La sélection à
 * l'export se fait par type, avec repli sur une trame « défaut » si elle
 * existe, sinon aucune (l'appelant retombe alors sur la génération intégrée).
 *
 * Règle d'unicité : un type d'acte n'est servi que par UNE trame. Reprendre un
 * type déjà pris le retire de l'ancienne trame — qui reste enregistrée, même
 * si elle se retrouve sans type (on ne supprime jamais le fichier de
 * l'utilisateur dans son dos ; elle est alors simplement inutilisée).
 */

import { SiralBridge } from '@/utils/siralBridge';
import { APP_CONFIG } from '@/config/constants';
import type { TrameForme } from './trameModele';

const KEY = APP_CONFIG.STORAGE_KEYS.TRAMES_FORME;

export async function loadTramesForme(): Promise<TrameForme[]> {
  try {
    const list = await SiralBridge.getData<TrameForme[]>(KEY, []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveTramesForme(list: TrameForme[]): Promise<void> {
  // La garde anti-érosion de setData refuse d'écrire une valeur « vide » (un
  // tableau [] en est une). Supprimer la DERNIÈRE trame passe donc par clearData,
  // sinon la suppression ne serait pas persistée.
  if (list.length === 0) {
    await SiralBridge.clearData(KEY);
    return;
  }
  await SiralBridge.setData(KEY, list);
}

// Les deux règles PURES (sélection par type, réservation des types) vivent
// dans `trameModele.ts` : elles ne dépendent d'aucun stockage et restent ainsi
// testables hors navigateur. On les ré-exporte ici, où les appelants les
// cherchent naturellement.
export { pickTrameForme, poserTrame } from './trameModele';
