/**
 * SIRAL — export officiel des actes rédigés (PDF / Word).
 *
 * Un seul gabarit pour les deux formats. Le texte de l'acte reste FIDÈLE à ce
 * que l'attaché a rédigé d'après la trame du magistrat ; ce module lui rend sa
 * FORME officielle — la « papeterie » que la conversion des trames en markdown
 * avait fait perdre. On ne fabrique RIEN : on re-typographie l'en-tête, le
 * titre, les visas et la signature que l'acte porte déjà. Concrètement :
 *   - l'en-tête institutionnel (Cour d'appel, parquet, section) redevient un
 *     bandeau centré, flanqué du logo du ministère de la Justice ;
 *   - le titre de l'acte et son article de rattachement reprennent leur cadre
 *     bordé ;
 *   - le corps reste en Times New Roman justifié, les visas « Vu … » en
 *     italique ;
 *   - le bloc de signature (« Fait à …, le … / P/ … ») se cale à droite.
 * Si l'acte ne porte pas cet habillage (note libre, brouillon), rien n'est
 * imposé : on retombe sur le rendu neutre. Aucun drapeau, aucune juridiction
 * n'est ajoutée d'office — c'est la trame, via le texte, qui commande. Le nom
 * du fichier respecte le formalisme de la trame suivie :
 * <trame>_<dossier>_<AAAA-MM-JJ>.
 */

