// utils/archiveState.ts — Autorité unique sur l'état d'archivage d'une enquête.
//
// PROBLÈME RÉSOLU
// ---------------
// L'archivage effectué par un collègue disparaissait dès que la copie locale
// portait un `dateMiseAJour` plus récent (une simple édition suffisait) :
// `mergeEnquete` retenait alors le statut « en_cours » de la copie locale ET
// effaçait `dateArchivage`. L'enquête repartait dans la grille des enquêtes en
// cours tout en conservant son résultat d'audience (synchronisé par un flux
// distinct, audience-data.json) — donc marteau vert sur la grille, rien dans
// les enquêtes terminées, et une audience à la fois « en attente » et « en
// cours ». La correction était ensuite repoussée au serveur : l'archivage
// était perdu pour tout le monde.
//
// PRINCIPE
// --------
// Le statut d'archivage ne se déduit plus de `dateMiseAJour` (qui bouge à
// chaque édition, archivage ou non) mais de preuves propres à l'archivage,
// par ordre de fiabilité décroissante :
//   1. les marqueurs monotones `dateArchivage` / `dateDesarchivage` — le plus
//      récent des deux l'emporte ;
//   2. le dernier évènement `enquete_archived` / `enquete_unarchived` du
//      journal `modifications` (fusionné par union d'ids : il porte donc les
//      évènements des DEUX copies, y compris ceux que la copie locale n'a
//      jamais vus). C'est ce qui permet de réparer rétroactivement les
//      enquêtes déjà désarchivées à tort ;
//   3. à défaut de toute trace, l'existence d'un résultat d'audience
//      « définitif » : un tel résultat ne peut naître que du circuit
//      d'archivage (ArchiveEnqueteModal), donc l'enquête a bien été terminée.

import { Enquete, ModificationEntry } from '@/types/interfaces';
import { ResultatAudience } from '@/types/audienceTypes';

/** Preuves d'archivage portées par une copie d'enquête (epoch ms, 0 = aucune). */
export interface ArchiveEvidence {
  archivedAt: number;
  unarchivedAt: number;
}

/** État d'archivage résolu. `null` = aucune preuve, l'appelant garde l'existant. */
export interface ResolvedArchiveState {
  statut: 'en_cours' | 'archive';
  dateArchivage?: string;
  dateDesarchivage?: string;
}

const ts = (iso: string | undefined): number => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
};

/**
 * Preuves d'archivage d'une seule copie : marqueurs de date + journal des
 * modifications. On prend le maximum des deux sources — le journal rattrape les
 * marqueurs effacés par l'ancienne fusion, les marqueurs rattrapent les
 * évènements évincés par le cap du journal (MAX_MODIFICATIONS).
 */
export function getArchiveEvidence(
  enquete: Pick<Enquete, 'dateArchivage' | 'dateDesarchivage' | 'modifications'> | undefined | null,
): ArchiveEvidence {
  if (!enquete) return { archivedAt: 0, unarchivedAt: 0 };
  let archivedAt = ts(enquete.dateArchivage);
  let unarchivedAt = ts(enquete.dateDesarchivage);
  for (const m of enquete.modifications || []) {
    if (m?.type === 'enquete_archived') archivedAt = Math.max(archivedAt, ts(m.timestamp));
    else if (m?.type === 'enquete_unarchived') unarchivedAt = Math.max(unarchivedAt, ts(m.timestamp));
  }
  return { archivedAt, unarchivedAt };
}

/** Union de deux jeux de preuves (fusion de deux copies d'une même enquête). */
export function mergeArchiveEvidence(a: ArchiveEvidence, b: ArchiveEvidence): ArchiveEvidence {
  return {
    archivedAt: Math.max(a.archivedAt, b.archivedAt),
    unarchivedAt: Math.max(a.unarchivedAt, b.unarchivedAt),
  };
}

