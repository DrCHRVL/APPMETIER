/**
 * SIRAL — écriture des archives bureautiques (.docx / .odt).
 *
 * Word et LibreOffice compressent leurs fichiers ; nous aussi. Sans cela, une
 * papeterie de 300 Ko relue puis réécrite ressortirait à plus d'un mégaoctet —
 * et une trame vit en base64 dans les réglages de l'utilisateur, où chaque
 * kilo-octet compte.
 *
 * Une seule exception, imposée par la norme OpenDocument : l'entrée
 * `mimetype` doit rester en tête de l'archive ET non compressée. On la
 * réinscrit donc explicitement en « STORE » avant de générer.
 */

import type PizZip from 'pizzip';

/** Prépare l'archive pour l'écriture (règle du `mimetype` pour l'ODT). */
function preparer(zip: PizZip): void {
  const mime = zip.file('mimetype');
  if (mime) zip.file('mimetype', mime.asText(), { compression: 'STORE' });
}

/** Archive compressée, en base64 (stockage d'une trame). */
export function zipVersBase64(zip: PizZip): string {
  preparer(zip);
  return zip.generate({ type: 'base64', compression: 'DEFLATE' });
}

/** Archive compressée, en mémoire (fichier remis à l'utilisateur). */
export function zipVersArrayBuffer(zip: PizZip): ArrayBuffer {
  preparer(zip);
  return zip.generate({ type: 'arraybuffer', compression: 'DEFLATE' }) as ArrayBuffer;
}
