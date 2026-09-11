'use client';

/**
 * SIRAL — Attaché de justice · où en est le flux tendu sur CE dossier.
 *
 * Le travail de l'attaché est silencieux par construction : une pièce versée
 * part en file, est lue, puis donne — ou non — un compte rendu. Sans rien à
 * l'écran, le magistrat ne sait pas distinguer « ça arrive » de « ça ne
 * viendra pas ». Ce bandeau dit l'étape en cours, puis le RÉSULTAT RÉEL.
 *
 * Il ne PROMET jamais un compte rendu : la décision d'écrire appartient au
 * passage lui-même, une fois les pièces lues. Tant qu'il n'a pas eu lieu, le
 * bandeau dit ce qui est vrai — « analyse dans 40 s », « analyse en cours » —
 * et la conclusion ne s'affiche qu'une fois connue.
 *
 * Visible du SEUL administrateur (la route rend 404 à tout autre compte, le
 * bandeau disparaît alors de lui-même), et masqué avec le reste des
 * fonctionnalités IA.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Clock, FileCheck2, CircleSlash, AlertTriangle, PauseCircle, Hammer } from 'lucide-react';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { useIaMasquee } from '@/stores/useIaVisibiliteStore';

interface Attente { numero: string; depuis: string; raisons: string[]; pretDansMs: number }
interface Bilan {
  numero: string; at: string; pieces?: number; enAttente?: number; crs?: number; actes?: number;
  crEcrit?: number; mecProposes?: number; actesProposes?: number; descriptionChangee?: boolean;
  run?: boolean; chantier?: boolean; differe?: boolean; message?: string; erreur?: string;
}
interface Etat { attente: Attente | null; enCours: boolean; dernier: Bilan | null }

/** Au-delà, le bilan n'est plus une réponse à ce que le magistrat vient de faire. */
const BILAN_FRAIS_MS = 15 * 60 * 1000;

/** Ce qui a mis le dossier en file, dit en clair (la raison est « <quoi> — <qui> »). */
function causeLisible(raisons: string[]): string {
  const quoi = String(raisons?.[raisons.length - 1] || '').split('—')[0].trim();
  if (quoi === 'document') return 'Pièce reçue';
  if (quoi === 'cr') return 'Compte rendu ajouté';
  if (quoi === 'acte') return 'Acte ajouté';
  if (quoi === 'suite') return 'Dépouillement à poursuivre';
  return 'Dossier modifié';
}

function ilYA(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  return `il y a ${min} min`;
}

