'use client';

/**
 * SIRAL — Attaché de justice · actes rédigés, dossier par dossier.
 *
 * Sur la page « Assistant de justice », seule à porter l'atelier des actes
 * depuis que la fiche enquête n'a plus de section « Actes rédigés » : une ligne
 * par dossier qui a des actes (ceux qui attendent une décision d'abord),
 * dépliée en l'atelier complet du dossier (ProductionsSection : relecture,
 * retouche, exports, validation, refus, actes traités). Les actes hors dossier
 * gardent leur propre section.
 *
 * Le sommaire arrive chiffré (clé globale) et se déchiffre ici. Service
 * endormi : un échantillon par répertoire nomme chaque dossier, et l'atelier
 * déplié lit ses actes en lecture seule — rien ne disparaît.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileSignature, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import { ProductionsSection } from './ProductionsSection';
import { useIaMasquee } from '@/stores/useIaVisibiliteStore';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { siralBridge: Record<string, AnyFn> }).siralBridge;

interface DossierActes {
  numero: string;
  enAttente: number;
  /** Validés ou refusés. */
  traites: number;
  /** Fiches et synthèses de chantier — tenues à part des actes. */
  chantier: number;
  maj: string;
  /** Service endormi : seul le nombre de documents est connu. */
  total?: number;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function ActesRedigesDossiers({ serviceDuDossier }: {
  /** Service d'enquête d'un dossier — 2ᵉ segment du nom de fichier exporté. */
  serviceDuDossier?: (numero: string) => string | undefined;
}) {
  const iaMasquee = useIaMasquee();
  const [dossiers, setDossiers] = useState<DossierActes[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Un seul dossier déplié à la fois : la page reste lisible.
  const [ouvert, setOuvert] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/productions?sommaire=1');
      const data = await res.json().catch(() => ({})) as {
        envelope?: unknown; degrade?: boolean; dossiers?: Array<{ nb: number; echantillon: unknown }>;
      };
      if (res.ok && data.degrade) {
        const parNumero = new Map<string, DossierActes>();
        for (const r of data.dossiers || []) {
          const rec = await eapi().attache_decrypt(r.echantillon) as { numero?: string } | null;
          const numero = String(rec?.numero || '');
          if (!numero || numero.startsWith('_')) continue;
          const d = parNumero.get(numero) || { numero, enAttente: 0, traites: 0, chantier: 0, maj: '', total: 0 };
          d.total = (d.total || 0) + r.nb;
          parNumero.set(numero, d);
        }
        setDossiers([...parNumero.values()]);
        return;
      }
      if (!res.ok || !data.envelope) { setDossiers(null); return; }
      const payload = await eapi().attache_decrypt(data.envelope) as { dossiers?: DossierActes[] } | null;
      setDossiers(payload?.dossiers || []);
    } catch {
      setDossiers(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (iaMasquee || !dossiers || dossiers.length === 0) return null;

  const enAttente = dossiers.reduce((n, d) => n + d.enAttente, 0);

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <FileSignature className="h-4 w-4 text-[#2B5746]" />
        <span className="flex-1 text-sm font-semibold text-gray-800">
          Actes rédigés — par dossier
          {enAttente > 0 && <span className="ml-2 whitespace-nowrap text-[11px] font-normal text-gray-400">{enAttente} en attente</span>}
        </span>
        <button onClick={load} className="rounded p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Actualiser">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {dossiers.map((d) => {
          const isOpen = ouvert === d.numero;
          const compteurs = d.total !== undefined ? pluriel(d.total, 'document') : [
            d.enAttente > 0 ? `${d.enAttente} en attente` : '',
            d.traites > 0 ? pluriel(d.traites, 'traité') : '',
            d.chantier > 0 ? `${pluriel(d.chantier, 'production')} de chantier` : '',
          ].filter(Boolean).join(' · ');
          return (
            <div key={d.numero}>
              <button
                // Quitter un dossier déplié recharge le sommaire : les compteurs
                // suivent ce qui vient d'y être validé ou refusé.
                onClick={() => { if (ouvert) load(); setOuvert(isOpen ? null : d.numero); }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-gray-50"
              >
                <span className="rounded bg-[#2B5746]/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#2B5746]">{d.numero}</span>
                <span className={`min-w-0 flex-1 truncate text-[11.5px] ${d.enAttente > 0 ? 'font-medium text-gray-700' : 'text-gray-400'}`}>{compteurs}</span>
                <span className="hidden text-[10px] text-gray-400 sm:inline">{d.maj ? new Date(d.maj).toLocaleDateString('fr-FR') : ''}</span>
                {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>
              {isOpen && (
                <div className="px-2 pb-2 sm:px-3 sm:pb-3">
                  <ProductionsSection numero={d.numero} service={serviceDuDossier?.(d.numero)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
