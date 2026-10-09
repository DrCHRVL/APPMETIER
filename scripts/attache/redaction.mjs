/**
 * SIRAL — Attaché de justice · DOSSIER DE RÉDACTION prêt à verser.
 *
 * Une archive .zip qui donne à un projet Claude web, en un geste, tout ce
 * qu'il attend pour rédiger un acte sur un dossier :
 *   - le FICHIER GLOBAL du dossier (toutes les pièces en texte, fiche,
 *     chronologie, registre, classement par thème) ;
 *   - les TRAMES et SKILLS du magistrat applicables à l'acte visé (toutes,
 *     si aucun acte n'est nommé) ;
 *   - les documents ★ RÉFLEXES de la base de connaissances (Memento…), plus
 *     ceux dont le titre ou la description rejoint l'acte visé ;
 *   - les ACTES PRÉCÉDENTS du même type rangés dans le dossier (ce que le
 *     magistrat a déjà signé : la meilleure référence de style) ;
 *   - les INSTRUCTIONS DU PROJET Claude web (version de référence SIRAL) ;
 *   - un LISEZMOI qui dit quoi faire de chaque fichier.
 *
 * Tout est en texte (markdown / txt) : le projet reçoit sa base de
 * connaissances, pas des PDF à relire. Rien ne sort de SIRAL en clair ailleurs
 * que vers le navigateur de l'administrateur.
 */
import { compilerFichierGlobal } from './global.mjs'
import { listTrames, readTrame, MODELE_PREFIX } from './trames.mjs'
import { listSkills, readSkill } from './skills.mjs'
import { listKb, readKbEntry } from './kb.mjs'
import { listProductions, readProduction } from './productions.mjs'
import { readInstructionsProjet } from './instructionsProjet.mjs'
import { zipStore } from './zip.mjs'

const MOTS_VIDES = new Set(['dans', 'pour', 'avec', 'sans', 'sous', 'vers', 'chez', 'aux', 'des', 'les', 'une', 'par', 'sur', 'acte', 'actes', 'demande', 'projet', 'requete', 'reponse', 'cpp', 'art', 'article', 'jld', 'procureur', 'parquet', 'dossier'])

/** Mots significatifs d'un libellé, normalisés (casse, accents, pluriels simples). */
function mots(s) {
  return [...new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .map((m) => m.replace(/s$/, ''))
    .filter((m) => m.length >= 4 && !MOTS_VIDES.has(m)))]
}

/** Nombre de mots de l'acte visé retrouvés dans un libellé (nom + description). */
function score(motsActe, ...libelles) {
  const corpus = mots(libelles.filter(Boolean).join(' '))
  return motsActe.filter((m) => corpus.some((c) => c.startsWith(m) || m.startsWith(c))).length
}

const nomFichier = (s) => String(s || 'sans-titre').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || 'sans-titre'

const md = (s) => Buffer.from(String(s || ''), 'utf8')

/**
 * Assemble le dossier de rédaction. `acte` : libellé libre de l'acte visé
 * (« prolongation géolocalisation », « réquisitoire définitif », « réponse
 * DML ») — vide = tout emporter. Rend { nom, zip, fichiers, dossier, acte }.
 */
