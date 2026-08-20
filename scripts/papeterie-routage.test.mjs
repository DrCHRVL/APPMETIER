/**
 * SIRAL — aiguillage des papeteries : choix de la papeterie et découpage de l'acte.
 *
 * Ce qui est vérifié ici tient en une phrase : l'IA aide, mais elle ne décide
 * pas à la place du magistrat et elle ne touche pas au texte de l'acte.
 *
 *  - ce que le magistrat a retenu prime sur tout le reste, et l'IA ne peut pas
 *    le contredire ;
 *  - l'IA n'est sollicitée que dans le doute — un acte bien formé passe sans
 *    appel au modèle ;
 *  - le modèle ne reçoit que les EXTRÉMITÉS numérotées de l'acte et ne rend que
 *    des numéros de ligne : le texte remis est découpé dans l'original, au
 *    caractère près ;
 *  - un découpage incohérent est rejeté en bloc plutôt qu'appliqué à moitié.
 *
 *   node scripts/papeterie-routage.test.mjs
 */
import {
  appliquerDecoupage,
  choisirLocalement,
  cleRegle,
  clesActe,
  decoupageDouteux,
  lignesPourIA,
  meilleureRegle,
  normCle,
  scoreLocal,
  validerDecoupage,
} from '../lib/web/papeterieRoutageCore.mjs'

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`❌ ${label}\n   attendu : ${JSON.stringify(expected)}\n   obtenu  : ${JSON.stringify(actual)}`)
  } else {
    console.log(`✅ ${label}`)
  }
}
const checkThat = (label, cond) => check(label, Boolean(cond), true)

const PAP = [
  { id: 'p1', nom: 'Requête JLD', type: 'requete', usage: 'Pour les requêtes adressées au juge des libertés et de la détention.' },
  { id: 'p2', nom: 'Soit-transmis', type: 'soit-transmis', usage: 'Pour les soit-transmis aux services enquêteurs.' },
  { id: 'p3', nom: 'Courrier parquet', type: 'courrier', usage: 'Pour les courriers aux avocats et aux administrations.' },
]

// ── 1. Clés d'acte : de la plus spécifique à la plus générale ───────────────
{
  check('la trame métier passe avant le titre, puis le type',
    clesActe({ source: 'enq-art-76', titre: 'REQUÊTE AUX FINS', type: 'requisition' }),
    ['source:enq-art-76', 'titre:requete-aux-fins', 'type:requisition'])
  check('acte sans trame ni type : le titre suffit',
    clesActe({ titre: 'Soit-transmis' }), ['titre:soit-transmis'])
  check('accents et ponctuation neutralisés', normCle('Réquisition n°3 (JLD)'), 'requisition-n-3-jld')

  // Une règle se grave sur une clé STABLE : un titre d'acte est presque
  // toujours unique, une règle posée dessus ne se rejouerait jamais.
  check('la règle se grave sur la trame métier',
    cleRegle({ source: 'enq-art-76', titre: 'Réquisition — ligne 0601020304', type: 'requisition' }),
    'source:enq-art-76')
  check('sans trame métier, la règle se grave sur le type',
    cleRegle({ titre: 'Réquisition — ligne 0601020304', type: 'requisition' }), 'type:requisition')
  check('sans trame ni type, le titre en dernier recours',
    cleRegle({ titre: 'Soit-transmis' }), 'titre:soit-transmis')
  check('acte sans rien : aucune règle à graver', cleRegle({}), '')
}

// ── 2. La décision du magistrat prime sur celle de l'IA ─────────────────────
{
  const regles = [
    { cle: 'source:enq-art-76', trameId: 'p2', origine: 'ia', updatedAt: '2026-01-02T00:00:00Z' },
    { cle: 'source:enq-art-76', trameId: 'p1', origine: 'magistrat', updatedAt: '2026-01-01T00:00:00Z' },
  ]
  check('le choix du magistrat l\'emporte, même plus ancien',
    meilleureRegle(regles, 'source:enq-art-76', PAP).trameId, 'p1')

  const supprimee = [{ cle: 'source:x', trameId: 'disparue', origine: 'magistrat', updatedAt: '2026-01-01T00:00:00Z' }]
  check('une règle visant une papeterie supprimée est ignorée',
    meilleureRegle(supprimee, 'source:x', PAP), null)

  const deuxIA = [
    { cle: 'type:note', trameId: 'p1', origine: 'ia', updatedAt: '2026-01-01T00:00:00Z' },
    { cle: 'type:note', trameId: 'p3', origine: 'ia', updatedAt: '2026-03-01T00:00:00Z' },
  ]
  check('à origine égale, la plus récente gagne',
    meilleureRegle(deuxIA, 'type:note', PAP).trameId, 'p3')
}

