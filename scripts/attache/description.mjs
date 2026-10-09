/**
 * SIRAL — Attaché de justice · DONNÉES DE LA DESCRIPTION À LA DEMANDE.
 *
 * L'icône « Actualiser » de la description doit s'appuyer sur TOUT le dossier :
 * tous les CR, tous les actes, toutes les pièces versées sur le serveur. Plutôt
 * que de laisser le run aller chercher (et s'arrêter à mi-chemin faute de
 * tours), le moteur JOINT tout au prompt, en coût nul : CR en texte intégral,
 * sommaire du registre pièce par pièce (type, date, personnes, résumé), liste
 * des pièces encore sans fiche. Budgets de caractères pour rester dans une
 * fenêtre raisonnable — on rogne d'abord les CR les plus anciens.
 */
import { listDocsMeta, docServerKey, attacheTj } from './store.mjs'
import { loadContentieux, numeroCanonique } from './dossier.mjs'
import { readRegistre, recouperRegistres } from './registre.mjs'
import { readDossierMemory } from './dossierMemory.mjs'
import { listerLiens, recoupementMecs, mecCanonId } from './carto.mjs'

const CR_BUDGET = 80_000
const CR_ANCIEN_MAX = 1_500
const PIECES_BUDGET = 90_000
const DESCRIPTION_MAX = 8_000
const RECOUPEMENTS_MAX = 25

function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

/** Pièces serveur du dossier (hors jumeaux MD/) : avec / sans mini-fiche. */
export function couverturePieces(keys, numero) {
  const docKey = docServerKey(numeroCanonique(keys, numero))
  let metas = []
  try { metas = listDocsMeta(attacheTj(), docKey).filter((d) => !String(d.rel).startsWith('MD/')) } catch { metas = [] }
  const reg = readRegistre(keys, docKey)
  const fichees = []
  const sansFiche = []
  for (const m of metas) {
    const r = reg.pieces[String(m.rel)]
    if (r?.fiche) fichees.push({ chemin: String(m.rel), ...r.fiche, entites: r.entites, verseeLe: m.savedAt })
    else sansFiche.push(String(m.rel))
  }
  fichees.sort((a, b) => String(a.datePiece || '').localeCompare(String(b.datePiece || '')) || a.chemin.localeCompare(b.chemin))
  sansFiche.sort()
  return { total: metas.length, fichees, sansFiche }
}

