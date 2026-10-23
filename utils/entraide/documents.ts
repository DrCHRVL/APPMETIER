// utils/entraide/documents.ts
//
// Génération des courriers T1–T4 (OpenDocument) à partir des modèles
// public/modeles/entraide/<doc>_<langue>.odt — les trames du service,
// balisées {{cle}}. Le modèle est rempli tel quel (mise en page et logo
// intacts) ; la signature du magistrat n'est apposée que si le courrier a
// été validé par lui (événement « signature »).

import PizZip from 'pizzip';
import { PAPETERIE } from '@/lib/web/papeterie';
import { aujourdhui, CASES_TRAME, paysDe } from './logique';
import {
  autreUnite,
  contact,
  dateEnvoiAutorite,
  dateLongue,
  demandeurTrame,
  fonctionAnglaise,
  introRelance,
  introSoitTransmis,
  intitule,
  lignesDemande,
  objetRetour,
  telephoneInternational,
} from './textes';
import type {
  AutoriteEtrangere,
  DemandeEntraide,
  EntraideDocId,
  EntraideLangue,
  ServiceEnqueteur,
  SignataireEntraide,
} from '@/types/entraideTypes';

/** T1/T2 ne s'adressent qu'aux services français : toujours en français. */
export function languesDisponibles(doc: EntraideDocId): EntraideLangue[] {
  return doc === 't3' || doc === 't4' ? ['fr', 'en'] : ['fr'];
}

export interface ContexteDocument {
  demande: DemandeEntraide;
  doc: EntraideDocId;
  langue: EntraideLangue;
  autorite: AutoriteEtrangere | null;
  service: ServiceEnqueteur | null;
  /** Signataire dont le nom figure au bas du courrier. */
  signataire: SignataireEntraide | null;
  /** Apposer l'image de signature (courrier validé par ce signataire). */
  avecSignature: boolean;
  /** Date portée sur le courrier (défaut : aujourd'hui). */
  date?: string;
}

function xml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Valeur multi-lignes : retours à la ligne ODF. */
function xmlLignes(s: string): string {
  return String(s ?? '').split('\n').map(xml).join('<text:line-break/>');
}

/** Variables du modèle (texte brut ; échappées à l'insertion). */
export function variablesDocument(ctx: ContexteDocument): Record<string, string> {
  const { demande: d, langue, autorite, service, signataire } = ctx;
  const date = ctx.date || aujourdhui();
  const pays = paysDe(autorite?.pays || d.pays);
  const cases = new Set(service?.cases || (d.serviceAutre ? ['autre'] : []));
  const demandeur = demandeurTrame(autorite, d);
  const envoi = dateEnvoiAutorite(d);
  const v: Record<string, string> = {
    n_ref: d.refEsabora || '',
    v_ref: d.refEtrangere || '—',
    ville: PAPETERIE.ville,
    date: dateLongue(date, langue),
    intro: introSoitTransmis(d),
    intro_relance: introRelance(d),
    intitule: intitule(d.type, langue),
    objet: objetRetour(d.type, langue),
    autre_unite: autreUnite(service, d),
    tribunal_de: demandeur.tribunal,
    parquet_de: demandeur.parquet,
    dest_nom: autorite?.nom || d.autoriteNom || '',
    dest_adresse: autorite?.adresse || '',
    dest_ville: autorite?.ville || '',
    dest_pays: langue === 'en' ? (pays?.en || autorite?.pays || d.pays) : (autorite?.pays || d.pays),
    envoi: envoi ? (langue === 'en' ? `on ${dateLongue(envoi, 'en')}` : `le ${dateLongue(envoi, 'fr')}`) : '',
    ref_envoi: d.refEtrangere || d.refEsabora || '',
    contact: contact(signataire, langue),
    contact_tel: langue === 'en' ? telephoneInternational(signataire?.telephone || '') : (signataire?.telephone || ''),
    contact_mail: signataire?.email || '',
    signataire: signataire?.prenomNom || '',
    fonction: langue === 'en' ? fonctionAnglaise(signataire?.fonction || '') : (signataire?.fonction || ''),
  };
  for (const c of [...CASES_TRAME, 'tribunal', 'parquet']) v[`cb_${c}`] = '□';
  for (const c of cases) v[`cb_${c}`] = '☒';
  if (demandeur.tribunal) v.cb_tribunal = '☒';
  if (demandeur.parquet) v.cb_parquet = '☒';
  return v;
}

