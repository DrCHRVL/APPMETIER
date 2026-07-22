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
  actualiserDescription, diagnostiquerDossier, diagnostiquerAffichage, arborescenceDocuments,
  ajouterNatinfs, creerDossier,
} from './attache/dossier.mjs'
import { searchNatinf } from './attache/natinf.mjs'
import { publishItems, ITEM_TYPES } from './attache/majordome.mjs'
import { saveArchitecture, loadArchitecture, buildChronologie } from './attache/cotes.mjs'
import { saveTrame, listTrames, readTrame, setTrameDescription, safeTrameName, MODELE_PREFIX } from './attache/trames.mjs'
import { saveSkill, listSkills, readSkill, deleteSkill, safeSkillName, AUTO_SKILL_PREFIX, AUTO_SKILLS_MAX, countAutoSkills } from './attache/skills.mjs'
import { saveKbEntry, setKbMeta, setKbReflexe, listKb, readKbEntry, searchKb, KB_CATEGORIES, MAX_REFLEXE } from './attache/kb.mjs'
import { runSubagents } from './attache/subagents.mjs'
import { listInstructionDossiers, instructionDossierMarkdown } from './attache/instru.mjs'
import { listDepot, readDepotText, readMailPieceText, rangerDocument, rangerPieceDansKb, ecarterDepot, ZONES } from './attache/depot.mjs'
import { addProposition, listPropositions } from './attache/propositions.mjs'
import { readDossierMemory, appendDossierMemory } from './attache/dossierMemory.mjs'
import { analyserReseau, listerLiens, rapprochementsInterDossiers, recoupementMecs, cartoCorpus } from './attache/carto.mjs'
import { saveProduction, listProductions, readProduction, deleteProduction, diffProduction, PRODUCTION_TYPES } from './attache/productions.mjs'
import { appendMemory, rewriteMemory, memoryStats, MEMORY_BUDGET } from './attache/memory.mjs'
import { recordLearningSignal, pendingSignals, learningState, learningMetrics, metricsSummary } from './attache/apprentissage.mjs'
import { readConversation } from './attache/agent.mjs'
import { controlerProduction } from './attache/qualite.mjs'
import { listAssociations, setAssociation, removeAssociation } from './attache/associations.mjs'
import { listInbox, readInboxMessage, markInboxProcessed } from './attache/mail.mjs'

const keys = loadKeyring()
const runContext = process.env.SIRAL_ATTACHE_RUN || 'chat'

/**
 * Pseudo-dossier des actes SANS procédure : une demande d'acte arrive (mail
 * transféré) mais ne correspond à aucun dossier en cours — l'acte rédigé est
 * rangé ici et apparaît dans la section « Actes rédigés — hors dossier » du
 * tableau de bord, en attendant que le magistrat décide de la suite.
 */
export const HORS_DOSSIER = '_hors-dossier'

/**
 * Porte de qualité auto-appliquée : contrôles déterministes (zéro jeton) au
 * moment de la remise. Violation → l'écriture N'A PAS LIEU, l'agent reçoit
 * une erreur actionnable et corrige dans le même run. Chaque rejet est capté
 * en signal d'apprentissage : une porte qui claque souvent devient un
 * réflexe consolidé.
 */
async function porteQualiteOuSignal({ type, titre, contenu, numero }, mode) {
  const violations = controlerProduction({ type, contenu, mode })
  if (!violations.length) return
  await recordLearningSignal(keys, {
    type: 'garde_qualite',
    dossier: numero,
    detail: `${type || mode} — ${String(titre || '').slice(0, 80)} : ${violations.map((v) => v.code).join(', ')}`,
  })
  throw new Error(`PORTE DE QUALITÉ — production refusée, corrige puis re-soumets :\n- ${violations.map((v) => v.message).join('\n- ')}`)
}

/** Remise d'un livrable DANS SIRAL — corps commun de remettre_livrable et de son alias.
 *
 * Le livrable devient une PRODUCTION éditable (comme un acte) : le magistrat le
 * relit, le retouche (à la main ou via le chat), l'exporte PDF/Word et le
 * valide — depuis le journal « pendant votre absence » comme depuis le dossier.
 * La carte du fil ne porte plus qu'un extrait ; le texte vit dans la production
 * (source unique), qu'elle référence par son `prodId`. */
async function publierLivrable(a) {
  await porteQualiteOuSignal({ type: 'livrable', titre: a.sujet, contenu: a.corps, numero: a.numero }, 'livrable')
  const numero = a.numero ? String(a.numero).slice(0, 80) : HORS_DOSSIER
  const titre = String(a.sujet || 'Livrable').slice(0, 200)
  const { id } = await saveProduction(keys, {
    numero,
    type: 'livrable',
    titre,
    contenu: String(a.corps || ''),
    source: 'livrable',
  })
  await publishFeed(keys, {
    type: 'livrable',
    titre,
    resume: String(a.corps || '').slice(0, 2000),
    numero: a.numero ? String(a.numero).slice(0, 80) : undefined,
    prodId: id,
  })
  return { ok: true, note: 'Livrable remis dans SIRAL (fil « pendant votre absence ») — éditable/exportable, rien n\'est parti par mail.' }
}
// Mode sous-agent : lancé par l'outil sous_agents — LECTURE SEULE (aucun
// outil d'écriture, pas de sous_agents imbriqué : pas de récursion possible).
const IS_SUBAGENT = process.env.SIRAL_ATTACHE_SUBAGENT === '1'