/** Les lignes de données jointes au prompt « description ». */
export function donneesDescription(keys, numero) {
  const { data } = loadContentieux(keys)
  const canon = numeroCanonique(keys, numero)
  const e = (data.enquetes || []).find((x) => String(x.numero).trim() === String(canon).trim())
  if (!e) throw new Error(`Dossier ${numero} introuvable`)

  const out = [
    '',
    '───── DOSSIER ─────',
    `Numéro : ${e.numero}`,
    e.dateDebut ? `Début : ${e.dateDebut}` : null,
    e.directeurEnquete ? `Directeur d'enquête : ${e.directeurEnquete}` : null,
    (e.services || []).length ? `Services : ${(e.services || []).join(', ')}` : null,
    `NATINF enregistrés : ${(e.infractionNatinfCodes || []).join(', ') || '(aucun)'}`,
    `Mis en cause ENREGISTRÉS : ${(e.misEnCause || []).map((m) => `${m.nom}${m.role ? ` (${m.role})` : ''}${m.statut ? ` [${m.statut}]` : ''}`).join(' ; ') || '(aucun)'}`,
    '',
    '───── DESCRIPTION ACTUELLE ─────',
    String(e.description || '').trim() ? String(e.description).slice(0, DESCRIPTION_MAX) : '(vide — à rédiger entièrement)',
  ]

  // Ce qui est NOUVEAU depuis la dernière actualisation (★) : le run s'y
  // attarde, le reste est déjà intégré à la description — pas de travail refait.
  const hist = e.descriptionHistory || []
  const derniere = hist.length ? Date.parse(hist[hist.length - 1].date) : NaN
  const estNeuf = (ts) => Number.isFinite(derniere) && Number.isFinite(ts) && ts > derniere
  if (Number.isFinite(derniere)) {
    out.push('', `Dernière actualisation : ${new Date(derniere).toISOString().slice(0, 10)} — les éléments marqués ★ sont arrivés depuis : concentre l'analyse sur eux, l'acquis est dans la description actuelle et la mémoire du dossier.`)
  }

  const memoire = readDossierMemory(keys, e.numero)
  out.push('', '───── MÉMOIRE DU DOSSIER (acquis des analyses précédentes) ─────', memoire.trim() || '(vide)')

  // CR : TOUS, du plus ancien au plus récent. Les récents en entier ; si le
  // budget déborde, les anciens sont rognés (jamais omis).
  const crs = [...(e.comptesRendus || [])].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
  const textes = crs.map((c) => stripHtml(c.description))
  let total = textes.reduce((s, t) => s + t.length, 0)
  for (let i = 0; i < textes.length && total > CR_BUDGET; i++) {
    if (textes[i].length > CR_ANCIEN_MAX) {
      total -= textes[i].length - CR_ANCIEN_MAX
      textes[i] = `${textes[i].slice(0, CR_ANCIEN_MAX)} […]`
    }
  }
  out.push('', `───── COMPTES RENDUS (${crs.length}, du plus ancien au plus récent) ─────`)
  if (!crs.length) out.push('(aucun)')
  // id d'un CR = horodatage de sa création (Date.now côté app)
  crs.forEach((c, i) => out.push(`[${Number(c.id) > 1e12 && estNeuf(Number(c.id)) ? '★ ' : ''}CR ${c.date || '?'}${c.enqueteur ? ` — ${c.enqueteur}` : ''}]`, textes[i] || '(vide)', ''))

  const actes = [
    ...(e.ecoutes || []).map((a) => ({ kind: 'écoute', ...a })),
    ...(e.geolocalisations || []).map((a) => ({ kind: 'géolocalisation', ...a })),
    ...(e.actes || []).map((a) => ({ kind: a.type || 'acte', ...a })),
  ]
  out.push('', `───── ACTES (${actes.length}) ─────`)
  if (!actes.length) out.push('(aucun)')
  for (const a of actes) {
    out.push(`• ${a.kind} — ${a.numero || a.objet || a.cible || ''} — ${a.dateDebut || '?'} → ${a.dateFin || '?'} — ${a.statut || ''}${a.description ? ` — ${String(a.description).slice(0, 200)}` : ''}`)
  }

  // Pièces serveur : le sommaire du registre, pièce par pièce.
  const cov = couverturePieces(keys, e.numero)
  out.push('', `───── PIÈCES VERSÉES SUR LE SERVEUR (${cov.total}) — sommaire du registre ─────`)
  if (!cov.total) out.push('(aucune)')
  let budget = PIECES_BUDGET
  let omises = 0
  for (const f of cov.fichees) {
    const pers = (f.personnes || []).map((p) => `${p.nom}${p.alias ? ` dit ${p.alias}` : ''}${p.role ? ` [${p.role}]` : ''}`).join(' ; ')
    const ent = f.entites ? Object.entries(f.entites).filter(([, v]) => v?.length).map(([k, v]) => `${k}: ${v.slice(0, 6).join(', ')}`).join(' · ') : ''
    const bloc = [
      `${estNeuf(Date.parse(f.verseeLe)) ? '★ ' : ''}■ ${f.chemin}${f.type ? ` — ${f.type}` : ''}${f.datePiece ? ` — ${f.datePiece}` : ''}${f.copieDe ? ` (copie de ${f.copieDe})` : ''}`,
      f.resume ? `  ${f.resume}` : null,
      pers ? `  Personnes : ${pers}` : null,
      ent ? `  Entités : ${ent}` : null,
    ].filter(Boolean).join('\n')
    if (bloc.length > budget) { omises++; continue }
    budget -= bloc.length
    out.push(bloc)
  }
  if (omises) out.push(`(${omises} fiche(s) non jointe(s) faute de place — registre_lire numero:"${e.numero}" pour les consulter)`)
  if (cov.sansFiche.length) {
    out.push('', `Pièces SANS fiche encore (${cov.sansFiche.length}) — lire_document si l'une semble déterminante :`)
    for (const rel of cov.sansFiche.slice(0, 80)) out.push(`  - ${rel}`)
    if (cov.sansFiche.length > 80) out.push(`  … et ${cov.sansFiche.length - 80} autre(s)`)
  }

  // Les mis en cause AILLEURS : autres dossiers où le même nom figure.
  const noms = (e.misEnCause || []).map((m) => m.nom).filter(Boolean)
  if (noms.length) {
    let rec = []
    try { rec = recoupementMecs(keys, noms).recoupements || [] } catch { rec = [] }
    const ailleurs = rec
      .map((r) => ({ ...r, ou: (r.ou || []).filter((n) => String(n) !== String(e.numero)) }))
      .filter((r) => r.ou.length || r.source === 'carto')
    out.push('', '───── MIS EN CAUSE CONNUS AILLEURS ─────')
    if (!ailleurs.length) out.push('(aucun)')
    for (const r of ailleurs) out.push(`• ${r.nom} — ${r.ou.length ? `aussi dans : ${r.ou.join(' ; ')}` : 'présent sur la carte (ex nihilo)'}`)

    // Liens de renseignement DÉJÀ tracés sur la carte : ne pas les reproposer.
    const ids = new Map(noms.map((n) => [mecCanonId(n), n]))
    let liens = []
    try { liens = listerLiens(keys).liens || [] } catch { liens = [] }
    const touches = liens.filter((l) => ids.has(l.source) || ids.has(l.target))
    out.push('', '───── LIENS DÉJÀ TRACÉS SUR LA CARTE (ne pas reproposer) ─────')
    if (!touches.length) out.push('(aucun)')
    for (const l of touches) out.push(`• ${ids.get(l.source) || l.source} ↔ ${ids.get(l.target) || l.target}${l.label ? ` — ${l.label}` : ''}`)
  }

  // Entités (téléphones, plaques, IBAN, adresses, personnes) partagées avec
  // d'AUTRES dossiers — matière des liens matériels inter-dossiers.
  let rr = []
  try { rr = recouperRegistres(keys, { numero: e.numero }).recoupements || [] } catch { rr = [] }
  out.push('', '───── ENTITÉS PARTAGÉES AVEC D\'AUTRES DOSSIERS (registre, à vérifier) ─────')
  if (!rr.length) out.push('(aucune)')
  for (const r of rr.slice(0, RECOUPEMENTS_MAX)) {
    out.push(`• ${r.entite} — ${r.dossiers.map((d) => `${d.dossier} (${d.pieces.slice(0, 2).join(', ')}${d.pieces.length > 2 ? '…' : ''})`).join(' | ')}`)
  }
  if (rr.length > RECOUPEMENTS_MAX) out.push(`(${rr.length - RECOUPEMENTS_MAX} autre(s) — registre_recouper numero:"${e.numero}")`)

  return out.filter((l) => l !== null)
}

