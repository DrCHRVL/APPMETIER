'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Upload, Trash2, FlaskConical, Loader2, Check, AlertCircle } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  loadTramesForme, saveTramesForme,
} from '@/lib/web/tramesFormeStore';
import { trameHasTokens, type TrameForme, type TrameFormeType } from '@/lib/web/trameFill';

const TYPE_LABELS: Record<TrameFormeType, string> = {
  courrier: 'Courrier',
  requete: 'Requête',
  'soit-transmis': 'Soit-transmis',
  defaut: 'Par défaut (tous les autres)',
};
const TYPE_ORDER: TrameFormeType[] = ['courrier', 'requete', 'soit-transmis', 'defaut'];

const TOKEN_HELP: { token: string; desc: string }[] = [
  { token: '{{CORPS}}', desc: 'Paragraphe seul — le texte de l\'acte se déverse ici (visas en italique, puces, gras conservés), en héritant de la police de cette ligne.' },
  { token: '{{TITRE}}', desc: 'Paragraphe seul — le titre de l\'acte (requêtes / soit-transmis).' },
  { token: '{{SIGNATURE}}', desc: 'Paragraphe seul — le bloc signature (une ligne par ligne du texte).' },
  { token: '{{DESTINATAIRE}}', desc: 'En ligne — le destinataire (courriers).' },
  { token: '{{OBJET}}', desc: 'En ligne — l\'objet (courriers).' },
  { token: '{{DATE}}', desc: 'En ligne — la date de l\'acte.' },
];

function abToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const TramesFormePanel = () => {
  const { showToast } = useToast();
  const [list, setList] = useState<TrameForme[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Import en attente de nommage / typage
  const [pending, setPending] = useState<{ docxBase64: string; nom: string; type: TrameFormeType } | null>(null);

  useEffect(() => {
    loadTramesForme().then((l) => { setList(l); setLoaded(true); });
  }, []);

  const persist = useCallback(async (next: TrameForme[]) => {
    setList(next);
    await saveTramesForme(next);
  }, []);

  const onFile = useCallback(async (file: File) => {
    if (!/\.docx$/i.test(file.name)) {
      showToast('Format attendu : un fichier Word .docx.', 'error');
      return;
    }
    try {
      const b64 = abToBase64(await file.arrayBuffer());
      if (!trameHasTokens(b64)) {
        showToast('Aucune balise trouvée dans ce .docx. Ajoutez au moins {{CORPS}} là où le texte doit apparaître.', 'error');
        return;
      }
      const nom = file.name.replace(/\.docx$/i, '');
      setPending({ docxBase64: b64, nom, type: 'courrier' });
    } catch {
      showToast('Lecture du fichier impossible.', 'error');
    }
  }, [showToast]);

  const confirmImport = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const trame: TrameForme = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `tf_${Date.now()}`,
        nom: pending.nom.trim() || 'Trame',
        type: pending.type,
        docxBase64: pending.docxBase64,
        updatedAt: new Date().toISOString(),
      };
      // Une seule trame par type : remplace l'existante du même type.
      const next = [...list.filter((t) => t.type !== trame.type), trame];
      await persist(next);
      setPending(null);
      showToast('Trame de forme enregistrée.', 'success');
    } finally {
      setBusy(false);
    }
  }, [pending, list, persist, showToast]);

  const remove = useCallback(async (id: string) => {
    await persist(list.filter((t) => t.id !== id));
    showToast('Trame supprimée.', 'success');
  }, [list, persist, showToast]);

  const test = useCallback(async (trame: TrameForme) => {
    setBusy(true);
    try {
      const { fillTrameDocx } = await import('@/lib/web/trameFill');
      const blob = await fillTrameDocx(trame.docxBase64, {
        destinataire: 'Madame la Présidente',
        objet: 'Essai de trame de forme',
        date: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
        titre: 'ACTE — ESSAI DE TRAME',
        corps: [
          'Vu les articles visés en objet et la procédure ;',
          '',
          'Ce paragraphe illustre le rendu du corps injecté dans **votre** trame, avec la police que vous avez choisie sur la ligne {{CORPS}}.',
          '',
          'Les points suivants sont testés :',
          '- une puce ;',
          '- une seconde puce avec un terme __souligné__.',
        ].join('\n'),
        signature: 'P/ Le Procureur de la République\nAudran CHEVALIER\nSubstitut',
      });
      downloadBlob(blob, `essai_${trame.type}.docx`);
    } catch {
      showToast('Test impossible (trame invalide ?).', 'error');
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  return (
    <div className="space-y-6 text-sm text-gray-800">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" /> Trames de forme (papeteries Word)
        </h3>
        <p className="mt-1 text-gray-600">
          Déposez vos propres modèles Word (.docx) : votre papeterie exacte — logo, en-tête, police,
          pied de page. Placez-y les balises ci-dessous là où le contenu de l'acte doit apparaître.
          À l'export « Word » d'un acte, l'application part de VOTRE trame et n'y injecte que le texte.
        </p>
      </div>

      {/* Aide balises */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="font-medium mb-2">Balises à insérer dans votre .docx</div>
        <ul className="space-y-1">
          {TOKEN_HELP.map((h) => (
            <li key={h.token} className="flex gap-2">
              <code className="shrink-0 rounded bg-white border border-gray-300 px-1.5 py-0.5 text-blue-700">{h.token}</code>
              <span className="text-gray-600">{h.desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          Seule {`{{CORPS}}`} est requise. Les balises absentes sont simplement ignorées.
        </p>
      </div>

      {/* Import */}
      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" /> Importer une trame (.docx)
        </button>
      </div>

      {/* Formulaire de nommage/typage de l'import en attente */}
      {pending && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div className="font-medium">Nouvelle trame</div>
          <label className="block">
            <span className="text-gray-600">Nom</span>
            <input
              value={pending.nom}
              onChange={(e) => setPending({ ...pending, nom: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-gray-600">S'applique au type d'acte</span>
            <select
              value={pending.type}
              onChange={(e) => setPending({ ...pending, type: e.target.value as TrameFormeType })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 bg-white"
            >
              {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={confirmImport} disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
            </button>
            <button type="button" onClick={() => setPending(null)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-100">Annuler</button>
          </div>
        </div>
      )}

      {/* Liste des trames */}
      <div className="space-y-2">
        <div className="font-medium">Trames enregistrées</div>
        {!loaded && <div className="text-gray-500">Chargement…</div>}
        {loaded && list.length === 0 && (
          <div className="flex items-center gap-2 text-gray-500">
            <AlertCircle className="w-4 h-4" /> Aucune trame. Sans trame pour un type, l'export utilise la mise en forme intégrée.
          </div>
        )}
        {list.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
            <div className="min-w-0">
              <div className="font-medium truncate">{t.nom}</div>
              <div className="text-xs text-gray-500">
                <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 mr-2">{TYPE_LABELS[t.type]}</span>
                {new Date(t.updatedAt).toLocaleDateString('fr-FR')}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => test(t)} disabled={busy} title="Tester (télécharger un exemple rempli)"
                className="p-2 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-50">
                <FlaskConical className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => remove(t.id)} title="Supprimer"
                className="p-2 rounded hover:bg-red-50 text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TramesFormePanel;
