// components/mindmap/OverlayModals.tsx
// Modaux de saisie pour les données utilisateur de cartographie :
//   - AddMecModal       : créer/éditer un mis en cause ex nihilo
//   - AddDossierModal   : créer/éditer un dossier ex nihilo (avec sélection MEC)
//   - AddLienModal      : créer/éditer un lien renseignement entre deux entités

'use client';

import React, { useMemo, useState } from 'react';
import { X, Search, ArrowRight, UserPlus, ChevronUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import type { GraphNode, MindmapGraph } from '@/utils/mindmapGraph';
import type { MecExNihilo, DossierExNihilo, LienRenseignement, MecExNihiloStatut, ClusterAnnotation } from '@/stores/useCartographieOverlayStore';
import { useTags } from '@/hooks/useTags';

// ─────────────────────────────────────────────────
// AddMecModal
// ─────────────────────────────────────────────────

interface AddMecModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial?: MecExNihilo;
  onSubmit: (data: { displayName: string; alias: string[]; statut?: MecExNihiloStatut; notes?: string }) => void;
}

export const AddMecModal: React.FC<AddMecModalProps> = ({ isOpen, onClose, initial, onSubmit }) => {
  const [displayName, setDisplayName] = useState(initial?.displayName || '');
  const [aliasInput, setAliasInput] = useState('');
  const [alias, setAlias] = useState<string[]>(initial?.alias || []);
  const [statut, setStatut] = useState<MecExNihiloStatut | ''>(initial?.statut || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  React.useEffect(() => {
    if (isOpen) {
      setDisplayName(initial?.displayName || '');
      setAlias(initial?.alias || []);
      setStatut(initial?.statut || '');
      setNotes(initial?.notes || '');
      setAliasInput('');
    }
  }, [isOpen, initial]);

  const addAlias = () => {
    const v = aliasInput.trim();
    if (v && !alias.includes(v)) setAlias([...alias, v]);
    setAliasInput('');
  };

  const handleSubmit = () => {
    if (!displayName.trim()) return;
    onSubmit({
      displayName: displayName.trim(),
      alias,
      statut: statut || undefined,
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Modifier la fiche manuelle' : 'Ajouter un mis en cause'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nom affiché *</Label>
            <Input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="ex. ZOUAOUI Fadel"
              autoFocus
            />
          </div>
          <div>
            <Label>Alias / surnoms</Label>
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={e => setAliasInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                placeholder="entrée pour valider"
              />
              <Button type="button" variant="outline" onClick={addAlias}>Ajouter</Button>
            </div>
            {alias.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {alias.map(a => (
                  <span key={a} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 rounded px-2 py-0.5">
                    {a}
                    <button onClick={() => setAlias(alias.filter(x => x !== a))} className="text-slate-400 hover:text-slate-700">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <Label>Statut</Label>
            <select
              value={statut}
              onChange={e => setStatut(e.target.value as MecExNihiloStatut | '')}
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2"
            >
              <option value="">— non précisé —</option>
              <option value="actif">Actif</option>
              <option value="dormant">Dormant</option>
              <option value="libere">Sorti / libéré</option>
              <option value="decede">Décédé</option>
            </select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Pourquoi tu le surveilles, contexte, liens connus…"
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!displayName.trim()}>
            {initial ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────
// AddDossierModal
// ─────────────────────────────────────────────────

interface AddDossierModalProps {
  isOpen: boolean;
  onClose: () => void;
  graph: MindmapGraph;
  initial?: DossierExNihilo;
  onSubmit: (data: { label: string; dateApprox?: string; mecIds: string[]; typeInfractionTagIds?: string[]; notes?: string }) => void;
  /** Crée un MEC ex nihilo et renvoie son id canonique (à ajouter aux mecIds liés). */
  onCreateMec?: (data: { displayName: string; alias: string[]; statut?: MecExNihiloStatut; notes?: string }) => string;
}

interface InlineCreatedMec {
  id: string;
  displayName: string;
}

export const AddDossierModal: React.FC<AddDossierModalProps> = ({ isOpen, onClose, graph, initial, onSubmit, onCreateMec }) => {
  const [label, setLabel] = useState(initial?.label || '');
  const [dateApprox, setDateApprox] = useState(initial?.dateApprox || '');
  const [mecIds, setMecIds] = useState<string[]>(initial?.mecIds || []);
  const [typeInfractionTagIds, setTypeInfractionTagIds] = useState<string[]>(initial?.typeInfractionTagIds || []);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [search, setSearch] = useState('');

  // Tags d'infraction disponibles (alimentés par Paramètres > Tags).
  const { getTagsByCategory } = useTags();
  const infractionTags = useMemo(() => getTagsByCategory('infractions'), [getTagsByCategory]);

  // ── Création inline d'un MEC (mêmes champs que AddMecModal) ───
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAliasInput, setNewAliasInput] = useState('');
  const [newAlias, setNewAlias] = useState<string[]>([]);
  const [newStatut, setNewStatut] = useState<MecExNihiloStatut | ''>('');
  const [newNotes, setNewNotes] = useState('');
  /** Filet de sécurité : si le graphe ne s'est pas encore mis à jour, on
   *  garde les MEC fraîchement créés en local pour les afficher en pastille. */
  const [createdLocally, setCreatedLocally] = useState<InlineCreatedMec[]>([]);

  const resetCreateForm = () => {
    setNewName('');
    setNewAliasInput('');
    setNewAlias([]);
    setNewStatut('');
    setNewNotes('');
  };

  React.useEffect(() => {
    if (isOpen) {
      setLabel(initial?.label || '');
      setDateApprox(initial?.dateApprox || '');
      setMecIds(initial?.mecIds || []);
      setTypeInfractionTagIds(initial?.typeInfractionTagIds || []);
      setNotes(initial?.notes || '');
      setSearch('');
      setCreateOpen(false);
      setCreatedLocally([]);
      resetCreateForm();
    }
  }, [isOpen, initial]);

  const addNewAlias = () => {
    const v = newAliasInput.trim();
    if (v && !newAlias.includes(v)) setNewAlias([...newAlias, v]);
    setNewAliasInput('');
  };

  const handleCreateMec = () => {
    if (!onCreateMec) return;
    const name = newName.trim();
    if (!name) return;
    const id = onCreateMec({
      displayName: name,
      alias: newAlias,
      statut: newStatut || undefined,
      notes: newNotes.trim() || undefined,
    });
    if (!id) return;
    setMecIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setCreatedLocally(prev => prev.some(m => m.id === id) ? prev : [...prev, { id, displayName: name }]);
    resetCreateForm();
    setCreateOpen(false);
  };

  const allMecs = useMemo(() => Array.from(graph.mecById.values()), [graph]);
  const matchingMecs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allMecs.slice(0, 10);
    return allMecs.filter(m =>
      m.displayName.toLowerCase().includes(q) ||
      m.variants.some(v => v.toLowerCase().includes(q)),
    ).slice(0, 20);
  }, [allMecs, search]);

  const selectedMecs = useMemo(() => {
    const set = new Set(mecIds);
    const fromGraph = allMecs.filter(m => set.has(m.id));
    const knownIds = new Set(fromGraph.map(m => m.id));
    // Inclut les MEC tout juste créés que le graphe ne connaît pas encore.
    const fromLocal = createdLocally
      .filter(m => set.has(m.id) && !knownIds.has(m.id))
      .map(m => ({ id: m.id, displayName: m.displayName, dossierIds: [] as string[] }));
    return [...fromGraph, ...fromLocal];
  }, [allMecs, mecIds, createdLocally]);

  const toggleMec = (id: string) => {
    setMecIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const toggleInfractionTag = (tagId: string) => {
    setTypeInfractionTagIds(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  };

  const handleSubmit = () => {
    if (!label.trim()) return;
    onSubmit({
      label: label.trim(),
      dateApprox: dateApprox.trim() || undefined,
      mecIds,
      typeInfractionTagIds: typeInfractionTagIds.length > 0 ? typeInfractionTagIds : undefined,
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Modifier le dossier manuel' : 'Ajouter un dossier'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Libellé *</Label>
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="ex. Réseau ZOUAOUI / Quartier Léo Lagrange"
              autoFocus
            />
          </div>
          <div>
            <Label>Date approximative</Label>
            <Input
              value={dateApprox}
              onChange={e => setDateApprox(e.target.value)}
              placeholder="ex. 2018-2020, ou 2019 jugé"
            />
          </div>
          <div>
            <Label>Mis en cause liés ({mecIds.length})</Label>
            {selectedMecs.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selectedMecs.map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-200 rounded px-2 py-0.5">
                    {m.displayName}
                    <button onClick={() => toggleMec(m.id)} className="text-slate-400 hover:text-slate-700">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Rechercher un MEC à ajouter…"
                className="pl-9"
              />
            </div>
            {matchingMecs.length > 0 && (
              <div className="mt-1 border border-slate-200 rounded-md max-h-40 overflow-y-auto">
                {matchingMecs.map(m => {
                  const sel = mecIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMec(m.id)}
                      className={`w-full text-left text-sm px-3 py-1.5 flex items-center justify-between border-b border-slate-100 last:border-b-0 ${
                        sel ? 'bg-slate-100' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span>{m.displayName}</span>
                      <span className="text-[10px] text-slate-400">
                        {m.dossierIds.length} dossier{m.dossierIds.length > 1 ? 's' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {onCreateMec && (
              <div className="mt-2 border border-slate-200 rounded-md">
                <button
                  type="button"
                  onClick={() => setCreateOpen(o => !o)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {createOpen ? <ChevronUp className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                  <span className="flex-1 text-left">
                    {createOpen ? 'Fermer le formulaire' : 'Créer un nouveau mis en cause'}
                  </span>
                </button>
                {createOpen && (
                  <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50/50">
                    <div>
                      <Label>Nom affiché *</Label>
                      <Input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="ex. ZOUAOUI Fadel"
                      />
                    </div>
                    <div>
                      <Label>Alias / surnoms</Label>
                      <div className="flex gap-2">
                        <Input
                          value={newAliasInput}
                          onChange={e => setNewAliasInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNewAlias(); } }}
                          placeholder="entrée pour valider"
                        />
                        <Button type="button" variant="outline" onClick={addNewAlias}>Ajouter</Button>
                      </div>
                      {newAlias.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {newAlias.map(a => (
                            <span key={a} className="inline-flex items-center gap-1 text-xs bg-white border border-slate-200 rounded px-2 py-0.5">
                              {a}
                              <button onClick={() => setNewAlias(newAlias.filter(x => x !== a))} className="text-slate-400 hover:text-slate-700">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <Label>Statut</Label>
                      <select
                        value={newStatut}
                        onChange={e => setNewStatut(e.target.value as MecExNihiloStatut | '')}
                        className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
                      >
                        <option value="">— non précisé —</option>
                        <option value="actif">Actif</option>
                        <option value="dormant">Dormant</option>
                        <option value="libere">Sorti / libéré</option>
                        <option value="decede">Décédé</option>
                      </select>
                    </div>
                    <div>
                      <Label>Notes</Label>
                      <Textarea
                        value={newNotes}
                        onChange={e => setNewNotes(e.target.value)}
                        placeholder="Pourquoi tu le surveilles, contexte, liens connus…"
                        rows={3}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { resetCreateForm(); setCreateOpen(false); }}
                      >
                        Annuler
                      </Button>
                      <Button type="button" onClick={handleCreateMec} disabled={!newName.trim()}>
                        Créer et lier
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Astuce : pour matérialiser un réseau, crée un dossier "Réseau X" et lie tous les membres ici.
            </p>
          </div>
          <div>
            <Label>Type(s) d&apos;infraction</Label>
            <p className="text-[11px] text-slate-400 mb-1.5">
              Pondère le score top 10 selon les poids configurés dans
              Paramètres &gt; Cartographie. N&apos;apparaît pas dans les stats.
            </p>
            {infractionTags.length === 0 ? (
              <div className="text-xs text-slate-400 italic px-2 py-1.5 border border-dashed border-slate-200 rounded">
                Aucun tag d&apos;infraction défini (Paramètres &gt; Tags).
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {infractionTags.map(tag => {
                  const sel = typeInfractionTagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleInfractionTag(tag.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        sel
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {tag.value}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Contexte, époque, informations clés…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!label.trim()}>
            {initial ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────
// AddLienModal
// ─────────────────────────────────────────────────

interface AddLienModalProps {
  isOpen: boolean;
  onClose: () => void;
  graph: MindmapGraph;
  initial?: LienRenseignement;
  /** Pré-remplit la source (ex. clic droit "Lier depuis ce nœud") */
  defaultSourceId?: string;
  onSubmit: (data: { source: string; target: string; label?: string; notes?: string }) => void;
}

export const AddLienModal: React.FC<AddLienModalProps> = ({
  isOpen, onClose, graph, initial, defaultSourceId, onSubmit,
}) => {
  const [sourceId, setSourceId] = useState(initial?.source || defaultSourceId || '');
  const [targetId, setTargetId] = useState(initial?.target || '');
  const [label, setLabel] = useState(initial?.label || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  React.useEffect(() => {
    if (isOpen) {
      setSourceId(initial?.source || defaultSourceId || '');
      setTargetId(initial?.target || '');
      setLabel(initial?.label || '');
      setNotes(initial?.notes || '');
    }
  }, [isOpen, initial, defaultSourceId]);

  const handleSubmit = () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    onSubmit({
      source: sourceId,
      target: targetId,
      label: label.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Modifier le lien renseignement' : 'Ajouter un lien renseignement'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
            <NodePicker label="Source *" graph={graph} value={sourceId} onChange={setSourceId} />
            <ArrowRight className="h-4 w-4 text-slate-400 mb-3" />
            <NodePicker label="Cible *" graph={graph} value={targetId} onChange={setTargetId} excludeId={sourceId} />
          </div>
          <div>
            <Label>Libellé du lien</Label>
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="ex. Co-détenus, famille, info commissariat…"
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Source du renseignement, fiabilité, contexte…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit} disabled={!sourceId || !targetId || sourceId === targetId}>
            {initial ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────
// NodePicker — recherche un nœud (MEC ou dossier) du graphe
// ─────────────────────────────────────────────────

const NodePicker: React.FC<{
  label: string;
  graph: MindmapGraph;
  value: string;
  onChange: (id: string) => void;
  excludeId?: string;
}> = ({ label, graph, value, onChange, excludeId }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected: GraphNode | undefined = value
    ? (graph.mecById.get(value) || graph.dossierById.get(value))
    : undefined;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as GraphNode[];
    const out: GraphNode[] = [];
    for (const m of graph.mecById.values()) {
      if (m.id === excludeId) continue;
      if (m.displayName.toLowerCase().includes(q) ||
          m.variants.some(v => v.toLowerCase().includes(q))) out.push(m);
      if (out.length >= 15) break;
    }
    for (const d of graph.dossierById.values()) {
      if (d.id === excludeId) continue;
      if (d.numero.toLowerCase().includes(q)) out.push(d);
      if (out.length >= 25) break;
    }
    return out;
  }, [query, graph, excludeId]);

  return (
    <div>
      <Label>{label}</Label>
      {selected && !open ? (
        <div className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2 bg-slate-50">
          <span className={`text-[10px] uppercase font-semibold rounded px-1.5 py-0.5 ${
            selected.type === 'mec' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {selected.type === 'mec' ? 'MEC' : 'Dossier'}
          </span>
          <span className="text-sm flex-1 truncate">
            {selected.type === 'mec' ? selected.displayName : selected.numero}
          </span>
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(true); setQuery(''); }}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Rechercher MEC ou dossier…"
          />
          {open && matches.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto z-50">
              {matches.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => { onChange(n.id); setOpen(false); setQuery(''); }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex items-center gap-2"
                >
                  <span className={`text-[10px] uppercase font-semibold rounded px-1.5 py-0.5 ${
                    n.type === 'mec' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {n.type === 'mec' ? 'MEC' : 'Dossier'}
                  </span>
                  <span className="truncate">{n.type === 'mec' ? n.displayName : n.numero}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────
// AddClusterAnnotationModal
// ─────────────────────────────────────────────────
// Nommer (ou renommer) une aire d'influence détectée. Snapshote les nodeIds
// actuels du cluster pour permettre le matching tolérant après évolution
// du graphe.

const CLUSTER_COLOR_PRESETS = [
  '#dc2626', // rouge
  '#ea580c', // orange
  '#ca8a04', // ambre
  '#16a34a', // vert
  '#0891b2', // cyan
  '#2563eb', // bleu
  '#7c3aed', // violet
  '#db2777', // rose
  '#475569', // ardoise
];

interface AddClusterAnnotationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Métadonnées du cluster cible (issu de InfluenceCluster) */
  cluster?: { nodeIds: string[]; color: string; nbMembers: number };
  /** Annotation existante si on est en édition */
  initial?: ClusterAnnotation;
  onSubmit: (data: { label: string; notes?: string; color?: string; nodeIds: string[] }) => void;
  /** Si fourni et qu'on édite, propose un bouton "Supprimer". */
  onDelete?: () => void;
}

export const AddClusterAnnotationModal: React.FC<AddClusterAnnotationModalProps> = ({
  isOpen, onClose, cluster, initial, onSubmit, onDelete,
}) => {
  const [label, setLabel] = useState(initial?.label || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [color, setColor] = useState<string>(initial?.color || cluster?.color || CLUSTER_COLOR_PRESETS[0]);

  React.useEffect(() => {
    if (isOpen) {
      setLabel(initial?.label || '');
      setNotes(initial?.notes || '');
      setColor(initial?.color || cluster?.color || CLUSTER_COLOR_PRESETS[0]);
    }
  }, [isOpen, initial, cluster]);

  const handleSubmit = () => {
    const trimmed = label.trim();
    if (!trimmed || !cluster) return;
    onSubmit({
      label: trimmed,
      notes: notes.trim() || undefined,
      color,
      // Snapshot les nodeIds actuels du cluster — c'est ce snapshot qui
      // servira de référence pour matcher l'annotation aux clusters futurs.
      nodeIds: cluster.nodeIds,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Renommer le réseau' : 'Nommer ce réseau'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="cluster-label">Nom du réseau *</Label>
            <Input
              id="cluster-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ex. Réseau Marseille, Groupe TAURUS…"
              autoFocus
            />
          </div>

          <div>
            <Label>Couleur</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {CLUSTER_COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition-all ${
                    color === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'border-white shadow-sm hover:scale-110'
                  }`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="cluster-notes">Notes (optionnel)</Label>
            <Textarea
              id="cluster-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Contexte, hypothèse d'enquête, précisions…"
            />
          </div>

          {cluster && (
            <div className="text-xs text-slate-500">
              {cluster.nbMembers} membre(s) ancrés à cette annotation. L'annotation
              survivra à l'ajout/retrait de quelques membres ; en cas de
              recomposition majeure, elle se détachera et pourra être réappliquée.
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          {initial && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-red-600 hover:text-red-800 hover:bg-red-50"
              onClick={() => { onDelete(); onClose(); }}
            >
              Supprimer
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="button" onClick={handleSubmit} disabled={!label.trim()}>
              {initial ? 'Enregistrer' : 'Créer'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
