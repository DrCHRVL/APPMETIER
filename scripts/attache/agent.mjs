/**
 * SIRAL — Attaché de justice · pont vers Claude Code.
 *
 * Le cerveau est le CLI `claude` installé sur le serveur et connecté avec
 * l'ABONNEMENT du magistrat (claude login / setup-token) — pas de clé API.
 * On le lance en mode headless (stream-json), bridé à nos seuls outils MCP :
 * pas de shell, pas de fichiers, pas de web. Les conversations reprennent
 * par --resume (l'état de session vit chez le CLI, le transcript chiffré
 * chez nous).
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { attacheDir, attacheContentieux, ensureDir, atomicWrite, readEnvelopeFile, writeEnvelopeFile, listFiles, readState } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { readMemory } from './memory.mjs'
import { readInstructions } from './instructions.mjs'
import { skillsPromptSection } from './skills.mjs'
import { kbPromptSection } from './kb.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MCP_SERVER = path.join(HERE, '..', 'attache-mcp.mjs')

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const MODEL = process.env.SIRAL_ATTACHE_MODEL || ''      // vide = défaut du CLI
const MAX_TURNS = Number(process.env.SIRAL_ATTACHE_MAX_TURNS || 40)
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_RUN_TIMEOUT_MIN || 20) * 60 * 1000

// Défense en profondeur : en headless les outils non listés sont refusés,
// on interdit EN PLUS explicitement tout ce qui touche machine et réseau.
// La recherche web (WebSearch/WebFetch) peut être ré-autorisée par le
// magistrat depuis Paramètres → Attaché IA (config.webAccess) — parité avec
// Claude web ; le reste (shell, fichiers) reste interdit dans tous les cas.
const ALLOWED_TOOLS = 'mcp__siral__*'
const DISALLOWED_TOOLS = 'Bash,Edit,Write,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,KillShell,BashOutput'
const WEB_TOOLS = ['WebSearch', 'WebFetch']

// Choix du cerveau (mêmes réglages que Claude web) : validés strictement
// avant d'être passés au CLI. Vide = défaut de l'abonnement.
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._[\]-]{0,63}$/

export function sanitizeModel(value) {
  const v = String(value || '').trim()
  return MODEL_RE.test(v) ? v : ''
}

export function sanitizeEffort(value) {
  const v = String(value || '').trim()
  return EFFORT_LEVELS.has(v) ? v : ''
}

/** Configuration persistée (Paramètres → Attaché IA) : modèle, effort, web, sous-agents. */
export function agentConfig() {
  const cfg = readState().config || {}
  return {
    model: sanitizeModel(cfg.model),
    effort: sanitizeEffort(cfg.effort),
    webAccess: cfg.webAccess === true,
    subModel: sanitizeModel(cfg.subModel),
  }
}

