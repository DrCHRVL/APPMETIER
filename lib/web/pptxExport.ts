/**
 * SIRAL — export PowerPoint (.pptx) des présentations rédigées par l'attaché.
 *
 * Même philosophie que l'export Word (htmlToDocx) : la production reste du
 * TEXTE BRUT éditable dans « Actes rédigés » ; ce module lui rend une FORME
 * de présentation professionnelle — un VRAI fichier Open XML construit pièce
 * par pièce (pizzip, déjà en dépendance), lisible par PowerPoint, LibreOffice
 * et Keynote, sans aucune dépendance nouvelle.
 *
 * Syntaxe de diapositives (celle que suit l'attaché — voir son prompt) :
 *   # Titre               → page de garde (les lignes suivantes = sous-titre)
 *   ## Titre de diapo     → nouvelle diapositive
 *   ### Intertitre        → intertitre dans la diapositive
 *   - puce                → liste (deux espaces devant = sous-puce)
 *   > citation            → citation mise en valeur
 *   | tableau | markdown |→ tableau mis en forme
 *   [GRAPHIQUE : …]       → image du graphique statistique (service attaché)
 *   [DIAGRAMME : …]       → image du diagramme libre (rendu local Chart.js)
 *   texte                 → paragraphe
 *
 * Gabarit sobre « parquet » : 16:9, titres Georgia vert profond (#2B5746 — la
 * couleur de l'app), corps Calibri anthracite, filet sous le titre, numéro de
 * page, pied de page discret. Aucune fantaisie : un support de réunion de
 * service, pas un prospectus.
 */

import PizZip from 'pizzip'
import type { ActeExportable, GraphiquesActe } from './acteExport'
import { acteFileBase, chargerImagesActe, marqueurImageLigne } from './acteExport'

// ── Géométrie (EMU : 914 400 par pouce) — diapositive 16:9 de 13,33 × 7,5 po ──
const SLIDE_W = 12_192_000
const SLIDE_H = 6_858_000
const MARGE_X = 685_800            // 0,75 po
const TITRE_Y = 365_760            // 0,4 po
const TITRE_H = 914_400            // 1 po
const CONTENU_Y = TITRE_Y + TITRE_H + 137_160
const CONTENU_W = SLIDE_W - 2 * MARGE_X
const CONTENU_H = SLIDE_H - CONTENU_Y - 548_640

// ── Charte ──
const VERT = '2B5746'              // accent de l'app
const ENCRE = '1F2937'             // corps anthracite
const GRIS = '6B7280'              // pieds de page, mentions
const FILET = 'C8D3CE'             // filet sous les titres
const ZEBRE = 'F3F6F4'             // lignes paires des tableaux
const POLICE_TITRE = 'Georgia'
const POLICE_CORPS = 'Calibri'

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

// ── Découpage du texte en diapositives ──

interface Puce { txt: string; niveau: 0 | 1 }
type Bloc =
  | { t: 'puces'; items: Puce[] }
  | { t: 'para'; txt: string }
  | { t: 'inter'; txt: string }
  | { t: 'citation'; txt: string }
  | { t: 'tableau'; lignes: string[][] }
  | { t: 'image'; cle: string; nom: string }

interface Diapo {
  genre: 'garde' | 'contenu'
  titre: string
  sousTitre?: string
  blocs: Bloc[]
}

/** Ligne de tableau markdown → cellules (sans les bords vides). */
function cellulesTableau(ligne: string): string[] {
  const cells = ligne.split('|')
  if (cells.length && !cells[0].trim()) cells.shift()
  if (cells.length && !cells[cells.length - 1].trim()) cells.pop()
  return cells.map((c) => c.trim())
}

/** Retire la mise en forme markdown légère (gras/souligné) : le gabarit décide. */
function texteNu(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').trim()
}

/**
 * Découpe la production en diapositives. Sans structure (« ## »), tout le
 * texte devient une page de garde + une diapositive unique : rien ne se perd.
 */
