/**
 * SIRAL — moteur de rendu des « trames de forme » (papeteries Word).
 *
 * Cœur PUR (aucune dépendance, aucun zip) du remplissage d'une trame : il ne
 * manipule que du XML WordprocessingML. `trameFill.ts` l'appelle après avoir
 * ouvert le .docx de l'utilisateur ; il est aussi testable en Node
 * (`node scripts/trame-forme.test.mjs`).
 *
 * Ce que le moteur garantit — et qui manquait à la première version :
 *
 *  1. LES BALISES SONT TOUJOURS TROUVÉES. Word éclate volontiers `{{CORPS}}`
 *     en plusieurs « runs » (révisions, correcteur orthographique, marque-pages).
 *     On ne cherche donc PAS la balise dans le XML : on reconstitue le texte
 *     de chaque paragraphe, on y repère la balise, puis on réinjecte la valeur
 *     dans les runs concernés. Une balise scindée, écrite en minuscules ou
 *     espacée (`{{ corps }}`) est reconnue.
 *  2. AUCUNE BALISE ORPHELINE. Une balise sans valeur (p. ex. `{{TITRE}}` dans
 *     une trame de courrier) est retirée — jamais laissée telle quelle dans le
 *     document remis.
 *  3. LE CORPS EST TYPOGRAPHIÉ COMME À L'ÉCRAN. Le texte des actes est du
 *     markdown : titres, listes, TABLEAUX, gras/italique/souligné, citations.
 *     On rend les mêmes objets Word (un vrai `<w:tbl>` pour un tableau) au lieu
 *     de recracher les `|` et les `#`. Les lignes consécutives forment UN
 *     paragraphe (retours à la ligne internes), les lignes vides séparent les
 *     paragraphes : plus de paragraphes vides en cascade ni de trous béants.
 *  4. LE XML RESTE VALIDE. Les propriétés (`w:pPr`, `w:rPr`…) sont
 *     reconstruites dans l'ORDRE imposé par le schéma OOXML : Word ouvre le
 *     fichier sans boîte de dialogue « contenu illisible ».
 *
 * Tout hérite de la mise en forme du paragraphe qui portait la balise : police,
 * taille, interligne, alignement, retraits. La forme reste 100 % celle de
 * l'utilisateur.
 */

// ── Balises reconnues ────────────────────────────────────────────────────────

/** Balises canoniques, dans l'ordre d'affichage de l'aide. */
export const TRAME_TOKENS = ['CORPS', 'TITRE', 'SIGNATURE', 'DESTINATAIRE', 'OBJET', 'DATE']

/** Synonymes tolérés (le magistrat écrit sa trame à la main). */
const ALIASES = {
  CORPS: 'CORPS', TEXTE: 'CORPS', CONTENU: 'CORPS', BODY: 'CORPS',
  TITRE: 'TITRE', TITLE: 'TITRE', INTITULE: 'TITRE',
  SIGNATURE: 'SIGNATURE', SIGN: 'SIGNATURE', SIGNATAIRE: 'SIGNATURE',
  DESTINATAIRE: 'DESTINATAIRE', DEST: 'DESTINATAIRE',
  OBJET: 'OBJET',
  DATE: 'DATE',
}

/** Clé de variable (dans `vars`) pour une balise canonique. */
const VAR_OF = {
  CORPS: 'corps', TITRE: 'titre', SIGNATURE: 'signature',
  DESTINATAIRE: 'destinataire', OBJET: 'objet', DATE: 'date',
}

/** Signes diacritiques combinants (pour « OBJÉT » → « OBJET »). */
const DIACRITICS = /[\u0300-\u036F]/g

/** `{{ Corps }}`, `{{CORPS}}`, `{{corps}}` → `CORPS` (ou null si inconnue). */
function canonicalToken(raw) {
  const key = String(raw || '')
    .normalize('NFD').replace(DIACRITICS, '')
    .toUpperCase().replace(/[^A-Z]/g, '')
  return ALIASES[key] || null
}

