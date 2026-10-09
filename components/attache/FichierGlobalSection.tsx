'use client';

/**
 * SIRAL — Fichier global d'un dossier (page Assistant de justice).
 *
 * La philosophie du « convertisseur PDF → TXT » du cabinet, intégrée : toutes
 * les pièces d'un dossier, en TEXTE, dans UN SEUL fichier — un sommaire, puis
 * un bloc par pièce. Le magistrat le télécharge (.txt) et le verse dans son
 * projet Claude web, qui y rédige (réquisitoire définitif, synthèse,
 * recherche transversale). Claude web peut aussi le lire directement par le
 * connecteur (outil `dossier_global`, paginé) sans rien télécharger.
 *
 * Le service attaché compile à partir des caches d'extraction (ingestion de
 * fond, OCR des scans muets) : rien n'est ré-extrait, sauf un nombre borné de
 * pièces jamais extraites — recompiler étend alors la couverture.
 *
 * Visible du SEUL administrateur (se masque si /api/attache/status ≠ 200).
 */
import { useCallback, useEffect, useState } from 'react';
import { FileStack, Download, ListTree, Loader2, Link2 } from 'lucide-react';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { useIaMasquee } from '@/stores/useIaVisibiliteStore';

interface Stats {
  pieces: number; enTexte: number; copiesExactes: number; nonExtraites: number;
  illisibles: number; extractionsCetAppel: number; caracteres: number;
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

export function FichierGlobalSection() {
  const iaMasquee = useIaMasquee();
  const enquetes = useEnquetesStore((s) => s.enquetes);
  const [available, setAvailable] = useState(false);
  const [numero, setNumero] = useState('');
  const [pochette, setPochette] = useState('');
  const [busy, setBusy] = useState<'apercu' | 'txt' | null>(null);
  const [apercu, setApercu] = useState<{ dossier: string; stats: Stats; sommaire: string[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/attache/status?sonde=1')
      .then((r) => { if (!cancelled) setAvailable(r.ok); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  const qs = useCallback(() => {
    const n = numero.trim();
    return '?numero=' + encodeURIComponent(n) + (pochette.trim() ? '&pochette=' + encodeURIComponent(pochette.trim()) : '');
  }, [numero, pochette]);

  /** Sommaire + statistiques, sans télécharger le texte complet dans la page. */
  const voirSommaire = useCallback(async () => {
    if (!numero.trim() || busy) return;
    setBusy('apercu');
    setNotice(null);
    try {
      const res = await fetch('/api/attache/dossier-global' + qs());
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) { setNotice(`Compilation impossible : ${data.error || res.status}`); return; }
      setApercu({ dossier: data.dossier, stats: data.stats, sommaire: data.sommaire || [] });
    } catch {
      setNotice('Compilation impossible — service injoignable.');
    } finally {
      setBusy(null);
    }
  }, [numero, busy, qs]);

  /** Le fichier .txt lui-même — à verser dans le projet Claude web. */
  const telecharger = useCallback(async () => {
    if (!numero.trim() || busy) return;
    setBusy('txt');
    setNotice(null);
    try {
      const res = await fetch('/api/attache/dossier-global' + qs() + '&format=txt');
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setNotice(`Téléchargement impossible : ${data.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
      const nom = m ? decodeURIComponent(m[1]) : `GLOBAL_${numero.trim().replace(/[^\p{L}\p{N}._-]+/gu, '_')}.txt`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nom; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNotice(`« ${nom} » téléchargé (${fmt(Math.round(blob.size / 1024))} Ko) — versez-le dans votre projet Claude web.`);
    } catch {
      setNotice('Téléchargement impossible — service injoignable.');
    } finally {
      setBusy(null);
    }
  }, [numero, busy, qs]);

  if (iaMasquee || !available) return null;

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <FileStack className="h-4 w-4 flex-shrink-0 text-[#2B5746]" />
        <span className="text-sm font-semibold text-gray-800">Fichier global du dossier</span>
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">pour Claude web</span>
        <span className="hidden text-[11px] text-gray-400 sm:inline">toutes les pièces, en texte, dans un seul fichier</span>
      </div>

      <div className="space-y-3 border-t border-gray-100 px-4 py-3">
        <p className="text-[11.5px] leading-relaxed text-gray-600">
          Un seul fichier <b>.txt</b> : un sommaire numéroté, puis chaque pièce du dossier précédée de sa cote
          (<code className="rounded bg-gray-100 px-1">📄 chemin</code>). Versez-le dans votre projet Claude web et
          rédigez dessus — réquisitoire définitif, synthèse, recherche transversale. Rien n&apos;est ré-extrait :
          le texte vient des caches de l&apos;attaché (OCR des scans compris) ; les copies exactes ne sont pas répétées.
        </p>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
          <Link2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#2B5746]" />
          <span>
            Sans téléchargement : Claude web lit le même fichier par le connecteur SIRAL (outil
            <code className="mx-1 rounded bg-gray-100 px-1">dossier_global</code>, par pages), pochette par pochette sur un
            dossier volumineux.
          </span>
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
            Dossier
            <input
              value={numero}
              onChange={(e) => { setNumero(e.target.value); setApercu(null); }}
              list="fichier-global-dossiers"
              placeholder="Numéro d'enquête ou d'instruction"
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-gray-800 outline-none focus:border-[#2B5746]/50"
            />
            <datalist id="fichier-global-dossiers">
              {enquetes.map((e) => <option key={String(e.numero)} value={String(e.numero)} />)}
            </datalist>
          </label>
          <label className="flex w-48 flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
            Pochette (optionnel)
            <input
              value={pochette}
              onChange={(e) => { setPochette(e.target.value); setApercu(null); }}
              placeholder="ex. PV/GOSSE, Dossier/D2"
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-gray-800 outline-none focus:border-[#2B5746]/50"
            />
          </label>
          <button
            onClick={voirSommaire}
            disabled={!numero.trim() || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Compile le fichier et affiche son sommaire (pièces, taille, pièces non extraites) sans le télécharger"
          >
            {busy === 'apercu' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5" />}Sommaire
          </button>
          <button
            onClick={telecharger}
            disabled={!numero.trim() || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#234737] disabled:opacity-40"
            title="Télécharge le fichier global (.txt) — à verser dans le projet Claude web"
          >
            {busy === 'txt' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Télécharger le .txt
          </button>
        </div>

        {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11.5px] text-emerald-800">{notice}</p>}

        {apercu && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
              <span className="font-semibold text-gray-800">{apercu.dossier}</span>
              <span>{fmt(apercu.stats.pieces)} pièce(s)</span>
              <span>{fmt(apercu.stats.enTexte)} en texte</span>
              {apercu.stats.copiesExactes > 0 && <span>{fmt(apercu.stats.copiesExactes)} copie(s) exacte(s) non répétée(s)</span>}
              {apercu.stats.illisibles > 0 && <span className="text-amber-700">{fmt(apercu.stats.illisibles)} illisible(s)</span>}
              <span>{fmt(apercu.stats.caracteres)} caractères</span>
            </div>
            {apercu.stats.nonExtraites > 0 && (
              <p className="mt-1.5 text-[11px] leading-snug text-amber-800">
                {fmt(apercu.stats.nonExtraites)} pièce(s) n&apos;ont pas encore de texte extrait : relancez « Sommaire »
                (chaque compilation en extrait jusqu&apos;à {apercu.stats.extractionsCetAppel || 20} de plus, définitivement)
                — ou laissez l&apos;ingestion de fond de l&apos;attaché les rattraper.
              </p>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 hover:text-gray-700">
                Sommaire ({apercu.sommaire.length})
              </summary>
              <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-2 text-[10.5px] leading-relaxed text-gray-700">
                {apercu.sommaire.join('\n')}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
