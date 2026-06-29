// Client de l'API serveur du référentiel NATINF.
// Le navigateur interroge le serveur (/api/natinf) ; rien n'est embarqué côté
// client. Voir app/api/natinf/route.ts.

import type { NatinfEntry } from '@/types/natinf';

export interface NatinfMeta {
  published: boolean;
  version: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  source: string | null;
  count: number;
}

/** Récupère le référentiel courant depuis le serveur. */
export async function fetchReferential(): Promise<NatinfEntry[]> {
  const res = await fetch('/api/natinf', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`NATINF: réponse serveur ${res.status}`);
  return (await res.json()) as NatinfEntry[];
}

/** Métadonnées de la version publiée (sans les entrées). */
export async function fetchMeta(): Promise<NatinfMeta> {
  const res = await fetch('/api/natinf?meta=1', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`NATINF meta: réponse serveur ${res.status}`);
  return (await res.json()) as NatinfMeta;
}

/** Publie un nouveau référentiel (admin). */
export async function publishReferential(
  entries: NatinfEntry[],
  source?: string,
): Promise<{ ok: boolean; version: number; count: number }> {
  const res = await fetch('/api/natinf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries, source }),
  });
  if (!res.ok) {
    let msg = `réponse serveur ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  return (await res.json()) as { ok: boolean; version: number; count: number };
}

/** Saisie manuelle d'une infraction (admin). Le serveur refuse un numéro déjà
 *  utilisé (HTTP 409). */
export interface NewNatinfEntryInput {
  code: string;
  libelle: string;
  articlesDefinition?: string;
  articlesRepression?: string;
}

export async function addNatinfEntry(
  entry: NewNatinfEntryInput,
): Promise<{ ok: boolean; version: number; count: number }> {
  const res = await fetch('/api/natinf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ addEntry: entry }),
  });
  if (!res.ok) {
    let msg = `réponse serveur ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }
  return (await res.json()) as { ok: boolean; version: number; count: number };
}
