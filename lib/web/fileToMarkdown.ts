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
 *  - TXT / MD / CSV / EML / LOG : décodage direct (UTF-8, repli windows-1252)
 *  - HTML  : texte extrait via DOMParser
 *  - DOC (ancien Word binaire) : refusé avec message clair.
 */

export interface ConversionResult {
  markdown: string
  avertissement?: string
}

const MAX_CHARS = 400_000

// ── Décodage texte : UTF-8 strict, sinon windows-1252 (fichiers Windows FR) ──
function decodeText(bytes: Uint8Array): string {
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
    throw new Error('format .doc (ancien Word) non pris en charge — réenregistrez-le en .odt, .docx ou PDF')
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
