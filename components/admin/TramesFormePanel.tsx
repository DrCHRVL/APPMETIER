'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Upload, Trash2, FlaskConical, Loader2, Check, AlertCircle, Sparkles, Send, PenLine, Wand2, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { loadTramesForme, saveTramesForme, poserTrame } from '@/lib/web/tramesFormeStore';
import { trameTypes, type TrameForme, type TrameFormeType, type TrameFormeFormat } from '@/lib/web/trameModele';
import {
  detecterFormat, formatDepuisNom, extensionTrame, trameBalisee, tokensTrame,
  lignesTrame, ecrireLignes, appliquerOpsTrame, fillTrame, type LigneTrame,
} from '@/lib/web/trameDoc';
import { interpretTrameCommand } from '@/lib/web/trameChat';
import {
  analyserActe, construireTrame, verifierProposition, gardeParDefaut, resumeLignes,
  ROLES, ROLE_LABELS, type PropositionTrame, type RoleLigne,
} from '@/lib/web/trameAnalyse';

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

/** Couleur d'une ligne dans la proposition, selon ce qu'on va en faire. */
const ROLE_STYLE: Record<RoleLigne, string> = {
  papeterie: 'bg-white border-gray-200',
  titre: 'bg-amber-50 border-amber-200',
  destinataire: 'bg-sky-50 border-sky-200',
  objet: 'bg-sky-50 border-sky-200',
  date: 'bg-sky-50 border-sky-200',
  corps: 'bg-violet-50 border-violet-200',
  signature: 'bg-emerald-50 border-emerald-200',
  retirer: 'bg-red-50 border-red-200 line-through text-gray-500',
};

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

/** Jeu d'essai commun au bouton « Tester » et à l'aperçu d'une proposition. */
const ESSAI = {
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
};

/** Cases à cocher des types d'actes servis par une trame. */
const TypesPicker = ({ types, onChange }: { types: TrameFormeType[]; onChange: (t: TrameFormeType[]) => void }) => (
  <div className="flex flex-wrap gap-2">
    {TYPE_ORDER.map((t) => {
      const on = types.includes(t);
      return (
        <button
          key={t}
          type="button"
          onClick={() => onChange(on ? types.filter((x) => x !== t) : [...types, t])}
          className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-blue-500 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          {TYPE_LABELS[t]}
        </button>
      );
    })}
  </div>
);

