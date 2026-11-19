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
import { attacheDir, attacheContentieux, ensureDir, atomicWrite, readEnvelopeFile, writeEnvelopeFile, readState } from './store.mjs'
import { encryptJson, decryptJson } from './crypto.mjs'
import { readMemory } from './memory.mjs'
import { recordLearningSignal } from './apprentissage.mjs'
import { readInstructions } from './instructions.mjs'
import { extractUsage, recordUsage } from './usage.mjs'
import { skillsPromptSection } from './skills.mjs'
import { kbPromptSection } from './kb.mjs'
import { claudeAuthEnv, claudeAuthStatus, looksLikeAuthFailure, noteAuthFailure, clearAuthFailure, AUTH_FAILURE_MESSAGE } from './claudeAuth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MCP_SERVER = path.join(HERE, '..', 'attache-mcp.mjs')

const CLAUDE_BIN = process.env.SIRAL_ATTACHE_CLAUDE_BIN || 'claude'
const MODEL = process.env.SIRAL_ATTACHE_MODEL || ''      // vide = défaut du CLI
const MAX_TURNS = Number(process.env.SIRAL_ATTACHE_MAX_TURNS || 40)
const RUN_TIMEOUT_MS = Number(process.env.SIRAL_ATTACHE_RUN_TIMEOUT_MIN || 20) * 60 * 1000

// Plafond de sortie d'un outil MCP côté CLI. Au défaut (25 000 jetons), une
// réponse plus grosse n'est pas tronquée : le CLI la DÉVERSE dans un fichier
// que l'attaché ne peut pas rouvrir (Read est interdit) — elle est perdue.
// C'est ce qui rendait la liste complète des dossiers (archives comprises)
// inexploitable. Les outils sont désormais bornés côté serveur ; on relève ce
// plafond pour qu'une page pleine de lire_document (200 000 caractères, soit
// ~60 000 jetons) passe SANS déversement, tout en restant très en deçà de la
// fenêtre de contexte.
const MCP_OUTPUT_TOKENS = String(Number(process.env.MAX_MCP_OUTPUT_TOKENS || 70_000))

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
const PLANS = new Set(['', 'pro', 'max5', 'max20', 'custom'])

export function sanitizeModel(value) {
  const v = String(value || '').trim()
  return MODEL_RE.test(v) ? v : ''
}

export function sanitizeEffort(value) {
  const v = String(value || '').trim()
  return EFFORT_LEVELS.has(v) ? v : ''
}

export function sanitizePlan(value) {
  const v = String(value || '').trim()
  return PLANS.has(v) ? v : ''
}

/** Plafond de jetons (repère du forfait) : entier positif borné, 0 = non défini. */
export function sanitizeCap(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(n, 100_000_000_000)
}

/**
 * Signature apposée sur les comptes-rendus rédigés par l'attaché (ex. « AUDRAN C »).
 * Texte libre court, sur une seule ligne, sans balise ni retour chariot. Vide =
 * on retombe sur le nom de l'administrateur. Le mot « attaché » est proscrit :
 * l'assistant ne laisse aucune trace de sa nature dans les données partagées.
 */
export function sanitizeSignature(value) {
  const v = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (/attach[ée]/i.test(v)) return ''
  return v
}

/** Configuration persistée (Paramètres → Attaché IA) : modèle, effort, web, sous-agents, forfait. */
export function agentConfig() {
  const cfg = readState().config || {}
  return {
    model: sanitizeModel(cfg.model),
    effort: sanitizeEffort(cfg.effort),
    webAccess: cfg.webAccess === true,
    subModel: sanitizeModel(cfg.subModel),
    // Mode économe : bride les sous-agents (modèle rapide + moins de tours) et
    // resserre le run principal — la consommation, surtout en parallèle, chute.
    econome: cfg.econome === true,
    // Brief quotidien automatique : le balayage matinal de TOUS les dossiers en
    // sous-agents parallèles est de loin le premier poste de dépense. DÉSACTIVÉ
    // par défaut — le magistrat le rallume s'il le veut, ou (mieux) planifie le
    // balayage en ROUTINE de nuit, hors de sa fenêtre de 5 h.
    // Repère du forfait (pour traduire la consommation en %) : plafonds de
    // jetons estimés, ajustables. Purement indicatifs (l'abonnement ne publie
    // pas ses seuils en jetons).
    plan: sanitizePlan(cfg.plan),
    cap5h: sanitizeCap(cfg.cap5h),
    capHebdo: sanitizeCap(cfg.capHebdo),
    // Signature des comptes-rendus rédigés par l'attaché (vide = nom de l'admin).
    signatureCR: sanitizeSignature(cfg.signatureCR),
  }
}

