/**
 * Explorateur de pièces d'une enquête — deux panneaux (type Finder) :
 * arborescence des pochettes à gauche, liste triable/filtrable à droite.
 *
 * Opérations : ouvrir (aperçu), renommer, déplacer vers une autre pochette
 * (sélection multiple), supprimer. Le déplacement passe par moveDocument :
 * l'original chiffré est RENOMMÉ sur place (jamais réécrit — pièces signées),
 * le jumeau markdown suit, l'index serveur est mis à jour.
 *
 * Badges par pièce : « T » copie texte disponible pour l'IA (jumeau MD/),
 * « ≡ » contenu strictement identique à une autre pièce du dossier
 * (empreinte sha256 égale — jonctions). Tout vient de l'index serveur :
 * aucun déchiffrement pour afficher.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import {
  Folder, FolderOpen, FileText, Search, Loader, ChevronRight, ChevronDown,
  Eye, Pencil, FolderInput, Trash2, X, RefreshCw,
} from 'lucide-react';
import { Enquete } from '@/types/interfaces';
import { useToast } from '@/contexts/ToastContext';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface DocumentExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  enquete: Enquete;
  onUpdate: (id: number, updates: Partial<Enquete>) => void;
}

interface ServerDoc { rel: string; size: number; savedAt: string; originalName?: string; sha?: string }

type SortKey = 'nom' | 'date' | 'taille';

const ZONE_LABELS: Record<string, string> = {
  Geoloc: 'Géolocalisations', Ecoutes: 'Écoutes', Actes: 'Autres actes', PV: 'PV enquêteurs', DML: 'DML', Dossier: 'Dossier complet',
};

const basename = (rel: string) => rel.split('/').pop() || rel;
const dirname = (rel: string) => rel.split('/').slice(0, -1).join('/');
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tailleLisible = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} o`);

export const DocumentExplorerModal = ({ isOpen, onClose, enquete, onUpdate }: DocumentExplorerModalProps) => {
  const { showToast } = useToast();
  const [docs, setDocs] = useState<ServerDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentDir, setCurrentDir] = useState<string>('');
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('nom');
  const [sortAsc, setSortAsc] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDir, setMoveDir] = useState('');
  const [moveNewSub, setMoveNewSub] = useState('');

  const charger = useCallback(async () => {
    if (!window.siralBridge) return;
    setLoading(true);
    try {
      setDocs(await window.siralBridge.listServerDocuments(enquete.numero) as ServerDoc[]);
    } catch { showToast("Index des pièces injoignable", 'error'); }
    finally { setLoading(false); }
  }, [enquete.numero, showToast]);

  useEffect(() => {
    if (isOpen) { charger(); setSelection(new Set()); setCurrentDir(''); setFilter(''); }
  }, [isOpen, charger]);

  // Pièces visibles (les jumeaux MD/ restent cachés : ils suivent tout seuls)
  const pieces = useMemo(() => docs.filter((d) => !d.rel.startsWith('MD/')), [docs]);
  const mdSet = useMemo(() => new Set(docs.filter((d) => d.rel.startsWith('MD/')).map((d) => d.rel)), [docs]);
  const aTexte = useCallback((rel: string) => mdSet.has('MD/' + rel.replace(/\.[^./]+$/, '') + '.md') || /\.(txt|md|html?|csv|eml)$/i.test(rel), [mdSet]);
  const shaCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of pieces) if (d.sha) m.set(d.sha, (m.get(d.sha) || 0) + 1);
    return m;
  }, [pieces]);

  // Arborescence des répertoires (toutes profondeurs)
  const dirs = useMemo(() => {
    const set = new Set<string>();
    for (const d of pieces) {
      const segs = d.rel.split('/');
      for (let i = 1; i < segs.length; i++) set.add(segs.slice(0, i).join('/'));
    }
    return set;
  }, [pieces]);
  const enfantsDirs = useCallback((dir: string) => {
    const prefix = dir ? dir + '/' : '';
    const depth = dir ? dir.split('/').length : 0;
    return [...dirs].filter((d) => d.startsWith(prefix) && d.split('/').length === depth + 1).sort((a, b) => a.localeCompare(b));
  }, [dirs]);
  const countIn = useCallback((dir: string) => pieces.filter((d) => d.rel.startsWith(dir + '/')).length, [pieces]);

  // Liste du panneau droit : la pochette courante, ou le résultat du filtre
  const listed = useMemo(() => {
    let out: ServerDoc[];
    if (filter.trim()) {
      const q = norm(filter);
      out = pieces.filter((d) => norm(d.rel).includes(q) || norm(d.originalName || '').includes(q));
    } else {
      const prefix = currentDir ? currentDir + '/' : '';
      const depth = currentDir ? currentDir.split('/').length : 0;
      out = pieces.filter((d) => d.rel.startsWith(prefix) && d.rel.split('/').length === depth + 1);
    }
    const dir = sortAsc ? 1 : -1;
    return [...out].sort((a, b) => dir * (
      sortKey === 'date' ? a.savedAt.localeCompare(b.savedAt)
        : sortKey === 'taille' ? a.size - b.size
        : basename(a.rel).localeCompare(basename(b.rel))
    ));
  }, [pieces, currentDir, filter, sortKey, sortAsc]);

  // ── Répercussion locale (index + liste de l'enquête) après une opération ──
  const appliqueMove = (from: string, to: string) => {
    const mdFrom = 'MD/' + from.replace(/\.[^./]+$/, '') + '.md';
    const mdTo = 'MD/' + to.replace(/\.[^./]+$/, '') + '.md';
    setDocs((prev) => prev.map((d) => (d.rel === from ? { ...d, rel: to } : d.rel === mdFrom ? { ...d, rel: mdTo } : d)));
    const documents = enquete.documents || [];
    if (documents.some((d) => d.cheminRelatif === from)) {
      onUpdate(enquete.id, {
        documents: documents.map((d) => (d.cheminRelatif === from ? { ...d, cheminRelatif: to, nom: basename(to) } : d)),
      });
    }
  };

  const renommer = async (doc: ServerDoc) => {
    const nom = window.prompt('Nouveau nom de la pièce :', basename(doc.rel));
    if (!nom || nom === basename(doc.rel)) return;
    setBusy(true);
    try {
      const to = await window.siralBridge.moveDocument(enquete.numero, doc.rel, (dirname(doc.rel) ? dirname(doc.rel) + '/' : '') + nom);
      appliqueMove(doc.rel, to);
      showToast('Pièce renommée', 'success');
    } catch (e) { showToast(e instanceof Error ? e.message : 'Renommage impossible', 'error'); }
    finally { setBusy(false); }
  };

  const deplacerSelection = async () => {
    const cible = moveDir + (moveNewSub.trim() ? '/' + moveNewSub.trim() : '');
    if (!cible) return;
    setBusy(true);
    let ok = 0; const erreurs: string[] = [];
    for (const rel of selection) {
      try {
        const to = await window.siralBridge.moveDocument(enquete.numero, rel, cible + '/' + basename(rel));
        appliqueMove(rel, to); ok++;
      } catch (e) { erreurs.push(`${basename(rel)} — ${e instanceof Error ? e.message : 'échec'}`); }
    }
    setBusy(false); setMoveOpen(false); setSelection(new Set()); setMoveNewSub('');
    showToast(erreurs.length ? `${ok} déplacée(s), ${erreurs.length} échec(s) : ${erreurs[0]}` : `${ok} pièce(s) déplacée(s) vers ${cible}`, erreurs.length ? 'warning' : 'success');
  };

  const supprimerSelection = async () => {
    if (!window.confirm(`Supprimer ${selection.size} pièce(s) ? (définitif)`)) return;
    setBusy(true);
    let ok = 0;
    const supprimees = new Set<string>();
    for (const rel of selection) {
      try {
        const done = await window.siralBridge.deleteDocument(enquete.numero, rel, enquete.cheminExterne, enquete.useSubfolderForExternal ?? true);
        if (done) { supprimees.add(rel); ok++; }
      } catch { /* comptée dans le bilan */ }
    }
    setDocs((prev) => prev.filter((d) => !supprimees.has(d.rel)));
    const documents = enquete.documents || [];
    if (documents.some((d) => supprimees.has(d.cheminRelatif))) {
      onUpdate(enquete.id, { documents: documents.filter((d) => !supprimees.has(d.cheminRelatif)) });
    }
    setBusy(false); setSelection(new Set());
    showToast(ok === selection.size ? `${ok} pièce(s) supprimée(s)` : `${ok}/${selection.size} supprimée(s)`, ok === selection.size ? 'success' : 'warning');
  };

  const ouvrir = async (rel: string) => {
    try {
      const ok = await window.siralBridge.openDocument(enquete.numero, rel);
      if (!ok) showToast("Impossible d'ouvrir la pièce", 'error');
    } catch { showToast("Erreur à l'ouverture", 'error'); }
  };

  const toggleSel = (rel: string) => setSelection((prev) => {
    const next = new Set(prev);
    if (next.has(rel)) next.delete(rel); else next.add(rel);
    return next;
  });

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const ouverts = openDirs.has(dir);
    const enfants = enfantsDirs(dir);
    const actif = currentDir === dir && !filter.trim();
    return (
      <div key={dir}>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs hover:bg-amber-50 ${actif ? 'bg-amber-100 font-medium' : ''}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => { setFilter(''); setCurrentDir(dir); if (!ouverts) setOpenDirs((p) => new Set(p).add(dir)); }}
        >
          <span
            className="flex-shrink-0"
            onClick={(e) => { e.stopPropagation(); setOpenDirs((p) => { const n = new Set(p); if (n.has(dir)) n.delete(dir); else n.add(dir); return n; }); }}
          >
            {enfants.length ? (ouverts ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : <span className="inline-block w-3" />}
          </span>
          {actif ? <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />}
          <span className="min-w-0 flex-1 truncate">{depth === 0 ? (ZONE_LABELS[dir] || dir) : basename(dir)}</span>
          <span className="flex-shrink-0 text-[10px] text-gray-400">{countIn(dir)}</span>
        </button>
        {ouverts && enfants.map((e) => renderDir(e, depth + 1))}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[82vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-amber-500" />
            Explorateur des pièces — {enquete.numero}
            <span className="ml-1 text-xs font-normal text-gray-500">{pieces.length} pièce(s)</span>
            <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={charger} disabled={loading} title="Recharger l'index serveur">
              {loading ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* ── Panneau gauche : pochettes ── */}
          <div className="w-56 flex-shrink-0 overflow-y-auto border-r bg-gray-50/60 p-2">
            <button
              type="button"
              className={`mb-1 flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs hover:bg-amber-50 ${!currentDir && !filter.trim() ? 'bg-amber-100 font-medium' : ''}`}
              onClick={() => { setFilter(''); setCurrentDir(''); }}
            >
              <Folder className="h-3.5 w-3.5 text-amber-500" /> Toutes les zones
            </button>
            {enfantsDirs('').map((z) => renderDir(z, 0))}
          </div>

          {/* ── Panneau droit : liste ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-gray-400" />
                <input
                  className="h-7 w-full rounded border pl-7 pr-6 text-xs"
                  placeholder="Filtrer par nom (tout le dossier)…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                {filter && (
                  <button type="button" className="absolute right-1.5 top-1.5" onClick={() => setFilter('')}>
                    <X className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                )}
              </div>
              {(['nom', 'date', 'taille'] as SortKey[]).map((k) => (
                <button
                  key={k} type="button"
                  className={`rounded px-1.5 py-0.5 text-[11px] ${sortKey === k ? 'bg-gray-200 font-medium' : 'text-gray-500 hover:bg-gray-100'}`}
                  onClick={() => (sortKey === k ? setSortAsc(!sortAsc) : (setSortKey(k), setSortAsc(true)))}
                  title={`Trier par ${k}`}
                >
                  {k}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
                </button>
              ))}
            </div>

            {/* fil d'Ariane */}
            {!filter.trim() && (
              <div className="flex items-center gap-1 border-b px-3 py-1 text-[11px] text-gray-500">
                <button type="button" className="hover:underline" onClick={() => setCurrentDir('')}>Zones</button>
                {currentDir.split('/').filter(Boolean).map((seg, i, arr) => (
                  <React.Fragment key={i}>
                    <ChevronRight className="h-3 w-3" />
                    <button type="button" className="hover:underline" onClick={() => setCurrentDir(arr.slice(0, i + 1).join('/'))}>
                      {i === 0 ? (ZONE_LABELS[seg] || seg) : seg}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* sous-pochettes de la pochette courante */}
              {!filter.trim() && enfantsDirs(currentDir).map((d) => (
                <button
                  key={d} type="button"
                  className="flex w-full items-center gap-2 border-b border-gray-50 px-3 py-1.5 text-left text-xs hover:bg-amber-50/60"
                  onDoubleClick={() => setCurrentDir(d)}
                  onClick={() => setCurrentDir(d)}
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 truncate font-medium">{currentDir ? basename(d) : (ZONE_LABELS[d] || d)}</span>
                  <span className="text-[10px] text-gray-400">{countIn(d)} pièce(s)</span>
                </button>
              ))}
              {listed.map((doc) => {
                const sel = selection.has(doc.rel);
                return (
                  <div
                    key={doc.rel}
                    className={`group flex items-center gap-2 border-b border-gray-50 px-3 py-1.5 text-xs ${sel ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <input type="checkbox" checked={sel} onChange={() => toggleSel(doc.rel)} className="flex-shrink-0" />
                    <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" title={doc.originalName || doc.rel} onClick={() => ouvrir(doc.rel)}>
                      {filter.trim() ? doc.rel : basename(doc.rel)}
                    </button>
                    {aTexte(doc.rel) && <span className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700" title="Copie texte disponible pour l'IA">T</span>}
                    {doc.sha && (shaCounts.get(doc.sha) || 0) > 1 && (
                      <span className="rounded bg-orange-100 px-1 text-[10px] font-medium text-orange-700" title="Contenu strictement identique à une autre pièce du dossier (empreinte sha256 égale)">≡</span>
                    )}
                    <span className="w-14 flex-shrink-0 text-right text-[10px] text-gray-400">{tailleLisible(Math.max(0, doc.size - 32))}</span>
                    <span className="w-16 flex-shrink-0 text-right text-[10px] text-gray-400">
                      {doc.savedAt ? format(new Date(doc.savedAt), 'dd/MM/yy', { locale: fr }) : ''}
                    </span>
                    <span className="hidden flex-shrink-0 items-center gap-0.5 group-hover:flex">
                      <button type="button" className="rounded p-0.5 hover:bg-gray-200" title="Aperçu" onClick={() => ouvrir(doc.rel)}><Eye className="h-3.5 w-3.5" /></button>
                      <button type="button" className="rounded p-0.5 hover:bg-gray-200" title="Renommer" onClick={() => renommer(doc)} disabled={busy}><Pencil className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                );
              })}
              {!listed.length && (!filter.trim() ? !enfantsDirs(currentDir).length : true) && (
                <p className="p-4 text-center text-xs text-gray-400">{loading ? 'Chargement…' : filter.trim() ? 'Aucune pièce ne correspond' : 'Pochette vide'}</p>
              )}
            </div>

            {/* barre de sélection */}
            {selection.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t bg-blue-50/70 px-3 py-2 text-xs">
                <span className="font-medium">{selection.size} sélectionnée(s)</span>
                {!moveOpen ? (
                  <>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setMoveDir(currentDir || enfantsDirs('')[0] || 'PV'); setMoveOpen(true); }} disabled={busy}>
                      <FolderInput className="h-3.5 w-3.5" /> Déplacer vers…
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs text-red-600" onClick={supprimerSelection} disabled={busy}>
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelection(new Set())}>Annuler</Button>
                  </>
                ) : (
                  <>
                    <select className="h-7 rounded border px-1 text-xs" value={moveDir} onChange={(e) => setMoveDir(e.target.value)}>
                      {[...dirs].sort((a, b) => a.localeCompare(b)).map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <input
                      className="h-7 w-40 rounded border px-2 text-xs"
                      placeholder="Nouvelle sous-pochette (option)"
                      value={moveNewSub}
                      onChange={(e) => setMoveNewSub(e.target.value)}
                    />
                    <Button size="sm" className="h-7 text-xs" onClick={deplacerSelection} disabled={busy || !moveDir}>
                      {busy ? <Loader className="h-3.5 w-3.5 animate-spin" /> : 'Déplacer'}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMoveOpen(false)}>Annuler</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
