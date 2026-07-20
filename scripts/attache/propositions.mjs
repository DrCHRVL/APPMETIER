/**
 * SIRAL — Attaché de justice · propositions à valider (✓/✗).
 *
 * Quand l'attaché DÉTECTE quelque chose en lisant (document, PV, mail) —
 * un nom nouveau, une demande d'acte, des éléments pour un CR — il ne
 * l'écrit pas directement au dossier : il dépose une PROPOSITION, déjà
 * entièrement construite. Elle apparaît dans le détail du dossier, pour le
 * seul administrateur, avec un ✓ (appliquer) et un ✗ (refuser) discrets.
 *
 * À la validation, l'écriture est signée DU NOM DE L'ADMINISTRATEUR —
 * l'assistant ne laisse aucune trace dans les données partagées. Le
 * dédoublonnage MEC est vérifié deux fois : au dépôt ET à l'application.
 */
import crypto from 'node:crypto'
import { attacheDir, ensureDir, atomicWrite, readJson, withFileLock } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { ajouterMec, enregistrerActe, classerNote, getMecNoms, normalizeNom, creerDossier, dossierExiste } from './dossier.mjs'
import { appendLien, appendDossierExNihilo, dossierExNihiloExiste, appendMecExNihilo, mecExNihiloExiste } from './carto.mjs'
import { saveTrame, readTrame, safeTrameName, MODELE_PREFIX } from './trames.mjs'
import { saveSkill, readSkill, safeSkillName, AUTO_SKILL_PREFIX } from './skills.mjs'
import { audit } from './journal.mjs'
import { recordLearningSignal } from './apprentissage.mjs'

const FILE = () => attacheDir('propositions.json')
const TYPES = ['mec', 'acte', 'cr', 'lien', 'dossier', 'dossier_carto', 'mec_carto', 'trame', 'skill']
// Types rattachés à un dossier EXISTANT (numéro requis). « dossier » porte le
// numéro du dossier à créer ; « dossier_carto », « mec_carto » et « lien »
// sont globaux (carte — numéro facultatif pour un lien : simple contexte
// d'affichage quand il est détecté dans un dossier précis). « trame » et
// « skill » sont globaux : amélioration d'une méthode du magistrat, appliquée
// d'un ✓ (écriture versionnée) depuis Paramètres → Attaché IA.
const TYPES_DOSSIER = ['mec', 'acte', 'cr']

function load(keys) {
  const env = readJson(FILE(), null)
  if (!env) return []
  try {
    const { propositions } = decryptJson(keys.global, env)
    return Array.isArray(propositions) ? propositions : []
  } catch {
    return []
  }
}

async function save(keys, propositions) {
  await withFileLock('attache-propositions', async () => {
    ensureDir(attacheDir())
    // purge douce : on garde 400 entrées max (les traitées les plus anciennes partent)
    let list = propositions
    if (list.length > 400) {
      const pending = list.filter((p) => p.statut === 'en_attente')
      const done = list.filter((p) => p.statut !== 'en_attente').slice(-(400 - pending.length))
      list = [...done, ...pending]
    }
    atomicWrite(FILE(), JSON.stringify(encryptJson(keys.global, { propositions: list }, { savedAt: new Date().toISOString() })))
  })
}

/**
 * Dépose une proposition. type: mec | acte | cr.
 *  - mec  : payload { nom, role?, statut? }
 *  - acte : payload = arguments d'enregistrer_acte (kind, duree, cible, objet, type, description, statut…)
 *  - cr   : payload { titre?, contenu, date? } — contenu en prise de notes
 * `source` : d'où vient la détection (document, mail, CR…) — toujours citer.
 */
