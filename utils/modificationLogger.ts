// utils/modificationLogger.ts — Suivi des modifications inter-utilisateurs sur une enquête.
//
// Stratégie : un tableau `modifications[]` est attaché directement à chaque Enquete,
// capé à MAX_MODIFICATIONS pour éviter l'inflation du JSON. Chaque entrée porte
// un id unique pour permettre une union sans doublons lors du merge de sync.
//
// La détection de "non lu" se fait via `lastViewedBy[username]` (timestamp ISO de
// la dernière consultation) : on n'alerte jamais l'utilisateur de ses propres
// modifications.

import {
  Enquete,
  ModificationEntry,
  ModificationType,
  AutreActe,
  EcouteData,
  GeolocData,
  MisEnCause,
  DocumentEnquete,
  ToDoItem,
  CompteRendu,
} from '@/types/interfaces';
import { useUserStore } from '@/stores/useUserStore';

export const MAX_MODIFICATIONS = 50;

interface PendingEntry {
  type: ModificationType;
  label: string;
  targetId?: number;
}

function makeEntryId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentUser(): { username: string; displayName: string } | null {
  const user = useUserStore.getState().user;
  if (!user || !user.windowsUsername) return null;
  return { username: user.windowsUsername, displayName: user.displayName || user.windowsUsername };
}

/**
 * Renvoie une nouvelle Enquete avec les entrées fournies ajoutées à `modifications`.
 * Si l'utilisateur courant n'est pas connu, l'enquête est renvoyée inchangée.
 */
export function appendModifications(enquete: Enquete, entries: PendingEntry[]): Enquete {
  if (!entries || entries.length === 0) return enquete;
  const user = getCurrentUser();
  if (!user) return enquete;

  const timestamp = new Date().toISOString();
  const newEntries: ModificationEntry[] = entries.map((e) => ({
    id: makeEntryId(),
    type: e.type,
    label: e.label,
    targetId: e.targetId,
    user,
    timestamp,
  }));

  const existing = enquete.modifications || [];
  const merged = [...existing, ...newEntries];
  const trimmed = merged.length > MAX_MODIFICATIONS ? merged.slice(merged.length - MAX_MODIFICATIONS) : merged;
  return { ...enquete, modifications: trimmed };
}

/**
 * Compare un état antérieur d'enquête avec un patch de mise à jour pour produire
 * la liste d'entrées de modification correspondantes.
 *
 * Ne tient compte que des champs métier visibles par l'utilisateur ; les patchs
 * techniques (lastViewedBy, modifications, dateMiseAJour seuls) ne génèrent rien
 * — c'est au caller de filtrer avant d'appeler.
 */
export function diffEnqueteUpdates(prev: Enquete, updates: Partial<Enquete>): PendingEntry[] {
  const out: PendingEntry[] = [];

  diffArray<AutreActe>(
    prev,
    updates,
    'actes',
    'acte_added',
    'acte_modified',
    'acte_deleted',
    (a) => `acte ${a.type || ''}`.trim(),
    out,
  );
  diffArray<EcouteData>(
    prev,
    updates,
    'ecoutes',
    'ecoute_added',
    'ecoute_modified',
    'ecoute_deleted',
    (e) => `écoute ${e.numero || ''}`.trim(),
    out,
  );
  diffArray<GeolocData>(
    prev,
    updates,
    'geolocalisations',
    'geoloc_added',
    'geoloc_modified',
    'geoloc_deleted',
    (g) => `géoloc ${g.objet || ''}`.trim(),
    out,
  );
  diffArray<MisEnCause>(
    prev,
    updates,
    'misEnCause',
    'mec_added',
    'mec_modified',
    'mec_deleted',
    (m) => `MEC ${m.nom || ''}`.trim(),
    out,
  );

  if ('documents' in updates) {
    const prevArr = (prev.documents as DocumentEnquete[]) || [];
    const newArr = (updates.documents as DocumentEnquete[]) || [];
    const prevIds = new Set(prevArr.map((d) => d.id));
    const newIds = new Set(newArr.map((d) => d.id));
    for (const d of newArr) {
      if (!prevIds.has(d.id)) {
        out.push({ type: 'document_added', label: `Document ajouté : ${d.nomOriginal}`, targetId: d.id });
      }
    }
    for (const d of prevArr) {
      if (!newIds.has(d.id)) {
        out.push({ type: 'document_deleted', label: `Document supprimé : ${d.nomOriginal}`, targetId: d.id });
      }
    }
  }

  if ('toDos' in updates) {
    const prevArr = (prev.toDos as ToDoItem[]) || [];
    const newArr = (updates.toDos as ToDoItem[]) || [];
    const prevMap = new Map(prevArr.map((t) => [t.id, t]));
    const newMap = new Map(newArr.map((t) => [t.id, t]));
    for (const [id, t] of newMap) {
      const old = prevMap.get(id);
      if (!old) {
        out.push({ type: 'todo_added', label: `Tâche ajoutée : ${t.text}`, targetId: id });
      } else if (old.status !== t.status && t.status === 'completed') {
        out.push({ type: 'todo_completed', label: `Tâche terminée : ${t.text}`, targetId: id });
      }
    }
    for (const [id, t] of prevMap) {
      if (!newMap.has(id)) {
        out.push({ type: 'todo_deleted', label: `Tâche supprimée : ${t.text}`, targetId: id });
      }
    }
  }

  // Champs d'identité de l'enquête : on regroupe en une seule entrée descriptive
  const generalFields: Array<{ key: keyof Enquete; label: string }> = [
    { key: 'numero', label: 'numéro' },
    { key: 'dateDebut', label: 'date de début' },
    { key: 'dateOP', label: "date d'OP" },
    { key: 'description', label: 'description' },
    { key: 'numeroParquet', label: 'numéro de parquet' },
    { key: 'directeurEnquete', label: "directeur d'enquête" },
  ];
  const changed: string[] = [];
  for (const { key, label } of generalFields) {
    if (key in updates && updates[key] !== prev[key]) {
      changed.push(label);
    }
  }
  if (changed.length > 0) {
    out.push({
      type: 'general_info_updated',
      label: `Infos générales mises à jour (${changed.join(', ')})`,
    });
  }

  return out;
}

