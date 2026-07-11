/**
 * SIRAL — Attaché de justice · architecture de dossier NPP et chronologie.
 *
 * Le magistrat colle l'arborescence des cotes telle qu'exportée de NPP
 * (« E - Procédure d'audience », « D27-D295 - Pièce n°6 - Sous dossier -
 * Réquisitions téléphonie », « Ca1-12 - Ordonnance de placement sous CJ
 * 01 10 25 »…). Un parseur DÉTERMINISTE la structure : cote, section,
 * libellé, profondeur, dates détectées — l'attaché comprend alors le sens
 * et l'ordre du dossier sans jamais deviner.
 *
 * La chronologie probatoire fusionne ensuite tout ce qui est daté :
 * actes SIRAL (débuts, fins, prolongations, poses), comptes-rendus,
 * historique de modifications (apparition de MEC…), DML déposées, et
 * cotes NPP datées. Stockage chiffré (clé globale), par dossier.
 */
import { attacheDir, ensureDir, atomicWrite, readJson, docServerKey, listDocsMeta, attacheTj } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { loadContentieux } from './dossier.mjs'

// ── Sections NPP standard (première lettre de la cote) ──
const SECTIONS = {
  A: 'Forme',
  B: 'Personnalité',
  C: 'Contrôle judiciaire et détention',
  D: 'Fond',
  E: 'Procédure d\'audience',
  G: 'Patrimoine',
  S: 'Scellés',
  Z: 'Certificats de conformité',
  J: 'Instruction', // tolérance : certains exports préfixent différemment
}

// cote en tête de ligne : « D27-D295 », « E11-E16 », « Ca1-12 », « Aa4-6 », « Z1 »
const COTE_RE = /^([A-Z][a-z]{0,2})\s*(\d+)?(?:\s*-\s*(?:[A-Z][a-z]{0,2})?(\d+))?$/

// dates françaises dans les libellés : 01 10 25 · 24.07.25 · 13-11-2025 · 05/03/25
const DATE_RE = /\b(\d{1,2})[ ./-](\d{1,2})[ ./-](\d{2,4})\b/g

function parseDate(d, m, y) {
  const day = Number(d), month = Number(m)
  let year = Number(y)
  if (year < 100) year += 2000
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function datesInLabel(label) {
  const out = []
  let m
  DATE_RE.lastIndex = 0
  while ((m = DATE_RE.exec(label)) !== null) {
    const iso = parseDate(m[1], m[2], m[3])
    if (iso) out.push(iso)
  }
  return out
}

/** Parse l'arborescence collée depuis NPP. Retourne { reference?, entries[] }. */
export function parseArchitectureNpp(texte) {
  const lines = String(texte).split('\n')
  const entries = []
  let reference
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    const trimmed = line.trim()
    if (!trimmed) continue
    const depth = Math.floor((line.length - line.trimStart().length) / 2)
    // référence du dossier (ex AMI-25-064-061) : ligne sans « - libellé » ni cote
    if (!reference && /^[A-Z]{2,4}-\d{2}-\d{2,4}(-\d+)?$/.test(trimmed)) {
      reference = trimmed
      continue
    }
    // « <cote> - <libellé> » — le libellé peut lui-même contenir des tirets
    const sep = trimmed.indexOf(' - ')
    const cotePart = sep >= 0 ? trimmed.slice(0, sep).trim() : trimmed
    const label = sep >= 0 ? trimmed.slice(sep + 3).trim() : ''
    const m = COTE_RE.exec(cotePart)
    if (!m) continue
    const lettre = m[1][0].toUpperCase()
    entries.push({
      cote: cotePart,
      lettre,
      section: SECTIONS[lettre] || lettre,
      sousSection: m[1].length > 1 ? m[1] : undefined, // Ca, Ab… (une personne, un registre)
      de: m[2] ? Number(m[2]) : undefined,
      a: m[3] ? Number(m[3]) : (m[2] ? Number(m[2]) : undefined),
      libelle: label || '(sans libellé)',
      profondeur: depth,
      dates: datesInLabel(label),
    })
  }
  return { reference, entries }
}

// ── Stockage par dossier ──

function cotesPath(numero) {
  return attacheDir('cotes', docServerKey(numero) + '.json')
}

