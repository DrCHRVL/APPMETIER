// La fiche d'un dossier ne doit lister une pièce qu'UNE fois. L'identifiant
// d'une entrée est fabriqué localement (Date.now()) : la même pièce inscrite
// depuis deux onglets, deux postes ou deux synchronisations portait deux ids,
// et l'union par id des fusions la gardait en double (jusqu'à 3 fois).
// Clé de dédoublonnage : le CHEMIN (une pièce = un chemin sur le serveur).
// Position de la première occurrence, valeur de la DERNIÈRE (la plus récente
// dans l'ordre fourni) — même règle « le plus récent gagne » que les fusions.

type AvecChemin = { id: number | string; cheminRelatif?: string };

export function dedupeDocuments<T extends AvecChemin>(docs: T[]): T[] {
  const parCle = new Map<string, T>();
  for (const d of docs) {
    const cle = d.cheminRelatif ? `chemin:${d.cheminRelatif}` : `id:${d.id}`;
    parCle.set(cle, d); // clé déjà vue : position conservée, valeur remplacée
  }
  return Array.from(parCle.values());
}
