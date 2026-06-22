'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileCheck2, Loader2, Share2, Download, AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { useUser } from '@/contexts/UserContext';
import { useToast } from '@/contexts/ToastContext';
import { mergeReferential, decodeCsvBuffer, type MergeResult, type MementoRawEntry } from '@/lib/natinf/mergeReferential';
import {
  publishSharedReferential,
  pullSharedMeta,
  canPublishShared,
  type NatinfSharedPayload,
} from '@/lib/natinf/sharedReferential';
import { resetNatinfCache } from '@/lib/natinf/natinfData';
import type { NatinfEntry } from '@/types/natinf';

export const AdminNatinfPanel = () => {
  const { isAdmin: checkIsAdmin, user } = useUser();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [source, setSource] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [currentMeta, setCurrentMeta] = useState<NatinfSharedPayload | null>(null);

  const refreshMeta = useCallback(async () => {
    setCurrentMeta(await pullSharedMeta());
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
      if (!source) {
        const m = file.name.match(/(\d{4})|janv|f[eé]vr|mars|avril|mai|juin|juil|ao[uû]t|sept|oct|nov|d[eé]c/i);
        setSource(`Export DACG data.gouv${m ? ' — ' + file.name.replace(/\.csv$/i, '') : ''}`);
      }
    } catch (e: any) {
      showToast(`Échec de lecture du CSV : ${e?.message || e}`, 'error');
    } finally {
      setParsing(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
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
      const ok = await publishSharedReferential(result.entries, {
        updatedBy: user?.displayName || user?.windowsUsername || 'admin',
        source: source || undefined,
      });
      if (ok) {
        resetNatinfCache();
        showToast(`Référentiel NATINF publié pour le cabinet (${result.entries.length} codes).`, 'success');
        await refreshMeta();
      } else {
        showToast("Publication impossible (partage réseau injoignable ?). Utilisez le téléchargement.", 'error');
      }
    } catch (e: any) {
      showToast(`Échec de publication : ${e?.message || e}`, 'error');
    } finally {
      setPublishing(false);
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
        </p>
      </div>

      {/* Version actuellement publiée */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm flex items-start gap-3">
        <FileCheck2 className="h-4 w-4 text-gray-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-700">Version publiée au cabinet</div>
          {currentMeta ? (
            <div className="text-gray-600">
              {currentMeta.codeCount.toLocaleString('fr')} codes ·{' '}
              {currentMeta.source || 'source non précisée'} · publié le{' '}
              {new Date(currentMeta.updatedAt).toLocaleDateString('fr')} par {currentMeta.updatedBy}
            </div>
          ) : (
            <div className="text-gray-500 italic">
              Aucune version partagée — les postes utilisent le référentiel embarqué avec l'application.
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
          Le fichier reste local : la fusion (libellés/nature/articles officiels + quantum « parquet »,
          thème et indicateur « fréquent » du mémento) est faite ici même, dans l'application.
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
            {canPublishShared() ? (
              <Button onClick={publish} disabled={publishing} className="flex items-center gap-2">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Publier pour le cabinet
              </Button>
            ) : (
              <span className="text-[12px] text-gray-500">
                Publication réseau indisponible dans ce contexte — utilisez le téléchargement.
              </span>
            )}
            <Button variant="outline" onClick={() => download(result!.entries)} className="flex items-center gap-2">
              <Download className="h-4 w-4" /> Télécharger natinf.json
            </Button>
          </div>
          <p className="text-[11px] text-gray-500">
            « Publier » diffuse le référentiel à tous les postes via le partage réseau (chargé au
            démarrage, repli sur l'embarqué si injoignable). « Télécharger » produit le fichier à
            committer dans l'application ou à déposer manuellement.
          </p>
        </div>
      )}
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