async function dimensionsImage(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 150 });
    img.onerror = () => resolve({ w: 400, h: 150 });
    img.src = dataUrl;
  });
}

function dataUrlVersOctets(dataUrl: string): { octets: Uint8Array; mime: string; ext: string } | null {
  const m = /^data:(image\/(png|jpe?g));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const bin = atob(m[3]);
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  const ext = m[2].toLowerCase() === 'png' ? 'png' : 'jpg';
  return { octets, mime: m[1].toLowerCase().replace('jpg', 'jpeg'), ext };
}

/** Remplit le modèle et rend le fichier .odt. */
export async function genererDocument(ctx: ContexteDocument): Promise<Blob> {
  const res = await fetch(`/modeles/entraide/${ctx.doc}_${ctx.langue}.odt`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Modèle ${ctx.doc.toUpperCase()} (${ctx.langue}) introuvable`);
  const zip = new PizZip(await res.arrayBuffer());
  let content = zip.file('content.xml')!.asText();

  // Mesures : la ligne {{mesure}} du modèle est dupliquée, une par mesure.
  const lignes = lignesDemande(ctx.demande);
  content = content.replace(/<text:list-item>((?:(?!<\/text:list-item>)[\s\S])*?)\{\{mesure\}\}([\s\S]*?)<\/text:list-item>/, (_m, avant, apres) =>
    lignes.map((l) => `<text:list-item>${avant}${xml(l)}${apres}</text:list-item>`).join(''));

  // Signature : image du magistrat, uniquement sur un courrier qu'il a validé.
  const image = ctx.avecSignature && ctx.signataire?.signature ? dataUrlVersOctets(ctx.signataire.signature) : null;
  if (image) {
    const { w, h } = await dimensionsImage(ctx.signataire!.signature!);
    const largeur = 4.5;
    const hauteur = Math.min(2.6, (largeur * h) / Math.max(1, w));
    const chemin = `media/signature.${image.ext}`;
    zip.file(chemin, image.octets, { binary: true });
    const manifest = zip.file('META-INF/manifest.xml')!.asText()
      .replace('</manifest:manifest>', `<manifest:file-entry manifest:full-path="${chemin}" manifest:media-type="${image.mime}"/></manifest:manifest>`);
    zip.file('META-INF/manifest.xml', manifest);
    content = content.replace(/(<text:p text:style-name="[^"]+">)\{\{signature\}\}(<\/text:p>)/,
      `$1<draw:frame draw:name="signature" text:anchor-type="as-char" svg:width="${largeur}cm" svg:height="${hauteur.toFixed(2)}cm" draw:z-index="10"><draw:image xlink:href="${chemin}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>$2`);
  } else {
    content = content.replace(/<text:p text:style-name="[^"]+">\{\{signature\}\}<\/text:p>/, '');
  }

  const vars = variablesDocument(ctx);
  content = content.replace(/\{\{([a-z_]+)\}\}/g, (_m, cle: string) => (cle in vars ? xmlLignes(vars[cle]) : ''));
  zip.file('content.xml', content);
  // ODF : « mimetype » doit rester la première entrée, non compressée.
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });

  return zip.generate({ type: 'blob', mimeType: 'application/vnd.oasis.opendocument.text', compression: 'DEFLATE' }) as Blob;
}

export function nomFichier(d: DemandeEntraide, doc: EntraideDocId, langue: EntraideLangue): string {
  const ref = (d.refEsabora || 'sans-ref').replace(/[^\w\-]+/g, '_');
  return `${ref} - ${doc.toUpperCase()}${langue === 'en' ? ' (EN)' : ''}.odt`;
}

export function telecharger(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
