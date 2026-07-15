/**
 * SIRAL — conversion de documents en markdown, DANS le navigateur.
 *
 * Utilisé par les téléversements vers l'attaché (base de connaissances,
 * bibliothèque de trames) : le fichier est converti ICI puis chiffré par le
 * navigateur — il ne quitte jamais le poste en clair, l'app ne voit qu'une
 * enveloppe. Convertir UNE FOIS au téléversement (plutôt que re-parser le
 * PDF à chaque lecture) économise la place serveur et les tokens de l'IA.
 *
 * Formats couverts SANS dépendance nouvelle :
 *  - PDF   : pdfjs-dist (déjà présent, worker public/pdf.worker.min.mjs)
 *  - ODT   : zip (DecompressionStream natif) + content.xml via DOMParser
 *  - DOCX  : zip + word/document.xml via DOMParser
 *  - DOC   : ancien Word binaire (CFB + piece table), parseur maison ci-dessous
 *  - TXT / MD / CSV / EML / LOG : décodage direct (UTF-8, repli windows-1252)
 *  - HTML  : texte extrait via DOMParser
 */

export interface ConversionResult {
  markdown: string
  avertissement?: string
}

const MAX_CHARS = 400_000

// ── Décodage texte : UTF-8 strict, sinon windows-1252 (fichiers Windows FR) ──
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// ── Mini-lecteur ZIP (ODT/DOCX) : répertoire central + deflate-raw natif ──

function u16(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8) }
function u32(b: Uint8Array, o: number): number { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => GenericTransformStream }).DecompressionStream
  if (!DS) throw new Error('navigateur trop ancien (DecompressionStream absent)')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
  return new Uint8Array(await new Response(stream as ReadableStream).arrayBuffer())
}

/** Extrait UNE entrée d'un zip (le fichier XML utile d'un ODT/DOCX). */
async function zipEntry(bytes: Uint8Array, wantedName: string): Promise<Uint8Array | null> {
  // End Of Central Directory : signature 0x06054b50, cherchée depuis la fin
  let eocd = -1
  const min = Math.max(0, bytes.length - 65_557)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = u16(bytes, eocd + 10)
  let off = u32(bytes, eocd + 16)
  for (let n = 0; n < count; n++) {
    if (u32(bytes, off) !== 0x02014b50) return null
    const method = u16(bytes, off + 10)
    const compSize = u32(bytes, off + 20)
    const nameLen = u16(bytes, off + 28)
    const extraLen = u16(bytes, off + 30)
    const commentLen = u16(bytes, off + 32)
    const localOff = u32(bytes, off + 42)
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen))
    if (name === wantedName) {
      if (u32(bytes, localOff) !== 0x04034b50) return null
      const lNameLen = u16(bytes, localOff + 26)
      const lExtraLen = u16(bytes, localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const data = bytes.subarray(start, start + compSize)
      if (method === 0) return data
      if (method === 8) return inflateRaw(data)
      return null
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return null
}

/** Liste TOUTES les entrées d'un zip (import des .skill Claude web, archives). */
export async function zipEntries(bytes: Uint8Array): Promise<Array<{ name: string; data: Uint8Array }>> {
  let eocd = -1
  const min = Math.max(0, bytes.length - 65_557)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return []
  const count = u16(bytes, eocd + 10)
  let off = u32(bytes, eocd + 16)
  const out: Array<{ name: string; data: Uint8Array }> = []
  for (let n = 0; n < count; n++) {
    if (u32(bytes, off) !== 0x02014b50) break
    const method = u16(bytes, off + 10)
    const compSize = u32(bytes, off + 20)
    const nameLen = u16(bytes, off + 28)
    const extraLen = u16(bytes, off + 30)
    const commentLen = u16(bytes, off + 32)
    const localOff = u32(bytes, off + 42)
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue // répertoires
    if (u32(bytes, localOff) !== 0x04034b50) continue
    const lNameLen = u16(bytes, localOff + 26)
    const lExtraLen = u16(bytes, localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    const data = bytes.subarray(start, start + compSize)
    try {
      if (method === 0) out.push({ name, data })
      else if (method === 8) out.push({ name, data: await inflateRaw(data) })
    } catch { /* entrée illisible : ignorée */ }
  }
  return out
}

// ── DOC (Word 97-2003) : conteneur CFB + piece table du flux WordDocument ──
// Lecture du strict nécessaire de [MS-CFB] et [MS-DOC] pour extraire le texte :
// FAT/miniFAT → flux WordDocument et xTable → FIB → CLX → morceaux de texte
// (CP1252 « compressé » ou UTF-16LE). Repli heuristique si la structure dévie.

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const FREESECT = 0xffffffff
const ENDOFCHAIN = 0xfffffffe

interface CfbFile { sectorSize: number; fat: Uint32Array; miniFat: Uint32Array; miniStream: Uint8Array; miniCutoff: number; bytes: Uint8Array; dir: Array<{ name: string; type: number; start: number; size: number }> }

function cfbSector(bytes: Uint8Array, sectorSize: number, n: number): number {
  return (n + 1) * sectorSize
}

function cfbChain(bytes: Uint8Array, sectorSize: number, fat: Uint32Array, start: number, size: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, size))
  let sect = start
  let pos = 0
  let guard = 0
  while (sect !== ENDOFCHAIN && sect !== FREESECT && pos < size) {
    if (++guard > 1_000_000 || sect >= fat.length) break
    const off = cfbSector(bytes, sectorSize, sect)
    const len = Math.min(sectorSize, size - pos)
    out.set(bytes.subarray(off, off + len), pos)
    pos += len
    sect = fat[sect]
  }
  return out
}

