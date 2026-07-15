#!/usr/bin/env node
/**
 * SIRAL — Attaché de justice · serveur MCP (le « bras »).
 *
 * Lancé par le CLI Claude Code (stdio, JSON-RPC ligne à ligne). Expose à
 * l'agent les SEULES actions autorisées sur SIRAL : lecture des dossiers du
 * contentieux confié, écritures réversibles (acte, prolongation, note, todo),
 * boîte mail dédiée, mémoire, fil proactif, et l'unique sortie possible —
 * un mail à l'adresse du magistrat. Chaque appel est journalisé (audit).
 *
 * Aucune autre capacité : pas de shell, pas de fichiers, pas de réseau.
 */
import readline from 'node:readline'
import crypto from 'node:crypto'
import { loadKeyring } from './attache/keyring.mjs'
import { attacheContentieux } from './attache/store.mjs'
import { audit, publishFeed } from './attache/journal.mjs'
import {
  listEnquetes, dossierMarkdown, readDocumentText, verifierCompletude,
  enregistrerActe, acterProlongation, classerNote, ajouterTodo, listerDml,
  actualiserDescription, diagnostiquerDossier, arborescenceDocuments,
} from './attache/dossier.mjs'
import { publishItems, ITEM_TYPES } from './attache/majordome.mjs'
import { saveArchitecture, loadArchitecture, buildChronologie } from './attache/cotes.mjs'
import { saveTrame, listTrames, readTrame, setTrameDescription } from './attache/trames.mjs'
import { saveSkill, listSkills, readSkill } from './attache/skills.mjs'
import { saveKbEntry, listKb, readKbEntry, searchKb, KB_CATEGORIES } from './attache/kb.mjs'
import { runSubagents } from './attache/subagents.mjs'
import { listInstructionDossiers, instructionDossierMarkdown } from './attache/instru.mjs'
import { listDepot, readDepotText, rangerDocument, ecarterDepot, ZONES } from './attache/depot.mjs'
import { addProposition, listPropositions } from './attache/propositions.mjs'
import { readDossierMemory, appendDossierMemory } from './attache/dossierMemory.mjs'
import { analyserReseau, listerLiens, rapprochementsInterDossiers } from './attache/carto.mjs'
import { saveProduction, listProductions, readProduction, deleteProduction, PRODUCTION_TYPES } from './attache/productions.mjs'
import { appendMemory } from './attache/memory.mjs'
import { listInbox, readInboxMessage, markInboxProcessed, sendToOwner } from './attache/mail.mjs'

const keys = loadKeyring()
const runContext = process.env.SIRAL_ATTACHE_RUN || 'chat'
// Mode sous-agent : lancé par l'outil sous_agents — LECTURE SEULE (aucun
// outil d'écriture, pas de sous_agents imbriqué : pas de récursion possible).
const IS_SUBAGENT = process.env.SIRAL_ATTACHE_SUBAGENT === '1'

