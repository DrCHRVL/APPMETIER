// utils/entraide/documents.ts
//
// Génération des courriers T1–T4 (OpenDocument) à partir des modèles
// public/modeles/entraide/<doc>_<langue>.odt — les trames du service,
// balisées {{cle}}. Le modèle est rempli tel quel (mise en page et logo
// intacts) ; le courrier téléchargé est imprimé, signé et envoyé hors de
// l'application.

import PizZip from 'pizzip';
import { PAPETERIE, adapterTrameOdt } from '@/lib/web/papeterie';
import { estTjOrigine } from '@/lib/web/identite';
import { aujourdhui, CASES_TRAME, delaisDe, paysDe } from './logique';
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
  /** Magistrat dont les coordonnées et le nom figurent sur le courrier. */
  signataire: SignataireEntraide | null;
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

/** Délai de retour imprimé sur T1/T2 : raccourci si la demande porte un drapeau. */
function delaiRetour(d: DemandeEntraide): string {
  const mois = delaisDe(d).enqueteursMois;
  const texte = mois === 1 ? 'd’un mois' : `de ${['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six'][mois] || mois} mois`;
  return d.drapeau === 'rouge' ? `${texte} (dossier prioritaire)` : texte;
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
    delai_retour: delaiRetour(d),
  };
  for (const c of [...CASES_TRAME, 'tribunal', 'parquet']) v[`cb_${c}`] = '□';
  for (const c of cases) v[`cb_${c}`] = '☒';
  if (demandeur.tribunal) v.cb_tribunal = '☒';
  if (demandeur.parquet) v.cb_parquet = '☒';
  return v;
}

/** Remplit le modèle et rend le fichier .odt. */
export async function genererDocument(ctx: ContexteDocument): Promise<Blob> {
  const res = await fetch(`/modeles/entraide/${ctx.doc}_${ctx.langue}.odt`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Modèle ${ctx.doc.toUpperCase()} (${ctx.langue}) introuvable`);
  const zip = new PizZip(await res.arrayBuffer());
  let content = adapterTrameOdt(zip.file('content.xml')!.asText());
  zip.file('styles.xml', adapterTrameOdt(zip.file('styles.xml')!.asText()));
  // T1/T2 : la grille des services de départ (commissariats et compagnies de
  // la Somme) n'existe qu'à Amiens ; ailleurs, seule la ligne « Autre unité ».
  if (!estTjOrigine()) {
    for (const cle of ['cb_comm_amiens', 'cb_cgd']) {
      content = content.replace(new RegExp(`<table:table-row\\b(?:(?!<table:table-row\\b)[\\s\\S])*?\\{\\{${cle}\\}\\}[\\s\\S]*?<\\/table:table-row>`), '');
    }
  }

  // Mesures : la ligne {{mesure}} du modèle est dupliquée, une par mesure.
  const lignes = lignesDemande(ctx.demande);
  content = content.replace(/<text:list-item>((?:(?!<\/text:list-item>)[\s\S])*?)\{\{mesure\}\}([\s\S]*?)<\/text:list-item>/, (_m, avant, apres) =>
    lignes.map((l) => `<text:list-item>${avant}${xml(l)}${apres}</text:list-item>`).join(''));

  // Les courriers sont signés à la main, hors de l'application : la ligne
  // {{signature}} des modèles (ancien emplacement de l'image) est retirée.
  content = content.replace(/<text:p\b[^>]*>\{\{signature\}\}<\/text:p>/g, '');

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
