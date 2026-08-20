/**
 * SIRAL — stockage des « trames de forme » (papeteries Word de l'utilisateur).
 *
 * Persistées via le même canal que les autres réglages éditables (la trame
 * JLD, les tags…) : `SiralBridge.getData/setData` sous une clé dédiée.
 *
 * La bibliothèque est LIBRE : autant de papeteries que le magistrat veut, y
 * compris plusieurs du même type (« Requête JLD » et « Requête opérateur » ont
 * la même famille mais pas le même en-tête). Le `type` n'est donc plus une clé
 * unique, seulement une indication de départ ; c'est l'aiguillage
 * (`papeterieRoutage.ts`) qui choisit la papeterie d'un acte, à partir de ce
 * que le magistrat a retenu les fois précédentes.
 */

import { SiralBridge } from '@/utils/siralBridge';
import { APP_CONFIG } from '@/config/constants';
import type { TrameForme, TrameFormeType } from './trameFill';

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

/**
 * Repli DÉTERMINISTE quand l'aiguillage n'a rien appris et que l'IA n'est pas
 * joignable : la papeterie du type, à défaut celle marquée « défaut ». Sur une
 * bibliothèque qui en compte plusieurs du même type, la plus récemment mise à
 * jour l'emporte — mais c'est bien l'aiguillage qui doit trancher, pas ceci.
 */
export function pickTrameForme(list: TrameForme[], type: TrameFormeType): TrameForme | null {
  const recentes = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return recentes.find((t) => t.type === type) || recentes.find((t) => t.type === 'defaut') || null;
}