/** Balise, avec espaces tolérés à l'intérieur des accolades. */
const TOKEN_RE = /\{\{\s*([^{}]{1,40}?)\s*\}\}/g
/** La même, ancrée : le paragraphe ne porte QUE la balise. */
const SOLO_TOKEN_RE = /^\{\{\s*([^{}]{1,40}?)\s*\}\}$/

// ── Utilitaires XML ──────────────────────────────────────────────────────────

/** Caractères de contrôle interdits en XML 1.0 (hors tabulation et sauts). */
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

export function escXml(s) {
  return String(s == null ? '' : s)
    .replace(CTRL, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Contenu d'un run : les sauts de ligne deviennent de VRAIS `<w:br/>`. */
function runContent(text) {
  const out = []
  for (const piece of String(text == null ? '' : text).split(/(\n|\t)/)) {
    if (piece === '\n') out.push('<w:br/>')
    else if (piece === '\t') out.push('<w:tab/>')
    else if (piece) out.push(`<w:t xml:space="preserve">${escXml(piece)}</w:t>`)
  }
  return out.join('') || '<w:t xml:space="preserve"></w:t>'
}

function run(rPr, text) {
  return `<w:r>${rPr || ''}${runContent(text)}</w:r>`
}

/** Contenu interne d'un élément (`<w:pPr>…</w:pPr>` → `…`). */
function innerOf(xml, tag) {
  if (!xml) return ''
  const m = new RegExp(`^<${tag}(?:\\s[^>]*)?>([\\s\\S]*)</${tag}>$`).exec(String(xml).trim())
  return m ? m[1] : ''
}

/** Découpe le contenu d'un élément en enfants directs `{ name, xml }`. */
function splitChildren(inner) {
  const out = []
  let i = 0
  while (i < inner.length) {
    const lt = inner.indexOf('<', i)
    if (lt < 0) break
    const nm = /^<([\w:.-]+)/.exec(inner.slice(lt, lt + 48))
    if (!nm) { i = lt + 1; continue }
    const gt = inner.indexOf('>', lt)
    if (gt < 0) break
    if (inner[gt - 1] === '/') { out.push({ name: nm[1], xml: inner.slice(lt, gt + 1) }); i = gt + 1; continue }
    const close = inner.indexOf(`</${nm[1]}>`, gt)
    if (close < 0) { out.push({ name: nm[1], xml: inner.slice(lt, gt + 1) }); i = gt + 1; continue }
    const end = close + nm[1].length + 3
    out.push({ name: nm[1], xml: inner.slice(lt, end) })
    i = end
  }
  return out
}

/**
 * Ordre imposé par le schéma OOXML (CT_PPr / CT_RPr). Word refuse d'ouvrir un
 * document dont les propriétés sont désordonnées : toute reconstruction passe
 * donc par `rebuild()`.
 */
const PPR_ORDER = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange']
const RPR_ORDER = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath']

function rebuild(tag, children, order) {
  if (!children.length) return ''
  const rank = (n) => { const k = order.indexOf(n); return k < 0 ? order.length : k }
  const sorted = children.slice().sort((a, b) => rank(a.name) - rank(b.name))
  return `<${tag}>${sorted.map((c) => c.xml).join('')}</${tag}>`
}

function setChild(children, name, xml) {
  const out = children.filter((c) => c.name !== name)
  if (xml) out.push({ name, xml })
  return out
}

function getChild(children, name) {
  const c = children.find((x) => x.name === name)
  return c ? c.xml : ''
}

// ── Propriétés de paragraphe / de run dérivées de la balise ──────────────────

/** Espacement APRÈS du paragraphe de la balise (twips), ou null si non défini. */
function spacingAfterOf(basePPr) {
  const m = /<w:spacing\b[^>]*\bw:after="(\d+)"/.exec(basePPr || '')
  return m ? parseInt(m[1], 10) : null
}

function setSpacingAfter(spacingXml, after) {
  let out = (spacingXml || '<w:spacing/>')
    .replace(/\s*w:afterAutospacing="[^"]*"/, '')
    .replace(/\s*w:afterLines="[^"]*"/, '')
  out = /\bw:after="/.test(out)
    ? out.replace(/\bw:after="\d+"/, `w:after="${after}"`)
    : out.replace(/\/?>$/, ` w:after="${after}"/>`)
  return out
}

/** Retrait gauche hérité de la balise (twips). */
function indLeftOf(basePPr) {
  const m = /<w:ind\b[^>]*\bw:left="(\d+)"/.exec(basePPr || '')
  return m ? parseInt(m[1], 10) : 0
}

/**
 * `w:pPr` d'un paragraphe généré, dérivé de celui de la balise.
 *  - `w:numPr` est TOUJOURS retiré : une balise posée dans une liste ne doit
 *    pas transformer tout le corps en liste à puces ;
 *  - `w:sectPr` / `w:pPrChange` sont retirés (ils appartiennent à la balise) —
 *    le `sectPr` est reposé à part, sur un dernier paragraphe.
 */
function makePPr(basePPr, opts = {}) {
  let ch = splitChildren(innerOf(basePPr, 'w:pPr'))
    .filter((c) => c.name !== 'w:numPr' && c.name !== 'w:sectPr' && c.name !== 'w:pPrChange')
  if (opts.ind !== undefined) ch = setChild(ch, 'w:ind', opts.ind)
  if (opts.jc !== undefined) ch = setChild(ch, 'w:jc', opts.jc ? `<w:jc w:val="${opts.jc}"/>` : '')
  if (opts.pBdr !== undefined) ch = setChild(ch, 'w:pBdr', opts.pBdr)
  if (opts.contextual === false) ch = setChild(ch, 'w:contextualSpacing', '')
  if (opts.after !== undefined && opts.after !== null) {
    ch = setChild(ch, 'w:spacing', setSpacingAfter(getChild(ch, 'w:spacing'), opts.after))
  }
  return rebuild('w:pPr', ch, PPR_ORDER)
}

/**
 * Espacement à poser entre les paragraphes du corps (null = ne rien imposer).
 * Sans espacement explicite ni style nommé sur la balise, les paragraphes se
 * toucheraient : on pose alors 10 pt, la valeur de l'export PDF.
 */
function defaultAfter(basePPr) {
  const after = spacingAfterOf(basePPr)
  if (after !== null) return after > 0 ? null : 200
  return /<w:pStyle\b/.test(basePPr || '') ? null : 200
}

/** `w:rPr` d'un run généré : celui de la balise + les bascules du markdown. */
export function rPrWith(baseRPr, opt = {}) {
  let ch = splitChildren(innerOf(baseRPr, 'w:rPr'))
  if (opt.b) ch = setChild(ch, 'w:b', '<w:b/>')
  if (opt.i) ch = setChild(ch, 'w:i', '<w:i/>')
  if (opt.u) ch = setChild(ch, 'w:u', '<w:u w:val="single"/>')
  if (opt.s) ch = setChild(ch, 'w:strike', '<w:strike/>')
  if (opt.code) ch = setChild(ch, 'w:rFonts', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>')
  if (opt.szDelta) {
    for (const tag of ['w:sz', 'w:szCs']) {
      const m = /w:val="(\d+)"/.exec(getChild(ch, tag))
      if (m) ch = setChild(ch, tag, `<${tag} w:val="${Math.max(8, parseInt(m[1], 10) + opt.szDelta)}"/>`)
    }
  }
  return rebuild('w:rPr', ch, RPR_ORDER)
}

// ── Markdown en ligne → runs ─────────────────────────────────────────────────

// Échappement · `code` · **gras** · __souligné__ · ~~barré~~ · *italique* ·
// _italique_ · ![image](…) (texte alternatif) · [lien](…) (libellé seul).
// Convention SIRAL : `__…__` = SOULIGNÉ (et non gras), comme dans les trames.
const INLINE_RE = /\\([\\`*_~[\]()#+\-.!>|])|`([^`\n]+)`|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*(?!\s)([^*\n]+?)\*|(?<![\p{L}\p{N}])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}])|!\[([^\]]*)\]\([^)\n]*\)|\[([^\]]*)\]\([^)\n]*\)/gu

