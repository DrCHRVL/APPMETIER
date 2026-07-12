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
import { loadKeyring } from './attache/keyring.mjs'
import { attacheContentieux } from './attache/store.mjs'
import { audit, publishFeed } from './attache/journal.mjs'
import {
  listEnquetes, dossierMarkdown, readDocumentText, verifierCompletude,
  enregistrerActe, acterProlongation, classerNote, ajouterTodo, listerDml,
  actualiserDescription, diagnostiquerDossier,
} from './attache/dossier.mjs'
import { publishItems, ITEM_TYPES } from './attache/majordome.mjs'
import { saveArchitecture, loadArchitecture, buildChronologie } from './attache/cotes.mjs'
import { saveTrame, listTrames, readTrame } from './attache/trames.mjs'
import { addProposition, listPropositions } from './attache/propositions.mjs'
import { readDossierMemory, appendDossierMemory } from './attache/dossierMemory.mjs'
import { analyserReseau, listerLiens, rapprochementsInterDossiers } from './attache/carto.mjs'
import { appendMemory } from './attache/memory.mjs'
import { listInbox, readInboxMessage, markInboxProcessed, sendToOwner } from './attache/mail.mjs'

const keys = loadKeyring()
const runContext = process.env.SIRAL_ATTACHE_RUN || 'chat'

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
    description: 'Dossier complet en markdown : objet, mis en cause, actes (avec id et statut), à-faire, documents déposés, comptes-rendus chronologiques.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' } }, required: ['numero'] },
    handler: async (a) => dossierMarkdown(keys, a.numero) ?? { erreur: `Dossier ${a.numero} introuvable — utiliser lister_dossiers` },
  },
  {
    name: 'lire_document',
    description: 'Texte intégral d\'un document déposé au dossier (PDF/TXT/HTML). `chemin` = cheminRelatif tel que listé dans lire_dossier.',
    inputSchema: { type: 'object', properties: { numero: { type: 'string' }, chemin: { type: 'string' } }, required: ['numero', 'chemin'] },
    handler: async (a) => readDocumentText(keys, a.numero, a.chemin),
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
    name: 'signaler',
    description: 'Publie une carte dans le fil « pendant votre absence » du panneau : ce qui a été préparé, à relire. type: mail_traite | synthese | acte | prolongation | projet_reponse | alerte | note.',
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
    if (method === 'tools/list') {
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) })
    }
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name)
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
