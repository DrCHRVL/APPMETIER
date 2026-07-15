/**
 * SIRAL — Attaché de justice · skills du magistrat (comme Claude web).
 *
 * Une skill = une méthode réutilisable : un nom, une description (c'est elle
 * qui dit QUAND l'utiliser) et un contenu markdown (le COMMENT, détaillé).
 * Le magistrat les gère depuis Paramètres → Attaché IA — il peut y coller
 * telles quelles ses skills Claude web. L'attaché voit la liste
 * (nom + description) dans son prompt système et charge le contenu à la
 * demande (outil skill_lire) quand la tâche correspond — même mécanique de
 * divulgation progressive que Claude web.
 *
 * Différence avec les trames : une trame est un plan-type de document
 * (relue avant une rédaction du même type) ; une skill est une méthode
 * générale, candidate sur n'importe quelle tâche.
 *
 * Stockage : un fichier-enveloppe par skill (clé globale), versionné à
 * chaque réécriture — le miroir exact des trames. Le navigateur admin lit
 * et écrit les mêmes enveloppes (crypto identique des deux côtés).
 */
import fs from 'node:fs'
import path from 'node:path'
import { attacheDir, readJson, writeCollectionEnvelopeRaw, deleteCollectionEnvelopeRaw } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'

// Même règle que components/admin (skillSlug) : les deux côtés écrivent le
// même nom de fichier pour le même nom de skill.
export function safeSkillName(nom) {
  const s = String(nom).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  if (!s) throw new Error('Nom de skill invalide')
  return s
}

export async function saveSkill(keys, { nom, description, contenu }) {
  const name = safeSkillName(nom)
  if (!String(contenu || '').trim()) throw new Error('Contenu de skill vide')
  const record = {
    nom: name,
    description: String(description || '').slice(0, 300),
    contenu: String(contenu).slice(0, 200_000),
    updatedAt: new Date().toISOString(),
  }
  // même verrou + même archivage .versions que les dépôts relayés du navigateur
  await writeCollectionEnvelopeRaw('skills', name, encryptJson(keys.global, record, { savedAt: record.updatedAt }))
  return { nom: name }
}

export function listSkills(keys) {
  const dir = attacheDir('skills')
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    const env = readJson(path.join(dir, f), null)
    if (!env) continue
    try {
      const s = decryptJson(keys.global, env)
      out.push({ nom: s.nom, description: s.description, updatedAt: s.updatedAt, taille: (s.contenu || '').length })
    } catch {}
  }
  return out.sort((a, b) => a.nom.localeCompare(b.nom))
}

export function readSkill(keys, nom) {
  const p = attacheDir('skills', safeSkillName(nom) + '.json')
  const env = readJson(p, null)
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

/** Suppression réversible d'une skill (dernière version archivée côté serveur). */
export async function deleteSkill(nom) {
  return deleteCollectionEnvelopeRaw('skills', safeSkillName(nom))
}

/** Bloc « skills disponibles » du prompt système — vide s'il n'y en a aucune. */
export function skillsPromptSection(keys) {
  const skills = listSkills(keys)
  if (!skills.length) return ''
  return [
    '',
    'SKILLS DU MAGISTRAT (ses méthodes enregistrées — Paramètres → Attaché IA, comme les skills Claude web) :',
    ...skills.map((s) => `- ${s.nom}${s.description ? ` : ${s.description}` : ''}`),
    'Dès qu\'une demande correspond à une skill, commence par la charger (skill_lire) et suis-la fidèlement.',
    'TU GÈRES CES SKILLS À SA DEMANDE — c\'est TOI qui rédiges, pas seulement lui qui dicte :',
    '- « crée une skill qui fait X / pour Y » → rédige toi-même la méthode complète (markdown structuré, étapes claires) + une description qui dit QUAND l\'appliquer, puis skill_enregistrer. Récapitule-lui ce que contient la skill créée.',
    '- « modifie la skill Z comme ça / ajoute ceci / retire cela » → skill_lire pour la lire, applique le changement demandé au contenu (ou à la description), puis skill_enregistrer avec le MÊME nom (versionné : rien n\'est perdu). Confirme la modification.',
    '- « supprime la skill Z » → skill_supprimer (réversible : dernière version archivée).',
    'Quand il te dicte/colle une méthode durable (« enregistre cette skill », « à partir de maintenant, procède ainsi pour… »), range-la telle quelle avec skill_enregistrer.',
    'Dans tous les cas la description est CRUCIALE : c\'est elle qui déclenche la skill plus tard — soigne-la.',
  ].join('\n')
}