/** Découpe une ligne en segments porteurs de bascules de mise en forme. */
export function parseInline(text, flags = {}) {
  const out = []
  const re = new RegExp(INLINE_RE.source, INLINE_RE.flags)
  let last = 0
  let m
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ ...flags, t: text.slice(last, m.index) })
    if (m[1] != null) out.push({ ...flags, t: m[1] })
    else if (m[2] != null) out.push({ ...flags, t: m[2], code: true })
    else if (m[3] != null) out.push(...parseInline(m[3], { ...flags, b: true }))
    else if (m[4] != null) out.push(...parseInline(m[4], { ...flags, u: true }))
    else if (m[5] != null) out.push(...parseInline(m[5], { ...flags, s: true }))
    else if (m[6] != null) out.push(...parseInline(m[6], { ...flags, i: true }))
    else if (m[7] != null) out.push(...parseInline(m[7], { ...flags, i: true }))
    else if (m[8] != null) { if (m[8]) out.push({ ...flags, t: m[8], i: true }) }
    else if (m[9] != null) out.push(...parseInline(m[9], flags))
    last = re.lastIndex
  }
  if (last < text.length) out.push({ ...flags, t: text.slice(last) })
  return out.filter((s) => s.t !== '')
}

/** Une ligne de markdown → runs héritant du formatage de la balise. */
export function inlineRuns(text, baseRPr, force = {}) {
  const segs = parseInline(String(text == null ? '' : text))
  if (!segs.length) return run(rPrWith(baseRPr, force), '')
  return segs.map((s) => run(rPrWith(baseRPr, {
    b: s.b || force.b,
    i: s.i || force.i,
    u: s.u || force.u,
    s: s.s,
    code: s.code,
    szDelta: force.szDelta,
  }), s.t)).join('')
}

