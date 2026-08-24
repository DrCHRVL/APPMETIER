/**
 * SIRAL — test des TRAMES DE FORME : ODT + analyse d'un acte déjà rédigé.
 *
 * Scénario réel : le magistrat n'a pas envie de poser des balises à la main.
 * Il verse une requête 706-95 qu'il a DÉJÀ signée — une fois en .docx, une
 * fois en .odt. L'application doit :
 *   1. reconnaître le format sans se fier à l'extension ;
 *   2. classer les lignes : l'en-tête du parquet reste, le titre / l'objet /
 *      la date / le corps / la signature deviennent des balises ;
 *   3. construire la trame : la papeterie intacte, le contenu de CE dossier
 *      (le nom du mis en cause, la ligne interceptée) DISPARU — sinon il
 *      ressortirait dans tous les actes suivants ;
 *   4. remplir cette trame avec un autre acte, sans rien perdre de la forme.
 *
 * On vérifie aussi les deux services rendus autour : l'édition ligne à ligne,
 * et l'unicité d'un type d'acte entre deux trames.
 *
 *   node scripts/trames-forme.test.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import PizZip from 'pizzip'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'siral-trames-'))
const PIZZIP = pathToUrl(path.join(REPO, 'node_modules', 'pizzip', 'js', 'index.js'))

function pathToUrl(p) {
  return new URL(`file://${p}`).href
}

// ── Transpilation à la volée : les moteurs sont du TypeScript pur ────────────
function compile(rel) {
  const nom = path.basename(rel).replace(/\.ts$/, '')
  const src = fs.readFileSync(path.join(REPO, rel), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  })
  const js = outputText
    .replace(/from\s*['"]pizzip['"]/g, `from '${PIZZIP}'`)
    .replace(/from\s*['"]\.\/([^'"]+)['"]/g, (_, m) => `from './${m}.mjs'`)
  fs.writeFileSync(path.join(TMP, `${nom}.mjs`), js)
  return nom
}

for (const f of ['trameModele', 'zipSortie', 'trameOps', 'trameFill', 'trameOdt', 'trameDoc', 'trameAnalyse']) {
  compile(`lib/web/${f}.ts`)
}
const doc = await import(path.join(TMP, 'trameDoc.mjs'))
const analyse = await import(path.join(TMP, 'trameAnalyse.mjs'))

let echecs = 0
function ok(condition, libelle) {
  if (condition) { console.log(`  ✓ ${libelle}`); return }
  echecs += 1
  console.log(`  ✗ ${libelle}`)
}

// ── L'acte déjà rédigé, ligne à ligne ───────────────────────────────────────
// (en-tête du parquet, titre encadré, objet, corps du dossier, date, signature)
const ACTE = [
  { t: "Cour d'Appel d'Amiens — Tribunal Judiciaire d'Amiens" },
  { t: 'Parquet du procureur de la République' },
  { t: 'Section Criminalité Organisée' },
  { t: '' },
  { t: "REQUÊTE AUX FINS D'INTERCEPTION DE CORRESPONDANCES", centre: true, gras: true },
  { t: 'Objet : interception de la ligne 06.12.34.56.78' },
  { t: 'Vu les articles 706-95 et suivants du code de procédure pénale ;' },
  { t: "MOKRANI Mickael est mis en cause du chef de trafic de stupéfiants en bande organisée à Amiens." },
  { t: "REQUÉRONS l'interception de la ligne 06.12.34.56.78 pour une durée d'un mois." },
  { t: 'Fait à Amiens, le 3 mars 2026' },
  { t: 'P/ Le Procureur de la République' },
  { t: 'Audran CHEVALIER' },
  { t: 'Substitut' },
]

// ── Fabrication des deux fichiers ────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function faireDocx(lignes) {
  const paras = lignes.map((l) => {
    if (!l.t) return '<w:p/>'
    const pPr = l.centre ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : ''
    const rPr = l.gras ? '<w:rPr><w:b/></w:rPr>' : ''
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(l.t)}</w:t></w:r></w:p>`
  }).join('')
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  zip.file('word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${paras}<w:sectPr><w:pgMar w:top="1134" w:right="794" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`)
  return zip.generate({ type: 'base64' })
}

function faireOdt(lignes) {
  const paras = lignes.map((l) => {
    if (!l.t) return '<text:p text:style-name="Standard"/>'
    const style = l.centre ? 'TitreCentre' : 'Standard'
    const inner = l.gras ? `<text:span text:style-name="Gras">${esc(l.t)}</text:span>` : esc(l.t)
    return `<text:p text:style-name="${style}">${inner}</text:p>`
  }).join('')
  const zip = new PizZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
  zip.file('content.xml',
    '<?xml version="1.0"?><office:document-content '
    + 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    + 'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    + 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">'
    + '<office:automatic-styles>'
    + '<style:style style:name="Standard" style:family="paragraph"><style:text-properties fo:font-size="12pt" style:font-name="Times New Roman"/></style:style>'
    + '<style:style style:name="TitreCentre" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>'
    + '<style:style style:name="Gras" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>'
    + '</office:automatic-styles>'
    + `<office:body><office:text>${paras}</office:text></office:body></office:document-content>`)
  zip.file('styles.xml',
    '<?xml version="1.0"?><office:document-styles '
    + 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    + 'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    + 'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">'
    + '<office:automatic-styles><style:page-layout style:name="pm1">'
    + '<style:page-layout-properties fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/>'
    + '</style:page-layout></office:automatic-styles></office:document-styles>')
  return zip.generate({ type: 'base64' })
}

const texte = (base64, format) => doc.paragraphesTrame(base64, format).map((p) => p.texte)
const toutLeTexte = (base64, format) => texte(base64, format).join('\n')

async function blobBase64(blob) {
  return Buffer.from(await blob.arrayBuffer()).toString('base64')
}

// ── Le test, joué à l'identique sur les deux formats ─────────────────────────
async function scenario(format, base64) {
  console.log(`\n── ${format.toUpperCase()} ──`)

  ok(doc.detecterFormat(base64) === format, 'le format est reconnu dans l\'archive, pas d\'après l\'extension')
  ok(texte(base64, format).length === ACTE.length, `les ${ACTE.length} lignes de l'acte sont lues`)

  // 1) Analyse (le service attaché est injoignable ici : ce sont les règles locales)
  const prop = await analyser(base64, format)
  ok(prop.origine === 'local', 'sans attaché joignable, le classement local prend le relais')
  const role = (i) => prop.lignes[i].role
  ok(role(0) === 'papeterie' && role(1) === 'papeterie' && role(2) === 'papeterie', 'l\'en-tête du parquet reste de la papeterie')
  ok(role(4) === 'titre', 'la ligne centrée en gras est reconnue comme titre')
  ok(role(5) === 'objet' && prop.lignes[5].garde === 'Objet : '.length, 'le label « Objet : » est gardé, la valeur devient une balise')
  ok(role(6) === 'corps' && role(7) === 'corps' && role(8) === 'corps', 'visas, exposé et dispositif forment le corps')
  ok(role(9) === 'date' && prop.lignes[9].garde === 'Fait à Amiens, le '.length, 'la date est repérée derrière « Fait à …, le »')
  ok(role(10) === 'signature' && role(12) === 'signature', 'le bloc de signature est repéré jusqu\'au bout')
  ok(prop.types.includes('requete'), 'le type « requête » est proposé')
  ok(!analyse.verifierProposition(prop).length, 'la proposition ne déclenche aucune alerte')

  // 2) Construction de la trame
  const trame = analyse.construireTrame(base64, format, prop)
  const brut = toutLeTexte(trame, format)
  ok(brut.includes("Cour d'Appel d'Amiens"), 'la papeterie survit à la mise en trame')
  ok(brut.includes('{{TITRE}}') && brut.includes('{{CORPS}}') && brut.includes('{{SIGNATURE}}'), 'les balises de paragraphe sont posées')
  ok(brut.includes('Objet : {{OBJET}}'), 'le label de l\'objet est conservé devant la balise')
  ok(brut.includes('Fait à Amiens, le {{DATE}}'), 'la date est balisée sans perdre son préfixe')
  ok(!/MOKRANI|06\.12\.34\.56\.78/.test(brut), 'AUCUN détail du dossier d\'origine ne subsiste dans la trame')
  ok(!brut.includes('Audran CHEVALIER'), 'les lignes de signature surnuméraires ont disparu')
  ok(doc.trameBalisee(trame, format), 'la trame construite passe le contrôle des balises')

  // 3) Remplissage de la trame avec un AUTRE acte
  const rempli = await blobBase64(await doc.fillTrame(trame, format, {
    titre: 'REQUÊTE AUX FINS DE GÉOLOCALISATION',
    objet: 'géolocalisation du véhicule CF-554-GE',
    date: '12 avril 2026',
    corps: 'Vu les articles 230-32 et suivants ;\n\nLe véhicule FORD Fiesta CF-554-GE est utilisé quotidiennement.\n- premier point ;\n- second point.',
    signature: 'P/ Le Procureur de la République\nAudran CHEVALIER\nSubstitut',
  }))
  const sorti = toutLeTexte(rempli, format)
  ok(sorti.includes("Cour d'Appel d'Amiens"), 'la papeterie est intacte dans l\'acte exporté')
  ok(sorti.includes('REQUÊTE AUX FINS DE GÉOLOCALISATION'), 'le titre du nouvel acte est injecté')
  ok(sorti.includes('Objet : géolocalisation du véhicule CF-554-GE'), 'l\'objet se pose derrière son label')
  ok(sorti.includes('Fait à Amiens, le 12 avril 2026'), 'la date se pose derrière son préfixe')
  ok(sorti.includes('Vu les articles 230-32 et suivants ;') && sorti.includes('FORD Fiesta'), 'le corps est déversé ligne à ligne')
  ok(/•\s+premier point/.test(sorti), 'les puces du corps sont rendues')
  ok(sorti.includes('Substitut'), 'le bloc signature est rendu sur plusieurs lignes')
  ok(!sorti.includes('{{'), 'aucune balise ne subsiste dans l\'acte final')

  // 4) Édition ligne à ligne de la trame enregistrée
  const lignes = doc.lignesTrame(trame, format)
  const cible = lignes.find((l) => l.texte.includes("Cour d'Appel"))
  const edite = doc.ecrireLignes(trame, format, [{ index: cible.index, texte: "Cour d'Appel de Douai — Tribunal Judiciaire de Lille" }])
  const apres = toutLeTexte(edite, format)
  ok(apres.includes('Tribunal Judiciaire de Lille'), 'une ligne corrigée à la main est bien réécrite')
  ok(apres.includes('{{CORPS}}'), 'les autres lignes, balises comprises, ne bougent pas')

  // 5) Opérations de l'assistant (elles doivent rendre un fichier toujours lisible)
  const ops = doc.appliquerOpsTrame(trame, format, [{ kind: 'police', cible: 'tout', police: 'Garamond' }])
  ok(ops.applied.length === 1, 'l\'assistant applique le changement de police')
  ok(toutLeTexte(ops.docxBase64, format).includes('{{CORPS}}'), 'la trame reste lisible après une opération de l\'assistant')

  // 6) L'archive réécrite reste conforme et compressée
  const octets = Buffer.from(trame, 'base64')
  ok(octets.length < Buffer.from(base64, 'base64').length * 2, 'la trame réécrite reste compressée')
  if (format === 'odt') {
    ok(octets.slice(30, 38).toString() === 'mimetype' && octets.readUInt16LE(8) === 0,
      'le mimetype ODF reste en tête de l\'archive et non compressé')
  }
}

/** L'analyse passe par la route de l'attaché, injoignable hors navigateur : le repli local doit tenir. */
async function analyser(base64, format) {
  return analyse.analyserActe(base64, format, 'requete-706-95.docx')
}

