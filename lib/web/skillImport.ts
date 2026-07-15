/**
 * SIRAL — import des skills Claude web (.skill), dans le navigateur.
 *
 * Un fichier .skill est une archive ZIP : un dossier racine contenant
 * SKILL.md (avec un en-tête YAML name/description) et, souvent, des
 * références markdown (references/*.md). On reconstruit une skill SIRAL :
 *  - nom : le « name » du front-matter, sinon le dossier racine, sinon le
 *    nom du fichier ;
 *  - description : le « description » du front-matter (c'est elle qui
 *    déclenche la skill) ;
 *  - contenu : le corps de SKILL.md suivi des références, chacune sous un
 *    titre « ## Référence : <chemin> » — la skill reste un SEUL markdown,
 *    fidèle à la mécanique de divulgation progressive de l'attaché.
 */
import { zipEntries, decodeText } from './fileToMarkdown'

export interface ImportedSkill {
  nom: string
  description: string
  contenu: string
  avertissement?: string
}

/**
 * Extrait le front-matter YAML simple (name/description) d'un SKILL.md.
 * Gère les scalaires bloc (`description: >` ou `|`) : les lignes indentées
 * qui suivent sont repliées en une seule chaîne.
 */
function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return { meta: {}, body: md }
  const meta: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let value = kv[2].trim()
    if (/^[>|][+-]?$/.test(value)) {
      // scalaire bloc : replier les lignes indentées suivantes
      const folded: string[] = []
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        i++
        folded.push(lines[i].trim())
      }
      value = folded.join(' ').replace(/\s+/g, ' ').trim()
    }
    meta[kv[1].toLowerCase()] = value.replace(/^["']|["']$/g, '')
  }
  return { meta, body: md.slice(m[0].length) }
}

/** Importe un .skill (ou .zip de skill) Claude web. */
export async function skillFromArchive(fileName: string, bytes: Uint8Array): Promise<ImportedSkill> {
  const entries = await zipEntries(bytes)
  if (!entries.length) throw new Error('archive vide ou illisible')
  const mdEntries = entries.filter((e) => e.name.toLowerCase().endsWith('.md'))
  if (!mdEntries.length) throw new Error('aucun markdown dans l\'archive — est-ce bien une skill ?')

  const skillMd = mdEntries.find((e) => /(^|\/)skill\.md$/i.test(e.name)) || mdEntries[0]
  const { meta, body } = parseFrontmatter(decodeText(skillMd.data))

  const rootDir = skillMd.name.includes('/') ? skillMd.name.split('/')[0] : ''
  const nom = meta.name || rootDir || fileName.replace(/\.(skill|zip)$/i, '')
  const description = meta.description || ''

  const parts = [body.trim()]
  const refs = mdEntries.filter((e) => e !== skillMd)
  for (const ref of refs) {
    const rel = rootDir && ref.name.startsWith(rootDir + '/') ? ref.name.slice(rootDir.length + 1) : ref.name
    parts.push(`\n\n---\n\n## Référence : ${rel}\n\n${decodeText(ref.data).trim()}`)
  }
  const nonMd = entries.length - mdEntries.length
  return {
    nom,
    description,
    contenu: parts.join('').slice(0, 200_000),
    avertissement: nonMd > 0 ? `${nonMd} fichier(s) non-markdown de l'archive ignoré(s) (scripts, images…)` : undefined,
  }
}
