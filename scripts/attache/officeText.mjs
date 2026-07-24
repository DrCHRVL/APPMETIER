/**
 * SIRAL — Attaché de justice · lecture des documents bureautiques (côté serveur).
 *
 * Le pendant Node de `lib/web/fileToMarkdown.ts` : quand une pièce arrive PAR
 * MAIL (boîte dédiée crimorg@…), l'attaché la lit sur le SERVEUR — il n'y a pas
 * de navigateur pour convertir. Sans ce module, un .odt / .docx transféré
 * retombait sur « type non textuel » et l'acte portait la mention « pièce non
 * lisible en format texte » : la demande de l'OPJ restait illisible.
 *
 * Formats couverts SANS dépendance nouvelle :
 *  - ODT / OTT : zip (zlib inflateRaw) + content.xml
 *  - DOCX      : zip + word/document.xml
 *  - RTF       : dé-balisage des commandes de mise en forme
 *  - XLSX / XLSM / XLS / ODS : SheetJS (dépendance existante du dépôt),
 *    chaque feuille rendue en tableau markdown — même conversion que le
 *    navigateur (source unique lib/tableur/classeurMarkdown.mjs)
 *
 * Tout est borné et gardé : la moindre anomalie retombe sur { ok:false, error }
 * — jamais une exception qui casserait la lecture de la boîte ou du dépôt.
 * Le vieux .doc binaire (Word 97-2003) n'est PAS traité ici : demander une
 * version .docx / PDF (message explicite plutôt qu'illisible silencieux).
 */
import zlib from 'node:zlib'
import { estTableur, classeurEnMarkdown } from '../../lib/tableur/classeurMarkdown.mjs'

const MAX_CHARS = 200_000

// ── Décodage texte : UTF-8 strict, sinon windows-1252 (fichiers Windows FR) ──
function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

// ── Mini-lecteur ZIP (ODT/DOCX) : répertoire central + deflate-raw (zlib) ──

function u16(b, o) { return b[o] | (b[o + 1] << 8) }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

/** Extrait UNE entrée d'un zip (le fichier XML utile d'un ODT/DOCX). */
function zipEntry(buf, wantedName) {
  // End Of Central Directory : signature 0x06054b50, cherchée depuis la fin.
  let eocd = -1
  const min = Math.max(0, buf.length - 65_557)
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = u16(buf, eocd + 10)
  let off = u32(buf, eocd + 16)
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || u32(buf, off) !== 0x02014b50) return null
    const method = u16(buf, off + 10)
    const compSize = u32(buf, off + 20)
    const nameLen = u16(buf, off + 28)
    const extraLen = u16(buf, off + 30)
    const commentLen = u16(buf, off + 32)
    const localOff = u32(buf, off + 42)
    const name = decodeText(buf.subarray(off + 46, off + 46 + nameLen))
    if (name === wantedName) {
      if (localOff + 30 > buf.length || u32(buf, localOff) !== 0x04034b50) return null
      const lNameLen = u16(buf, localOff + 26)
      const lExtraLen = u16(buf, localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(start, start + compSize)
      if (method === 0) return data
      if (method === 8) { try { return zlib.inflateRawSync(data) } catch { return null } }
      return null
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return null
}

// ── Mini-DOM XML : suffisant pour parcourir content.xml / document.xml ──
// On construit un arbre léger { name (localName), attrs, children } où les
// nœuds texte sont { text }. Assez pour porter la traversée du convertisseur
// navigateur sans DOMParser (indisponible côté Node).

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const code = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m
    }
    switch (e) {
      case 'amp': return '&'
      case 'lt': return '<'
      case 'gt': return '>'
      case 'quot': return '"'
      case 'apos': return '\''
      default: return m
    }
  })
}

function parseAttrs(src) {
  const attrs = {}
  if (!src) return attrs
  const re = /([^\s=/]+)\s*=\s*"([^"]*)"|([^\s=/]+)\s*=\s*'([^']*)'/g
  let m
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) attrs[m[1]] = decodeEntities(m[2])
    else attrs[m[3]] = decodeEntities(m[4])
  }
  return attrs
}

