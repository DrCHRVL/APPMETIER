#!/usr/bin/env node
/**
 * SIRAL — construit une archive `.skill` (format Claude web) depuis un
 * dossier contenant un SKILL.md (front-matter name/description) et
 * d'éventuelles références markdown.
 *
 *   node scripts/build-skill.mjs docs/skills-attache/bilan-semestriel-crimorg
 *
 * Produit `<dossier>.skill` à côté du dossier. L'archive est un ZIP à
 * entrées STOCKÉES (sans compression) : lisible par l'import de SIRAL
 * (lib/web/skillImport.ts, méthode 0) comme par tout outil zip standard.
 * Le dossier racine de l'archive porte le nom du dossier source, et chaque
 * fichier .md y est placé avec son chemin relatif.
 */
import fs from 'node:fs'
import path from 'node:path'

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

/** ZIP à entrées stockées : [{ name, data }] → Buffer. */
export function zipStore(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.concat([
      Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data,
    ])
    centrals.push(Buffer.concat([
      Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBuf,
    ]))
    locals.push(local)
    offset += local.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    Buffer.from('PK\x05\x06', 'binary'), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...locals, centralDir, eocd])
}

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