// ── Markdown en blocs ────────────────────────────────────────────────────────

const RE_HEADING = /^(#{1,6})\s+(.*)$/
const RE_BULLET = /^([-*•+])\s+(.+)$/
const RE_ORDERED = /^(\d{1,3})[.)]\s+(.+)$/
const RE_RULE = /^(?:-{3,}|\*{3,}|_{3,}|—{3,})$/
const RE_QUOTE = /^>\s?(.*)$/
const RE_FENCE = /^(?:```|~~~)/

/** Cellules d'une ligne de tableau (`|` d'encadrement optionnels, `\|` échappé). */
export function splitRow(line) {
  let t = String(line || '').trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim())
}

/** Ligne de séparation d'un tableau markdown (`|---|:--:|`). */
export function isTableDelim(line) {
  const t = String(line || '').trim()
  if (!t.includes('-') || !t.includes('|')) return false
  const cells = splitRow(t)
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

/** Alignement déclaré par une cellule de la ligne de séparation (`:--:`). */
export function alignOf(cell) {
  const t = String(cell || '').trim()
  if (t.startsWith(':') && t.endsWith(':')) return 'center'
  if (t.endsWith(':')) return 'right'
  return null
}

/**
 * Texte markdown → blocs. Les lignes consécutives forment UN paragraphe (avec
 * retours à la ligne internes) ; une ligne vide sépare deux paragraphes.
 */
export function parseBlocks(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  const startsBlock = (t) => (
    RE_HEADING.test(t) || RE_BULLET.test(t) || RE_ORDERED.test(t)
    || RE_RULE.test(t) || RE_QUOTE.test(t) || RE_FENCE.test(t)
  )
  const opensTable = (k) => (
    lines[k].includes('|') && k + 1 < lines.length && isTableDelim(lines[k + 1])
  )
  while (i < lines.length) {
    const t = lines[i].trim()
    if (!t) { i += 1; continue }

    if (RE_FENCE.test(t)) {
      const code = []
      i += 1
      while (i < lines.length && !RE_FENCE.test(lines[i].trim())) { code.push(lines[i]); i += 1 }
      i += 1
      blocks.push({ type: 'code', lines: code })
      continue
    }
    if (RE_RULE.test(t)) { blocks.push({ type: 'rule' }); i += 1; continue }
    const h = RE_HEADING.exec(t)
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i += 1; continue }

    if (opensTable(i)) {
      const header = splitRow(t)
      const aligns = splitRow(lines[i + 1]).map(alignOf)
      const rows = []
      i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitRow(lines[i])); i += 1 }
      blocks.push({ type: 'table', header, aligns, rows })
      continue
    }

    if (RE_QUOTE.test(t)) {
      const q = []
      while (i < lines.length && RE_QUOTE.test(lines[i].trim())) { q.push(RE_QUOTE.exec(lines[i].trim())[1]); i += 1 }
      blocks.push({ type: 'quote', lines: q })
      continue
    }

    if (RE_BULLET.test(t) || RE_ORDERED.test(t)) {
      const items = []
      while (i < lines.length) {
        const raw = lines[i]
        const tt = raw.trim()
        if (!tt) break
        const b = RE_BULLET.exec(tt)
        const o = RE_ORDERED.exec(tt)
        if (b || o) {
          const indent = /^(\s*)/.exec(raw)[1].replace(/\t/g, '    ').length
          items.push({
            level: Math.min(3, Math.floor(indent / 2)),
            marker: b ? '•' : `${o[1]}.`,
            text: b ? b[2] : o[2],
          })
          i += 1
        } else if (items.length && !startsBlock(tt) && !opensTable(i)) {
          // Continuation d'une puce repliée sur la ligne suivante.
          items[items.length - 1].text += ` ${tt}`
          i += 1
        } else break
      }
      blocks.push({ type: 'list', items })
      continue
    }

    const para = []
    while (i < lines.length) {
      const tt = lines[i].trim()
      if (!tt || startsBlock(tt) || opensTable(i)) break
      para.push(tt)
      i += 1
    }
    if (para.length) blocks.push({ type: 'para', lines: para })
  }
  return blocks
}

// ── Blocs → OOXML ────────────────────────────────────────────────────────────

const TBL_BORDER = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`

function renderTable(block, basePPr, baseRPr, trailing) {
  const cols = Math.max(block.header.length, ...block.rows.map((r) => r.length), 1)
  const width = Math.floor(9072 / cols)
  const cellPPr = (align) => makePPr(basePPr, {
    ind: '',
    jc: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
    after: 0,
    contextual: false,
  })
  const cell = (text, align, header) => {
    const tcPr = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>`
      + `${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}`
      + '<w:vAlign w:val="center"/></w:tcPr>'
    return `<w:tc>${tcPr}<w:p>${cellPPr(align)}${inlineRuns(text, baseRPr, { b: header })}</w:p></w:tc>`
  }
  const row = (cells, header) => {
    const tds = []
    for (let c = 0; c < cols; c += 1) tds.push(cell(cells[c] || '', block.aligns[c], header))
    return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${tds.join('')}</w:tr>`
  }
  const tblPr = '<w:tblPr>'
    + '<w:tblW w:w="5000" w:type="pct"/>'
    + `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(TBL_BORDER).join('')}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/>'
    + '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
    + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>'
    + '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
    + '</w:tblPr>'
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>`
  const body = [row(block.header, true), ...block.rows.map((r) => row(r, false))].join('')
  // Word exige un paragraphe APRÈS un tableau en fin de corps, et entre deux
  // tableaux qui se suivent ; ailleurs le paragraphe suivant suffit (en poser
  // un systématiquement ajouterait une ligne vide parasite).
  const queue = trailing ? `<w:p>${makePPr(basePPr, { ind: '', after: 0 })}</w:p>` : ''
  return `<w:tbl>${tblPr}${grid}${body}</w:tbl>${queue}`
}

/** Un paragraphe de corps : lignes jointes par de vrais retours à la ligne. */
function renderPara(block, basePPr, baseRPr, after) {
  // Les visas (« Vu l'article… ») restent en italique, comme dans l'export PDF.
  const visa = /^Vu\b/i.test(block.lines[0] || '')
  const pPr = makePPr(basePPr, { after })
  const runs = block.lines
    .map((l) => inlineRuns(l, baseRPr, { i: visa }))
    .join('<w:r><w:br/></w:r>')
  return `<w:p>${pPr}${runs}</w:p>`
}

function renderHeading(block, basePPr, baseRPr, after) {
  const pPr = makePPr(basePPr, {
    jc: block.level === 1 ? 'center' : undefined,
    after: after === null ? null : Math.max(after, 120),
  })
  return `<w:p>${pPr}${inlineRuns(block.text, baseRPr, { b: true, szDelta: block.level === 1 ? 2 : 0 })}</w:p>`
}

function renderList(block, basePPr, baseRPr, after) {
  const base = indLeftOf(basePPr)
  return block.items.map((it, k) => {
    const last = k === block.items.length - 1
    const pPr = makePPr(basePPr, {
      ind: `<w:ind w:left="${base + 360 * (it.level + 1)}" w:hanging="360"/>`,
      after: after === null ? null : (last ? after : Math.min(after, 60)),
      contextual: false,
    })
    const marker = run(rPrWith(baseRPr, {}), it.marker) + '<w:r><w:tab/></w:r>'
    return `<w:p>${pPr}${marker}${inlineRuns(it.text, baseRPr, {})}</w:p>`
  }).join('')
}

function renderQuote(block, basePPr, baseRPr, after) {
  const pPr = makePPr(basePPr, { ind: `<w:ind w:left="${indLeftOf(basePPr) + 360}"/>`, after })
  const runs = block.lines.map((l) => inlineRuns(l, baseRPr, { i: true })).join('<w:r><w:br/></w:r>')
  return `<w:p>${pPr}${runs}</w:p>`
}

function renderCode(block, basePPr, baseRPr, after) {
  const pPr = makePPr(basePPr, { ind: `<w:ind w:left="${indLeftOf(basePPr) + 360}"/>`, after, jc: 'left' })
  const runs = block.lines
    .map((l) => run(rPrWith(baseRPr, { code: true }), l))
    .join('<w:r><w:br/></w:r>')
  return `<w:p>${pPr}${runs}</w:p>`
}

function renderRule(basePPr, after) {
  const pPr = makePPr(basePPr, {
    pBdr: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>',
    after,
  })
  return `<w:p>${pPr}</w:p>`
}

/**
 * Corps markdown → paragraphes et tableaux Word, en clonant la mise en forme
 * du paragraphe qui portait `{{CORPS}}`.
 */
export function corpsToOoxml(corps, basePPr, baseRPr) {
  const blocks = parseBlocks(corps)
  if (!blocks.length) return `<w:p>${makePPr(basePPr)}</w:p>`
  const after = defaultAfter(basePPr)
  return blocks.map((b, k) => {
    switch (b.type) {
      case 'heading': return renderHeading(b, basePPr, baseRPr, after)
      case 'list': return renderList(b, basePPr, baseRPr, after)
      case 'table': return renderTable(b, basePPr, baseRPr, !blocks[k + 1] || blocks[k + 1].type === 'table')
      case 'quote': return renderQuote(b, basePPr, baseRPr, after)
      case 'code': return renderCode(b, basePPr, baseRPr, after)
      case 'rule': return renderRule(basePPr, after)
      default: return renderPara(b, basePPr, baseRPr, after)
    }
  }).join('')
}

/** Bloc signature : une ligne = un paragraphe, sans espacement intercalaire. */
export function signatureToOoxml(sig, basePPr, baseRPr) {
  const lines = String(sig == null ? '' : sig).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim())
  if (!lines.length) return ''
  const pPr = makePPr(basePPr, { after: 0, contextual: false })
  return lines.map((l) => `<w:p>${pPr}${inlineRuns(l.trim(), baseRPr, {})}</w:p>`).join('')
}

