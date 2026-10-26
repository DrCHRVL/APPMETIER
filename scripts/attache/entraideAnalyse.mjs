/**
 * SIRAL — Attaché de justice · LECTURE D'UNE PIÈCE du module Entraide.
 *
 * L'administrateur téléverse la demande reçue (DEE, CRI, notification…) :
 * extraction du texte (couche texte, OCR si scan), puis UN tour de modèle,
 * sans outil, qui rend une fiche structurée : synthèse des faits, ce qui est
 * demandé, où (ville, adresse), personnes, autorité requérante, références,
 * mesures du catalogue — de quoi préremplir la fiche.
 *
 * La pièce n'est PAS conservée (octets en mémoire le temps de la lecture).
 * Seule la fiche de lecture est gardée, chiffrée, dans l'espace de l'attaché
 * (`entraide-analyses/<id>.json`) — lisible par les seules routes réservées à
 * l'administrateur, jamais par le registre partagé.
 */
import { extractTextByName } from './depot.mjs'
import { runClaudeJson } from './analyse.mjs'
import { recordUsage } from './usage.mjs'
import { readEnvelopeFile, writeEnvelopeFile } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { MESURES, paysDe } from '../../lib/entraide/referentiels.mjs'

const MODELE = process.env.SIRAL_ATTACHE_ENTRAIDE_MODEL || process.env.SIRAL_ATTACHE_ANALYSE_MODEL || 'sonnet'
const MAX_TEXTE = 60_000
const TYPES = ['dee', 'do', 'cri', 'execution', 'civil']

const SYSTEME = [
  'Tu assistes le service de l’entraide pénale internationale d’un parquet français.',
  'On te donne le texte (parfois océrisé, donc bruité) d’une demande d’entraide reçue ou émise : décision d’enquête européenne (formulaire annexe A, sections A à L), commission rogatoire internationale, dénonciation officielle, demande d’exécution, acte civil à notifier.',
  'Tu rends UNIQUEMENT un objet JSON strict, sans texte autour, au format :',
  '{"synthese": "faits en 3 à 6 phrases sobres : qui, quoi, quand, où, infraction",',
  ' "demande": "ce qui est demandé à la France, en clair, 1 à 3 phrases",',
  ' "mesures": ["identifiants du catalogue fourni, uniquement s’ils correspondent"],',
  ' "mesuresAutres": ["mesure demandée absente du catalogue, en quelques mots"],',
  ' "lieux": [{"ville": "commune française où exécuter", "adresse": "si mentionnée", "role": "domicile de X, siège de la société…"}],',
  ' "personnes": [{"nom": "NOM Prénom", "qualite": "témoin | suspect | victime | condamné | société | autre", "naissance": "date et lieu si mentionnés", "adresse": "si mentionnée"}],',
  ' "autorite": {"nom": "autorité requérante (ou destinataire si la demande est émise par la France)", "ville": "", "pays": "", "reference": "référence de l’autorité étrangère"},',
  ' "pays": "pays de l’autorité étrangère, en français",',
  ' "type": "dee | cri | do | execution | civil",',
  ' "sens": "recue | emise",',
  ' "infractions": "qualification(s) en quelques mots",',
  ' "dateFaits": "date ou période des faits si mentionnée",',
  ' "dateButoir": "AAAA-MM-JJ si une date limite d’exécution ou une urgence datée est indiquée, sinon vide",',
  ' "urgence": "motif d’urgence s’il est indiqué, sinon vide",',
  ' "langue": "langue de la pièce",',
  ' "vigilance": ["points d’attention : mesure nécessitant un juge en France, pièce incomplète ou illisible, adresse hors ressort, délai court…"]}',
  'Règles : n’invente rien ; un champ inconnu reste vide ("" ou []). Recopie les noms et adresses tels qu’écrits. Rédige en français même si la pièce est en langue étrangère.',
].join('\n')

function prompt(texte, nom) {
  const catalogue = MESURES.map((m) => `- ${m.id} : ${m.libelle}`).join('\n')
  return [
    'Catalogue des mesures (identifiants à utiliser dans "mesures") :',
    catalogue,
    '',
    `Pièce : ${nom}`,
    '--- texte ---',
    texte,
    '--- fin du texte ---',
    '',
    'Réponds par le JSON strict décrit dans les consignes.',
  ].join('\n')
}

