/**
 * SIRAL — module Entraide : lecture d'une décision d'enquête européenne
 * (formulaire annexe A de la directive 2014/41/UE, version française) et
 * recherche des demandes déjà enregistrées qui lui correspondent.
 *
 * Lecture déterministe du texte du formulaire (sections A à L), faite dans le
 * navigateur : rien ne quitte le poste, aucun modèle n'est appelé. Ce qui
 * n'est pas lu reste vide ; l'utilisateur vérifie avant de créer.
 */
import { normaliser } from './core.mjs'
import { PAYS, paysDe } from './referentiels.mjs'

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']

/** « 15 décembre 2026 », « 1er mars 2026 », « 15/12/2026 » → AAAA-MM-JJ (sinon ''). */
export function dateIso(s) {
  const t = String(s || '')
  let m = t.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = normaliser(t).match(/(\d{1,2})(?: ?er)? ([a-z]+) (\d{4})/)
  if (m && MOIS.includes(m[2])) return `${m[3]}-${String(MOIS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

/** Premières phrases entières d'un texte, sans dépasser `max` caractères. */
function phrases(s, max) {
  const t = String(s || '')
  if (t.length <= max) return t
  const coupe = t.slice(0, max).lastIndexOf('. ')
  return coupe > 40 ? t.slice(0, coupe + 1) : `${t.slice(0, max - 1)}…`
}

/** Toutes les dates d'un texte, dans l'ordre. */
function dates(s) {
  const re = /\d{1,2}[/.]\d{1,2}[/.]\d{4}|\d{1,2}(?:er)?\s+[a-zA-Zéûè]+\s+\d{4}/g
  return (String(s || '').match(re) || []).map(dateIso).filter(Boolean)
}

/** Pays nommé dans un texte (« République fédérale d'Allemagne » → Allemagne). */
export function paysDans(s) {
  const t = ` ${normaliser(s)} `
  let best = null
  for (const p of PAYS) {
    const n = normaliser(p.nom)
    if (t.includes(` ${n} `) && (!best || n.length > normaliser(best.nom).length)) best = p
  }
  return best
}

const vide = (v) => {
  const t = String(v || '').replace(/\.{3,}/g, '').replace(/\s+/g, ' ').trim()
  return /^(neant|non connue?s?|neant connue?s?|sans objet|inconnue?s?|n\/a)\.?$/.test(normaliser(t)) ? '' : t
}

/** Découpe le texte en sections (A, B, C, … H1 … H7, I, J, K, L). */
function sections(texte) {
  const out = {}
  const re = /^SECTION\s+([A-L])(\d?)\b[^\n]*$/gm
  const marques = [...texte.matchAll(re)]
  marques.forEach((m, i) => {
    const cle = m[1] + m[2]
    const fin = i + 1 < marques.length ? marques[i + 1].index : texte.length
    if (!(cle in out)) out[cle] = texte.slice(m.index + m[0].length, fin).trim()
  })
  return out
}

// Libellés de champ du formulaire : une ligne qui commence par l'un d'eux
// suivi de « : » ouvre un nouveau champ (la valeur peut courir sur plusieurs lignes).
const LIBELLES = [
  "État d'émission", "État d'exécution", 'Nom', 'Prénom(s)', 'Tout autre nom utile', 'Pseudonyme(s)', 'Sexe',
  'Nationalité', "Numéro d'identité", 'Type et numéro', 'Date de naissance', 'Lieu de naissance',
  'Résidence et/ou adresse', 'Langue(s)', 'Dénomination', 'Forme juridique', 'Siège social',
  "Numéro d'immatriculation", 'Adresse', 'Nom du représentant', "Nom de l'autorité", 'Nom/Titre/Organisation',
  'Dossier n°', 'N° de téléphone', 'N° de télécopieur', 'Adresse électronique', 'Langues dans lesquelles',
  'Fonction', 'Date', 'Cachet officiel', 'Personne à contacter', 'Nom officiel',
].map(normaliser)

function debutChamp(ligne) {
  const m = ligne.match(/^([^:☐☑]{2,110}?)\s*:\s*(.*)$/)
  if (!m) return null
  const lib = normaliser(m[1])
  return LIBELLES.some((l) => lib === l || lib.startsWith(`${l} `)) ? { libelle: m[1].trim(), valeur: m[2] } : null
}

/** Champs « Libellé : valeur » d'une section, dans l'ordre. */
function champs(sec) {
  const out = []
  let cour = null
  for (const brute of String(sec || '').split('\n')) {
    const ligne = brute.trim()
    const d = debutChamp(ligne)
    if (d) { cour = { libelle: d.libelle, valeur: d.valeur }; out.push(cour); continue }
    if (!ligne || /^[☐☑]|^(veuillez|[0-9]\.|i+\)|si elle|si elles)/i.test(ligne)) { cour = null; continue }
    if (cour) cour.valeur += ` ${ligne}`
  }
  return out.map((c) => ({ libelle: c.libelle, cle: normaliser(c.libelle), valeur: vide(c.valeur) }))
}

const champ = (liste, debut) => liste.find((c) => c.cle.startsWith(normaliser(debut)))?.valeur || ''

/** Segments cochés (☑) d'un texte, une case par segment. */
function coches(sec) {
  const out = []
  for (const ligne of String(sec || '').split('\n')) {
    const parts = ligne.split(/(?=[☐☑])/)
    for (const p of parts) if (p.startsWith('☑')) out.push(p.slice(1).replace(/\s+/g, ' ').trim())
  }
  return out
}

/** Texte d'une section privé des lignes de cases non cochées. */
const sansNonCoches = (sec) => String(sec || '').split('\n').map((l) => l.split(/(?=[☐☑])/).filter((p) => !p.startsWith('☐')).join(' ')).join('\n')

// Mesures du catalogue reconnues dans la section C (mots-clés sur le texte coché).
const REGLES_MESURES = [
  ['requisitions_internet', /adresses? ip|ipv[46]|fournisseurs? (d.acces|de services)|adresse (electronique|mail)|compte en ligne/],
  ['requisitions_telephonie', /telephon|msisdn|imsi|imei/],
  ['requisitions_bancaires', /comptes? bancaires?|operations? bancaires?|comptes? financiers?|operations? financieres|releves? (de compte|des operations)/],
  ['casier', /casier|antecedents judiciaires|bundeszentralregister/],
  ['verification_identite', /pieces? d.identite|passeports?|cartes? d.identite|etat civil/],
  ['verification_adresse', /registre de la population|adresse actuelle|residence declaree|domiciliation/],
  ['requisitions_vehicule', /immatriculation d.un vehicule|titulaire d.un vehicule|identification d.un vehicule|certificat d.immatriculation/],
  ['audition_temoin', /audition d.un temoin|entendre .{0,30}temoin/],
  ['audition_suspect', /audition d.un suspect|personne poursuivie.{0,10}audition/],
  ['audition_victime', /audition d.une victime/],
  ['audition_visio', /videoconference|teleconference/],
  ['perquisition', /perquisition/],
  ['saisie', /saisie|mesures? provisoires?/],
  ['interception', /interception/],
  ['expertise', /expertise|prelevement/],
  ['constatations', /constatations/],
]

// Sous-cases « ☑ d'un témoin / d'un suspect… » (sous « Audition ») : le mot
// « audition » est sur la case mère, pas sur la sous-case cochée.
const SOUS_CASES = [['audition_temoin', /^d un temoin/], ['audition_suspect', /^d un suspect/], ['audition_victime', /^d une victime/]]

function mesuresDe(secC) {
  const t = ` ${normaliser(sansNonCoches(secC))} `
  const cases = coches(secC).map(normaliser)
  return REGLES_MESURES
    .filter(([id, re]) => re.test(t) || SOUS_CASES.some(([sid, sre]) => sid === id && cases.some((c) => sre.test(c))))
    .map(([id]) => id)
}

/** « EXTORSION EN BANDE ORGANISÉE » → « Extorsion en bande organisée ». */
const casPhrase = (s) => { const t = s.toLowerCase().replace(/\s+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }

function infractionsDe(secG) {
  const plat = String(secG || '').replace(/\s+/g, ' ')
  const qualifs = [...plat.matchAll(/[–-]\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý0-9'’ ,()-]{5,}?)\s*,\s*(?:infraction|faits?|d[ée]lit|crime)\b/g)]
    .map((m) => casPhrase(m[1]))
  const natinf = Array.from(new Set([...plat.matchAll(/NATINF\s*(?:n°\s*)?(\d{2,6})/gi)].map((m) => m[1])))
  let libre = ''
  if (!qualifs.length) {
    const m = plat.match(/code applicable\s*:\s*(.{5,300}?)(?:\s3\.\s|$)/i)
    libre = m ? vide(m[1]).slice(0, 200) : ''
  }
  const faits = plat.match(/Faits commis\s+(?:le|du|entre|courant|depuis)\s+(.{4,80}?)\s+à\s+([^.;]{2,80})/i)
  return { qualifs: qualifs.length ? qualifs : libre ? [libre] : [], natinf, dateFaits: faits ? faits[1].trim() : '', lieuFaits: faits ? faits[2].trim() : '' }
}

/** Personnes physiques (section E, i) et morales (ii). */
function personnesDe(secE) {
  const [phys, mor = ''] = String(secE || '').split(/^ii\)/m)
  const out = []
  let p = null
  for (const c of champs(phys)) {
    if (c.cle === 'nom') { p = { nom: c.valeur, prenoms: '', naissance: '', lieuNaissance: '', adresse: '', nationalite: '' }; out.push(p); continue }
    if (!p) continue
    if (c.cle.startsWith('prenom')) p.prenoms = c.valeur
    else if (c.cle.startsWith('date de naissance')) p.naissance = c.valeur
    else if (c.cle.startsWith('lieu de naissance')) p.lieuNaissance = c.valeur
    else if (c.cle.startsWith('residence')) p.adresse = c.valeur
    else if (c.cle.startsWith('nationalite')) p.nationalite = c.valeur
  }
  const morale = champs(mor)
  const denom = champ(morale, 'Dénomination')
  if (denom) out.push({ nom: denom, prenoms: '', naissance: '', lieuNaissance: '', adresse: champ(morale, 'Siège social') || champ(morale, 'Adresse'), nationalite: '' })
  const qualite = coches(String(secE || '').split(/qualit[ée] de la personne/i)[1] || '')[0] || ''
  const q = normaliser(qualite)
  const court = q.startsWith('suspect') ? 'suspect' : q.startsWith('victime') ? 'victime' : q.startsWith('temoin') ? 'témoin' : q.startsWith('expert') ? 'expert' : q.startsWith('tiers') ? 'tiers' : vide(qualite.replace(/^autre[^:]*:?/i, ''))
  return out.filter((x) => x.nom).map((x) => ({ ...x, qualite: court }))
}

/** « BAYROUTI Ibrahim, né(e) le 31/12/2003 à Datteln (Allemagne), demeurant … (suspect) ». */
export function personnesEnTexteDee(personnes) {
  return (personnes || []).map((p) => {
    const nom = [p.nom, p.prenoms].filter(Boolean).join(' ')
    const ne = p.naissance ? `né(e) le ${p.naissance}${p.lieuNaissance ? ` à ${p.lieuNaissance}` : ''}` : ''
    const adr = p.adresse ? `demeurant ${p.adresse.split(/\s[–-]\s/)[0]}` : ''
    return [nom, ne, adr].filter(Boolean).join(', ') + (p.qualite ? ` (${p.qualite})` : '')
  }).join(' ; ')
}

/** Autorité lue dans une valeur « Pays – Autorité, adresse, CP Ville – courriel – tél. ». */
function autoriteDe(valeur) {
  const parts = String(valeur || '').split(/\s[–-]\s/)
  const corps = parts.slice(1).join(' – ')
  const nom = vide(corps.split(',')[0])
  const ville = (corps.match(/\b\d{4,5}\s+([A-ZÀ-ÖØ-Ý][\p{L}'’-]+(?:[ -][A-ZÀ-ÖØ-Ý][\p{L}'’-]+)?)/u) || [])[1] || ''
  const email = (corps.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || ''
  return { nom, ville, email }
}

/**
 * Lit le texte d'une DEE (annexe A, en français). Rend null si le texte n'est
 * pas un formulaire de DEE.
 */
export function lireDee(texteBrut) {
  const texte = String(texteBrut || '')
    .replace(/\r/g, '')
    .replace(/[’`]/g, "'")
    .split('\n').filter((l) => !/[–-]\s*page\s+\d+\s*$/i.test(l.trim())).join('\n')
  if (!/D[ÉE]CISION D'ENQU[ÊE]TE EUROP[ÉE]ENNE/i.test(texte) || !/^SECTION\s+A\b/m.test(texte)) return null
  const s = sections(texte)

  const a = champs(s.A)
  const emission = champ(a, "État d'émission")
  const execution = champ(a, "État d'exécution")
  const emise = /\bfrance\b/.test(normaliser(emission.split(/\s[–-]\s/)[0])) || (!emission && !!execution && !/\bfrance\b/.test(normaliser(execution)))
  const etranger = emise ? execution : emission
  const pays = paysDans(etranger.split(/\s[–-]\s/)[0]) || paysDans(etranger)

  const k = champs(s.K)
  const autoriteA = autoriteDe(etranger)
  // DEE reçue : l'autorité d'émission se présente en section K (nom, dossier, adresse).
  const autorite = emise
    ? autoriteA
    : { nom: champ(k, "Nom de l'autorité") || autoriteA.nom, ville: autoriteDe(` – x, ${champ(k, 'Adresse')}`).ville || autoriteA.ville, email: champ(k, 'Adresse électronique') || autoriteA.email }
  const dossier = champ(k, 'Dossier n°')
  const signature = (s.K || '').split(/Signature de l'autorit/i)[1] || ''
  const dateEmission = dateIso(champ(champs(signature), 'Date')) || dates((texte.match(/Fait à [^\n]*/) || [''])[0]).pop() || ''

  // Urgence et délai (section B)
  const urgenceCochee = coches(s.B)
  const precis = vide(((s.B || '').split(/pr[ée]ciser ci-apr[èe]s\s*:/i)[1] || '').split(/Les d[ée]lais impartis/i)[0])
  const delai = (s.B || '').split(/la date et la justifier\s*:?/i)[1] || ''
  const dateButoir = dates(delai).pop() || ''

  const secC = (s.C || '')
  const titres = [...secC.matchAll(/^Mesure n°\s*\d+\s*[–-]\s*(.+)$/gim)].map((m) => m[1].trim())
  const inf = infractionsDe(s.G)

  const ref = (texte.match(/\b[A-Z]\d{4}-\d{4}\/\d{5}\b/) || [])[0] || ''
  const procedure = (texte.match(/Proc[ée]dure\s+(?:n°\s*)?(\d{2,4}\/\d{1,6})/i) || [])[1]
    || (dossier.match(/\d{2,4}\/\d{1,6}/) || [])[0] || ''

  return {
    sens: emise ? 'emise' : 'recue',
    pays: pays?.nom || '',
    autorite: { ...autorite, pays: pays?.nom || '' },
    /** DEE reçue : référence de l'autorité d'émission (V/réf). */
    refEtrangere: emise ? '' : dossier,
    /** N° ESABORA s'il figure sur la pièce. */
    refEsabora: ref,
    /** Référence de la procédure française (DEE émise) ou étrangère. */
    dossier,
    procedure,
    dateEmission,
    urgence: urgenceCochee.length ? phrases(precis, 400) || urgenceCochee.join(' ; ') : '',
    dateButoir,
    mesures: mesuresDe(secC),
    mesuresTitres: titres,
    personnes: personnesDe(s.E),
    infractions: inf.qualifs,
    natinf: inf.natinf,
    dateFaits: inf.dateFaits,
    lieuFaits: inf.lieuFaits,
  }
}

/**
 * Demandes déjà enregistrées qui correspondent à la DEE lue, les plus sûres
 * d'abord. `fort` : même référence (ESABORA, étrangère ou n° de procédure).
 */
export function demandesCorrespondantes(demandes, fiche) {
  if (!fiche) return []
  const mots = (s) => ` ${normaliser(s)} `
  const refs = [fiche.procedure, ...(String(fiche.dossier || '').match(/\d{2,4}\/\d{1,6}/g) || [])].filter(Boolean).map((r) => normaliser(r))
  const noms = Array.from(new Set((fiche.personnes || []).flatMap((p) => normaliser(p.nom).split(' ')).filter((w) => w.length >= 3)))
  const out = []
  for (const d of demandes || []) {
    const motifs = []
    let fort = false
    if (fiche.refEsabora && normaliser(d.refEsabora) === normaliser(fiche.refEsabora)) { motifs.push('même n° ESABORA'); fort = true }
    if (fiche.refEtrangere && d.refEtrangere && normaliser(d.refEtrangere) === normaliser(fiche.refEtrangere)) { motifs.push('même référence étrangère'); fort = true }
    const texte = mots([d.refEsabora, d.refEtrangere, d.objet, d.personnes, d.observations].join(' '))
    const proc = refs.find((r) => texte.includes(` ${r} `))
    if (proc) { motifs.push(`même n° de procédure (${proc})`); fort = true }
    const nomsCommuns = noms.filter((n) => mots(`${d.personnes || ''} ${d.objet || ''}`).includes(` ${n} `))
    if (nomsCommuns.length) motifs.push(`même personne (${nomsCommuns.map((n) => n.toUpperCase()).join(', ')})`)
    if (!motifs.length) continue
    const memePays = !!fiche.pays && paysDe(d.pays)?.nom === fiche.pays
    if (!fort && !memePays) continue
    if (memePays) motifs.push(`même pays (${fiche.pays})`)
    out.push({ demande: d, motifs, fort, score: (fort ? 10 : 0) + (memePays ? 2 : 0) + (d.type === 'dee' ? 1 : 0) + (d.sens === fiche.sens ? 1 : 0) })
  }
  return out.sort((x, y) => y.score - x.score)
}