export function decouperPresentation(contenu: string, titreRepli: string): Diapo[] {
  const lignes = String(contenu || '').replace(/\r\n?/g, '\n').split('\n')
  const diapos: Diapo[] = []
  let courante: Diapo | null = null
  let garde: Diapo | null = null

  const ouvrir = (titre: string): Diapo => {
    const d: Diapo = { genre: 'contenu', titre, blocs: [] }
    diapos.push(d)
    return d
  }
  const cible = (): Diapo => courante || (courante = ouvrir(''))
  const dernierBloc = (): Bloc | undefined => {
    const d = courante
    return d ? d.blocs[d.blocs.length - 1] : undefined
  }

  for (const brute of lignes) {
    const ligne = brute.replace(/\s+$/, '')
    const t = ligne.trim()
    if (!t) continue

    const h1 = /^#\s+(.+)$/.exec(t)
    if (h1 && !garde && !diapos.length) {
      // Premier « # » du document : c'est la page de garde.
      garde = { genre: 'garde', titre: texteNu(h1[1]), blocs: [] }
      continue
    }
    // « ## » (ou un « # » tardif) ouvre une nouvelle diapositive.
    const h2 = /^##\s+(.+)$/.exec(t) || h1
    if (h2) { courante = ouvrir(texteNu(h2[1])); continue }
    if (/^---+$/.test(t)) { courante = ouvrir(''); continue }

    // Avant la première diapositive : les lignes nourrissent le sous-titre de garde.
    if (garde && !diapos.length && !/^[-*•>|]|^###/.test(t) && !marqueurImageLigne(t)) {
      garde.sousTitre = [garde.sousTitre, texteNu(t)].filter(Boolean).join('\n').slice(0, 300)
      continue
    }

    const h3 = /^###\s+(.+)$/.exec(t)
    if (h3) { cible().blocs.push({ t: 'inter', txt: texteNu(h3[1]) }); continue }

    const img = marqueurImageLigne(t)
    if (img) { cible().blocs.push({ t: 'image', cle: img.cle, nom: img.nom }); continue }

    if (/^\|.*\|$/.test(t)) {
      if (/^\|[\s:|-]+\|$/.test(t)) continue // ligne séparatrice |---|
      const d = dernierBloc()
      if (d?.t === 'tableau') d.lignes.push(cellulesTableau(t))
      else cible().blocs.push({ t: 'tableau', lignes: [cellulesTableau(t)] })
      continue
    }

    const puce = /^[-*•]\s+(.+)$/.exec(t)
    if (puce) {
      const niveau: 0 | 1 = /^\s{2,}/.test(ligne) ? 1 : 0
      const d = dernierBloc()
      const item: Puce = { txt: texteNu(puce[1]), niveau }
      if (d?.t === 'puces') d.items.push(item)
      else cible().blocs.push({ t: 'puces', items: [item] })
      continue
    }

    const cit = /^>\s?(.+)$/.exec(t)
    if (cit) { cible().blocs.push({ t: 'citation', txt: texteNu(cit[1]) }); continue }

    cible().blocs.push({ t: 'para', txt: texteNu(t) })
  }

  const out: Diapo[] = []
  if (garde) out.push(garde)
  else out.push({ genre: 'garde', titre: titreRepli || 'Présentation', blocs: [] })
  for (const d of diapos) if (d.titre || d.blocs.length) out.push(d)
  if (out.length === 1) out.push({ genre: 'contenu', titre: '', blocs: [{ t: 'para', txt: '(présentation vide)' }] })
  return out
}

// ── Briques XML ──

/** Un run de texte. */
function run(txt: string, o: { taille: number; couleur?: string; gras?: boolean; italique?: boolean; police?: string }): string {
  const props = `<a:rPr lang="fr-FR" sz="${o.taille * 100}"${o.gras ? ' b="1"' : ''}${o.italique ? ' i="1"' : ''} dirty="0">`
    + `<a:solidFill><a:srgbClr val="${o.couleur || ENCRE}"/></a:solidFill>`
    + `<a:latin typeface="${o.police || POLICE_CORPS}"/><a:cs typeface="${o.police || POLICE_CORPS}"/></a:rPr>`
  return `<a:r>${props}<a:t>${esc(txt)}</a:t></a:r>`
}

