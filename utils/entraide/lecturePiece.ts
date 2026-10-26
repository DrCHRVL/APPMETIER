// utils/entraide/lecturePiece.ts
//
// Lecture d'une pièce d'entraide par le service attaché (réservé à
// l'administrateur : toute autre session reçoit 404 et ne voit rien).
// La pièce part en mémoire, n'est pas conservée ; seule la fiche de lecture
// l'est, côté service.

import { useEffect, useState } from 'react';
import { useIaMasquee } from '@/stores/useIaVisibiliteStore';

export interface LecturePiece {
  synthese: string;
  demande: string;
  mesures: string[];
  mesuresAutres: string[];
  lieux: Array<{ ville: string; adresse: string; role: string }>;
  personnes: Array<{ nom: string; qualite: string; naissance: string; adresse: string }>;
  autorite: { nom: string; ville: string; pays: string; reference: string };
  pays: string;
  type: '' | 'dee' | 'do' | 'cri' | 'execution' | 'civil';
  sens: '' | 'recue' | 'emise';
  infractions: string;
  dateFaits: string;
  dateButoir: string;
  urgence: string;
  langue: string;
  vigilance: string[];
  piece: string;
  source: string;
  luLe: string;
}

const ROUTE = '/api/attache/entraide-analyse';
let sonde: Promise<boolean> | null = null;

/** La lecture des pièces est-elle offerte à cette session ? (sonde en cache) */
export function useLecturePieceDisponible(): boolean {
  const masquee = useIaMasquee();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (masquee) { setOk(false); return; }
    if (!sonde) sonde = fetch(ROUTE, { credentials: 'same-origin' }).then((r) => r.ok).catch(() => false);
    let vivant = true;
    sonde.then((v) => { if (vivant) setOk(v); });
    return () => { vivant = false; };
  }, [masquee]);
  return ok;
}

async function enBase64(fichier: File): Promise<string> {
  const octets = new Uint8Array(await fichier.arrayBuffer());
  let bin = '';
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function lirePiece(fichier: File, demandeId?: string): Promise<{ analyse: LecturePiece; lectures?: LecturePiece[] }> {
  if (fichier.size > 20 * 1024 * 1024) throw new Error('Pièce trop volumineuse (20 Mo au plus)');
  const res = await fetch(ROUTE, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nom: fichier.name, b64: await enBase64(fichier), ...(demandeId ? { demandeId } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Lecture impossible');
  return { analyse: data.analyse, lectures: data.lectures };
}

export async function lecturesDemande(demandeId: string): Promise<LecturePiece[]> {
  const res = await fetch(`${ROUTE}?id=${encodeURIComponent(demandeId)}`, { credentials: 'same-origin' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.lectures) ? data.lectures : [];
}

export async function rattacherLecture(demandeId: string, analyse: LecturePiece): Promise<void> {
  await fetch(ROUTE, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'sauver', demandeId, analyse }),
  }).catch(() => {});
}

/** Personnes au format du champ « Personne(s) visée(s) ». */
export function personnesEnTexte(l: LecturePiece): string {
  return l.personnes
    .map((p) => [p.nom, p.naissance ? `né(e) ${p.naissance}` : '', p.adresse ? `demeurant ${p.adresse}` : ''].filter(Boolean).join(', '))
    .join(' ; ');
}
