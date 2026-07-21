'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Upload, Trash2, FlaskConical, Loader2, Check, AlertCircle, Sparkles, Send, PenLine } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  loadTramesForme, saveTramesForme,
} from '@/lib/web/tramesFormeStore';
import { trameHasTokens, listTrameTokens, type TrameForme, type TrameFormeType } from '@/lib/web/trameFill';
import { interpretTrameCommand } from '@/lib/web/trameChat';
import { applyTrameOps, getTrameParagraphs, setTrameParagraphs } from '@/lib/web/trameOps';

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
  // Assistant : trame dont le chat est ouvert + saisie + journaux par trame
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<Record<string, { role: 'user' | 'bot'; text: string }[]>>({});
  // Édition manuelle du texte : trame ouverte + lignes en cours d'édition
  const [editOpen, setEditOpen] = useState<string | null>(null);
  const [editLines, setEditLines] = useState<string[]>([]);

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

  const openEdit = useCallback((trame: TrameForme) => {
    setEditLines(getTrameParagraphs(trame.docxBase64));
    setEditOpen(trame.id);
    setChatOpen(null);
  }, []);

  const saveEdit = useCallback(async (trame: TrameForme) => {
    setBusy(true);
    try {
      const docxBase64 = setTrameParagraphs(trame.docxBase64, editLines);
      const updated: TrameForme = { ...trame, docxBase64, updatedAt: new Date().toISOString() };
      await persist(list.map((t) => (t.id === trame.id ? updated : t)));
      setEditOpen(null);
      showToast('Trame mise à jour.', 'success');
    } catch {
      showToast('Enregistrement impossible.', 'error');
    } finally {
      setBusy(false);
    }
  }, [editLines, list, persist, showToast]);

  const appendLog = useCallback((id: string, entry: { role: 'user' | 'bot'; text: string }) => {
    setChatLog((prev) => ({ ...prev, [id]: [...(prev[id] || []), entry] }));
  }, []);

  const sendChat = useCallback(async (trame: TrameForme) => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    appendLog(trame.id, { role: 'user', text });
    setBusy(true);
    try {
      const tokens = listTrameTokens(trame.docxBase64);
      const { ops, reply } = interpretTrameCommand(text, tokens);
      if (ops.length === 0) {
        appendLog(trame.id, { role: 'bot', text: reply || "Je n'ai pas compris." });
        return;
      }
      const res = applyTrameOps(trame.docxBase64, ops);
      const updated: TrameForme = { ...trame, docxBase64: res.docxBase64, updatedAt: new Date().toISOString() };
      await persist(list.map((t) => (t.id === trame.id ? updated : t)));
      const parts = [
        res.applied.length ? `✓ ${res.applied.join(' ; ')}` : '',
        res.warnings.length ? `⚠️ ${res.warnings.join(' ; ')}` : '',
        reply,
      ].filter(Boolean);
      appendLog(trame.id, { role: 'bot', text: parts.join('\n') || 'Fait.' });
    } catch {
      appendLog(trame.id, { role: 'bot', text: 'Modification impossible sur cette trame.' });
    } finally {
      setBusy(false);
    }
  }, [chatInput, appendLog, list, persist]);

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
          <div key={t.id} className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{t.nom}</div>
                <div className="text-xs text-gray-500">
                  <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 mr-2">{TYPE_LABELS[t.type]}</span>
                  {new Date(t.updatedAt).toLocaleDateString('fr-FR')}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => (editOpen === t.id ? setEditOpen(null) : openEdit(t))}
                  title="Éditer le texte de la trame"
                  className={`p-2 rounded hover:bg-gray-100 ${editOpen === t.id ? 'text-blue-700 bg-blue-50' : 'text-gray-600'}`}>
                  <PenLine className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setChatOpen(chatOpen === t.id ? null : t.id)}
                  title="Assistant : modifier la trame en langage naturel"
                  className={`p-2 rounded hover:bg-violet-50 ${chatOpen === t.id ? 'text-violet-700 bg-violet-50' : 'text-violet-600'}`}>
                  <Sparkles className="w-4 h-4" />
                </button>
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

            {editOpen === t.id && (
              <div className="border-t border-gray-100 p-3 space-y-2 bg-blue-50/40">
                <div className="flex items-center gap-2 text-xs text-blue-700">
                  <PenLine className="w-3.5 h-3.5" /> Modifiez chaque ligne de la trame. Les balises ({`{{CORPS}}`}, {`{{OBJET}}`}…) sont éditables comme du texte. La mise en forme (police, logo…) est conservée.
                </div>
                <div className="max-h-72 overflow-y-auto space-y-1 rounded border border-blue-100 bg-white p-2">
                  {editLines.map((line, i) => (
                    <input
                      key={i}
                      value={line}
                      onChange={(e) => setEditLines((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-[13px] font-mono"
                    />
                  ))}
                  {editLines.length === 0 && <div className="text-gray-500">Aucune ligne de texte détectée.</div>}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => saveEdit(t)} disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700 disabled:opacity-50">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer le texte
                  </button>
                  <button type="button" onClick={() => setEditOpen(null)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-100">Annuler</button>
                </div>
              </div>
            )}

            {chatOpen === t.id && (
              <div className="border-t border-gray-100 p-3 space-y-2 bg-violet-50/40">
                <div className="flex items-center gap-2 text-xs text-violet-700">
                  <Sparkles className="w-3.5 h-3.5" /> Assistant — dites ce que vous voulez changer (ex. « corps en Times 12 », « agrandis le logo », « pose les balises »).
                </div>
                {(chatLog[t.id] || []).length > 0 && (
                  <div className="max-h-52 overflow-y-auto space-y-1.5 rounded border border-violet-100 bg-white p-2">
                    {(chatLog[t.id] || []).map((m, i) => (
                      <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                        <span className={`inline-block whitespace-pre-line rounded px-2 py-1 ${m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                          {m.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={chatOpen === t.id ? chatInput : ''}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) sendChat(t); }}
                    placeholder="Modifier la trame…"
                    className="flex-1 rounded border border-gray-300 px-2 py-1"
                  />
                  <button type="button" onClick={() => sendChat(t)} disabled={busy}
                    className="inline-flex items-center gap-1 rounded bg-violet-600 px-3 py-1.5 text-white hover:bg-violet-700 disabled:opacity-50">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TramesFormePanel;
