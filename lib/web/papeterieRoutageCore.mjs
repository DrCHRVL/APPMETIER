/**
 * SIRAL — aiguillage des papeteries : cœur de décision (pur, testable).
 *
 * Choisir la papeterie d'un acte et y découper son texte se faisait par
 * expressions régulières sur le titre (« REQUÊTE… » → papeterie requête) et
 * sur des tournures (« Fait à … » pour la signature, une ligne en capitales
 * pour le titre). C'était approximatif : un acte au titre inhabituel partait
 * dans la mauvaise papeterie, un bandeau institutionnel restait collé au
 * corps, une signature passait inaperçue.
 *
 * Ce module met l'IA au bon endroit — c'est-à-dire le plus rarement possible :
 *
 *  1. CE QUI EST APPRIS PASSE EN PREMIER. Une fois que le magistrat a validé
 *     « les actes de la trame `enq-art-76` vont dans la papeterie Requête », la
 *     règle est écrite et rejouée : instantané, gratuit, sans appel au modèle.
 *     C'est SA décision qui fait autorité, pas une heuristique.
 *  2. L'HEURISTIQUE GARDE LES CAS FRANCS. Un acte qui porte un titre reconnu,
 *     une signature nette et aucun bandeau résiduel n'a besoin de personne :
 *     `decoupageDouteux()` le constate et l'IA n'est pas appelée.
 *  3. L'IA NE SERT QUE DANS LE DOUTE — acte d'un type jamais vu, structure
 *     inhabituelle. Et elle ne réécrit RIEN : elle rend des NUMÉROS DE LIGNE,
 *     l'application découpe le texte d'origine. Un acte signé ne peut donc pas
 *     être altéré, paraphrasé ni tronqué par le modèle.
 *  4. LA CORRECTION DU MAGISTRAT EST LA VÉRITÉ. S'il change la papeterie
 *     proposée, la règle est réécrite à son nom et le prochain acte du même
 *     type part directement au bon endroit — l'aiguillage se resserre à
 *     l'usage au lieu de répéter la même erreur.
 *
 * Aucun accès réseau ni stockage ici : `papeterieRoutage.ts` porte les règles,
 * `papeterieIA.ts` l'appel au service. Testé par
 * `node scripts/papeterie-routage.test.mjs`.
 */

// ── Clés de règle ────────────────────────────────────────────────────────────