export async function dossierRedaction(keys, numero, { acte = '' } = {}) {
  const global_ = await compilerFichierGlobal(keys, numero)
  const canon = global_.dossier
  const motsActe = mots(acte)
  const cible = motsActe.length > 0
  const entries = []
  const fichiers = []
  const ajouter = (name, data) => { entries.push({ name, data }); fichiers.push(name) }

  // 1. Fichier global
  ajouter(`GLOBAL_${nomFichier(canon)}.txt`, md(global_.texte))

  // 2. Trames — celles de l'acte visé (modèles modele-* du même type compris), sinon toutes.
  const trames = listTrames(keys)
  const tramesRetenues = cible
    ? trames.filter((t) => score(motsActe, t.nom, t.description) > 0)
    : trames
  for (const t of tramesRetenues) {
    const full = readTrame(keys, t.nom)
    if (!full?.contenu) continue
    const tete = `# Trame « ${t.nom} »${t.description ? `\n\n> ${t.description}` : ''}${t.nom.startsWith(MODELE_PREFIX) ? '\n\n> Modèle extrait par l\'attaché des actes validés du magistrat — sa propre trame du même type prime.' : ''}\n\n`
    ajouter(`trames/${nomFichier(t.nom)}.md`, md(tete + full.contenu))
  }

  // 3. Skills — même sélection.
  const skills = listSkills(keys)
  const skillsRetenues = cible ? skills.filter((s) => score(motsActe, s.nom, s.description) > 0) : skills
  for (const s of skillsRetenues) {
    const full = readSkill(keys, s.nom)
    if (!full?.contenu) continue
    ajouter(`skills/${nomFichier(s.nom)}.md`, md(`---\nname: ${s.nom}\ndescription: ${String(s.description || '').replace(/\n+/g, ' ')}\n---\n\n${full.contenu}`))
  }

  // 4. Base de connaissances — les ★ réflexes toujours, plus ce qui rejoint l'acte (10 au plus).
  const kb = listKb(keys)
  const reflexes = kb.filter((e) => e.reflexe)
  const voisins = cible ? kb.filter((e) => !e.reflexe && score(motsActe, e.titre, e.description) > 0).slice(0, 10) : []
  for (const e of [...reflexes, ...voisins]) {
    const full = readKbEntry(keys, e.id)
    if (!full?.contenu) continue
    const tete = `# ${e.titre}${e.reflexe ? ' ★' : ''}\n\n> ${[e.categorie, e.chemin, e.description].filter(Boolean).join(' · ')}\n\n`
    ajouter(`base-de-connaissances/${nomFichier(e.titre)}.md`, md(tete + full.contenu))
  }

  // 5. Actes précédents du dossier — même type si un acte est visé (3), sinon les 5 derniers hors fiches/livrables.
  const productions = listProductions(keys, canon).filter((p) => p.type !== 'fiche' && !String(p.source || '').startsWith('chantier:'))
  const precedents = (cible
    ? productions.filter((p) => score(motsActe, p.titre, p.type, p.source) > 0)
    : productions.filter((p) => p.type !== 'livrable')
  ).slice(0, cible ? 3 : 5)
  for (const p of precedents) {
    const full = readProduction(keys, canon, p.id)
    if (!full?.contenu) continue
    const tete = `# ${p.titre}\n\n> ${[p.type, p.source ? `trame ${p.source}` : '', p.updatedAt ? `mis à jour le ${String(p.updatedAt).slice(0, 10)}` : '', p.traite ? 'validé par le magistrat' : 'en attente de validation'].filter(Boolean).join(' · ')}\n\n`
    ajouter(`actes-precedents/${nomFichier(p.titre)}.md`, md(tete + full.contenu))
  }

  // 6. Instructions du projet Claude web
  ajouter('INSTRUCTIONS-PROJET.md', md(readInstructionsProjet(keys)))

  // 7. LISEZMOI
  const lisezmoi = [
    `# Dossier de rédaction — ${canon}${acte ? ` — ${acte}` : ''}`,
    '',
    `Assemblé par SIRAL le ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Tout est en texte : versez le contenu de cette archive dans la base de connaissances de votre projet Claude web (ou glissez les fichiers dans la conversation), et rédigez.`,
    '',
    '## Contenu',
    '',
    `- \`GLOBAL_….txt\` — le fichier global du dossier : fiche (description, mis en cause, NATINF, échéancier), chronologie, registre des pièces, puis TOUTES les pièces en texte, classées par thème, chacune avec son numéro stable P-xxxx et son chemin (la cote). ${global_.stats.pieces} pièce(s)${global_.stats.nonExtraites ? `, dont ${global_.stats.nonExtraites} pas encore extraite(s) (relancer plus tard)` : ''}.`,
    `- \`trames/\` — ${tramesRetenues.length} trame(s)${cible ? ` retenue(s) pour « ${acte} »` : ' (toutes)'} : le plan-type à suivre à l'identique (visas, formules, mise en forme). Une trame du magistrat prime sur un modèle « modele-* ».`,
    `- \`skills/\` — ${skillsRetenues.length} skill(s)${cible ? ' retenue(s)' : ' (toutes)'} : la méthode de rédaction, au format skill Claude web (front-matter name/description).`,
    `- \`base-de-connaissances/\` — ${reflexes.length} document(s) ★ réflexe(s)${voisins.length ? ` et ${voisins.length} document(s) en rapport avec l'acte` : ''} : le fond (memento, circulaires, jurisprudence).`,
    `- \`actes-precedents/\` — ${precedents.length} acte(s) déjà rangé(s) dans ce dossier${cible ? ' du même type' : ''} : reprendre la motivation acquise, actualiser — on ne reperd jamais un acquis rédactionnel.`,
    '- `INSTRUCTIONS-PROJET.md` — les instructions de référence du projet Claude web, tenues dans SIRAL et révisées sur vos corrections : à coller dans les instructions du projet si elles ont changé.',
    '',
    '## Méthode',
    '',
    '1. Lire INSTRUCTIONS-PROJET.md, puis la trame et la skill de l\'acte visé.',
    '2. Lire le fichier global : la fiche et la chronologie d\'abord, puis les thèmes utiles à l\'acte (auditions, téléphonie, décisions…). Citer les pièces par leur numéro P-xxxx ou leur chemin.',
    '3. Reprendre l\'acte précédent du même type s\'il existe, actualiser avec les éléments nouveaux.',
    '4. Viser les NATINF enregistrés du dossier (section « Infractions (NATINF) » de la fiche).',
    '5. Ranger l\'acte rédigé dans SIRAL par le connecteur : `produire_document` (numero, type, titre daté, source = nom exact de la trame, acteMeta pour une écoute ou une géolocalisation).',
    '',
  ].join('\n')
  entries.unshift({ name: 'LISEZMOI.md', data: md(lisezmoi) })
  fichiers.unshift('LISEZMOI.md')

  const nom = `REDACTION_${nomFichier(canon)}${acte ? '_' + nomFichier(acte).replace(/ /g, '-') : ''}.zip`
  return { nom, zip: zipStore(entries), fichiers, dossier: canon, acte: acte || '' }
}