function parseCfb(bytes: Uint8Array): CfbFile {
  for (let i = 0; i < 8; i++) if (bytes[i] !== CFB_MAGIC[i]) throw new Error('conteneur CFB invalide')
  const sectorShift = u16(bytes, 30)
  const sectorSize = 1 << sectorShift
  const numFat = u32(bytes, 44)
  const firstDir = u32(bytes, 48)
  const miniCutoff = u32(bytes, 56)
  const firstMiniFat = u32(bytes, 60)
  const numMiniFat = u32(bytes, 64)
  let difatSect = u32(bytes, 68)
  const fatSectors: number[] = []
  for (let i = 0; i < 109; i++) {
    const s = u32(bytes, 76 + i * 4)
    if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s)
  }
  let guard = 0
  while (difatSect !== ENDOFCHAIN && difatSect !== FREESECT && ++guard < 4096) {
    const off = cfbSector(bytes, sectorSize, difatSect)
    const perSector = sectorSize / 4 - 1
    for (let i = 0; i < perSector; i++) {
      const s = u32(bytes, off + i * 4)
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s)
    }
    difatSect = u32(bytes, off + sectorSize - 4)
  }
  const fat = new Uint32Array(Math.min(fatSectors.length, numFat || fatSectors.length) * (sectorSize / 4))
  let fi = 0
  for (const s of fatSectors.slice(0, numFat || fatSectors.length)) {
    const off = cfbSector(bytes, sectorSize, s)
    for (let i = 0; i < sectorSize / 4; i++) fat[fi++] = u32(bytes, off + i * 4)
  }
  // répertoire : chaîne depuis firstDir (taille inconnue → suivre la chaîne)
  const dirSectors: number[] = []
  let ds = firstDir
  guard = 0
  while (ds !== ENDOFCHAIN && ds !== FREESECT && ds < fat.length && ++guard < 65_536) {
    dirSectors.push(ds)
    ds = fat[ds]
  }
  const dir: CfbFile['dir'] = []
  for (const s of dirSectors) {
    const base = cfbSector(bytes, sectorSize, s)
    for (let e = 0; e < sectorSize / 128; e++) {
      const off = base + e * 128
      if (off + 128 > bytes.length) break
      const nameLen = u16(bytes, off + 64)
      if (nameLen < 2 || nameLen > 64) { dir.push({ name: '', type: 0, start: 0, size: 0 }); continue }
      let name = ''
      for (let c = 0; c < nameLen - 2; c += 2) name += String.fromCharCode(bytes[off + c] | (bytes[off + c + 1] << 8))
      dir.push({ name, type: bytes[off + 66], start: u32(bytes, off + 116), size: u32(bytes, off + 120) })
    }
  }
  const root = dir.find((d) => d.type === 5)
  const miniStream = root ? cfbChain(bytes, sectorSize, fat, root.start, root.size) : new Uint8Array(0)
  const mfBytes = cfbChain(bytes, sectorSize, fat, firstMiniFat, numMiniFat * sectorSize)
  const miniFat = new Uint32Array(mfBytes.length / 4)
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(mfBytes, i * 4)
  return { sectorSize, fat, miniFat, miniStream, miniCutoff: miniCutoff || 4096, bytes, dir }
}

