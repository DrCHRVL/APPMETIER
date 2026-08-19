'use client';

/**
 * SIRAL — pastille « chantier d'analyse profonde en cours ».
 *
 * Un point bleu discret, auto-sondant, posé sur le bouton Attaché du Header
 * (tous chantiers) et sur la pastille repliée du chat de dossier (chantiers
 * de CE dossier). Le magistrat sait d'un coup d'œil qu'un dépouillement
 * tourne — sans ouvrir la page Assistant de justice.
 *
 * Admin uniquement de fait : /api/attache/chantiers refuse tout autre compte,
 * la pastille ne rend alors rien et cesse de sonder — aucune mention d'IA
 * n'atteint les autres utilisateurs.
 */
import { useEffect, useRef, useState } from 'react';

const POLL_MS = 120_000;

interface ChantierMini { etat: string; numero?: string; numeros?: string[] | null }

/** true si un chantier tourne (en_cours/synthese) — du dossier donné, ou n'importe lequel. */
export function useChantierActif(numero?: string): boolean {
  const [actif, setActif] = useState(false);
  const deadRef = useRef(false); // service absent / non-admin : on cesse de sonder

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (deadRef.current || document.hidden) return;
      try {
        const res = await fetch('/api/attache/chantiers');
        if (!res.ok) { deadRef.current = true; if (!cancelled) setActif(false); return; }
        const data = (await res.json().catch(() => ({}))) as { chantiers?: ChantierMini[] };
        const enCours = (data.chantiers || []).some((c) =>
          ['en_cours', 'synthese'].includes(c.etat)
          && (!numero || String(c.numero) === numero || (c.numeros || []).some((n) => String(n) === numero))
        );
        if (!cancelled) setActif(enCours);
      } catch {
        if (!cancelled) setActif(false);
      }
    };
    check();
    const t = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [numero]);

  return actif;
}

/** Le point lui-même — à poser dans un parent positionné (relative/fixed/absolute). */
export function ChantierDot({ numero, className }: { numero?: string; className?: string }) {
  const actif = useChantierActif(numero);
  if (!actif) return null;
  return (
    <span
      title="Chantier d'analyse profonde en cours"
      className={className || 'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white animate-pulse'}
    />
  );
}
