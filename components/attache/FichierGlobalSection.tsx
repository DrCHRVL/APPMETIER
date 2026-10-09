'use client';

/**
 * SIRAL — Fichier global d'un dossier (page Assistant de justice).
 *
 * La philosophie du « convertisseur PDF → TXT » du cabinet, intégrée : toutes
 * les pièces d'un dossier, en TEXTE, dans UN SEUL fichier — fiche du dossier,
 * chronologie et registre en tête, puis un sommaire et un bloc par pièce,
 * classées par THÈME (auditions, synthèses, téléphonie, expertises,
 * surveillances, décisions, autres), chaque pièce portant un numéro stable
 * P-xxxx. Le magistrat le télécharge (.txt, entier ou par thème) et le verse
 * dans son projet Claude web, qui y rédige. Claude web peut aussi le lire
 * directement par le connecteur (outil `dossier_global`, paginé).
 *
 * Le corps est servi depuis un cache que le service tient à jour à chaque
 * mouvement du dossier (flux tendu) et par passes de fond : instantané tant
 * que rien n'a bougé ; recompiler étend la couverture des pièces jamais
 * extraites.
 *
 * Le « DOSSIER DE RÉDACTION » (.zip) ajoute au fichier global les trames et
 * skills applicables à l'acte visé, les documents ★ de la base de
 * connaissances, les actes précédents du même type et les instructions du
 * projet Claude web : le projet reçoit sa base de connaissances en un geste.
 *
 * Visible du SEUL administrateur (se masque si /api/attache/status ≠ 200).
 */
import { useCallback, useEffect, useState } from 'react';
import { FileStack, Download, ListTree, Loader2, Link2, Archive } from 'lucide-react';
import { useEnquetesStore } from '@/stores/useEnquetesStore';
import { useIaMasquee } from '@/stores/useIaVisibiliteStore';

interface Stats {
  pieces: number; piecesDossier?: number; enTexte: number; copiesExactes: number; nonExtraites: number;
  illisibles: number; extractionsCetAppel: number; caracteres: number; corpsAJour?: string;
}
interface Theme { cle: string; libelle: string; pieces: number }

const fmt = (n: number) => n.toLocaleString('fr-FR');

/** Télécharge la réponse d'une route en fichier, nom repris de Content-Disposition. */
function telechargerBlob(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function nomDepuisEntete(cd: string | null, repli: string) {
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd || '');
  return m ? decodeURIComponent(m[1]) : repli;
}
const sur = (s: string) => s.replace(/[^\p{L}\p{N}._-]+/gu, '_');

