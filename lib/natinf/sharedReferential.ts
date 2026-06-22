// Distribution du référentiel NATINF à tout le cabinet via le mécanisme de
// « fichier global partagé » de l'app (même canal que tag-data.json) : un admin
// publie le référentiel à jour, chaque poste le récupère au démarrage et
// retombe sur le référentiel embarqué si le partage est absent/injoignable.
//
// Le référentiel complet (~17 000 codes) est volumineux : on le compresse en
// gzip côté navigateur pour rester de l'ordre de ~2 Mo sur le partage réseau
// (compatible avec les timeouts courts de readGlobalFile/writeGlobalFile).

import type { NatinfEntry } from '@/types/natinf';

/** Schéma du fichier partagé natinf-data.json. */
export interface NatinfSharedPayload {
  schema: 'natinf';
  /** Version monotone (timestamp ms) pour comparer les révisions */
  version: number;
  updatedAt: string;
  updatedBy: string;
  computerName?: string;
  /** Origine des données (ex. « Export DACG data.gouv — avril 2026 ») */
  source?: string;
  codeCount: number;
  /** Entrées compressées (gzip + base64). Présent si la compression est dispo. */
  gz?: string;
  /** Entrées en clair (repli si CompressionStream indisponible) */
  json?: string;
}

function getBridge(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).electronAPI || null;
}

// ── base64 <-> octets (par tranches pour les gros volumes) ──────────────────
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const hasCompression = () =>
  typeof (globalThis as any).CompressionStream !== 'undefined' &&
  typeof (globalThis as any).DecompressionStream !== 'undefined';

async function gzipToBase64(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new (globalThis as any).CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}
async function gunzipFromBase64(b64: string): Promise<string> {
  const bytes = base64ToBytes(b64);
  const stream = new Blob([bytes]).stream().pipeThrough(new (globalThis as any).DecompressionStream('gzip'));
  return await new Response(stream).text();
}

/** Construit le payload partagé (compressé si possible) à partir des entrées. */
export async function buildSharedPayload(
  entries: NatinfEntry[],
  meta: { updatedBy: string; computerName?: string; source?: string },
): Promise<NatinfSharedPayload> {
  const json = JSON.stringify(entries);
  const base: NatinfSharedPayload = {
    schema: 'natinf',
    version: Date.now(),
    updatedAt: new Date().toISOString(),
    updatedBy: meta.updatedBy,
    computerName: meta.computerName,
    source: meta.source,
    codeCount: entries.length,
  };
  if (hasCompression()) {
    return { ...base, gz: await gzipToBase64(json) };
  }
  return { ...base, json };
}

/** Décode les entrées d'un payload partagé. */
export async function decodeSharedPayload(payload: NatinfSharedPayload): Promise<NatinfEntry[]> {
  if (payload.gz) return JSON.parse(await gunzipFromBase64(payload.gz)) as NatinfEntry[];
  if (payload.json) return JSON.parse(payload.json) as NatinfEntry[];
  throw new Error('Payload NATINF partagé vide.');
}

/**
 * Récupère le référentiel partagé (Electron uniquement). Retourne null si le
 * bridge est absent, le fichier inexistant, ou en cas d'erreur (repli embarqué).
 */
export async function pullSharedReferential(): Promise<{ payload: NatinfSharedPayload; entries: NatinfEntry[] } | null> {
  const bridge = getBridge();
  if (!bridge?.globalSync_pullNatinf) return null;
  try {
    const payload = (await bridge.globalSync_pullNatinf()) as NatinfSharedPayload | null;
    if (!payload || payload.schema !== 'natinf') return null;
    const entries = await decodeSharedPayload(payload);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return { payload, entries };
  } catch {
    return null;
  }
}

/** Lit les seules métadonnées du référentiel partagé (sans décoder les entrées). */
export async function pullSharedMeta(): Promise<NatinfSharedPayload | null> {
  const bridge = getBridge();
  if (!bridge?.globalSync_pullNatinf) return null;
  try {
    const payload = (await bridge.globalSync_pullNatinf()) as NatinfSharedPayload | null;
    return payload && payload.schema === 'natinf' ? payload : null;
  } catch {
    return null;
  }
}

/** Publie un référentiel pour tout le cabinet (admin). Retourne false si indispo. */
export async function publishSharedReferential(
  entries: NatinfEntry[],
  meta: { updatedBy: string; computerName?: string; source?: string },
): Promise<boolean> {
  const bridge = getBridge();
  if (!bridge?.globalSync_pushNatinf) return false;
  const payload = await buildSharedPayload(entries, meta);
  try {
    return Boolean(await bridge.globalSync_pushNatinf(payload));
  } catch {
    return false;
  }
}

/** Vrai si la publication au cabinet est possible (app Electron avec partage). */
export function canPublishShared(): boolean {
  return Boolean(getBridge()?.globalSync_pushNatinf);
}