export const TramesFormePanel = () => {
  const { showToast } = useToast();
  const [list, setList] = useState<TrameForme[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const acteRef = useRef<HTMLInputElement>(null);
  // Import en attente de nommage / typage
  const [pending, setPending] = useState<{ base64: string; format: TrameFormeFormat; nom: string; types: TrameFormeType[] } | null>(null);
  // Analyse d'un acte existant : proposition de trame en attente de validation
  const [analyse, setAnalyse] = useState<{ base64: string; format: TrameFormeFormat; prop: PropositionTrame } | null>(null);
  const [analyseEnCours, setAnalyseEnCours] = useState(false);
  // Assistant : trame dont le chat est ouvert + saisie + journaux par trame
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<Record<string, { role: 'user' | 'bot'; text: string }[]>>({});
  // Édition manuelle du texte : trame ouverte + lignes en cours d'édition
  const [editOpen, setEditOpen] = useState<string | null>(null);
  const [editLines, setEditLines] = useState<LigneTrame[]>([]);
  const [editTypes, setEditTypes] = useState<TrameFormeType[]>([]);

  useEffect(() => {
    loadTramesForme().then((l) => { setList(l); setLoaded(true); });
  }, []);

  const persist = useCallback(async (next: TrameForme[]) => {
    setList(next);
    await saveTramesForme(next);
  }, []);

  /** Lit un fichier déposé et contrôle qu'il s'agit bien d'un .docx ou d'un .odt. */
  const lireFichier = useCallback(async (file: File): Promise<{ base64: string; format: TrameFormeFormat } | null> => {
    if (!formatDepuisNom(file.name)) {
      showToast('Format attendu : un fichier Word (.docx) ou OpenDocument (.odt).', 'error');
      return null;
    }
    try {
      const base64 = abToBase64(await file.arrayBuffer());
      const format = detecterFormat(base64);
      if (!format) {
        showToast('Fichier illisible : ce n\'est ni un .docx ni un .odt valide.', 'error');
        return null;
      }
      return { base64, format };
    } catch {
      showToast('Lecture du fichier impossible.', 'error');
      return null;
    }
  }, [showToast]);

  const onFile = useCallback(async (file: File) => {
    const lu = await lireFichier(file);
    if (!lu) return;
    if (!trameBalisee(lu.base64, lu.format)) {
      showToast('Aucune balise trouvée dans ce fichier. Ajoutez au moins {{CORPS}}, ou passez par « Créer depuis un acte ».', 'error');
      return;
    }
    setAnalyse(null);
    setPending({ ...lu, nom: file.name.replace(/\.(docx|odt)$/i, ''), types: ['courrier'] });
  }, [lireFichier, showToast]);

  /** Verse un acte DÉJÀ RÉDIGÉ : l'analyse en tire une proposition de trame. */
  const onActe = useCallback(async (file: File) => {
    const lu = await lireFichier(file);
    if (!lu) return;
    setPending(null);
    setAnalyseEnCours(true);
    try {
      const prop = await analyserActe(lu.base64, lu.format, file.name);
      if (!prop.lignes.length) {
        showToast('Aucune ligne de texte lisible dans ce document.', 'error');
        return;
      }
      setAnalyse({ ...lu, prop });
    } catch {
      showToast('Analyse impossible sur ce document.', 'error');
    } finally {
      setAnalyseEnCours(false);
    }
  }, [lireFichier, showToast]);

  const confirmImport = useCallback(async () => {
    if (!pending) return;
    if (!pending.types.length) { showToast('Choisissez au moins un type d\'acte.', 'error'); return; }
    setBusy(true);
    try {
      const trame: TrameForme = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `tf_${Date.now()}`,
        nom: pending.nom.trim() || 'Trame',
        type: pending.types[0],
        types: pending.types,
        format: pending.format,
        docxBase64: pending.base64,
        updatedAt: new Date().toISOString(),
      };
      await persist(poserTrame(list, trame));
      setPending(null);
      showToast('Trame de forme enregistrée.', 'success');
    } finally {
      setBusy(false);
    }
  }, [pending, list, persist, showToast]);

  /** Change le rôle d'une ligne de la proposition (correction à la marge). */
  const majRole = useCallback((index: number, role: RoleLigne) => {
    setAnalyse((a) => {
      if (!a) return a;
      const lignes = a.prop.lignes.map((l) => (
        l.index === index ? { ...l, role, garde: gardeParDefaut(l.texte, role), motif: 'choix du magistrat' } : l
      ));
      return { ...a, prop: { ...a.prop, lignes, resume: resumeLignes(lignes) } };
    });
  }, []);

  /** Enregistre la trame construite d'après la proposition. */
  const enregistrerAnalyse = useCallback(async () => {
    if (!analyse) return;
    const alertes = verifierProposition(analyse.prop);
    if (!analyse.prop.lignes.some((l) => l.role === 'corps')) { showToast(alertes[0], 'error'); return; }
    if (!analyse.prop.types.length) { showToast('Choisissez au moins un type d\'acte.', 'error'); return; }
    setBusy(true);
    try {
      const base64 = construireTrame(analyse.base64, analyse.format, analyse.prop);
      const trame: TrameForme = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `tf_${Date.now()}`,
        nom: analyse.prop.nom.trim() || 'Trame',
        type: analyse.prop.types[0],
        types: analyse.prop.types,
        format: analyse.format,
        docxBase64: base64,
        updatedAt: new Date().toISOString(),
      };
      await persist(poserTrame(list, trame));
      setAnalyse(null);
      showToast('Trame créée depuis votre acte.', 'success');
    } catch {
      showToast('Construction de la trame impossible.', 'error');
    } finally {
      setBusy(false);
    }
  }, [analyse, list, persist, showToast]);

  /** Aperçu : construit la trame proposée et la remplit avec un acte d'essai. */
  const apercuAnalyse = useCallback(async () => {
    if (!analyse) return;
    setBusy(true);
    try {
      const base64 = construireTrame(analyse.base64, analyse.format, analyse.prop);
      const blob = await fillTrame(base64, analyse.format, ESSAI);
      downloadBlob(blob, `apercu_trame.${extensionTrame(analyse.format)}`);
    } catch {
      showToast('Aperçu impossible.', 'error');
    } finally {
      setBusy(false);
    }
  }, [analyse, showToast]);

  const remove = useCallback(async (id: string) => {
    await persist(list.filter((t) => t.id !== id));
    showToast('Trame supprimée.', 'success');
  }, [list, persist, showToast]);

  const test = useCallback(async (trame: TrameForme) => {
    setBusy(true);
    try {
      const format: TrameFormeFormat = trame.format === 'odt' ? 'odt' : 'docx';
      const blob = await fillTrame(trame.docxBase64, format, ESSAI);
      downloadBlob(blob, `essai_${trame.type}.${extensionTrame(format)}`);
    } catch {
      showToast('Test impossible (trame invalide ?).', 'error');
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const openEdit = useCallback((trame: TrameForme) => {
    const format: TrameFormeFormat = trame.format === 'odt' ? 'odt' : 'docx';
    setEditLines(lignesTrame(trame.docxBase64, format));
    setEditTypes(trameTypes(trame));
    setEditOpen(trame.id);
    setChatOpen(null);
  }, []);

  const saveEdit = useCallback(async (trame: TrameForme) => {
    setBusy(true);
    try {
      const format: TrameFormeFormat = trame.format === 'odt' ? 'odt' : 'docx';
      const docxBase64 = ecrireLignes(trame.docxBase64, format, editLines);
      const types = editTypes.length ? editTypes : trameTypes(trame);
      const updated: TrameForme = {
        ...trame, docxBase64, type: types[0], types, updatedAt: new Date().toISOString(),
      };
      await persist(poserTrame(list, updated));
      setEditOpen(null);
      showToast('Trame mise à jour.', 'success');
    } catch {
      showToast('Enregistrement impossible.', 'error');
    } finally {
      setBusy(false);
    }
  }, [editLines, editTypes, list, persist, showToast]);

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
      const format: TrameFormeFormat = trame.format === 'odt' ? 'odt' : 'docx';
      const tokens = tokensTrame(trame.docxBase64, format);
      const { ops, reply } = interpretTrameCommand(text, tokens);
      if (ops.length === 0) {
        appendLog(trame.id, { role: 'bot', text: reply || "Je n'ai pas compris." });
        return;
      }
      const res = appliquerOpsTrame(trame.docxBase64, format, ops);
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

  const alertes = analyse ? verifierProposition(analyse.prop) : [];

  return (
    <div className="space-y-6 text-sm text-gray-800">
      <div>
        <h3 className="text-base font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" /> Trames de forme (papeteries Word / OpenDocument)
        </h3>
        <p className="mt-1 text-gray-600">
          Déposez vos propres modèles Word (.docx) ou LibreOffice (.odt) : votre papeterie exacte — logo,
          en-tête, police, pied de page. Placez-y les balises ci-dessous là où le contenu de l'acte doit
          apparaître. À l'export d'un acte, l'application part de VOTRE trame, n'y injecte que le texte,
          et rend un fichier du même format que la trame retenue.
        </p>
      </div>

      {/* Aide balises */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="font-medium mb-2">Balises à insérer dans votre modèle</div>
        <ul className="space-y-1">
          {TOKEN_HELP.map((h) => (
            <li key={h.token} className="flex gap-2">
              <code className="shrink-0 rounded bg-white border border-gray-300 px-1.5 py-0.5 text-blue-700">{h.token}</code>
              <span className="text-gray-600">{h.desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">
          Seule {`{{CORPS}}`} est requise. Les balises absentes sont simplement ignorées. Vous n'avez pas
          envie de les poser vous-même ? Versez un acte déjà rédigé : l'analyse les place pour vous.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".docx,.odt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
        />
        <input
          ref={acteRef}
          type="file"
          accept=".docx,.odt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onActe(f); e.target.value = ''; }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || analyseEnCours}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Upload className="w-4 h-4" /> Importer une trame balisée (.docx / .odt)
        </button>
        <button
          type="button"
          onClick={() => acteRef.current?.click()}
          disabled={busy || analyseEnCours}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {analyseEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Créer une trame depuis un acte déjà fait
        </button>
      </div>
      {analyseEnCours && (
        <div className="text-violet-700">Lecture de l'acte et repérage de votre papeterie…</div>
      )}

      {/* Formulaire de nommage/typage de l'import en attente */}
      {pending && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div className="font-medium">Nouvelle trame ({pending.format === 'odt' ? 'OpenDocument' : 'Word'})</div>
          <label className="block">
            <span className="text-gray-600">Nom</span>
            <input
              value={pending.nom}
              onChange={(e) => setPending({ ...pending, nom: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <div>
            <span className="text-gray-600">Types d'actes servis par cette trame</span>
            <div className="mt-1">
              <TypesPicker types={pending.types} onChange={(types) => setPending({ ...pending, types })} />
            </div>
          </div>
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

      {/* Proposition de trame issue de l'analyse d'un acte */}
      {analyse && (
        <div className="rounded-lg border border-violet-300 bg-violet-50/60 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-violet-700" /> Proposition de trame
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">
                  {analyse.prop.origine === 'ia' ? `analyse de l'attaché${analyse.prop.modele ? ` (${analyse.prop.modele})` : ''}` : 'analyse locale'}
                </span>
              </div>
              <p className="mt-1 text-gray-600">{analyse.prop.resume}</p>
            </div>
            <button type="button" onClick={() => setAnalyse(null)} title="Abandonner"
              className="p-1.5 rounded hover:bg-violet-100 text-gray-500"><X className="w-4 h-4" /></button>
          </div>

          <label className="block">
            <span className="text-gray-600">Nom de la trame</span>
            <input
              value={analyse.prop.nom}
              onChange={(e) => setAnalyse({ ...analyse, prop: { ...analyse.prop, nom: e.target.value } })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
            />
          </label>
          <div>
            <span className="text-gray-600">Types d'actes proposés</span>
            <div className="mt-1">
              <TypesPicker
                types={analyse.prop.types}
                onChange={(types) => setAnalyse({ ...analyse, prop: { ...analyse.prop, types } })}
              />
            </div>
          </div>

          {alertes.length > 0 && (
            <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
              {alertes.map((a) => (
                <li key={a} className="flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{a}</li>
              ))}
            </ul>
          )}

          <div>
            <div className="text-gray-600 mb-1">
              Ligne à ligne — ce qui est gardé, ce qui devient une balise. Corrigez ce qui vous paraît mal classé.
            </div>
            <div className="max-h-96 overflow-y-auto space-y-1 rounded border border-violet-200 bg-white p-2">
              {analyse.prop.lignes.map((l) => (
                <div key={l.index} className={`flex items-start gap-2 rounded border px-2 py-1 ${ROLE_STYLE[l.role]}`}>
                  <select
                    value={l.role}
                    onChange={(e) => majRole(l.index, e.target.value as RoleLigne)}
                    className="shrink-0 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[13px]" title={l.texte}>
                      {l.texte.trim() || <span className="text-gray-400">(ligne vide)</span>}
                    </div>
                    {l.motif && <div className="truncate text-[11px] text-gray-500">{l.motif}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={enregistrerAnalyse} disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700 disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer la trame
            </button>
            <button type="button" onClick={apercuAnalyse} disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-100">
              <FlaskConical className="w-4 h-4" /> Aperçu rempli
            </button>
            <button type="button" onClick={() => setAnalyse(null)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 hover:bg-gray-100">Abandonner</button>
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
        {list.map((t) => {
          const types = trameTypes(t);
          return (
            <div key={t.id} className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.nom}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap items-center gap-1">
                    {types.length === 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">aucun type — inutilisée</span>}
                    {types.map((x) => <span key={x} className="rounded bg-gray-100 px-1.5 py-0.5">{TYPE_LABELS[x]}</span>)}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 uppercase">{extensionTrame(t.format === 'odt' ? 'odt' : 'docx')}</span>
                    <span>{new Date(t.updatedAt).toLocaleDateString('fr-FR')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => (editOpen === t.id ? setEditOpen(null) : openEdit(t))}
                    title="Éditer le texte et les types de la trame"
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
                  <TypesPicker types={editTypes} onChange={setEditTypes} />
                  <div className="max-h-72 overflow-y-auto space-y-1 rounded border border-blue-100 bg-white p-2">
                    {editLines.map((ligne, i) => (
                      <input
                        key={ligne.index}
                        value={ligne.texte}
                        onChange={(e) => setEditLines((prev) => prev.map((l, j) => (j === i ? { ...l, texte: e.target.value } : l)))}
                        className="w-full rounded border border-gray-200 px-2 py-1 text-[13px] font-mono"
                      />
                    ))}
                    {editLines.length === 0 && <div className="text-gray-500">Aucune ligne de texte détectée.</div>}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => saveEdit(t)} disabled={busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-white hover:bg-green-700 disabled:opacity-50">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Enregistrer
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
          );
        })}
      </div>
    </div>
  );
};

export default TramesFormePanel;