export interface ActeExportable {
  titre: string
  contenu: string
  numero?: string
  /** Nom (slug) de la trame suivie — impose le formalisme du nom de fichier. */
  source?: string
  updatedAt?: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Mise en forme légère héritée des trames (déjà échappée en amont). */
function inlineMarkup(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
}

function safeFileSegment(s: string): string {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/**
 * Nom de fichier d'un export : le formalisme du nom de la trame suivie
 * (« requete-prolongation-geoloc-jld »), complété du dossier et de la date —
 * à défaut de trame, le titre de l'acte.
 */
export function acteFileBase(p: ActeExportable): string {
  const trame = safeFileSegment(p.source || '') || safeFileSegment(p.titre) || 'acte'
  const dossier = safeFileSegment(p.numero || '')
  const date = (p.updatedAt || new Date().toISOString()).slice(0, 10)
  return [trame, dossier, date].filter(Boolean).join('_')
}

// ── Reconnaissance de la structure d'un acte (à partir de son propre texte) ──

/** Désignation de l'acte : première ligne qui nomme le type d'acte. */
const RE_TITRE = /^(?:REQU[ÊE]TE|SOIT[-\s]?TRANSMIS|ORDONNANCE|AUTORISATION|R[ÉE]QUISITOIRES?|R[ÉE]QUISITIONS?|PROC[ÈE]S[-\s]?VERBAL|COMMISSION\s+ROGATOIRE|SAISINE|PROLONGATION|D[ÉE]SIGNATION|MANDAT|PERMIS\b|DEMANDE\b|NOTE\b)/i
/** Lignes de l'en-tête institutionnel (masthead) : à styliser, jamais inventées. */
const RE_INSTIT = /(MINIST[ÈE]RE\s+DE\s+LA\s+JUSTICE|COUR\s+D['’]APPEL|TRIBUNAL\s+JUDICIAIRE|PARQUET|PROCUREUR\s+DE\s+LA\s+R[ÉE]PUBLIQUE|^SECTION\b)/i
/** Ligne d'article de rattachement, sous le titre. */
const RE_ARTICLE = /^Articles?\s+[\dLRA]/i
/** Début du bloc signature (« Fait à … », « Faits à … », « Fait au parquet … »).
 *  On exige l'espace après « à » / « au » plutôt qu'une limite de mot \b : « à »
 *  n'est pas un caractère de mot ASCII, donc « à\b » ne matcherait jamais. */
const RE_SIGN = /^Faits?\s+(?:à|au)\s/i

/** Retire un éventuel préfixe de titre markdown (#, ##…). */
function stripHead(line: string): string {
  return line.replace(/^\s*#{1,6}\s*/, '').trim()
}

/** Vrai si la ligne est en capitales (titre d'acte non préfixé). */
function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '')
  return letters.length >= 12 && letters === letters.toUpperCase()
}

interface ActeStructure {
  header: string[]
  titre: string | null
  article: string | null
  corps: string
  signature: string[]
}

/**
 * Découpe l'acte en régions à partir de son propre texte, sans rien fabriquer :
 * bandeau institutionnel (avant le titre), titre + article (dans le cadre),
 * corps, puis bloc signature. Non destructif : toute ligne non promue retombe
 * dans le corps. Si aucune structure n'est reconnue, tout reste dans le corps.
 */
function parseActe(contenu: string): ActeStructure {
  const lines = String(contenu || '').replace(/\r\n?/g, '\n').split('\n')
  const nonEmpty = lines
    .map((l, i) => ({ t: l.trim(), i }))
    .filter((x) => x.t.length > 0)

  // Titre : parmi les premières lignes, la désignation d'acte (ou une ligne en
  // capitales qui n'est pas une ligne d'en-tête institutionnel).
  let titleIdx = -1
  let titre: string | null = null
  for (const { t, i } of nonEmpty.slice(0, 14)) {
    const txt = stripHead(t)
    if (RE_TITRE.test(txt) || (isAllCaps(txt) && txt.length >= 18 && !RE_INSTIT.test(txt))) {
      titleIdx = i
      titre = txt
      break
    }
  }

  let header: string[] = []
  let article: string | null = null
  let bodyStart = 0

  if (titleIdx >= 0) {
    header = lines.slice(0, titleIdx).map((s) => stripHead(s.trim())).filter(Boolean)
    bodyStart = titleIdx + 1
    const after = nonEmpty.find((x) => x.i > titleIdx)
    if (after) {
      const at = stripHead(after.t)
      if ((RE_ARTICLE.test(at) || /code de proc[ée]dure p[ée]nale/i.test(at)) && at.length <= 140) {
        article = at
        bodyStart = after.i + 1
      }
    }
  }

  // Signature : premier « Fait à … » dans les 8 dernières lignes non vides.
  let sigStart = -1
  for (const { t, i } of nonEmpty.slice(-8)) {
    if (RE_SIGN.test(stripHead(t))) { sigStart = i; break }
  }
  let signature: string[] = []
  let bodyEnd = lines.length
  if (sigStart >= 0 && sigStart >= bodyStart) {
    signature = lines.slice(sigStart).map((s) => stripHead(s.trim())).filter(Boolean)
    bodyEnd = sigStart
  }

  const corps = lines.slice(bodyStart, bodyEnd).join('\n').trim()
  return { header, titre, article, corps, signature }
}

// ── Rendu HTML des régions ──

/** Bandeau institutionnel : logo du ministère + lignes d'en-tête centrées. */
function renderMasthead(header: string[], logo?: string): string {
  const lignes = header.map((h) => {
    const txt = inlineMarkup(escapeHtml(h))
    if (/PARQUET/i.test(h) && /PROCUREUR/i.test(h)) return `<div style="font-weight:bold;">${txt}</div>`
    if (/^Section\b/i.test(h)) return `<div style="font-style:italic;font-variant:normal;">${txt}</div>`
    return `<div>${txt}</div>`
  }).join('')
  const logoCell = logo
    ? `<td style="border:0;width:104px;vertical-align:middle;padding:0 12pt 0 0;"><img src="${logo}" alt="Ministère de la Justice" style="width:96px;height:auto;" /></td>`
    : ''
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 6pt 0;"><tr>${logoCell}`
    + `<td style="border:0;vertical-align:middle;text-align:center;font-variant:small-caps;font-size:12pt;line-height:1.35;">${lignes}</td>`
    + `</tr></table>`
}

/** Cadre bordé : titre de l'acte en gras + article en italique. */
function renderTitleBox(titre: string, article: string | null): string {
  const t = `<div style="font-weight:bold;font-size:13.5pt;line-height:1.3;">${inlineMarkup(escapeHtml(titre))}</div>`
  const a = article
    ? `<div style="font-style:italic;font-size:12pt;margin-top:3pt;">${inlineMarkup(escapeHtml(article))}</div>`
    : ''
  return `<table style="width:100%;border-collapse:collapse;margin:8pt 0 12pt 0;">`
    + `<tr><td style="border:1px solid #000;padding:8pt 12pt;text-align:center;">${t}${a}</td></tr></table>`
}

/** Bloc signature, calé à droite. */
function renderSignature(signature: string[]): string {
  const lignes = signature.map((l) => `<div style="text-align:right;">${inlineMarkup(escapeHtml(l))}</div>`).join('')
  return `<div style="margin-top:20pt;">${lignes}</div>`
}

/**
 * Corps de l'acte → HTML fidèle. On respecte la structure du texte : titres
 * markdown (## / ###), listes à puces (- ou *), gras (**…**) et souligné
 * (__…__), paragraphes séparés par une ligne vide. Les visas « Vu … »
 * reprennent leur italique. Le titre principal est traité à part (cadre) : il
 * n'apparaît donc plus ici.
 */
function acteBodyHtml(contenu: string): string {
  const lines = String(contenu || '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let paraItalic = false
  let bullets: string[] = []
  const flushPara = () => {
    if (para.length) {
      out.push(`<p style="margin:0 0 10pt 0;text-align:justify;${paraItalic ? 'font-style:italic;' : ''}">${para.join('<br>')}</p>`)
      para = []
      paraItalic = false
    }
  }
  const flushBullets = () => {
    if (bullets.length) {
      out.push(`<ul style="margin:0 0 10pt 0;padding-left:22pt;">${bullets.map((b) => `<li style="margin:0 0 3pt 0;text-align:justify;">${b}</li>`).join('')}</ul>`)
      bullets = []
    }
  }
  for (const raw of lines) {
    const t = raw.trim()
    if (!t) { flushPara(); flushBullets(); continue }
    const h = t.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      flushPara(); flushBullets()
      const txt = inlineMarkup(escapeHtml(h[2]))
      out.push(h[1].length === 1
        ? `<p style="text-align:center;font-weight:bold;font-size:13pt;margin:6pt 0 12pt 0;">${txt}</p>`
        : `<p style="font-weight:bold;margin:12pt 0 6pt 0;">${txt}</p>`)
      continue
    }
    const b = t.match(/^[-*]\s+(.+)$/)
    if (b) { flushPara(); bullets.push(inlineMarkup(escapeHtml(b[1]))); continue }
    flushBullets()
    if (para.length === 0 && /^Vu\b/i.test(t)) paraItalic = true
    para.push(inlineMarkup(escapeHtml(t)))
  }
  flushPara(); flushBullets()
  return out.join('\n')
}

/**
 * Gabarit HTML commun aux exports PDF et Word : papeterie officielle
 * (bandeau + logo, cadre du titre, corps justifié, signature) reconstruite à
 * partir du texte de l'acte, en Times New Roman. Si aucune structure n'est
 * reconnue, on rend simplement le corps — rien d'imposé.
 */
export function acteHtml(p: ActeExportable, opts: { logo?: string } = {}): string {
  const s = parseActe(p.contenu)
  const aStructure = s.header.length > 0 || Boolean(s.titre) || s.signature.length > 0
  const parts: string[] = []
  if (s.header.length) parts.push(renderMasthead(s.header, opts.logo))
  if (s.titre) parts.push(renderTitleBox(s.titre, s.article))
  parts.push(`<div>${acteBodyHtml(aStructure ? s.corps : p.contenu)}</div>`)
  if (s.signature.length) parts.push(renderSignature(s.signature))
  return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5;color:#000;">
${parts.join('\n')}
</div>`
}

/** Logo du ministère (data-URI), chargé à la demande pour ne pas alourdir le bundle. */
async function loadLogo(): Promise<string | undefined> {
  try { return (await import('./logoMinistere')).LOGO_MINISTERE_JUSTICE } catch { return undefined }
}

/** PDF (data-URI) au gabarit officiel — html2pdf chargé à la demande. */
export async function actePdfDataUri(p: ActeExportable): Promise<string> {
  const logo = await loadLogo()
  const html2pdf = (await import('html2pdf.js')).default as unknown as (
  ) => { set: (o: object) => { from: (el: HTMLElement) => { outputPdf: (t: string) => Promise<string> } } }
  const el = document.createElement('div')
  el.style.padding = '20mm 14mm 20mm 20mm'
  el.innerHTML = acteHtml(p, { logo })
  return await html2pdf().set({
    margin: 0,
    filename: acteFileBase(p) + '.pdf',
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4' },
  }).from(el).outputPdf('datauristring')
}

export async function downloadActePdf(p: ActeExportable): Promise<void> {
  const uri = await actePdfDataUri(p)
  const a = document.createElement('a')
  a.href = uri
  a.download = acteFileBase(p) + '.pdf'
  a.click()
}

export async function downloadActeDocx(p: ActeExportable): Promise<void> {
  const logo = await loadLogo()
  const htmlDocx = (await import('html-docx-js/dist/html-docx')).default as unknown as {
    asBlob: (html: string, options?: { margins?: { top?: number; right?: number; bottom?: number; left?: number } }) => Blob
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${acteHtml(p, { logo })}</body></html>`
  // Marges A4 « parquet » (en twips) : haut/bas/gauche 2 cm, droite 1,4 cm.
  const blob = htmlDocx.asBlob(html, { margins: { top: 1134, right: 794, bottom: 1134, left: 1134 } })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = acteFileBase(p) + '.docx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
