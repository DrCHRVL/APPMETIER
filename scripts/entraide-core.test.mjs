/**
 * SIRAL — module Entraide internationale : l'état d'une demande se DÉDUIT de
 * sa chronologie (lib/entraide/core.mjs).
 *
 * Vérifie le circuit d'une DEE reçue (T1 → signature → envoi → échéance à
 * 3 mois → relance → retour → T3 → AR → clôture), celui d'une demande émise
 * (4 mois, relance T4, prorogation à date fixe), les délais légaux DEE
 * (annexe B à 7 j, exécution à 120 j), les « prochaines actions », la
 * recherche d'autorités et l'apprentissage des mots-clés.
 *
 *   node scripts/entraide-core.test.mjs
 */
import {
  etatDemande,
  prochainesActions,
  ajouterMois,
  chercherAutorites,
  apprendreMotsCles,
  cleUrgence,
} from '../lib/entraide/core.mjs'
import { migrerServices } from '../lib/entraide/referentiels.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`❌ ${label}\n   attendu : ${JSON.stringify(expected)}\n   obtenu  : ${JSON.stringify(actual)}`)
  } else {
    console.log(`✓ ${label}`)
  }
}

let n = 0
const ev = (type, date, extra = {}) => ({ id: `e${++n}`, type, date, creeLe: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, ...extra })
const base = (sens, type, evenements, extra = {}) => ({
  id: 'd1', sens, type, refEsabora: 'B3221-2026/00001', pays: 'Belgique', objet: 'x',
  dateEnregistrement: evenements[0]?.date || '2026-01-01', evenements, creeLe: '', dateMiseAJour: '', ...extra,
})

// ── Dates ──
check('ajouterMois clampe la fin de mois', ajouterMois('2026-01-31', 1), '2026-02-28')
check('ajouterMois franchit l’année', ajouterMois('2025-11-15', 3), '2026-02-15')

// ── DEE reçue ──
const evs = [ev('reception', '2026-05-15')]
let d = base('recue', 'dee', evs)
let e = etatDemande(d, '2026-05-16')
check('reçue : à traiter', e.etape, 'a_traiter')
check('reçue : chez le greffe', e.chez, 'greffe')
check('DEE : annexe B à J+7', e.echeancesLegales.map((l) => [l.code, l.date, l.statut]), [
  ['ar_annexe_b', '2026-05-22', 'en_cours'],
  ['execution_dee', '2026-09-12', 'en_cours'],
])
check('DEE : prochaine date = annexe B', [e.prochaineDate, e.niveau], ['2026-05-22', 'proche'])
check('prochaine action = préparer T1', prochainesActions(d, e)[0], { action: 'preparer', libelle: 'Préparer le soit-transmis (T1)', doc: 't1', primaire: true })
check('AR annexe B proposé', prochainesActions(d, e).some((a) => a.action === 'ar_annexe_b'), true)

evs.push(ev('ar_annexe_b', '2026-05-19'), ev('document_prepare', '2026-05-20', { doc: 't1' }))
e = etatDemande(d, '2026-05-20')
check('T1 préparé : à signer, chez le magistrat', [e.etape, e.chez, e.docEnAttente?.doc], ['a_signer', 'magistrat', 't1'])
check('annexe B respectée', e.echeancesLegales[0].statut, 'respecte')
check('prochaine action = signer', prochainesActions(d, e)[0].action, 'signer')

evs.push(ev('signature', '2026-05-22', { doc: 't1', par: 'achevalier' }))
e = etatDemande(d, '2026-05-22')
check('signé : à envoyer', [e.etape, e.docEnAttente?.signePar], ['a_envoyer', 'achevalier'])

evs.push(ev('envoi_enqueteurs', '2026-05-27'))
e = etatDemande(d, '2026-06-01')
check('envoyé : chez les enquêteurs, échéance +3 mois', [e.etape, e.echeance?.date], ['chez_enqueteurs', '2026-08-27'])
check('le courrier n’est plus en attente', e.docEnAttente, null)