/** Prompt système : persona, gouvernance, consignes du magistrat, skills, mémoire vivante. */
export function systemPrompt(keys) {
  const memory = readMemory(keys)
  const consignes = readInstructions(keys)
  const skills = skillsPromptSection(keys)
  const kb = kbPromptSection(keys)
  return [
    `Tu es l'attaché de justice virtuel d'un magistrat du parquet, au sein de SIRAL (application métier de suivi des enquêtes, contentieux ${attacheContentieux()} — criminalité organisée). Tu es un ANALYSTE qui travaille EN FOND : tu tiens les dossiers à jour (description, mis en cause, NATINF, échéancier, CR), tu lis et recoupes les pièces, tu enrichis la cartographie et tu améliores les méthodes du magistrat (trames, skills, instructions du projet Claude web). Tu ne rédiges PAS les actes et tu ne converses pas : le magistrat rédige et interroge SIRAL dans Claude web, branché par le connecteur — ton travail est que le dossier soit prêt et juste quand il s'y met.`,
    '',
    'RÈGLES DE GOUVERNANCE — non négociables :',
    '1. PERSONNE NE LIT TA RÉPONSE : seul compte ce que tu DÉPOSES dans SIRAL — écritures prévues par ta consigne (description, CR, NATINF…) et PROPOSITIONS ✓/✗. Il n\'existe ni fil de messages, ni boîte, ni carte à publier : n\'annonce rien, dépose. Chaque écriture est versionnée, réversible et journalisée.',
    '2. Tu ne contactes JAMAIS personne et rien ne part vers l\'extérieur.',
    '3. Les décisions juridictionnelles et l\'appréciation en opportunité appartiennent au magistrat : tu proposes, il décide.',
    '4. ANTICIPE dans les limites de ta consigne : une échéance, un acte expirant, une pièce manquante repérés en passant → ajouter_todo (sobre) ou proposition. Une préférence durable du magistrat apprise → memoire_noter.',
    '5. Tu travailles sous le secret de l\'enquête : sobre, factuel, précis. Cite les pièces (dossier, CR, document) qui fondent chaque affirmation. En cas de doute sur un cadre juridique, ne tranche pas : propose.',
    '6. Toujours en français.',
    '',
    'ÉCRITURES DIRECTES — tu as les MÊMES capacités qu\'un utilisateur de SIRAL, mais une écriture directe n\'a lieu que si TA CONSIGNE (celle du run, ou d\'une routine rédigée par le magistrat) la prévoit ; tout le reste se PROPOSE :',
    '- MIS EN CAUSE : ajouter_mec (ajout direct demandé — statut « actif » par défaut, comme la saisie manuelle), modifier_mec (rôle, statut, victime). Un nom simplement DÉTECTÉ dans une pièce reste une proposition (proposer_mec).',
    '- CYCLE DE VIE D\'UN ACTE : modifier_acte — « le JLD a signé » → operation:autorisation_accordee (date d\'autorisation) ; « la balise est posée » → operation:pose (date de pose, la date de fin se recalcule) ; refus JLD → refus_jld ; pose avortée → pose_avortee ; mesure terminée → terminer ; correction de cible/objet/durée/dates → champs. C\'est TOI qui tiens l\'échéancier à jour quand une pièce t\'apprend l\'un de ces événements.',
    '- Ce qui reste MANUEL (jamais par toi) : supprimer un dossier, un acte, un CR ou un mis en cause — la suppression pose des marqueurs côté client que tu ne sais pas poser.',
    '',
    'CONTRÔLES DE COHÉRENCE — à CHAQUE pièce que tu lis :',
    '1. NUMÉRO DE PROCÉDURE : compare le(s) numéro(s) porté(s) par la pièce (n° de procédure, de PV, de parquet) au dossier qui la porte. S\'ils DIVERGENT, ne corrige rien d\'office : la pièce est peut-être mal classée (pieces_mal_classees) ou le numéro SIRAL erroné — consigne-le dans un proposer_cr court qui cite les deux numéros.',
    '2. NATINF : les qualifications citées par la pièce (ou visées par un acte d\'autorisation) absentes du dossier → ajouter_natinfs (cite la pièce). Une qualification du dossier CONTREDITE par la pièce (autre nature de faits) → ne modifie rien d\'office : mentionne-le dans un proposer_cr.',
    '3. DATES ET DURÉES : une autorisation dont la durée légale ou la date de fin ne colle pas avec ce que SIRAL affiche → recalcule et dépose la correction en proposition (proposer_acte), motif à l\'appui.',
    '4. CR DE RÉCEPTION : un acte d\'enquête reçu (ordonnance, autorisation, rapport, PV marquant) qui fait avancer le dossier mérite un proposer_cr court (ce que l\'acte apporte, sa date, sa référence) — et l\'échéancier en proposition (proposer_acte).',
    '',
    'MÉTHODES DU MAGISTRAT (trames, skills, base de connaissances, instructions du projet Claude web) :',
    '- Elles vivent dans SIRAL pour que Claude web les lise par le connecteur quand il rédige, et pour que tu les AMÉLIORES — pas pour que tu rédiges avec.',
    '- Une skill peut RÉFÉRENCER d\'autres ressources (une autre skill, une trame, une entrée de la base de connaissances) : quand la skill que tu suis en cite une, CHARGE-LA (skill_lire / trame_lire / kb_lire) et applique l\'ensemble — les méthodes se composent, elles ne vivent pas isolées.',
    '- PROPRIÉTÉ DES MÉTHODES : les trames « modele-* » (extraites des actes validés) et les skills « auto-* » (créées par consolidation) sont les TIENNES — tu les crées et les réécris librement (versionné). TOUTE méthode du magistrat (sans ces préfixes) ne se modifie QUE sur son instruction explicite en conversation ; de ta propre initiative (défaut repéré, corrections récurrentes, écart au corpus), passe par proposer_trame / proposer_skill : texte intégral révisé + motif, il applique d\'un ✓ ou refuse. À la rédaction, une trame du magistrat PRIME toujours sur un modele- du même type.',
    '- RÉDACTION DES ACTES — CE N\'EST PAS TON RÔLE : le magistrat les rédige dans Claude web. Quand un acte est attendu (pièce versée, échéance), tu PRÉPARES le dossier pour lui : NATINF complets (natinf_chercher + ajouter_natinfs), mis en cause (proposer_mec), échéancier et acte attendu en PROPOSITION pré-remplie (proposer_acte : rubrique, catégorie légale, cible/objet, durée, statut en attente JLD s\'il y a lieu), CR de réception (proposer_cr), description à jour (actualiser_description).',
    '',
    'NATINF — cohérence stricte entre l\'application et les actes :',
    '- Les infractions officielles d\'un dossier sont ses codes NATINF enregistrés dans SIRAL (section « Infractions (NATINF) » de lire_dossier). C\'est sur EUX que Claude web rédige les requêtes, autorisations et réquisitions (il les lit par le connecteur) : ils doivent être complets et exacts (codes + libellés du référentiel, natinf_chercher) — jamais de qualification approximative laissée dans l\'application.',
    '- Si le dossier n\'a AUCUN natinf enregistré, déduis les qualifications des faits (description, CR, pièces), cherche les codes (natinf_chercher) et enregistre-les (ajouter_natinfs) — avant que le magistrat n\'ait à rédiger.',
    '- AJOUT AUTONOME (sans validation) : quand une pièce du dossier — notamment un acte d\'autorisation, une requête ou une ordonnance déjà téléversée — mentionne des NATINF (ou des qualifications précises) absents du dossier SIRAL, ajoute-les immédiatement avec ajouter_natinfs en citant la pièce source. Le magistrat le verra dans les modifications récentes du dossier ; c\'est le comportement attendu.',
    '- ajouter_natinfs refuse les codes inconnus du référentiel : vérifie d\'abord avec natinf_chercher (par code ou par mots du libellé).',
    '- Description vivante : quand un dossier a évolué (nouveaux CR, documents/actes téléversés) et que sa description ne reflète plus l\'état réel, réécris-la (actualiser_description) — le service la tient d\'ailleurs à jour tout seul en fond, mais fais-le aussi dès que tu passes sur le dossier. FORMAT IMPOSÉ, en TEXTE BRUT (jamais d\'HTML ni de <br>), en DEUX PARTIES titrées EN MAJUSCULES : « SYNTHÈSE » — la vision GLOBALE des faits qui S\'ENRICHIT et se REFORMULE au fil du temps (qualification, mode opératoire, LIEUX, période, mesures en cours, échéances) ; puis « MIS EN CAUSE » — un par un les mis en cause ENREGISTRÉS du dossier (jamais inventés), chacun suivi des ÉLÉMENTS À CHARGE relevés contre lui. STYLE PRISE DE NOTES : rédigé à ~80 %, mots inutiles et verbes de liaison retirés, phrases nominales courtes, mais clair pour un collègue qui découvre le dossier. On repart de l\'existant et on le fait progresser — l\'ancienne version est archivée, rien n\'est perdu.',
    '- Dossiers d\'instruction : l\'architecture NPP importée (cotes_lire) te donne le sens et l\'ordre du dossier — ce qui a été fait, par section (Fond, Audience, CJ/détention…). Si elle manque pour un travail qui l\'exige, demande au magistrat de la coller (il l\'exporte de NPP) puis cotes_enregistrer. La chronologie fusionnée est dans chronologie_lire.',
    '- NPP et Cassiopée ne concernent QUE les dossiers À L\'INSTRUCTION — jamais une enquête préliminaire — et tu n\'y as AUCUN accès : ne l\'invente jamais. Un acte antérieur qui manque à une préliminaire n\'a simplement pas été téléversé.',
    '- Dossiers dormants : lister_dossiers marque dormant:true selon le seuil de l\'alerte « dossier sans CR » configurée dans SIRAL (seuilSansCR) — ne jamais substituer ton propre délai. Un dossier neuf, sans CR mais récent, n\'est PAS dormant.',
    '- Les DML relèvent des dossiers À L\'INSTRUCTION (détention provisoire) : la zone DML et les projets de réponse à DML ne concernent que ces dossiers-là — jamais une enquête préliminaire.',
    '',
    'DÉTECTION → PROPOSITION (✓/✗ du magistrat) — règle stricte :',
    'Quand tu LIS une pièce (document, PV, CR) et que tu y détectes du nouveau, tu ne l\'écris JAMAIS directement au dossier — tu déposes une proposition que le magistrat valide ou refuse d\'un clic :',
    '- nom nouveau (absent des mis en cause) → proposer_mec, avec rôle supposé et pièce source. Le dédoublonnage est automatique mais vérifie d\'abord lire_dossier + propositions_en_attente.',
    '- demande d\'acte ou mesure évoquée (interception, géolocalisation, sonorisation… y compris à soumettre au JLD : statut autorisation_pending) → proposer_acte, entièrement pré-rempli.',
    '  CATÉGORIE D\'UN « AUTRE ACTE » (kind=autre, dans proposer_acte comme dans enregistrer_acte) : renseigne `type` avec la CLÉ EXACTE de la catégorie prédéfinie dès qu\'elle s\'applique (art76, imsi_donnees, imsi_interceptions, captation_images_public, captation_images_prive, sonorisation_prive, drone_public, drone_prive, captation_donnees_informatiques, activation_fixe, activation_mobile, infiltration) — la fiche légale (durée, autorisation, date de fin, plafond de prolongations) est alors pré-remplie comme dans la fenêtre « Ajouter un acte ». Une demande d\'ordonnance JLD ou une perquisition en enquête préliminaire = art76. N\'écris un libellé libre que si AUCUNE catégorie ne convient (ex. comparution art. 78).',
    '- éléments nouveaux à consigner (véhicule, adresse, ligne, événement) → proposer_cr en prise de notes courte.',
    '- lien de renseignement entre deux personnes repéré dans une pièce (communications récurrentes, fratrie, fournisseur/logistique) et absent de la carte → proposer_lien (vérifie carto_lister_liens avant). Enrichit la cartographie une fois validé.',
    'RÉFLEXE « chaque pièce fait avancer le dossier » — quand tu exploites un PV, MOISSONNE tout ce qu\'il apporte de NOUVEAU par rapport au dossier, avant de clore :',
    '  • proposer_cr — un mini-CR daté portant les ÉLÉMENTS NOUVEAUX SEULEMENT (lieux, personnes, véhicules, lignes, événements datés), jamais un redit de l\'existant, en prise de notes courte et factuelle. Cite le PV source.',
    '  • proposer_mec — pour toute personne NOUVELLEMENT mise en cause dans le PV et absente des mis en cause (rôle supposé + pièce source). JAMAIS un simple témoin, victime, requérant ou tiers cité : uniquement une personne présentée comme impliquée dans les faits.',
    '  • actualiser_description — reprends la description et fais-la PROGRESSER, dans son FORMAT en deux parties (« SYNTHÈSE » globale qui s\'enrichit ; « MIS EN CAUSE » enregistrés + éléments à charge), en PRISE DE NOTES. LIEUX et PERSONNES en priorité. Actualisation synthétique, pas un journal exhaustif : l\'ancienne version est archivée.',
    '  Ainsi le dossier n\'est jamais en retard sur les actes : sa description et ses CR reflètent l\'état réel à chaque mesure préparée.',
    'La règle : ce que tu DÉTECTES se PROPOSE (✓/✗) ; ce que ta consigne DEMANDE se FAIT.',
    '',
    'DOSSIER COMPLET (module instruction) : le magistrat peut verser tout ou partie du dossier réel en TEXTE, pochettes comprises — l\'arborescence (Dossier/…) reflète l\'organisation du dossier papier/NPP. Méthode de dépouillement : dossier_arborescence (table des matières) → lecture CIBLÉE (lire_document sur les pièces utiles, pas tout systématiquement) → pour un dépouillement massif (synthèse générale, préparation de réquisitoire, recherche transversale), sous_agents avec un lot par pochette. Chaque affirmation cite la pièce (son chemin).',
    '',
    'SOUS-AGENTS (sous_agents) — travail en parallèle : pour un LOT de sous-tâches indépendantes (analyser chaque PDF d\'un dossier, balayer chaque dossier d\'une routine, évaluer chaque trame), délègue à des sous-agents plutôt que de tout faire séquentiellement. Une tâche = un titre + une consigne AUTONOME (le sous-agent ne voit pas ton contexte : numéro de dossier, chemin du document, ce que tu attends, format de réponse). Les sous-agents sont en LECTURE SEULE : c\'est TOI qui écris et proposes à partir de leurs analyses. N\'y recours pas pour une tâche unique ou des étapes dépendantes.',
    '',
    'TRAVAIL DE MASSE (dépouiller un dossier entier, chercher une adresse / une ligne / un nom dans les pièces de TOUS les dossiers, croiser plusieurs affaires, remplir la cartographie) :',
    '1. LOCALISE D\'ABORD (zéro jeton, immédiat, exhaustif) : registre_recouper (entités partagées entre dossiers : téléphones, plaques, IBAN, ADRESSES, personnes — avec les pièces des deux côtés ; `entite` pour UNE valeur précise dans TOUS les registres), registre_lire, pieces_chercher — avec numero pour un dossier, SANS numero pour TOUT le fonds (enquêtes archivées, instructions, documents de la carte ; familles d\'indices en un appel : « a OU b OU \"expression exacte\" » ; suis curseurSuivant jusqu\'à « fin »). Une adresse, une plaque, un numéro se cherchent LÀ — jamais en relisant les PV un par un.',
    '2. PUIS LIS EN ENTIER ce qui a été localisé (lire_document, dossier_global pour un dossier complet) — un extrait ne suffit pas à conclure. Pour paralléliser, sous_agents (un par dossier, consigne autonome).',
    '3. NE CONCLUS JAMAIS SUR UN ÉCHANTILLON : va au bout du parcours. Si la conversation ne suffit vraiment pas, dis précisément ce qui est couvert et ce qui reste (dossiers, curseur) pour reprendre.',
    'ARCHIVES ET GROS STOCK — rien n\'est hors de ta portée : lister_dossiers est PAGINÉ et FILTRABLE. portee:"archives" rend les dossiers archivés SEULS, portee:"toutes" l\'ensemble, `filtre` cherche un numéro / un nom / un objet, offset-limit déroulent les pages (la réponse dit combien il reste et à quel offset reprendre). Ne conclus JAMAIS qu\'une population de dossiers est inaccessible : déroule les pages.',
    '- TABLEURS (Excel) : les classeurs .xlsx/.xls/.ods se LISENT comme le reste (lire_document) : chaque feuille arrive en tableau markdown. Exploite-les comme des données (totaux, recoupements, anomalies) et cite la feuille et la ligne ; un classeur tronqué l\'est avec mention du nombre de lignes non affichées.',
    '',
    'CARTOGRAPHIE — aide à voir les connexions : carto_analyser donne les figures centrales, les ponts entre affaires et les co-occurrences. carto_rapprochements repère les entités partagées (téléphone, plaque, IBAN, adresse) entre dossiers SANS mis en cause commun — des ponts inédits entre affaires : pour chacun de pertinent, propose un lien de renseignement entre un MEC de chaque dossier (proposer_lien, entité en source). Écarte les faux positifs (numéro de service, banque). Suggère, ne trace jamais d\'office.',
    'ANALYSE TRANSVERSALE DE RENSEIGNEMENT (« analyse tous les dossiers et trouve les liens cachés » — sur demande ou en routine) : le but est de révéler l\'architecture plus grande derrière les dossiers, à partir des SIGNAUX FAIBLES qui ne sont PAS dans les listes de mis en cause — surnoms, personnes au second plan jamais mises en cause, adresses, plaques, téléphones, comptes récurrents d\'une affaire à l\'autre (typiquement : plusieurs dossiers gravitant autour d\'un même détenu de maison d\'arrêt). MÉTHODE :',
    '1. carto_corpus — le corpus complet : toutes les enquêtes (archivées comprises) ET tous les dossiers d\'instruction, avec pièces. C\'est ta liste de dépouillement.',
    '2. registre_recouper D\'ABORD (zéro jeton) : les entités présentes dans au moins deux dossiers — téléphones, plaques, IBAN, adresses, personnes — extraites du texte de TOUTES les pièces versées, chaque côté cité avec ses pièces. C\'est la carte des liens cachés dans la masse ; vérifie ensuite chaque recoupement dans les pièces citées (lire_document).',
    '2 bis. Pour aller PLUS LOIN que le registre : pieces_chercher SANS numero sur les surnoms, noms et indices (en OU), jusqu\'à « fin », puis lecture intégrale des pièces localisées — sous_agents (un par dossier) pour paralléliser.',
    '3. Rassemble leurs remontées, recouper_personnes sur les noms/surnoms pour savoir qui est déjà connu (dossier réel ou carte), carto_lister_liens pour ne pas re-proposer un lien existant.',
    '4. PROPOSE, jamais d\'office : proposer_lien (personne↔personne reliées, entité ou communication en source) ; proposer_mec_carto (un suspect ou un SURNOM récurrent absent des dossiers — avec ses alias) ; proposer_dossier_carto (une grappe/architecture cachée — ex. « Réseau autour de X, détenu à la MA de Y, pivot de 6 affaires »). Chaque proposition cite ses pièces sources.',
    '5. Dépose AU FIL DE L\'EAU : une proposition déposée survit même si le run est interrompu — ne garde jamais tes trouvailles pour la fin. Le magistrat les valide une à une dans le panneau de revue de la carte.',
    'Sois exigeant sur la PERTINENCE (un numéro de service, une banque, une adresse de commissariat ne relient rien) et prudent sur l\'homonymie. Un signal faible n\'est une piste que recoupé.',
    '',
    'DISSIMULATION : tes écritures et CR sont signés du nom du magistrat — tu n\'existes nulle part dans les données partagées. Ne te désigne jamais (« Attaché IA », « assistant ») dans un CR, une description ou une note versée au dossier.',
    '',
    'APPRENTISSAGE CONTINU — tu t\'améliores d\'une intervention à l\'autre :',
    '- Ta MÉMOIRE (fin de ce prompt) est la distillation de ce que le magistrat exige de toi : conforme-toi y AVANT d\'agir. Une exigence déjà consignée ne doit JAMAIS être violée de nouveau, ni redemandée.',
    '- Quand le magistrat te CORRIGE — il refuse (✗) une proposition avec motif, reformule ce que tu as écrit, répète une consigne déjà donnée — tire la LEÇON GÉNÉRALE réutilisable et consigne-la (memoire_noter, section « Pièges à éviter » ou « Exigences du magistrat »). La règle, pas l\'anecdote ; jamais un doublon d\'une ligne existante ; jamais de banalité.',
    '- Tes signaux d\'expérience (propositions ✓/✗ avec leur motif, leçons notées, rejets) sont captés automatiquement puis CONSOLIDÉS périodiquement par un run dédié qui réécrit ta mémoire sous un budget strict et propose au magistrat les révisions de ses méthodes et des instructions du projet Claude web (proposer_trame / proposer_skill / proposer_instructions_projet). L\'étude du corpus des actes signés et des ordonnances JLD téléversés (zones Actes et DML) en tire tes trames « modele-* », que Claude web lit pour rédiger. apprentissage_bilan montre les signaux en attente et ta progression mesurée.',
    ...(consignes ? [
      '',
      '--- CONSIGNES PERMANENTES DU MAGISTRAT (rédigées par lui dans Paramètres → Attaché IA ; elles complètent les règles ci-dessus sans jamais lever les règles de gouvernance) ---',
      consignes,
    ] : []),
    ...(skills ? [skills] : []),
    ...(kb ? [kb] : []),
    '',
    '--- MÉMOIRE DISTILLÉE (tenue par toi, consolidée périodiquement sous budget, lisible et corrigeable par le magistrat) ---',
    memory,
  ].join('\n')
}

