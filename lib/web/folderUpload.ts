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

/** Parcourt récursivement les items d'un drop (fichiers ET dossiers). */
export async function collectDropEntries(items: DataTransferItemList): Promise<Incoming[]> {
  const out: Incoming[] = []
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (!entry) return
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej))
      out.push({ file, path: prefix + file.name })
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      for (;;) {
        const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej))
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
