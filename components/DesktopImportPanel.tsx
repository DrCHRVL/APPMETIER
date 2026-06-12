// components/DesktopImportPanel.tsx
/**
 * SIRAL — import des données de l'app bureau, depuis Paramètres → Sauvegardes
 * (édition web uniquement).
 *
 * Remplace le passage par SSH + script pour la migration : l'utilisateur
 * sélectionne le dossier du partage (« 10_App METIER ») et, s'il le souhaite,
 * le dossier des pièces (« documentenquete ») ; tout est analysé puis chiffré
 * dans CE navigateur avec son trousseau, et poussé vers les coffres du
 * serveur. Aucune phrase de transit, aucune copie en clair sur le serveur.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Progress } from './ui/progress';
import { ConfirmationDialog } from './ui/confirmation-dialog';
import { useToast } from '@/contexts/ToastContext';
import {
  analyzeDesktopFiles, executeImportPlan, ImportPlan, ImportReport, PlanCategory, PlanItem,
} from '@/utils/migration/desktopServerImport';
import {
  MonitorUp, FolderOpen, FileJson, Paperclip, CheckCircle, AlertTriangle, RotateCcw, Lock,
} from 'lucide-react';

const CATEGORY_LABELS: Record<PlanCategory, string> = {
  partage: 'Fichiers partagés du service',
  contentieux: 'Contentieux',
  instructions: 'Dossiers d’instruction',
  preferences: 'Préférences & règles d’alertes',
  documents: 'Documents d’enquête',
  local: 'Copie de travail locale (data.json)',
  ignore: 'Ignorés',
  bloque: 'Bloqués',
};

const CATEGORY_ORDER: PlanCategory[] = ['contentieux', 'partage', 'instructions', 'preferences', 'documents', 'local', 'bloque', 'ignore'];

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

export const DesktopImportPanel = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importLocalData, setImportLocalData] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const grouped = useMemo(() => {
    if (!plan) return [];
    return CATEGORY_ORDER
      .map((cat) => ({ cat, items: plan.items.filter((i) => i.category === cat) }))
      .filter((g) => g.items.length > 0);
  }, [plan]);

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const merged = [...files, ...Array.from(list)];
    setFiles(merged);
    setReport(null);
    setAnalyzing(true);
    try {
      const api = window.electronAPI as unknown as { e2ee_myScopes: () => Promise<string[]> };
      const scopes = await api.e2ee_myScopes();
      setPlan(await analyzeDesktopFiles(merged, scopes));
    } catch (e) {
      showToast(`Analyse impossible : ${e instanceof Error ? e.message : 'erreur'}`, 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setFiles([]); setPlan(null); setReport(null); setProgress(null); setImportLocalData(false);
  };

  const runImport = async () => {
    setShowConfirm(false);
    if (!plan) return;
    setRunning(true);
    setReport(null);
    try {
      const result = await executeImportPlan(plan, {
        importLocalData,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      setReport(result);
      if (result.complete) {
        showToast('✅ Import terminé — rechargez l’application pour voir les données', 'success');
      } else {
        showToast('❌ Import incomplet — consultez le détail des erreurs', 'error');
      }
    } catch (e) {
      showToast(`Erreur pendant l'import : ${e instanceof Error ? e.message : 'erreur'}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  const sendCount = (plan?.actionable || 0) + (plan?.documents || 0) + (importLocalData && plan?.hasLocalData ? 1 : 0);

  const itemRow = (item: PlanItem) => (
    <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-1.5 text-xs">
      <div className="min-w-0">
        <span className="font-medium text-gray-800">{item.label}</span>
        {item.detail && <span className="text-gray-500 ml-2">{item.detail}</span>}
        <div className="text-gray-400 font-mono truncate">{item.path}</div>
      </div>
      <span className="text-gray-400 flex-shrink-0">{formatSize(item.size)}</span>
    </div>
  );

  return (
    <Card className="border-emerald-300">
      <CardHeader>
        <CardTitle className="flex items-center text-emerald-800">
          <MonitorUp className="h-5 w-5 mr-2" />
          Import depuis l&apos;app bureau (migration)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 bg-emerald-50 rounded text-sm text-emerald-900 space-y-1">
          <p className="font-semibold">Transférer les données de l&apos;ancienne app vers ce serveur, sans ligne de commande.</p>
          <p>
            1. Sélectionnez le dossier de données du service (ex&nbsp;: <code className="bg-emerald-100 px-1 rounded">P:\…\10_App METIER</code>).{' '}
            2. Ajoutez si besoin le dossier des pièces (<code className="bg-emerald-100 px-1 rounded">documentenquete</code>).{' '}
            3. Vérifiez le récapitulatif, puis lancez l&apos;import.
          </p>
          <p className="flex items-center gap-1.5 text-emerald-700">
            <Lock className="h-3.5 w-3.5 flex-shrink-0" />
            Tout est chiffré dans ce navigateur avec votre trousseau avant l&apos;envoi — le serveur ne voit jamais vos données en clair.
            Les coffres déjà présents sont archivés en version précédente (rien n&apos;est perdu).
          </p>
        </div>

        {/* Sélecteurs (entrées masquées : dossier complet, pièces, fichiers isolés) */}
        <input ref={folderInputRef} type="file" className="hidden" multiple
          {...({ webkitdirectory: '', directory: '' } as object)}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={docsInputRef} type="file" className="hidden" multiple
          {...({ webkitdirectory: '', directory: '' } as object)}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={filesInputRef} type="file" className="hidden" multiple accept=".json"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Button variant="outline" disabled={running || analyzing} onClick={() => folderInputRef.current?.click()} className="h-16 flex flex-col">
            <FolderOpen className="h-5 w-5 mb-1" />
            Dossier du service
            <span className="text-xs opacity-70">10_App METIER</span>
          </Button>
          <Button variant="outline" disabled={running || analyzing} onClick={() => docsInputRef.current?.click()} className="h-16 flex flex-col">
            <Paperclip className="h-5 w-5 mb-1" />
            Dossier des pièces
            <span className="text-xs opacity-70">documentenquete (facultatif)</span>
          </Button>
          <Button variant="outline" disabled={running || analyzing} onClick={() => filesInputRef.current?.click()} className="h-16 flex flex-col">
            <FileJson className="h-5 w-5 mb-1" />
            Fichiers isolés
            <span className="text-xs opacity-70">data.json, users.json…</span>
          </Button>
        </div>

        {analyzing && <p className="text-sm text-gray-500">Analyse des fichiers…</p>}

        {/* Récapitulatif du plan */}
        {plan && !analyzing && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700">
                {plan.actionable + plan.documents > 0
                  ? <>{plan.actionable} élément(s) de données{plan.documents > 0 && <> et {plan.documents} document(s)</>} prêts à être importés</>
                  : 'Aucun fichier reconnu — vérifiez le dossier sélectionné'}
                {plan.blocked > 0 && <span className="text-red-600"> · {plan.blocked} bloqué(s)</span>}
              </p>
              <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Recommencer
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto border rounded divide-y">
              {grouped.map(({ cat, items }) => (
                cat === 'ignore' ? (
                  <details key={cat}>
                    <summary className="bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-500 cursor-pointer">
                      {CATEGORY_LABELS[cat]} ({items.length}) — sauvegardes et fichiers techniques, non importés
                    </summary>
                    {items.map(itemRow)}
                  </details>
                ) : (
                  <div key={cat}>
                    <div className={`px-3 py-1.5 text-xs font-semibold sticky top-0 ${cat === 'bloque' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                      {CATEGORY_LABELS[cat]} ({items.length})
                    </div>
                    {items.map(itemRow)}
                  </div>
                )
              ))}
            </div>

            {plan.hasLocalData && (
              <label className="flex items-start gap-2 text-sm text-gray-700 p-3 bg-amber-50 border border-amber-200 rounded">
                <input type="checkbox" className="mt-0.5" checked={importLocalData}
                  onChange={(e) => setImportLocalData(e.target.checked)} disabled={running} />
                <span>
                  <b>Restaurer aussi data.json comme copie de travail de ce navigateur.</b>{' '}
                  Utile si votre data.json local est plus à jour que les fichiers du partage.
                  Un instantané de sécurité des données actuelles est créé avant. La synchronisation
                  fusionnera ensuite cette copie avec le serveur.
                </span>
              </label>
            )}

            <Button
              onClick={() => setShowConfirm(true)}
              disabled={running || sendCount === 0}
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white"
            >
              <MonitorUp className="h-4 w-4 mr-2" />
              {running ? 'Import en cours…' : `Chiffrer et importer ${sendCount} élément(s) vers le serveur`}
            </Button>
          </div>
        )}

        {/* Progression */}
        {running && progress && (
          <div className="space-y-1">
            <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
            <p className="text-xs text-gray-500">{progress.done}/{progress.total} — {progress.label}</p>
          </div>
        )}

        {/* Rapport de complétude */}
        {report && (
          <div className={`p-3 rounded text-sm ${report.complete ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            <p className="font-semibold flex items-center gap-2">
              {report.complete ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {report.complete ? 'Import complet' : 'Import incomplet — ne pas mettre en service'}
            </p>
            <p className="mt-1">
              Coffres écrits : {report.written}/{report.total - report.docsTotal} · Documents déposés : {report.docsWritten}/{report.docsTotal}
              {report.localRestored && ' · copie de travail locale restaurée'}
            </p>
            {report.errors.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs list-disc list-inside">
                {report.errors.map((e, i) => <li key={i}><b>{e.label}</b> : {e.message}</li>)}
              </ul>
            )}
            {!report.complete && (
              <p className="mt-2 text-xs">
                Corrigez puis relancez l&apos;import avec les mêmes dossiers : l&apos;opération est rejouable sans risque
                (chaque coffre est simplement réécrit, l&apos;historique des versions est conservé).
              </p>
            )}
            {report.complete && (
              <Button size="sm" className="mt-2 bg-green-700 hover:bg-green-800 text-white" onClick={() => window.location.reload()}>
                Recharger l&apos;application
              </Button>
            )}
          </div>
        )}

        <ConfirmationDialog
          isOpen={showConfirm}
          onClose={() => setShowConfirm(false)}
          onConfirm={runImport}
          title="Importer vers le serveur"
          message={`${sendCount} élément(s) vont être chiffrés dans ce navigateur puis envoyés au serveur.\n\nLes coffres déjà présents sur le serveur seront remplacés par ces données — leur version précédente reste archivée et restaurable.\n\nConseil : faites cet import depuis le poste où les données sont les plus à jour.`}
          confirmLabel="Lancer l'import"
          cancelLabel="Annuler"
        />
      </CardContent>
    </Card>
  );
};