/** Un paragraphe (puce facultative, retraits en EMU). */
function para(runs: string, o: {
  align?: 'l' | 'ctr' | 'r'; avant?: number; apres?: number;
  puce?: { char: string; couleur: string }; marL?: number; indent?: number; interligne?: number;
} = {}): string {
  const spc = (v?: number) => (v ? `<a:spcPts val="${v}"/>` : '<a:spcPts val="0"/>')
  const buChar = o.puce
    ? `<a:buClr><a:srgbClr val="${o.puce.couleur}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="${esc(o.puce.char)}"/>`
    : '<a:buNone/>'
  return `<a:p><a:pPr${o.marL ? ` marL="${o.marL}"` : ''}${o.indent ? ` indent="${o.indent}"` : ''}${o.align ? ` algn="${o.align}"` : ''}>`
    + (o.interligne ? `<a:lnSpc><a:spcPct val="${o.interligne}"/></a:lnSpc>` : '')
    + `<a:spcBef>${spc(o.avant)}</a:spcBef><a:spcAft>${spc(o.apres)}</a:spcAft>${buChar}</a:pPr>${runs}</a:p>`
}

/** Une zone de texte positionnée. */
function zoneTexte(id: number, nom: string, x: number, y: number, w: number, h: number, corps: string, opts: { ancre?: 't' | 'ctr' | 'b'; ajuste?: boolean } = {}): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(nom)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${opts.ancre || 't'}">${opts.ajuste ? '<a:normAutofit fontScale="92500" lnSpcReduction="10000"/>' : ''}</a:bodyPr><a:lstStyle/>${corps}</p:txBody></p:sp>`
}

/** Un rectangle plein (bandeaux, filets). */
function rect(id: number, nom: string, x: number, y: number, w: number, h: number, couleur: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(nom)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${couleur}"/></a:solidFill>`
    + `<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`
}

/** Une image (relation rId vers ppt/media). */
function image(id: number, relId: string, nom: string, x: number, y: number, w: number, h: number): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(nom)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${Math.round(h)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}

/** Un tableau mis en forme (en-tête vert, zébrage). */
function tableau(id: number, lignes: string[][], x: number, y: number, w: number, tailleTexte: number): { xml: string; hauteur: number } {
  const nbCols = Math.max(1, ...lignes.map((l) => l.length))
  const colW = Math.floor(w / nbCols)
  const rowH = Math.round(tailleTexte * 2.6 * 12_700) // hauteur MINIMALE d'une ligne (EMU : 12 700 par point)
  const cell = (txt: string, entete: boolean, pair: boolean): string => {
    const runs = run(txt || ' ', { taille: tailleTexte, couleur: entete ? 'FFFFFF' : ENCRE, gras: entete })
    const fill = entete ? VERT : (pair ? ZEBRE : 'FFFFFF')
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(runs, { align: 'l' })}</a:txBody>`
      + `<a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">`
      + `<a:lnB w="6350"><a:solidFill><a:srgbClr val="${FILET}"/></a:solidFill></a:lnB>`
      + `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`
  }
  const rows = lignes.map((l, i) =>
    `<a:tr h="${rowH}">${Array.from({ length: nbCols }, (_, c) => cell(l[c] || '', i === 0, i % 2 === 0)).join('')}</a:tr>`
  ).join('')
  const xml = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tableau"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(w)}" cy="${rowH * lignes.length}"/></p:xfrm>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>`
    + `<a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${`<a:gridCol w="${colW}"/>`.repeat(nbCols)}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  return { xml, hauteur: rowH * lignes.length }
}

// ── Composition d'une diapositive ──

interface MediaRef { relId: string; base64: string; nom: string }