// ── Parcours des paragraphes (imbrication comprise) ──────────────────────────

/** Bornes des paragraphes de PREMIER niveau (les zones de texte en imbriquent). */
function topLevelParagraphs(xml) {
  const res = []
  const re = /<w:p(?:\s[^>]*?)?(\/?)>|<\/w:p>/g
  let depth = 0
  let start = -1
  let m
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(xml))) {
    if (m[0][1] === '/') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) { res.push({ start, end: re.lastIndex }); start = -1 }
      }
    } else if (m[1] === '/') {
      if (depth === 0) res.push({ start: m.index, end: re.lastIndex })
    } else {
      if (depth === 0) start = m.index
      depth += 1
    }
  }
  return res
}

function countOpens(p) {
  const re = /<w:p(?:\s[^>]*?)?>/g
  let n = 0
  while (re.exec(p)) n += 1
  return n
}

/** Applique `fn` à chaque paragraphe FEUILLE (sans paragraphe imbriqué). */
export function mapParagraphs(xml, fn) {
  const ranges = topLevelParagraphs(xml)
  if (!ranges.length) return xml
  let out = ''
  let pos = 0
  for (const r of ranges) {
    out += xml.slice(pos, r.start)
    const p = xml.slice(r.start, r.end)
    if (countOpens(p) > 1) {
      const gt = p.indexOf('>')
      out += p.slice(0, gt + 1) + mapParagraphs(p.slice(gt + 1, p.length - 6), fn) + '</w:p>'
    } else {
      out += fn(p)
    }
    pos = r.end
  }
  return out + xml.slice(pos)
}

