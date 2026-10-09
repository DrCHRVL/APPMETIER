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
import { readRegistre } from './registre.mjs'

const CR_BUDGET = 80_000
const CR_ANCIEN_MAX = 1_500
const PIECES_BUDGET = 90_000
const DESCRIPTION_MAX = 8_000

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
    if (r?.fiche) fichees.push({ chemin: String(m.rel), ...r.fiche, entites: r.entites })
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
  crs.forEach((c, i) => out.push(`[CR ${c.date || '?'}${c.enqueteur ? ` — ${c.enqueteur}` : ''}]`, textes[i] || '(vide)', ''))

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
      `■ ${f.chemin}${f.type ? ` — ${f.type}` : ''}${f.datePiece ? ` — ${f.datePiece}` : ''}${f.copieDe ? ` (copie de ${f.copieDe})` : ''}`,
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
  return out.filter((l) => l !== null)
}