/** Estimation de l'encombrement d'un bloc (pour calibrer la taille du texte). */
function poidsBloc(b: Bloc): number {
  switch (b.t) {
    case 'puces': return b.items.reduce((n, i) => n + 1 + Math.floor(i.txt.length / 90), 0)
    case 'tableau': return b.lignes.length * 1.2 + 1
    case 'image': return 9
    case 'citation': return 2.2
    case 'inter': return 1.6
    default: return 1 + Math.floor(b.txt.length / 100)
  }
}

/** Corps d'une diapositive de CONTENU : titre + filet + blocs empilés. */
function composerContenu(d: Diapo, index: number, total: number, pied: string, images: Map<string, { base64: string; ratio: number }>): { xml: string; medias: MediaRef[] } {
  const formes: string[] = []
  const medias: MediaRef[] = []
  let id = 2

  if (d.titre) {
    formes.push(zoneTexte(id++, 'Titre', MARGE_X, TITRE_Y, CONTENU_W, TITRE_H,
      para(run(d.titre, { taille: 27, couleur: VERT, gras: true, police: POLICE_TITRE }), { interligne: 100000 }),
      { ancre: 'b' }))
    formes.push(rect(id++, 'Filet', MARGE_X, TITRE_Y + TITRE_H + 27_432, CONTENU_W, 27_432, FILET))
  }

  // Taille de texte calibrée sur la densité de la diapositive.
  const poids = d.blocs.reduce((n, b) => n + poidsBloc(b), 0)
  const taille = poids <= 7 ? 19 : poids <= 11 ? 17 : poids <= 16 ? 15 : 13
  const ligneH = Math.round(taille * 1.55 * 12_700) // hauteur d'une ligne en EMU (1 pt = 12 700, interligne 1,55)

  const yDebut = d.titre ? CONTENU_Y : TITRE_Y + 137_160
  const hDisponible = SLIDE_H - yDebut - 548_640
  let y = yDebut

  for (const b of d.blocs) {
    if (y >= yDebut + hDisponible - ligneH) break // diapositive pleine : on n'écrase pas, on tronque proprement
    const reste = yDebut + hDisponible - y
    switch (b.t) {
      case 'puces': {
        const paras = b.items.map((i) => para(
          run(i.txt, { taille: i.niveau ? taille - 2 : taille, couleur: ENCRE }),
          {
            puce: { char: i.niveau ? '–' : '•', couleur: VERT },
            marL: i.niveau ? 685_800 : 285_750,
            indent: i.niveau ? -228_600 : -285_750,
            avant: 500, apres: 300, interligne: 112000,
          },
        )).join('')
        const h = Math.min(reste, b.items.reduce((n, i) => n + (1 + Math.floor(i.txt.length / 95)), 0) * ligneH + 91_440)
        formes.push(zoneTexte(id++, 'Puces', MARGE_X, y, CONTENU_W, h, paras, { ajuste: true }))
        y += h + 68_580
        break
      }
      case 'para': {
        const nb = 1 + Math.floor(b.txt.length / 100)
        const h = Math.min(reste, nb * ligneH + 45_720)
        formes.push(zoneTexte(id++, 'Texte', MARGE_X, y, CONTENU_W, h,
          para(run(b.txt, { taille, couleur: ENCRE }), { avant: 200, apres: 200, interligne: 115000 }), { ajuste: true }))
        y += h + 54_864
        break
      }
      case 'inter': {
        const h = Math.min(reste, ligneH + 68_580)
        formes.push(zoneTexte(id++, 'Intertitre', MARGE_X, y, CONTENU_W, h,
          para(run(b.txt, { taille: taille + 1, couleur: VERT, gras: true }), { avant: 600 })))
        y += h + 27_432
        break
      }
      case 'citation': {
        const nb = 1 + Math.floor(b.txt.length / 80)
        const h = Math.min(reste, nb * ligneH + 137_160)
        formes.push(rect(id++, 'Trait citation', MARGE_X, y, 45_720, h, VERT))
        formes.push(zoneTexte(id++, 'Citation', MARGE_X + 228_600, y, CONTENU_W - 228_600, h,
          para(run(`« ${b.txt} »`, { taille: taille + 1, couleur: '374151', italique: true, police: POLICE_TITRE }), { interligne: 118000 }),
          { ancre: 'ctr', ajuste: true }))
        y += h + 68_580
        break
      }
      case 'tableau': {
        const tailleTab = b.lignes.length > 8 ? Math.max(10, taille - 5) : Math.max(11, taille - 3)
        const tb = tableau(id++, b.lignes.slice(0, 14), MARGE_X, y, CONTENU_W, tailleTab)
        formes.push(tb.xml)
        y += Math.min(reste, tb.hauteur) + 91_440
        break
      }
      case 'image': {
        const img = images.get(b.cle)
        if (!img) {
          const h = ligneH
          formes.push(zoneTexte(id++, 'Image manquante', MARGE_X, y, CONTENU_W, h,
            para(run(`[Graphique non disponible : ${b.nom}]`, { taille: taille - 2, couleur: GRIS, italique: true }), { align: 'ctr' })))
          y += h + 54_864
          break
        }
        const relId = `rIdImg${medias.length + 1}`
        const maxW = CONTENU_W * 0.86
        // Un bloc suit encore ? L'image lui laisse de la place (≤ 62 % de la
        // zone) ; dernier bloc → elle peut occuper tout ce qui reste.
        const estDernier = b === d.blocs[d.blocs.length - 1]
        const maxH = Math.max(ligneH * 3, estDernier ? reste - 45_720 : Math.min(reste - 45_720, Math.round(CONTENU_H * 0.62)))
        let w = maxW
        let h = w * img.ratio
        if (h > maxH) { h = maxH; w = h / img.ratio }
        medias.push({ relId, base64: img.base64, nom: b.nom })
        formes.push(image(id++, relId, b.nom, MARGE_X + (CONTENU_W - w) / 2, y, w, h))
        y += h + 68_580
        break
      }
    }
  }

  // Pied : repère de présentation à gauche, numéro à droite.
  formes.push(zoneTexte(id++, 'Pied', MARGE_X, SLIDE_H - 411_480, CONTENU_W - 914_400, 274_320,
    para(run(pied, { taille: 9, couleur: GRIS }))))
  formes.push(zoneTexte(id++, 'Numéro', SLIDE_W - MARGE_X - 914_400, SLIDE_H - 411_480, 914_400, 274_320,
    para(run(`${index} / ${total}`, { taille: 9, couleur: GRIS }), { align: 'r' })))

  return { xml: formes.join(''), medias }
}

