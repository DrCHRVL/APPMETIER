/**
 * SIRAL — rendu des « trames de forme » (papeteries Word de l'utilisateur).
 *
 * Couvre les défauts qui rendaient les Word produits « mal remplis » alors que
 * le même acte se lisait correctement en markdown dans l'application :
 *  - une balise éclatée par Word en plusieurs runs n'était pas reconnue : le
 *    contenu manquait et un `{{CORPS}}` littéral restait dans le document ;
 *  - une balise sans valeur (p. ex. `{{TITRE}}` sur un courrier) restait telle
 *    quelle sous les yeux du destinataire ;
 *  - le corps était recraché ligne à ligne : tableaux markdown en `|`, titres
 *    en `#`, listes numérotées brutes, et un paragraphe vide par ligne vide ;
 *  - les propriétés reconstruites sortaient dans le désordre (Word affichait
 *    « contenu illisible »).
 *
 *   node scripts/trame-forme.test.mjs
 */
import {
  corpsToOoxml,
  fillPartXml,
  findTokens,
  parseBlocks,
  parseInline,
  paraText,
  rPrWith,
} from '../lib/web/trameFillCore.mjs'

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
function checkThat(label, cond) { check(label, Boolean(cond), true) }

/** Paragraphe Word minimal. */
const P = (runs, pPr = '') => `<w:p>${pPr}${runs}</w:p>`
/** Run porteur de texte. */
const R = (text, rPr = '') => `<w:r>${rPr}<w:t>${text}</w:t></w:r>`

/** Compte les occurrences d'un motif dans une chaîne. */
const count = (s, re) => (s.match(re) || []).length

/** Paragraphes générés sans le moindre texte (les « trous » de l'export). */
const emptyParas = (xml) => (xml.match(/<w:p>(?:(?!<\/w:p>).)*<\/w:p>/gs) || [])
  .filter((p) => !/<w:t[^>]*>[^<]/.test(p))

// ── 1. Repérage des balises ─────────────────────────────────────────────────
{
  // Word scinde régulièrement une balise en plusieurs runs (révisions,
  // correcteur orthographique) : c'est ce qui faisait échouer le remplissage.
  const doc = P(R('{{COR') + R('PS}}'))
  check('balise scindée en deux runs : détectée', findTokens(doc), ['CORPS'])
  const out = fillPartXml(doc, { corps: 'Bonjour.' })
  checkThat('balise scindée : le corps est bien déversé', out.includes('Bonjour.'))
  checkThat('balise scindée : plus de {{ résiduel', !out.includes('{{'))

  // Casse et espaces intérieurs tolérés.
  check('casse et espaces tolérés', findTokens(P(R('{{ corps }}'))), ['CORPS'])

  // Un proofErr entre deux runs ne casse plus rien.
  const noisy = P(`${R('{{')}<w:proofErr w:type="spellStart"/>${R('OBJET')}<w:proofErr w:type="spellEnd"/>${R('}}')}`)
  check('balise coupée par un proofErr : détectée', findTokens(noisy), ['OBJET'])
  checkThat('balise coupée par un proofErr : remplie',
    fillPartXml(noisy, { objet: 'Saisine' }).includes('Saisine'))
}

// ── 2. Aucune balise orpheline ──────────────────────────────────────────────
{
  const doc = P(R('{{TITRE}}')) + P(R('{{CORPS}}')) + P(R('Objet : {{OBJET}}'))
  const out = fillPartXml(doc, { corps: 'Texte.' })
  checkThat('balise de bloc sans valeur : paragraphe retiré', !out.includes('{{TITRE}}'))
  checkThat('balise en ligne sans valeur : retirée', !out.includes('{{OBJET}}'))
  checkThat('balise en ligne sans valeur : le libellé reste', out.includes('Objet :'))
  check('un seul paragraphe retiré, pas les autres', count(out, /<w:p>/g) >= 2, true)
}

// ── 3. Valeurs multi-lignes en ligne (adresse du destinataire) ──────────────
{
  const out = fillPartXml(P(R('À {{DESTINATAIRE}}')), { destinataire: 'M. le Directeur\nSR Amiens' })
  checkThat('destinataire multi-lignes : vrai saut de ligne', out.includes('<w:br/>'))
  checkThat('destinataire multi-lignes : les deux lignes sont là',
    out.includes('SR Amiens') && out.includes('M. le Directeur'))
}