// Runs AUTONOMES d'auto-amélioration (consolidation d'apprentissage, étude du
// corpus) : aucune instruction humaine ne les couvre. La PROPRIÉTÉ des
// méthodes y est imposée DANS LE CODE, pas seulement dans le prompt :
// l'attaché n'y écrit que SES trames (modele-*) et SES skills (auto-*) ;
// toute méthode du magistrat passe par une proposition ✓/✗.
const IS_RUN_AUTONOME = runContext === 'apprentissage' || runContext === 'etude'

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
    description: 'Dossier en markdown COMPACT (aperçu par défaut) : objet, NATINF, mis en cause, actes (id + statut + échéance), à-faire, documents, et un INDEX daté des comptes-rendus. Ne sature jamais la sortie. Le détail se tire à la demande, borné, via `section` : "cr" = CR intégraux PAGINÉS (offset = index d\'un CR vu dans l\'index [#i], limit = nombre par page) ; "fiche" avec `cible` = tout ce qui concerne une personne / une ligne / une cible (MEC, actes, mentions dans les CR) — l\'outil pour retrouver un propriétaire, une date, une échéance précise sans tout relire ; "mec" | "actes" | "documents" = la section seule ; "complet" = tout, CR inclus (à éviter sur un gros dossier). Si le numéro est un dossier d\'INSTRUCTION (n° instruction ou parquet), rend : saisine, mis en examen (détention, DML), débats JLD, opérations, chronologie.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' },
        section: { type: 'string', enum: ['apercu', 'cr', 'fiche', 'mec', 'actes', 'documents', 'complet'], description: 'Défaut "apercu" (compact). "cr" = CR intégraux paginés ; "fiche" (avec cible) = vue ciblée sur une personne/ligne.' },
        cible: { type: 'string', description: 'Pour section:"fiche" — nom, ligne, objet ou id d\'acte à isoler (ex: "HADBI", "3008").' },
        offset: { type: 'number', description: 'Pour section:"cr" — index du 1er CR à afficher (cf. [#i] de l\'index de l\'aperçu). Défaut 0.' },
        limit: { type: 'number', description: 'Pour section:"cr" — nombre max de CR par page (la page est aussi bornée en taille).' },
      },
      required: ['numero'],
    },
    handler: async (a) => dossierMarkdown(keys, a.numero, { section: a.section, cible: a.cible, offset: a.offset, limit: a.limit })
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
    description: 'Texte intégral d\'un document déposé sous un numéro de dossier — enquête OU instruction (PDF, ODT, DOCX, RTF, TXT/MD/HTML). `chemin` = cheminRelatif exact (voir lire_dossier ou dossier_arborescence), y compris les pièces du « Dossier complet » versé (Dossier/…).',
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
        type: { type: 'string', description: 'Catégorie de l\'AUTRE acte. Utilise EXACTEMENT l\'une de ces CLÉS quand elle s\'applique — la fiche légale (durée, autorisation JLD/procureur, date de fin, plafond de prolongations) est alors pré-remplie automatiquement, comme dans la fenêtre « Ajouter un acte » : art76 · imsi_donnees · imsi_interceptions · captation_images_public · captation_images_prive · sonorisation_prive · drone_public · drone_prive · captation_donnees_informatiques · activation_fixe · activation_mobile · infiltration. Une perquisition/ordonnance JLD sur enquête préliminaire relève d\'art76. N\'utilise un libellé libre (ex. « comparution art. 78 ») QUE si aucune catégorie ne convient — durée et date de fin ne seront alors pas pré-remplies.' },
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
    description: 'Classe une note ou synthèse au dossier comme compte-rendu — visible dans la liste des comptes rendus ET la chronologie de l\'enquête. Signé de la signature configurée (Paramètres → Attaché IA, ex. « AUDRAN C ») ou, à défaut, du nom de l\'administrateur : jamais aucune trace « attaché » ni « IA » dans les données partagées.',
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
    name: 'natinf_chercher',
    description: 'Recherche dans le référentiel NATINF officiel (nomenclature des infractions) : par code exact ou par mots du libellé (insensible casse/accents). Retourne code, libellé, nature, articles. À utiliser AVANT ajouter_natinfs et avant de citer une qualification dans un acte.',
    inputSchema: {
      type: 'object',
      properties: {
        requete: { type: 'string', description: 'Code (ex: 7989) ou mots-clés (ex: trafic stupefiants transport)' },
        limite: { type: 'number' },
      },
      required: ['requete'],
    },
    handler: async (a) => searchNatinf(a.requete, { limite: a.limite }),
  },
  {
    name: 'ajouter_natinfs',
    description: 'Ajoute des codes NATINF aux infractions ENREGISTRÉES du dossier — écriture AUTONOME (pas de validation préalable), à faire dès que des NATINF cohérents apparaissent : mentionnés dans un acte d\'autorisation ou une requête téléversée, déduits des faits avant une rédaction. Dédoublonnage automatique ; les codes inconnus du référentiel sont refusés (natinf_chercher d\'abord). L\'ajout apparaît dans les modifications récentes du dossier, signé du nom du magistrat. Cite la pièce source.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' },
        codes: { type: 'array', items: { type: 'string' }, description: 'Codes NATINF (ex: ["7989","7101"])' },
        source: { type: 'string', description: 'D\'où viennent ces qualifications (ex: ordonnance JLD du 12/06 — Actes/…, ou « déduits des faits »)' },
      },
      required: ['numero', 'codes'],
    },
    handler: async (a) => ajouterNatinfs(keys, a),
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
    name: 'boite_lire_piece',
    description: 'Lit le TEXTE d\'une pièce jointe d\'un mail transféré (PDF — OCR de secours si scan —, ODT/DOCX/RTF, texte/HTML) pour l\'IDENTIFIER ou la CLASSER avant de la ranger. Sortie bornée (défaut ~12 000 caractères : c\'est une aide à la lecture, pas le stockage). Un scan illisible ou un type non textuel est signalé — ne devine alors jamais le contenu. Pour ranger la pièce : au dossier → ranger_document (source mail) ; à la base de connaissances → kb_ranger_piece.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant du message (boite_lister)' },
        piece: { type: 'string', description: 'Nom exact de la pièce jointe (boite_lire)' },
        max: { type: 'number', description: 'Longueur maximale du texte retourné (défaut 12000)' },
      },
      required: ['id', 'piece'],
    },
    handler: async (a) => readMailPieceText(keys, { mailId: a.id, piece: a.piece, max: a.max }),
  },
  {
    name: 'boite_marquer_traite',
    description: 'Marque un message comme traité, avec un résumé d\'une phrase de ce qui a été fait.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, resume: { type: 'string' } }, required: ['id', 'resume'] },
    handler: async (a) => ({ ok: await markInboxProcessed(keys, a.id, a.resume) }),
    write: true,
  },
  {
    name: 'remettre_livrable',
    description: 'Remet un LIVRABLE complet au magistrat DANS SIRAL (synthèse, projet de mail à recopier, note, projet de réponse) : une carte « Livrable » apparaît dans le fil « pendant votre absence », avec le texte intégral et un bouton Copier. AUCUN mail ne part — les mails sortants sont supprimés (rejets de messagerie) : tout se remet dans l\'application. Pour un ACTE à retoucher/exporter, préfère produire_document (atelier « Actes rédigés »).',
    inputSchema: {
      type: 'object',
      properties: {
        sujet: { type: 'string', description: 'Titre du livrable (une ligne)' },
        corps: { type: 'string', description: 'Le livrable complet, prêt à lire ou à copier' },
        numero: { type: 'string', description: 'Dossier concerné (optionnel)' },
      },
      required: ['sujet', 'corps'],
    },
    handler: publierLivrable,
    write: true,
  },
  {
    // Alias hérité : d'anciennes conversations/routines appellent encore ce nom.
    name: 'envoyer_a_mon_magistrat',
    description: 'DÉPRÉCIÉ — alias de remettre_livrable : le livrable s\'affiche DANS SIRAL (fil « pendant votre absence »), plus aucun mail ne part.',
    inputSchema: { type: 'object', properties: { sujet: { type: 'string' }, corps: { type: 'string' }, numero: { type: 'string' } }, required: ['sujet', 'corps'] },
    handler: publierLivrable,
    write: true,
  },
  {
    name: 'creer_dossier',
    description: 'Crée DIRECTEMENT un nouveau dossier (enquête) dans le contentieux — SANS validation préalable. Réservé à une instruction EXPLICITE du magistrat : mail transféré contenant « créer procédure » (ou équivalent sans ambiguïté), ou demande explicite en chat. Dans tous les autres cas de détection, utilise proposer_dossier (✓/✗). Renseigne tout depuis la pièce : numero, dateDebut, services, description (prise de notes), misEnCause (recoupe d\'abord avec recouper_personnes). Refus si le numéro existe déjà. Ensuite : ajoute les NATINF (ajouter_natinfs), range les pièces (ranger_document) et rédige les actes demandés (produire_document) dans CE dossier.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Nom/numéro du dossier (ex: « 2026/000123 » ou « Réseau ZOUAOUI »)' },
        dateDebut: { type: 'string', description: 'AAAA-MM-JJ (défaut : aujourd\'hui)' },
        services: { type: 'array', items: { type: 'string' } },
        description: { type: 'string', description: 'Objet — faits, qualification, résumé télégraphique' },
        misEnCause: {
          type: 'array',
          items: { type: 'object', properties: { nom: { type: 'string' }, role: { type: 'string' }, statut: { type: 'string' } }, required: ['nom'] },
        },
        source: { type: 'string', description: 'D\'où vient l\'instruction (ex: mail transféré du 15/07 « créer procédure »)' },
      },
      required: ['numero', 'source'],
    },
    handler: async (a) => creerDossier(keys, a),
    write: true,
  },
  {
    name: 'memoire_noter',
    description: 'Consigne un enseignement durable dans la mémoire, relue à chaque intervention. section: "Exigences du magistrat" | "Réflexes appris" | "Pièges à éviter". Note la RÈGLE GÉNÉRALE réutilisable (une ligne), pas l\'anecdote — et jamais un doublon d\'une ligne existante : la mémoire est consolidée périodiquement sous un budget strict.',
    inputSchema: { type: 'object', properties: { section: { type: 'string' }, note: { type: 'string' } }, required: ['section', 'note'] },
    handler: async (a) => {
      const ajoute = await appendMemory(keys, a.section, a.note, 'attache-ia')
      // La note vaut aussi signal d'apprentissage : la consolidation la verra
      // (fusion des doublons, généralisation) sans relire toute la mémoire.
      await recordLearningSignal(keys, { type: 'lecon', detail: `${String(a.section).slice(0, 60)} : ${String(a.note).slice(0, 300)}` })
      return { ajoute }
    },
    write: true,
  },
  {
    name: 'memoire_reecrire',
    description: `Réécrit la mémoire EN ENTIER (document markdown complet, ≤ ${MEMORY_BUDGET} caractères) — versionnée, le magistrat garde la main. Réservé à la CONSOLIDATION de l'apprentissage (run dédié) ou à une demande explicite du magistrat de réorganiser ta mémoire. Pour un simple ajout : memoire_noter.`,
    inputSchema: { type: 'object', properties: { contenu: { type: 'string', description: 'Le document complet (remplace tout)' } }, required: ['contenu'] },
    handler: async (a) => rewriteMemory(keys, a.contenu, 'attache-ia'),
    write: true,
  },
  {
    name: 'apprentissage_bilan',
    description: 'Bilan des signaux d\'expérience captés depuis la dernière consolidation de la mémoire : corrections du magistrat (propositions refusées ✗, actes révisés ou corrigés à la main, reprises en conversation), validations ✓, leçons notées — avec la progression mesurée (taux d\'acceptation, retouches, 30 j vs 30 j précédents) et l\'état de la mémoire face à son budget. Sert au run de consolidation, et à répondre à « qu\'as-tu appris récemment ? ».',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const signaux = pendingSignals(keys, 80)
      return {
        depuisConsolidation: learningState().lastRunAt || '(jamais consolidé)',
        nombre: signaux.length,
        memoire: memoryStats(keys),
        progression: metricsSummary(learningMetrics(keys)),
        signaux: signaux.map((s) => ({
          quand: new Date(s.ts).toISOString().slice(0, 10),
          type: s.type,
          dossier: s.dossier,
          detail: s.detail,
          source: s.source,
        })),
      }
    },
  },
  {
    name: 'conversation_lire',
    description: 'Relit le transcript d\'une conversation passée avec le magistrat (id donné par un signal correction_conversation, champ source). Sert à la CONSOLIDATION d\'apprentissage : retrouver la reprise exacte du magistrat pour en tirer la règle générale. Derniers échanges seulement, bornés.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, derniers: { type: 'number', description: 'Nombre de messages en partant de la fin (défaut 12, max 30)' } }, required: ['id'] },
    handler: async (a) => {
      const conv = readConversation(keys, String(a.id || ''))
      if (!conv) return { erreur: `Conversation ${a.id} introuvable` }
      const n = Math.max(2, Math.min(30, Number(a.derniers) || 12))
      return {
        id: conv.id,
        titre: conv.titre || conv.title,
        messages: (conv.messages || []).slice(-n).map((m) => ({
          role: m.role,
          quand: (m.at || '').slice(0, 16),
          texte: String(m.text || '').slice(0, 2500),
        })),
      }
    },
    mainOnly: true, // échanges privés du magistrat : jamais exposés aux sous-agents
  },
  {
    name: 'associations_lister',
    description: 'Table « type d\'acte → trame(s) + skill(s) » définie par le magistrat. À CONSULTER avant de rédiger un acte : si le type d\'acte y figure, applique D\'OFFICE la trame et la skill associées, sans reposer la question.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ associations: listAssociations(keys) }),
  },
  {
    name: 'association_definir',
    description: 'Enregistre (ou met à jour) l\'association d\'un type d\'acte à une/des trame(s) et skill(s), pour l\'appliquer d\'office ensuite. À utiliser quand le magistrat rattache une trame/skill à un type d\'acte (« pour les prolongations de géoloc, prends la trame X et la skill Y »). acte : libellé du type d\'acte ; trames / skills : noms.',
    inputSchema: { type: 'object', properties: { acte: { type: 'string' }, trames: { type: 'array', items: { type: 'string' } }, skills: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['acte'] },
    handler: async (a) => ({ association: await setAssociation(keys, a, 'attache-ia') }),
    write: true,
  },
  {
    name: 'association_supprimer',
    description: 'Retire l\'association d\'un type d\'acte (par son libellé).',
    inputSchema: { type: 'object', properties: { acte: { type: 'string' } }, required: ['acte'] },
    handler: async (a) => removeAssociation(keys, a.acte, 'attache-ia'),
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
    name: 'diagnostic_affichage',
    description: 'POURQUOI un dossier présent dans le coffre n\'apparaît PAS chez le magistrat dans « enquêtes en cours ». Le client fusionne les enquêtes par id numérique : renvoie les obstacles BLOQUANTS (id tombé dans les suppressions → filtré comme supprimé ; id partagé par deux enquêtes → fusion ; archivage ; hiddenFromJA ; id non numérique) et confirme, à défaut, que le dossier doit s\'afficher après synchronisation. À utiliser dès que le magistrat dit « je ne vois pas ce dossier » — avant de conclure à un problème de tri ou de rafraîchissement (il n\'y a ni filtre « dormant » ni tri masquant à l\'affichage).',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => diagnostiquerAffichage(keys, a.numero) ?? { erreur: 'Dossier introuvable' },
  },
  {
    name: 'actualiser_description',
    description: 'Réécrit la description (« l\'objet ») du dossier, tenue à jour au fil des CR et des actes/documents téléversés. FORMAT IMPOSÉ, en TEXTE BRUT (jamais d\'HTML ni de <br>), en DEUX PARTIES, chacune introduite par son titre en MAJUSCULES sur sa propre ligne :\n'
      + 'SYNTHÈSE — vision GLOBALE des faits à l\'instant T, qui S\'ENRICHIT et se REFORMULE à chaque actualisation (on repart de l\'existant, on ne le jette pas) : qualification, mode opératoire, LIEUX et PÉRIODE, état des mesures en cours et échéances qui pressent.\n'
      + 'MIS EN CAUSE — un par un, les mis en cause ENREGISTRÉS du dossier (ceux saisis à la main, section « Mis en cause » de lire_dossier — n\'en invente aucun), chacun suivi des ÉLÉMENTS À CHARGE relevés contre lui (ce que les CR, actes et pièces établissent : rôle, faits, liens, saisies).\n'
      + 'STYLE « PRISE DE NOTES » : rédigé à ~80 %, mots inutiles et verbes de liaison retirés, phrases nominales courtes — mais compréhensible d\'un collègue qui découvre le dossier. Pas d\'autres rubriques que ces deux parties, pas de jargon obscur. L\'ancienne description est ARCHIVÉE (jamais perdue).',
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
    description: `Rédige un ACTE et le range dans « Actes rédigés » du dossier (le magistrat le visionne, l'édite, l'exporte en PDF/Word officiel, puis le VALIDE). Type : ${PRODUCTION_TYPES.join(', ')}. Suis la trame correspondante (trames_lister/trame_lire) et le dossier (lire_dossier, chronologie_lire). COHÉRENCE NATINF OBLIGATOIRE : vise les qualifications enregistrées du dossier (section « Infractions (NATINF) » de lire_dossier) — si elles manquent, ajoute-les d'abord (natinf_chercher + ajouter_natinfs). Rédaction complète, prête à signer, texte brut (paragraphes séparés par des lignes vides). ` +
      'Renseigne `source` avec le nom EXACT de la trame suivie : il forme le 1ᵉʳ segment du nom de fichier à l\'export. Pour un acte d\'INTERCEPTION, d\'ÉCOUTE ou de GÉOLOCALISATION, renseigne aussi `objet` avec le n° de ligne interceptée ou l\'objet géolocalisé (ex. « 07 64 45 45 16 ») : il s\'ajoute en fin de nom de fichier. Pour MODIFIER un acte existant, passe son id. ' +
      `DEMANDE SANS DOSSIER : si l'acte demandé (mail transféré) ne correspond à AUCUN dossier en cours et que la consigne ne dit pas de créer la procédure, range-le sous numero "${HORS_DOSSIER}" — il apparaît dans « Actes rédigés — hors dossier » du tableau de bord. ` +
      'Un NOUVEL acte fait automatiquement apparaître une carte reliée (éditable) dans le journal « pendant votre absence » : ne la signale (signaler) pas en double.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' },
        id: { type: 'string', description: 'id d\'une production à mettre à jour (sinon nouvelle)' },
        type: { type: 'string', enum: PRODUCTION_TYPES },
        titre: { type: 'string' },
        contenu: { type: 'string', description: 'Le texte complet de l\'acte' },
        source: { type: 'string', description: 'Trame suivie (ex: requisition-tse)' },
        objet: { type: 'string', description: 'Objet de l\'acte pour le nom de fichier : n° de ligne interceptée / objet géolocalisé (écoutes, géoloc, interceptions). Omettre pour un acte sans objet (perquisition, saisine…).' },
        acteMeta: {
          type: 'object',
          description: 'STRUCTURE de l\'acte, pour qu\'à la validation par le magistrat l\'app crée un acte IDENTIQUE à une saisie manuelle (rubrique + catégorie + statut). À renseigner dès que le document est un acte d\'enquête à suivre (autorisation/prolongation de mesure). Inutile pour note/livrable/projet de réponse.',
          properties: {
            kind: { type: 'string', enum: ['ecoute', 'geolocalisation', 'autre'], description: 'Rubrique : interception téléphonique = ecoute ; balise/suivi de véhicule ou objet = geolocalisation ; toute autre TSE = autre.' },
            categorie: { type: 'string', description: 'Pour kind=autre : CLÉ de catégorie si applicable (art76 · imsi_donnees · imsi_interceptions · captation_images_public · captation_images_prive · sonorisation_prive · drone_public · drone_prive · captation_donnees_informatiques · activation_fixe · activation_mobile · infiltration) — durée/autorisation/date de fin sont alors pré-remplies. Sinon libellé libre (ex. « Comparution forcée (art. 78 CPP) »).' },
            dateDebut: { type: 'string', description: 'AAAA-MM-JJ si connue (défaut : aujourd\'hui). Laisser vide si en attente d\'autorisation.' },
            duree: { type: 'number', description: 'Durée de l\'autorisation (nombre). Ex. géoloc procureur = 15.' },
            dureeUnit: { type: 'string', enum: ['jours', 'mois'] },
            cible: { type: 'string', description: 'Écoute : ligne/personne visée.' },
            objet: { type: 'string', description: 'Géoloc : objet suivi (véhicule, plaque…).' },
            pendingJld: { type: 'boolean', description: 'true si la mesure est soumise au JLD et encore EN ATTENTE d\'autorisation (statut « en attente JLD »).' },
          },
        },
      },
      required: ['numero', 'type', 'titre', 'contenu'],
    },
    handler: async (a) => {
      // Porte de qualité AVANT toute écriture : inachevé, auto-désignation,
      // HTML, acte squelettique → refus actionnable, l'agent corrige et re-soumet.
      await porteQualiteOuSignal({ type: a.type, titre: a.titre, contenu: a.contenu, numero: a.numero }, 'acte')
      const r = await saveProduction(keys, a)
      // Nouvel acte (pas une modification) : une carte reliée apparaît dans le
      // journal « pendant votre absence » — inutile de la signaler en plus.
      if (!a.id) {
        await publishFeed(keys, {
          type: 'acte',
          titre: r.titre,
          resume: `Acte rédigé (${a.type}) — à relire, éditer et valider.`,
          numero: a.numero,
          prodId: r.id,
        })
      } else {
        // Révision d'un acte existant : signal d'apprentissage (le premier jet
        // n'a pas suffi — retour du magistrat ou complément attendu).
        await recordLearningSignal(keys, {
          type: 'acte_revise',
          dossier: a.numero,
          detail: `${a.type} — ${String(a.titre).slice(0, 150)}`,
          source: a.source ? `trame ${a.source}` : undefined,
        })
      }
      return r
    },
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
    name: 'production_diff',
    description: 'Montre CE QUE le magistrat a changé DE SA MAIN dans un acte : diff ligne à ligne entre TON jet (version archivée) et sa correction — « - » ce qu\'il a retiré, « + » ce qu\'il a ajouté. À utiliser lors de la consolidation d\'apprentissage sur un signal « acte_edite_main » : tu comprends précisément la correction et tu en tires une RÈGLE durable (mémoire, trame, skill) pour ne pas la refaire. Passe versionAt (l\'horodatage porté par le signal) pour cibler exactement cette correction ; sans versionAt, compare les deux dernières versions (dernier changement).',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string' },
        id: { type: 'string' },
        versionAt: { type: 'string', description: 'Horodatage/jeton de la version à comparer (celui du signal acte_edite_main). Optionnel.' },
      },
      required: ['numero', 'id'],
    },
    handler: async (a) => diffProduction(keys, a.numero, a.id, a.versionAt),
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
    description: `Enregistre ou met à jour une trame de rédaction du magistrat (plan-type de DML, réquisition, TSE, consignes de style). Versionnée à chaque réécriture. À utiliser quand le magistrat colle une trame ou dit « enregistre cette trame » — et pour TES modèles « ${MODELE_PREFIX}* » extraits des actes validés (les seuls que tu écris de ta propre initiative).`,
    inputSchema: { type: 'object', properties: { nom: { type: 'string', description: 'ex: reponse-dml, requisition-tse' }, contenu: { type: 'string' }, description: { type: 'string' } }, required: ['nom', 'contenu'] },
    handler: async (a) => {
      // Gouvernance imposée dans le code : en run AUTONOME (consolidation,
      // étude), seules les trames modele-* — jamais celles du magistrat.
      if (IS_RUN_AUTONOME && !safeTrameName(a.nom).startsWith(MODELE_PREFIX)) {
        throw new Error(`Run autonome : seules les trames « ${MODELE_PREFIX}* » t'appartiennent. Pour améliorer la trame du magistrat « ${safeTrameName(a.nom)} », dépose proposer_trame (contenu complet révisé + motif) — il appliquera d'un ✓.`)
      }
      return saveTrame(keys, a)
    },
    write: true,
  },
  {
    name: 'proposer_trame',
    description: 'Propose au magistrat une AMÉLIORATION d\'une de SES trames (ou une nouvelle trame) — le texte INTÉGRAL révisé attend son ✓ dans Paramètres → Attaché IA (application versionnée, réversible) ou son ✗. C\'est l\'UNIQUE voie pour faire évoluer une trame qui ne t\'appartient pas (tout sauf modele-*) de ta propre initiative : fragilité de légalité repérée, écart au corpus d\'actes validés, corrections récurrentes du magistrat sur ce type d\'acte. `motif` : POURQUOI, en 1-3 phrases, avec ta source (signaux, pièces, textes) — il décide sur cette base. Conserve tout ce qui n\'a pas besoin de changer : c\'est une révision, pas une réécriture de style.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom exact de la trame visée (trames_lister) — ou d\'une nouvelle' },
        contenu: { type: 'string', description: 'Le texte COMPLET révisé (remplace tout à la validation)' },
        description: { type: 'string', description: 'Nouvelle description (sinon l\'actuelle est conservée)' },
        motif: { type: 'string', description: 'Pourquoi cette révision, avec la source (1-3 phrases)' },
        source: { type: 'string', description: 'D\'où vient la détection (étude du corpus, analyse de légalité, signaux…)' },
      },
      required: ['nom', 'contenu', 'motif'],
    },
    handler: async (a) => addProposition(keys, {
      type: 'trame',
      payload: { nom: a.nom, contenu: a.contenu, description: a.description, motif: String(a.motif).slice(0, 600) },
      source: a.source,
    }),
    write: true,
  },
  {
    name: 'proposer_skill',
    description: 'Propose au magistrat une AMÉLIORATION d\'une de SES skills (ou une nouvelle skill) — même mécanique ✓/✗ que proposer_trame, même exigence de motif. C\'est l\'UNIQUE voie pour faire évoluer une skill qui ne t\'appartient pas (tout sauf auto-*) de ta propre initiative ; sur instruction EXPLICITE du magistrat en conversation, skill_enregistrer reste la voie directe.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom exact de la skill visée (skills_lister) — ou d\'une nouvelle' },
        contenu: { type: 'string', description: 'La méthode COMPLÈTE révisée (markdown)' },
        description: { type: 'string', description: 'Nouvelle description — quand appliquer (sinon l\'actuelle est conservée)' },
        motif: { type: 'string', description: 'Pourquoi cette révision, avec la source (1-3 phrases)' },
        source: { type: 'string', description: 'D\'où vient la détection (signaux, corpus…)' },
      },
      required: ['nom', 'contenu', 'motif'],
    },
    handler: async (a) => addProposition(keys, {
      type: 'skill',
      payload: { nom: a.nom, contenu: a.contenu, description: a.description, motif: String(a.motif).slice(0, 600) },
      source: a.source,
    }),
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
    name: 'kb_ranger_piece',
    description: `Intègre une PIÈCE CONFIÉE à la base de connaissances — pièce jointe d'un mail transféré (source "mail" : id + piece de boite_lire) ou pièce du dépôt (source "depot" : rel de depot_lister). Utilise-le quand le magistrat transmet un DOCUMENT DE RÉFÉRENCE DURABLE (« intègre ce memento / cette circulaire / cette documentation à ta base de connaissances et classe-la ») plutôt qu'une pièce de procédure (celle-là va au dossier via ranger_document). Le TEXTE est extrait côté serveur (PDF/ODT/DOCX/RTF/texte) et conservé chiffré — seul le texte, jamais l'octet du PDF. CLASSE dès réception : titre clair, categorie (${KB_CATEGORIES.join(', ')} — champ libre), chemin de pochette (ex: Circulaires/2026/memento-parquet.md), description d'une phrase (contenu + quand s'en servir). reflexe=true pour l'épingler comme référence de premier rang (Memento parquet…). Un scan illisible est REFUSÉ (rien enregistré) : demande une version texte. Une pièce du dépôt est retirée du dépôt après intégration.`,
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['mail', 'depot'], description: '"mail" (id + piece) ou "depot" (rel)' },
        id: { type: 'string', description: 'source=mail : identifiant du message (boite_lister)' },
        piece: { type: 'string', description: 'source=mail : nom exact de la pièce jointe' },
        rel: { type: 'string', description: 'source=depot : rel de la pièce (depot_lister)' },
        titre: { type: 'string', description: 'Titre de l\'entrée (clair, daté si utile)' },
        categorie: { type: 'string', description: `Catégorie (${KB_CATEGORIES.join(', ')} — champ libre)` },
        chemin: { type: 'string', description: 'Pochette de rangement (arborescence, séparateur /)' },
        description: { type: 'string', description: 'Une phrase : ce que contient l\'entrée et quand s\'en servir' },
        reflexe: { type: 'boolean', description: 'true pour épingler comme document réflexe (référence de premier rang)' },
      },
      required: ['source', 'titre'],
    },
    handler: async (a) => rangerPieceDansKb(keys, { source: a.source, rel: a.rel, mailId: a.id, piece: a.piece, titre: a.titre, categorie: a.categorie, chemin: a.chemin, description: a.description, reflexe: a.reflexe }),
    write: true,
  },
  {
    name: 'kb_decrire',
    description: 'Met à jour les MÉTADONNÉES d\'une entrée de la base de connaissances — description (une phrase : contenu + quand s\'en servir), categorie, chemin (pochette d\'arborescence, ex: Jurisprudence/Cassation/arret-2024.md) — le CONTENU n\'est jamais touché. C\'est ton outil de bibliothécaire : classer les documents téléversés en masse, ranger une entrée mal placée.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant exact (kb_lister)' },
        description: { type: 'string' },
        categorie: { type: 'string' },
        chemin: { type: 'string', description: 'Pochette de rangement (arborescence, séparateur /)' },
      },
      required: ['id'],
    },
    handler: async (a) => setKbMeta(keys, a.id, a),
    write: true,
  },
  {
    name: 'kb_reflexe',
    description: `Désigne (reflexe=true) ou retire (reflexe=false) une entrée comme « document réflexe » : une référence de premier rang, mise en tête du sommaire, que tu consultes en priorité (kb_lire) avant toute analyse ou rédaction. Le magistrat en garde ${MAX_REFLEXE} au plus. À utiliser quand il dit « mets tel document en réflexe / en tête / prioritaire » ou « retire-le des réflexes ». Le contenu et le reste des métadonnées ne sont jamais modifiés.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant exact (kb_lister)' },
        reflexe: { type: 'boolean', description: 'true pour désigner (défaut), false pour retirer' },
      },
      required: ['id'],
    },
    handler: async (a) => setKbReflexe(keys, a.id, a.reflexe),
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
    description: 'Crée ou met à jour une skill du magistrat (méthode réutilisable : quoi faire et comment, en markdown). Versionnée à chaque réécriture. TROIS USAGES : (1) il te dicte/colle une méthode → range-la telle quelle ; (2) « CRÉE une skill qui fait X » → c\'est TOI qui rédiges la méthode complète et sa description ; (3) « MODIFIE la skill Z comme ça » → skill_lire d\'abord, applique le changement, ré-enregistre avec le MÊME nom (l\'ancienne version est archivée). La description est CRUCIALE : c\'est elle qui dit QUAND appliquer la skill — soigne-la à chaque fois.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'ex: preparation-audience, analyse-telephonie (même nom qu\'une skill existante = mise à jour)' },
        description: { type: 'string', description: 'Une phrase : quand utiliser cette skill' },
        contenu: { type: 'string', description: 'La méthode complète, en markdown' },
      },
      required: ['nom', 'contenu'],
    },
    handler: async (a) => {
      // Gouvernance imposée dans le code : en run AUTONOME (consolidation,
      // étude), l'attaché n'écrit que SES skills (auto-*), avec description
      // obligatoire (c'est elle qui déclenche la skill) et plafond
      // anti-prolifération — la liste des skills se paie dans CHAQUE prompt.
      if (IS_RUN_AUTONOME) {
        const nom = safeSkillName(a.nom)
        if (!nom.startsWith(AUTO_SKILL_PREFIX)) {
          throw new Error(`Run autonome : seules les skills « ${AUTO_SKILL_PREFIX}* » t'appartiennent. Pour améliorer la skill du magistrat « ${nom} », dépose proposer_skill (contenu complet révisé + motif) — il appliquera d'un ✓.`)
        }
        if (!String(a.description || '').trim()) {
          throw new Error('Description obligatoire pour une skill auto-* : une phrase qui dit QUAND l\'appliquer — sans elle, la skill ne se déclenchera jamais.')
        }
        if (!readSkill(keys, nom) && countAutoSkills(keys) >= AUTO_SKILLS_MAX) {
          throw new Error(`Plafond de ${AUTO_SKILLS_MAX} skills auto-* atteint : chaque skill listée coûte des jetons à chaque run. FUSIONNE d'abord (skill_lire les auto-* proches, regroupe, skill_supprimer les doublons) avant d'en créer une nouvelle.`)
        }
      }
      return saveSkill(keys, a)
    },
    write: true,
  },
  {
    name: 'skill_supprimer',
    description: 'Supprime une skill du magistrat par son nom (réversible : la dernière version reste archivée côté serveur). À utiliser uniquement quand il te le demande explicitement (« supprime la skill Z »).',
    inputSchema: { type: 'object', properties: { nom: { type: 'string' } }, required: ['nom'] },
    handler: async (a) => ({ ok: await deleteSkill(a.nom) }),
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
        cible: { type: 'string' }, objet: { type: 'string' },
        type: { type: 'string', description: 'Catégorie de l\'AUTRE acte — mêmes CLÉS qu\'enregistrer_acte (art76, imsi_donnees, imsi_interceptions, captation_images_public, captation_images_prive, sonorisation_prive, drone_public, drone_prive, captation_donnees_informatiques, activation_fixe, activation_mobile, infiltration) pour pré-remplir la fiche légale ; libellé libre seulement si aucune catégorie ne convient.' },
        description: { type: 'string' },
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
    name: 'recouper_personnes',
    description: 'RECOUPEMENT global d\'une liste de noms détectés dans une pièce, AVANT de créer un dossier. Pour chacun : déjà mis en cause d\'un dossier réel (source « dossier », avec les numéros) / déjà présent comme MEC ex nihilo sur la carte (source « carto ») / nouveau. À utiliser systématiquement avant proposer_dossier ou proposer_dossier_carto pour ne pas dupliquer une personne connue et pour signaler les recoupements inter-dossiers.',
    inputSchema: {
      type: 'object',
      properties: { noms: { type: 'array', items: { type: 'string' }, description: 'Noms détectés (un par personne)' } },
      required: ['noms'],
    },
    handler: async (a) => recoupementMecs(keys, a.noms),
  },
  {
    name: 'proposer_dossier',
    description: 'Propose la CRÉATION d\'un nouveau dossier réel, extrait d\'un PV/résumé collé — n\'écrit PAS directement : la proposition apparaît avec ✓/✗ (le dossier n\'est créé qu\'à la validation, signé du nom du magistrat). Renseigne toi-même : numero (nom/numéro du dossier), dateDebut, services (service d\'enquête), description (objet, format prise de notes), misEnCause. RECOUPE d\'abord les noms (recouper_personnes) pour ne pas dupliquer une personne déjà connue. Refus automatique si le numéro existe déjà. Toujours citer la source.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Nom/numéro du dossier (identifiant, ex: « 2024-0142 » ou « Réseau ZOUAOUI »)' },
        dateDebut: { type: 'string', description: 'Date de début AAAA-MM-JJ (défaut : aujourd\'hui)' },
        services: { type: 'array', items: { type: 'string' }, description: 'Service(s) d\'enquête (ex: « GIR Amiens »)' },
        description: { type: 'string', description: 'Objet du dossier — faits, qualification, résumé télégraphique' },
        misEnCause: {
          type: 'array',
          description: 'Mis en cause détectés',
          items: { type: 'object', properties: { nom: { type: 'string' }, role: { type: 'string' }, statut: { type: 'string' } }, required: ['nom'] },
        },
        source: { type: 'string', description: 'Pièce d\'où vient la détection (ex: PV D8092, résumé collé le 14/07)' },
      },
      required: ['numero', 'source'],
    },
    handler: async (a) => addProposition(keys, {
      numero: a.numero, type: 'dossier', source: a.source,
      payload: { numero: a.numero, dateDebut: a.dateDebut, services: a.services, description: a.description, misEnCause: a.misEnCause },
    }),
    write: true,
  },
  {
    name: 'proposer_dossier_carto',
    description: 'Propose la création d\'un dossier EX NIHILO sur la carte (nœud d\'annotation, distinct des vrais dossiers) depuis la cartographie — n\'écrit PAS directement : ✓/✗. À la validation, les mis en cause déjà connus (dossier réel ou carte) sont RATTACHÉS, les inconnus sont créés comme MEC ex nihilo (« mis en cause lié ex nihilo »). RECOUPE d\'abord (recouper_personnes). Refus automatique si un dossier ex nihilo du même libellé existe. Toujours citer la source.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Libellé court du dossier (ex: « Réseau ZOUAOUI », « 2018-1234 vieux jugement »)' },
        dateApprox: { type: 'string', description: 'Date approximative (ISO ou texte libre)' },
        misEnCause: { type: 'array', items: { type: 'string' }, description: 'Noms des personnes liées (connues → rattachées, inconnues → créées ex nihilo)' },
        natinfCodes: { type: 'array', items: { type: 'string' }, description: 'Codes NATINF associés (optionnel)' },
        notes: { type: 'string' },
        source: { type: 'string', description: 'Pièce d\'où vient la détection' },
      },
      required: ['label', 'source'],
    },
    handler: async (a) => addProposition(keys, {
      type: 'dossier_carto', source: a.source,
      payload: { label: a.label, dateApprox: a.dateApprox, misEnCause: a.misEnCause, natinfCodes: a.natinfCodes, notes: a.notes },
    }),
    write: true,
  },
  {
    name: 'proposer_mec_carto',
    description: 'Propose une PERSONNE EX NIHILO autonome sur la carte (un suspect, une figure de renseignement, un SURNOM entendu dans les pièces) qui n\'apparaît dans AUCUN dossier réel — n\'écrit PAS directement : ✓/✗. Distinct de proposer_dossier_carto (qui crée un dossier + ses personnes) : ici une SEULE personne, avec ses alias/surnoms. Créée sur la carte au ✓. Refus automatique si la personne existe déjà (dossier réel ou carte). Recoupe d\'abord (recouper_personnes). Toujours citer la source. Ensuite, relie-la avec proposer_lien.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom ou désignation principale de la personne' },
        alias: { type: 'array', items: { type: 'string' }, description: 'Surnoms / alias entendus (ex: « le Grand », « Momo »)' },
        notes: { type: 'string', description: 'Ce qu\'on sait d\'elle et pourquoi elle compte (rôle supposé, dossiers où elle est évoquée)' },
        source: { type: 'string', description: 'Pièce(s) d\'où vient la détection (ex: PV D8092 du dossier X)' },
      },
      required: ['nom', 'source'],
    },
    handler: async (a) => addProposition(keys, {
      type: 'mec_carto', source: a.source,
      payload: { nom: a.nom, alias: a.alias, notes: a.notes },
    }),
    write: true,
  },
  {
    name: 'carto_analyser',
    description: 'Analyse le réseau (cartographie) : figures centrales, « ponts » (personnes présentes dans plusieurs dossiers, qui relient des affaires), co-occurrences, nombre de liens de renseignement déjà tracés. Pour aider à voir les connexions et améliorer la visibilité. Interpréter : centralité, cloisonnements, liens manquants à tracer.',
    inputSchema: { type: 'object', properties: { archives: { type: 'boolean', description: 'Inclure les dossiers archivés' } } },
    handler: async (a) => { const r = analyserReseau(keys, { includeArchived: Boolean(a?.archives) }); delete r._liensExistantsKeys; return r },
  },
  {
    name: 'carto_rapprochements',
    description: 'Rapprochements inter-dossiers RAPIDES (sur le TEXTE des enquêtes seulement : objet, CR, actes — pas les pièces) : entités (téléphone, plaque, IBAN, ADRESSE) présentes dans plusieurs dossiers qui ne partagent AUCUN mis en cause — donc des ponts potentiels entre affaires que rien ne reliait. Pour une analyse EN PROFONDEUR (pièces, surnoms, personnes au 2nd plan, instruction), pars plutôt de carto_corpus. Pour chaque rapprochement pertinent, proposer_lien entre un MEC de chaque dossier, l\'entité partagée en source/label. Vérifie la pertinence (un numéro de service, une banque, ne relie rien).',
    inputSchema: { type: 'object', properties: { archives: { type: 'boolean' } } },
    handler: async (a) => rapprochementsInterDossiers(keys, { includeArchived: Boolean(a?.archives) }),
  },
  {
    name: 'carto_corpus',
    description: 'Point de départ de l\'ANALYSE TRANSVERSALE DE RENSEIGNEMENT : le corpus COMPLET — toutes les enquêtes (archivées comprises) ET tous les dossiers d\'instruction, avec leurs mis en cause déclarés et le nombre de pièces, plus les personnes/dossiers ex nihilo et liens déjà sur la carte. Les signaux faibles (surnoms, personnes au 2nd plan jamais mises en cause, adresses, plaques, téléphones, comptes reliant deux affaires) sont dans les PIÈCES : pour chaque dossier, dossier_arborescence puis lire_document (PV surtout), en DÉLÉGUANT à des sous_agents (un par dossier). Puis recouper_personnes et PROPOSE (jamais tracé d\'office) : proposer_lien, proposer_mec_carto, proposer_dossier_carto. Idéal en routine (« chaque semaine, cherche les liens cachés entre tous les dossiers »).',
    inputSchema: { type: 'object', properties: { archives: { type: 'boolean', description: 'Inclure les enquêtes archivées (défaut : oui)' } } },
    handler: async (a) => cartoCorpus(keys, { includeArchived: a?.archives !== false }),
  },
  {
    name: 'carto_lister_liens',
    description: 'Liste les liens de renseignement déjà tracés sur la carte (person↔person), pour éviter de re-proposer un lien existant.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => listerLiens(keys),
  },
  {
    name: 'proposer_lien',
    description: 'Propose un LIEN DE RENSEIGNEMENT entre deux personnes, détecté en lisant une pièce (communications récurrentes, lien familial, logistique, même adresse/plaque/téléphone…) et non encore tracé sur la carte. Créé sur la carte SEULEMENT au ✓ de l\'administrateur. Toujours citer la source. Les deux personnes peuvent être des MEC réels OU des personnes ex nihilo (proposer_mec_carto d\'abord si l\'une est un surnom/second plan absent des dossiers). `numero` FACULTATIF = dossier d\'où vient la détection (contexte d\'affichage) ; pour un lien transversal entre plusieurs affaires, laisse-le vide.',
    inputSchema: {
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Dossier d\'où vient la détection (facultatif)' },
        sourceNom: { type: 'string' }, targetNom: { type: 'string' },
        label: { type: 'string', description: 'Nature du lien (ex: communications, fournisseur, fratrie, même adresse)' },
        notes: { type: 'string' },
        source: { type: 'string', description: 'Pièce source (ex: PV D1808 du dossier X, retranscription du 12/07)' },
      },
      required: ['sourceNom', 'targetNom', 'source'],
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
    description: `Publie des items dans le brief du magistrat (widget du tableau de bord). Types : ${ITEM_TYPES.join(', ')}. Un projet_mail N'EST JAMAIS envoyé : le magistrat le copie et l'envoie lui-même — rédiger le corps prêt à coller (destinataire = ex. « Directeur d'enquête — GIR Amiens »). Une verification = ce que SEUL le magistrat peut faire (consulter NPP/Cassiopée…). Un appel = { qui, motif }. echeance = UNIQUEMENT ce que le tableau de bord n'affiche pas déjà seul (jamais un acte/géoloc/écoute qui expire, une pose non confirmée ou une attente JLD classique : déjà rappelés ailleurs).`,
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
    description: 'Publie une carte d\'INFORMATION dans le journal « pendant votre absence » : ce qui a été fait/repéré, à titre indicatif. type: mail_traite | synthese | prolongation | alerte | note. N\'utilise PAS signaler pour un acte ou un livrable déjà produit (produire_document / remettre_livrable créent déjà une carte reliée, éditable) — ce serait un doublon. Pour une QUESTION au magistrat, utilise poser_question (jamais signaler, jamais le mail).',
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
    // écritures, sous_agents (récursion) et les outils réservés à l'agent
    // principal (conversations privées) ne sont ni listés ni appelables.
    const availableTools = IS_SUBAGENT ? TOOLS.filter((t) => !t.write && !t.mainOnly && t.name !== 'sous_agents') : TOOLS
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