/** Texte visible d'un paragraphe (tous ses runs concaténés). */
export function paraText(p) {
  return (p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [])
    .map((t) => t.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''))
    .join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** `w:pPr` et `w:rPr` (celui du PREMIER RUN) du paragraphe porteur de la balise. */
function propsOf(p) {
  const pPr = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0]
  const firstRun = (p.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/) || [''])[0]
  const rPr = (firstRun.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0]
  return { pPr, rPr }
}

/** `w:sectPr` porté par la balise : il doit survivre au remplacement. */
function sectPrOf(pPr) {
  return (pPr.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/) || [''])[0]
}

/** Nom canonique si le paragraphe ne porte QUE une balise, sinon null. */
function soloTokenOf(p) {
  const m = SOLO_TOKEN_RE.exec(paraText(p).trim())
  return m ? canonicalToken(m[1]) : null
}

// ── Remplacement des balises ─────────────────────────────────────────────────

/**
 * Remplace les balises EN LIGNE d'un paragraphe, même si Word les a éclatées
 * en plusieurs runs : on reconstitue le texte, on repère les balises, puis on
 * réécrit les `<w:t>` concernés. La valeur hérite du formatage du run qui
 * portait le début de la balise ; ses sauts de ligne deviennent des `<w:br/>`.
 */
