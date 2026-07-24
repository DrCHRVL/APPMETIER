/**
 * SIRAL — Attaché de justice · graphiques statistiques en PNG, côté serveur.
 *
 * Le pendant serveur de utils/pdf/pdfRender.ts : les mêmes graphiques que la
 * page Statistiques et le rapport PDF (courbes, histogrammes, histogrammes
 * empilés, donuts), redessinés ici SANS navigateur ni dépendance native —
 * encodeur PNG maison (zlib de Node) + primitives de dessin + police bitmap.
 * Les images retournées par l'outil MCP stats_graphique permettent à
 * l'attaché de VOIR les courbes et camemberts (couleurs comprises) comme le
 * magistrat les voit dans l'app.
 *
 * Mêmes conventions visuelles que pdfRender : sur-échantillonnage ×2, fond
 * blanc, grille #EEF0F6, étiquettes grises, valeurs au-dessus des points.
 */
import zlib from 'node:zlib'

// ── Encodeur PNG (RGBA 8 bits, filtre 0) ──

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

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Encode un buffer RGBA (w×h×4) en PNG. */
export function encoderPng(largeur, hauteur, rgba) {
  const stride = largeur * 4
  const raw = Buffer.alloc((stride + 1) * hauteur)
  for (let y = 0; y < hauteur; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largeur, 0)
  ihdr.writeUInt32BE(hauteur, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Toile de dessin ──

function hex(couleur) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(couleur).trim())
  const n = m ? parseInt(m[1], 16) : 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export class Toile {
  constructor(largeur, hauteur, fond = '#ffffff') {
    this.w = largeur
    this.h = hauteur
    this.px = Buffer.alloc(largeur * hauteur * 4, 255)
    const [r, g, b] = hex(fond)
    for (let i = 0; i < largeur * hauteur; i++) {
      this.px[i * 4] = r; this.px[i * 4 + 1] = g; this.px[i * 4 + 2] = b
    }
  }

  point(x, y, [r, g, b], a = 1) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    if (a >= 1) { this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; return }
    this.px[i] = Math.round(r * a + this.px[i] * (1 - a))
    this.px[i + 1] = Math.round(g * a + this.px[i + 1] * (1 - a))
    this.px[i + 2] = Math.round(b * a + this.px[i + 2] * (1 - a))
  }

  rect(x, y, w, h, couleur, a = 1) {
    const c = hex(couleur)
    for (let yy = Math.max(0, Math.round(y)); yy < Math.min(this.h, Math.round(y + h)); yy++) {
      for (let xx = Math.max(0, Math.round(x)); xx < Math.min(this.w, Math.round(x + w)); xx++) this.point(xx, yy, c, a)
    }
  }

  disque(cx, cy, rayon, couleur, a = 1) {
    const c = hex(couleur)
    for (let yy = Math.ceil(cy - rayon); yy <= cy + rayon; yy++) {
      for (let xx = Math.ceil(cx - rayon); xx <= cx + rayon; xx++) {
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= rayon * rayon) this.point(xx, yy, c, a)
      }
    }
  }

  ligne(x0, y0, x1, y1, couleur, epaisseur = 1) {
    const dist = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    const n = Math.max(1, Math.ceil(dist))
    const r = epaisseur / 2
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n
      const y = y0 + ((y1 - y0) * i) / n
      if (epaisseur <= 1) this.point(x, y, hex(couleur))
      else this.disque(x, y, r, couleur)
    }
  }

  /** Anneau de camembert entre deux angles (radians, 0 = midi, sens horaire). */
  tranche(cx, cy, rInterieur, rExterieur, angle0, angle1, couleur) {
    const c = hex(couleur)
    const tau = Math.PI * 2
    const norm = (a) => ((a % tau) + tau) % tau
    const a0 = norm(angle0); const a1 = norm(angle1)
    const pleine = Math.abs(angle1 - angle0) >= tau - 1e-9
    for (let yy = Math.ceil(cy - rExterieur); yy <= cy + rExterieur; yy++) {
      for (let xx = Math.ceil(cx - rExterieur); xx <= cx + rExterieur; xx++) {
        const dx = xx - cx; const dy = yy - cy
        const d2 = dx * dx + dy * dy
        if (d2 < rInterieur * rInterieur || d2 > rExterieur * rExterieur) continue
        // angle depuis midi, sens horaire — comme les Pie de l'app (départ -π/2)
        const ang = norm(Math.atan2(dy, dx) + Math.PI / 2)
        const dedans = pleine || (a0 <= a1 ? ang >= a0 && ang < a1 : ang >= a0 || ang < a1)
        if (dedans) this.point(xx, yy, c)
      }
    }
  }

  texte(x, y, contenu, couleur, echelle = 2, alignement = 'left') {
    const s = preparerTexte(contenu)
    const largeur = largeurTexte(s, echelle)
    let x0 = Math.round(alignement === 'right' ? x - largeur : alignement === 'center' ? x - largeur / 2 : x)
    const c = hex(couleur)
    for (const ch of s) {
      const glyphe = FONT[ch] || FONT[' ']
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if ((glyphe[row] >> (4 - col)) & 1) {
            for (let sy = 0; sy < echelle; sy++) {
              for (let sx = 0; sx < echelle; sx++) this.point(x0 + col * echelle + sx, y + row * echelle + sy, c)
            }
          }
        }
      }
      x0 += 6 * echelle
    }
  }

  png() { return encoderPng(this.w, this.h, this.px) }
}

