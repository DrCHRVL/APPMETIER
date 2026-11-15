// utils/entraide/dee.ts
//
// Façade typée de lib/entraide/dee.mjs : lecture d'une DEE (annexe A) déposée
// dans le registre, dans le navigateur, et recherche des demandes déjà
// enregistrées qui lui correspondent.

import * as dee from '@/lib/entraide/dee.mjs';
import { fileToMarkdown } from '@/lib/web/fileToMarkdown';
import type { DemandeEntraide, EntraideSens } from '@/types/entraideTypes';

export interface PersonneDee {
  nom: string; prenoms: string; naissance: string; lieuNaissance: string; adresse: string; nationalite: string; qualite: string;
}

export interface FicheDee {
  sens: EntraideSens;
  pays: string;
  autorite: { nom: string; ville: string; email: string; pays: string };
  refEtrangere: string;
  refEsabora: string;
  dossier: string;
  procedure: string;
  dateEmission: string;
  urgence: string;
  dateButoir: string;
  mesures: string[];
  mesuresTitres: string[];
  personnes: PersonneDee[];
  infractions: string[];
  natinf: string[];
  dateFaits: string;
  lieuFaits: string;
}

export interface Correspondance { demande: DemandeEntraide; motifs: string[]; fort: boolean }

export const lireDee = dee.lireDee as (texte: string) => FicheDee | null;
export const demandesCorrespondantes = dee.demandesCorrespondantes as (demandes: DemandeEntraide[], fiche: FicheDee) => Correspondance[];
export const personnesEnTexteDee = dee.personnesEnTexteDee as (personnes: PersonneDee[]) => string;

/** Extrait le texte du fichier et lit le formulaire ; erreur explicite sinon. */
export async function lireFichierDee(fichier: File): Promise<FicheDee> {
  const { markdown, avertissement } = await fileToMarkdown(fichier, { maxChars: 400_000 });
  const fiche = lireDee(markdown);
  if (fiche) return fiche;
  if (avertissement && markdown.replace(/\[page \d+ : image sans couche texte\]/g, '').trim().length < 200) {
    throw new Error('Pièce scannée sans texte : la lecture automatique a besoin d’un PDF texte (ou passé à l’OCR).');
  }
  throw new Error('Ce document n’est pas reconnu comme une décision d’enquête européenne (formulaire annexe A en français).');
}

/** Observations de la fiche créée : ce que le formulaire ne range nulle part ailleurs. */
export function observationsDee(f: FicheDee, piece: string): string {
  return [
    `DEE${f.dateEmission ? ` du ${f.dateEmission.split('-').reverse().join('/')}` : ''} — lue depuis « ${piece} ».`,
    f.dossier ? `Dossier : ${f.dossier}.` : f.procedure ? `Procédure n° ${f.procedure}.` : '',
    f.mesuresTitres.length ? `Mesures : ${f.mesuresTitres.map((t, i) => `${i + 1}. ${t}`).join(' ; ')}.` : '',
    f.dateFaits || f.lieuFaits ? `Faits : ${[f.dateFaits, f.lieuFaits].filter(Boolean).join(', ')}.` : '',
    f.urgence ? `Urgence : ${f.urgence}` : '',
  ].filter(Boolean).join('\n');
}