function fillInlineTokens(p, resolve) {
  const segRe = /<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g
  const segs = []
  let m
  // eslint-disable-next-line no-cond-assign
  while ((m = segRe.exec(p))) {
    segs.push({
      start: m.index,
      end: segRe.lastIndex,
      text: m[0].replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''),
    })
  }
  if (!segs.length) return p

  const full = segs.map((s) => s.text).join('')
  if (!full.includes('{{')) return p

  // Position de chaque caractère : [index du segment, offset dans le segment].
  const owner = []
  segs.forEach((s, si) => { for (let j = 0; j < s.text.length; j += 1) owner.push([si, j]) })

  // `pieces[si][j]` : ce que devient le caractère j du segment si.
  const pieces = segs.map((s) => s.text.split(''))
  let touched = false
  const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags)
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(full))) {
    const name = canonicalToken(m[1])
    if (!name) continue
    touched = true
    for (let k = m.index; k < m.index + m[0].length; k += 1) {
      const [si, j] = owner[k]
      pieces[si][j] = ''
    }
    const [si0, j0] = owner[m.index]
    // La valeur est injectée telle quelle (échappée) ; un saut de ligne ferme
    // le `<w:t>`, pose un `<w:br/>` et en rouvre un — valide au sein d'un run.
    pieces[si0][j0] = String(resolve(name))
      .split(/(\n)/)
      .map((piece) => (piece === '\n' ? '</w:t><w:br/><w:t xml:space="preserve">' : escXml(piece)))
      .join('')
  }
  if (!touched) return p

  let out = ''
  let pos = 0
  segs.forEach((s, si) => {
    out += p.slice(pos, s.start)
    out += `<w:t xml:space="preserve">${pieces[si].join('')}</w:t>`
    pos = s.end
  })
  return out + p.slice(pos)
}

