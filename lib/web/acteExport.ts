/**
 * SIRAL — export officiel des actes rédigés (PDF / Word).
 *
 * Un seul gabarit pour les deux formats. On rend FIDÈLEMENT le texte de l'acte
 * tel que l'attaché l'a rédigé en suivant la trame du magistrat : c'est la
 * trame (son en-tête, son titre, ses visas, sa mise en forme) qui commande la
 * présentation, PAS un habillage générique imposé. Aucun drapeau, aucun
 * en-tête « République française » ajouté d'office : rien qui ne soit dans la
 * trame. Corps en Times New Roman 12 pt justifié, format A4. Le nom du fichier
 * respecte le formalisme de la trame suivie : <trame>_<dossier>_<AAAA-MM-JJ>.
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

/**
 * Corps de l'acte → HTML fidèle. On respecte la structure du texte tel qu'il
 * a été rédigé d'après la trame : titres markdown (# / ## / ###), listes à
 * puces (- ou *), gras (**…**) et souligné (__…__), paragraphes séparés par
 * une ligne vide. Aucun titre ni en-tête n'est ajouté : la trame les porte.
 */
function acteBodyHtml(contenu: string): string {
  const lines = String(contenu || '').replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let bullets: string[] = []
  const flushPara = () => {
    if (para.length) { out.push(`<p style="margin:0 0 10pt 0;text-align:justify;">${para.join('<br>')}</p>`); para = [] }
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
    para.push(inlineMarkup(escapeHtml(t)))
  }
  flushPara(); flushBullets()
  return out.join('\n')
}

/**
 * Gabarit HTML commun aux exports PDF et Word : corps « acte » en Times New
 * Roman 12 pt justifié, rendu fidèle du texte de la trame. Rien d'imposé
 * au-dessus du contenu.
 */
export function acteHtml(p: ActeExportable): string {
  return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5;color:#000;">
${acteBodyHtml(p.contenu)}
</div>`
}

/** PDF (data-URI) au gabarit officiel — html2pdf chargé à la demande. */
export async function actePdfDataUri(p: ActeExportable): Promise<string> {
  const html2pdf = (await import('html2pdf.js')).default as unknown as (
  ) => { set: (o: object) => { from: (el: HTMLElement) => { outputPdf: (t: string) => Promise<string> } } }
  const el = document.createElement('div')
  el.style.padding = '20mm 20mm'
  el.innerHTML = acteHtml(p)
  return await html2pdf().set({
    margin: 0,
    filename: acteFileBase(p) + '.pdf',
    html2canvas: { scale: 2 },
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
  const htmlDocx = (await import('html-docx-js/dist/html-docx')).default as unknown as {
    asBlob: (html: string) => Blob
  }
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${acteHtml(p)}</body></html>`
  const blob = htmlDocx.asBlob(html)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = acteFileBase(p) + '.docx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
