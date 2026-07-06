'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileCheck2, Loader2, Share2, Download, AlertTriangle, Database, RefreshCw, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { mergeReferential, decodeCsvBuffer, type MergeResult, type MementoRawEntry } from '@/lib/natinf/mergeReferential';
import { publishReferential, addNatinfEntry, fetchMeta, type NatinfMeta } from '@/lib/natinf/natinfApi';
import { resetNatinfCache } from '@/lib/natinf/natinfData';
import { useNatinf } from '@/hooks/useNatinf';
import type { NatinfEntry } from '@/types/natinf';

export const AdminNatinfPanel = () => {
  const { isAdmin: checkIsAdmin } = useUser();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [currentMeta, setCurrentMeta] = useState<NatinfMeta | null>(null);

  // Saisie manuelle d'une infraction (admin uniquement, sans demande à valider).
  const { getByCode } = useNatinf();
  const [addCode, setAddCode] = useState('');
  const [addLibelle, setAddLibelle] = useState('');
  const [addDef, setAddDef] = useState('');
  const [addRep, setAddRep] = useState('');
  const [adding, setAdding] = useState(false);

  const refreshMeta = useCallback(async () => {
    try {
      setCurrentMeta(await fetchMeta());
    } catch {
      setCurrentMeta(null);
    }
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  if (!checkIsAdmin()) {
    return <div className="text-gray-500">Accès réservé à l'administrateur.</div>;
  }

  const handleFile = async (file: File) => {
    setParsing(true);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const csvText = decodeCsvBuffer(buf);
      const mod = await import('@/data/natinf/natinf-memento.json');
      const memento = ((mod as any).default ?? mod) as MementoRawEntry[];
      const merged = mergeReferential(csvText, memento);
      setResult(merged);
      setFileName(file.name);
      if (!source) setSource(`Export DACG data.gouv — ${file.name.replace(/\.csv$/i, '')}`);
    } catch (e: any) {
      showToast(`Échec de lecture du CSV : ${e?.message || e}`, 'error');
    } finally {
      setParsing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Réinitialiser la valeur pour que resélectionner le même fichier redéclenche
    // l'événement `change` (sinon rien ne se passe et l'UI semble cassée).
    e.target.value = '';
    if (f) handleFile(f);
  };

  const download = (entries: NatinfEntry[]) => {
    const body = '[\n' + entries.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n';
    const blob = new Blob([body], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'natinf.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const publish = async () => {
    if (!result) return;
    setPublishing(true);
    try {
      const res = await publishReferential(result.entries, source || undefined);
      resetNatinfCache();
      showToast(`Référentiel NATINF publié pour tout le cabinet (${res.count.toLocaleString('fr')} codes).`, 'success');
      await refreshMeta();
    } catch (e: any) {
      showToast(`Échec de publication : ${e?.message || e}`, 'error');
    } finally {
      setPublishing(false);
    }
  };

  const codeTrimmed = addCode.trim();
  const codeFormatInvalid = codeTrimmed !== '' && !/^\d{1,7}$/.test(codeTrimmed);
  const codeAlreadyUsed = codeTrimmed !== '' && !codeFormatInvalid && !!getByCode(codeTrimmed);
  const canAdd =
    codeTrimmed !== '' && addLibelle.trim() !== '' && !codeFormatInvalid && !codeAlreadyUsed && !adding;

  const handleAddEntry = async () => {
    if (!canAdd) return;
    setAdding(true);
    try {
      const res = await addNatinfEntry({
        code: codeTrimmed,
        libelle: addLibelle.trim(),
        articlesDefinition: addDef.trim() || undefined,
        articlesRepression: addRep.trim() || undefined,
      });
      resetNatinfCache();
      showToast(
        `Infraction NATINF ${codeTrimmed} ajoutée au référentiel (${res.count.toLocaleString('fr')} codes).`,
        'success',
      );
      setAddCode('');
      setAddLibelle('');
      setAddDef('');
      setAddRep('');
      await refreshMeta();
    } catch (e: any) {
      showToast(`Échec de l'ajout : ${e?.message || e}`, 'error');
    } finally {
      setAdding(false);
    }
  };

  const report = result?.report;
  const mismatch = report?.natureMismatch || [];

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Database className="h-5 w-5 text-emerald-600" /> Référentiel NATINF
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Mettez à jour la base des codes d'infraction pour tout le cabinet à partir de
          l'export officiel <strong>« Liste des infractions en vigueur »</strong> (Ministère
          de la Justice / DACG), téléchargeable sur{' '}
          <span className="font-mono text-[12px]">data.gouv.fr</span> (mis à jour chaque trimestre).
          La base est stockée sur le serveur ; chaque navigateur l'interroge à l'ouverture.
        </p>
      </div>

      {/* Version actuellement publiée */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm flex items-start gap-3">
        <FileCheck2 className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-700">Version servie actuellement</div>
          {currentMeta?.published ? (
            <div className="text-gray-600">
              {currentMeta.count.toLocaleString('fr')} codes ·{' '}
              {currentMeta.source || 'source non précisée'} · publié le{' '}
              {currentMeta.updatedAt ? new Date(currentMeta.updatedAt).toLocaleDateString('fr') : '—'} par{' '}
              {currentMeta.updatedBy}
            </div>
          ) : (
            <div className="text-gray-500 italic">
              Aucune version publiée — le serveur sert le référentiel embarqué avec l'application
              {currentMeta ? ` (${currentMeta.count.toLocaleString('fr')} codes)` : ''}.
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={refreshMeta} className="h-7 px-2 text-gray-500" title="Rafraîchir">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Sélection du CSV */}
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-4">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFileChange} className="hidden" />
        <div className="flex items-center gap-3">
          <Button onClick={() => fileRef.current?.click()} disabled={parsing} className="flex items-center gap-2">
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Choisir le CSV officiel…
          </Button>
          <span className="text-sm text-gray-500 truncate min-w-0">{fileName || 'Aucun fichier sélectionné'}</span>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          La fusion (libellés / nature / articles officiels + quantum « parquet », thème et
          indicateur « fréquent » du mémento) est faite ici, puis publiée sur le serveur.
        </p>
      </div>

      {/* Rapport de fusion */}
      {report && (
        <div className="rounded-lg border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <Stat label="Total" value={report.total} />
            <Stat label="Fréquents" value={report.frequent} />
            <Stat label="Enrichis" value={report.enriched} />
            <Stat label="Ajoutés" value={report.added} />
          </div>

          {mismatch.length > 0 && (
            <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>{mismatch.length}</strong> écart(s) de nature entre le mémento et l'export officiel
                (l'officiel fait foi) :{' '}
                {mismatch.slice(0, 6).map((m) => `${m.code} (${m.memento}→${m.officiel})`).join(', ')}
                {mismatch.length > 6 && ` … +${mismatch.length - 6}`}
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase">Source (traçabilité)</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Ex. Export DACG data.gouv — avril 2026"
              className="w-full mt-1 h-8 px-2 text-sm border border-gray-300 rounded"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={publish} disabled={publishing} className="flex items-center gap-2">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              Publier sur le serveur
            </Button>
            <Button variant="outline" onClick={() => download(result!.entries)} className="flex items-center gap-2">
              <Download className="h-4 w-4" /> Télécharger natinf.json
            </Button>
          </div>
          <p className="text-[11px] text-gray-500">
            « Publier » remplace la base servie à tous les utilisateurs (prise en compte à leur
            prochaine ouverture). « Télécharger » produit le fichier, par exemple pour le committer
            comme nouveau référentiel embarqué.
          </p>
        </div>
      )}

      {/* Ajout manuel d'une infraction (admin) — pas de demande à valider */}
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4 text-emerald-600" /> Ajouter une infraction manuellement
          </h4>
          <p className="text-[12px] text-gray-500 mt-1">
            Pour compléter ponctuellement le référentiel sans réimporter tout le CSV. Action
            réservée à l'administrateur — il n'y a pas de demande à valider. Le numéro NATINF
            doit être unique.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="text-[11px] font-medium text-gray-500 uppercase">Numéro NATINF</label>
            <input
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder="Ex. 180"
              inputMode="numeric"
              className={`w-full mt-1 h-8 px-2 text-sm border rounded ${
                codeFormatInvalid || codeAlreadyUsed ? 'border-red-400' : 'border-gray-300'
              }`}
            />
            {codeFormatInvalid && (
              <p className="text-[11px] text-red-600 mt-1">Chiffres uniquement.</p>
            )}
            {codeAlreadyUsed && (
              <p className="text-[11px] text-red-600 mt-1">
                Ce numéro est déjà utilisé{getByCode(codeTrimmed)?.libelle ? ` : ${getByCode(codeTrimmed)!.libelle}` : ''}.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-medium text-gray-500 uppercase">Nom de l'infraction</label>
            <input
              value={addLibelle}
              onChange={(e) => setAddLibelle(e.target.value)}
              placeholder="Ex. USAGE ILLICITE DE STUPEFIANTS"
              className="w-full mt-1 h-8 px-2 text-sm border border-gray-300 rounded"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase">Textes définissant</label>
            <textarea
              value={addDef}
              onChange={(e) => setAddDef(e.target.value)}
              placeholder="Ex. ART.L.3421-1 AL.1 C.SANTE.PUB."
              rows={2}
              className="w-full mt-1 px-2 py-1 text-sm border border-gray-300 rounded resize-y"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-gray-500 uppercase">Textes réprimant</label>
            <textarea
              value={addRep}
              onChange={(e) => setAddRep(e.target.value)}
              placeholder="Ex. ART.L.3421-1 AL.1, ART.L.3425-1 C.SANTE.PUB."
              rows={2}
              className="w-full mt-1 px-2 py-1 text-sm border border-gray-300 rounded resize-y"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleAddEntry} disabled={!canAdd} className="flex items-center gap-2">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Ajouter au référentiel
          </Button>
          <span className="text-[11px] text-gray-500">
            L'infraction est ajoutée immédiatement pour tout le cabinet.
          </span>
        </div>
      </div>
    </div>
  );
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 py-2">
      <div className="text-xl font-bold text-gray-800">{value.toLocaleString('fr')}</div>
      <div className="text-[11px] text-gray-500 uppercase">{label}</div>
    </div>
  );
}