/** Page de GARDE : bandeau plein vert, titre blanc, sous-titre, date. */
function composerGarde(d: Diapo, pied: string): { xml: string; medias: MediaRef[] } {
  const formes: string[] = []
  let id = 2
  formes.push(rect(id++, 'Fond', 0, 0, SLIDE_W, SLIDE_H, VERT))
  formes.push(rect(id++, 'Filet garde', MARGE_X, SLIDE_H * 0.42 - 27_432, 1_828_800, 36_576, 'D6C68A'))
  const titreParas = para(run(d.titre, { taille: d.titre.length > 60 ? 32 : 40, couleur: 'FFFFFF', gras: true, police: POLICE_TITRE }), { interligne: 105000 })
  formes.push(zoneTexte(id++, 'Titre', MARGE_X, SLIDE_H * 0.42 + 91_440, SLIDE_W - 2 * MARGE_X, 1_600_200, titreParas, { ajuste: true }))
  if (d.sousTitre) {
    const st = d.sousTitre.split('\n').map((l) =>
      para(run(l, { taille: 16, couleur: 'DDE7E2' }), { avant: 300, interligne: 115000 })).join('')
    formes.push(zoneTexte(id++, 'Sous-titre', MARGE_X, SLIDE_H * 0.42 + 1_737_360, SLIDE_W - 2 * MARGE_X, 1_143_000, st, { ajuste: true }))
  }
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  formes.push(zoneTexte(id++, 'Date', MARGE_X, SLIDE_H - 594_360, SLIDE_W - 2 * MARGE_X, 274_320,
    para(run([pied, dateStr].filter(Boolean).join(' — '), { taille: 11, couleur: 'B7C8C0' }))))
  return { xml: formes.join(''), medias: [] }
}