export async function addProposition(keys, { numero, type, payload, source, titre }) {
  if (!TYPES.includes(type)) throw new Error(`Type inconnu : ${type}`)
  if (!payload || typeof payload !== 'object') throw new Error('Payload requis')
  // normalisé une fois : jamais de « undefined » littéral stocké (un lien
  // transversal arrive sans numéro).
  numero = String(numero || '').trim()
  if (TYPES_DOSSIER.includes(type) && !numero) throw new Error('Numéro de dossier requis')
  const propositions = load(keys)

  // Création d'un NOUVEAU dossier réel : le numéro EST celui à créer.
  if (type === 'dossier') {
    const num = String(payload.numero || numero || '').trim()
    if (!num) throw new Error('Numéro (nom) du dossier requis')
    if (dossierExiste(keys, num)) return { doublon: true, message: `Un dossier « ${num} » existe déjà — création NON déposée` }
    const pendante = propositions.find((p) => p.statut === 'en_attente' && p.type === 'dossier'
      && String(p.payload?.numero || p.numero).trim() === num)
    if (pendante) return { doublon: true, message: 'Une création de ce dossier est déjà en attente' }
    payload.numero = num
    numero = num
  }

  // Création d'un dossier EX NIHILO sur la carte : global (pas de numéro).
  if (type === 'dossier_carto') {
    const lbl = String(payload.label || '').trim()
    if (!lbl) throw new Error('Libellé du dossier requis')
    if (dossierExNihiloExiste(keys, lbl)) return { doublon: true, message: `Un dossier ex nihilo « ${lbl} » existe déjà — création NON déposée` }
    const pendante = propositions.find((p) => p.statut === 'en_attente' && p.type === 'dossier_carto'
      && String(p.payload?.label || '').trim().toLowerCase() === lbl.toLowerCase())
    if (pendante) return { doublon: true, message: 'Une création de ce dossier ex nihilo est déjà en attente' }
    numero = ''
  }

  // Création d'un MEC ex nihilo autonome sur la carte : global (pas de numéro).
  if (type === 'mec_carto') {
    const nom = String(payload.nom || '').trim()
    if (!nom) throw new Error('Nom de la personne requis')
    if (mecExNihiloExiste(keys, nom)) return { doublon: true, message: `« ${nom} » figure déjà (dossier réel ou carte) — proposition NON déposée` }
    const norm = normalizeNom(nom)
    const pendante = propositions.find((p) => p.statut === 'en_attente' && p.type === 'mec_carto'
      && normalizeNom(p.payload?.nom || '') === norm)
    if (pendante) return { doublon: true, message: 'Une création de cette personne est déjà en attente' }
    numero = ''
  }

  // Amélioration d'une trame ou d'une skill du MAGISTRAT : le contenu complet
  // révisé attend son ✓ — jamais d'écriture directe sur ses méthodes.
  if (type === 'trame' || type === 'skill') {
    const propre = type === 'trame' ? safeTrameName(String(payload.nom || '')) : safeSkillName(String(payload.nom || ''))
    const prefixe = type === 'trame' ? MODELE_PREFIX : AUTO_SKILL_PREFIX
    if (propre.startsWith(prefixe)) {
      throw new Error(`« ${propre} » t'appartient (préfixe ${prefixe}) : écris-la directement (${type === 'trame' ? 'trame_enregistrer' : 'skill_enregistrer'}), pas de proposition`)
    }
    if (!String(payload.contenu || '').trim() || String(payload.contenu).trim().length < 200) {
      throw new Error('Contenu complet requis (≥ 200 caractères) : la proposition porte le texte INTÉGRAL révisé, pas un extrait')
    }
    if (!String(payload.motif || '').trim()) {
      throw new Error('Motif requis : dis en une phrase POURQUOI (signaux, écart au corpus, fragilité de légalité) — le magistrat décide sur cette base')
    }
    const existante = type === 'trame' ? readTrame(keys, propre) : readSkill(keys, propre)
    if (existante && String(existante.contenu || '').trim() === String(payload.contenu).trim()) {
      return { doublon: true, message: `Le contenu proposé est identique à la ${type} actuelle — proposition NON déposée` }
    }
    const pendante = propositions.find((p) => p.statut === 'en_attente' && p.type === type
      && String(p.payload?.nom || '') === propre)
    if (pendante) return { doublon: true, message: `Une proposition sur cette ${type} est déjà en attente — le magistrat n'a pas encore tranché` }
    payload.nom = propre
    payload.existante = Boolean(existante)
    numero = ''
  }

  if (type === 'mec') {
    const nom = String(payload.nom || '').trim()
    if (!nom) throw new Error('Nom du mis en cause requis')
    const norm = normalizeNom(nom)
    // doublon contre l'existant du dossier…
    const existants = getMecNoms(keys, numero)
    const deja = existants.find((n) => normalizeNom(n) === norm)
    if (deja) return { doublon: true, existant: deja, message: `« ${deja} » figure déjà aux mis en cause — proposition NON déposée` }
    // …et contre les propositions en attente
    const pendante = propositions.find((p) => p.statut === 'en_attente' && p.type === 'mec'
      && String(p.numero).trim() === String(numero).trim() && normalizeNom(p.payload.nom) === norm)
    if (pendante) return { doublon: true, existant: pendante.payload.nom, message: 'Proposition identique déjà en attente' }
  }

  const prop = {
    id: crypto.randomBytes(5).toString('hex'),
    numero: String(numero).trim(),
    type,
    titre: String(titre || defaultTitre(type, payload)).slice(0, 200),
    payload,
    source: String(source || '').slice(0, 300),
    statut: 'en_attente',
    creeLe: new Date().toISOString(),
  }
  propositions.push(prop)
  await save(keys, propositions)
  await audit(keys, 'proposition_deposee', { id: prop.id, numero: prop.numero, type, titre: prop.titre, source: prop.source })
  return { id: prop.id }
}