const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const liste = (v, n = 20) => (Array.isArray(v) ? v.slice(0, n) : [])

/** Ne garde que ce qui respecte le format ; rien d'inventé ne passe le filtre des ids. */
export function nettoyerAnalyse(brut) {
  const a = brut && typeof brut === 'object' ? brut : {}
  const ids = new Set(MESURES.map((m) => m.id))
  const pays = paysDe(str(a.pays, 80)) || paysDe(str(a.autorite?.pays, 80))
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(a.dateButoir, 10)) ? str(a.dateButoir, 10) : ''
  return {
    synthese: str(a.synthese, 1500),
    demande: str(a.demande, 900),
    mesures: Array.from(new Set(liste(a.mesures).filter((x) => ids.has(x)))),
    mesuresAutres: liste(a.mesuresAutres).map((x) => str(x, 200)).filter(Boolean),
    lieux: liste(a.lieux, 10).map((l) => ({ ville: str(l?.ville, 120), adresse: str(l?.adresse, 300), role: str(l?.role, 200) })).filter((l) => l.ville || l.adresse),
    personnes: liste(a.personnes, 20).map((p) => ({ nom: str(p?.nom, 160), qualite: str(p?.qualite, 40), naissance: str(p?.naissance, 160), adresse: str(p?.adresse, 300) })).filter((p) => p.nom),
    autorite: { nom: str(a.autorite?.nom, 240), ville: str(a.autorite?.ville, 120), pays: pays?.nom || str(a.autorite?.pays, 80), reference: str(a.autorite?.reference, 120) },
    pays: pays?.nom || '',
    type: TYPES.includes(a.type) ? a.type : '',
    sens: a.sens === 'emise' ? 'emise' : a.sens === 'recue' ? 'recue' : '',
    infractions: str(a.infractions, 300),
    dateFaits: str(a.dateFaits, 120),
    dateButoir: date,
    urgence: str(a.urgence, 300),
    langue: str(a.langue, 40),
    vigilance: liste(a.vigilance, 10).map((x) => str(x, 300)).filter(Boolean),
  }
}

/** Lit une pièce (octets en clair) et rend sa fiche de lecture. */
export async function lirePieceEntraide({ nom, octets }) {
  const ext = await extractTextByName(octets, nom, { max: MAX_TEXTE * 2 })
  if (!ext.ok) return { ok: false, error: ext.scanned ? 'Pièce scannée illisible (OCR sans résultat)' : (ext.error || 'Texte illisible') }
  let texte = ext.texte
  if (texte.trim().length < 80) return { ok: false, error: 'Trop peu de texte lisible dans la pièce' }
  if (texte.length > MAX_TEXTE) texte = `${texte.slice(0, Math.floor(MAX_TEXTE * 0.7))}\n[…]\n${texte.slice(-Math.floor(MAX_TEXTE * 0.3))}`
  const run = await runClaudeJson(prompt(texte, nom), { system: SYSTEME, model: MODELE, run: 'entraide-analyse', timeoutMs: 4 * 60 * 1000 })
  if (run.usage) await recordUsage({ run: 'entraide-analyse', model: MODELE, usage: run.usage })
  if (!run.ok) return { ok: false, error: run.error }
  return { ok: true, analyse: { ...nettoyerAnalyse(run.data), piece: nom, source: ext.source || 'texte', luLe: new Date().toISOString() } }
}

const chemin = (id) => `entraide-analyses/${String(id).replace(/[^\w-]/g, '_').slice(0, 80)}.json`

export async function sauverLecture(keys, demandeId, analyse) {
  if (!demandeId) throw new Error('demandeId requis')
  const precedentes = lireLectures(keys, demandeId)
  const payload = { demandeId, lectures: [analyse, ...precedentes].slice(0, 10) }
  await writeEnvelopeFile(chemin(demandeId), encryptJson(keys.global, payload, { savedAt: new Date().toISOString(), savedBy: 'attache' }))
  return payload.lectures
}

/** Lectures d'une demande, la plus récente d'abord. */
export function lireLectures(keys, demandeId) {
  const env = readEnvelopeFile(chemin(demandeId))
  if (!env) return []
  try { return decryptJson(keys.global, env)?.lectures || [] } catch { return [] }
}

