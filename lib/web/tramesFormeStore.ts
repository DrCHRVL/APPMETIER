/**
 * SIRAL — stockage des « trames de forme » (papeteries Word de l'utilisateur).
 *
 * Persistées via le même canal que les autres réglages éditables (la trame
 * JLD, les tags…) : `ElectronBridge.getData/setData` sous une clé dédiée. Une
 * seule liste ; chaque trame est associée à un type de document. La sélection
 * à l'export se fait par type, avec repli sur une trame « défaut » si elle
 * existe, sinon aucune (l'appelant retombe alors sur la génération intégrée).
 */

import { ElectronBridge } from '@/utils/electronBridge';
import { APP_CONFIG } from '@/config/constants';
import type { TrameForme, TrameFormeType } from './trameFill';

const KEY = APP_CONFIG.STORAGE_KEYS.TRAMES_FORME;

export async function loadTramesForme(): Promise<TrameForme[]> {
  try {
    const list = await ElectronBridge.getData<TrameForme[]>(KEY, []);
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
    await ElectronBridge.clearData(KEY);
    return;
  }
  await ElectronBridge.setData(KEY, list);
}

/** Trame applicable pour un type donné : la trame du type, à défaut la trame « défaut ». */
export function pickTrameForme(list: TrameForme[], type: TrameFormeType): TrameForme | null {
  return list.find((t) => t.type === type) || list.find((t) => t.type === 'defaut') || null;
}