// ── 4. Le corps n'est plus recraché ligne à ligne ───────────────────────────
{
  const corps = [
    'Vu les articles 706-95 et suivants du code de procédure pénale ;',
    '',
    'Première phrase du paragraphe.',
    'Seconde phrase du même paragraphe.',
    '',
    '## Sur la mesure sollicitée',
    '',
    '- une puce ;',
    '- une seconde puce.',
    '',
    '1. premier point ;',
    '2. second point.',
  ].join('\n')
  const blocks = parseBlocks(corps)
  check('blocs reconnus', blocks.map((b) => b.type), ['para', 'para', 'heading', 'list', 'list'])
  check('deux lignes consécutives = un seul paragraphe', blocks[1].lines.length, 2)

  const xml = corpsToOoxml(corps, '<w:pPr><w:jc w:val="both"/></w:pPr>', '<w:rPr><w:sz w:val="24"/></w:rPr>')
  check('aucun paragraphe vide généré par les lignes vides', emptyParas(xml).length, 0)
  checkThat('les lignes d\'un même paragraphe sont liées par un saut de ligne', xml.includes('<w:br/>'))
  checkThat('le titre markdown perd son ##', !xml.includes('##'))
  checkThat('le titre markdown devient gras', xml.includes('<w:b/>'))
  checkThat('les puces sont de vraies puces', xml.includes('•'))
  checkThat('la numérotation d\'origine est conservée', xml.includes('>1.</w:t>'))
  checkThat('l\'alignement de la balise est hérité', count(xml, /<w:jc w:val="both"\/>/g) >= 5)
  checkThat('le visa reste en italique', xml.includes('<w:i/>'))
}

// Filet de séparation : un `---` doit devenir un trait, pas trois tirets.
{
  const rule = corpsToOoxml('Avant.\n\n---\n\nAprès.', '', '')
  check('un --- devient un filet, pas trois tirets', count(rule, /<w:pBdr>/g), 1)
  checkThat('le filet ne laisse pas de tirets dans le texte', !rule.includes('---'))
}

// ── 5. Tableaux markdown → vrais tableaux Word ──────────────────────────────
{
  const corps = [
    'Témoins à citer :',
    '',
    '| Nom | Qualité | Cote |',
    '| --- | :-----: | ---: |',
    '| MARTIN Paul | témoin | D 45 |',
    '| DURAND Léa | expert | D 78 |',
  ].join('\n')
  const blocks = parseBlocks(corps)
  check('un tableau est reconnu', blocks.map((b) => b.type), ['para', 'table'])
  check('en-tête du tableau', blocks[1].header, ['Nom', 'Qualité', 'Cote'])
  check('alignements du tableau', blocks[1].aligns, [null, 'center', 'right'])
  check('lignes du tableau', blocks[1].rows.length, 2)

  const xml = corpsToOoxml(corps, '', '')
  checkThat('un <w:tbl> est produit', xml.includes('<w:tbl>'))
  check('3 lignes de tableau (en-tête + 2)', count(xml, /<w:tr>/g), 3)
  check('9 cellules', count(xml, /<w:tc>/g), 9)
  checkThat('les | ne sont plus dans le texte', !xml.includes('| MARTIN'))
  checkThat('un paragraphe suit le tableau (exigence Word)', /<\/w:tbl><w:p>/.test(xml))
}

// ── 6. Mise en forme en ligne ───────────────────────────────────────────────
{
  check('gras', parseInline('un **mot** gras').map((s) => [s.t, !!s.b]),
    [['un ', false], ['mot', true], [' gras', false]])
  check('souligné (convention SIRAL : __…__)', parseInline('__vu__').map((s) => [s.t, !!s.u]), [['vu', true]])
  check('italique simple', parseInline('*ainsi*').map((s) => [s.t, !!s.i]), [['ainsi', true]])
  check('lien réduit à son libellé', parseInline('[le dossier](http://x/y)').map((s) => s.t), ['le dossier'])
  check('astérisque échappé', parseInline('5 \\* 3').map((s) => s.t), ['5 ', '*', ' 3'])
  check('snake_case non italisé', parseInline('nom_de_fichier').map((s) => s.t), ['nom_de_fichier'])
}

