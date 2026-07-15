/**
 * SIRAL — Attaché de justice · dossiers d'INSTRUCTION (module instruction).
 *
 * Le module instruction vit dans des coffres PRIVÉS par utilisateur
 * (`instructions-<user>`, clé globale — la même que remet l'administrateur).
 * L'attaché y lit les dossiers du cabinet : saisine, mis en examen (avec
 * détention provisoire et DML), débats JLD, opérations, événements — le
 * contexte indispensable au traitement d'une DML ou à la préparation d'un
 * débat. LECTURE SEULE : le module instruction n'est jamais modifié par
 * l'attaché (ses productions passent par « Actes rédigés »).
 */
import fs from 'node:fs'
import path from 'node:path'
import { attacheTj, tjDataDir, readVault, listDocsMeta, docServerKey } from './store.mjs'
import { decryptJson } from './crypto.mjs'

function stripHtml(s) {
  return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function fdate(s) {
  if (!s) return '?'
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('fr-FR') : String(s).slice(0, 10)
}

/** Tous les coffres `instructions-<user>` du TJ confié. */
function listInstructionVaultNames() {
  const dir = tjDataDir(attacheTj(), 'vaults')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('instructions-') && f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
}

/** Dossiers de tous les cabinets lisibles, avec leur propriétaire. */
function loadAllDossiers(keys) {
  const out = []
  for (const name of listInstructionVaultNames()) {
    const env = readVault(attacheTj(), name)
    if (!env) continue
    let payload
    try { payload = decryptJson(keys.global, env) } catch { continue }
    const proprietaire = name.slice('instructions-'.length)
    for (const d of payload?.dossiers || []) out.push({ ...d, _proprietaire: proprietaire })
  }
  return out
}

function matchNumero(d, numero) {
  const w = String(numero).trim().replace(/\s+/g, '')
  const eq = (v) => v && String(v).trim().replace(/\s+/g, '') === w
  return eq(d.numeroInstruction) || eq(d.numeroParquet)
}

function detentionResume(mex) {
  const m = mex.mesureSurete
  if (!m || m.type === 'libre') return 'libre'
  if (m.type === 'cj') return `contrôle judiciaire depuis ${fdate(m.depuis)}`
  if (m.type === 'arse') return `ARSE depuis ${fdate(m.depuis)}`
  if (m.type === 'detenu') {
    const periodes = m.periodes || []
    const last = periodes[periodes.length - 1]
    return `DÉTENU depuis ${fdate(m.depuis)}${last ? ` — période en cours jusqu'au ${fdate(last.dateFin)}` : ''}${periodes.length > 1 ? ` (${periodes.length - 1} prolongation(s))` : ''}`
  }
  return m.type
}

/**
 * Liste compacte des dossiers d'instruction : identifiants, cabinet, MEX
 * (détenus comptés), DML en attente et prochains débats JLD — ce qu'il faut
 * pour s'orienter et anticiper les échéances.
 */
export function listInstructionDossiers(keys) {
  const today = new Date().toISOString().slice(0, 10)
  return loadAllDossiers(keys).map((d) => {
    const mex = d.misEnExamen || []
    const detenus = mex.filter((m) => m.mesureSurete?.type === 'detenu')
    const dmlEnAttente = mex.flatMap((m) => (m.dmls || [])
      .filter((x) => x.statut === 'en_attente')
      .map((x) => ({ mex: m.nom, depot: x.dateDepot, echeance: x.dateEcheance })))
    const debatsAVenir = (d.debatsJLD || [])
      .filter((j) => String(j.date).slice(0, 10) >= today)
      .map((j) => ({ date: j.date, type: j.type, requisitionsRedigees: j.requisitionsRedigees === true }))
    return {
      numeroInstruction: d.numeroInstruction,
      numeroParquet: d.numeroParquet,
      magistratInstructeur: d.magistratInstructeur,
      contentieux: d.contentieuxId,
      proprietaire: d._proprietaire,
      ouvert: fdate(d.dateOuverture || d.dateRI),
      mex: mex.length,
      detenus: detenus.length,
      dmlEnAttente,
      debatsAVenir,
      etatReglement: d.etatReglement,
    }
  })
}

/** Le numéro correspond-il à un dossier du module instruction ? */
export function instructionExiste(keys, numero) {
  return loadAllDossiers(keys).some((x) => matchNumero(x, numero))
}

/**
 * Inventaire compact des dossiers d'instruction pour l'analyse transversale
 * de la cartographie : numéro, mis en examen (noms) et nombre de pièces
 * versées — même forme que les enquêtes dans cartoCorpus.
 */
export function instructionCorpus(keys) {
  return loadAllDossiers(keys).map((d) => {
    const numero = d.numeroInstruction || d.numeroParquet
    const metas = numero ? listDocsMeta(attacheTj(), docServerKey(numero)).filter((m) => !String(m.rel).startsWith('MD/')) : []
    return {
      numero, kind: 'instruction', statut: 'instruction',
      objet: stripHtml(d.description || '').slice(0, 200),
      misEnCause: (d.misEnExamen || []).map((m) => m.nom).filter(Boolean),
      nbDocuments: metas.length,
    }
  }).filter((d) => d.numero)
}

/** Dossier d'instruction complet, en markdown compact. */
export function instructionDossierMarkdown(keys, numero) {
  const d = loadAllDossiers(keys).find((x) => matchNumero(x, numero))
  if (!d) return null
  const parts = []
  parts.push(`# Dossier d'instruction ${d.numeroInstruction || ''}${d.numeroParquet ? ` (parquet ${d.numeroParquet})` : ''}`)
  parts.push(`Juge : ${d.magistratInstructeur || '?'} · ouvert le ${fdate(d.dateOuverture)} · RI du ${fdate(d.dateRI)}${d.serviceEnqueteur ? ` · service : ${d.serviceEnqueteur}` : ''}`)
  if (d.enquetePreliminaireNumero) parts.push(`Enquête préliminaire d'origine : ${d.enquetePreliminaireNumero} (lisible avec lire_dossier)`)

  if (d.saisine?.length) {
    parts.push('\n## Saisine (in rem)')
    for (const s of d.saisine) parts.push(`- ${s.qualification}${s.natinfCode ? ` (NATINF ${s.natinfCode})` : ''}`)
  }
  if (d.description) parts.push('\n## Narratif\n' + stripHtml(d.description).slice(0, 8000))

  const mex = d.misEnExamen || []
  if (mex.length) {
    parts.push('\n## Mis en examen')
    for (const m of mex) {
      parts.push(`\n### ${m.nom}${m.dateNaissance ? ` (né(e) ${fdate(m.dateNaissance)})` : ''} — mis en examen le ${fdate(m.dateMiseEnExamen)}`)
      parts.push(`Mesure de sûreté : ${detentionResume(m)}`)
      if (m.mesureSurete?.type === 'detenu' && m.mesureSurete.periodes?.length) {
        parts.push('Périodes de détention provisoire :')
        for (const p of m.mesureSurete.periodes) parts.push(`- ${fdate(p.dateDebut)} → ${fdate(p.dateFin)} (${p.dureeMois} mois)`)
      }
      if (m.infractions?.length) parts.push('Chefs : ' + m.infractions.map((i) => i.qualification).join(' ; '))
      if (m.dmls?.length) {
        parts.push('DML :')
        for (const x of m.dmls) parts.push(`- déposée le ${fdate(x.dateDepot)}, échéance ${fdate(x.dateEcheance)} — ${x.statut}${x.dateRequisitions ? ` (réquisitions du ${fdate(x.dateRequisitions)})` : ''}${x.notes ? ` · ${stripHtml(x.notes).slice(0, 200)}` : ''}`)
      }
      if (m.elementsCharge) parts.push('Éléments à charge : ' + stripHtml(m.elementsCharge).slice(0, 2000))
      if (m.notes) parts.push('Notes : ' + stripHtml(m.notes).slice(0, 1000))
    }
  }

  if (d.debatsJLD?.length) {
    parts.push('\n## Débats JLD')
    for (const j of [...d.debatsJLD].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      const qui = j.misEnExamenId ? mex.find((m) => m.id === j.misEnExamenId)?.nom : null
      parts.push(`- ${fdate(j.date)} — ${j.type}${qui ? ` (${qui})` : ''}${j.requisitionsRedigees ? ' · réquisitions rédigées' : ' · réquisitions À RÉDIGER'}${j.decision ? ` · décision : ${stripHtml(String(j.decision)).slice(0, 120)}` : ''}`)
    }
  }

  if (d.ops?.length) {
    parts.push('\n## Opérations')
    for (const o of d.ops) parts.push(`- ${fdate(o.date)} — ${stripHtml(o.description || '').slice(0, 200)}${o.service ? ` (${o.service})` : ''}${o.requisitionsRedigees ? ' · réquisitions rédigées' : ''}`)
  }

  if (d.evenements?.length) {
    parts.push('\n## Chronologie (événements)')
    for (const e of [...d.evenements].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      const qui = e.misEnExamenId ? mex.find((m) => m.id === e.misEnExamenId)?.nom : null
      parts.push(`- ${fdate(e.date)} — [${e.type}] ${e.titre || ''}${qui ? ` (${qui})` : ''}${e.description ? ` · ${stripHtml(e.description).slice(0, 300)}` : ''}`)
    }
  }

  if (d.notesActesJI) parts.push('\n## Actes à faire / à demander à la JI\n' + stripHtml(d.notesActesJI).slice(0, 4000))

  const numeroDocs = d.numeroInstruction || d.numeroParquet
  const metas = listDocsMeta(attacheTj(), docServerKey(numeroDocs))
  const nbDossierComplet = metas.filter((m) => m.rel.startsWith('Dossier/')).length
  const nbDml = metas.filter((m) => m.rel.startsWith('DML/')).length
  parts.push('')
  if (nbDossierComplet) {
    parts.push(`DOSSIER COMPLET VERSÉ : ${nbDossierComplet} pièce(s) en texte, organisées en pochettes — dossier_arborescence(« ${numeroDocs} ») pour la table des matières, puis lire_document. C'est la matière première de toute synthèse, DML ou réquisitoire.`)
  }
  parts.push(`(${nbDml || 'Aucune'} réponse(s) DML archivée(s) : lister_dml avec le numéro « ${numeroDocs} » — puis lire_document sur la plus récente.)`)
  return parts.join('\n').slice(0, 200_000)
}