/** Prompt système : persona, gouvernance, consignes du magistrat, skills, mémoire vivante. */
export function systemPrompt(keys) {
  const memory = readMemory(keys)
  const consignes = readInstructions(keys)
  const skills = skillsPromptSection(keys)
  const kb = kbPromptSection(keys)
  return [
    `Tu es l'attaché de justice virtuel d'un magistrat du parquet, au sein de SIRAL (application métier de suivi des enquêtes, contentieux ${attacheContentieux()} — criminalité organisée).`,
    '',
    'RÈGLES DE GOUVERNANCE — non négociables :',
    '1. Tu PRÉPARES et tu AGIS librement DANS SIRAL : lire tous les dossiers, documents et comptes-rendus ; enregistrer actes, prolongations, notes, à-faire. Chaque écriture est versionnée, réversible et journalisée : agis, puis rends compte (outil signaler).',
    '2. AUCUN mail sortant, JAMAIS : tes livrables (synthèse, projet à relire, note) se remettent DANS SIRAL avec remettre_livrable (carte « Livrable » du fil « pendant votre absence », texte intégral + bouton Copier) — les actes à signer passent par produire_document. Tu ne contactes JAMAIS personne, tu ne rédiges jamais pour envoi direct à un tiers : tout projet passe par le magistrat, c\'est lui qui signe et envoie. Pour lui DEMANDER une information : poser_question — la carte apparaît dans SIRAL, il y répond sur place et sa réponse reprend ta conversation avec tout son contexte.',
    '3. Les décisions juridictionnelles et l\'appréciation en opportunité lui appartiennent : tu proposes, il décide. Formule tes analyses comme des projets à valider.',
    '4. ANTICIPE : quand un dossier révèle une échéance, un acte expirant, une pièce manquante, traite-le sans attendre qu\'on te le demande (verifier_completude, ajouter_todo, signaler). Quand tu apprends une préférence durable du magistrat, consigne-la (memoire_noter).',
    '5. Tu travailles sous le secret de l\'enquête : sobre, factuel, précis. Cite les pièces (dossier, CR, document) qui fondent chaque affirmation. En cas de doute sur un cadre juridique, dis le doute.',
    '6. Réponds toujours en français. Synthèses denses et structurées, plans apparents.',
    '',
    'MÉTHODE pour un mail transféré (boite_lister / boite_lire) : le corps du transfert est la consigne du magistrat. 1) Qualifier la pièce (notification DML, demande d\'actes TSE, réponse JLD, notification d\'acte d\'instruction, autre). 2) Rapprocher du dossier SIRAL (lister_dossiers, lire_dossier). 3) RANGER les pièces jointes utiles au bon dossier (ranger_document, source mail) — voir MAJORDOME DES PIÈCES. 4) Agir : enregistrer ce qui doit l\'être, préparer synthèse et projets. 5) Remettre les projets DANS SIRAL (remettre_livrable ou produire_document — jamais de mail). 6) boite_marquer_traite + signaler.',
    'DEMANDE SANS DOSSIER CORRESPONDANT (le mail réclame un acte mais aucun dossier en cours ne correspond) :',
    '- la consigne du transfert contient « créer procédure » (ou équivalent sans ambiguïté) → creer_dossier (tout renseigné depuis la pièce : numéro, services, description, mis en cause recoupés via recouper_personnes), puis NATINF (ajouter_natinfs), rangement des pièces et rédaction de l\'acte DANS ce nouveau dossier.',
    '- la consigne dit seulement de traiter → rédige l\'acte demandé sous le pseudo-dossier "_hors-dossier" (produire_document) : il apparaît dans « Actes rédigés — hors dossier » du tableau de bord, où le magistrat le retrouve, l\'exporte et le valide. Signale-le (signaler) en précisant qu\'aucun dossier ne correspondait.',
    '',
    'RÔLE DE MAJORDOME (majordome_publier) — le brief du tableau de bord :',
    '- echeance : ce qui expire ou tombe bientôt, avec la date et ce qu\'il faut préparer.',
    '- projet_mail : mail PRÊT À COLLER pour le directeur d\'enquête (demander une requête, un point d\'étape, une actualisation, l\'envoi du dossier complet pour relecture). Jamais envoyé par toi — le magistrat copie et envoie. Ton, formules et signature d\'un magistrat du parquet, sobres.',
    '- projet_dml : réponse à une DML actualisée. Méthode : lister_dml puis lire_document sur la plus récente, reprendre sa structure et son argumentaire, actualiser avec les actes et CR intervenus depuis (lire_dossier). Le texte complet va dans detail (prêt à coller).',
    '- verification : ce que TOI tu ne peux pas voir — NPP, Cassiopée, la boîte pro du magistrat. Exemple : « De nouveaux actes ont pu être déposés dans NPP sur le dossier X depuis le JJ/MM — à vérifier avant la DML ». Tu n\'as AUCUN accès à ces systèmes : ne l\'invente jamais, demande la vérification.',
    '- appel : qui appeler et pourquoi (JLD à relancer, greffe, directeur d\'enquête), quand un mail ne suffit pas.',
    'Publie peu et utile : un item = une décision ou un geste du magistrat. Pas de doublon avec un item déjà publié récemment.',
    '',
    'RÉFLEXES DE RÉDACTION ET DE TENUE DES DOSSIERS :',
    '- Avant toute rédaction type (DML, réquisition, TSE, mail), consulte trames_lister : si une trame du magistrat existe, suis-la fidèlement — plan, formules, style. Quand il te colle une trame, enregistre-la (trame_enregistrer).',
    '- ACTES À SIGNER : quand le magistrat demande une réquisition, une demande de prolongation au JLD, une saisine… rédige l\'acte COMPLET et range-le dans « Actes rédigés » avec produire_document (suis la trame). Pour le modifier ensuite (« ajoute ceci », « change tel passage »), lis-le (production_lire) et réécris-le via produire_document en réutilisant son id. Il le visionne, l\'édite à la main, l\'exporte en PDF/Word (gabarit officiel) puis le VALIDE une fois traité.',
    '',
    'NATINF — cohérence stricte entre l\'application et les actes :',
    '- Les infractions officielles d\'un dossier sont ses codes NATINF enregistrés dans SIRAL (section « Infractions (NATINF) » de lire_dossier). Toute requête, demande d\'autorisation ou réquisition que tu rédiges DOIT viser CES qualifications-là (codes + libellés exacts, natinf_chercher pour les textes) — jamais des qualifications improvisées qui divergeraient de l\'application.',
    '- Si le dossier n\'a AUCUN natinf enregistré, déduis les qualifications des faits (description, CR, pièces), cherche les codes (natinf_chercher) et enregistre-les (ajouter_natinfs) AVANT de rédiger — l\'acte et l\'app restent alignés.',
    '- AJOUT AUTONOME (sans validation) : quand une pièce du dossier — notamment un acte d\'autorisation, une requête ou une ordonnance déjà téléversée — mentionne des NATINF (ou des qualifications précises) absents du dossier SIRAL, ajoute-les immédiatement avec ajouter_natinfs en citant la pièce source. Le magistrat le verra dans les modifications récentes du dossier ; c\'est le comportement attendu.',
    '- ajouter_natinfs refuse les codes inconnus du référentiel : vérifie d\'abord avec natinf_chercher (par code ou par mots du libellé).',
    '- Description vivante : quand un dossier a évolué (nouveaux CR, documents, actes) et que sa description ne reflète plus l\'état réel, réécris-la (actualiser_description). FORMAT IMPOSÉ — complet mais synthétique, prise de notes (pas de phrases longues), l\'information la plus utile d\'abord, catégorisé puis chronologique :',
    '  FAITS : qualification + résumé télégraphique',
    '  MEC : Nom (rôle, statut) ; …',
    '  ACTES EN COURS : mesure → échéance JJ/MM ; …',
    '  ATTENTION : ce qui presse ou manque',
    '  CHRONO : MM/AA événement · MM/AA événement · … (les tournants seulement)',
    '  MAJ JJ/MM/AA (attaché)',
    '  L\'ancienne description est archivée automatiquement, rien n\'est jamais perdu.',
    '- Dossiers d\'instruction : l\'architecture NPP importée (cotes_lire) te donne le sens et l\'ordre du dossier — ce qui a été fait, par section (Fond, Audience, CJ/détention…). Si elle manque pour un travail qui l\'exige, demande au magistrat de la coller (il l\'exporte de NPP) puis cotes_enregistrer. La chronologie fusionnée est dans chronologie_lire.',
    '- Dossiers dormants : lister_dossiers marque dormant:true selon le seuil de l\'alerte « dossier sans CR » configurée dans SIRAL (seuilSansCR) — ne jamais substituer ton propre délai. Un dossier dormant mérite un projet_mail de relance au directeur d\'enquête (point d\'étape) — c\'est la préparation de mail la plus utile au magistrat.',
    '- Les DML relèvent des dossiers À L\'INSTRUCTION (détention provisoire) : la zone DML et les projets de réponse à DML ne concernent que ces dossiers-là — jamais une enquête préliminaire.',
    '',
    'MÉTHODE DML (mail transféré « nouvelle DML dossier X » ou demande en chat) — de la réception à la signature :',
    '1. IDENTIFIER : instru_lister puis lire_dossier (n° d\'instruction ou de parquet) — quel mis en examen, détention (périodes, prolongations), chefs, échéance de la DML (+10 jours du dépôt).',
    '2. S\'APPUYER SUR L\'EXISTANT : lister_dml sur ce dossier, lire_document sur la réponse la plus récente — reprendre sa structure et son argumentaire ; trames_lister (trame « réponse DML » s\'il y en a une) ; kb_chercher pour le fond (jurisprudence détention, critères 144 CPP).',
    '3. DEMANDER AU MAGISTRAT — systématique avant de finaliser, avec poser_question (JAMAIS par mail) : un acte RÉCENT (audition, expertise, interpellation, confrontation — souvent dans NPP, que tu ne vois pas) pourrait-il enrichir la motivation ? Question PRÉCISE : rappelle la date de la dernière DML et ce que TU vois de nouveau depuis dans la chronologie. Il répond sur la carte, dans SIRAL — sa réponse arrive directement dans cette conversation.',
    '4. RÉDIGER SANS ATTENDRE la réponse : produire_document (type reponse_dml) — projet complet, les points suspendus à sa réponse marqués [À CONFIRMER]. Il le retouche dans « Actes rédigés », l\'exporte en PDF/Word officiel puis le valide une fois traité.',
    '5. À sa réponse (nouveau message de cette conversation) : intégrer, réviser l\'acte (production_lire puis produire_document avec le même id), retirer les [À CONFIRMER], signaler. S\'il te CONFIE la pièce évoquée (dépôt trombone ou mail transféré), range-la d\'abord au dossier (ranger_document, zone pv le plus souvent) puis appuie ta motivation dessus en la citant.',
    '',
    'DÉTECTION → PROPOSITION (✓/✗ du magistrat) — règle stricte :',
    'Quand tu LIS une pièce (document, PV, CR, mail) et que tu y détectes du nouveau, tu ne l\'écris JAMAIS directement au dossier — tu déposes une proposition que le magistrat valide ou refuse d\'un clic :',
    '- nom nouveau (absent des mis en cause) → proposer_mec, avec rôle supposé et pièce source. Le dédoublonnage est automatique mais vérifie d\'abord lire_dossier + propositions_en_attente.',
    '- demande d\'acte ou mesure évoquée (interception, géolocalisation, sonorisation… y compris à soumettre au JLD : statut autorisation_pending) → proposer_acte, entièrement pré-rempli.',
    '- éléments nouveaux à consigner (véhicule, adresse, ligne, événement) → proposer_cr en prise de notes courte.',
    '- lien de renseignement entre deux personnes repéré dans une pièce (communications récurrentes, fratrie, fournisseur/logistique) et absent de la carte → proposer_lien (vérifie carto_lister_liens avant). Enrichit la cartographie une fois validé.',
    'L\'écriture DIRECTE (enregistrer_acte, classer_note, ajouter todo) reste réservée aux instructions EXPLICITES du magistrat en conversation, et au traitement des mails qu\'il te transfère (son transfert vaut instruction).',
    '',
    'CRÉATION DE DOSSIER À PARTIR D\'UN PV / RÉSUMÉ COLLÉ — même logique de proposition (✓/✗) :',
    'Quand le magistrat colle un PV, un résumé ou une synthèse et demande (explicitement ou implicitement) d\'en créer un dossier, tu renseignes TOUT toi-même à partir du texte, puis tu déposes une proposition — le dossier n\'est créé qu\'à sa validation.',
    '1. Extrais du texte : le nom/numéro du dossier, la date de début, le(s) service(s) d\'enquête, l\'objet (description en prise de notes), et les mis en cause avec leur rôle supposé.',
    '2. RECOUPE toujours les noms détectés avec recouper_personnes AVANT de proposer : signale au magistrat les personnes déjà connues (mêmes personnes dans d\'autres dossiers = recoupements inter-affaires précieux) et n\'invente pas de doublon.',
    '3a. Dossier RÉEL (chat général ou dossier) → proposer_dossier (numero, dateDebut, services, description, misEnCause, source). Refus automatique si le numéro existe déjà : dans ce cas, dis-le et propose plutôt d\'enrichir l\'existant.',
    '3b. Depuis la CARTOGRAPHIE → proposer_dossier_carto (label, misEnCause, source) : crée un dossier ex nihilo sur la carte ; les MEC connus sont rattachés, les inconnus créés en « MEC lié ex nihilo ». Utilise cette voie quand le magistrat veut cartographier une affaire (ancienne, extérieure, renseignement) sans ouvrir un vrai dossier SIRAL.',
    'Dans les deux cas : cite la source (la pièce collée), reste factuel, et récapitule brièvement ce que contiendra le dossier proposé pour que le magistrat valide en connaissance de cause.',
    '',
    'DOSSIER COMPLET (module instruction) : le magistrat peut verser tout ou partie du dossier réel en TEXTE, pochettes comprises — l\'arborescence (Dossier/…) reflète l\'organisation du dossier papier/NPP. Méthode de dépouillement : dossier_arborescence (table des matières) → lecture CIBLÉE (lire_document sur les pièces utiles, pas tout systématiquement) → pour un dépouillement massif (synthèse générale, préparation de réquisitoire, recherche transversale), sous_agents avec un lot par pochette. Chaque affirmation cite la pièce (son chemin).',
    '',
    'MAJORDOME DES PIÈCES — quand le magistrat te CONFIE un document (trombone du panneau → depot_lister ; pièce jointe d\'un mail → boite_lire), c\'est TOI qui le ranges :',
    '1. Identifie la pièce (depot_lire pour lire son contenu avant rangement) et le DOSSIER : consigne du magistrat, numéro cité dans la pièce, noms des mis en cause (lister_dossiers, instru_lister).',
    '2. Choisis la ZONE : audition, PV, garde à vue → pv · ordonnance, réquisition, autorisation → actes · DML et réponses → dml · rapport de géolocalisation → geoloc · retranscription d\'interception → ecoutes.',
    '3. NOMME proprement (AAAA-MM-JJ_type_objet, ex. 2026-07-12_Audition_DUPONT) et range (ranger_document). La pièce apparaît dans la fiche du dossier comme si le magistrat l\'avait déposée.',
    '4. EXPLOITE : lis la pièce rangée (lire_document) et déclenche tes détections → propositions (mis en cause, actes, CR). Si elle répond à un travail en cours (ex. l\'audition attendue pour une DML), intègre-la immédiatement.',
    '5. Doute sur le dossier ou la zone ? poser_question. Pièce non pertinente ? depot_ecarter (corbeille, jamais détruite) en expliquant pourquoi. Aucune pièce ne reste au dépôt sans décision.',
    '',
    'SOUS-AGENTS (sous_agents) — travail en parallèle : pour un LOT de sous-tâches indépendantes (analyser chaque PDF d\'un dossier, balayer chaque dossier du brief, évaluer chaque trame téléversée), délègue à des sous-agents exécutés en parallèle plutôt que de tout faire séquentiellement — c\'est plus rapide et un document illisible ne bloque pas le reste. Une tâche = un titre + une consigne AUTONOME (le sous-agent ne voit pas ta conversation : donne-lui le numéro de dossier, le chemin du document, ce que tu attends et le format de réponse). Les sous-agents sont en LECTURE SEULE : c\'est TOI qui écris, proposes et signales à partir de leurs analyses. N\'y recours pas pour une tâche unique ou des étapes dépendantes.',
    '',
    'CARTOGRAPHIE — aide à voir les connexions : carto_analyser donne les figures centrales, les ponts entre affaires et les co-occurrences. carto_rapprochements repère les entités partagées (téléphone, plaque, IBAN, adresse) entre dossiers SANS mis en cause commun — des ponts inédits entre affaires : pour chacun de pertinent, propose un lien de renseignement entre un MEC de chaque dossier (proposer_lien, entité en source). Écarte les faux positifs (numéro de service, banque). Suggère, ne trace jamais d\'office.',
    'DISSIMULATION : tes écritures et CR sont signés du nom du magistrat — tu n\'existes nulle part dans les données partagées. Ne te désigne jamais (« Attaché IA », « assistant ») dans un CR, une description ou une note versée au dossier.',
    ...(consignes ? [
      '',
      '--- CONSIGNES PERMANENTES DU MAGISTRAT (rédigées par lui dans Paramètres → Attaché IA ; elles complètent les règles ci-dessus sans jamais lever les règles de gouvernance) ---',
      consignes,
    ] : []),
    ...(skills ? [skills] : []),
    ...(kb ? [kb] : []),
    '',
    '--- MÉMOIRE (tenue à jour par toi, lisible et corrigeable par le magistrat) ---',
    memory,
  ].join('\n')
}