function localName(raw) {
  const c = raw.indexOf(':')
  return c >= 0 ? raw.slice(c + 1) : raw
}

/** Construit un arbre léger depuis un XML. Ne lève pas : nesting mal formé toléré. */
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] }
  const stack = [root]
  let i = 0
  const n = xml.length
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      const txt = xml.slice(i)
      if (txt) stack[stack.length - 1].children.push({ text: decodeEntities(txt) })
      break
    }
    if (lt > i) {
      const txt = xml.slice(i, lt)
      if (txt) stack[stack.length - 1].children.push({ text: decodeEntities(txt) })
    }
    // Commentaires, CDATA, PI, DOCTYPE.
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9)
      const value = xml.slice(lt + 9, e < 0 ? n : e)
      if (value) stack[stack.length - 1].children.push({ text: value }) // CDATA : littéral, pas d'entités
      i = e < 0 ? n : e + 3
      continue
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') { const e = xml.indexOf('>', lt); i = e < 0 ? n : e + 1; continue }
    // Balise : recherche du '>' fermant en respectant les guillemets d'attributs.
    let gt = -1
    let quote = 0
    for (let j = lt + 1; j < n; j++) {
      const c = xml[j]
      if (quote) { if (c === String.fromCharCode(quote)) quote = 0; continue }
      if (c === '"' || c === '\'') { quote = xml.charCodeAt(j); continue }
      if (c === '>') { gt = j; break }
    }
    if (gt < 0) { const txt = xml.slice(lt); if (txt) stack[stack.length - 1].children.push({ text: decodeEntities(txt) }); break }
    let inner = xml.slice(lt + 1, gt)
    let type = 'open'
    if (inner[0] === '/') { type = 'close'; inner = inner.slice(1) }
    else if (inner.endsWith('/')) { type = 'empty'; inner = inner.slice(0, -1) }
    const mName = /^([^\s/>]+)/.exec(inner)
    const raw = mName ? mName[1] : ''
    const name = localName(raw)
    if (type === 'close') {
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) { stack.length = s; break }
      }
    } else {
      const node = { name, attrs: parseAttrs(inner.slice(raw.length)), children: [] }
      stack[stack.length - 1].children.push(node)
      if (type === 'open') stack.push(node)
    }
    i = gt + 1
  }
  return root
}

function isEl(node) { return typeof node.name === 'string' }

/** Premier descendant (parcours en profondeur) portant ce localName. */
function firstByName(node, name) {
  for (const child of node.children || []) {
    if (!isEl(child)) continue
    if (child.name === name) return child
    const found = firstByName(child, name)
    if (found) return found
  }
  return null
}

/** Concatène tous les nœuds texte descendants (équivalent de textContent). */
function textContent(node) {
  let out = ''
  for (const child of node.children || []) {
    if (child.text !== undefined) out += child.text
    else out += textContent(child)
  }
  return out
}

// ── ODT : parcours de office:text (titres, paragraphes, listes, tableaux) ──

function odtInlineText(node) {
  let out = ''
  for (const child of node.children || []) {
    if (child.text !== undefined) { out += child.text; continue }
    switch (child.name) {
      case 'tab': out += '\t'; break
      case 'line-break': out += '\n'; break
      case 's': out += ' '.repeat(Math.max(1, Number(child.attrs['text:c'] || 1))); break
      case 'note': break // notes de bas de page : hors flux
      default: out += odtInlineText(child)
    }
  }
  return out
}