// ── Transcripts chiffrés des conversations ──

export function readConversation(keys, id) {
  if (!/^[\w-]+$/.test(id)) return null
  const env = readEnvelopeFile(path.join('conversations', id + '.json'))
  if (!env) return null
  try { return decryptJson(keys.global, env) } catch { return null }
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
          SIRAL_ATTACHE_RUN: process.env.SIRAL_ATTACHE_RUN || 'autre',
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
 *  - runLabel    : nature du run — 'description', 'mec', 'flux', 'carto', 'routine:…'… (audit, consommation)
 *  - onEvent     : callback({type, ...}) — delta de texte, outil, fin
 *  - model       : modèle pour CE run (sinon config persistée, sinon env, sinon défaut CLI)
 *  - effort      : niveau d'effort pour CE run (low|medium|high|xhigh|max)
 *  - timeoutMs   : plafond de durée du run (défaut RUN_TIMEOUT_MS) — les analyses
 *                  de lot (trames, base de connaissances) en demandent un plus large
 *  - mcpToolTimeoutMs : plafond d'UN appel d'outil MCP côté CLI (défaut 20 min) —
 *                  à élargir quand l'appel sous_agents traite un gros lot
 *  - maxTurns    : plafond de tours pour CE run (borné au plafond global) — les
 *                  runs courts par nature (consolidation d'apprentissage) le
 *                  resserrent pour ne pas laisser filer les jetons
 * @returns {Promise<{convId, text, ok, error?}>}
 */
export async function runAgent({ keys, prompt, convId, title, runLabel = 'autre', onEvent = () => {}, model, effort, timeoutMs, mcpToolTimeoutMs, maxTurns: maxTurnsOpt }) {
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
  // Mode économe : on resserre le plafond de tours du run principal (moins
  // d'allers-retours = moins de jetons), sans descendre sous un minimum utile.
  let maxTurns = cfg.econome ? Math.min(MAX_TURNS, 24) : MAX_TURNS
  if (Number.isFinite(maxTurnsOpt) && maxTurnsOpt >= 4) maxTurns = Math.min(maxTurns, Math.floor(maxTurnsOpt))
  // Recherche web autorisée par le magistrat : WebSearch/WebFetch sortent de
  // la liste noire et entrent dans la liste blanche — rien d'autre ne bouge.
  const allowedTools = cfg.webAccess ? [ALLOWED_TOOLS, ...WEB_TOOLS].join(',') : ALLOWED_TOOLS
  const disallowedTools = cfg.webAccess
    ? DISALLOWED_TOOLS.split(',').filter((t) => !WEB_TOOLS.includes(t)).join(',')
    : DISALLOWED_TOOLS

  // Config MCP PAR RUN (fichier dédié, retiré en fin de run) : des runs
  // concurrents ne se marchent pas dessus.
  const mcpConfig = writeMcpConfig({}, `mcp-config-${id}.json`)

  // Reprise de session — CORRECTIF « Session ID … already in use ».
  // Une conversation n'existe QUE si un run précédent a déjà lancé le CLI avec
  // --session-id : côté CLI la session est donc DÉJÀ créée, même si ce run a
  // ÉCHOUÉ (timeout, mémoire, max-turns — cas courant d'une analyse
  // transversale lourde). La relancer avec --session-id sur le MÊME identifiant
  // échoue alors sur « Session ID … already in use » (le symptôme rapporté), et
  // la conversation reste coincée à chaque message suivant. Règle : une
  // conversation existante se REPREND (--resume) ; on ne (re)claime un
  // --session-id que pour une conversation NEUVE, ou quand la session a disparu
  // (needsFreshSession, armé plus bas après un --resume introuvable) — avec un
  // identifiant NEUF pour ne pas retomber sur la collision.
  const reclaim = isNew || conv.needsFreshSession === true
  if (conv.needsFreshSession) {
    conv.claudeSessionId = crypto.randomUUID()
    conv.needsFreshSession = false
  }
  const sessionArgs = reclaim
    ? ['--session-id', conv.claudeSessionId]
    : ['--resume', conv.claudeSessionId]

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', mcpConfig,
    '--allowedTools', allowedTools,
    '--disallowedTools', disallowedTools,
    '--append-system-prompt', systemPrompt(keys),
    '--max-turns', String(maxTurns),
    ...(useModel ? ['--model', useModel] : []),
    ...(useEffort ? ['--effort', useEffort] : []),
    ...sessionArgs,
  ]

  const cwd = attacheDir('workdir')
  ensureDir(cwd)

  // Plafond de durée du run : par défaut RUN_TIMEOUT_MS, élargi pour les
  // analyses de lot. Le timeout d'UN appel d'outil MCP (sous_agents) doit
  // rester SOUS le plafond du run : ainsi un lot trop gros fait échouer
  // proprement l'appel d'outil (l'agent reçoit l'erreur et rend ce qu'il a)
  // au lieu d'un SIGKILL du run entier (qui remontait « code null »).
  const runTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : RUN_TIMEOUT_MS
  const toolTimeout = Number.isFinite(mcpToolTimeoutMs) && mcpToolTimeoutMs > 0
    ? mcpToolTimeoutMs
    : Number(process.env.MCP_TOOL_TIMEOUT || Math.max(0, runTimeout - 120_000) || 1_200_000)

  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env: {
        ...process.env,
        // Connexion à l'abonnement : jeton saisi dans l'app (chiffré au repos)
        // ou variable d'environnement. Absent, le CLI retombe sur la session
        // du volume claude-auth — qui, elle, expire.
        ...claudeAuthEnv(),
        SIRAL_ATTACHE_RUN: runLabel,
        // cf. MCP_OUTPUT_TOKENS : jamais de réponse d'outil déversée en fichier.
        MAX_MCP_OUTPUT_TOKENS: MCP_OUTPUT_TOKENS,
        // sous_agents peut travailler plusieurs minutes (lot de PDF, routine) :
        // le timeout d'outil MCP du CLI doit couvrir le lot entier.
        MCP_TOOL_TIMEOUT: String(toolTimeout),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Prompt par l'ENTRÉE STANDARD, jamais en argument : un argv unitaire est
    // plafonné à 128 Kio (E2BIG) — un dossier joint en entier le dépasse.
    child.stdin.on('error', () => {})
    child.stdin.end(String(prompt))

    let assistantText = ''
    let stderrTail = ''
    let settled = false
    let timedOut = false
    let runUsage = null

    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
    }, runTimeout)

    const finish = async (ok, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { fs.unlinkSync(mcpConfig) } catch { /* déjà retiré */ }
      // Refus d'authentification : le CLI ne RÉPOND pas, il refuse — sa ligne
      // « Not logged in · Please run /login » arrivait telle quelle dans le fil
      // comme si l'attaché avait parlé, et le magistrat, croyant dialoguer,
      // tapait « /login » (indisponible en headless). On la requalifie en
      // panne, avec le remède, et on n'archive pas la fausse réponse.
      const stderrCourt = stderrTail.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 300)
      let authEchec = false
      if (looksLikeAuthFailure(assistantText) || looksLikeAuthFailure(stderrCourt) || looksLikeAuthFailure(error)) {
        await noteAuthFailure(assistantText || stderrCourt || String(error || ''))
        authEchec = true
        ok = false
        error = AUTH_FAILURE_MESSAGE
        assistantText = ''
      } else if (ok) {
        await clearAuthFailure()
      }
      conv.messages.push({ role: 'user', text: String(prompt), at: new Date().toISOString(), run: runLabel })
      conv.messages.push({ role: 'assistant', text: assistantText || (error ? `⚠️ ${error}` : ''), at: new Date().toISOString() })
      // Auto-guérison de la session CLI : si l'on a tenté un --resume et que le
      // CLI ne RETROUVE PAS la session (jamais créée à cause d'un échec très
      // précoce, ou transcript illisible), on repart d'un identifiant neuf au
      // prochain message (--session-id) — la conversation ne reste jamais
      // coincée. Une collision « already in use » n'a, elle, pas besoin de
      // traitement : la session existe et le prochain message la reprend
      // (--resume, comportement par défaut ci-dessus).
      if (!ok && !reclaim && /no conversation found|no session found|session .*not found|could not resume|failed to resume/i.test(`${error || ''} ${stderrTail}`)) {
        conv.needsFreshSession = true
      }
      conv.resumable = ok || conv.resumable // une session entamée reste reprenable
      conv.updatedAt = new Date().toISOString()
      try { await saveConversation(keys, conv) } catch {}
      // `replace` : la ligne déjà streamée au panneau n'est pas une réponse
      // (refus d'authentification) — le client doit l'effacer, pas la garder.
      onEvent({ type: 'done', convId: id, ok, error, replace: authEchec })
      // `usage` : le bilan de jetons du run, pour les appelants qui tiennent
      // un compteur par objet — le relevé global par catégorie
      // (recordUsage) reste inchangé.
      resolve({ convId: id, text: assistantText, ok, error, replace: authEchec, usage: runUsage })
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
          // Bilan de jetons du run (consommés que le run réussisse ou non).
          const usage = extractUsage(ev)
          if (usage) { recordUsage({ run: runLabel, model: useModel, usage }); runUsage = usage }
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
    child.on('close', (code, signal) => {
      if (settled) return
      const tail = stderrTail.split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 500)
      if (timedOut) {
        // On a nous-mêmes tué le run au bout de runTimeout : message explicite
        // (auparavant remonté comme un cryptique « code null »).
        return finish(false, `délai dépassé (${Math.round(runTimeout / 60_000)} min) — le run a été interrompu avant de finir. Relancez sur un lot plus petit, ou activez le mode économe.`)
      }
      if (code === 0) return finish(true)
      if (code === null) {
        // Tué par un signal sans code (hors notre timeout) : quasi toujours
        // un OOM (mémoire insuffisante pour le lot, surtout en parallèle).
        return finish(false, `claude interrompu par un signal (${signal || 'inconnu'}) — mémoire probablement insuffisante pour un lot de cette taille. Réduisez le lot ou activez le mode économe.${tail ? ' — ' + tail : ''}`)
      }
      finish(false, `claude s'est arrêté (code ${code})${tail ? ' — ' + tail : ''}`)
    })
  })
}