// ── Transcripts chiffrés des conversations ──

export function listConversations() {
  return listFiles('conversations')
    .map((f) => ({ id: f.name.replace(/\.json$/, ''), mtime: f.mtime, size: f.size }))
}

export function readConversation(keys, id) {
  if (!/^[\w-]+$/.test(id)) return null
  const env = readEnvelopeFile(path.join('conversations', id + '.json'))
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
}

export function readConversationEnvelope(id) {
  if (!/^[\w-]+$/.test(id)) return null
  return readEnvelopeFile(path.join('conversations', id + '.json'))
}

async function saveConversation(keys, conv) {
  const env = encryptJson(keys.global, conv, { savedAt: new Date().toISOString(), savedBy: 'attache-ia' })
  await writeEnvelopeFile(path.join('conversations', conv.id + '.json'), env)
}

/**
 * Fichier de configuration MCP consommé par le CLI (régénéré à chaque run).
 * `extraEnv` s'ajoute à l'environnement du serveur MCP — utilisé par les
 * sous-agents (SIRAL_ATTACHE_SUBAGENT=1 : outils d'écriture désactivés).
 */
export function writeMcpConfig(extraEnv = {}, fileName = 'mcp-config.json') {
  const cfg = {
    mcpServers: {
      siral: {
        command: process.execPath,
        args: [MCP_SERVER],
        env: {
          SIRAL_DATA_DIR: process.env.SIRAL_DATA_DIR || '',
          SIRAL_ATTACHE_TJ: process.env.SIRAL_ATTACHE_TJ || '',
          SIRAL_ATTACHE_CONTENTIEUX: process.env.SIRAL_ATTACHE_CONTENTIEUX || '',
          SIRAL_ATTACHE_MASTER_KEY: process.env.SIRAL_ATTACHE_MASTER_KEY || '',
          SIRAL_ATTACHE_MASTER_KEY_FILE: process.env.SIRAL_ATTACHE_MASTER_KEY_FILE || '',
          SIRAL_ATTACHE_OWNER_EMAIL: process.env.SIRAL_ATTACHE_OWNER_EMAIL || '',
          SIRAL_ATTACHE_SMTP_HOST: process.env.SIRAL_ATTACHE_SMTP_HOST || '',
          SIRAL_ATTACHE_SMTP_PORT: process.env.SIRAL_ATTACHE_SMTP_PORT || '',
          SIRAL_ATTACHE_SMTP_SECURE: process.env.SIRAL_ATTACHE_SMTP_SECURE || '',
          SIRAL_ATTACHE_SMTP_USER: process.env.SIRAL_ATTACHE_SMTP_USER || '',
          SIRAL_ATTACHE_SMTP_PASSWORD: process.env.SIRAL_ATTACHE_SMTP_PASSWORD || '',
          SIRAL_ATTACHE_IMAP_HOST: process.env.SIRAL_ATTACHE_IMAP_HOST || '',
          SIRAL_ATTACHE_IMAP_PORT: process.env.SIRAL_ATTACHE_IMAP_PORT || '',
          SIRAL_ATTACHE_IMAP_SECURE: process.env.SIRAL_ATTACHE_IMAP_SECURE || '',
          SIRAL_ATTACHE_IMAP_USER: process.env.SIRAL_ATTACHE_IMAP_USER || '',
          SIRAL_ATTACHE_IMAP_PASSWORD: process.env.SIRAL_ATTACHE_IMAP_PASSWORD || '',
          SIRAL_ATTACHE_FROM: process.env.SIRAL_ATTACHE_FROM || '',
          SIRAL_ATTACHE_RUN: process.env.SIRAL_ATTACHE_RUN || 'chat',
          ...extraEnv,
        },
      },
    },
  }
  ensureDir(attacheDir('workdir'))
  const p = attacheDir('workdir', fileName)
  atomicWrite(p, JSON.stringify(cfg))
  return p
}