/**
 * Remplit une partie de document (`word/document.xml`, en-tête, pied de page).
 *
 * `vars` : { corps, titre, signature, destinataire, objet, date }. Une valeur
 * absente ou vide fait DISPARAÎTRE la balise (et le paragraphe, s'il ne portait
 * qu'elle) : aucun `{{…}}` ne subsiste dans le document remis.
 * `opts.blocks === false` : en-têtes et pieds de page, où seules les balises en
 * ligne ont un sens (on n'y déverse pas le corps de l'acte).
 */
export function fillPartXml(xml, vars = {}, opts = {}) {
  // En-tête / pied de page : déverser le corps de l'acte dans un bandeau
  // répété sur chaque page n'a pas de sens — la balise y est simplement retirée.
  const muted = opts.blocks === false ? new Set(['CORPS']) : new Set()
  const valueOf = (name) => {
    if (muted.has(name)) return ''
    const v = vars[VAR_OF[name]]
    return v == null ? '' : String(v)
  }

  // 1) Balises EN LIGNE (au milieu d'un texte : « Amiens, le {{DATE}} »). Les
  //    paragraphes réduits à une seule balise passent à l'étape 2, qui sait
  //    produire plusieurs paragraphes et retirer le paragraphe s'il reste vide.
  let out = mapParagraphs(xml, (p) => (soloTokenOf(p) ? p : fillInlineTokens(p, valueOf)))

  // 2) Paragraphe réduit à une balise : il DEVIENT le contenu — ou disparaît
  //    si la valeur est absente, pour ne laisser ni `{{…}}` ni ligne vide.
  out = mapParagraphs(out, (p) => {
    const name = soloTokenOf(p)
    if (!name) return p
    const { pPr, rPr } = propsOf(p)
    const value = valueOf(name)
    let generated = ''
    if (value.trim()) {
      if (name === 'CORPS') generated = corpsToOoxml(value, pPr, rPr)
      else if (name === 'SIGNATURE') generated = signatureToOoxml(value, pPr, rPr)
      else generated = `<w:p>${makePPr(pPr)}${inlineRuns(value, rPr, {})}</w:p>`
    }
    // Le `sectPr` de la balise (saut de section) est reposé sur un paragraphe
    // final, sinon la mise en page de la trame sauterait.
    const sectPr = sectPrOf(pPr)
    if (sectPr) return `${generated}<w:p><w:pPr>${sectPr}</w:pPr></w:p>`
    return generated
  })
  return out
}

/** Balises reconnues effectivement présentes dans une partie de document. */
export function findTokens(xml) {
  const found = new Set()
  mapParagraphs(String(xml || ''), (p) => {
    const txt = paraText(p)
    const re = new RegExp(TOKEN_RE.source, TOKEN_RE.flags)
    let m
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(txt))) {
      const name = canonicalToken(m[1])
      if (name) found.add(name)
    }
    return p
  })
  return TRAME_TOKENS.filter((t) => found.has(t))
}
