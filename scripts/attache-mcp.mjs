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
} from './attache/dossier.mjs'
import { publishItems, ITEM_TYPES } from './attache/majordome.mjs'
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