function defaultTitre(type, payload) {
  if (type === 'dossier') {
    const n = (Array.isArray(payload.misEnCause) ? payload.misEnCause.length : 0)
    return `Nouveau dossier : ${payload.numero || '?'}${n ? ` — ${n} mis en cause` : ''}`
  }
  if (type === 'dossier_carto') {
    const n = (Array.isArray(payload.misEnCause) ? payload.misEnCause.length : 0)
    return `Dossier ex nihilo (carte) : ${payload.label || '?'}${n ? ` — ${n} personne(s)` : ''}`
  }
  if (type === 'mec_carto') return `Personne ex nihilo (carte) : ${payload.nom || '?'}${Array.isArray(payload.alias) && payload.alias.length ? ` (alias ${payload.alias.slice(0, 3).join(', ')})` : ''}`
  if (type === 'trame') return payload.existante ? `Trame « ${payload.nom} » — amélioration proposée` : `Nouvelle trame proposée : ${payload.nom}`
  if (type === 'skill') return payload.existante ? `Skill « ${payload.nom} » — amélioration proposée` : `Nouvelle skill proposée : ${payload.nom}`
  if (type === 'lien') return `Lien de renseignement : ${payload.sourceNom} ↔ ${payload.targetNom}${payload.label ? ` (${payload.label})` : ''}`
  if (type === 'mec') return `Nouveau mis en cause : ${payload.nom}${payload.role ? ` (${payload.role})` : ''}`
  if (type === 'acte') {
    const quoi = payload.kind === 'ecoute' ? `interception ${payload.cible || payload.objet || ''}`
      : payload.kind === 'geolocalisation' ? `géolocalisation ${payload.objet || ''}`
      : `${payload.type || 'acte'}`
    return `Nouvel acte : ${quoi}`.trim()
  }
  return `CR : ${String(payload.titre || payload.contenu || '').slice(0, 80)}`
}

export function listPropositions(keys, { numero, enAttente = true } = {}) {
  return load(keys).filter((p) =>
    (!numero || String(p.numero).trim() === String(numero).trim())
    && (!enAttente || p.statut === 'en_attente'))
}

/**
 * Décision de l'administrateur. action: valider | refuser.
 * À la validation, l'écriture réelle est faite ICI, signée de son nom.
 */
export async function decideProposition(keys, { id, action, par }) {
  if (action !== 'valider' && action !== 'refuser') throw new Error('Action attendue : valider | refuser')
  const propositions = load(keys)
  const prop = propositions.find((p) => p.id === id)
  if (!prop) throw new Error('Proposition inconnue')
  if (prop.statut !== 'en_attente') throw new Error('Proposition déjà traitée')
  const auteur = String(par || keys.grantedBy || 'admin')

  let applique = null
  if (action === 'valider') {
    if (prop.type === 'mec') {
      applique = await ajouterMec(keys, { numero: prop.numero, ...prop.payload })
    } else if (prop.type === 'acte') {
      applique = await enregistrerActe(keys, { numero: prop.numero, ...prop.payload })
    } else if (prop.type === 'cr') {
      // Signature du CR résolue par classerNote (config.signatureCR — ex. « AUDRAN C » —
      // sinon le nom de l'administrateur) : on force `enqueteur` à undefined pour que
      // la signature configurée l'emporte. `auteur` reste tracé dans l'audit (decidePar).
      applique = await classerNote(keys, { numero: prop.numero, ...prop.payload, enqueteur: undefined })
    } else if (prop.type === 'lien') {
      applique = await appendLien(keys, prop.payload)
    } else if (prop.type === 'dossier') {
      applique = await creerDossier(keys, prop.payload)
    } else if (prop.type === 'dossier_carto') {
      applique = await appendDossierExNihilo(keys, prop.payload)
    } else if (prop.type === 'mec_carto') {
      applique = await appendMecExNihilo(keys, prop.payload)
    } else if (prop.type === 'trame') {
      // écriture versionnée : l'ancienne version reste récupérable ; la
      // description existante est conservée si la proposition n'en porte pas
      const courante = readTrame(keys, prop.payload.nom)
      applique = await saveTrame(keys, {
        nom: prop.payload.nom,
        contenu: prop.payload.contenu,
        description: prop.payload.description || courante?.description,
      })
    } else if (prop.type === 'skill') {
      const courante = readSkill(keys, prop.payload.nom)
      applique = await saveSkill(keys, {
        nom: prop.payload.nom,
        contenu: prop.payload.contenu,
        description: prop.payload.description || courante?.description,
      })
    }
  }

  prop.statut = action === 'valider' ? 'validee' : 'refusee'
  prop.decideLe = new Date().toISOString()
  prop.decidePar = auteur
  await save(keys, propositions)
  await audit(keys, 'proposition_' + prop.statut, { id, numero: prop.numero, type: prop.type, titre: prop.titre, par: auteur })
  // Signal d'apprentissage (coût zéro) : un ✗ dit à l'attaché que sa détection
  // manquait de pertinence, un ✓ conforte le réflexe — distillés plus tard.
  await recordLearningSignal(keys, {
    type: action === 'valider' ? 'proposition_validee' : 'proposition_refusee',
    dossier: prop.numero || undefined,
    detail: `${prop.type} — ${prop.titre}`,
    source: prop.source || undefined,
  })
  return { ok: true, statut: prop.statut, applique }
}