export async function saveArchitecture(keys, numero, texte) {
  const parsed = parseArchitectureNpp(texte)
  if (!parsed.entries.length) {
    return { ok: false, error: 'Aucune cote reconnue — coller l\'arborescence telle qu\'affichée dans NPP' }
  }
  const record = {
    numero: String(numero),
    reference: parsed.reference,
    importeLe: new Date().toISOString(),
    nbCotes: parsed.entries.length,
    entries: parsed.entries.slice(0, 30_000),
  }
  const env = encryptJson(keys.global, record, { savedAt: record.importeLe })
  ensureDir(attacheDir('cotes'))
  atomicWrite(cotesPath(numero), JSON.stringify(env))
  const parSection = {}
  for (const e of record.entries) parSection[e.section] = (parSection[e.section] || 0) + 1
  return { ok: true, reference: parsed.reference, nbCotes: record.entries.length, parSection }
}

export function loadArchitecture(keys, numero) {
  const env = readJson(cotesPath(numero), null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

// ── Chronologie probatoire ──

function push(out, date, type, titre, detail, source) {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return
  out.push({ date: date.slice(0, 10), type, titre: String(titre).slice(0, 240), detail: detail ? String(detail).slice(0, 400) : undefined, source })
}

/**
 * Chronologie fusionnée d'un dossier : SIRAL (actes, prolongations, CR,
 * modifications — dont l'apparition de mis en cause), zone DML, et cotes
 * NPP datées. Triée par date croissante.
 */
export function buildChronologie(keys, numero) {
  const { data } = loadContentieux(keys)
  const wanted = String(numero).trim()
  const e = (data.enquetes || []).find((x) => String(x.numero).trim() === wanted)
    || (data.enquetes || []).find((x) => String(x.numero).replace(/\s+/g, '') === wanted.replace(/\s+/g, ''))
  if (!e) return null
  const out = []

  push(out, e.dateCreation, 'ouverture', 'Ouverture du dossier dans SIRAL', undefined, 'siral')
  if (e.dateOP) push(out, e.dateOP, 'op', 'Date d\'OP', undefined, 'siral')

  const acte = (kind, a, label) => {
    if (a.statut === 'autorisation_pending' && a.autorisationRequestedAt) {
      push(out, a.autorisationRequestedAt, 'attente_jld', `Demande d'autorisation — ${label}`, undefined, 'siral')
    }
    push(out, a.dateDebut, 'acte_debut', `Début — ${label}`, a.description, 'siral')
    if (a.datePose) push(out, a.datePose, 'pose', `Pose — ${label}`, undefined, 'siral')
    for (const p of a.prolongationsHistory || []) {
      push(out, p.date, 'prolongation', `Prolongation — ${label}`, `+${p.dureeAjoutee} ${p.dureeUnit || 'jours'}`, 'siral')
    }
    if (a.prolongationRequestedAt) push(out, a.prolongationRequestedAt, 'attente_jld', `Demande de prolongation — ${label}`, undefined, 'siral')
    push(out, a.dateFin, 'acte_fin', `Échéance — ${label}`, undefined, 'siral')
  }
  for (const a of e.ecoutes || []) acte('ecoute', a, `interception ${a.numero}${a.cible ? ` (${a.cible})` : ''}`)
  for (const a of e.geolocalisations || []) acte('geoloc', a, `géolocalisation ${a.objet}`)
  for (const a of e.actes || []) acte('autre', a, a.type || 'acte')

  for (const cr of e.comptesRendus || []) {
    push(out, cr.date, 'cr', `CR${cr.enqueteur ? ` — ${cr.enqueteur}` : ''}`,
      String(cr.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200), 'siral')
  }

  // historique de modifications : l'apparition de nouveaux MEC y est tracée
  for (const mod of e.modifications || []) {
    const ts = mod.timestamp || mod.date || mod.at
    const texte = mod.description || mod.summary || mod.type || ''
    if (ts && texte) push(out, new Date(ts).toISOString(), 'modification', String(texte).slice(0, 160), mod.user ? `par ${mod.user}` : undefined, 'siral')
  }

  // DML déposées dans la zone dédiée
  for (const d of listDocsMeta(attacheTj(), docServerKey(e.numero))) {
    if (d.rel.startsWith('DML/') || String(d.category || '').toUpperCase() === 'DML') {
      push(out, d.savedAt, 'dml', `DML archivée — ${d.originalName || d.rel.split('/').pop()}`, undefined, 'siral')
    }
  }

  // cotes NPP datées
  const archi = loadArchitecture(keys, e.numero)
  if (archi) {
    for (const c of archi.entries) {
      for (const dt of c.dates) {
        push(out, dt, 'cote', `[${c.cote}] ${c.libelle}`, c.section, 'npp')
      }
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date))
  return {
    numero: e.numero,
    reference: archi?.reference,
    architectureImportee: Boolean(archi),
    nbCotes: archi?.nbCotes,
    entries: out.slice(0, 2000),
  }
}
