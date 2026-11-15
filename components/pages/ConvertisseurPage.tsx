'use client';

// Module « Convertisseur PDF → texte » : on dépose des PDF, des dossiers ou des
// ZIP (même imbriqués), SIRAL rend un .txt par PDF et des fichiers globaux
// (un seul, ou un par dossier au niveau choisi). Tout est traité dans le
// navigateur : aucun fichier ne quitte le poste.

import React, { useMemo, useRef, useState } from 'react';
import PizZip from 'pizzip';
import {
  FileText, FolderOpen, UploadCloud, Download, Copy, RotateCcw, X, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle2, ShieldCheck, Loader2, Layers, Files,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { copyPlainToClipboard } from '@/utils/richTextExport';
import {
  collecterPdfs, convertirPdf, construireGlobal, grouper, lireDataTransfer, niveauAuto, niveauMax, nomGlobal,
  type Depot, type ModeGlobal, type ResultatPdf, type SourcePdf,
} from '@/lib/web/convertisseurPdf';

const VERT = '#2B5746';
const PARALLELE = 3;

type Etape = 'vide' | 'lecture' | 'pret' | 'conversion' | 'termine';

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const taille = (o: number) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);

function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const blobTexte = (t: string) => new Blob([t], { type: 'text/plain;charset=utf-8' });

