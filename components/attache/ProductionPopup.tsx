'use client';

/**
 * SIRAL — Attaché de justice · popup d'un document rédigé.
 *
 * Ouvert depuis le journal « pendant votre absence » (dashboard) sur une carte
 * reliée à une production (acte rangé depuis Claude web, ou livrable de
 * l'attaché). Il donne, dans une seule fenêtre :
 *  - la LECTURE + l'ÉDITION manuelle du texte (textarea serif) ;
 *  - l'EXPORT PDF / Word au gabarit officiel ;
 *  - la VALIDATION (l'acte est marqué traité).
 * La retouche par l'IA se fait dans Claude web, là où l'acte a été rédigé.
 *
 * C'est la MÊME production que celle de l'atelier « Actes rédigés » : une
 * modification ici s'y répercute, et inversement — source unique, aucune
 * copie. Chiffrement E2E : le navigateur déchiffre pour afficher, rechiffre à
 * l'enregistrement ; l'app ne voit jamais le texte en clair.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  X, Save, FileDown, FileText, CheckCircle2, Loader2, RefreshCw, Undo2,
  Presentation, FileSpreadsheet,
} from 'lucide-react';
import { downloadActePdf, downloadActeDocx, acteFileBase } from '@/lib/web/acteExport';
import { downloadActePptx, estPresentable } from '@/lib/web/pptxExport';
import { downloadActeXlsx, contientTableaux } from '@/lib/web/xlsxExport';
import { messageProductionActe, useEnquetesStore } from '@/stores/useEnquetesStore';
import type { ActeMeta } from '@/types/interfaces';

type AnyFn = (...args: unknown[]) => Promise<any>;
const eapi = () => (window as unknown as { siralBridge: Record<string, AnyFn> }).siralBridge;

interface Production {
  id: string;
  numero: string;
  type: string;
  titre: string;
  contenu: string;
  source?: string;
  /** Objet de l'acte (n° de ligne interceptée, objet géolocalisé…) — dernier segment du nom de fichier. */
  objet?: string;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  traite?: boolean;
  traiteLe?: string;
  acteMeta?: ActeMeta;
}

const TYPE_LABEL: Record<string, string> = {
  requisition: 'Réquisition',
  reponse_dml: 'Réponse DML',
  prolongation_jld: 'Prolongation JLD',
  saisine_jld: 'Saisine JLD',
  projet_reponse: 'Projet de réponse',
  soit_transmis: 'Soit-transmis',
  note: 'Note',
  livrable: 'Livrable',
  presentation: 'Présentation',
  autre: 'Acte',
};