// ── 3. Ce qui part sans rien demander, ce qui ouvre la fenêtre ──────────────
{
  const acte = { source: 'enq-art-76', titre: 'ACTE', type: 'requisition', contenu: 'Vu…' }
  const regles = [{ cle: 'source:enq-art-76', trameId: 'p2', origine: 'magistrat', updatedAt: '2026-01-01T00:00:00Z' }]
  const appris = choisirLocalement({ papeteries: PAP, regles, acte, typeDeduit: 'requete' })
  check('une règle apprise décide, et sans confirmation', [appris.trameId, appris.certain], ['p2', true])
  checkThat('la règle apprise prime sur le type déduit', appris.trameId !== 'p1')

  check('bibliothèque d\'une seule papeterie : rien à demander',
    choisirLocalement({ papeteries: [PAP[0]], regles: [], acte, typeDeduit: 'courrier' }).certain, true)

  // Concordance nette : proposé, mais soumis au magistrat.
  const net = choisirLocalement({
    papeteries: PAP,
    regles: [],
    acte: { titre: 'REQUÊTE AUX FINS D\'INTERCEPTION', contenu: 'Vu les articles…' },
    typeDeduit: 'requete',
  })
  check('concordance nette : proposition, pas décision', [net.trameId, net.certain], ['p1', false])

  // Acte inédit et sans mot-clé discriminant : c'est le cas où l'IA vaut son appel.
  check('acte inédit : rien de tranché localement',
    choisirLocalement({ papeteries: PAP, regles: [], acte: { titre: 'Note', contenu: 'Texte libre.' }, typeDeduit: 'defaut' }),
    null)

  checkThat('sans papeterie enregistrée, aucune décision',
    choisirLocalement({ papeteries: [], regles: [], acte, typeDeduit: 'requete' }) === null)
}

// ── 4. Score local : les mots du « quand l'utiliser » comptent ──────────────
{
  const acte = { titre: 'Courrier au bâtonnier', contenu: 'Maître, les avocats du barreau…' }
  checkThat('le « quand l\'utiliser » rapproche la bonne papeterie',
    scoreLocal(PAP[2], acte, 'courrier') > scoreLocal(PAP[1], acte, 'courrier'))
}

// ── 5. L'IA n'est appelée que dans le doute ─────────────────────────────────
{
  const franc = {
    titre: 'REQUÊTE AUX FINS D\'INTERCEPTION',
    corps: 'Vu les articles 706-95 et suivants ;\n\nLes faits sont établis.',
    signature: 'Fait à Amiens, le 3 mars 2026\nAudran CHEVALIER',
  }
  check('acte bien formé : aucun appel au modèle', decoupageDouteux(franc), [])

  check('titre non reconnu → doute',
    decoupageDouteux({ ...franc, titre: '' }), ['titre de l\'acte non reconnu'])
  check('signature non repérée → doute',
    decoupageDouteux({ ...franc, signature: '' }), ['bloc signature non repéré'])
  check('bandeau resté dans le corps → doute',
    decoupageDouteux({ ...franc, corps: 'COUR D\'APPEL D\'AMIENS\n\nVu les articles…' }),
    ['en-tête institutionnel resté dans le corps'])

  const courrier = { corps: 'Maître,\n\nJe vous prie…', destinataire: 'Maître DUPONT', objet: 'Votre demande' }
  check('courrier complet : aucun doute', decoupageDouteux(courrier, { courrier: true }), [])
  check('courrier sans objet → doute',
    decoupageDouteux({ ...courrier, objet: '' }, { courrier: true }), ['objet non identifié'])
}

// ── 6. Ce qui est soumis au modèle : les extrémités, numérotées ─────────────
{
  const court = Array.from({ length: 12 }, (_, i) => `ligne ${i + 1}`).join('\n')
  const c = lignesPourIA(court)
  check('acte court : envoyé en entier', [c.lignes.length, c.total, c.tronque], [12, 12, false])
  check('numérotation à partir de 1', [c.lignes[0].n, c.lignes[11].n], [1, 12])

  const long = Array.from({ length: 400 }, (_, i) => `ligne ${i + 1}`).join('\n')
  const l = lignesPourIA(long)
  check('acte long : seules les extrémités partent', [l.lignes.length, l.total, l.tronque], [75, 400, true])
  check('la tête et la queue sont bien celles de l\'acte',
    [l.lignes[0].n, l.lignes[44].n, l.lignes[45].n, l.lignes[74].n], [1, 45, 371, 400])
  checkThat('le ventre de l\'acte n\'est pas envoyé', !l.lignes.some((x) => x.n > 45 && x.n < 371))

  const large = lignesPourIA(`${'x'.repeat(500)}\nfin`)
  checkThat('une ligne très longue est tronquée', large.lignes[0].t.length <= 141)
  checkThat('la troncature est signalée par des points de suspension', large.lignes[0].t.endsWith('…'))
}

