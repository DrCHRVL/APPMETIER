// utils/pdfSignatureField.ts
//
// Pose, au bas d'un PDF déjà produit, un CHAMP DE SIGNATURE VIDE — un vrai
// champ de formulaire PDF de type /Sig, sans valeur.
//
// C'est la réponse à la carte agent Justice : la clé privée d'une carte à puce
// ne s'exporte pas, et un navigateur ne sait pas dialoguer avec un lecteur de
// carte. L'application ne peut donc PAS signer elle-même. Ce qu'elle peut
// faire, et qui change tout à l'usage : livrer un acte dont l'emplacement de
// signature est déjà en place, au bon endroit et à la bonne taille, de sorte
// que l'outil de signature (Acrobat, parapheur du ministère) n'ait plus qu'à
// être ouvert et le champ cliqué. Le visuel — mention « Signé électroniquement »
// et sceau de la République — est celui que dessine l'outil signataire, pas
// nous : c'est ce qui le rend vérifiable.
//
// Le PDF reste parfaitement ouvrable et imprimable sans être signé : un champ
// vide n'est pas une signature en attente, il n'invalide rien.

import { PDFDocument, PDFName, PDFNumber, PDFString, PDFArray, PDFDict } from 'pdf-lib';

/** Millimètres → points PostScript (72 points par pouce). */
const MM = 72 / 25.4;

/** Emplacement et intitulé du champ, en millimètres depuis les bords de page. */
export interface ChampSignature {
  /** Intitulé affiché par l'outil de signature. */
  nom: string;
  /** Marge depuis le bord droit de la page. */
  droiteMm: number;
  /** Marge depuis le bord inférieur de la page. */
  basMm: number;
  largeurMm: number;
  hauteurMm: number;
}

/**
 * Valeurs par défaut : bloc en bas à droite, sous le « P/ le procureur de la
 * République », aux dimensions du sceau apposé par les outils du ministère.
 */
export const CHAMP_SIGNATURE_DEFAUT: ChampSignature = {
  nom: 'Signature du magistrat',
  droiteMm: 20,
  basMm: 20,
  largeurMm: 60,
  hauteurMm: 32,
};

export const mergeChampSignature = (
  saved: Partial<ChampSignature> | null | undefined,
): ChampSignature => ({ ...CHAMP_SIGNATURE_DEFAUT, ...(saved || {}) });

/** Tableau `/Annots` de la page, créé s'il n'existe pas encore. */
const annotsDe = (pdf: PDFDocument, page: ReturnType<PDFDocument['getPages']>[number]): PDFArray => {
  const existant = page.node.lookup(PDFName.of('Annots'));
  if (existant instanceof PDFArray) return existant;
  const cree = pdf.context.obj([]) as PDFArray;
  page.node.set(PDFName.of('Annots'), cree);
  return cree;
};

/** Dictionnaire `/AcroForm` du document, créé s'il n'existe pas encore. */
const acroFormDe = (pdf: PDFDocument): PDFDict => {
  const existant = pdf.catalog.lookup(PDFName.of('AcroForm'));
  if (existant instanceof PDFDict) return existant;
  const cree = pdf.context.obj({}) as PDFDict;
  pdf.catalog.set(PDFName.of('AcroForm'), cree);
  return cree;
};

/**
 * Rend une copie du PDF portant un champ de signature vide sur sa DERNIÈRE
 * page. Le PDF d'entrée n'est pas modifié.
 */
export const ajouterChampSignature = async (
  pdfBytes: Uint8Array,
  champ: ChampSignature = CHAMP_SIGNATURE_DEFAUT,
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  if (!pages.length) return pdfBytes;
  const page = pages[pages.length - 1];
  const { width, height } = page.getSize();

  // Rectangle du champ, entièrement contenu dans la page. On borne d'abord les
  // dimensions, puis les marges à ce qui reste : un réglage aberrant (marge
  // droite de 900 mm) donnerait sinon un rectangle aux coins inversés ou hors
  // page, que les outils de signature refusent d'ouvrir.
  const borne = (v: number, min: number, max: number): number =>
    Math.min(Math.max(v, min), Math.max(min, max));

  const largeur = borne(champ.largeurMm * MM, 10 * MM, width);
  const hauteur = borne(champ.hauteurMm * MM, 8 * MM, height);
  const droite = borne(champ.droiteMm * MM, 0, width - largeur);
  const bas = borne(champ.basMm * MM, 0, height - hauteur);

  const x1 = width - droite - largeur;
  const x2 = x1 + largeur;
  const y1 = bas;
  const y2 = y1 + hauteur;

  const widget = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(champ.nom),
    Rect: [x1, y1, x2, y2].map((n) => PDFNumber.of(n)),
    F: PDFNumber.of(4), // annotation imprimable
    P: page.ref,
  });
  const ref = pdf.context.register(widget);

  annotsDe(pdf, page).push(ref);

  const acro = acroFormDe(pdf);
  // SigFlags 3 = le document contient des signatures et ne doit être modifié
  // qu'en ajout (incremental update) — condition d'une signature vérifiable.
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  const champs = acro.lookup(PDFName.of('Fields'));
  if (champs instanceof PDFArray) {
    champs.push(ref);
  } else {
    acro.set(PDFName.of('Fields'), pdf.context.obj([ref]));
  }

  // Sans flux d'objets, la structure reste lisible par les outils de signature
  // les plus anciens (et par un incremental update ultérieur).
  return pdf.save({ useObjectStreams: false });
};