// ── Définition des outils ──
const TOOLS = [
  {
    name: 'lister_dossiers',
    description: `Liste compacte des dossiers du contentieux ${attacheContentieux()} (numéro, objet, statut, volumes). Point de départ pour s'orienter.`,
    inputSchema: { type: 'object', properties: { archives: { type: 'boolean', description: 'Inclure les dossiers archivés' } } },
    handler: async (a) => listEnquetes(keys, { includeArchived: Boolean(a?.archives) }),
  },
  {
    name: 'lire_dossier',
    description: 'Dossier complet en markdown. Enquête du contentieux : objet, mis en cause, actes (id + statut), à-faire, documents, CR chronologiques. Si le numéro correspond à un dossier d\'INSTRUCTION du module instruction (n° instruction ou n° parquet), le rend aussi : saisine, mis en examen (détention, DML), débats JLD, opérations, chronologie.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => dossierMarkdown(keys, a.numero)
      ?? instructionDossierMarkdown(keys, a.numero)
      ?? { erreur: `Dossier ${a.numero} introuvable — voir lister_dossiers (enquêtes) et instru_lister (instruction)` },
  },
  {
    name: 'instru_lister',
    description: 'Dossiers d\'INSTRUCTION du module instruction (cabinets suivis par le magistrat) : numéros, juge, mis en examen (détenus comptés), DML EN ATTENTE (avec échéance à +10 jours), débats JLD à venir (réquisitions rédigées ou non). Point de départ pour toute DML, préparation de débat ou anticipation d\'échéance. Détail : lire_dossier avec le n° d\'instruction ou de parquet.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listInstructionDossiers(keys),
  },
  {
    name: 'lire_document',
    description: 'Texte intégral d\'un document déposé sous un numéro de dossier — enquête OU instruction (PDF/TXT/MD/HTML). `chemin` = cheminRelatif exact (voir lire_dossier ou dossier_arborescence), y compris les pièces du « Dossier complet » versé (Dossier/…).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, chemin: { type: 'string' } }, required: ['numero', 'chemin'] },
    handler: async (a) => readDocumentText(keys, a.numero, a.chemin),
  },
  {
    name: 'dossier_arborescence',
    description: 'Table des matières de TOUTES les pièces déposées sous un numéro (enquête ou instruction) : zones Geoloc/Ecoutes/Actes/PV/DML et « Dossier complet » versé (Dossier/… — les sous-pochettes reflètent l\'organisation du dossier réel, en texte). Chemins exacts pour lire_document. Point de départ de tout dépouillement.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => arborescenceDocuments(a.numero),
  },
  {
    name: 'verifier_completude',
    description: 'Contrôle factuel d\'un dossier : actes expirés ou expirant sous 7 jours, attentes JLD, CR anciens, documents manquants, à-faire ouverts.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => verifierCompletude(keys, a.numero) ?? { erreur: 'Dossier introuvable' },
  },
  {
    name: 'enregistrer_acte',
    description: 'Enregistre un nouvel acte au dossier (écriture réversible et versionnée). kind: ecoute | geolocalisation | autre. statut: en_cours | autorisation_pending (demande JLD en attente). duree + dureeUnit (jours|mois) calculent la date de fin.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' }, kind: { type: 'string', enum: ['ecoute', 'geolocalisation', 'autre'] },
        dateDebut: { type: 'string', description: 'AAAA-MM-JJ (défaut : aujourd\'hui)' },
        duree: { type: 'number' }, dureeUnit: { type: 'string', enum: ['jours', 'mois'] },
        cible: { type: 'string', description: 'Ligne/personne visée (écoute)' },
        objet: { type: 'string', description: 'Objet suivi (géolocalisation)' },
        type: { type: 'string', description: 'Nature (autre acte) : sonorisation, perquisition…' },
        description: { type: 'string' },
        statut: { type: 'string', enum: ['en_cours', 'autorisation_pending'] },
      },
      required: ['numero', 'kind'],
    },
    handler: async (a) => enregistrerActe(keys, a),
    write: true,
  },
  {
    name: 'acter_prolongation',
    description: 'Prolongation d\'un acte (id visible dans lire_dossier). mode "demande" = soumise au JLD (statut en attente) ; mode "validee" = accordée (étend la date de fin, historisée).',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' }, acteId: { type: 'number' },
        mode: { type: 'string', enum: ['demande', 'validee'] },
        duree: { type: 'number' }, dureeUnit: { type: 'string', enum: ['jours', 'mois'] },
      },
      required: ['numero', 'acteId', 'mode'],
    },
    handler: async (a) => acterProlongation(keys, a),
    write: true,
  },
  {
    name: 'classer_note',
    description: 'Classe une note ou synthèse au dossier, comme compte-rendu signé « Attaché IA » — visible dans la chronologie de l\'enquête.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, titre: { type: 'string' }, contenu: { type: 'string' } }, required: ['numero', 'contenu'] },
    handler: async (a) => classerNote(keys, a),
    write: true,
  },
  {
    name: 'ajouter_todo',
    description: 'Ajoute une tâche « à faire » au dossier (rappel visible du magistrat).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, texte: { type: 'string' } }, required: ['numero', 'texte'] },
    handler: async (a) => ajouterTodo(keys, a),
    write: true,
  },
  {
    name: 'boite_lister',
    description: 'Liste la boîte mail dédiée (messages transférés par le magistrat) : id, expéditeur, sujet, traité ou non.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listInbox(keys),
  },
  {
    name: 'boite_lire',
    description: 'Lit un message de la boîte : consigne du magistrat (corps du transfert), texte du mail d\'origine, liste des pièces jointes.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (a) => {
      const rec = readInboxMessage(keys, a.id)
      if (!rec) return { erreur: 'Message introuvable' }
      return { ...rec, attachments: (rec.attachments || []).map(({ b64, ...meta }) => meta) }
    },
  },
  {
    name: 'boite_marquer_traite',
    description: 'Marque un message comme traité, avec un résumé d\'une phrase de ce qui a été fait.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, resume: { type: 'string' } }, required: ['id', 'resume'] },
    handler: async (a) => ({ ok: await markInboxProcessed(keys, a.id, a.resume) }),
    write: true,
  },
  {
    name: 'envoyer_a_mon_magistrat',
    description: 'Envoie un projet (synthèse, trame de réquisition, projet de réponse) par mail au magistrat — UNIQUE destinataire possible, câblé côté serveur. À utiliser pour tout ce qu\'il devra relire ou renvoyer lui-même.',
    inputSchema: { type: 'object', properties: { sujet: { type: 'string' }, corps: { type: 'string' } }, required: ['sujet', 'corps'] },
    handler: async (a) => sendToOwner(keys, a),
    write: true,
  },
  {
    name: 'memoire_noter',
    description: 'Consigne un enseignement durable dans la mémoire (préférence du magistrat, réflexe, consigne). section: "Préférences du magistrat" | "Réflexes appris" | "Consignes permanentes".',
    inputSchema: { type: 'object', properties: { section: { type: 'string' }, note: { type: 'string' } }, required: ['section', 'note'] },
    handler: async (a) => ({ ajoute: await appendMemory(keys, a.section, a.note, 'attache-ia') }),
    write: true,
  },
  {
    name: 'memoire_dossier_lire',
    description: 'Lit la mémoire légère du dossier : l\'essentiel des échanges passés du chat (ce que le magistrat a dit, décidé, découvert). À consulter au début d\'une conversation sur un dossier.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => ({ memoire: readDossierMemory(keys, a.numero) || '(vide)' }),
  },
  {
    name: 'memoire_dossier_noter',
    description: 'Ajoute UNE ligne télégraphique à la mémoire du dossier — seulement quand un échange apporte du neuf (décision du magistrat, orientation, élément découvert). Court et factuel : la mémoire est volontairement petite (plafonnée). Ne pas noter les banalités.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, note: { type: 'string' } }, required: ['numero', 'note'] },
    handler: async (a) => appendDossierMemory(keys, a.numero, a.note),
    write: true,
  },
  {
    name: 'diagnostic_dossier',
    description: 'Diagnostic objectif d\'un dossier pour l\'aide au contrôle et à la maîtrise : délais (ancienneté, durée cumulée de chaque acte avec prolongations, jours avant échéance, ancienneté des attentes JLD), cohérence (actes expirés encore « en cours », demandes JLD qui traînent), éparpillement (diversité des cibles rapportée aux mis en cause), cadence des CR. `cadre` distingue préliminaire (délais TSE serrés — 2 mois typiques) et instruction. Interpréter ces chiffres à l\'aune du droit et de la direction d\'enquête.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => diagnostiquerDossier(keys, a.numero) ?? { erreur: 'Dossier introuvable' },
  },
  {
    name: 'actualiser_description',
    description: 'Réécrit la description (« objet ») du dossier : vision à l\'instant T, derniers CR et documents intégrés. FORMAT prise de notes, catégorisé puis chronologique : FAITS / MEC / ACTES EN COURS / ATTENTION / CHRONO (tournants seulement) / MAJ JJ-MM-AA. Complet mais synthétique — efficacité et accessibilité avant tout. L\'ancienne description est ARCHIVÉE (jamais perdue).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, description: { type: 'string' } }, required: ['numero', 'description'] },
    handler: async (a) => actualiserDescription(keys, a),
    write: true,
  },
  {
    name: 'cotes_enregistrer',
    description: 'Enregistre l\'architecture d\'un dossier d\'instruction collée depuis NPP (arborescence des cotes A/B/C/D/E/G/S/Z). Un parseur structure chaque cote (section, libellé, dates). Base de la chronologie et de la compréhension du dossier — à demander au magistrat quand elle manque.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, texte: { type: 'string', description: 'L\'arborescence NPP brute, collée telle quelle' } }, required: ['numero', 'texte'] },
    handler: async (a) => saveArchitecture(keys, a.numero, a.texte),
    write: true,
  },
  {
    name: 'cotes_lire',
    description: 'Relit l\'architecture NPP importée d\'un dossier : cotes structurées par section (Fond, Audience, CJ/détention, Personnalité…), libellés, dates. `section` (optionnel) filtre sur une lettre (D, E, C…).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, section: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => {
      const archi = loadArchitecture(keys, a.numero)
      if (!archi) return { erreur: 'Aucune architecture importée pour ce dossier — demander au magistrat de la coller (NPP)' }
      const entries = a.section
        ? archi.entries.filter((e) => e.lettre === String(a.section).toUpperCase()[0])
        : archi.entries
      return { reference: archi.reference, importeLe: archi.importeLe, nbCotes: archi.nbCotes, entries: entries.slice(0, 4000) }
    },
  },
  {
    name: 'chronologie_lire',
    description: 'Chronologie probatoire fusionnée du dossier : actes SIRAL (débuts, fins, prolongations, poses, attentes JLD), CR, modifications (apparition de MEC), DML archivées et cotes NPP datées — triée par date. Base de tout réquisitoire, rapport ou préparation d\'audience.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => buildChronologie(keys, a.numero) ?? { erreur: 'Dossier introuvable' },
  },
  {
    name: 'produire_document',
    description: `Rédige un ACTE et le range dans « Actes rédigés » du dossier (le magistrat le visionne, l'édite, le glisse vers son parapheur). Type : ${PRODUCTION_TYPES.join(', ')}. Suis la trame correspondante (trames_lister/trame_lire) et le dossier (lire_dossier, chronologie_lire). Rédaction complète, prête à signer, texte brut (paragraphes séparés par des lignes vides). Pour MODIFIER un acte existant, passe son id.`,
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' },
        id: { type: 'string', description: 'id d\'une production à mettre à jour (sinon nouvelle)' },
        type: { type: 'string', enum: PRODUCTION_TYPES },
        titre: { type: 'string' },
        contenu: { type: 'string', description: 'Le texte complet de l\'acte' },
        source: { type: 'string', description: 'Trame suivie (ex: requisition-tse)' },
      },
      required: ['numero', 'type', 'titre', 'contenu'],
    },
    handler: async (a) => saveProduction(keys, a),
    write: true,
  },
  {
    name: 'productions_lister',
    description: 'Liste les actes rédigés d\'un dossier (id, type, titre, dates) — pour retrouver un document à modifier.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => listProductions(keys, a.numero),
  },
  {
    name: 'production_lire',
    description: 'Lit le texte complet d\'un acte rédigé (pour le modifier ensuite avec produire_document en réutilisant son id).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, id: { type: 'string' } }, required: ['numero', 'id'] },
    handler: async (a) => readProduction(keys, a.numero, a.id) ?? { erreur: 'Acte introuvable' },
  },
  {
    name: 'production_supprimer',
    description: 'Supprime un acte rédigé (réversible : version archivée).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, id: { type: 'string' } }, required: ['numero', 'id'] },
    handler: async (a) => ({ ok: await deleteProduction(a.numero, a.id) }),
    write: true,
  },
  {
    name: 'trame_enregistrer',
    description: 'Enregistre ou met à jour une trame de rédaction du magistrat (plan-type de DML, réquisition, TSE, consignes de style). Versionnée à chaque réécriture. À utiliser quand le magistrat colle une trame ou dit « enregistre cette trame ».',
    inputSchema: { type: 'object', properties: { nom: { type: 'string', description: 'ex: reponse-dml, requisition-tse' }, contenu: { type: 'string' }, description: { type: 'string' } }, required: ['nom', 'contenu'] },
    handler: async (a) => saveTrame(keys, a),
    write: true,
  },
  {
    name: 'trames_lister',
    description: 'Liste les trames de rédaction disponibles. AVANT toute rédaction type (DML, réquisition, TSE, mail), vérifier ici s\'il existe une trame et la suivre.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listTrames(keys),
  },
  {
    name: 'trame_lire',
    description: 'Lit le contenu complet d\'une trame par son nom.',
    inputSchema: { type: 'object', properties: { nom: { type: 'string' } }, required: ['nom'] },
    handler: async (a) => readTrame(keys, a.nom) ?? { erreur: 'Trame inconnue — voir trames_lister' },
  },
  {
    name: 'trame_decrire',
    description: 'Met à jour la SEULE description d\'une trame (une phrase : type d\'acte, cadre juridique visé, quand l\'utiliser) — le contenu de la trame n\'est PAS touché. À utiliser pour classer les trames téléversées en masse.',
    inputSchema: { type: 'object', properties: { nom: { type: 'string' }, description: { type: 'string' } }, required: ['nom', 'description'] },
    handler: async (a) => setTrameDescription(keys, a.nom, a.description),
    write: true,
  },
  {
    name: 'kb_lister',
    description: 'Sommaire de la base de connaissances du magistrat (son fond documentaire : jurisprudences, circulaires, modes opératoires, fiches, contacts) : id, titre, catégorie, description — jamais le contenu. Le sommaire figure aussi dans ton prompt système.',
    inputSchema: { type: 'object', properties: { categorie: { type: 'string', description: 'Filtrer sur une catégorie' } } },
    handler: async (a) => {
      const all = listKb(keys)
      return a?.categorie ? all.filter((e) => e.categorie === String(a.categorie).toLowerCase()) : all
    },
  },
  {
    name: 'kb_chercher',
    description: 'Recherche plein-texte dans la base de connaissances (insensible casse/accents) : retourne les meilleures entrées avec un extrait autour de la première occurrence. Réflexe AVANT toute analyse juridique ou rédaction : chercher ici, puis kb_lire les entrées pertinentes.',
    inputSchema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'Mots-clés (ex: géolocalisation prolongation 230-33)' },
        categorie: { type: 'string' },
        limite: { type: 'number' },
      },
      required: ['requete'],
    },
    handler: async (a) => searchKb(keys, a),
  },
  {
    name: 'kb_lire',
    description: 'Charge le contenu complet d\'une entrée de la base de connaissances par son id. Cite l\'entrée (id) quand tu t\'appuies dessus.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (a) => readKbEntry(keys, a.id) ?? { erreur: 'Entrée inconnue — voir kb_lister / kb_chercher' },
  },
  {
    name: 'kb_enregistrer',
    description: `Enregistre ou met à jour une entrée de la base de connaissances (fond documentaire durable : extrait de jurisprudence, circulaire, mode opératoire, fiche, contacts). Catégories usuelles : ${KB_CATEGORIES.join(', ')} (champ libre). À utiliser quand le magistrat dit « ajoute à la base de connaissances » ou transmet un contenu de référence durable. Versionnée à chaque réécriture.`,
    inputSchema: {
      type: 'object',
      properties: {
        titre: { type: 'string' },
        categorie: { type: 'string' },
        description: { type: 'string', description: 'Une phrase : ce que contient l\'entrée et quand s\'en servir' },
        contenu: { type: 'string', description: 'Le contenu complet, en markdown' },
        source: { type: 'string', description: 'Provenance (fichier, référence, mail du magistrat…)' },
      },
      required: ['titre', 'categorie', 'contenu'],
    },
    handler: async (a) => saveKbEntry(keys, a),
    write: true,
  },
  {
    name: 'skills_lister',
    description: 'Liste les skills du magistrat (ses méthodes réutilisables, comme les skills Claude web) : nom, description, taille. La liste figure aussi dans ton prompt système.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listSkills(keys),
  },
  {
    name: 'skill_lire',
    description: 'Charge le contenu complet d\'une skill par son nom. À faire EN PREMIER dès qu\'une demande correspond à une skill listée — puis la suivre fidèlement.',
    inputSchema: { type: 'object', properties: { nom: { type: 'string' } }, required: ['nom'] },
    handler: async (a) => readSkill(keys, a.nom) ?? { erreur: 'Skill inconnue — voir skills_lister' },
  },
  {
    name: 'skill_enregistrer',
    description: 'Enregistre ou met à jour une skill du magistrat (méthode réutilisable : quoi faire et comment, en markdown). Versionnée à chaque réécriture. À utiliser quand il dit « enregistre cette skill » ou dicte une méthode durable. La description est CRUCIALE : c\'est elle qui dit quand appliquer la skill.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'ex: preparation-audience, analyse-telephonie' },
        description: { type: 'string', description: 'Une phrase : quand utiliser cette skill' },
        contenu: { type: 'string', description: 'La méthode complète, en markdown' },
      },
      required: ['nom', 'contenu'],
    },
    handler: async (a) => saveSkill(keys, a),
    write: true,
  },
  {
    name: 'proposer_mec',
    description: 'Propose un NOUVEAU mis en cause détecté dans un document/PV/mail — n\'écrit PAS directement : la proposition apparaît dans le dossier avec ✓/✗ pour l\'administrateur. Dédoublonnage automatique (nom déjà présent ou déjà proposé ⇒ refus). Toujours citer la source.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' }, nom: { type: 'string' },
        role: { type: 'string', description: 'Rôle supposé (fournisseur, logisticien…)' },
        statut: { type: 'string', description: 'Défaut : mis en cause' },
        source: { type: 'string', description: 'Pièce d\'où vient la détection (ex: PV D8092, mail du 12/07)' },
      },
      required: ['numero', 'nom', 'source'],
    },
    handler: async (a) => addProposition(keys, { numero: a.numero, type: 'mec', payload: { nom: a.nom, role: a.role, statut: a.statut }, source: a.source }),
    write: true,
  },
  {
    name: 'proposer_acte',
    description: 'Propose un acte détecté (demande d\'interception, de géolocalisation, autre mesure — y compris statut autorisation_pending pour une demande JLD). L\'acte est entièrement pré-construit mais N\'EST créé qu\'au ✓ de l\'administrateur. Mêmes champs qu\'enregistrer_acte + source.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' }, kind: { type: 'string', enum: ['ecoute', 'geolocalisation', 'autre'] },
        dateDebut: { type: 'string' }, duree: { type: 'number' }, dureeUnit: { type: 'string', enum: ['jours', 'mois'] },
        cible: { type: 'string' }, objet: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' },
        statut: { type: 'string', enum: ['en_cours', 'autorisation_pending'] },
        source: { type: 'string' },
      },
      required: ['numero', 'kind', 'source'],
    },
    handler: async (a) => {
      const { numero, source, ...payload } = a
      return addProposition(keys, { numero, type: 'acte', payload, source })
    },
    write: true,
  },
  {
    name: 'proposer_cr',
    description: 'Propose un compte-rendu rédigé en PRISE DE NOTES (nouveaux éléments : véhicule, adresse, ligne, demande d\'actes…) — court, télégraphique, efficace. Créé au dossier seulement au ✓ de l\'administrateur, SIGNÉ DE SON NOM (jamais de trace de l\'assistant).',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' },
        titre: { type: 'string' },
        contenu: { type: 'string', description: 'Prise de notes : « Nouveau VL : Clio GC-560-NP (MELLAH). Demande géoloc formulée par GIR. À suivre : retour opérateur. »' },
        date: { type: 'string', description: 'AAAA-MM-JJ (défaut : aujourd\'hui)' },
        source: { type: 'string' },
      },
      required: ['numero', 'contenu', 'source'],
    },
    handler: async (a) => {
      const { numero, source, ...payload } = a
      return addProposition(keys, { numero, type: 'cr', payload, source })
    },
    write: true,
  },
  {
    name: 'propositions_en_attente',
    description: 'Liste les propositions en attente de validation (évite les redondances : ne jamais re-proposer ce qui attend déjà).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } } },
    handler: async (a) => listPropositions(keys, { numero: a?.numero }).map(({ payload, ...meta }) => ({ ...meta, apercu: JSON.stringify(payload).slice(0, 200) })),
  },
  {
    name: 'carto_analyser',
    description: 'Analyse le réseau (cartographie) : figures centrales, « ponts » (personnes présentes dans plusieurs dossiers, qui relient des affaires), co-occurrences, nombre de liens de renseignement déjà tracés. Pour aider à voir les connexions et améliorer la visibilité. Interpréter : centralité, cloisonnements, liens manquants à tracer.',
    inputSchema: { type: 'object', properties: { archives: { type: 'boolean', description: 'Inclure les dossiers archivés' } } },
    handler: async (a) => { const r = analyserReseau(keys, { includeArchived: Boolean(a?.archives) }); delete r._liensExistantsKeys; return r },
  },
  {
    name: 'carto_rapprochements',
    description: 'Rapprochements inter-dossiers : entités (téléphone, plaque, IBAN, ADRESSE) présentes dans plusieurs dossiers qui ne partagent AUCUN mis en cause — donc des ponts potentiels entre affaires que rien ne reliait. Pour chaque rapprochement pertinent, proposer un lien de renseignement (proposer_lien) entre un MEC de chaque dossier, l\'entité partagée en source/label. Vérifie la pertinence (un numéro de service, une banque, ne relie rien).',
    inputSchema: { type: 'object', properties: { archives: { type: 'boolean' } } },
    handler: async (a) => rapprochementsInterDossiers(keys, { includeArchived: Boolean(a?.archives) }),
  },
  {
    name: 'carto_lister_liens',
    description: 'Liste les liens de renseignement déjà tracés sur la carte (person↔person), pour éviter de re-proposer un lien existant.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listerLiens(keys),
  },
  {
    name: 'proposer_lien',
    description: 'Propose un LIEN DE RENSEIGNEMENT entre deux personnes, détecté en lisant une pièce (communications récurrentes, lien familial, logistique…) et non encore tracé sur la carte. Créé sur la carte SEULEMENT au ✓ de l\'administrateur. Toujours citer la source. `numero` = dossier d\'où vient la détection (pour l\'affichage de la proposition).',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Dossier d\'où vient la détection' },
        sourceNom: { type: 'string' }, targetNom: { type: 'string' },
        label: { type: 'string', description: 'Nature du lien (ex: communications, fournisseur, fratrie)' },
        notes: { type: 'string' },
        source: { type: 'string', description: 'Pièce source (ex: PV D1808, retranscription du 12/07)' },
      },
      required: ['numero', 'sourceNom', 'targetNom', 'source'],
    },
    handler: async (a) => addProposition(keys, { numero: a.numero, type: 'lien', payload: { sourceNom: a.sourceNom, targetNom: a.targetNom, label: a.label, notes: a.notes }, source: a.source }),
    write: true,
  },
  {
    name: 'lister_dml',
    description: 'Liste les DML archivées d\'un dossier (zone DML de la section documents, plus récente en premier). Lire ensuite avec lire_document pour s\'appuyer sur leur structure et rédiger une version actualisée.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => listerDml(keys, a.numero),
  },
  {
    name: 'majordome_publier',
    description: `Publie des items dans le brief du magistrat (widget du tableau de bord). Types : ${ITEM_TYPES.join(', ')}. Un projet_mail N'EST JAMAIS envoyé : le magistrat le copie et l'envoie lui-même — rédiger le corps prêt à coller (destinataire = ex. « Directeur d'enquête — GIR Amiens »). Une verification = ce que SEUL le magistrat peut faire (consulter NPP/Cassiopée…). Un appel = { qui, motif }.`,
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ITEM_TYPES },
              titre: { type: 'string' },
              detail: { type: 'string' },
              dossier: { type: 'string', description: 'Numéro du dossier concerné' },
              echeance: { type: 'string', description: 'AAAA-MM-JJ si une date butoir existe' },
              mail: {
                type: 'object',
                properties: { destinataire: { type: 'string' }, objet: { type: 'string' }, corps: { type: 'string' } },
              },
              appel: {
                type: 'object',
                properties: { qui: { type: 'string' }, motif: { type: 'string' } },
              },
            },
            required: ['type', 'titre'],
          },
        },
      },
      required: ['items'],
    },
    handler: async (a) => ({ publies: await publishItems(keys, a.items) }),
    write: true,
  },
  {
    name: 'sous_agents',
    description: 'Délègue un LOT de sous-tâches INDÉPENDANTES à des sous-agents Claude exécutés EN PARALLÈLE (24 max par lot). Chaque tâche = { titre, consigne } — la consigne doit être AUTONOME (numéro de dossier, chemin du document, attendu, format de réponse) : le sous-agent ne voit pas ta conversation. Ils ont les mêmes outils de LECTURE que toi mais AUCUNE écriture : leurs analyses te reviennent, c\'est toi qui agis. Idéal : analyser chaque PDF d\'un dossier, balayer chaque dossier du brief, évaluer chaque trame d\'un lot. Inutile pour une tâche unique ou des étapes dépendantes.',
    inputSchema: {
      type: 'object',
      properties: {
        taches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              titre: { type: 'string', description: 'Étiquette courte (ex: dossier 24/123, PV D8092.pdf)' },
              consigne: { type: 'string', description: 'La sous-tâche complète et autonome' },
            },
            required: ['titre', 'consigne'],
          },
        },
        contexte: { type: 'string', description: 'Contexte commun donné à TOUS les sous-agents (optionnel)' },
        modele: { type: 'string', description: 'Modèle pour ce lot (sinon réglage « sous-agents » du panneau)' },
        effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
      },
      required: ['taches'],
    },
    handler: async (a) => {
      const results = await runSubagents(a)
      await audit(keys, 'sous_agents', {
        contexte: runContext,
        nb: results.length,
        ok: results.filter((r) => r.ok).length,
        titres: results.map((r) => r.titre).join(' · ').slice(0, 500),
      }).catch(() => {})
      return results
    },
  },
  {
    name: 'depot_lister',
    description: 'Pièces que le magistrat a CONFIÉES au dépôt (trombone du panneau) et qui attendent d\'être rangées : rel, nom d\'origine, taille, date. À vérifier quand il dit « je t\'ai déposé… » et au brief quotidien. Chaque pièce doit finir rangée (ranger_document) ou écartée (depot_ecarter).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listDepot(),
  },
  {
    name: 'depot_lire',
    description: 'Texte d\'une pièce ENCORE au dépôt (avant rangement) — pour identifier le dossier et la nature quand la consigne ne les dit pas : numéro cité, noms des mis en cause, type d\'acte.',
    inputSchema: { type: 'object', properties: { rel: { type: 'string' } }, required: ['rel'] },
    handler: async (a) => readDepotText(keys, a.rel),
  },
  {
    name: 'ranger_document',
    description: `Range une pièce dans la section documents du BON dossier (enquête ou instruction) — le magistrat te confie la pièce, TOI tu la classes. source "depot" (rel de depot_lister) ou "mail" (mailId + piece de boite_lire). zone : ${Object.keys(ZONES).join(' | ')} — audition/PV/garde à vue → pv ; ordonnance/réquisition/autorisation → actes ; DML et réponses → dml ; rapports de géolocalisation → geoloc ; retranscriptions d'interceptions → ecoutes. Donne un nom PROPRE et daté (ex: 2026-07-12_Audition_DUPONT). La pièce d'origine est conservée telle quelle (chiffrée) ; elle apparaît dans la fiche du dossier, signée du nom du magistrat. Après rangement : lis-la et déclenche tes détections (propositions).`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['depot', 'mail'] },
        rel: { type: 'string', description: 'source=depot : rel exact de depot_lister' },
        mailId: { type: 'string', description: 'source=mail : id du message' },
        piece: { type: 'string', description: 'source=mail : nom exact de la pièce jointe' },
        numero: { type: 'string', description: 'Dossier cible (enquête ou n° instruction/parquet)' },
        zone: { type: 'string', enum: Object.keys(ZONES) },
        nom: { type: 'string', description: 'Nom final, daté et explicite (extension d\'origine préservée)' },
      },
      required: ['source', 'numero', 'zone'],
    },
    handler: async (a) => rangerDocument(keys, a),
    write: true,
  },
  {
    name: 'depot_ecarter',
    description: 'Écarte une pièce du dépôt sans la ranger (doublon, pièce non pertinente) — déplacée en Corbeille/ du dépôt, jamais détruite. Dis toujours au magistrat pourquoi (signaler ou réponse en chat).',
    inputSchema: { type: 'object', properties: { rel: { type: 'string' } }, required: ['rel'] },
    handler: async (a) => ecarterDepot(a.rel),
    write: true,
  },
  {
    name: 'poser_question',
    description: 'Pose une question au magistrat DANS SIRAL : une carte « Question » apparaît dans son panneau avec une zone de réponse — sa réponse revient directement dans CETTE conversation (tu garderas tout ton contexte). C\'est l\'UNIQUE canal pour lui demander une information (jamais par mail). Pose une question PRÉCISE et autoporteuse (rappelle le dossier, ce que tu sais déjà, ce qui te manque). Ne bloque pas ton travail en attendant : termine ce qui peut l\'être, marque [À CONFIRMER] ce qui dépend de la réponse.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'La question, précise et autoporteuse (2-6 phrases max)' },
        numero: { type: 'string', description: 'Dossier concerné (optionnel, pour le contexte de la carte)' },
      },
      required: ['question'],
    },
    handler: async (a) => {
      await publishFeed(keys, {
        type: 'question',
        titre: a.numero ? `Question — dossier ${String(a.numero).slice(0, 60)}` : 'Question de votre attaché',
        resume: String(a.question).slice(0, 4000),
        numero: a.numero,
        convId: process.env.SIRAL_ATTACHE_CONV_ID || undefined,
        qid: crypto.randomBytes(8).toString('hex'),
      })
      return {
        ok: true,
        note: 'Question posée dans SIRAL. La réponse du magistrat arrivera comme un nouveau message dans cette conversation — n\'attends pas : termine le travail possible, marque [À CONFIRMER] ce qui dépend de la réponse.',
      }
    },
    write: true,
  },
  {
    name: 'signaler',
    description: 'Publie une carte dans le fil « pendant votre absence » du panneau : ce qui a été préparé, à relire. type: mail_traite | synthese | acte | prolongation | projet_reponse | alerte | note. Pour une QUESTION au magistrat, utilise poser_question (jamais signaler, jamais le mail).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' }, titre: { type: 'string' },
        resume: { type: 'string', description: '2-4 phrases : ce qui a été fait et ce qui attend le magistrat' },
        numero: { type: 'string', description: 'Dossier concerné (optionnel)' },
      },
      required: ['type', 'titre', 'resume'],
    },
    handler: async (a) => { await publishFeed(keys, a); return { ok: true } },
    write: true,
  },
]