// ── Police bitmap 5×7 (majuscules, chiffres, ponctuation) ──

const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '%': [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b01000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  ':': [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
  "'": [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000],
}

/** Majuscules sans accents — la police ne connaît que ce répertoire. */
function preparerTexte(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/€/g, ' EUR')
    .replace(/[’‘]/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/[^A-Z0-9 %()+,\-./:']/g, ' ')
}

export function largeurTexte(s, echelle = 2) {
  return preparerTexte(s).length * 6 * echelle - echelle
}

// ── Habillage commun ──

const GRIS_GRILLE = '#EEF0F6'
const GRIS_TEXTE = '#98A0B4'
const ENCRE = '#0C1740'
const RATIO = 2

function nombreFr(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Cadre : fond, titre, sous-titre. Retourne l'ordonnée où commence le tracé. */
function entete(t, titre, sousTitre) {
  let y = 8 * RATIO
  if (titre) {
    t.texte(t.w / 2, y, titre, ENCRE, RATIO + 1, 'center')
    y += 7 * (RATIO + 1) + 4 * RATIO
  }
  if (sousTitre) {
    t.texte(t.w / 2, y, sousTitre, GRIS_TEXTE, RATIO, 'center')
    y += 7 * RATIO + 4 * RATIO
  }
  return y
}

function axesEtGrille(t, padL, padT, plotW, plotH, maxArrondi) {
  const pas = 5
  for (let i = 0; i <= pas; i++) {
    const y = padT + plotH - (plotH * i) / pas
    t.rect(padL, y, plotW, 1 * RATIO, GRIS_GRILLE)
    t.texte(padL - 4 * RATIO, y - 3 * RATIO, nombreFr((maxArrondi / pas) * i), GRIS_TEXTE, RATIO, 'right')
  }
}

const maxArrondi = (v) => Math.max(5, Math.ceil(v / 5) * 5)

/** Étiquettes d'abscisse allégées si trop nombreuses. */
function etiquettesX(t, labels, xPour, yBas) {
  const n = labels.length
  const largeurDispo = n > 1 ? xPour(1) - xPour(0) : t.w
  const tous = labels.every((l) => largeurTexte(l, RATIO) <= largeurDispo - 2 * RATIO)
  const pasAffichage = tous ? 1 : Math.ceil(n / Math.max(1, Math.floor(t.w / (largeurTexte(labels[0] || 'MMMM', RATIO) + 6 * RATIO))))
  labels.forEach((lab, i) => {
    if (i % pasAffichage !== 0 && i !== n - 1) return
    t.texte(xPour(i), yBas, lab, GRIS_TEXTE, RATIO, 'center')
  })
}

// ── Graphiques ──

/** Courbe d'évolution (série unique) — miroir de renderLineChartImg. */
export function graphiqueCourbe({ points, titre, sousTitre, couleur = '#16307A', largeur = 680, hauteur = 260 }) {
  const t = new Toile(largeur * RATIO, hauteur * RATIO)
  const hautTrace = entete(t, titre, sousTitre)
  if (!points.length) { t.texte(t.w / 2, t.h / 2, 'AUCUNE DONNEE', GRIS_TEXTE, RATIO, 'center'); return t.png() }

  const padL = 34 * RATIO; const padR = 14 * RATIO; const padT = hautTrace + 8 * RATIO; const padB = 22 * RATIO
  const plotW = t.w - padL - padR; const plotH = t.h - padT - padB
  const maxi = maxArrondi(Math.max(...points.map((p) => p.value), 1))
  axesEtGrille(t, padL, padT, plotW, plotH, maxi)

  const n = points.length
  const xPour = (i) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1))
  const yPour = (v) => padT + plotH - (plotH * v) / maxi

  // aire translucide sous la courbe
  for (let i = 0; i + 1 < n; i++) {
    const x0 = xPour(i); const x1 = xPour(i + 1)
    for (let x = Math.round(x0); x <= x1; x++) {
      const f = (x - x0) / Math.max(1, x1 - x0)
      const v = points[i].value + (points[i + 1].value - points[i].value) * f
      const yv = yPour(v)
      for (let y = Math.round(yv); y < padT + plotH; y++) t.point(x, y, hex(couleur), 0.10)
    }
  }
  for (let i = 0; i + 1 < n; i++) t.ligne(xPour(i), yPour(points[i].value), xPour(i + 1), yPour(points[i + 1].value), couleur, 2 * RATIO)
  if (n <= 14) points.forEach((p, i) => t.disque(xPour(i), yPour(p.value), 3 * RATIO, couleur))
  if (n <= 14) points.forEach((p, i) => { if (p.value > 0) t.texte(xPour(i), yPour(p.value) - 10 * RATIO, nombreFr(p.value), '#161616', RATIO, 'center') })
  etiquettesX(t, points.map((p) => p.label), xPour, padT + plotH + 4 * RATIO)
  return t.png()
}

/** Histogramme en colonnes — miroir de renderColumnChartImg. */
export function graphiqueColonnes({ points, titre, sousTitre, couleur = '#2980b9', largeur = 680, hauteur = 260 }) {
  const t = new Toile(largeur * RATIO, hauteur * RATIO)
  const hautTrace = entete(t, titre, sousTitre)
  if (!points.length) { t.texte(t.w / 2, t.h / 2, 'AUCUNE DONNEE', GRIS_TEXTE, RATIO, 'center'); return t.png() }

  const padL = 34 * RATIO; const padR = 14 * RATIO; const padT = hautTrace + 8 * RATIO; const padB = 22 * RATIO
  const plotW = t.w - padL - padR; const plotH = t.h - padT - padB
  const maxi = maxArrondi(Math.max(...points.map((p) => p.value), 1))
  axesEtGrille(t, padL, padT, plotW, plotH, maxi)

  const n = points.length
  const slot = plotW / n
  const bw = Math.min(slot * 0.62, 30 * RATIO)
  points.forEach((p, i) => {
    const x = padL + slot * i + (slot - bw) / 2
    const bh = (plotH * p.value) / maxi
    if (bh > 0) t.rect(x, padT + plotH - bh, bw, bh, couleur)
    if (p.value > 0) t.texte(x + bw / 2, padT + plotH - bh - 10 * RATIO, nombreFr(p.value), ENCRE, RATIO, 'center')
  })
  etiquettesX(t, points.map((p) => p.label), (i) => padL + slot * i + slot / 2, padT + plotH + 4 * RATIO)
  return t.png()
}

/** Légende sous un graphique : pastille couleur + libellé (+ valeur). Retourne la hauteur utilisée. */
function legende(t, y, items, avecValeurs = false) {
  const lignes = []
  let courante = []
  let larg = 0
  for (const it of items) {
    const lib = avecValeurs ? `${it.label} : ${nombreFr(it.value)}${it.pct != null ? ` (${it.pct}%)` : ''}` : it.label
    const w = 12 * RATIO + 4 * RATIO + largeurTexte(lib, RATIO) + 14 * RATIO
    if (larg + w > t.w - 20 * RATIO && courante.length) { lignes.push(courante); courante = []; larg = 0 }
    courante.push({ ...it, lib, w })
    larg += w
  }
  if (courante.length) lignes.push(courante)
  let yy = y
  for (const ligne of lignes) {
    const total = ligne.reduce((s, x) => s + x.w, 0)
    let x = (t.w - total) / 2
    for (const it of ligne) {
      t.rect(x, yy, 10 * RATIO, 10 * RATIO, it.color)
      t.texte(x + 14 * RATIO, yy + 1 * RATIO, it.lib, '#475069', RATIO)
      x += it.w
    }
    yy += 15 * RATIO
  }
  return yy - y
}

/** Histogramme empilé + légende — miroir de renderStackedColumnChartImg. */
export function graphiqueColonnesEmpilees({ labels, series, titre, sousTitre, largeur = 680, hauteur = 300 }) {
  const t = new Toile(largeur * RATIO, hauteur * RATIO)
  const hautTrace = entete(t, titre, sousTitre)
  if (!labels.length || !series.length) { t.texte(t.w / 2, t.h / 2, 'AUCUNE DONNEE', GRIS_TEXTE, RATIO, 'center'); return t.png() }

  const hLegende = (Math.ceil(series.length / 3) + 1) * 15 * RATIO
  const padL = 34 * RATIO; const padR = 14 * RATIO; const padT = hautTrace + 8 * RATIO; const padB = 22 * RATIO + hLegende
  const plotW = t.w - padL - padR; const plotH = t.h - padT - padB
  const totaux = labels.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0))
  const maxi = maxArrondi(Math.max(...totaux, 1))
  axesEtGrille(t, padL, padT, plotW, plotH, maxi)

  const n = labels.length
  const slot = plotW / n
  const bw = Math.min(slot * 0.64, 30 * RATIO)
  labels.forEach((lab, i) => {
    const x = padL + slot * i + (slot - bw) / 2
    let base = padT + plotH
    for (const ser of series) {
      const v = ser.values[i] || 0
      if (v <= 0) continue
      const bh = (plotH * v) / maxi
      base -= bh
      t.rect(x, base, bw, bh, ser.color)
    }
    if (totaux[i] > 0) t.texte(x + bw / 2, base - 10 * RATIO, nombreFr(totaux[i]), ENCRE, RATIO, 'center')
  })
  etiquettesX(t, labels, (i) => padL + slot * i + slot / 2, padT + plotH + 4 * RATIO)
  legende(t, padT + plotH + 16 * RATIO, series.map((s) => ({ label: s.label, color: s.color })))
  return t.png()
}