// ── Pièces fixes du paquet OOXML ──

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

function slideXml(corps: string): string {
  return `${XML_DECL}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
    + `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`
    + `${corps}</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`
}

function themeXml(): string {
  const c = (v: string) => `<a:srgbClr val="${v}"/>`
  return `${XML_DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SIRAL"><a:themeElements>`
    + `<a:clrScheme name="SIRAL"><a:dk1>${c('1F2937')}</a:dk1><a:lt1>${c('FFFFFF')}</a:lt1><a:dk2>${c(VERT)}</a:dk2><a:lt2>${c('F3F6F4')}</a:lt2>`
    + `<a:accent1>${c(VERT)}</a:accent1><a:accent2>${c('3C7A5F')}</a:accent2><a:accent3>${c('D6C68A')}</a:accent3><a:accent4>${c('34495E')}</a:accent4>`
    + `<a:accent5>${c('2980B9')}</a:accent5><a:accent6>${c('C0392B')}</a:accent6><a:hlink>${c('2980B9')}</a:hlink><a:folHlink>${c('8E44AD')}</a:folHlink></a:clrScheme>`
    + `<a:fontScheme name="SIRAL"><a:majorFont><a:latin typeface="${POLICE_TITRE}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>`
    + `<a:minorFont><a:latin typeface="${POLICE_CORPS}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>`
    + `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>`
    + `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>`
    + `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>`
    + `</a:themeElements></a:theme>`
}

function masterXml(): string {
  return `${XML_DECL}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
    + `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`
    + `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`
    + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
}

function layoutXml(): string {
  return `${XML_DECL}<p:sldLayout ${NS} type="blank"><p:cSld name="Vide">`
    + `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
    + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`
    + `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
}

function relsXml(rels: Array<{ id: string; type: string; target: string }>): string {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')
    + '</Relationships>'
}

const REL = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  master: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  layout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  office: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
}

/**
 * Assemble le paquet .pptx complet. `images` : marqueur canonique → PNG
 * (dataUri) + ratio hauteur/largeur, résolues par l'appelant.
 */