e = etatDemande(d, '2026-09-01')
check('retard après 3 mois', [e.niveau, e.joursRestants], ['retard', -5])
check('en retard : on propose la relance T2', prochainesActions(d, e)[0], { action: 'preparer', libelle: 'Préparer le ST de relance (T2)', doc: 't2', primaire: true })

evs.push(ev('relance_enqueteurs', '2026-09-03'))
e = etatDemande(d, '2026-09-04')
check('relance T2 : nouvelle échéance', [e.echeance?.date, e.nbRelances], ['2026-12-03', 1])

evs.push(ev('retour_enqueteurs', '2026-10-01', { partiel: true }))
check('retour partiel : l’attente continue', etatDemande(d, '2026-10-02').etape, 'chez_enqueteurs')

evs.push(ev('retour_enqueteurs', '2026-10-10'))
e = etatDemande(d, '2026-10-10')
check('retour complet : avis du magistrat, plus d’échéance interne', [e.etape, e.echeance], ['avis_magistrat', null])
check('exécution 90 j dépassée (non faite)', e.echeancesLegales[1].statut, 'depasse')

evs.push(ev('document_prepare', '2026-10-12', { doc: 't3', langue: 'fr' }), ev('signature', '2026-10-12', { doc: 't3' }), ev('envoi_autorite', '2026-10-13'))
e = etatDemande(d, '2026-10-14')
check('T3 envoyé : attente AR', [e.etape, e.chez], ['attente_ar', 'autorite'])
check('exécution faite, mais hors délai', [e.echeancesLegales[1].statut, e.echeancesLegales[1].faitLe], ['depasse_fait', '2026-10-13'])

evs.push(ev('ar_recu', '2026-10-30'))
check('AR reçu : à clôturer', etatDemande(d, '2026-10-30').etape, 'a_cloturer')
evs.push(ev('cloture', '2026-10-31'))
e = etatDemande(d, '2026-11-01')
check('clôturée', [e.etape, e.niveau, e.prochaineDate, e.dateCloture], ['cloturee', 'cloturee', null, '2026-10-31'])
evs.push(ev('retour_enqueteurs', '2026-11-01'))
check('un événement tardif ne rouvre pas le dossier', etatDemande(d, '2026-11-01').etape, 'cloturee')
evs.push(ev('reouverture', '2026-11-02'))
check('réouverture : étape d’avant', etatDemande(d, '2026-11-02').etape, 'a_cloturer')

// ── Demande émise ──
const evs2 = [ev('enregistrement', '2026-01-10'), ev('traduction_demandee', '2026-01-11')]
const d2 = base('emise', 'dee', evs2)
e = etatDemande(d2, '2026-01-12')
check('émise : en traduction, échéance +30 j', [e.etape, e.echeance?.date, e.chez], ['en_traduction', '2026-02-10', 'traduction'])
check('émise : pas de délais légaux DEE', e.echeancesLegales.length, 0)
evs2.push(ev('traduction_recue', '2026-02-01'), ev('envoi_autorite', '2026-02-05'))
e = etatDemande(d2, '2026-02-06')
check('émise envoyée : 4 mois', [e.etape, e.echeance?.date], ['attente_etranger', '2026-06-05'])
e = etatDemande(d2, '2026-06-10')
check('émise en retard : représenter au magistrat', prochainesActions(d2, e)[0].action, 'transmission_magistrat')
evs2.push(ev('prorogation', '2026-06-11', { echeance: '2026-10-01' }))
check('prorogation à date fixe', etatDemande(d2, '2026-06-12').echeance?.date, '2026-10-01')
evs2.push(ev('relance_autorite', '2026-10-02', { delaiMois: 4 }))
check('relance T4 avec délai de 4 mois', etatDemande(d2, '2026-10-03').echeance?.date, '2027-02-02')
evs2.push(ev('retour_execution', '2026-11-20'))
e = etatDemande(d2, '2026-11-21')
check('exécution reçue : avis du magistrat, clôture proposée', [e.etape, prochainesActions(d2, e)[0].action], ['avis_magistrat', 'cloturer'])

