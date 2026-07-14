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
import { attacheDir, ensureDir, atomicWrite, readJson } from './store.mjs'
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
  const dir = attacheDir('skills')
  ensureDir(dir)
  const p = path.join(dir, name + '.json')
  if (fs.existsSync(p)) {
    const vdir = path.join(dir, '.versions', name)
    ensureDir(vdir)
    fs.copyFileSync(p, path.join(vdir, new Date().toISOString().replace(/:/g, '_') + '.json'))
  }
  atomicWrite(p, JSON.stringify(encryptJson(keys.global, record, { savedAt: record.updatedAt })))
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

/** Bloc « skills disponibles » du prompt système — vide s'il n'y en a aucune. */
export function skillsPromptSection(keys) {
  const skills = listSkills(keys)
  if (!skills.length) return ''
  return [
    '',
    'SKILLS DU MAGISTRAT (ses méthodes enregistrées — Paramètres → Attaché IA, comme les skills Claude web) :',
    ...skills.map((s) => `- ${s.nom}${s.description ? ` : ${s.description}` : ''}`),
    'Dès qu\'une demande correspond à une skill, commence par la charger (skill_lire) et suis-la fidèlement.',
    'Quand le magistrat te dicte une méthode durable (« enregistre cette skill », « à partir de maintenant, procède ainsi pour… »), range-la avec skill_enregistrer.',
  ].join('\n')
}
