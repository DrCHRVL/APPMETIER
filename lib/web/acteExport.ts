/**
 * SIRAL — export officiel des actes rédigés (PDF / Word).
 *
 * Un seul gabarit pour les deux formats : en-tête à la française (drapeau
 * tricolore embarqué en data-URI — la CSP interdit toute ressource externe —,
 * RÉPUBLIQUE FRANÇAISE, devise), corps en Times New Roman 12 pt justifié,
 * format A4. Le nom du fichier téléchargé respecte le formalisme de la trame
 * suivie : <trame>_<dossier>_<AAAA-MM-JJ>.pdf|docx.
 */

// Drapeau 120×80 (bleu #000091 · blanc · rouge #E1000F, liseré gris), 224 octets.
export const DRAPEAU_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAABQCAIAAABd+SbeAAAAp0lEQVR42u3QAQ0AIQADsTlA+7vCBkr4YGIkpJfNQDNVKef5+tuXWhn9gQYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYNGjRo0KBBgwYN+g1oFfoBb7ftytwQencAAAAASUVORK5CYII='

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
 * Gabarit HTML officiel commun aux exports PDF et Word : en-tête République
 * française (drapeau + devise), titre centré, corps justifié « acte ».
 */
export function acteHtml(p: ActeExportable): string {
  const paras = String(p.contenu || '')
    .split(/\n{2,}/)
    .map((b) => `<p style="margin:0 0 10pt 0;text-align:justify;">${escapeHtml(b).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
  return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5;color:#000;">
  <table style="width:100%;border-collapse:collapse;margin:0 0 18pt 0;"><tr>
    <td style="width:120px;vertical-align:top;padding:0;">
      <img src="${DRAPEAU_PNG}" alt="Drapeau français" width="90" height="60" style="display:block;width:90px;height:60px;" />
      <div style="font-size:9.5pt;font-weight:bold;letter-spacing:0.5px;margin-top:4pt;">RÉPUBLIQUE<br>FRANÇAISE</div>
      <div style="font-size:7.5pt;font-style:italic;color:#333;margin-top:2pt;">Liberté · Égalité · Fraternité</div>
    </td>
    <td style="vertical-align:top;text-align:right;font-size:10pt;color:#333;padding:0;">
      MINISTÈRE DE LA JUSTICE
    </td>
  </tr></table>
  <h3 style="text-align:center;font-size:13pt;margin:0 0 14pt 0;text-transform:uppercase;text-decoration:underline;">${escapeHtml(p.titre || 'Acte')}</h3>
  ${paras}
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
