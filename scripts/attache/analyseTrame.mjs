/**
 * SIRAL — Attaché de justice · analyste des TRAMES DE FORME.
 *
 * Le magistrat verse dans « Paramètres → Trames de forme » un acte QU'IL A
 * DÉJÀ FAIT. Le navigateur en extrait la charpente — une ligne par paragraphe,
 * tronquée à 160 caractères, avec sa mise en évidence (gras, centré, cadré) —
 * et la soumet ici. Le modèle dit, ligne par ligne, ce qui relève de la
 * PAPETERIE (l'habillage, à garder pour tous les actes à venir) et ce qui
 * relève du CONTENU de cet acte-là (à remplacer par une balise). Il propose
 * aussi un nom et les types d'actes que la trame doit servir.
 *
 * Comme l'analyse des documents : CLI `claude` en mode headless, UN SEUL TOUR,
 * AUCUN outil (ni MCP, ni shell, ni fichiers, ni web) — le modèle lit et
 * répond en JSON strict. Rien n'est écrit : la proposition remonte au
 * navigateur, où le magistrat corrige à la marge avant d'enregistrer.
 *
 * Ce que le service ne reçoit JAMAIS : le fichier lui-même (il ne quitte pas
 * le navigateur), ni le texte intégral des paragraphes — juste de quoi
 * reconnaître un en-tête d'un dispositif.
 *
 * Modèle : SIRAL_ATTACHE_TRAME_MODEL (défaut « sonnet »).
 */
import { runClaudeJson } from './analyse.mjs'
import { attacheContentieux } from './store.mjs'

const TRAME_MODEL = process.env.SIRAL_ATTACHE_TRAME_MODEL || 'sonnet'
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_TRAME_TIMEOUT_MIN || 3) * 60 * 1000

const MAX_LIGNES = 400
const MAX_CHARS_LIGNE = 160
const MAX_TOTAL_CHARS = 60_000

const ROLES = ['papeterie', 'titre', 'destinataire', 'objet', 'date', 'corps', 'signature', 'retirer']
const TYPES = ['courrier', 'requete', 'soit-transmis', 'defaut']