// ── Boucle JSON-RPC stdio (une ligne = un message) ──
const rl = readline.createInterface({ input: process.stdin, terminal: false })

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', async (line) => {
  let req
  try { req = JSON.parse(line) } catch { return }
  const { id, method, params } = req
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } })

  try {
    if (method === 'initialize') {
      return reply({
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'siral-attache', version: '1.0.0' },
      })
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return
    if (method === 'ping') return reply({})
    // En mode sous-agent, seuls les outils de lecture existent : les
    // écritures et sous_agents (récursion) ne sont ni listés ni appelables.
    const availableTools = IS_SUBAGENT ? TOOLS.filter((t) => !t.write && t.name !== 'sous_agents') : TOOLS
    if (method === 'tools/list') {
      return reply({ tools: availableTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    }
    if (method === 'tools/call') {
      const tool = availableTools.find((t) => t.name === params?.name)
      if (!tool) return fail(-32602, `Outil inconnu : ${params?.name}`)
      if (!keys) {
        return reply({ content: [{ type: 'text', text: JSON.stringify({ erreur: 'Trousseau non remis ou révoqué : demander à l\'administrateur de remettre les clés.' }) }], isError: true })
      }
      const args = params?.arguments || {}
      try {
        const result = await tool.handler(args)
        if (tool.write) {
          await audit(keys, 'outil', { outil: tool.name, contexte: runContext, args: JSON.stringify(args).slice(0, 2000) })
        }
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 1)
        return reply({ content: [{ type: 'text', text: text.slice(0, 400_000) }] })
      } catch (e) {
        if (tool.write) {
          await audit(keys, 'outil_erreur', { outil: tool.name, contexte: runContext, erreur: String(e?.message || e) }).catch(() => {})
        }
        return reply({ content: [{ type: 'text', text: JSON.stringify({ erreur: String(e?.message || e) }) }], isError: true })
      }
    }
    // méthode inconnue : erreur JSON-RPC propre
    return fail(-32601, `Méthode non supportée : ${method}`)
  } catch (e) {
    return fail(-32603, String(e?.message || e))
  }
})

rl.on('close', () => process.exit(0))
