'use client';

/**
 * SIRAL — L'ENDROIT UNIQUE : l'attaché est-il vivant, et que fournit-il ?
 *
 * Certaines fonctions supposent de lire tout le fonds sans qu'un magistrat soit
 * devant son écran — rapprocher deux cents dossiers, océriser des milliers de
 * pièces. Seul l'attaché le peut. Quand il n'est pas là, ces fonctions ne
 * tombent pas en panne : elles DISPARAISSENT. L'écran s'affiche, la liste est
 * simplement vide — et une liste vide de recoupements ressemble trait pour
 * trait à « vos dossiers ne se touchent pas ».
 *
 * Ce panneau existe pour que cette phrase-là ne puisse jamais être crue à tort.
 * Il dit, en une ligne : ce qui marche, ce qui ne marche pas, et quoi faire.
 *
 * Il sépare aussi deux choses qu'on confond : ce que l'attaché CALCULE (calcul
 * local pur — rien ne quitte la machine, aucun jeton) et ce qu'il RÉDIGE (les
 * travaux confiés à Claude). Une authentification Claude périmée n'arrête aucun
 * calcul, et ne doit donc jamais faire croire le contraire.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cpu, PenLine, PowerOff, RefreshCw, XCircle } from 'lucide-react';

type EtatAttache = 'absent' | 'injoignable' | 'aveugle' | 'partiel' | 'en-marche';

interface Sante {
  etat: EtatAttache;
  resume: string;
  remede: string | null;
  contentieuxVus: string[];
  contentieuxManquants: string[];
  iaDisponible: boolean;
}

interface Perimetre {
  contentieux?: string[];
  dossiers?: number;
  pieces?: number;
  piecesLues?: number;
  piecesNonLues?: number;
}

interface Rapport {
  sante: Sante;
  calcule: {
    recoupements: { dernierAt: string | null; signaux?: number; perimetre?: Perimetre; enCours?: boolean };
    piecesEnCache: number;
  };
  redige: { disponible: boolean; detail: string | null };
}

const TON: Record<EtatAttache, { bord: string; fond: string; texte: string; Icone: typeof CheckCircle2 }> = {
  'en-marche': { bord: 'border-emerald-200', fond: 'bg-emerald-50', texte: 'text-emerald-900', Icone: CheckCircle2 },
  partiel: { bord: 'border-amber-300', fond: 'bg-amber-50', texte: 'text-amber-900', Icone: AlertTriangle },
  aveugle: { bord: 'border-red-300', fond: 'bg-red-50', texte: 'text-red-900', Icone: XCircle },
  injoignable: { bord: 'border-red-300', fond: 'bg-red-50', texte: 'text-red-900', Icone: PowerOff },
  absent: { bord: 'border-gray-300', fond: 'bg-gray-50', texte: 'text-gray-700', Icone: PowerOff },
};

function dateCourte(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function AttacheSante() {
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [chargement, setChargement] = useState(true);

  const lire = useCallback(async () => {
    setChargement(true);
    try {
      const res = await fetch('/api/attache/sante', { cache: 'no-store', credentials: 'include' });
      setRapport(res.ok ? await res.json() : null);
    } catch {
      setRapport(null);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => { void lire(); }, [lire]);

  if (chargement && !rapport) {
    return <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-400">Interrogation de l&apos;attaché…</div>;
  }
  if (!rapport) {
    return (
      <div className="rounded-xl border border-gray-300 bg-gray-50 p-3 text-xs text-gray-600">
        État de l&apos;attaché indisponible — le serveur n&apos;a pas répondu.
      </div>
    );
  }

  const { sante, calcule, redige } = rapport;
  const ton = TON[sante.etat];
  const { Icone } = ton;
  const recoup = calcule.recoupements;
  const perimetre = recoup.perimetre;

  return (
    <div className={`rounded-xl border ${ton.bord} ${ton.fond} p-3 space-y-2.5`}>
      <div className="flex items-start gap-2">
        <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${ton.texte}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-medium leading-snug ${ton.texte}`}>{sante.resume}</p>
          {sante.remede && (
            <p className="mt-1 text-[11px] leading-snug text-gray-600">
              <span className="font-semibold">À faire :</span> {sante.remede}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => { void lire(); }}
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700"
          title="Réinterroger"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${chargement ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {/* Ce qu'il CALCULE — aucun jeton, rien ne sort de la machine. */}
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <Cpu className="h-3 w-3" /> Ce qu&apos;il calcule
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-gray-400">
            Calcul local, sans intelligence artificielle : rien ne quitte la machine, aucun jeton n&apos;est consommé.
          </p>
          <ul className="mt-1.5 space-y-1 text-[11px] text-gray-700">
            <li>
              <span className="font-medium">Recoupements</span>{' '}
              {recoup.enCours
                ? <span className="text-gray-500">— chantier en cours…</span>
                : recoup.dernierAt
                  ? (
                    <span className="text-gray-500">
                      — {dateCourte(recoup.dernierAt)}
                      {typeof recoup.signaux === 'number' ? ` · ${recoup.signaux} signal(aux)` : ''}
                      {perimetre?.dossiers ? ` · ${perimetre.dossiers} dossiers` : ''}
                      {perimetre?.pieces
                        ? ` · ${perimetre.piecesLues ?? 0}/${perimetre.pieces} pièces lues`
                        : ''}
                    </span>
                  )
                  : <span className="text-amber-700">— aucun chantier n&apos;a encore tourné</span>}
            </li>
            <li>
              <span className="font-medium">Texte des pièces</span>{' '}
              <span className="text-gray-500">
                — {calcule.piecesEnCache} pièce(s) déjà lues, océrisation comprise
              </span>
            </li>
          </ul>
          {perimetre?.piecesNonLues ? (
            <p className="mt-1 text-[10.5px] leading-snug text-amber-700">
              {perimetre.piecesNonLues} pièce(s) restent à analyser — reprises au prochain chantier.
            </p>
          ) : null}
        </div>

        {/* Ce qu'il RÉDIGE — dépend d'une authentification qui expire. */}
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <PenLine className="h-3 w-3" /> Ce qu&apos;il rédige
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-gray-400">
            Travaux confiés à Claude. Leur interruption n&apos;arrête AUCUN des calculs ci-contre.
          </p>
          <p className={`mt-1.5 text-[11px] ${redige.disponible ? 'text-gray-700' : 'text-amber-700'}`}>
            {redige.disponible
              ? `Disponible${redige.detail ? ` · ${redige.detail}` : ''}`
              : 'Indisponible — authentification Claude à refaire.'}
          </p>
        </div>
      </div>

      {sante.contentieuxVus.length > 0 && (
        <p className="text-[10.5px] leading-snug text-gray-500">
          Contentieux vus : <b>{sante.contentieuxVus.join(', ')}</b>
          {sante.contentieuxManquants.length > 0 && (
            <> · manquants : <b className="text-amber-700">{sante.contentieuxManquants.join(', ')}</b></>
          )}
        </p>
      )}
    </div>
  );
}
