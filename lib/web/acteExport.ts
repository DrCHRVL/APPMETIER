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
 * du fichier est LISIBLE et suit la convention du magistrat :
 * « <nom de la trame> - <service d'enquête> - <nom du dossier> [- <objet>] ».
 * Le 1ᵉʳ segment est le nom EXACT de la trame suivie (`source`) ; l'objet
 * (n° de ligne interceptée, objet géolocalisé…) ne s'ajoute que s'il est
 * renseigné. Les segments absents sont simplement omis.
 */

import { PAPETERIE } from './papeterie'
import type { TrameFormeType, TrameVars } from './trameFill'
import { parseMarqueur, formatMarqueur } from '@/lib/stats/graphiqueMarqueur.mjs'
import type { GraphiqueResolu } from './graphiquesActe'

/** Marqueurs [GRAPHIQUE : …] résolus en images (clé = marqueur canonique). */
export type GraphiquesActe = Map<string, GraphiqueResolu>

/**
 * Résout les marqueurs [GRAPHIQUE : …] de l'acte en images PNG (service
 * attaché, mêmes règles et couleurs que la page Statistiques). Best-effort :
 * aucun marqueur → aucune requête ; échec (service coupé, non-admin) →
 * undefined, l'export rend alors les lignes de repli lisibles.
 */
async function chargerGraphiquesSiBesoin(contenu: string): Promise<GraphiquesActe | undefined> {
  try {
    const { contientMarqueurs, chargerGraphiquesActe } = await import('./graphiquesActe')
    if (!contientMarqueurs(contenu)) return undefined
    return await chargerGraphiquesActe(contenu)
  } catch {
    return undefined
  }
}

/** Remplace chaque marqueur par une ligne lisible (chemins sans image : trame
 *  de forme Word de l'utilisateur, où l'on ne peut pas injecter de PNG). */
function remplacerMarqueursParTexte(contenu: string, graphiques?: GraphiquesActe): string {
  return String(contenu || '').split(/\r?\n/).map((ligne) => {
    const m = parseMarqueur(ligne)
    if (!m) return ligne
    const r = graphiques?.get(formatMarqueur(m))
    return `(graphique : ${r?.titre || m.graphique} — voir l'export PDF)`
  }).join('\n')
}

export interface ActeExportable {
  titre: string
  contenu: string
  numero?: string
  /** Nom EXACT de la trame suivie (« enq-art-76 »…) — 1ᵉʳ segment du nom de fichier. */
  source?: string
  /** Type de production (requisition, soit_transmis, prolongation_jld…) — repli quand la trame manque. */
  type?: string
  /** Service d'enquête du dossier (« SR Amiens »…) — 2ᵉ segment du nom de fichier. */
  service?: string
  /** Objet de l'acte (n° de ligne interceptée, objet géolocalisé…) — dernier segment, si présent. */
  objet?: string
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

/**
 * Nettoie un segment pour un nom de fichier LISIBLE : lettres (accents
 * compris), chiffres, espaces et ponctuation douce sont conservés ; seuls les
 * caractères interdits par les systèmes de fichiers (\ / : * ? " < > |) et les
 * caractères de contrôle sont retirés. Espaces compactés, bords nettoyés
 * (espaces, points, tirets), longueur bornée. On préserve la casse et les
 * accents : le nom reste lisible tel que le magistrat l'écrirait.
 */
function readableSegment(s: string): string {
  return (s || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-]+|[\s.\-]+$/g, '')
    .slice(0, 80)
    .trim()
}

/** Libellés lisibles des types de production (repli quand le titre manque). */
const TYPE_LABEL: Record<string, string> = {
  requisition: 'Réquisition',
  reponse_dml: 'Réponse DML',
  prolongation_jld: 'Prolongation JLD',
  saisine_jld: 'Saisine JLD',
  projet_reponse: 'Projet de réponse',
  soit_transmis: 'Soit-transmis',
  note: 'Note',
  livrable: 'Livrable',
  autre: 'Acte',
}