// ── 7. Héritage de la mise en forme de la balise ────────────────────────────
{
  const baseRPr = '<w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr>'
  const rPr = rPrWith(baseRPr, { b: true, u: true })
  checkThat('la police de la trame est conservée', rPr.includes('Garamond'))
  checkThat('le gras demandé est posé', rPr.includes('<w:b/>'))
  // L'ordre du schéma OOXML : rFonts < b < sz < u < lang.
  const order = ['w:rFonts', 'w:b', 'w:sz', 'w:u', 'w:lang'].map((t) => rPr.indexOf(`<${t}`))
  check('propriétés de run dans l\'ordre du schéma',
    order.every((v, k) => v >= 0 && (k === 0 || v > order[k - 1])), true)

  const xml = corpsToOoxml('Un texte.', '<w:pPr><w:pStyle w:val="Corps"/><w:spacing w:line="360"/><w:jc w:val="both"/></w:pPr>', baseRPr)
  const pOrder = ['w:pStyle', 'w:spacing', 'w:jc'].map((t) => xml.indexOf(`<${t}`))
  check('propriétés de paragraphe dans l\'ordre du schéma',
    pOrder.every((v, k) => v >= 0 && (k === 0 || v > pOrder[k - 1])), true)
}

// ── 8. Pièges de trame ──────────────────────────────────────────────────────
{
  // Balise posée dans une liste : le corps ne doit pas devenir une liste.
  const inList = P(R('{{CORPS}}'), '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>')
  const out = fillPartXml(inList, { corps: 'Phrase une.\n\nPhrase deux.' })
  checkThat('numérotation de la balise non propagée au corps', !out.includes('<w:numPr>'))

  // Balise dans une zone de texte (paragraphe imbriqué) : XML toujours valide.
  const boxed = `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${P(R('{{DATE}}'))}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`
  const filled = fillPartXml(boxed, { date: '3 mars 2026' })
  checkThat('balise en zone de texte : remplie', filled.includes('3 mars 2026'))
  checkThat('balise en zone de texte : structure préservée', filled.includes('</w:txbxContent>'))
  check('balise en zone de texte : paragraphes équilibrés',
    count(filled, /<w:p>/g), count(filled, /<\/w:p>/g))

  // Le sectPr du paragraphe de balise survit (sinon la mise en page saute).
  const withSect = P(R('{{CORPS}}'), '<w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr>')
  const kept = fillPartXml(withSect, { corps: 'Texte.' })
  checkThat('le sectPr de la trame est conservé', kept.includes('<w:pgSz'))
  check('le sectPr n\'est pas dupliqué sur chaque paragraphe', count(kept, /<w:sectPr>/g), 1)

  // Caractères XML sensibles.
  const amp = fillPartXml(P(R('{{OBJET}}')), { objet: 'X & <Y>' })
  checkThat('les caractères XML sont échappés', amp.includes('X &amp; &lt;Y&gt;'))
}

// ── 9. Bout en bout, sur une trame réaliste ─────────────────────────────────
{
  const trame = [
    P(R('COUR D\'APPEL D\'AMIENS')),
    P(R('{{TITRE}}'), '<w:pPr><w:jc w:val="center"/></w:pPr>'),
    P(R('Amiens, le {{DATE}}')),
    P(R('{{CORPS}}'), '<w:pPr><w:jc w:val="both"/></w:pPr>'),
    P(R('{{SIGNATURE}}'), '<w:pPr><w:jc w:val="right"/></w:pPr>'),
  ].join('')
  check('balises listées dans l\'ordre canonique', findTokens(trame),
    ['CORPS', 'TITRE', 'SIGNATURE', 'DATE'])

  const out = fillPartXml(trame, {
    titre: 'REQUÊTE AUX FINS D\'INTERCEPTION',
    date: '3 mars 2026',
    corps: '# Exposé\n\nLes faits sont établis.\n\n| Ligne | Titulaire |\n| --- | --- |\n| 0601 | MARTIN |',
    signature: 'P/ Le Procureur de la République\nAudran CHEVALIER',
  })
  checkThat('aucune balise résiduelle', !out.includes('{{'))
  checkThat('la papeterie de l\'utilisateur est intacte', out.includes('COUR D\'APPEL D\'AMIENS'))
  checkThat('le titre est déversé', out.includes('REQUÊTE AUX FINS D\'INTERCEPTION'))
  checkThat('la date est déversée', out.includes('3 mars 2026'))
  checkThat('le tableau du corps est un tableau Word', out.includes('<w:tbl>'))
  check('signature : une ligne = un paragraphe', count(out, /Audran CHEVALIER/g), 1)
  check('paragraphes équilibrés', count(out, /<w:p>/g), count(out, /<\/w:p>/g))
  check('texte lisible du premier paragraphe', paraText(P(R('COUR D\'APPEL'))), 'COUR D\'APPEL')
}

console.log(failures === 0 ? '\n✅ Tous les tests passent' : `\n❌ ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