await scenario('docx', faireDocx(ACTE))
await scenario('odt', faireOdt(ACTE))

// ── Unicité d'un type d'acte entre deux trames ──────────────────────────────
console.log('\n── Attribution des types ──')
const store = await import(path.join(TMP, 'trameModele.mjs'))
const { poserTrame, trameTypes, trameFormat } = store

const t1 = { id: 'a', nom: 'Courrier', type: 'courrier', types: ['courrier', 'defaut'], docxBase64: '', updatedAt: '' }
const t2 = { id: 'b', nom: 'Requête', type: 'requete', types: ['requete', 'defaut'], docxBase64: '', updatedAt: '' }
const liste = poserTrame(poserTrame([], t1), t2)
ok(trameTypes(liste[0]).join() === 'courrier', 'la trame la plus récente prend le type « défaut » à l\'ancienne')
ok(trameTypes(liste[1]).join() === 'requete,defaut', 'la nouvelle trame garde tous ses types')
ok(trameTypes({ type: 'courrier' }).join() === 'courrier', 'une trame enregistrée avant le multi-type reste servie')
ok(trameFormat({}) === 'docx', 'une trame sans format déclaré reste un Word')

fs.rmSync(TMP, { recursive: true, force: true })
console.log(echecs ? `\n${echecs} échec(s)` : '\nTout est vert.')
process.exit(echecs ? 1 : 0)
