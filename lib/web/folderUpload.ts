/**
 * SIRAL — téléversement d'ARBORESCENCES entières dans le navigateur.
 *
 * Deux portes d'entrée, un seul format de sortie { file, path } :
 *  - sélection d'un dossier (input webkitdirectory → webkitRelativePath) ;
 *  - glisser-déposer récursif (DataTransferItem.webkitGetAsEntry, lecture
 *    des sous-pochettes par FileSystemDirectoryReader).
 * Utilisé par le « Dossier complet » (instruction), la section documents
 * des enquêtes et la base de connaissances de l'attaché.
 */

/** Fichier + chemin relatif, quel que soit le mode d'entrée (input ou drop). */
export interface Incoming { file: File; path: string }

/**
 * Parcourt récursivement les items d'un drop (fichiers ET dossiers).
 * Résilient : une entrée illisible (fichier verrouillé, dossier réseau
 * décroché, permission refusée) est signalée via `onSkip` et n'interrompt
 * JAMAIS la collecte — indispensable pour verser des dossiers d'enquête
 * entiers depuis un partage Windows.
 */
export async function collectDropEntries(
  items: DataTransferItemList,
  onSkip?: (path: string) => void,
): Promise<Incoming[]> {
  const out: Incoming[] = []
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (!entry) return
    if (entry.isFile) {
      try {
        const file: File = await new Promise((res, rej) => entry.file(res, rej))
        out.push({ file, path: prefix + file.name })
      } catch {
        onSkip?.(prefix + String(entry.name || '?'))
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        let batch: any[]
        try {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej))
        } catch {
          onSkip?.(prefix + entry.name + '/')
          break
        }
        if (!batch.length) break
        for (const child of batch) await walk(child, prefix + entry.name + '/')
      }
    }
  }
  const entries = Array.from(items).map((it) => (it as any).webkitGetAsEntry?.()).filter(Boolean)
  for (const e of entries) await walk(e, '')
  return out
}

/** FileList (input multiple ou webkitdirectory) → Incoming[], chemins préservés. */
export function incomingFromFileList(files: FileList | null): Incoming[] {
  return Array.from(files || []).map((f) => ({
    file: f,
    path: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name),
  }))
}

/** Nettoie un chemin relatif : segments sûrs, séparateur '/', pas de dotfiles. */
export function cleanRelPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, ''))
    .filter(Boolean)
    .join('/')
}

/**
 * Normalisation d'UN segment de chemin, IDENTIQUE à celle du pont de données
 * (bridge → depositDocument) : accents décomposés retirés, caractères hors
 * [a-zA-Z0-9._ -] remplacés, espaces soudés, 120 caractères max.
 * Unique source de vérité — le pont l'importe d'ici.
 */
export function encodeDocSegment(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/ +/g, '_').slice(0, 120)
}

/**
 * Chemin serveur EXACT que produira depositDocument pour <zone>/<path>.
 * Prévoir ce chemin AVANT le dépôt permet de dédupliquer contre l'index
 * serveur et de REPRENDRE un versement interrompu sans créer de doublons.
 * Les chemins trop profonds (limite serveur ~580 caractères) sont raccourcis
 * en repliant les pochettes intermédiaires — le fichier est versé quand même.
 */
export function serverRelPath(zone: string, path: string): string {
  const segs = cleanRelPath(path)
    .split('/')
    .map((seg) => encodeDocSegment(seg))
    .filter((seg) => seg && !seg.startsWith('.'))
  if (!segs.length) return ''
  let rel = zone + '/' + segs.join('/')
  // marge sous la limite (580) pour laisser la place aux suffixes anti-collision (_1, _2…)
  while (rel.length > 560 && segs.length > 2) {
    segs.splice(1, 1) // replie la pochette la plus haute ; pochette terminale et nom conservés
    rel = zone + '/' + segs.join('/')
  }
  if (rel.length > 560) rel = zone + '/' + segs[segs.length - 1].slice(0, 560 - zone.length - 1)
  return rel
}