// ── Échéance légale manuelle & dormance ──
const d3 = base('recue', 'execution', [ev('reception', '2026-01-01')], {
  echeancesLegales: [{ id: 'p', date: '2026-09-13', libelle: 'Prescription de la peine' }],
})
e = etatDemande(d3, '2026-10-21')
check('prescription dépassée = retard', [e.niveau, e.echeancesLegales[0].statut, e.joursRestants], ['retard', 'depasse', -38])
const d4 = base('emise', 'do', [ev('enregistrement', '2025-01-01')])
e = etatDemande(d4, '2026-01-01')
check('sans échéance depuis un an : dormant', [e.niveau, e.dormant], ['aucune', true])
check('tri : retard avant dormant', cleUrgence(etatDemande(d3, '2026-10-21')) < cleUrgence(e), true)

// ── Autorités ──
const autorites = [
  { id: 'a1', nom: 'Parquet du Procureur du Roi de Mons', ville: 'Mons', pays: 'Belgique', motsCles: ['tournai'] },
  { id: 'a2', nom: 'Parquet de Bucarest', ville: 'Bucarest', pays: 'Roumanie', motsCles: ['bucuresti'] },
  { id: 'a3', nom: 'Tribunal de Mons-en-Barœul', ville: 'Mons-en-Barœul', pays: 'France', motsCles: [] },
]
check('« tournai » retrouve Mons grâce au mot-clé appris', chercherAutorites(autorites, 'tournai').map((a) => a.id), ['a1'])
check('« buc » retrouve Bucarest', chercherAutorites(autorites, 'buc').map((a) => a.id), ['a2'])
check('« mons » : le pays départage', chercherAutorites(autorites, 'mons', 'Belgique')[0].id, 'a1')
check('apprentissage : seuls les mots nouveaux', apprendreMotsCles(autorites[0], 'Tournai Hainaut parquet'), ['tournai', 'hainaut'])

// ── Reprise Excel : événements du même jour, même instant de saisie ──
{
  const t = '2026-10-30T10:00:00.000Z'
  const memeInstant = (type, date, extra = {}) => ({ id: `x${++n}`, type, date, creeLe: t, ...extra })
  const dx = base('recue', 'dee', [
    memeInstant('reception', '2024-02-19'),
    memeInstant('envoi_enqueteurs', '2024-03-26'),
    memeInstant('relance_enqueteurs', '2026-08-07'),
    memeInstant('retour_enqueteurs', '2026-08-07'),
    memeInstant('prorogation', '2026-08-07', { echeance: '2027-01-13' }),
  ])
  const ex = etatDemande(dx, '2026-10-30')
  check('relance du jour d’un retour : le dossier repart chez les enquêteurs', [ex.etape, ex.chez, ex.echeance?.date], ['chez_enqueteurs', 'enqueteurs', '2027-01-13'])
  // Saisies successives (horodatages distincts) : l'ordre de saisie prime.
  const dy = base('recue', 'dee', [ev('reception', '2026-01-05'), ev('envoi_enqueteurs', '2026-01-06'), ev('relance_enqueteurs', '2026-04-07'), ev('retour_enqueteurs', '2026-04-07')])
  check('saisie successive : retour après la relance → avis du magistrat', etatDemande(dy, '2026-04-08').etape, 'avis_magistrat')
}

