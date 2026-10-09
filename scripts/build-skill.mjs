#!/usr/bin/env node
/**
 * SIRAL — construit une archive `.skill` (format Claude web) depuis un
 * dossier contenant un SKILL.md (front-matter name/description) et
 * d'éventuelles références markdown.
 *
 *   node scripts/build-skill.mjs docs/skills-attache/bilan-semestriel-crimorg
 *
 * Produit `<dossier>.skill` à côté du dossier. L'archive est un ZIP à
 * entrées STOCKÉES (sans compression, scripts/attache/zip.mjs) : lisible par
 * l'import de SIRAL (lib/web/skillImport.ts, méthode 0) comme par tout outil
 * zip standard.
 * Le dossier racine de l'archive porte le nom du dossier source, et chaque
 * fichier .md y est placé avec son chemin relatif.
 */
import fs from 'node:fs'
import path from 'node:path'
import { zipStore } from './attache/zip.mjs'

function listMarkdown(dir, base = '') {
  const out = []
  for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (f.name.startsWith('.')) continue
    const rel = base ? `${base}/${f.name}` : f.name
    if (f.isDirectory()) out.push(...listMarkdown(path.join(dir, f.name), rel))
    else if (/\.md$/i.test(f.name)) out.push(rel)
  }
  return out
}

const main = () => {
  const src = process.argv[2]
  if (!src || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    console.error('Usage : node scripts/build-skill.mjs <dossier-de-skill>')
    process.exit(1)
  }
  const dir = path.resolve(src)
  const nom = path.basename(dir)
  const fichiers = listMarkdown(dir)
  if (!fichiers.some((f) => /^skill\.md$/i.test(f))) {
    console.error(`SKILL.md absent de ${dir}`)
    process.exit(1)
  }
  // SKILL.md en tête (l'import prend le premier .md pertinent), puis les références
  fichiers.sort((a, b) => Number(!/^skill\.md$/i.test(a)) - Number(!/^skill\.md$/i.test(b)) || a.localeCompare(b))
  const entries = fichiers.map((rel) => ({ name: `${nom}/${rel}`, data: fs.readFileSync(path.join(dir, rel)) }))
  const cible = `${dir}.skill`
  fs.writeFileSync(cible, zipStore(entries))
  console.log(`✅ ${path.relative(process.cwd(), cible)} — ${entries.length} fichier(s) : ${fichiers.join(', ')}`)
}

main()