export const ConvertisseurPage: React.FC = () => {
  const { showToast } = useToast();
  const [etape, setEtape] = useState<Etape>('vide');
  const [survol, setSurvol] = useState(false);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [sources, setSources] = useState<SourcePdf[]>([]);
  const [ignores, setIgnores] = useState<string[]>([]);
  const [resultats, setResultats] = useState<ResultatPdf[]>([]);
  const [enCours, setEnCours] = useState<string[]>([]);
  const [mode, setMode] = useState<ModeGlobal>('parDossier');
  const [decalage, setDecalage] = useState(0);
  const [individuels, setIndividuels] = useState(true);
  const annule = useRef(false);
  const inputFichiers = useRef<HTMLInputElement>(null);
  const inputDossier = useRef<HTMLInputElement>(null);

  const chemins = useMemo(() => sources.map(s => s.chemin), [sources]);
  const auto = useMemo(() => niveauAuto(chemins), [chemins]);
  const max = useMemo(() => Math.max(auto, niveauMax(chemins)), [auto, chemins]);
  const niveau = Math.min(max, Math.max(0, auto + decalage));
  const groupes = useMemo(() => grouper(chemins, mode, niveau), [chemins, mode, niveau]);

  // ── Dépôt ──
  async function ajouter(nouveaux: Depot[]) {
    if (!nouveaux.length) return;
    const tous = [...depots, ...nouveaux];
    setEtape('lecture');
    try {
      const { pdfs, ignores } = await collecterPdfs(tous);
      setDepots(tous); setSources(pdfs); setIgnores(ignores); setResultats([]); setDecalage(0);
      setEtape(pdfs.length ? 'pret' : 'vide');
      if (!pdfs.length) showToast('Aucun PDF trouvé dans ce dépôt', 'error');
    } catch (e) {
      setEtape(sources.length ? 'pret' : 'vide');
      showToast(`Lecture impossible : ${e instanceof Error ? e.message : e}`, 'error');
    }
  }
  const depuisInput = (liste: FileList | null) =>
    ajouter(Array.from(liste || []).map(file => ({ chemin: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file })));

  function vider() {
    annule.current = true;
    setDepots([]); setSources([]); setIgnores([]); setResultats([]); setEnCours([]); setEtape('vide');
  }

  // ── Conversion (petit pool parallèle) ──
  async function convertir() {
    annule.current = false;
    setEtape('conversion'); setResultats([]);
    const file = [...sources];
    const sortie: ResultatPdf[] = [];
    const travailleur = async () => {
      for (let s = file.shift(); s && !annule.current; s = file.shift()) {
        const src = s;
        setEnCours(c => [...c, src.chemin]);
        const r = await convertirPdf(src);
        sortie.push(r);
        setEnCours(c => c.filter(x => x !== src.chemin));
        setResultats([...sortie]);
      }
    };
    await Promise.all(Array.from({ length: PARALLELE }, travailleur));
    if (annule.current) return;
    setEtape('termine');
  }

  // ── Livrables (recalculés si l'on change d'option après coup, sans reconvertir) ──
  const livrables = useMemo(() => {
    if (etape !== 'termine') return null;
    const parChemin = new Map(resultats.map(r => [r.chemin, r]));
    const noms = new Map<string, number>();
    const globaux = Array.from(groupes.entries()).map(([cle, liste]) => {
      let nom = nomGlobal(cle);
      const n = (noms.get(nom) || 0) + 1; noms.set(nom, n);
      if (n > 1) nom = nom.replace(/\.txt$/, ` (${n}).txt`);
      return { cle, nom, contenu: construireGlobal(cle, liste.map(c => parChemin.get(c)!).filter(Boolean)), nb: liste.length };
    });
    const fichiers = individuels
      ? resultats.filter(r => !r.erreur).map(r => ({ nom: r.chemin.replace(/\.pdf$/i, '.txt'), contenu: r.texte }))
      : [];
    return { globaux, fichiers, total: globaux.length + fichiers.length };
  }, [etape, resultats, groupes, individuels]);

  const alertes = resultats.filter(r => r.erreur || r.avertissement).sort((a, b) => Number(!!b.erreur) - Number(!!a.erreur));
  const reussis = resultats.filter(r => !r.erreur).length;

  function toutTelecharger() {
    if (!livrables) return;
    const seul = [...livrables.globaux.map(g => ({ nom: g.nom, contenu: g.contenu })), ...livrables.fichiers];
    if (seul.length === 1) { telecharger(blobTexte(seul[0].contenu), seul[0].nom.split('/').pop()!); return; }
    const zip = new PizZip();
    livrables.globaux.forEach(g => zip.file(g.nom, g.contenu));
    livrables.fichiers.forEach(f => zip.file(f.nom, f.contenu));
    const racines = Array.from(new Set(chemins.map(c => c.split('/')[0])));
    const nom = racines.length === 1 && chemins[0].includes('/')
      ? `${racines[0]} - texte.zip`
      : `Conversion texte ${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.zip`;
    telecharger(zip.generate({ type: 'blob', compression: 'DEFLATE' }) as Blob, nom);
  }

  const occupe = etape === 'lecture' || etape === 'conversion';
  const pct = sources.length ? Math.round((resultats.length / sources.length) * 100) : 0;

  // ── Rendu ──
  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Convertisseur PDF → texte</h1>
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: VERT }} />
            Traitement sur ce poste : aucun fichier n&apos;est envoyé au serveur.
          </p>
        </div>
        {etape !== 'vide' && !occupe && (
          <button onClick={vider} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
            <RotateCcw className="h-3.5 w-3.5" />Tout recommencer
          </button>
        )}
      </div>

      {/* Zone de dépôt */}
      {etape !== 'conversion' && etape !== 'termine' && (
        <div
          onDragOver={e => { e.preventDefault(); setSurvol(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSurvol(false); }}
          onDrop={async e => { e.preventDefault(); setSurvol(false); if (!occupe) ajouter(await lireDataTransfer(e.dataTransfer)); }}
          onClick={() => !occupe && inputFichiers.current?.click()}
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 text-center
            ${etape === 'pret' ? 'py-6' : 'py-16'}
            ${survol ? 'border-[#2B5746] bg-[#2B5746]/5 scale-[1.01]' : 'border-gray-300 bg-white hover:border-[#2B5746]/60 hover:bg-gray-50/60'}`}
        >
          {etape === 'lecture' ? (
            <div className="flex flex-col items-center gap-3 text-gray-600">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: VERT }} />
              <p className="text-sm">Ouverture des archives…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-4">
              <div className={`rounded-full p-3 transition-colors ${survol ? 'bg-[#2B5746] text-white' : 'bg-[#2B5746]/10'}`} style={survol ? {} : { color: VERT }}>
                <UploadCloud className={etape === 'pret' ? 'h-5 w-5' : 'h-8 w-8'} />
              </div>
              <div>
                <p className={`font-semibold text-gray-900 ${etape === 'pret' ? 'text-sm' : 'text-base'}`}>
                  {etape === 'pret' ? 'Ajouter d’autres fichiers' : 'Déposez ici vos PDF, dossiers ou ZIP'}
                </p>
                {etape !== 'pret' && (
                  <p className="text-xs text-gray-500 mt-1">ZIP de ZIP acceptés · l’arborescence des pochettes est conservée</p>
                )}
              </div>
              <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                <button onClick={() => inputFichiers.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50">
                  <Files className="h-3.5 w-3.5" />Fichiers ou ZIP
                </button>
                <button onClick={() => inputDossier.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50">
                  <FolderOpen className="h-3.5 w-3.5" />Un dossier
                </button>
              </div>
            </div>
          )}
          <input ref={inputFichiers} type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" className="hidden"
            onChange={e => { depuisInput(e.target.files); e.target.value = ''; }} />
          <input ref={inputDossier} type="file" className="hidden"
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={e => { depuisInput(e.target.files); e.target.value = ''; }} />
        </div>
      )}

      {/* Options + aperçu */}
      {(etape === 'pret' || etape === 'termine') && (
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50/60 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" style={{ color: VERT }} />
              <span className="font-semibold text-gray-900">{pluriel(sources.length, 'PDF')}</span>
              <span className="text-xs text-gray-500">
                dans {pluriel(new Set(chemins.map(c => c.split('/').slice(0, -1).join('/'))).size, 'dossier')}
                {ignores.length > 0 && <span title={ignores.slice(0, 30).join('\n')}> · {pluriel(ignores.length, 'autre fichier')} ignoré{ignores.length > 1 ? 's' : ''}</span>}
              </span>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={individuels} onChange={e => setIndividuels(e.target.checked)} className="accent-[#2B5746] h-3.5 w-3.5" />
              Un .txt par PDF
            </label>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Fichiers globaux</p>
              <div className="inline-flex rounded-lg border p-0.5 bg-gray-50">
                {([['aucun', 'Aucun'], ['unique', 'Un seul pour tout'], ['parDossier', 'Un par dossier']] as const).map(([m, lib]) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}>
                    {lib}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'parDossier' && max > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span>Niveau de regroupement</span>
                <div className="inline-flex items-center rounded-lg border">
                  <button disabled={niveau <= 0} onClick={() => setDecalage(niveau - 1 - auto)} className="p-1 disabled:opacity-30 hover:bg-gray-50 rounded-l-lg" title="Remonter d’un niveau"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="px-2 font-semibold tabular-nums">{niveau + 1}</span>
                  <button disabled={niveau >= max} onClick={() => setDecalage(niveau + 1 - auto)} className="p-1 disabled:opacity-30 hover:bg-gray-50 rounded-r-lg" title="Descendre d’un niveau"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
                {niveau !== auto && <button onClick={() => setDecalage(0)} className="underline text-gray-400 hover:text-gray-700">auto</button>}
              </div>
            )}

            {mode !== 'aucun' && (
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from(groupes.entries()).map(([cle, liste]) => {
                  const g = livrables?.globaux.find(x => x.cle === cle);
                  return (
                    <div key={cle} className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 hover:border-[#2B5746]/40 transition-colors">
                      <div className="rounded-lg p-2 bg-[#2B5746]/10 shrink-0" style={{ color: VERT }}><Layers className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate" title={cle}>{cle.split('/').pop()}</p>
                        <p className="text-[11px] text-gray-500 truncate" title={liste.join('\n')}>{pluriel(liste.length, 'PDF')}{cle.includes('/') ? ` · ${cle.split('/').slice(0, -1).join(' › ')}` : ''}</p>
                      </div>
                      {g && (
                        <div className="flex gap-1 shrink-0">
                          <button title="Copier le texte" onClick={async () => { await copyPlainToClipboard(g.contenu); showToast('Texte copié', 'success'); }} className="p-1.5 rounded-md text-gray-400 hover:text-gray-900 hover:bg-gray-100"><Copy className="h-3.5 w-3.5" /></button>
                          <button title={`Télécharger ${g.nom}`} onClick={() => telecharger(blobTexte(g.contenu), g.nom)} className="p-1.5 rounded-md text-gray-400 hover:text-gray-900 hover:bg-gray-100"><Download className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {etape === 'pret' && (
            <div className="px-5 py-4 border-t">
              <button onClick={convertir} disabled={mode === 'aucun' && !individuels}
                className="w-full rounded-xl py-3 text-white font-semibold shadow-sm hover:shadow-md active:scale-[0.99] transition-all disabled:opacity-40"
                style={{ background: VERT }}>
                Convertir {pluriel(sources.length, 'PDF')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Progression */}
      {etape === 'conversion' && (
        <div className="rounded-2xl border bg-white shadow-sm px-6 py-8 space-y-4">
          <div className="flex items-baseline justify-between">
            <p className="font-semibold text-gray-900">Conversion en cours…</p>
            <p className="text-sm tabular-nums text-gray-500">{resultats.length} / {sources.length}</p>
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: VERT }} />
          </div>
          <div className="space-y-1 min-h-[3.5rem]">
            {enCours.map(c => (
              <p key={c} className="text-xs text-gray-500 truncate flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin shrink-0" />{c}</p>
            ))}
          </div>
          <button onClick={() => { annule.current = true; setEnCours([]); setEtape('pret'); setResultats([]); }}
            className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><X className="h-3.5 w-3.5" />Annuler</button>
        </div>
      )}

      {/* Résultat */}
      {etape === 'termine' && livrables && (
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-6 flex flex-wrap items-center gap-4">
            {reussis === resultats.length
              ? <div className="rounded-full p-2.5 bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-6 w-6" /></div>
              : <div className="rounded-full p-2.5 bg-amber-50 text-amber-600"><AlertTriangle className="h-6 w-6" /></div>}
            <div className="flex-1 min-w-[12rem]">
              <p className="font-semibold text-gray-900">{pluriel(reussis, 'PDF converti')}{reussis < resultats.length && <span className="text-red-600 font-normal"> · {resultats.length - reussis} en échec</span>}</p>
              <p className="text-xs text-gray-500">
                {[livrables.globaux.length ? pluriel(livrables.globaux.length, 'fichier global') : '', livrables.fichiers.length ? pluriel(livrables.fichiers.length, 'fichier .txt') : '']
                  .filter(Boolean).join(' + ')}
                {' · '}{taille(livrables.globaux.reduce((n, g) => n + g.contenu.length, 0) + livrables.fichiers.reduce((n, f) => n + f.contenu.length, 0))}
              </p>
            </div>
            <button onClick={toutTelecharger} disabled={!livrables.total}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white font-semibold shadow-sm hover:shadow-md active:scale-[0.99] transition-all disabled:opacity-40"
              style={{ background: VERT }}>
              <Download className="h-4 w-4" />
              {livrables.total === 1 ? 'Télécharger le .txt' : 'Télécharger le ZIP'}
            </button>
          </div>

          {alertes.length > 0 && (
            <div className="border-t px-6 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />À vérifier ({alertes.length})
              </p>
              <ul className="space-y-1 max-h-56 overflow-auto">
                {alertes.map(r => (
                  <li key={r.chemin} className="text-xs flex gap-2">
                    <span className={`shrink-0 font-medium ${r.erreur ? 'text-red-600' : 'text-amber-600'}`}>{r.erreur ? 'Échec' : /scann/i.test(r.avertissement || '') ? 'Scan' : 'Partiel'}</span>
                    <span className="text-gray-800 truncate" title={r.chemin}>{r.chemin}</span>
                    <span className="text-gray-400 truncate">{r.erreur || r.avertissement}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-400 mt-2">Les PDF scannés (images) n’ont pas de couche texte : ils sont signalés dans les fichiers, page par page.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