export function FluxBandeau({ numero }: { numero: string }) {
  const iaMasquee = useIaMasquee();
  const [etat, setEtat] = useState<Etat | null>(null);
  const [pretA, setPretA] = useState<number | null>(null);
  const [, setTic] = useState(0);
  // Un passage qui a ÉCRIT doit se voir dans la fiche, pas seulement dans le
  // bandeau : on tire le coffre une fois par bilan.
  const rafraichi = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/attache/flux?numero=' + encodeURIComponent(numero), { cache: 'no-store' });
      if (!res.ok) { setEtat(null); return; }
      const data = await res.json() as Etat;
      setEtat(data);
      setPretA(data.attente ? Date.now() + data.attente.pretDansMs : null);
      const b = data.dernier;
      const aEcrit = Boolean(b && ((b.crEcrit || 0) > 0 || (b.mecProposes || 0) > 0 || b.descriptionChangee));
      if (b && aEcrit && rafraichi.current !== b.at && Date.now() - new Date(b.at).getTime() < BILAN_FRAIS_MS) {
        rafraichi.current = b.at;
        await useEnquetesStore.getState().syncAndRefresh().catch(() => {});
      }
    } catch {
      setEtat(null);
    }
  }, [numero]);

  const actif = Boolean(etat?.attente || etat?.enCours);

  useEffect(() => {
    if (iaMasquee) return;
    void load();
    const timer = setInterval(() => { void load(); }, actif ? 5000 : 20000);
    return () => clearInterval(timer);
  }, [load, actif, iaMasquee]);

  // Décompte lisible pendant la période de calme.
  useEffect(() => {
    if (!pretA) return;
    const timer = setInterval(() => setTic((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [pretA]);

  if (iaMasquee || !etat) return null;

  const { attente, enCours, dernier } = etat;
  const bilanFrais = dernier && Date.now() - new Date(dernier.at).getTime() < BILAN_FRAIS_MS ? dernier : null;
  if (!attente && !enCours && !bilanFrais) return null;

  let Icone = Clock;
  let ton = 'border-slate-200 bg-slate-50/60';
  let titre = '';
  let detail = '';

  if (enCours) {
    Icone = Loader2;
    ton = 'border-blue-200/70 bg-blue-50/50';
    titre = 'Analyse en cours';
    detail = 'lecture des pièces nouvelles, puis compte rendu s\'il y a des faits nouveaux';
  } else if (attente) {
    const reste = Math.max(0, Math.ceil(((pretA ?? 0) - Date.now()) / 1000));
    Icone = Clock;
    ton = 'border-slate-200 bg-slate-50/60';
    titre = `${causeLisible(attente.raisons)} — analyse ${reste > 0 ? `dans ${reste} s` : 'imminente'}`;
    detail = 'un compte rendu sera rédigé s\'il y a des faits ou des infractions absents du dossier';
  } else if (bilanFrais) {
    const b = bilanFrais;
    const extras = [
      (b.mecProposes || 0) > 0 ? `${b.mecProposes} mis en cause proposé${b.mecProposes! > 1 ? 's' : ''} à valider` : '',
      (b.actesProposes || 0) > 0 ? `${b.actesProposes} acte${b.actesProposes! > 1 ? 's' : ''} proposé${b.actesProposes! > 1 ? 's' : ''}` : '',
      b.descriptionChangee ? 'description actualisée' : '',
      (b.enAttente || 0) > 0 ? `${b.enAttente} pièce(s) au prochain passage` : '',
    ].filter(Boolean).join(' · ');

    if (b.erreur) {
      Icone = AlertTriangle;
      ton = 'border-red-200 bg-red-50/60';
      titre = 'Passage interrompu';
      detail = b.erreur;
    } else if (b.differe) {
      Icone = PauseCircle;
      ton = 'border-amber-200/70 bg-amber-50/40';
      titre = 'Différé — forfait saturé';
      detail = 'rien n\'est perdu : le passage repart de lui-même';
    } else if (b.chantier) {
      Icone = Hammer;
      ton = 'border-amber-200/70 bg-amber-50/40';
      titre = 'Versement volumineux — chantier de dépouillement';
      detail = b.message || 'le devis attend votre validation dans Assistant de justice → Chantiers';
    } else if ((b.crEcrit || 0) > 0) {
      Icone = FileCheck2;
      ton = 'border-emerald-200/70 bg-emerald-50/50';
      titre = `Compte rendu rédigé ${ilYA(b.at)}`;
      detail = extras || `${b.pieces || 0} pièce(s) lue(s)`;
    } else {
      Icone = CircleSlash;
      ton = 'border-slate-200 bg-slate-50/60';
      titre = `Rien de neuf — pas de compte rendu (${ilYA(b.at)})`;
      detail = extras || `${b.pieces || 0} pièce(s) lue(s) : rien qui ne soit déjà au dossier`;
    }
  }

  return (
    <div className={`rounded-xl border px-3 py-2 ${ton}`}>
      <div className="flex items-center gap-2">
        <Icone className={`h-3.5 w-3.5 shrink-0 text-gray-600 ${enCours ? 'animate-spin' : ''}`} />
        <span className="text-xs font-bold text-gray-800">{titre}</span>
        <span className="text-[10.5px] text-gray-400">visible de vous seul</span>
      </div>
      {detail && <p className="mt-0.5 pl-5 text-[11px] leading-snug text-gray-500">{detail}</p>}
    </div>
  );
}