/** Forme comparable d'un libellé : minuscules, sans accents ni ponctuation. */
export function normCle(s) {
  return String(s == null ? '' : s)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

/**
 * Clés candidates d'un acte, de la PLUS SPÉCIFIQUE à la plus générale :
 *  - `source:` la trame métier suivie pour rédiger l'acte (`enq-art-76`) —
 *    c'est le signal le plus fiable dont dispose l'application : deux actes
 *    issus de la même trame appellent la même papeterie ;
 *  - `titre:` le titre de l'acte, pour les actes rédigés hors trame ;
 *  - `type:` le type de production (requisition, soit_transmis…), filet large.
 */
export function clesActe(acte = {}) {
  const out = []
  const push = (prefixe, valeur) => {
    const v = normCle(valeur)
    if (v) out.push(`${prefixe}:${v}`)
  }
  push('source', acte.source)
  push('titre', acte.titre)
  push('type', acte.type)
  return out
}

/**
 * Clé sur laquelle GRAVER une règle — ce n'est pas la plus spécifique.
 * Un titre d'acte est souvent unique (« Réquisition — ligne 0601020304 ») :
 * une règle écrite dessus ne se rejouerait jamais et la question reviendrait à
 * chaque export. On retient donc la trame métier, à défaut le type de
 * production — deux clés STABLES — et le titre seulement en dernier recours.
 * La LECTURE, elle, reste du plus spécifique au plus général (`clesActe`) :
 * une règle posée sur un titre garde toute son autorité.
 */
export function cleRegle(acte = {}) {
  const cles = clesActe(acte)
  return cles.find((c) => c.startsWith('source:'))
    || cles.find((c) => c.startsWith('type:'))
    || cles[0]
    || ''
}

/** Rang d'une origine : la décision du magistrat prime sur celle de l'IA. */
const RANG_ORIGINE = { magistrat: 2, ia: 1 }

/**
 * Meilleure règle pour une clé : le magistrat d'abord, puis la plus récente.
 * Les règles visant une papeterie disparue sont ignorées (papeterie supprimée).
 */
export function meilleureRegle(regles, cle, papeteries) {
  const connus = new Set((papeteries || []).map((p) => p.id))
  return (regles || [])
    .filter((r) => r && r.cle === cle && connus.has(r.trameId))
    .sort((a, b) => (
      (RANG_ORIGINE[b.origine] || 0) - (RANG_ORIGINE[a.origine] || 0)
      || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    ))[0] || null
}

// ── Score local (sans modèle) ────────────────────────────────────────────────

/** Mots significatifs d'un « quand l'utiliser » (les outils grammaticaux sautent). */
const VIDES = new Set(['pour', 'les', 'des', 'une', 'aux', 'avec', 'dans', 'sur', 'par', 'que', 'qui', 'est', 'sont', 'tous', 'toutes', 'tout', 'toute', 'mes', 'nos', 'leur', 'leurs', 'quand', 'lorsque', 'cette', 'ces', 'son', 'sa', 'ses', 'and', 'the'])

export function motsCles(texte) {
  return [...new Set(normCle(texte).split('-'))]
    .filter((m) => m.length >= 4 && !VIDES.has(m))
    .slice(0, 24)
}

/**
 * Score d'adéquation d'une papeterie à un acte, sans appel au modèle :
 * concordance du type déduit, puis mots du « quand l'utiliser » retrouvés dans
 * l'en-tête de l'acte. Volontairement grossier — il ne sert qu'à trancher les
 * cas ÉVIDENTS ; en cas d'égalité ou de faiblesse, c'est l'IA qui départage.
 */
export function scoreLocal(papeterie, acte, typeDeduit) {
  let score = 0
  if (typeDeduit && papeterie.type === typeDeduit) score += 3
  const foin = normCle([acte.titre, String(acte.contenu || '').slice(0, 1200)].join(' '))
  for (const m of motsCles(papeterie.usage)) if (foin.includes(m)) score += 1
  for (const m of motsCles(papeterie.nom)) if (foin.includes(m)) score += 1
  return score
}

/**
 * Décision SANS modèle. Rend `null` quand le doute subsiste : l'appelant
 * interroge alors l'IA (ou, à défaut de service, retombe sur le type déduit).
 *
 * `certain` distingue ce qui part directement au téléchargement (une règle
 * déjà validée, ou une bibliothèque qui n'offre aucun choix) de ce qui mérite
 * un coup d'œil du magistrat avant d'imprimer sa papeterie sur un acte signé.
 */
export function choisirLocalement({ papeteries = [], regles = [], acte = {}, typeDeduit }) {
  if (!papeteries.length) return null

  for (const cle of clesActe(acte)) {
    const r = meilleureRegle(regles, cle, papeteries)
    if (!r) continue
    const p = papeteries.find((x) => x.id === r.trameId)
    return {
      trameId: p.id,
      origine: r.origine,
      certain: true,
      motif: r.origine === 'magistrat'
        ? `choix que vous avez retenu pour ${libelleCle(cle)}`
        : `règle apprise pour ${libelleCle(cle)}`,
      cle,
    }
  }

  if (papeteries.length === 1) {
    return { trameId: papeteries[0].id, origine: 'auto', certain: true, motif: 'seule papeterie enregistrée' }
  }

  // Score local : on ne tranche que si un candidat se détache NETTEMENT.
  const scores = papeteries.map((p) => ({ p, s: scoreLocal(p, acte, typeDeduit) }))
    .sort((a, b) => b.s - a.s)
  if (scores[0].s >= 3 && scores[0].s >= scores[1].s + 2) {
    return {
      trameId: scores[0].p.id,
      origine: 'auto',
      certain: false,
      motif: `type d'acte et intitulé concordants (${scores[0].p.type})`,
    }
  }
  return null
}

/** Libellé lisible d'une clé de règle, pour expliquer la décision. */
export function libelleCle(cle) {
  const [prefixe, ...reste] = String(cle || '').split(':')
  const v = reste.join(':')
  if (prefixe === 'source') return `les actes de la trame « ${v} »`
  if (prefixe === 'titre') return `les actes intitulés « ${v.replace(/-/g, ' ')} »`
  if (prefixe === 'type') return `les actes de type « ${v} »`
  return `« ${cle} »`
}

// ── Doute sur le découpage heuristique ───────────────────────────────────────

/** Une ligne d'identité institutionnelle (elle appartient à la papeterie). */
const RE_INSTIT = /(MINIST[ÈE]RE\s+DE\s+LA\s+JUSTICE|COUR\s+D['’]APPEL|TRIBUNAL\s+JUDICIAIRE|PARQUET|PROCUREUR\s+DE\s+LA\s+R[ÉE]PUBLIQUE|^SECTION\b)/i

/**
 * Le découpage heuristique est-il DOUTEUX ? C'est ce test qui décide d'appeler
 * l'IA ou non : un acte bien formé (titre reconnu, signature nette, corps net)
 * n'a rien à y gagner. On ne dépense un appel que là où les regex trébuchent.
 *
 * `structure` : ce que `parseActe`/`parseLettre` ont su isoler.
 */
export function decoupageDouteux(structure = {}, options = {}) {
  const motifs = []
  const corps = String(structure.corps || '')
  if (!corps.trim()) motifs.push('corps vide après découpage')
  if (options.courrier) {
    if (!String(structure.destinataire || '').trim()) motifs.push('destinataire non identifié')
    if (!String(structure.objet || '').trim()) motifs.push('objet non identifié')
  } else {
    if (!String(structure.titre || '').trim()) motifs.push('titre de l\'acte non reconnu')
    if (!String(structure.signature || '').trim()) motifs.push('bloc signature non repéré')
  }
  // Un bandeau resté en tête du corps ferait doublon avec l'en-tête de la trame.
  const premieres = corps.split('\n').filter((l) => l.trim()).slice(0, 3)
  if (premieres.some((l) => RE_INSTIT.test(l))) motifs.push('en-tête institutionnel resté dans le corps')
  return motifs
}

// ── Extrait envoyé au modèle ─────────────────────────────────────────────────

const TETE = 45
const QUEUE = 30
const LARGEUR = 140

/**
 * Lignes NUMÉROTÉES soumises au modèle. Deux économies, qui limitent aussi ce
 * qui sort de l'application : les frontières d'un acte sont à ses EXTRÉMITÉS
 * (bandeau et titre en tête, signature en pied) — le ventre du texte est du
 * corps par construction et n'est pas envoyé ; et chaque ligne est tronquée,
 * son DÉBUT suffisant à la reconnaître.
 */
export function lignesPourIA(contenu, opts = {}) {
  const tete = opts.tete || TETE
  const queue = opts.queue || QUEUE
  const largeur = opts.largeur || LARGEUR
  const lignes = String(contenu == null ? '' : contenu).replace(/\r\n?/g, '\n').split('\n')
  const total = lignes.length
  const court = (t) => (t.length > largeur ? `${t.slice(0, largeur)}…` : t)
  const out = []
  const pris = new Set()
  const ajouter = (i) => {
    if (pris.has(i) || i < 0 || i >= total) return
    pris.add(i)
    out.push({ n: i + 1, t: court(lignes[i].trim()) })
  }
  for (let i = 0; i < Math.min(tete, total); i += 1) ajouter(i)
  const coupe = out.length && total > tete + queue
  for (let i = Math.max(0, total - queue); i < total; i += 1) ajouter(i)
  out.sort((a, b) => a.n - b.n)
  return { lignes: out, total, tronque: Boolean(coupe) }
}

// ── Découpage rendu par le modèle ────────────────────────────────────────────

const entier = (v, total) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= total ? n : 0
}

/**
 * Valide le découpage rendu par le modèle : des NUMÉROS DE LIGNE, cohérents
 * entre eux et dans les bornes du texte. Au moindre écart on rend `null` et
 * l'appelant garde le découpage heuristique — jamais un acte à moitié rempli.
 */
export function validerDecoupage(dec, total) {
  if (!dec || typeof dec !== 'object' || !(total > 0)) return null
  const debut = entier(dec.corpsDebut, total)
  const fin = entier(dec.corpsFin, total)
  if (!debut || !fin || fin < debut) return null

  const out = { corpsDebut: debut, corpsFin: fin }
  const avant = (v) => (v && v < debut ? v : 0)
  const apres = (v) => (v && v > fin ? v : 0)

  out.titre = avant(entier(dec.titre, total))
  out.article = avant(entier(dec.article, total))
  if (out.article && out.titre && out.article <= out.titre) out.article = 0
  out.objet = avant(entier(dec.objet, total))
  out.date = entier(dec.date, total)
  if (out.date >= debut && out.date <= fin) out.date = 0

  // Adresse : une ou plusieurs lignes, toujours AVANT le corps. Une fin qui
  // déborde est ramenée juste avant le corps — pas effacée : c'est le bloc
  // d'adresse qui serait perdu, et il ne doit pas rester dans le corps.
  const dd = avant(entier(dec.destinataireDebut, total))
  const df = entier(dec.destinataireFin, total)
  out.destinataireDebut = dd
  out.destinataireFin = dd ? Math.min(Math.max(dd, df || dd), debut - 1) : 0

  out.signatureDebut = apres(entier(dec.signatureDebut, total))
  return out
}

/** Retire un préfixe de titre markdown (#, ##…) et les espaces de bord. */
const sansDiese = (l) => String(l || '').replace(/^\s*#{1,6}\s*/, '').trim()

/**
 * Applique un découpage validé au texte D'ORIGINE. Le modèle n'a désigné que
 * des lignes : tout ce qui sort d'ici est le texte du magistrat, au caractère
 * près. Les lignes non attribuées restent dans le corps — rien ne se perd.
 */
export function appliquerDecoupage(contenu, dec) {
  const lignes = String(contenu == null ? '' : contenu).replace(/\r\n?/g, '\n').split('\n')
  const at = (n) => (n ? sansDiese(lignes[n - 1]) : '')
  const corps = lignes.slice(dec.corpsDebut - 1, dec.corpsFin).join('\n').trim()
  const signature = dec.signatureDebut
    ? lignes.slice(dec.signatureDebut - 1).map((l) => sansDiese(l)).filter(Boolean)
    : []
  const destinataire = dec.destinataireDebut
    ? lignes.slice(dec.destinataireDebut - 1, dec.destinataireFin)
      .map((l) => l.trim()).filter(Boolean).join('\n')
    : ''
  return {
    titre: at(dec.titre),
    article: at(dec.article),
    corps,
    signature: signature.join('\n'),
    // « Objet : … » et « Amiens, le … » : on ne garde que la valeur, le libellé
    // et la ville appartenant à la papeterie.
    objet: at(dec.objet).replace(/^objet\s*:\s*/i, '').trim(),
    date: at(dec.date).replace(/^.*,\s*le\s+/i, '').trim(),
    destinataire,
  }
}