export function construirePptx(diapos: Diapo[], pied: string, images: Map<string, { base64: string; ratio: number }>, titreDoc: string): PizZip {
  const zip = new PizZip()
  const total = diapos.length
  const slideEntries: Array<{ nom: string; medias: MediaRef[] }> = []
  let mediaCount = 0

  diapos.forEach((d, i) => {
    const num = i + 1
    const { xml, medias } = d.genre === 'garde'
      ? composerGarde(d, pied)
      : composerContenu(d, num, total, pied, images)
    zip.file(`ppt/slides/slide${num}.xml`, slideXml(xml))
    const rels: Array<{ id: string; type: string; target: string }> = [
      { id: 'rId1', type: REL.layout, target: '../slideLayouts/slideLayout1.xml' },
    ]
    for (const m of medias) {
      mediaCount++
      const fichier = `image${mediaCount}.png`
      zip.file(`ppt/media/${fichier}`, m.base64, { base64: true })
      rels.push({ id: m.relId, type: REL.image, target: `../media/${fichier}` })
    }
    zip.file(`ppt/slides/_rels/slide${num}.xml.rels`, relsXml(rels))
    slideEntries.push({ nom: `slide${num}.xml`, medias })
  })

  zip.file('ppt/theme/theme1.xml', themeXml())
  zip.file('ppt/slideMasters/slideMaster1.xml', masterXml())
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml([
    { id: 'rId1', type: REL.layout, target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: REL.theme, target: '../theme/theme1.xml' },
  ]))
  zip.file('ppt/slideLayouts/slideLayout1.xml', layoutXml())
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relsXml([
    { id: 'rId1', type: REL.master, target: '../slideMasters/slideMaster1.xml' },
  ]))

  const sldIds = slideEntries.map((_, i) => `<p:sldId id="${256 + i}" r:id="rIdS${i + 1}"/>`).join('')
  zip.file('ppt/presentation.xml', `${XML_DECL}<p:presentation ${NS}>`
    + `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM1"/></p:sldMasterIdLst>`
    + `<p:sldIdLst>${sldIds}</p:sldIdLst>`
    + `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', relsXml([
    { id: 'rIdM1', type: REL.master, target: 'slideMasters/slideMaster1.xml' },
    { id: 'rIdTh1', type: REL.theme, target: 'theme/theme1.xml' },
    ...slideEntries.map((s, i) => ({ id: `rIdS${i + 1}`, type: REL.slide, target: `slides/${s.nom}` })),
  ]))

  const now = new Date().toISOString()
  zip.file('docProps/core.xml', `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(titreDoc)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  zip.file('docProps/app.xml', `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SIRAL</Application><Slides>${total}</Slides></Properties>`)
  zip.file('_rels/.rels', relsXml([
    { id: 'rId1', type: REL.office, target: 'ppt/presentation.xml' },
    { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
    { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
  ]))
  zip.file('[Content_Types].xml', `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
    + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
    + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
    + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + slideEntries.map((s) => `<Override PartName="/ppt/slides/${s.nom}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>')

  return zip
}

/** Dimensions naturelles d'une image data:, via le décodeur du navigateur. */
function mesurer(dataUri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(null)
    const im = new Image()
    im.onload = () => resolve({ width: im.naturalWidth || 0, height: im.naturalHeight || 0 })
    im.onerror = () => resolve(null)
    im.src = dataUri
  })
}

/** Résout les marqueurs d'images puis mesure chaque PNG (ratio d'insertion). */
async function preparerImages(contenu: string): Promise<Map<string, { base64: string; ratio: number }>> {
  const out = new Map<string, { base64: string; ratio: number }>()
  const resolues: GraphiquesActe | undefined = await chargerImagesActe(contenu)
  if (!resolues) return out
  for (const [cle, r] of resolues) {
    const m = /^data:image\/png;base64,(.+)$/.exec(r.dataUri)
    if (!m) continue
    const dims = await mesurer(r.dataUri)
    const ratio = dims && dims.width > 0 ? dims.height / dims.width : 0.55
    out.set(cle, { base64: m[1], ratio })
  }
  return out
}

/** Types pour lesquels un export en diaporama a un sens (jamais un acte à signer). */
const TYPES_PRESENTABLES = new Set(['presentation', 'livrable', 'note', 'autre'])

/** Vrai si la production peut s'exporter en présentation : type dédié, ou
 *  document structuré en sections (« ## ») d'un type non « acte à signer ». */
export function estPresentable(p: Pick<ActeExportable, 'type' | 'contenu'>): boolean {
  if (p.type === 'presentation') return true
  if (p.type && !TYPES_PRESENTABLES.has(p.type)) return false
  return /^##\s+/m.test(String(p.contenu || ''))
}

/** Génère et télécharge le .pptx d'une production. */
export async function downloadActePptx(p: ActeExportable): Promise<void> {
  const images = await preparerImages(p.contenu)
  const diapos = decouperPresentation(p.contenu, p.titre)
  const pied = [p.numero && p.numero !== '_hors-dossier' ? `Dossier ${p.numero}` : '', p.service || ''].filter(Boolean).join(' · ')
  const zip = construirePptx(diapos, pied, images, p.titre || 'Présentation')
  const blob = zip.generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    compression: 'DEFLATE',
  }) as Blob
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = acteFileBase(p) + '.pptx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