/** Donut (camembert troué) + total au centre + légende chiffrée — miroir de renderPieChartImg. */
export function graphiqueDonut({ items, titre, sousTitre, largeur = 560, diametre = 220 }) {
  const data = items.filter((i) => i.value > 0)
  const total = data.reduce((s, i) => s + i.value, 0)
  const hLegende = (Math.ceil(Math.max(1, data.length) / 2) + 1) * 15 * RATIO
  const hauteur = 34 + diametre + 8
  const t = new Toile(largeur * RATIO, hauteur * RATIO + hLegende)
  const hautTrace = entete(t, titre, sousTitre)
  if (total === 0) { t.texte(t.w / 2, t.h / 2, 'AUCUNE DONNEE', GRIS_TEXTE, RATIO, 'center'); return t.png() }

  const cx = t.w / 2
  const r = (diametre / 2) * RATIO
  const cy = hautTrace + 4 * RATIO + r
  const rIn = r * 0.6

  let angle = 0
  const tau = Math.PI * 2
  for (const it of data) {
    const part = (it.value / total) * tau
    t.tranche(cx, cy, rIn, r, angle, angle + part, it.color)
    angle += part
  }
  // séparateurs blancs entre les parts (comme les Pie de l'app)
  angle = 0
  for (const it of data) {
    const a = angle - Math.PI / 2
    t.ligne(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn, cx + Math.cos(a) * r, cy + Math.sin(a) * r, '#ffffff', 2 * RATIO)
    angle += (it.value / total) * tau
  }
  // étiquettes % sur l'anneau (parts ≥ 8 %)
  angle = 0
  const rMid = (r + rIn) / 2
  for (const it of data) {
    const part = (it.value / total) * tau
    const pct = (it.value / total) * 100
    if (pct >= 8) {
      const mid = angle + part / 2 - Math.PI / 2
      t.texte(cx + Math.cos(mid) * rMid, cy + Math.sin(mid) * rMid - 3 * RATIO, `${pct.toFixed(0)}%`, '#ffffff', RATIO, 'center')
    }
    angle += part
  }
  t.texte(cx, cy - 9 * RATIO, nombreFr(total), ENCRE, RATIO + 1, 'center')
  t.texte(cx, cy + 5 * RATIO, 'TOTAL', GRIS_TEXTE, RATIO, 'center')
  legende(t, cy + r + 10 * RATIO, data.map((d) => ({ ...d, pct: ((d.value / total) * 100).toFixed(1) })), true)
  return t.png()
}