/**
 * 1ᵉʳ segment : le NOM DE LA TRAME suivie, tel qu'enregistré (`source`,
 * ex. « enq-art-76 », « ddejld-geolocalisation-tel-prolong ») — c'est le
 * « type d'acte conforme à la trame ». À défaut de trame : le libellé du type
 * de production, puis le titre de l'acte, en dernier « Acte ».
 */
function trameLabel(p: ActeExportable): string {
  const source = readableSegment(p.source || '')
  if (source) return source
  if (p.type && TYPE_LABEL[p.type]) return TYPE_LABEL[p.type]
  return readableSegment(p.titre || '') || 'Acte'
}

/**
 * Nom de fichier d'un export, LISIBLE et à la convention du magistrat :
 * « <nom de la trame> - <service d'enquête> - <nom du dossier> [- <objet>] ».
 * Le 1ᵉʳ segment reprend le nom EXACT de la trame suivie ; l'objet (n° de
 * ligne interceptée, objet géolocalisé…) ne s'ajoute que s'il est renseigné.
 * Les segments absents (service inconnu, dossier hors numéro…) sont omis.
 */
export function acteFileBase(p: ActeExportable): string {
  const trame = trameLabel(p)
  const service = readableSegment(p.service || '')
  const dossier = readableSegment(p.numero || '')
  const objet = readableSegment(p.objet || '')
  return [trame, service, dossier, objet].filter(Boolean).join(' - ') || 'Acte'
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
  // Largeurs explicites (px → twips ×15) : logo étroit, bandeau large. Total
  // ≈ 9975 twips = largeur utile A4 aux marges « parquet ». Fige la mise en
  // page côté Word (cf. tableBlock) → la ligne « Cour d'appel… » tient sur une
  // ligne au lieu de se tasser en colonne étroite.
  const logoCell = logo
    ? `<td style="border:0;width:130px;vertical-align:middle;padding:0 12pt 0 0;"><img src="${logo}" alt="Ministère de la Justice" style="width:96px;height:auto;" /></td>`
    : ''
  const bandeauWidth = logo ? 535 : 665
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 6pt 0;"><tr>${logoCell}`
    + `<td style="border:0;width:${bandeauWidth}px;vertical-align:middle;text-align:center;font-variant:small-caps;font-size:12pt;line-height:1.35;">${lignes}</td>`
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

// ── Gabarit COURRIER (lettre) — 3ᵉ face de la papeterie ──────────────────────
//
// Distinct des actes (requête / soit-transmis) : en-tête à deux colonnes
// (coordonnées du parquet à gauche, magistrat + destinataire + date à droite),
// objet souligné, corps, formule de politesse, signature, et un PIED DE PAGE
// coordonnées posé en pied de page Word réel (répété sur chaque page).

const RE_OBJET = /^\s*Objet\s*:/i
const RE_CLOSING = /^\s*(Je vous prie d['’]agr[ée]er|Veuillez agr[ée]er|Cordialement|Je vous prie de croire|Je vous prie d['’]agréer)/i
const RE_SALUT = /^(Madame|Monsieur|Mesdames|Messieurs|Ma[iî]tre)\b/i

/** Une production est un courrier si elle porte un « Objet : » et une formule de politesse. */
function isLettre(contenu: string): boolean {
  const lines = String(contenu || '').split(/\r?\n/).map((l) => l.trim())
  return lines.some((l) => RE_OBJET.test(l)) && lines.some((l) => RE_CLOSING.test(l))
}

/** Date au format long français (« 21 juillet 2026 »). */
function longDate(iso?: string): string {
  try {
    const d = iso ? new Date(iso) : new Date()
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return (iso || '').slice(0, 10) }
}

interface LettreParts { addressee: string; objet: string; dateStr: string; corps: string }

/**
 * Isole du texte du courrier les éléments qui remontent dans l'en-tête (objet,
 * destinataire, date) et laisse le reste comme corps. Les lignes d'identité
 * institutionnelle sont retirées : elles sont réinjectées par la papeterie.
 */
function parseLettre(contenu: string): LettreParts {
  const raw = String(contenu || '').replace(/\r\n?/g, '\n').split('\n')
  let objet = ''
  let dateStr = ''
  let addressee = ''
  const kept: string[] = []
  for (const line of raw) {
    const t = line.trim()
    if (RE_OBJET.test(t)) { objet = t.replace(RE_OBJET, '').trim(); continue }
    // Ligne de date isolée (« Amiens, le 21 juillet 2026 » / « Fait à …, le … ») :
    // courte et suivie d'un vrai début de date (chiffre ou jour de semaine), pour
    // ne pas happer une phrase du corps contenant « , le … ».
    const dm = t.match(/,\s*le\s+((?:\d|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche).*)$/i)
    if (dm && t.length <= 60) { dateStr = dm[1].trim(); continue }
    if (!kept.some((k) => k.trim()) && RE_INSTIT.test(t)) continue // en-tête d'identité : remplacé par la papeterie
    if (!addressee && RE_SALUT.test(t)) addressee = t.replace(/[,:]\s*$/, '')
    kept.push(line)
  }
  return { addressee, objet, dateStr, corps: kept.join('\n').trim() }
}

/** En-tête à deux colonnes du courrier (coordonnées | magistrat + destinataire + date). */
function renderLetterHeader(logo: string | undefined, addressee: string, dateStr: string): string {
  const idLines = [PAPETERIE.juridiction, PAPETERIE.parquet, PAPETERIE.sectionDetail]
    .map((l, i) => `<div style="font-variant:small-caps;font-size:${i === 0 ? '10.5pt' : '10pt'};${i === 0 ? 'font-weight:bold;' : ''}line-height:1.35;">${escapeHtml(l)}</div>`)
    .join('')
  const logoImg = logo ? `<div style="margin-bottom:6pt;"><img src="${logo}" alt="Ministère de la Justice" style="width:118px;height:auto;" /></div>` : ''
  const left = `<td style="border:1px solid #000;vertical-align:top;padding:8pt 10pt;width:46%;">${logoImg}${idLines}</td>`
  const m = PAPETERIE.magistrat
  const right = '<td style="border:1px solid #000;vertical-align:top;padding:8pt 10pt;">'
    + `<div style="font-weight:bold;">${escapeHtml(m.nomQualite)},</div>`
    + `<div>${escapeHtml(m.qualite.charAt(0).toUpperCase() + m.qualite.slice(1))}</div>`
    + `<div>Près le tribunal judiciaire d'Amiens</div>`
    + '<div>&#160;</div>'
    + '<div>À</div>'
    + `<div>${escapeHtml(addressee || '…')}</div>`
    + '<div>&#160;</div>'
    + `<div>${escapeHtml(PAPETERIE.ville)}, le ${escapeHtml(dateStr || longDate())}</div>`
    + '</td>'
  return `<table style="width:100%;border-collapse:collapse;margin:0 0 14pt 0;font-size:11pt;"><tr>${left}${right}</tr></table>`
}

/** Ligne « Objet : … » (mot « Objet » en gras souligné). */
function renderObjet(objet: string): string {
  return `<p style="margin:0 0 12pt 0;"><span style="font-weight:bold;text-decoration:underline;">Objet</span> : ${inlineMarkup(escapeHtml(objet))}</p>`
}

/** Bloc signature du courrier, calé à droite (P/ Le Procureur / Nom / Qualité). */
function renderLetterSignature(): string {
  const [l0, l1, l2] = PAPETERIE.signature
  return '<div style="margin-top:18pt;">'
    + `<div style="text-align:right;">${escapeHtml(l0 || '')}</div>`
    + `<div style="text-align:right;font-weight:bold;">${escapeHtml(l1 || '')}</div>`
    + `<div style="text-align:right;font-style:italic;">${escapeHtml(l2 || '')}</div>`
    + '</div>'
}

/** Pied de page coordonnées du parquet (posé en pied de page Word réel). */
export function letterFooterHtml(): string {
  const c = PAPETERIE.coordonnees
  const line = (s: string) => `<div style="text-align:center;font-size:8pt;line-height:1.25;color:#333333;">${escapeHtml(s)}</div>`
  return '<div>'
    + '<hr>'
    + line(c.adresse.join(' · '))
    + line(`Mèl : ${c.mails.join(' / ')} — Standard : ${c.standard}`)
    + line(c.thematiques)
    + '</div>'
}

/** Gabarit courrier complet. `footerInline` : true pour le PDF (pas de vrai pied de page). */
function letterHtml(p: ActeExportable, logo: string | undefined, footerInline: boolean, graphiques?: GraphiquesActe): string {
  const { addressee, objet, dateStr, corps } = parseLettre(p.contenu)
  const parts = [
    renderLetterHeader(logo, addressee, dateStr),
    objet ? renderObjet(objet) : '',
    `<div>${acteBodyHtml(corps, graphiques)}</div>`,
    renderLetterSignature(),
  ]
  if (footerInline) parts.push(letterFooterHtml())
  return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5;color:#000;">
${parts.filter(Boolean).join('\n')}
</div>`
}

/**
 * Corps de l'acte → HTML fidèle. On respecte la structure du texte : titres
 * markdown (## / ###), listes à puces (- ou *), gras (**…**) et souligné
 * (__…__), paragraphes séparés par une ligne vide. Les visas « Vu … »
 * reprennent leur italique. Le titre principal est traité à part (cadre) : il
 * n'apparaît donc plus ici.
 */
function acteBodyHtml(contenu: string, graphiques?: GraphiquesActe): string {
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
    // Marqueur [GRAPHIQUE : …] seul sur sa ligne → l'image régénérée par le
    // service attaché (le titre est DANS l'image) ; sans résolution, ligne de
    // repli lisible — l'export n'échoue jamais pour un graphique manquant.
    const marqueur = parseMarqueur(t)
    if (marqueur) {
      flushPara(); flushBullets()
      const resolu = graphiques?.get(formatMarqueur(marqueur))
      if (resolu) {
        out.push(`<div style="text-align:center;margin:6pt 0 10pt 0;"><img src="${resolu.dataUri}" alt="${escapeHtml(resolu.titre)}" style="width:${resolu.largeurPx || 640}px;max-width:100%;height:auto;" /></div>`)
      } else {
        out.push(`<p style="text-align:center;font-style:italic;color:#555555;margin:0 0 10pt 0;">[Graphique non disponible : ${escapeHtml(marqueur.graphique)}]</p>`)
      }
      continue
    }
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
export function acteHtml(p: ActeExportable, opts: { logo?: string, graphiques?: GraphiquesActe } = {}): string {
  // Courrier : gabarit dédié (en-tête 2 colonnes, objet, coordonnées). Pour le
  // PDF, le pied de page est intégré en fin de contenu (html2pdf n'a pas de
  // pied de page de section).
  if (isLettre(p.contenu)) return letterHtml(p, opts.logo, true, opts.graphiques)
  const s = parseActe(p.contenu)
  const aStructure = s.header.length > 0 || Boolean(s.titre) || s.signature.length > 0
  const parts: string[] = []
  if (s.header.length) parts.push(renderMasthead(s.header, opts.logo))
  if (s.titre) parts.push(renderTitleBox(s.titre, s.article))
  parts.push(`<div>${acteBodyHtml(aStructure ? s.corps : p.contenu, opts.graphiques)}</div>`)
  if (s.signature.length) parts.push(renderSignature(s.signature))
  return `<div style="font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5;color:#000;">
${parts.join('\n')}
</div>`
}

/**
 * Découpe l'export Word en corps + pied de page : pour un courrier, les
 * coordonnées deviennent un VRAI pied de page de section (répété sur chaque
 * page) au lieu d'un simple bloc en fin de contenu.
 */
export function acteDocxParts(p: ActeExportable, opts: { logo?: string, graphiques?: GraphiquesActe } = {}): { html: string; footerHtml?: string } {
  if (isLettre(p.contenu)) return { html: letterHtml(p, opts.logo, false, opts.graphiques), footerHtml: letterFooterHtml() }
  return { html: acteHtml(p, opts) }
}

/** Logo du ministère (data-URI), chargé à la demande pour ne pas alourdir le bundle. */
async function loadLogo(): Promise<string | undefined> {
  try { return (await import('./logoMinistere')).LOGO_MINISTERE_JUSTICE } catch { return undefined }
}

/** PDF (data-URI) au gabarit officiel — html2pdf chargé à la demande. */
export async function actePdfDataUri(p: ActeExportable): Promise<string> {
  const [logo, graphiques] = await Promise.all([loadLogo(), chargerGraphiquesSiBesoin(p.contenu)])
  const html2pdf = (await import('html2pdf.js')).default as unknown as (
  ) => { set: (o: object) => { from: (el: HTMLElement) => { outputPdf: (t: string) => Promise<string> } } }
  const el = document.createElement('div')
  el.style.padding = '20mm 14mm 20mm 20mm'
  el.innerHTML = acteHtml(p, { logo, graphiques })
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

/** Déclenche le téléchargement d'un Blob .docx. */
function triggerDocxDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Type de papeterie déduit de l'acte, pour choisir la trame de forme. */
export function detectTypeForme(p: ActeExportable): TrameFormeType {
  if (isLettre(p.contenu)) return 'courrier'
  const titre = (parseActe(p.contenu).titre || p.titre || '').toUpperCase()
  if (/SOIT[-\s]?TRANSMIS/.test(titre)) return 'soit-transmis'
  if (/REQU[ÊE]TE|R[ÉE]QUISITO/.test(titre)) return 'requete'
  return 'defaut'
}

/** Variables extraites de l'acte pour remplir les balises d'une trame de forme. */
function extractTrameVars(p: ActeExportable, type: TrameFormeType): TrameVars {
  if (type === 'courrier') {
    const { addressee, objet, dateStr, corps } = parseLettre(p.contenu)
    return { destinataire: addressee, objet, date: dateStr || longDate(p.updatedAt), corps }
  }
  const s = parseActe(p.contenu)
  return {
    titre: s.titre || p.titre || '',
    corps: s.corps,
    signature: s.signature.join('\n'),
    date: longDate(p.updatedAt),
  }
}

export async function downloadActeDocx(p: ActeExportable): Promise<void> {
  const graphiques = await chargerGraphiquesSiBesoin(p.contenu)

  // 1) Trame de forme définie par l'utilisateur pour ce type d'acte : on part
  //    de SON .docx et on remplit les balises. La forme est 100 % la sienne.
  //    Impossible d'y injecter une image : les marqueurs [GRAPHIQUE : …]
  //    deviennent une ligne lisible qui renvoie à l'export PDF.
  try {
    const type = detectTypeForme(p)
    const { loadTramesForme, pickTrameForme } = await import('./tramesFormeStore')
    const trame = pickTrameForme(await loadTramesForme(), type)
    if (trame?.docxBase64) {
      const { fillTrameDocx } = await import('./trameFill')
      const vars = extractTrameVars(p, type)
      if (vars.corps) vars.corps = remplacerMarqueursParTexte(vars.corps, graphiques)
      const blob = await fillTrameDocx(trame.docxBase64, vars)
      triggerDocxDownload(blob, acteFileBase(p) + '.docx')
      return
    }
  } catch (e) {
    // Trame absente / invalide : on retombe proprement sur la génération intégrée.
    console.warn('Trame de forme indisponible, génération intégrée :', e)
  }

  // 2) Repli : papeterie reconstruite (aucune trame de forme définie). Les
  //    marqueurs [GRAPHIQUE : …] deviennent de vraies images dans le document.
  const logo = await loadLogo()
  const { html, footerHtml } = acteDocxParts(p, { logo, graphiques })
  const { buildDocxBlob } = await import('./htmlToDocx')
  const blob = await buildDocxBlob(html, {
    defaultFont: 'Times New Roman',
    defaultSizeHalfPt: 24,
    // Marges A4 « parquet » (en twips) : haut/bas/gauche 2 cm, droite 1,4 cm.
    pageMargins: { top: 1134, right: 794, bottom: 1134, left: 1134 },
    footerHtml,
  })
  triggerDocxDownload(blob, acteFileBase(p) + '.docx')
}