function odtBlocks(parent, out) {
  for (const child of parent.children || []) {
    if (!isEl(child)) continue
    switch (child.name) {
      case 'h': {
        const level = Math.min(6, Math.max(1, Number(child.attrs['text:outline-level'] || 1)))
        const text = odtInlineText(child).trim()
        if (text) out.push('#'.repeat(level) + ' ' + text)
        break
      }
      case 'p': {
        const text = odtInlineText(child).trim()
        if (text) out.push(text)
        break
      }
      case 'list': {
        for (const item of child.children || []) {
          if (!isEl(item) || item.name !== 'list-item') continue
          const inner = []
          odtBlocks(item, inner)
          if (inner.length) out.push('- ' + inner.join(' — '))
        }
        break
      }
      case 'table': {
        const rows = []
        for (const row of child.children || []) {
          if (!isEl(row) || row.name !== 'table-row') continue
          const cells = []
          for (const cell of row.children || []) {
            if (!isEl(cell) || cell.name !== 'table-cell') continue
            const inner = []
            odtBlocks(cell, inner)
            cells.push(inner.join(' ').replace(/\|/g, '/'))
          }
          rows.push('| ' + cells.join(' | ') + ' |')
        }
        if (rows.length) {
          const colCount = (rows[0].match(/\|/g) || []).length - 1
          rows.splice(1, 0, '|' + ' --- |'.repeat(Math.max(1, colCount)))
          out.push(rows.join('\n'))
        }
        break
      }
      case 'section': odtBlocks(child, out); break
      default: break
    }
  }
}

function odtToText(buf) {
  const xml = zipEntry(buf, 'content.xml')
  if (!xml) throw new Error('content.xml introuvable — ODT invalide')
  const doc = parseXml(decodeText(xml))
  const body = firstByName(doc, 'body')
  const root = body ? firstByName(body, 'text') : null
  if (!root) throw new Error('corps du document introuvable — ODT invalide')
  const out = []
  odtBlocks(root, out)
  return out.join('\n\n')
}

// ── DOCX : parcours de w:body (titres via pStyle, tableaux) ──

function docxInlineText(node) {
  let out = ''
  for (const child of node.children || []) {
    if (!isEl(child)) continue // texte utile uniquement dans <w:t>
    switch (child.name) {
      case 't': out += textContent(child); break
      case 'tab': out += '\t'; break
      case 'br': case 'cr': out += '\n'; break
      default: out += docxInlineText(child)
    }
  }
  return out
}

function docxHeadingLevel(p) {
  for (const child of p.children || []) {
    if (!isEl(child) || child.name !== 'pPr') continue
    for (const st of child.children || []) {
      if (!isEl(st) || st.name !== 'pStyle') continue
      const val = st.attrs['w:val'] || ''
      const m = /^(?:Heading|Titre|heading)(\d)/.exec(val)
      if (m) return Math.min(6, Number(m[1]))
    }
  }
  return 0
}

function docxBlocks(parent, out) {
  for (const child of parent.children || []) {
    if (!isEl(child)) continue
    if (child.name === 'p') {
      const text = docxInlineText(child).trim()
      if (!text) continue
      const level = docxHeadingLevel(child)
      out.push(level ? '#'.repeat(level) + ' ' + text : text)
    } else if (child.name === 'tbl') {
      const rows = []
      for (const row of child.children || []) {
        if (!isEl(row) || row.name !== 'tr') continue
        const cells = []
        for (const cell of row.children || []) {
          if (!isEl(cell) || cell.name !== 'tc') continue
          const inner = []
          docxBlocks(cell, inner)
          cells.push(inner.join(' ').replace(/\|/g, '/'))
        }
        rows.push('| ' + cells.join(' | ') + ' |')
      }
      if (rows.length) {
        const colCount = (rows[0].match(/\|/g) || []).length - 1
        rows.splice(1, 0, '|' + ' --- |'.repeat(Math.max(1, colCount)))
        out.push(rows.join('\n'))
      }
    } else if (child.name === 'body' || child.name === 'sdt' || child.name === 'sdtContent') {
      docxBlocks(child, out)
    }
  }
}

function docxToText(buf) {
  const xml = zipEntry(buf, 'word/document.xml')
  if (!xml) throw new Error('word/document.xml introuvable — DOCX invalide')
  const doc = parseXml(decodeText(xml))
  const body = firstByName(doc, 'body')
  if (!body) throw new Error('corps du document introuvable — DOCX invalide')
  const out = []
  docxBlocks(body, out)
  return out.join('\n\n')
}

// ── RTF : dé-balisage des commandes de mise en forme, on garde le texte ──