// ── 7. Un découpage incohérent est rejeté en bloc ───────────────────────────
{
  const ok = validerDecoupage({ titre: 2, corpsDebut: 4, corpsFin: 10, signatureDebut: 11 }, 12)
  check('découpage cohérent accepté', [ok.titre, ok.corpsDebut, ok.corpsFin, ok.signatureDebut], [2, 4, 10, 11])

  check('corps inversé rejeté', validerDecoupage({ corpsDebut: 9, corpsFin: 3 }, 12), null)
  check('corps absent rejeté', validerDecoupage({ titre: 1 }, 12), null)
  check('ligne hors bornes rejetée', validerDecoupage({ corpsDebut: 1, corpsFin: 99 }, 12), null)
  check('aucun découpage sans texte', validerDecoupage({ corpsDebut: 1, corpsFin: 2 }, 0), null)

  // Une région mal placée est ÉCARTÉE, sans invalider le reste : le corps,
  // lui, ne bouge pas — c'est la seule région dont la perte serait grave.
  const bancal = validerDecoupage({ titre: 8, signatureDebut: 2, corpsDebut: 4, corpsFin: 10 }, 12)
  check('titre situé dans le corps : écarté', bancal.titre, 0)
  check('signature située avant le corps : écartée', bancal.signatureDebut, 0)
  check('le corps est préservé', [bancal.corpsDebut, bancal.corpsFin], [4, 10])

  const dest = validerDecoupage({ destinataireDebut: 2, destinataireFin: 9, corpsDebut: 5, corpsFin: 10 }, 12)
  check('destinataire débordant sur le corps : ramené avant lui',
    [dest.destinataireDebut, dest.destinataireFin], [2, 4])
}

// ── 8. Le texte remis est celui du magistrat, au caractère près ─────────────
{
  const acte = [
    'COUR D\'APPEL D\'AMIENS',                      // 1
    'Objet : Ligne 0601020304',                     // 2
    'Monsieur le juge des libertés',                // 3
    'Tribunal judiciaire d\'Amiens',                // 4
    'Amiens, le 3 mars 2026',                       // 5
    '# REQUÊTE AUX FINS D\'INTERCEPTION',           // 6
    'Articles 706-95 et suivants du CPP',           // 7
    'Vu la procédure ;',                            // 8
    '',                                             // 9
    'Les faits **sont** établis — 3 € & « guillemets ».', // 10
    'Fait à Amiens, le 3 mars 2026',                // 11
    'Audran CHEVALIER',                             // 12
  ].join('\n')
  const dec = validerDecoupage({
    titre: 6, article: 7, objet: 2, date: 5,
    destinataireDebut: 3, destinataireFin: 4,
    corpsDebut: 8, corpsFin: 10, signatureDebut: 11,
  }, 12)
  const r = appliquerDecoupage(acte, dec)

  check('titre découpé, sans son dièse markdown', r.titre, 'REQUÊTE AUX FINS D\'INTERCEPTION')
  check('article de rattachement', r.article, 'Articles 706-95 et suivants du CPP')
  check('corps repris À L\'IDENTIQUE dans le texte d\'origine', r.corps,
    'Vu la procédure ;\n\nLes faits **sont** établis — 3 € & « guillemets ».')
  check('signature sur ses deux lignes', r.signature, 'Fait à Amiens, le 3 mars 2026\nAudran CHEVALIER')
  check('destinataire multi-lignes', r.destinataire, 'Monsieur le juge des libertés\nTribunal judiciaire d\'Amiens')
  check('libellé « Objet : » retiré, valeur conservée', r.objet, 'Ligne 0601020304')
  check('ville retirée de la date', r.date, '3 mars 2026')
  checkThat('le bandeau institutionnel ne repart pas dans le corps', !r.corps.includes('COUR D\'APPEL'))

  // Propriété de sûreté : chaque région sort telle quelle du texte d'origine.
  for (const [nom, valeur] of Object.entries({ corps: r.corps, signature: r.signature, destinataire: r.destinataire })) {
    checkThat(`${nom} : aucun caractère ajouté ni retiré`,
      valeur.split('\n').every((l) => acte.includes(l)))
  }
}

console.log(failures === 0 ? '\n✅ Tous les tests passent' : `\n❌ ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