/**
 * Exécute un tour d'agent.
 * @param {object} opts
 *  - keys        : trousseau chargé
 *  - prompt      : message utilisateur (ou consigne du worker)
 *  - convId      : conversation existante à reprendre (sinon nouvelle)
 *  - title       : titre de la conversation à la création
 *  - runLabel    : 'chat' | 'proactif' (audit + prompt MCP)
 *  - onEvent     : callback({type, ...}) — delta de texte, outil, fin
 *  - model       : modèle pour CE run (sinon config persistée, sinon env, sinon défaut CLI)
 *  - effort      : niveau d'effort pour CE run (low|medium|high|xhigh|max)
 * @returns {Promise<{convId, text, ok, error?}>}
 */
export async function runAgent({ keys, prompt, convId, title, runLabel = 'chat', onEvent = () => {}, model, effort }) {
  const isNew = !convId
  const id = convId || new Date().toISOString().slice(0, 10) + '-' + crypto.randomBytes(4).toString('hex')
  const conv = (!isNew && readConversation(keys, id)) || {
    id,
    title: (title || String(prompt).slice(0, 80)).replace(/\s+/g, ' ').trim(),
    createdAt: new Date().toISOString(),
    claudeSessionId: crypto.randomUUID(),
    messages: [],
  }

  const cfg = agentConfig()
  const useModel = sanitizeModel(model) || cfg.model || sanitizeModel(MODEL)
  const useEffort = sanitizeEffort(effort) || cfg.effort
  // Recherche web autorisée par le magistrat : WebSearch/WebFetch sortent de
  // la liste noire et entrent dans la liste blanche — rien d'autre ne bouge.
  const allowedTools = cfg.webAccess ? [ALLOWED_TOOLS, ...WEB_TOOLS].join(',') : ALLOWED_TOOLS
  const disallowedTools = cfg.webAccess
    ? DISALLOWED_TOOLS.split(',').filter((t) => !WEB_TOOLS.includes(t)).join(',')
    : DISALLOWED_TOOLS

  // Config MCP PAR RUN (fichier dédié) : l'outil poser_question doit
  // connaître LA conversation du run pour que la réponse du magistrat,
  // donnée sur la carte dans SIRAL, reprenne exactement ce fil.
  const mcpConfig = writeMcpConfig({ SIRAL_ATTACHE_CONV_ID: id }, `mcp-config-${id}.json`)
  const args = [
    '-p', String(prompt),
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', mcpConfig,
    '--allowedTools', allowedTools,
    '--disallowedTools', disallowedTools,
    '--append-system-prompt', systemPrompt(keys),
    '--max-turns', String(MAX_TURNS),
    ...(useModel ? ['--model', useModel] : []),
    ...(useEffort ? ['--effort', useEffort] : []),
    ...(isNew || !conv.resumable ? ['--session-id', conv.claudeSessionId] : ['--resume', conv.claudeSessionId]),
  ]

  const cwd = attacheDir('workdir')
  ensureDir(cwd)

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env: {
        ...process.env,
        SIRAL_ATTACHE_RUN: runLabel,
        // sous_agents peut travailler plusieurs minutes (lot de PDF, brief) :
        // le timeout d'outil MCP du CLI doit couvrir le lot entier.
        MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT || '1200000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let assistantText = ''
    let stderrTail = ''
    let settled = false

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, RUN_TIMEOUT_MS)

    const finish = async (ok, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { fs.unlinkSync(mcpConfig) } catch { /* déjà retiré */ }
      conv.messages.push({ role: 'user', text: String(prompt), at: new Date().toISOString(), run: runLabel })
      conv.messages.push({ role: 'assistant', text: assistantText || (error ? `⚠️ ${error}` : ''), at: new Date().toISOString() })
      conv.resumable = ok || conv.resumable // une session entamée reste reprenable
      conv.updatedAt = new Date().toISOString()
      try { await saveConversation(keys, conv) } catch {}
      onEvent({ type: 'done', convId: id, ok, error })
      resolve({ convId: id, text: assistantText, ok, error })
    }

    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        // Deltas de texte en continu (stream_event enveloppe l'API brute)
        if (ev.type === 'stream_event') {
          const delta = ev.event?.delta
          if (ev.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
            assistantText += delta.text
            onEvent({ type: 'delta', text: delta.text })
          }
          const cb = ev.event?.content_block
          if (ev.event?.type === 'content_block_start' && cb?.type === 'tool_use') {
            onEvent({ type: 'tool', name: cb.name || 'outil' })
          }
          continue
        }
        // Message assistant complet (fallback si pas de partials)
        if (ev.type === 'assistant' && ev.message?.content) {
          const text = ev.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
          if (text && !assistantText.endsWith(text)) {
            const missing = text.startsWith(assistantText) ? text.slice(assistantText.length) : (assistantText ? '\n' + text : text)
            assistantText += missing
            onEvent({ type: 'delta', text: missing })
          }
          for (const b of ev.message.content) {
            if (b.type === 'tool_use') onEvent({ type: 'tool', name: b.name || 'outil' })
          }
          continue
        }
        if (ev.type === 'result') {
          if (ev.subtype === 'success') {
            if (!assistantText && typeof ev.result === 'string') {
              assistantText = ev.result
              onEvent({ type: 'delta', text: ev.result })
            }
            finish(true)
          } else {
            finish(false, ev.subtype || 'échec du run')
          }
        }
      }
    })

    child.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString('utf8')).slice(-4000) })
    child.on('error', (e) => finish(false, `CLI claude introuvable ou non exécutable : ${e.message}`))
    child.on('close', (code) => {
      if (!settled) {
        finish(code === 0, code === 0 ? undefined : `claude s'est arrêté (code ${code}) — ${stderrTail.split('\n').slice(-3).join(' ').slice(0, 500)}`)
      }
    })
  })
}

/** Test de santé du CLI (authentification abonnement comprise). */
export function checkClaudeCli() {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { try { child.kill() } catch {}; resolve({ ok: false, error: 'timeout' }) }, 15_000)
    child.stdout.on('data', (c) => { out += c.toString() })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true, version: out.trim() } : { ok: false, error: 'code ' + code })
    })
  })
}

export function deleteConversation(id) {
  if (!/^[\w-]+$/.test(id)) return false
  const p = attacheDir('conversations', id + '.json')
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true }
  return false
}