function cfbStream(cfb: CfbFile, name: string): Uint8Array | null {
  const entry = cfb.dir.find((d) => d.type === 2 && d.name === name)
  if (!entry) return null
  if (entry.size >= cfb.miniCutoff) return cfbChain(cfb.bytes, cfb.sectorSize, cfb.fat, entry.start, entry.size)
  // flux « mini » : chaîne de mini-secteurs de 64 octets dans le mini stream
  const out = new Uint8Array(entry.size)
  let sect = entry.start
  let pos = 0
  let guard = 0
  while (sect !== ENDOFCHAIN && sect !== FREESECT && pos < entry.size && ++guard < 1_000_000) {
    const off = sect * 64
    const len = Math.min(64, entry.size - pos)
    out.set(cfb.miniStream.subarray(off, off + len), pos)
    pos += len
    if (sect >= cfb.miniFat.length) break
    sect = cfb.miniFat[sect]
  }
  return out
}

/** Nettoie les caractères de contrôle Word (champs, cellules, sauts). */
function tidyDocText(raw: string): string {
  let out = ''
  let fieldDepth = 0      // 0x13 … 0x14 : code de champ (masqué)
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (code === 0x13) { fieldDepth++; continue }         // début de champ
    if (code === 0x14) { if (fieldDepth > 0) fieldDepth--; continue } // séparateur : la suite est le texte affiché
    if (code === 0x15) continue                            // fin de champ
    if (fieldDepth > 0) continue                           // code de champ (HYPERLINK…) : masqué
    if (code === 0x0d) { out += '\n'; continue }           // fin de paragraphe
    if (code === 0x07) { out += '\t'; continue }           // fin de cellule/ligne de tableau
    if (code === 0x0b) { out += '\n'; continue }           // saut de ligne manuel
    if (code === 0x0c) { out += '\n\n'; continue }         // saut de page/section
    if (code === 0x1e) { out += '-'; continue }            // trait d'union insécable
    if (code === 0x1f) continue                            // césure conditionnelle
    if (code === 0xa0) { out += ' '; continue }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) continue // autres contrôles (objets ancrés…)
    out += ch
  }
  return out.replace(/\n{3,}/g, '\n\n')
}