// ── Dénonciation officielle ──
{
  const dE = base('emise', 'do', [ev('enregistrement', '2026-03-01'), ev('envoi_autorite', '2026-03-02')])
  let eE = etatDemande(dE, '2026-03-10')
  check('DO émise envoyée : attente de l’AR, à 4 mois', [eE.etape, eE.echeance?.date, eE.echeance?.libelle], ['attente_ar', '2026-07-02', 'Accusé de réception de l’autorité étrangère'.replace('’', "'")])
  check('DO émise : « réception confirmée » proposée', prochainesActions(dE, eE)[0].action, 'ar_recu_cloturer')
  const dR = base('recue', 'do', [ev('reception', '2026-03-01')])
  const eR = etatDemande(dR, '2026-03-02')
  check('DO reçue : accepter / refuser, pas de T1', prochainesActions(dR, eR).map((a) => a.action).slice(0, 2), ['do_accepter', 'do_refuser'])
}

// ── Drapeaux ──
{
  const evsF = [ev('reception', '2026-01-05'), ev('envoi_enqueteurs', '2026-01-06')]
  const sansDrapeau = etatDemande(base('recue', 'cri', evsF), '2026-01-10')
  const rouge = etatDemande(base('recue', 'cri', evsF, { drapeau: 'rouge' }), '2026-01-10')
  const orange = etatDemande(base('recue', 'cri', evsF, { drapeau: 'orange' }), '2026-01-10')
  check('drapeau : retour attendu à 3 / 2 / 1 mois', [sansDrapeau.echeance.date, orange.echeance.date, rouge.echeance.date], ['2026-04-06', '2026-03-06', '2026-02-06'])
  check('drapeau rouge : pré-alerte immédiate', [sansDrapeau.niveau, rouge.niveau], ['ok', 'proche'])
  check('drapeau : remonte dans le tri', cleUrgence(rouge) < cleUrgence(orange) && cleUrgence(orange) < cleUrgence(sansDrapeau), true)
}

// ── Correction manuelle de l'avancement (frise) ──
{
  const dP = base('recue', 'dee', [ev('reception', '2026-10-06'), ev('transmission_magistrat', '2026-10-06')])
  check('avant correction : avis du magistrat', etatDemande(dP, '2026-10-30').etape, 'avis_magistrat')
  dP.evenements.push(ev('repositionnement', '2026-10-30', { etape: 'a_signer', doc: 't1' }))
  const eP = etatDemande(dP, '2026-10-30')
  check('repositionné : ST (T1) à signer', [eP.etape, eP.docEnAttente?.doc, eP.chez], ['a_signer', 't1', 'magistrat'])
  dP.evenements.push(ev('repositionnement', '2026-10-30', { etape: 'chez_enqueteurs' }))
  check('repositionné chez les enquêteurs : retour à 3 mois', etatDemande(dP, '2026-10-30').echeance?.date, '2027-01-30')
}

// ── Services : remise à niveau des anciennes trames ──
{
  const anciens = [
    { id: 'ddsp_amiens', libelle: "Police — Commissariat d'Amiens", cases: ['ddsp', 'comm_amiens'] },
    { id: 'drpj_amiens', libelle: "DRPJ Lille — Antenne d'Amiens", cases: ['drpj', 'antenne_amiens'] },
    { id: 'cgd_amiens', libelle: "Compagnie de gendarmerie d'Amiens", cases: ['cgd', 'cgd_amiens'] },
  ]
  const m = migrerServices(anciens, [])
  check('migration : DRPJ supprimée, commissariat renommé', [m.supprimes, m.services.map((x) => [x.id, x.libelle, x.cases])], [['drpj_amiens'], [['ddsp_amiens', "Commissariat d'Amiens", ['comm_amiens']], ['cgd_amiens', "Compagnie de gendarmerie d'Amiens", ['cgd', 'cgd_amiens']]]])
  check('migration : DRPJ utilisée conservée', migrerServices(anciens, [{ serviceId: 'drpj_amiens' }]).supprimes, [])
  check('migration : rien à faire ensuite', migrerServices(m.services.map(({ modifie, ...x }) => x), []), null)
}

if (failures) {
  console.error(`\n${failures} échec(s)`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