/** Persona : mise en page des actes du parquet, sortie 100 % déterministe. */
function systemPrompt() {
  return [
    `Tu es l'analyste des TRAMES DE FORME d'un magistrat du parquet (contentieux ${attacheContentieux()}). Ta spécialité est la MISE EN PAGE des actes : reconnaître, dans un acte déjà signé, ce qui appartient à la papeterie du parquet et ce qui appartient à ce dossier-là.`,
    '',
    "OBJECTIF — on te donne les lignes d'un acte RÉEL, déjà rédigé et signé. Il faut en faire un MODÈLE VIERGE réutilisable : la papeterie reste, le contenu propre à ce dossier est remplacé par des balises que l'application remplira à chaque nouvel acte.",
    '',
    'RÔLES POSSIBLES pour chaque ligne :',
    "- \"papeterie\" : la ligne se retrouvera TELLE QUELLE dans tous les actes à venir. En-tête de juridiction (cour d'appel, tribunal judiciaire, parquet, section), République française, coordonnées, téléphone, courriel, adresse, mentions de bas de page, labels figés (« Objet : », « Affaire suivie par : »), lignes vides de mise en page, séparateurs.",
    '- "titre" : le titre de l\'acte (REQUÊTE AUX FINS DE…, SOIT-TRANSMIS, ORDONNANCE…). La ligne entière devient {{TITRE}}.',
    "- \"destinataire\" : la ligne d'adresse du destinataire d'un courrier (« Monsieur le Juge des libertés… »). La ligne entière devient {{DESTINATAIRE}}.",
    '- "objet" : la ligne « Objet : … ». Le LABEL est conservé, seule la valeur devient {{OBJET}} (voir `garde`).',
    '- "date" : la ligne qui porte la date de l\'acte (« Fait à Amiens, le 3 mars 2026 », « Amiens, le 3 mars 2026 »). Le début est conservé, la date devient {{DATE}} (voir `garde`).',
    "- \"corps\" : le texte propre à CE dossier — visas, exposé des faits, motivation, dispositif, formule de politesse, tout ce qui changera au prochain acte. La PREMIÈRE ligne du corps devient {{CORPS}}, les suivantes disparaissent : marque donc en \"corps\" TOUTES les lignes du corps, sans en oublier.",
    '- "signature" : le bloc de signature (« P/ Le Procureur de la République », nom du magistrat, qualité). La première ligne devient {{SIGNATURE}}, les suivantes disparaissent.',
    '- "retirer" : la ligne doit purement disparaître du modèle (mention manuscrite, numéro de pièce, annotation propre à cet acte, cachet transcrit).',
    '',
    'RÈGLES DE CLASSEMENT :',
    "- Le doute profite au CONTENU. Une ligne qui cite un nom, un numéro de procédure, une date de faits, une adresse de mis en cause, une ligne téléphonique, un montant : c'est du \"corps\" (ou \"retirer\"), JAMAIS de la papeterie — sinon les détails de ce dossier réapparaîtraient dans tous les actes suivants.",
    "- À l'inverse, ne détruis pas la papeterie : une ligne d'en-tête, une adresse de juridiction, une mention légale imprimée, un intitulé de service restent en \"papeterie\" même si elle est longue.",
    "- Les lignes vides : \"papeterie\" quand elles aèrent l'en-tête ou la signature, \"corps\" quand elles séparent deux paragraphes DU corps.",
    '- Les indications `gras`, `centre`, `droite`, `tableau` sont des indices de mise en page : un titre est souvent centré/gras/encadré, une signature souvent calée à droite.',
    "- Il n'y a qu'UN titre, qu'UN objet, qu'UNE ligne de date par acte (au plus). S'il y a plusieurs candidats, garde le plus net et laisse les autres en \"papeterie\".",
    '',
    'CHAMP `garde` — nombre de caractères de la ligne CONSERVÉS avant la balise, compté sur le texte fourni :',
    "- pour \"objet\" : la longueur du label, séparateur et espace compris (« Objet : » → garde 8, la balise prend la suite) ;",
    "- pour \"date\" : la longueur de ce qui précède la date (« Fait à Amiens, le » + l'espace → garde 18) ;",
    '- 0 partout ailleurs (la ligne entière est remplacée).',
    '',
    'TYPES D\'ACTES SERVIS par la trame (`types`, un ou plusieurs) :',
    '- "courrier" : lettre avec destinataire, objet et formule de politesse ;',
    '- "requete" : requête, réquisition, réquisitoire, saisine, ordonnance, autorisation ;',
    '- "soit-transmis" : soit-transmis ;',
    '- "defaut" : papeterie générique, à utiliser pour tous les actes qui n\'ont pas de trame dédiée.',
    "Choisis d'après l'acte lui-même. Ajoute \"defaut\" seulement si la papeterie convient à n'importe quel acte.",
    '',
    'SORTIE — réponds EXCLUSIVEMENT par un objet JSON valide, sans texte autour, sans bloc de code markdown. Schéma :',
    '{',
    '  "nom": string,                 // nom court et parlant pour la trame (ex. « Courrier JLD », « Requête 706-95 »)',
    `  "types": ${JSON.stringify(TYPES)},   // un sous-ensemble, dans l'ordre de pertinence`,
    '  "lignes": [{',
    '    "i": number,                 // index de la ligne, RECOPIÉ à l\'identique',
    `    "role": ${JSON.stringify(ROLES)},`,
    '    "garde": number,             // caractères conservés avant la balise (0 le plus souvent)',
    '    "motif": string              // 6 mots maximum, pourquoi ce rôle',
    '  }],',
    '  "resume": string               // 1 à 2 phrases : ce que la trame garde, ce qu\'elle remplace, points à vérifier',
    '}',
    'IMPÉRATIF : "lignes" contient UNE entrée pour CHAQUE ligne fournie, index compris, sans exception et dans l\'ordre.',
  ].join('\n')
}