function docToMarkdown(bytes: Uint8Array): string {
  const cfb = parseCfb(bytes)
  const ws = cfbStream(cfb, 'WordDocument')
  if (!ws || ws.length < 0x200) throw new Error('flux WordDocument introuvable — DOC invalide')
  if (u16(ws, 0) !== 0xa5ec) throw new Error('signature Word absente — DOC invalide')
  const flags = u16(ws, 0x0a)
  const tableName = (flags & 0x0200) ? '1Table' : '0Table'
  const table = cfbStream(cfb, tableName)

  // bornes du FIB : csw / fibRgW / cslw / fibRgLw / cbRgFcLcb / fibRgFcLcb
  const csw = u16(ws, 32)
  const lwStart = 32 + 2 + csw * 2 + 2
  const cslw = u16(ws, 32 + 2 + csw * 2)
  const ccpText = u32(ws, lwStart + 12)
  const blobStart = lwStart + cslw * 4 + 2
  const fcClx = u32(ws, blobStart + 264)
  const lcbClx = u32(ws, blobStart + 268)

  if (table && lcbClx > 0 && fcClx + lcbClx <= table.length) {
    // CLX : sauter les Prc (0x01), lire le Pcdt (0x02) → PlcPcd
    let pos = fcClx
    const end = fcClx + lcbClx
    while (pos < end && table[pos] === 0x01) {
      const cb = u16(table, pos + 1)
      pos += 3 + cb
    }
    if (pos < end && table[pos] === 0x02) {
      const lcb = u32(table, pos + 1)
      const plc = pos + 5
      const n = Math.floor((lcb - 4) / 12)
      if (n > 0 && plc + lcb <= end + 12) {
        const cps: number[] = []
        for (let i = 0; i <= n; i++) cps.push(u32(table, plc + i * 4))
        const parts: string[] = []
        let total = 0
        for (let i = 0; i < n && total < ccpText; i++) {
          const pcdOff = plc + (n + 1) * 4 + i * 8
          const fcRaw = u32(table, pcdOff + 2)
          const compressed = (fcRaw & 0x40000000) !== 0
          const fc = fcRaw & 0x3fffffff
          const want = Math.min(cps[i + 1], ccpText) - cps[i]
          if (want <= 0) continue
          if (compressed) {
            const start = fc >> 1
            parts.push(new TextDecoder('windows-1252').decode(ws.subarray(start, start + want)))
          } else {
            const seg = ws.subarray(fc, fc + want * 2)
            let s = ''
            for (let c = 0; c + 1 < seg.length; c += 2) s += String.fromCharCode(seg[c] | (seg[c + 1] << 8))
            parts.push(s)
          }
          total += want
        }
        const text = tidyDocText(parts.join(''))
        if (text.trim()) return text
      }
    }
  }

  // Repli : plage fcMin..fcMac du flux WordDocument (documents simples non Unicode)
  const fcMin = u32(ws, 0x18)
  const fcMac = u32(ws, 0x1c)
  if (fcMac > fcMin && fcMac <= ws.length) {
    const ansi = tidyDocText(new TextDecoder('windows-1252').decode(ws.subarray(fcMin, fcMac)))
    const printable = ansi.replace(/[^\p{L}\p{N}\p{P} \n\t]/gu, '')
    if (ansi.length && printable.length / ansi.length > 0.8) return ansi
    // essai UTF-16LE
    const seg = ws.subarray(fcMin, fcMac)
    let s = ''
    for (let c = 0; c + 1 < seg.length; c += 2) s += String.fromCharCode(seg[c] | (seg[c + 1] << 8))
    const utf = tidyDocText(s)
    const printableU = utf.replace(/[^\p{L}\p{N}\p{P} \n\t]/gu, '')
    if (utf.length && printableU.length / utf.length > 0.8) return utf
  }
  throw new Error('texte introuvable dans ce fichier .doc — réenregistrez-le en .docx ou PDF')
}

// ── ODT : parcours de office:text (titres, paragraphes, listes, tableaux) ──

function odtInlineText(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) { out += child.textContent; return }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    switch (el.localName) {
      case 'tab': out += '\t'; break
      case 'line-break': out += '\n'; break
      case 's': out += ' '.repeat(Math.max(1, Number(el.getAttribute('text:c') || 1))); break
      case 'note': break // notes de bas de page : ignorées (hors flux)
      default: out += odtInlineText(el)
    }
  })
  return out
}