function diffArray<T extends { id: number }>(
  prev: Enquete,
  updates: Partial<Enquete>,
  field: keyof Enquete,
  addedType: ModificationType,
  modifiedType: ModificationType,
  deletedType: ModificationType,
  describe: (item: T) => string,
  out: PendingEntry[],
): void {
  if (!(field in updates)) return;
  const prevArr = ((prev[field] as unknown as T[] | undefined) || []) as T[];
  const newArr = ((updates[field] as unknown as T[] | undefined) || []) as T[];
  const prevMap = new Map<number, T>(prevArr.map((i) => [i.id, i]));
  const newMap = new Map<number, T>(newArr.map((i) => [i.id, i]));

  for (const [id, item] of newMap) {
    const old = prevMap.get(id);
    if (!old) {
      out.push({ type: addedType, label: `Ajout : ${describe(item)}`, targetId: id });
    } else if (JSON.stringify(old) !== JSON.stringify(item)) {
      out.push({ type: modifiedType, label: `Modification : ${describe(item)}`, targetId: id });
    }
  }
  for (const [id, item] of prevMap) {
    if (!newMap.has(id)) {
      out.push({ type: deletedType, label: `Suppression : ${describe(item)}`, targetId: id });
    }
  }
}

/**
 * Liste les modifications non vues par l'utilisateur courant (excluant ses propres modifications).
 */
export function getUnseenModifications(
  enquete: Enquete,
  currentUsername: string | undefined,
): ModificationEntry[] {
  if (!currentUsername || !enquete.modifications || enquete.modifications.length === 0) return [];
  const lastSeen = enquete.lastViewedBy?.[currentUsername];
  return enquete.modifications.filter(
    (m) => m.user.username !== currentUsername && (!lastSeen || m.timestamp > lastSeen),
  );
}

/**
 * Met à jour `lastViewedBy[username]` à l'instant courant.
 */
export function markEnqueteAsSeenForUser(enquete: Enquete, username: string): Enquete {
  return {
    ...enquete,
    lastViewedBy: { ...(enquete.lastViewedBy || {}), [username]: new Date().toISOString() },
  };
}

/**
 * Helper pour la fusion sync : union des entrées par id, tri chrono, cap.
 */
export function mergeModifications(
  a: ModificationEntry[] | undefined,
  b: ModificationEntry[] | undefined,
): ModificationEntry[] {
  const map = new Map<string, ModificationEntry>();
  for (const m of a || []) map.set(m.id, m);
  for (const m of b || []) map.set(m.id, m);
  const arr = Array.from(map.values()).sort((x, y) => x.timestamp.localeCompare(y.timestamp));
  return arr.length > MAX_MODIFICATIONS ? arr.slice(arr.length - MAX_MODIFICATIONS) : arr;
}

/**
 * Helper pour la fusion sync : par utilisateur, on garde le timestamp le plus récent.
 */
export function mergeLastViewedBy(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): Record<string, string> {
  const merged: Record<string, string> = { ...(b || {}) };
  for (const [user, ts] of Object.entries(a || {})) {
    if (!merged[user] || ts > merged[user]) merged[user] = ts;
  }
  return merged;
}

/**
 * Crée l'entrée pour un CR ajouté.
 */
export function makeCRAddedEntry(cr: CompteRendu): PendingEntry {
  return {
    type: 'cr_added',
    label: `CR ajouté du ${new Date(cr.date).toLocaleDateString('fr-FR')}${cr.enqueteur ? ` (${cr.enqueteur})` : ''}`,
    targetId: cr.id,
  };
}

export function makeCRModifiedEntry(cr: CompteRendu): PendingEntry {
  return {
    type: 'cr_modified',
    label: `CR modifié du ${new Date(cr.date).toLocaleDateString('fr-FR')}`,
    targetId: cr.id,
  };
}

export function makeCRDeletedEntry(cr: CompteRendu | undefined, crId: number): PendingEntry {
  return {
    type: 'cr_deleted',
    label: cr
      ? `CR supprimé du ${new Date(cr.date).toLocaleDateString('fr-FR')}`
      : 'Compte-rendu supprimé',
    targetId: crId,
  };
}