/** Traduit des preuves en statut. `null` si aucune preuve d'aucun côté. */
export function stateFromEvidence(evidence: ArchiveEvidence): ResolvedArchiveState | null {
  const { archivedAt, unarchivedAt } = evidence;
  if (archivedAt === 0 && unarchivedAt === 0) return null;
  const iso = (t: number) => (t > 0 ? new Date(t).toISOString() : undefined);
  return {
    // À égalité stricte (même horodatage), l'archivage l'emporte : c'est l'état
    // qui préserve la donnée (le résultat d'audience reste rattaché aux
    // enquêtes terminées) et il se défait d'un clic.
    statut: archivedAt >= unarchivedAt ? 'archive' : 'en_cours',
    dateArchivage: iso(archivedAt),
    dateDesarchivage: iso(unarchivedAt),
  };
}

/**
 * Résout l'état d'archivage de deux copies d'une même enquête (fusion de sync).
 * `mergedModifications` : journal déjà fusionné (union par id) — évite de
 * refaire l'union et garantit qu'on voit les évènements des deux copies.
 */
export function resolveArchiveState(
  local: Enquete,
  server: Enquete,
  mergedModifications?: ModificationEntry[],
): ResolvedArchiveState | null {
  const evidence = mergeArchiveEvidence(
    getArchiveEvidence({ ...local, modifications: mergedModifications || local.modifications }),
    getArchiveEvidence({ ...server, modifications: mergedModifications || server.modifications }),
  );
  return stateFromEvidence(evidence);
}

/**
 * Vrai si le résultat d'audience atteste que l'enquête est passée par le
 * circuit d'archivage (audience à venir, résultats, OI ou classement sans
 * suite). Exclut le brouillon de saisies pré-archivage (l'enquête est encore
 * en cours) et les procédures de permanence (jamais rattachées à une enquête).
 */
export function isArchivingResult(resultat: ResultatAudience | undefined | null): boolean {
  if (!resultat) return false;
  if (resultat.isPreArchiveSaisies) return false;
  if (resultat.isDirectResult) return false;
  return !!resultat.dateAudience;
}

/**
 * Réparation locale : remet en cohérence le statut des enquêtes dont l'état
 * d'archivage a été perdu (ou inversé) par une fusion antérieure.
 *
 * `resultatOf` donne le résultat d'audience de l'enquête (clé composite
 * contentieux + id), utilisé comme dernière preuve quand aucune trace
 * d'archivage ne subsiste — cas des enquêtes archivées avant l'introduction du
 * journal des modifications, ou dont l'évènement a été évincé par le cap.
 *
 * `dateMiseAJour` n'est volontairement PAS touchée : la réparation corrige un
 * état local corrompu, elle ne crée pas une modification métier, et la faire
 * passer pour une édition récente ferait gagner cette copie sur les champs
 * scalaires lors de la prochaine fusion.
 */
export function repairArchiveState(
  enquetes: Enquete[],
  resultatOf: (enqueteId: number) => ResultatAudience | undefined | null,
): { enquetes: Enquete[]; repaired: Enquete[] } {
  const repaired: Enquete[] = [];

  const next = enquetes.map(e => {
    // Les dossiers passés à l'instruction ont leur propre cycle de vie.
    if (!e || e.statut === 'instruction') return e;

    const evidence = getArchiveEvidence(e);
    let resolved = stateFromEvidence(evidence);

    if (!resolved && e.statut !== 'archive') {
      // Aucune trace d'archivage : le résultat d'audience fait foi.
      const resultat = resultatOf(e.id);
      if (isArchivingResult(resultat)) {
        const at = resultat!.modifiedAt || resultat!.dateAudience;
        resolved = { statut: 'archive', dateArchivage: at, dateDesarchivage: undefined };
      }
    }

    if (!resolved || resolved.statut === e.statut) return e;

    const fixed: Enquete = {
      ...e,
      statut: resolved.statut,
      dateArchivage: resolved.dateArchivage,
      dateDesarchivage: resolved.dateDesarchivage,
    };
    repaired.push(fixed);
    return fixed;
  });

  return { enquetes: repaired.length > 0 ? next : enquetes, repaired };
}