function odtBlocks(parent: Node, out: string[]): void {
  parent.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    switch (el.localName) {
      case 'h': {
        const level = Math.min(6, Math.max(1, Number(el.getAttribute('text:outline-level') || 1)))
        const text = odtInlineText(el).trim()
        if (text) out.push('#'.repeat(level) + ' ' + text)
        break
      }
      case 'p': {
        const text = odtInlineText(el).trim()
        if (text) out.push(text)
        break
      }
      case 'list': {
        el.childNodes.forEach((item) => {
          if ((item as Element).localName !== 'list-item') return
          const inner: string[] = []
          odtBlocks(item, inner)
          if (inner.length) out.push('- ' + inner.join(' — '))
        })
        break
      }
      case 'table': {
        const rows: string[] = []
        el.childNodes.forEach((row) => {
          if ((row as Element).localName !== 'table-row') return
          const cells: string[] = []
          row.childNodes.forEach((cell) => {
            if ((cell as Element).localName !== 'table-cell') return
            const inner: string[] = []
            odtBlocks(cell, inner)
            cells.push(inner.join(' ').replace(/\|/g, '/'))
          })
          rows.push('| ' + cells.join(' | ') + ' |')
        })
        if (rows.length) {
          const colCount = (rows[0].match(/\|/g) || []).length - 1
          rows.splice(1, 0, '|' + ' --- |'.repeat(Math.max(1, colCount)))
          out.push(rows.join('\n'))
        }
        break
      }
      case 'section': odtBlocks(el, out); break
      default: break
    }
  })
}

async function odtToMarkdown(bytes: Uint8Array): Promise<string> {
  const xml = await zipEntry(bytes, 'content.xml')
  if (!xml) throw new Error('content.xml introuvable — ODT invalide')
  const doc = new DOMParser().parseFromString(decodeText(xml), 'text/xml')
  const body = doc.getElementsByTagNameNS('*', 'text')
  let root: Element | null = null
  for (let i = 0; i < body.length; i++) {
    if (body[i].localName === 'text' && body[i].parentElement?.localName === 'body') { root = body[i]; break }
  }
  if (!root) throw new Error('corps du document introuvable — ODT invalide')
  const out: string[] = []
  odtBlocks(root, out)
  return out.join('\n\n')
}

// ── DOCX : parcours de w:body (styles Heading/Titre, tableaux) ──

function docxInlineText(node: Node): string {
  let out = ''
  node.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    switch (el.localName) {
      case 't': out += el.textContent || ''; break
      case 'tab': out += '\t'; break
      case 'br': case 'cr': out += '\n'; break
      default: out += docxInlineText(el)
    }
  })
  return out
}

function docxHeadingLevel(p: Element): number {
  const styles = p.getElementsByTagNameNS('*', 'pStyle')
  for (let i = 0; i < styles.length; i++) {
    const val = styles[i].getAttribute('w:val') || styles[i].getAttributeNS('*', 'val') || ''
    const m = /^(?:Heading|Titre|heading)(\d)/.exec(val)
    if (m) return Math.min(6, Number(m[1]))
  }
  return 0
}

function docxBlocks(parent: Element, out: string[]): void {
  parent.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    if (el.localName === 'p') {
      const text = docxInlineText(el).trim()
      if (!text) return
      const level = docxHeadingLevel(el)
      out.push(level ? '#'.repeat(level) + ' ' + text : text)
    } else if (el.localName === 'tbl') {
      const rows: string[] = []
      el.childNodes.forEach((row) => {
        if ((row as Element).localName !== 'tr') return
        const cells: string[] = []
        row.childNodes.forEach((cell) => {
          if ((cell as Element).localName !== 'tc') return
          const inner: string[] = []
          docxBlocks(cell as Element, inner)
          cells.push(inner.join(' ').replace(/\|/g, '/'))
        })
        rows.push('| ' + cells.join(' | ') + ' |')
      })
      if (rows.length) {
        const colCount = (rows[0].match(/\|/g) || []).length - 1
        rows.splice(1, 0, '|' + ' --- |'.repeat(Math.max(1, colCount)))
        out.push(rows.join('\n'))
      }
    }
  })
}