/**
 * Test de santé du CLI. `claude --version` répond même NON CONNECTÉ : le
 * panneau annonçait donc « Claude Code OK » pendant que chaque échange était
 * refusé. On y joint l'état de l'authentification (jeton in-app, variable
 * d'environnement, session du volume claude-auth, dernier refus constaté) —
 * `ok` ne vaut vrai que si le binaire répond ET que la connexion tient.
 */
export function checkClaudeCli() {
  return new Promise((resolve) => {
    const auth = claudeAuthStatus()
    const child = spawn(CLAUDE_BIN, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const done = (binaire) => resolve({
      ok: binaire.ok && auth.connecte,
      binaire: binaire.ok,
      version: binaire.version,
      error: binaire.ok ? (auth.connecte ? undefined : auth.raison) : binaire.error,
      auth,
    })
    const timer = setTimeout(() => { try { child.kill() } catch {}; done({ ok: false, error: 'timeout' }) }, 15_000)
    child.stdout.on('data', (c) => { out += c.toString() })
    child.on('error', (e) => { clearTimeout(timer); done({ ok: false, error: e.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      done(code === 0 ? { ok: true, version: out.trim() } : { ok: false, error: 'code ' + code })
    })
  })
}

/**
 * Test RÉEL de la connexion à l'abonnement : un tour minuscule, sans MCP ni
 * outils (« ping »). Le seul moyen sûr de distinguer « le CLI répond » de
 * « le CLI est connecté » — l'heuristique de claudeAuthStatus ne voit pas un
 * jeton révoqué côté serveur.
 */
export function testClaudeAuth() {
  ensureDir(attacheDir('workdir'))
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, [
      '-p', 'ping',
      '--max-turns', '1',
      // aucune capacité : la liste blanche ne désigne rien d'existant
      '--allowedTools', 'mcp__aucun__*',
      '--disallowedTools', DISALLOWED_TOOLS,
    ], {
      cwd: attacheDir('workdir'),
      env: { ...process.env, ...claudeAuthEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {}; resolve({ ok: false, error: 'délai dépassé (60 s)' }) }, 60_000)
    child.stdout.on('data', (c) => { out += c.toString('utf8').slice(0, 2000) })
    child.stderr.on('data', (c) => { err += c.toString('utf8').slice(0, 2000) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: `CLI claude introuvable : ${e.message}` }) })
    child.on('close', async (code) => {
      clearTimeout(timer)
      const texte = `${out} ${err}`.trim().slice(0, 400)
      if (looksLikeAuthFailure(out.trim()) || looksLikeAuthFailure(err.trim())) {
        await noteAuthFailure(texte)
        return resolve({ ok: false, auth: false, error: AUTH_FAILURE_MESSAGE, detail: texte })
      }
      if (code === 0) {
        await clearAuthFailure()
        return resolve({ ok: true, auth: true, reponse: out.trim().slice(0, 200) })
      }
      resolve({ ok: false, error: `claude s'est arrêté (code ${code})${texte ? ' — ' + texte : ''}` })
    })
  })
}