// ── Avancement : pourcentage et temps restant estimés ────────────────────
// Le run est opaque (un modèle qui lit puis écrit) : on estime sa durée
// d'après la MATIÈRE jointe, et chaque run observé recale l'estimation
// (ratio réel / estimé, moyenne glissante) — le « X min restantes » devient
// juste au fil des actualisations.

const MS_INGESTION = 10_000
const MS_LOT_FICHES = 45_000
let ratioObserve = 1

/** Durée estimée de la rédaction pour une matière de `chars` caractères. */
export function estimerRedactionMs(chars) {
  const brut = 60_000 + (Math.max(0, Number(chars) || 0) / 1000) * 1_200
  return Math.round(Math.min(8 * 60_000, Math.max(60_000, brut * ratioObserve)))
}

/** Recalage après un run : `reelMs` observé pour une estimation `estimeMs`. */
export function observerRedaction(reelMs, estimeMs) {
  if (!(reelMs > 0) || !(estimeMs > 0)) return
  const r = Math.min(3, Math.max(0.3, (reelMs / estimeMs) * ratioObserve))
  ratioObserve = ratioObserve * 0.6 + r * 0.4
}

/** Estimation initiale : ingestion + lots de fiches à faire + rédaction. */
export function estimerTotalMs({ lotsFiches = 0, chars = 0 } = {}) {
  return MS_INGESTION + lotsFiches * MS_LOT_FICHES + estimerRedactionMs(chars)
}

/**
 * Ce que voit le navigateur : phase, pourcentage (plafonné à 97 % tant que le
 * run n'a pas rendu la main) et temps restant estimé.
 */
export function avancement(etat, now = Date.now()) {
  if (!etat) return null
  const ecoule = Math.max(0, now - etat.debut)
  const total = Math.max(1, etat.finEstimeeAt - etat.debut)
  const fini = Boolean(etat.fini)
  return {
    numero: etat.numero,
    phase: etat.phase,
    detail: etat.detail || '',
    etapes: etat.etapes || [],
    debut: new Date(etat.debut).toISOString(),
    ecouleMs: ecoule,
    pourcent: fini ? 100 : Math.min(97, Math.round((ecoule / total) * 100)),
    restantMs: fini ? 0 : Math.max(0, etat.finEstimeeAt - now),
    fini,
    ...(etat.resultat ? { resultat: etat.resultat } : {}),
  }
}