export function FichierGlobalSection() {
  const iaMasquee = useIaMasquee();
  const enquetes = useEnquetesStore((s) => s.enquetes);
  const [available, setAvailable] = useState(false);
  const [numero, setNumero] = useState('');
  const [pochette, setPochette] = useState('');
  const [theme, setTheme] = useState('');
  const [acte, setActe] = useState('');
  const [busy, setBusy] = useState<'apercu' | 'txt' | 'zip' | null>(null);
  const [apercu, setApercu] = useState<{ dossier: string; stats: Stats; sommaire: string[]; themes: Theme[] } | null>(null);
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
    return '?numero=' + encodeURIComponent(n)
      + (pochette.trim() ? '&pochette=' + encodeURIComponent(pochette.trim()) : '')
      + (theme ? '&theme=' + encodeURIComponent(theme) : '');
  }, [numero, pochette, theme]);

  /** Sommaire + statistiques + thèmes présents, sans télécharger le texte complet dans la page. */
  const voirSommaire = useCallback(async () => {
    if (!numero.trim() || busy) return;
    setBusy('apercu');
    setNotice(null);
    try {
      const res = await fetch('/api/attache/dossier-global' + qs());
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) { setNotice(`Compilation impossible : ${data.error || res.status}`); return; }
      setApercu({ dossier: data.dossier, stats: data.stats, sommaire: data.sommaire || [], themes: data.themes || [] });
    } catch {
      setNotice('Compilation impossible — service injoignable.');
    } finally {
      setBusy(null);
    }
  }, [numero, busy, qs]);

  /** Le fichier .txt lui-même (entier, par thème ou par pochette) — à verser dans le projet Claude web. */
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
      const nom = nomDepuisEntete(res.headers.get('content-disposition'), `GLOBAL_${sur(numero.trim())}${theme ? '_' + theme : ''}.txt`);
      telechargerBlob(blob, nom);
      setNotice(`« ${nom} » téléchargé (${fmt(Math.round(blob.size / 1024))} Ko) — versez-le dans votre projet Claude web.`);
    } catch {
      setNotice('Téléchargement impossible — service injoignable.');
    } finally {
      setBusy(null);
    }
  }, [numero, busy, qs, theme]);

  /** Le dossier de rédaction (.zip) : fichier global + trames, skills, base ★, actes précédents, instructions du projet. */
  const dossierRedaction = useCallback(async () => {
    if (!numero.trim() || busy) return;
    setBusy('zip');
    setNotice(null);
    try {
      const res = await fetch('/api/attache/dossier-redaction?numero=' + encodeURIComponent(numero.trim()) + (acte.trim() ? '&acte=' + encodeURIComponent(acte.trim()) : ''));
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        setNotice(`Assemblage impossible : ${data.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const nom = nomDepuisEntete(res.headers.get('content-disposition'), `REDACTION_${sur(numero.trim())}.zip`);
      let fichiers: string[] = [];
      try { fichiers = JSON.parse(decodeURIComponent(res.headers.get('x-siral-fichiers') || '[]')); } catch { /* en-tête absent */ }
      telechargerBlob(blob, nom);
      setNotice(`« ${nom} » téléchargé (${fmt(Math.round(blob.size / 1024))} Ko, ${fichiers.length || '?'} fichier(s)) — versez son contenu dans la base de connaissances de votre projet Claude web ; LISEZMOI.md dit quoi faire de chaque fichier.`);
    } catch {
      setNotice('Assemblage impossible — service injoignable.');
    } finally {
      setBusy(null);
    }
  }, [numero, acte, busy]);

  if (iaMasquee || !available) return null;

  const champ = 'rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-gray-800 outline-none focus:border-[#2B5746]/50';
  const etiquette = 'flex flex-col gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400';

  return (
    <div className="rounded-xl border border-[#2B5746]/25 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <FileStack className="h-4 w-4 flex-shrink-0 text-[#2B5746]" />
        <span className="text-sm font-semibold text-gray-800">Fichier global du dossier</span>
        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#2B5746]">pour Claude web</span>
        <span className="hidden text-[11px] text-gray-400 sm:inline">toutes les pièces, en texte, dans un seul fichier — tenu à jour</span>
      </div>

      <div className="space-y-3 border-t border-gray-100 px-4 py-3">
        <p className="text-[11.5px] leading-relaxed text-gray-600">
          Un seul fichier <b>.txt</b> : en tête la <b>fiche du dossier</b> (description, mis en cause, NATINF, échéancier), la
          <b> chronologie</b> et le <b>registre des pièces</b> ; puis chaque pièce, classée par <b>thème</b> (auditions, synthèses,
          téléphonie, expertises, surveillances, décisions), précédée de son numéro stable <code className="rounded bg-gray-100 px-1">P-0042</code> et
          de sa cote. Versez-le dans votre projet Claude web et rédigez dessus. Le service le tient à jour à chaque mouvement du
          dossier : rien n&apos;est ré-extrait, les copies exactes ne sont pas répétées.
        </p>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-500">
          <Link2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#2B5746]" />
          <span>
            Sans téléchargement : Claude web lit le même fichier par le connecteur SIRAL (outil
            <code className="mx-1 rounded bg-gray-100 px-1">dossier_global</code>, par pages et par thème) et cite les pièces par leur
            numéro P-xxxx d&apos;une conversation à l&apos;autre.
          </span>
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className={`${etiquette} min-w-[220px] flex-1`}>
            Dossier
            <input
              value={numero}
              onChange={(e) => { setNumero(e.target.value); setApercu(null); setTheme(''); }}
              list="fichier-global-dossiers"
              placeholder="Numéro d'enquête ou d'instruction"
              className={champ}
            />
            <datalist id="fichier-global-dossiers">
              {enquetes.map((e) => <option key={String(e.numero)} value={String(e.numero)} />)}
            </datalist>
          </label>
          <label className={`${etiquette} w-44`}>
            Thème (optionnel)
            <select value={theme} onChange={(e) => setTheme(e.target.value)} className={champ}>
              <option value="">Tout le dossier</option>
              {(apercu?.themes || []).map((t) => <option key={t.cle} value={t.cle}>{t.libelle} ({t.pieces})</option>)}
            </select>
          </label>
          <label className={`${etiquette} w-44`}>
            Pochette (optionnel)
            <input
              value={pochette}
              onChange={(e) => { setPochette(e.target.value); setApercu(null); }}
              placeholder="ex. PV/GOSSE, Dossier/D2"
              className={champ}
            />
          </label>
          <button
            onClick={voirSommaire}
            disabled={!numero.trim() || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Compile le fichier et affiche son sommaire (thèmes, pièces, taille, pièces non extraites) sans le télécharger"
          >
            {busy === 'apercu' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5" />}Sommaire
          </button>
          <button
            onClick={telecharger}
            disabled={!numero.trim() || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#234737] disabled:opacity-40"
            title="Télécharge le fichier global (.txt) — entier, ou le seul thème choisi — à verser dans le projet Claude web"
          >
            {busy === 'txt' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Télécharger le .txt
          </button>
        </div>

        {/* Dossier de rédaction : tout ce qu'un projet Claude web attend, en une archive */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[#2B5746]/30 bg-emerald-50/30 p-2.5">
          <div className="min-w-[220px] flex-1">
            <div className="text-[11px] font-semibold text-gray-800">Dossier de rédaction (.zip) — prêt à verser dans le projet</div>
            <p className="text-[10.5px] leading-snug text-gray-500">
              Fichier global + trames et skills de l&apos;acte visé + documents ★ de la base de connaissances + actes précédents du
              même type + instructions du projet Claude web, avec un LISEZMOI. Sans acte visé : toutes les trames et skills.
            </p>
          </div>
          <label className={`${etiquette} w-56`}>
            Acte visé (optionnel)
            <input
              value={acte}
              onChange={(e) => setActe(e.target.value)}
              placeholder="ex. réquisitoire définitif, prolongation géoloc"
              className={champ}
            />
          </label>
          <button
            onClick={dossierRedaction}
            disabled={!numero.trim() || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2B5746]/40 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#2B5746] hover:bg-emerald-50 disabled:opacity-40"
            title="Assemble l'archive (.zip) à verser dans la base de connaissances du projet Claude web"
          >
            {busy === 'zip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}Dossier de rédaction
          </button>
        </div>

        {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11.5px] text-emerald-800">{notice}</p>}

        {apercu && (
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
              <span className="font-semibold text-gray-800">{apercu.dossier}</span>
              <span>{fmt(apercu.stats.pieces)} pièce(s){apercu.stats.piecesDossier && apercu.stats.piecesDossier !== apercu.stats.pieces ? ` sur ${fmt(apercu.stats.piecesDossier)}` : ''}</span>
              <span>{fmt(apercu.stats.enTexte)} en texte</span>
              {apercu.stats.copiesExactes > 0 && <span>{fmt(apercu.stats.copiesExactes)} copie(s) exacte(s) non répétée(s)</span>}
              {apercu.stats.illisibles > 0 && <span className="text-amber-700">{fmt(apercu.stats.illisibles)} illisible(s)</span>}
              <span>{fmt(apercu.stats.caracteres)} caractères</span>
              {apercu.stats.corpsAJour && <span className="text-gray-400">corps à jour au {new Date(apercu.stats.corpsAJour).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>}
            </div>
            {apercu.themes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {apercu.themes.map((t) => (
                  <button
                    key={t.cle}
                    onClick={() => setTheme(theme === t.cle ? '' : t.cle)}
                    className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${theme === t.cle ? 'border-[#2B5746] bg-[#2B5746] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                    title="Ne télécharger que ce thème"
                  >
                    {t.libelle} · {t.pieces}
                  </button>
                ))}
              </div>
            )}
            {apercu.stats.nonExtraites > 0 && (
              <p className="mt-1.5 text-[11px] leading-snug text-amber-800">
                {fmt(apercu.stats.nonExtraites)} pièce(s) n&apos;ont pas encore de texte extrait : relancez « Sommaire »
                (chaque compilation en extrait jusqu&apos;à {apercu.stats.extractionsCetAppel || 20} de plus, définitivement)
                — ou laissez le service les rattraper en fond.
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