export function ProductionPopup({ numero, prodId, service, onClose, onChanged }: {
  numero: string;
  prodId: string;
  /** Service d'enquête du dossier — 2ᵉ segment du nom de fichier exporté. */
  service?: string;
  onClose: () => void;
  /** Appelé après tout changement persisté (édition, validation). */
  onChanged?: () => void;
}) {
  const [prod, setProd] = useState<Production | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Répercute la validation d'un acte rédigé sur les actes de l'enquête.
  const syncProductionActe = useEnquetesStore((s) => s.syncProductionActe);

  const dirty = prod !== null && draft !== prod.contenu;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attache/productions?numero=' + encodeURIComponent(numero));
      if (!res.ok) { setNotFound(true); return; }
      const { productions } = await res.json();
      for (const p of (productions || []) as Array<{ id: string; envelope: unknown }>) {
        if (p.id !== prodId) continue;
        const rec = await eapi().attache_decrypt(p.envelope);
        if (rec) {
          setProd(rec as Production);
          setDraft((rec as Production).contenu || '');
          setNotFound(false);
          return;
        }
      }
      setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [numero, prodId]);

  useEffect(() => { load(); }, [load]);

  /** Rechiffre et PUT une version modifiée. */
  const persist = useCallback(async (rec: Production): Promise<boolean> => {
    try {
      const envelope = await eapi().attache_encrypt(rec);
      const res = await fetch('/api/attache/productions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numero: rec.numero, id: rec.id, envelope }),
      });
      return res.ok;
    } catch { return false; }
  }, []);

  const save = useCallback(async () => {
    if (!prod) return;
    setBusy('save');
    try {
      const rec = { ...prod, contenu: draft, updatedAt: new Date().toISOString() };
      if (await persist(rec)) { setProd(rec); setNotice('Enregistré.'); onChanged?.(); }
      else setNotice('Échec de l\'enregistrement.');
    } finally { setBusy(null); }
  }, [prod, draft, persist, onChanged]);

  const valider = useCallback(async () => {
    if (!prod) return;
    setBusy('val');
    try {
      const now = new Date().toISOString();
      const rec = { ...prod, contenu: draft, traite: !prod.traite, traiteLe: prod.traite ? undefined : now, updatedAt: now };
      if (await persist(rec)) {
        setProd(rec);
        // Répercute la validation (ou la réouverture) dans l'enquête : acte
        // créé, prolongation demandée sur l'acte existant, ou rien — on le dit.
        const r = syncProductionActe(rec.numero, { id: rec.id, type: rec.type, titre: rec.titre, meta: rec.acteMeta, objet: rec.objet }, !!rec.traite);
        setNotice(rec.traite
          ? `Validé — ${messageProductionActe(r)}`
          : `Remis en attente.${r.action === 'rien' ? '' : ` ${messageProductionActe(r)}`}`);
        onChanged?.();
      } else setNotice('Action impossible (service injoignable ?).');
    } finally { setBusy(null); }
  }, [prod, draft, persist, onChanged, syncProductionActe]);

  const dl = useCallback(async (fmt: 'pdf' | 'docx' | 'pptx' | 'xlsx') => {
    if (!prod) return;
    setBusy(fmt);
    try {
      const p = { ...prod, service, contenu: draft };
      if (fmt === 'pdf') await downloadActePdf(p);
      else if (fmt === 'docx') await downloadActeDocx(p);
      else if (fmt === 'pptx') await downloadActePptx(p);
      else await downloadActeXlsx(p);
    } catch { setNotice(`Génération ${fmt.toUpperCase()} impossible.`); }
    finally { setBusy(null); }
  }, [prod, draft, service]);

  const label = prod ? (TYPE_LABEL[prod.type] || 'Acte') : '';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-2.5 border-b border-gray-200 bg-gray-50 px-4 py-3">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-gray-500">{label}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-gray-900">{prod?.titre || 'Document'}</div>
            <div className="text-[11px] text-gray-500">
              {numero && numero !== '_hors-dossier' ? `Dossier ${numero}` : 'Hors dossier'}
              {prod?.traite && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">traité</span>}
            </div>
          </div>
          <button onClick={load} title="Recharger le texte" className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:bg-white hover:text-gray-600">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {notice && <div className="border-b border-emerald-100 bg-emerald-50 px-4 py-1.5 text-[11.5px] text-emerald-800">{notice}</div>}

        {loading ? (
          <div className="grid flex-1 place-items-center py-16 text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : notFound ? (
          <div className="grid flex-1 place-items-center px-6 py-16 text-center text-sm text-gray-500">
            Ce document est introuvable — il a peut-être été supprimé.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Lecture / édition */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="px-4 pt-3 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Texte · éditable</div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="mx-4 my-2 min-h-0 flex-1 resize-none rounded-lg border border-gray-200 p-3 font-serif text-[13px] leading-relaxed text-gray-800 outline-none focus:border-[#2B5746]/40"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-2.5">
                <button
                  onClick={save}
                  disabled={busy === 'save' || !dirty}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2B5746] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Enregistrer
                </button>
                <button onClick={() => dl('pdf')} disabled={busy === 'pdf'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50" title={prod ? `Télécharge « ${acteFileBase({ ...prod, service })}.pdf »` : ''}>
                  {busy === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}PDF
                </button>
                <button onClick={() => dl('docx')} disabled={busy === 'docx'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50">
                  {busy === 'docx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Word
                </button>
                {prod && estPresentable({ type: prod.type, contenu: draft }) && (
                  <button onClick={() => dl('pptx')} disabled={busy === 'pptx'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50" title="Exporter en présentation PowerPoint (.pptx)">
                    {busy === 'pptx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Presentation className="h-3.5 w-3.5" />}PowerPoint
                  </button>
                )}
                {contientTableaux(draft) && (
                  <button onClick={() => dl('xlsx')} disabled={busy === 'xlsx'} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50" title="Exporter les tableaux en classeur Excel (.xlsx)">
                    {busy === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}Tableur
                  </button>
                )}
                <button
                  onClick={valider}
                  disabled={busy === 'val'}
                  className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${prod?.traite ? 'border-gray-200 text-gray-500 hover:bg-gray-50' : 'border-[#2B5746]/40 bg-emerald-50 text-[#2B5746] hover:bg-emerald-100'}`}
                >
                  {busy === 'val' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : prod?.traite ? <Undo2 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {prod?.traite ? 'Rouvrir' : 'Valider'}
                </button>
              </div>
            </div>

          </div>
        )}

        <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">
          🔗 Même document que dans « Actes rédigés » — une modification ici s'y répercute.
        </div>
      </div>
    </div>
  );
}