function buildUserPrompt({ nomFichier, format, lignes }) {
  const parts = [
    `ACTE À ANALYSER — fichier « ${nomFichier} » (${format === 'odt' ? 'OpenDocument' : 'Word'}), ${lignes.length} lignes.`,
    'Chaque ligne : index, texte (tronqué à 160 caractères), puis les indices de mise en page présents.',
    '',
  ]
  for (const l of lignes) {
    const indices = ['gras', 'centre', 'droite', 'tableau'].filter((k) => l[k]).join(',')
    parts.push(`[${l.i}]${indices ? ` (${indices})` : ''} ${l.t === '' ? '(ligne vide)' : l.t}`)
  }
  parts.push('')
  parts.push('Classe CHAQUE ligne et réponds par le JSON strict décrit dans les consignes système.')
  return parts.join('\n')
}

/** Prépare/borne les lignes avant envoi au modèle. */
function sanitizeLignes(lignes) {
  const out = []
  let total = 0
  for (const l of Array.isArray(lignes) ? lignes.slice(0, MAX_LIGNES) : []) {
    const i = Number(l?.i)
    if (!Number.isFinite(i) || i < 0) continue
    const t = String(l?.t ?? '').replace(/\s+/g, ' ').slice(0, MAX_CHARS_LIGNE)
    if (total + t.length > MAX_TOTAL_CHARS) break
    total += t.length
    out.push({
      i,
      t,
      gras: Boolean(l?.gras),
      centre: Boolean(l?.centre),
      droite: Boolean(l?.droite),
      tableau: Boolean(l?.tableau),
    })
  }
  return out
}

/**
 * Analyse la charpente d'un acte et propose une trame de forme.
 * Aucune écriture : la proposition remonte telle quelle au navigateur.
 * @returns {Promise<{ ok, nom?, types?, lignes?, resume?, model, error? }>}
 */
export async function analyserTrame({ nomFichier, format, lignes } = {}) {
  const clean = sanitizeLignes(lignes)
  if (!clean.length) return { ok: false, error: 'Aucune ligne exploitable', model: TRAME_MODEL }

  const run = await runClaudeJson(buildUserPrompt({
    nomFichier: String(nomFichier || 'acte').slice(0, 200),
    format: format === 'odt' ? 'odt' : 'docx',
    lignes: clean,
  }), { system: systemPrompt(), model: TRAME_MODEL, run: 'analyse-trame', timeoutMs: RUN_TIMEOUT_MS })
  if (!run.ok) return { ok: false, error: run.error, model: TRAME_MODEL }

  const data = run.data || {}
  const connus = new Set(clean.map((l) => l.i))
  const vus = new Set()
  const out = []
  for (const l of Array.isArray(data.lignes) ? data.lignes : []) {
    const i = Number(l?.i)
    if (!connus.has(i) || vus.has(i) || !ROLES.includes(l?.role)) continue
    vus.add(i)
    out.push({
      i,
      role: l.role,
      garde: Math.max(0, Math.min(MAX_CHARS_LIGNE, Number(l.garde) || 0)),
      motif: l.motif ? String(l.motif).slice(0, 120) : undefined,
    })
  }
  if (!out.length) return { ok: false, error: 'réponse du modèle inexploitable (aucune ligne classée)', model: TRAME_MODEL }

  const types = (Array.isArray(data.types) ? data.types : []).filter((t) => TYPES.includes(t))
  return {
    ok: true,
    nom: typeof data.nom === 'string' ? data.nom.trim().slice(0, 70) : '',
    types: Array.from(new Set(types)),
    lignes: out,
    resume: typeof data.resume === 'string' ? data.resume.slice(0, 400) : '',
    model: TRAME_MODEL,
  }
}