async function docxToMarkdown(bytes: Uint8Array): Promise<string> {
  const xml = await zipEntry(bytes, 'word/document.xml')
  if (!xml) throw new Error('word/document.xml introuvable — DOCX invalide')
  const doc = new DOMParser().parseFromString(decodeText(xml), 'text/xml')
  const bodies = doc.getElementsByTagNameNS('*', 'body')
  if (!bodies.length) throw new Error('corps du document introuvable — DOCX invalide')
  const out: string[] = []
  docxBlocks(bodies[0], out)
  return out.join('\n\n')
}

// ── PDF : pdfjs (texte natif) + détection des scans sans texte ──

async function pdfToMarkdown(bytes: Uint8Array): Promise<ConversionResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const pages: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    // reconstitution ligne à ligne : un saut quand l'ordonnée change
    let lastY: number | null = null
    let line = ''
    const lines: string[] = []
    for (const it of content.items) {
      if (!('str' in it)) continue
      const item = it as { str: string; transform: number[] }
      const y = Math.round(item.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) { if (line.trim()) lines.push(line.trim()); line = '' }
      line += (line && !line.endsWith(' ') ? ' ' : '') + item.str
      lastY = y
    }
    if (line.trim()) lines.push(line.trim())
    pages.push(lines.join('\n'))
  }
  const numPages = doc.numPages
  await doc.destroy()
  // dé-hyphénation des coupures de fin de ligne
  const markdown = pages.join('\n\n').replace(/([a-zà-ÿ])-\n([a-zà-ÿ])/g, '$1$2')
  const density = markdown.replace(/\s/g, '').length / Math.max(1, numPages)
  if (density < 40) {
    return {
      markdown,
      avertissement: 'PDF probablement scanné (image) : presque aucun texte extractible. Passez-le par une reconnaissance de caractères (OCR) avant de le téléverser.',
    }
  }
  return { markdown }
}

// ── HTML : texte du body via DOMParser ──

function htmlToMarkdown(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'text/html')
  doc.querySelectorAll('script,style,noscript').forEach((el) => el.remove())
  // les blocs deviennent des sauts de ligne, le reste est du texte brut
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,br').forEach((el) => el.append('\n'))
  return (doc.body?.textContent || '').replace(/[ \t]+\n/g, '\n')
}

// ── Nettoyage final commun ──

function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS)
}

/** Titre proposé à partir du nom de fichier (« ddeJLD_Sonorisation_.odt » → « ddeJLD Sonorisation »). */
export function titreDepuisFichier(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 120)
}

/** Convertit un fichier téléversé en markdown — tout se passe dans le navigateur. */
export async function fileToMarkdown(file: File): Promise<ConversionResult> {
  const name = file.name.toLowerCase()
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.length) throw new Error('fichier vide')

  if (name.endsWith('.pdf')) {
    const res = await pdfToMarkdown(bytes)
    return { ...res, markdown: tidy(res.markdown) }
  }
  if (name.endsWith('.odt') || name.endsWith('.ott')) {
    return { markdown: tidy(await odtToMarkdown(bytes)) }
  }
  if (name.endsWith('.docx')) {
    return { markdown: tidy(await docxToMarkdown(bytes)) }
  }
  if (name.endsWith('.doc')) {
    return { markdown: tidy(docToMarkdown(bytes)) }
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    return { markdown: tidy(htmlToMarkdown(decodeText(bytes))) }
  }
  if (/\.(txt|md|markdown|csv|eml|log|rtf)$/.test(name)) {
    if (name.endsWith('.rtf')) {
      // RTF : on retire les commandes de mise en forme, on garde le texte
      const raw = decodeText(bytes)
        .replace(/\\'([0-9a-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\par[d]?/g, '\n')
        .replace(/\\[a-z]+-?\d* ?/g, '')
        .replace(/[{}]/g, '')
      return { markdown: tidy(raw) }
    }
    return { markdown: tidy(decodeText(bytes)) }
  }
  throw new Error(`type de fichier non pris en charge (${file.name.split('.').pop()}) — formats acceptés : PDF, ODT, DOCX, TXT, MD, HTML, CSV, EML`)
}