function rtfToText(buf) {
  return decodeText(buf)
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\\*/g, '')
}

// ── Nettoyage final commun ──

function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS)
}

/** Vrai si l'extension relève d'un format bureautique traité ici. */
export function isOfficeExt(nameOrExt) {
  return /\.(odt|ott|docx|rtf)$/i.test(String(nameOrExt || ''))
}

// ── Tableurs (XLSX/XLSM/XLS/ODS) : chaque feuille en tableau markdown ──
// SheetJS est une dépendance EXISTANTE (package.json de l'app, installée dans
// l'image du service) ; import dynamique pour ne payer son chargement qu'à la
// première pièce tableur rencontrée. Conversion partagée avec le navigateur.

export { estTableur as isSpreadsheetExt }

let _xlsxModule = null
async function loadXlsx() {
  if (!_xlsxModule) {
    const mod = await import('xlsx')
    _xlsxModule = mod?.read ? mod : mod.default
  }
  return _xlsxModule
}

/**
 * Extrait le contenu d'un CLASSEUR déchiffré (Excel/ODS) en markdown — une
 * section par feuille, valeurs telles qu'affichées, troncatures explicites.
 * Ne lève jamais : { ok, texte, source } ou { ok:false, error }.
 */
export async function extractSpreadsheetText(plain, nameOrExt) {
  const buf = Buffer.isBuffer(plain) ? plain : Buffer.from(plain)
  const lower = String(nameOrExt || '').toLowerCase()
  if (!buf.length) return { ok: false, error: 'Pièce vide.' }
  try {
    const XLSX = await loadXlsx()
    const wb = XLSX.read(buf, { type: 'buffer' })
    const res = classeurEnMarkdown(XLSX, wb)
    if (!res.ok) return { ok: false, error: res.error }
    return { ok: true, texte: tidy(res.markdown), source: 'tableur' }
  } catch (e) {
    return { ok: false, error: `Classeur illisible (${lower.split('.').pop()}) : ${e?.message || 'format inattendu'} — demander un export CSV ou PDF.` }
  }
}

/**
 * Extrait le texte d'une pièce bureautique déchiffrée. Ne lève jamais.
 * @param {Buffer|Uint8Array} plain - contenu déchiffré
 * @param {string} nameOrExt - nom de fichier ou extension (pour choisir le parseur)
 * @returns {{ok:true,texte:string,source:string} | {ok:false,error:string}}
 */
export function extractOfficeText(plain, nameOrExt) {
  const buf = Buffer.isBuffer(plain) ? plain : Buffer.from(plain)
  const lower = String(nameOrExt || '').toLowerCase()
  if (!buf.length) return { ok: false, error: 'Pièce vide.' }
  try {
    if (lower.endsWith('.odt') || lower.endsWith('.ott')) {
      const texte = tidy(odtToText(buf))
      if (!texte) return { ok: false, error: 'ODT lu mais sans texte exploitable — pièce probablement vide ou non standard. Demander une version PDF.' }
      return { ok: true, texte, source: 'odt' }
    }
    if (lower.endsWith('.docx')) {
      const texte = tidy(docxToText(buf))
      if (!texte) return { ok: false, error: 'DOCX lu mais sans texte exploitable — pièce probablement vide ou non standard. Demander une version PDF.' }
      return { ok: true, texte, source: 'docx' }
    }
    if (lower.endsWith('.rtf')) {
      const texte = tidy(rtfToText(buf))
      if (!texte) return { ok: false, error: 'RTF lu mais sans texte exploitable. Demander une version PDF.' }
      return { ok: true, texte, source: 'rtf' }
    }
    if (lower.endsWith('.doc')) {
      return { ok: false, error: 'Ancien format .doc (Word 97-2003) non lu côté serveur — demander une version .docx ou PDF au service.' }
    }
  } catch (e) {
    return { ok: false, error: `Lecture impossible (${lower.split('.').pop()}) : ${e?.message || 'format inattendu'} — demander une version PDF.` }
  }
  return { ok: false, error: `Type non pris en charge (${lower.split('.').pop() || '?'}).` }
}
